import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderLine, orderTotals } from '@caissebox/shared';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';

export interface DayReport {
  day: {
    id: string;
    establishmentId: string;
    businessDate: string;
    status: string;
    openedAt: string;
    closedAt: string | null;
    zNumber: number | null;
    openingFloatCents: number;
  };
  orders: { paid: number; open: number; voided: number; covers: number };
  totals: { ttcCents: number; htCents: number; tvaCents: number; discountCents: number; compCents: number; voidedCents: number; averageTicketCents: number };
  taxes: { rateBp: number; htCents: number; tvaCents: number; ttcCents: number }[];
  payments: { method: string; kind: string; count: number; amountCents: number }[];
  waiters: { staffId: string; name: string; orders: number; amountCents: number; cashCents: number }[];
  topItems: { name: string; quantity: number; amountCents: number }[];
  cashSessions: { id: string; label: string; staff: string; status: string; expectedCents: number | null; countedCents: number | null; varianceCents: number | null; varianceReason: string | null }[];
  cashMovements: { kind: string; count: number; amountCents: number }[];
  hours: { hour: number; orders: number; amountCents: number }[];
}

const n = (v: unknown): number => Number(v ?? 0);

/** Recettes : calculées à partir des tickets payés, avec les mêmes règles que le ticket client. */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  days(tenantId: string, establishmentId: string, limit = 60) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query(
        `SELECT d.id, d.business_date, d.status, d.opened_at, d.closed_at, d.z_number,
                COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid'), 0)::bigint AS total_cents,
                COUNT(o.id) FILTER (WHERE o.status = 'paid')::int AS orders
           FROM business_days d
           LEFT JOIN orders o ON o.business_day_id = d.id
          WHERE d.establishment_id = $1
          GROUP BY d.id
          ORDER BY d.opened_at DESC
          LIMIT $2`,
        [establishmentId, limit],
      );
      return rows.map((r) => ({ ...r, total_cents: n(r.total_cents) }));
    });
  }

  day(tenantId: string, dayId: string): Promise<DayReport> {
    return this.db.withTenant({ tenantId }, (c) => buildDayReport(c, dayId));
  }
}

