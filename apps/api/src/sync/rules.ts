import { OrderLine, orderTotals, WritableEntity } from '@caissebox/shared';
import { PoolClient } from 'pg';
import { rule, SyncRuleError } from './errors';

export interface RuleContext {
  c: PoolClient;
  tenantId: string;
  establishmentId: string;
  deviceId: string;
}

type Row = Record<string, unknown>;

async function one<T extends Row>(c: PoolClient, sql: string, params: unknown[]): Promise<T | undefined> {
  const { rows } = await c.query<T>(sql, params);
  return rows[0];
}

async function assertManager(ctx: RuleContext, staffId: unknown, what: string): Promise<void> {
  if (typeof staffId !== 'string') throw rule(`${what} : validation d'un manager obligatoire`);
  const row = await one<{ is_manager: boolean }>(
    ctx.c,
    'SELECT r.is_manager FROM staff s JOIN roles r ON r.id = s.role_id WHERE s.id = $1 AND s.active',
    [staffId],
  );
  if (!row?.is_manager) throw rule(`${what} : la personne qui valide n'est pas manager`);
}

async function openDay(ctx: RuleContext, dayId: unknown): Promise<void> {
  const day = await one<{ status: string }>(
    ctx.c,
    'SELECT status FROM business_days WHERE id = $1 AND establishment_id = $2',
    [dayId, ctx.establishmentId],
  );
  if (!day) throw new SyncRuleError('INVALID', 'Journée inconnue pour cet établissement');
  if (day.status !== 'open') throw rule('La journée est clôturée');
}

async function openOrder(ctx: RuleContext, orderId: unknown): Promise<{ id: string; status: string; discount_cents: string }> {
  const order = await one<{ id: string; status: string; discount_cents: string }>(
    ctx.c,
    'SELECT id, status, discount_cents FROM orders WHERE id = $1 AND establishment_id = $2',
    [orderId, ctx.establishmentId],
  );
  if (!order) throw new SyncRuleError('INVALID', 'Ticket inconnu pour cet établissement');
  if (order.status !== 'open') throw rule('Le ticket est déjà clos');
  return order;
}

async function openSession(ctx: RuleContext, sessionId: unknown): Promise<void> {
  const s = await one<{ status: string }>(
    ctx.c,
    'SELECT status FROM cash_sessions WHERE id = $1 AND establishment_id = $2',
    [sessionId, ctx.establishmentId],
  );
  if (!s) throw new SyncRuleError('INVALID', 'Session de caisse inconnue');
  if (s.status !== 'open') throw rule('La session de caisse est clôturée');
}

/** Total d'un ticket recalculé par le serveur à partir de ses lignes : la source de vérité. */
export async function computeOrderTotal(c: PoolClient, orderId: string, discountCents: number): Promise<number> {
  const { rows } = await c.query<{
    id: string;
    parent_line_id: string | null;
    item_id: string;
    name: string;
    quantity: number;
    unit_price_cents: string;
    tax_rate_bp: number;
    discount_cents: string;
    status: OrderLine['status'];
    options: { name: string; extra_cents: string }[] | null;
  }>(
    `SELECT l.id, l.parent_line_id, l.item_id, l.name, l.quantity, l.unit_price_cents, l.tax_rate_bp,
            l.discount_cents, l.status,
            (SELECT json_agg(json_build_object('name', o.name, 'extra_cents', o.extra_cents))
               FROM order_line_options o WHERE o.order_line_id = l.id) AS options
       FROM order_lines l WHERE l.order_id = $1`,
    [orderId],
  );
  const lines: OrderLine[] = rows.map((r) => ({
    id: r.id,
    parentLineId: r.parent_line_id,
    itemId: r.item_id,
    name: r.name,
    quantity: r.quantity,
    unitPriceCents: Number(r.unit_price_cents),
    taxRateBp: r.tax_rate_bp,
    discountCents: Number(r.discount_cents),
    status: r.status,
    options: (r.options ?? []).map((o) => ({ name: o.name, extraCents: Number(o.extra_cents) })),
  }));
  return orderTotals(lines, discountCents).totalCents;
}

async function paidSoFar(c: PoolClient, orderId: unknown): Promise<number> {
  const row = await one<{ s: string }>(c, 'SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE order_id = $1', [orderId]);
  return Number(row?.s ?? 0);
}

// Création --------------------------------------------------------------------

export async function beforeInsert(ctx: RuleContext, entity: WritableEntity, data: Row): Promise<void> {
  switch (entity) {
    case 'business_days': {
      const est = await one<{ access_state: string }>(ctx.c, 'SELECT access_state FROM establishments WHERE id = $1', [
        ctx.establishmentId,
      ]);
      if (est?.access_state === 'refuse_day_open') {
        throw rule('Ouverture de journée suspendue : contactez CaisseBox');
      }
      if (data.status !== undefined && data.status !== 'open') throw rule('Une journée se crée ouverte');
      await assertManager(ctx, data.opened_by, 'Ouverture de journée');
      return;
    }
    case 'cash_sessions':
      await openDay(ctx, data.business_day_id);
      if (data.status !== undefined && data.status !== 'open') throw rule('Une session se crée ouverte');
      return;
    case 'orders':
      await openDay(ctx, data.business_day_id);
      if (data.status !== undefined && data.status !== 'open') throw rule('Un ticket se crée ouvert');
      return;
    case 'order_lines': {
      await openOrder(ctx, data.order_id);
      const status = data.status ?? 'draft';
      if (status === 'voided') throw rule('Une ligne ne peut pas être créée annulée');
      if (status === 'comp') await assertManager(ctx, data.approved_by, 'Article offert');
      if (data.parent_line_id) {
        const parent = await one<{ order_id: string }>(ctx.c, 'SELECT order_id FROM order_lines WHERE id = $1', [data.parent_line_id]);
        if (parent?.order_id !== data.order_id) throw new SyncRuleError('INVALID', 'Composant de menu rattaché à un autre ticket');
      }
      return;
    }
    case 'order_line_options': {
      const line = await one<{ order_id: string }>(
        ctx.c,
        'SELECT order_id FROM order_lines WHERE id = $1 AND establishment_id = $2',
        [data.order_line_id, ctx.establishmentId],
      );
      if (!line) throw new SyncRuleError('INVALID', 'Ligne inconnue');
      await openOrder(ctx, line.order_id);
      return;
    }
    case 'payments': {
      const order = await openOrder(ctx, data.order_id);
      await openSession(ctx, data.cash_session_id);
      const method = await one<{ kind: string; active: boolean }>(ctx.c, 'SELECT kind, active FROM payment_methods WHERE id = $1', [
        data.payment_method_id,
      ]);
      if (!method?.active) throw rule('Mode de paiement inconnu ou désactivé');
      const total = await computeOrderTotal(ctx.c, order.id, Number(order.discount_cents));
      const remaining = total - (await paidSoFar(ctx.c, order.id));
      if (Number(data.amount_cents) > remaining) {
        throw rule(`Paiement supérieur au reste dû (${remaining} centimes)`);
      }
      if (method.kind !== 'cash' && Number(data.change_cents ?? 0) > 0) throw rule('Rendu de monnaie réservé aux espèces');
      if (method.kind === 'customer_credit') {
        const customer = await one<{ is_default: boolean }>(ctx.c, 'SELECT is_default FROM customers WHERE id = $1', [data.customer_id]);
        if (!customer || customer.is_default) throw rule('Le crédit client exige un client identifié (pas « Client divers »)');
      }
      return;
    }
    case 'customer_ledger':
      if (data.kind !== 'payment') {
        throw rule("La tablette n'enregistre que des règlements ; les dettes naissent des paiements à crédit");
      }
      if (!data.payment_method_id) throw rule('Mode de règlement obligatoire');
      return;
    case 'cash_movements':
      await openSession(ctx, data.cash_session_id);
      if (data.kind === 'no_sale') {
        if (Number(data.amount_cents) !== 0) throw rule("Une ouverture de tiroir n'a pas de montant");
        await assertManager(ctx, data.approved_by, 'Ouverture du tiroir sans vente');
      }
      if (data.kind === 'out' && !data.reason_code_id) throw rule('Motif obligatoire pour une sortie de caisse');
      return;
    case 'cash_counts':
      await openSession(ctx, data.cash_session_id);
      return;
    case 'kitchen_tickets': {
      const o = await one(ctx.c, 'SELECT 1 FROM orders WHERE id = $1 AND establishment_id = $2', [data.order_id, ctx.establishmentId]);
      if (!o) throw new SyncRuleError('INVALID', 'Ticket inconnu');
      return;
    }
    default:
      return;
  }
}