export async function buildDayReport(c: PoolClient, dayId: string): Promise<DayReport> {
  const dayRow = (
    await c.query(
      `SELECT id, establishment_id, business_date::text AS business_date, status, opened_at, closed_at, z_number, opening_float_cents
         FROM business_days WHERE id = $1`,
      [dayId],
    )
  ).rows[0];
  if (!dayRow) throw new NotFoundException('Journée introuvable');

  const orderRows = (
    await c.query<{ id: string; status: string; discount_cents: string; total_cents: string; covers: number | null; waiter_id: string; waiter: string; opened_at: Date }>(
      `SELECT o.id, o.status, o.discount_cents, o.total_cents, o.covers, o.waiter_id, s.full_name AS waiter, o.opened_at
         FROM orders o JOIN staff s ON s.id = o.waiter_id
        WHERE o.business_day_id = $1`,
      [dayId],
    )
  ).rows;
  const paid = orderRows.filter((o) => o.status === 'paid');

  const lineRows = (
    await c.query<{
      id: string; order_id: string; parent_line_id: string | null; item_id: string; name: string; quantity: number;
      unit_price_cents: string; tax_rate_bp: number; discount_cents: string; status: OrderLine['status'];
      options: { name: string; extra_cents: string }[] | null;
    }>(
      `SELECT l.id, l.order_id, l.parent_line_id, l.item_id, l.name, l.quantity, l.unit_price_cents, l.tax_rate_bp,
              l.discount_cents, l.status,
              (SELECT json_agg(json_build_object('name', x.name, 'extra_cents', x.extra_cents))
                 FROM order_line_options x WHERE x.order_line_id = l.id) AS options
         FROM order_lines l JOIN orders o ON o.id = l.order_id
        WHERE o.business_day_id = $1 AND o.status = 'paid'`,
      [dayId],
    )
  ).rows;

  const linesByOrder = new Map<string, OrderLine[]>();
  const items = new Map<string, { name: string; quantity: number; amountCents: number }>();
  for (const r of lineRows) {
    const line: OrderLine = {
      id: r.id,
      parentLineId: r.parent_line_id,
      itemId: r.item_id,
      name: r.name,
      quantity: r.quantity,
      unitPriceCents: n(r.unit_price_cents),
      taxRateBp: r.tax_rate_bp,
      discountCents: n(r.discount_cents),
      status: r.status,
      options: (r.options ?? []).map((o) => ({ name: o.name, extraCents: n(o.extra_cents) })),
    };
    const list = linesByOrder.get(r.order_id) ?? [];
    list.push(line);
    linesByOrder.set(r.order_id, list);
    if (r.status !== 'voided' && !r.parent_line_id) {
      const it = items.get(r.item_id) ?? { name: r.name, quantity: 0, amountCents: 0 };
      it.quantity += r.quantity;
      it.amountCents += r.status === 'comp' ? 0 : r.quantity * n(r.unit_price_cents) - n(r.discount_cents);
      items.set(r.item_id, it);
    }
  }

  const taxes = new Map<number, { rateBp: number; htCents: number; tvaCents: number; ttcCents: number }>();
  const totals = { ttcCents: 0, htCents: 0, tvaCents: 0, discountCents: 0, compCents: 0, voidedCents: 0, averageTicketCents: 0 };
  for (const o of paid) {
    const t = orderTotals(linesByOrder.get(o.id) ?? [], n(o.discount_cents));
    totals.ttcCents += t.totalCents;
    totals.discountCents += t.orderDiscountCents;
    totals.compCents += t.compCents;
    totals.voidedCents += t.voidedCents;
    for (const row of t.taxes) {
      const agg = taxes.get(row.rateBp) ?? { rateBp: row.rateBp, htCents: 0, tvaCents: 0, ttcCents: 0 };
      agg.htCents += row.ht;
      agg.tvaCents += row.tva;
      agg.ttcCents += row.ttc;
      taxes.set(row.rateBp, agg);
    }
  }
  for (const t of taxes.values()) {
    totals.htCents += t.htCents;
    totals.tvaCents += t.tvaCents;
  }
  totals.averageTicketCents = paid.length ? Math.round(totals.ttcCents / paid.length) : 0;

  const payments = (
    await c.query(
      `SELECT m.label AS method, m.kind, COUNT(*)::int AS count, SUM(p.amount_cents)::bigint AS amount
         FROM payments p JOIN payment_methods m ON m.id = p.payment_method_id
         JOIN orders o ON o.id = p.order_id
        WHERE o.business_day_id = $1 AND o.status = 'paid'
        GROUP BY m.id ORDER BY m.sort`,
      [dayId],
    )
  ).rows.map((r) => ({ method: r.method, kind: r.kind, count: r.count, amountCents: n(r.amount) }));

  const cashByWaiter = new Map<string, number>(
    (
      await c.query(
        `SELECT o.waiter_id, SUM(p.amount_cents)::bigint AS cash
           FROM payments p JOIN payment_methods m ON m.id = p.payment_method_id AND m.kind = 'cash'
           JOIN orders o ON o.id = p.order_id
          WHERE o.business_day_id = $1 AND o.status = 'paid'
          GROUP BY o.waiter_id`,
        [dayId],
      )
    ).rows.map((r) => [r.waiter_id as string, n(r.cash)]),
  );
  const waiters = new Map<string, DayReport['waiters'][number]>();
  for (const o of paid) {
    const w = waiters.get(o.waiter_id) ?? { staffId: o.waiter_id, name: o.waiter, orders: 0, amountCents: 0, cashCents: cashByWaiter.get(o.waiter_id) ?? 0 };
    w.orders += 1;
    w.amountCents += n(o.total_cents);
    waiters.set(o.waiter_id, w);
  }

  const hours = new Map<number, { hour: number; orders: number; amountCents: number }>();
  const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Casablanca' });
  for (const o of paid) {
    const hour = Number(hourFmt.formatToParts(o.opened_at).find((p) => p.type === 'hour')?.value ?? 0);
    const h = hours.get(hour) ?? { hour, orders: 0, amountCents: 0 };
    h.orders += 1;
    h.amountCents += n(o.total_cents);
    hours.set(hour, h);
  }

  const cashSessions = (
    await c.query(
      `SELECT s.id, s.register_label, st.full_name, s.status, s.expected_cash_cents, s.counted_cash_cents, s.variance_cents, s.variance_reason
         FROM cash_sessions s JOIN staff st ON st.id = s.staff_id
        WHERE s.business_day_id = $1 ORDER BY s.opened_at`,
      [dayId],
    )
  ).rows.map((r) => ({
    id: r.id,
    label: r.register_label,
    staff: r.full_name,
    status: r.status,
    expectedCents: r.expected_cash_cents === null ? null : n(r.expected_cash_cents),
    countedCents: r.counted_cash_cents === null ? null : n(r.counted_cash_cents),
    varianceCents: r.variance_cents === null ? null : n(r.variance_cents),
    varianceReason: r.variance_reason,
  }));

  const cashMovements = (
    await c.query(
      `SELECT m.kind, COUNT(*)::int AS count, SUM(m.amount_cents)::bigint AS amount
         FROM cash_movements m JOIN cash_sessions s ON s.id = m.cash_session_id
        WHERE s.business_day_id = $1 GROUP BY m.kind`,
      [dayId],
    )
  ).rows.map((r) => ({ kind: r.kind, count: r.count, amountCents: n(r.amount) }));

  return {
    day: {
      id: dayRow.id,
      establishmentId: dayRow.establishment_id,
      businessDate: dayRow.business_date,
      status: dayRow.status,
      openedAt: dayRow.opened_at,
      closedAt: dayRow.closed_at,
      zNumber: dayRow.z_number,
      openingFloatCents: n(dayRow.opening_float_cents),
    },
    orders: {
      paid: paid.length,
      open: orderRows.filter((o) => o.status === 'open').length,
      voided: orderRows.filter((o) => o.status === 'voided').length,
      covers: paid.reduce((s, o) => s + (o.covers ?? 0), 0),
    },
    totals,
    taxes: [...taxes.values()].sort((a, b) => a.rateBp - b.rateBp),
    payments,
    waiters: [...waiters.values()].sort((a, b) => b.amountCents - a.amountCents),
    topItems: [...items.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 15),
    cashSessions,
    cashMovements,
    hours: [...hours.values()].sort((a, b) => a.hour - b.hour),
  };
}