export async function afterInsert(ctx: RuleContext, entity: WritableEntity, row: Row): Promise<void> {
  if (entity === 'payments') {
    const method = await one<{ kind: string }>(ctx.c, 'SELECT kind FROM payment_methods WHERE id = $1', [row.payment_method_id]);
    if (method?.kind === 'customer_credit') {
      await ctx.c.query(
        `INSERT INTO customer_ledger (tenant_id, establishment_id, customer_id, kind, amount_cents, order_id, staff_id, note)
         VALUES ($1, $2, $3, 'charge', $4, $5, $6, 'Paiement à crédit')`,
        [ctx.tenantId, ctx.establishmentId, row.customer_id, row.amount_cents, row.order_id, row.staff_id],
      );
    }
  }
}

// Modification ----------------------------------------------------------------

const LINE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ['draft', 'sent', 'voided', 'comp'],
  sent: ['sent', 'voided', 'comp'],
  voided: ['voided'],
  comp: ['comp'],
};

export async function beforePatch(ctx: RuleContext, entity: WritableEntity, current: Row, data: Row): Promise<void> {
  switch (entity) {
    case 'business_days': {
      if (data.status !== 'closed') throw rule('Une journée ne peut que se clôturer');
      await assertManager(ctx, data.closed_by, 'Clôture de journée');
      const open = await one<{ n: string }>(
        ctx.c,
        "SELECT count(*) AS n FROM orders WHERE business_day_id = $1 AND status = 'open'",
        [current.id],
      );
      if (Number(open?.n) > 0) throw rule(`${open?.n} ticket(s) encore ouvert(s)`);
      const sessions = await one<{ n: string }>(
        ctx.c,
        "SELECT count(*) AS n FROM cash_sessions WHERE business_day_id = $1 AND status = 'open'",
        [current.id],
      );
      if (Number(sessions?.n) > 0) throw rule(`${sessions?.n} session(s) de caisse encore ouverte(s)`);
      const z = await one<{ next: number }>(
        ctx.c,
        'SELECT COALESCE(MAX(z_number), 0) + 1 AS next FROM business_days WHERE establishment_id = $1',
        [ctx.establishmentId],
      );
      if (Number(data.z_number) !== Number(z?.next)) throw rule(`Numéro de Z attendu : ${z?.next}`);
      data.closed_at ??= new Date().toISOString();
      return;
    }
    case 'cash_sessions': {
      if (current.status !== 'open') throw rule('Session déjà clôturée');
      if (data.status !== undefined && data.status !== 'closed') throw rule('Une session ne peut que se clôturer');
      if (data.status === 'closed') {
        const f = await one<{ cash: string; cash_in: string; cash_out: string; handover: string }>(
          ctx.c,
          `SELECT
             COALESCE((SELECT SUM(p.amount_cents) FROM payments p JOIN payment_methods m ON m.id = p.payment_method_id
                        WHERE p.cash_session_id = $1 AND m.kind = 'cash'), 0) AS cash,
             COALESCE((SELECT SUM(amount_cents) FROM cash_movements WHERE cash_session_id = $1 AND kind = 'in'), 0) AS cash_in,
             COALESCE((SELECT SUM(amount_cents) FROM cash_movements WHERE cash_session_id = $1 AND kind = 'out'), 0) AS cash_out,
             COALESCE((SELECT SUM(amount_cents) FROM cash_movements WHERE cash_session_id = $1 AND kind = 'waiter_handover'), 0) AS handover`,
          [current.id],
        );
        const expected =
          Number(current.opening_float_cents) + Number(f?.cash) + Number(f?.cash_in) + Number(f?.handover) - Number(f?.cash_out);
        if (data.counted_cash_cents === undefined || data.counted_cash_cents === null) throw rule('Comptage obligatoire pour clôturer');
        const variance = Number(data.counted_cash_cents) - expected;
        if (variance !== 0 && !data.variance_reason) throw rule("Motif obligatoire en cas d'écart de caisse");
        if (data.expected_cash_cents !== undefined && Number(data.expected_cash_cents) !== expected) {
          // La tablette a calculé hors ligne sans certains paiements : le serveur fait foi, et on le trace.
          await ctx.c.query(
            `INSERT INTO audit_log (tenant_id, establishment_id, action, entity, entity_id, details, device_id)
             VALUES ($1, $2, 'cash_session.expected_corrected', 'cash_sessions', $3, $4, $5)`,
            [ctx.tenantId, ctx.establishmentId, current.id, { tablet: Number(data.expected_cash_cents), server: expected }, ctx.deviceId],
          );
        }
        data.expected_cash_cents = expected;
        data.variance_cents = variance;
        data.closed_at ??= new Date().toISOString();
      }
      return;
    }
    case 'orders': {
      if (data.status === 'paid') {
        const discount = Number(data.discount_cents ?? current.discount_cents);
        const total = await computeOrderTotal(ctx.c, String(current.id), discount);
        const paid = await paidSoFar(ctx.c, current.id);
        if (paid !== total) throw rule(`Paiements (${paid}) différents du total recalculé (${total})`);
        data.total_cents = total;
        data.closed_at ??= new Date().toISOString();
      } else if (data.status === 'voided') {
        if ((await paidSoFar(ctx.c, current.id)) > 0) throw rule('Un ticket avec des paiements ne peut pas être annulé');
        data.closed_at ??= new Date().toISOString();
      } else if (data.status !== undefined && data.status !== 'open') {
        throw rule('Statut de ticket invalide');
      }
      return;
    }
    case 'order_lines': {
      await openOrder(ctx, current.order_id);
      const from = String(current.status);
      const to = String(data.status ?? from);
      if (!LINE_TRANSITIONS[from]?.includes(to)) throw rule(`Passage ${from} → ${to} interdit`);
      if (data.quantity !== undefined && Number(data.quantity) !== Number(current.quantity) && from !== 'draft') {
        throw rule('La quantité ne se modifie plus après envoi en préparation');
      }
      if (to === 'voided' && from === 'sent') {
        await assertManager(ctx, data.approved_by, 'Annulation après envoi');
        if (!data.void_reason_code_id) throw rule("Motif obligatoire pour l'annulation");
      }
      if (to === 'comp' && from !== 'comp') await assertManager(ctx, data.approved_by, 'Article offert');
      if (to === 'voided' && from !== 'voided') data.voided_at ??= new Date().toISOString();
      if (to === 'sent' && from === 'draft') data.sent_at ??= new Date().toISOString();
      if (data.order_id !== undefined && data.order_id !== current.order_id) await openOrder(ctx, data.order_id);
      return;
    }
    default:
      return;
  }
}

export async function afterPatch(ctx: RuleContext, entity: WritableEntity, before: Row, after: Row): Promise<void> {
  if (entity === 'orders' && before.status === 'open' && after.status === 'paid') {
    // Décompte du stock : article unitaire ou fiche technique, lignes non annulées.
    await ctx.c.query(
      `INSERT INTO stock_movements (tenant_id, establishment_id, stock_item_id, quantity, kind, source_id)
       SELECT $1, $2, r.stock_item_id, -(r.quantity * l.quantity), 'sale', l.id
         FROM order_lines l
         JOIN items i ON i.id = l.item_id AND i.stock_mode <> 'none'
         JOIN recipes r ON r.item_id = l.item_id
         JOIN stock_items s ON s.id = r.stock_item_id AND s.establishment_id = $2
        WHERE l.order_id = $3 AND l.status <> 'voided'`,
      [ctx.tenantId, ctx.establishmentId, after.id],
    );
  }
}
