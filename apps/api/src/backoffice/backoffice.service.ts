import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { hashPin, PERMISSIONS, verifyPin } from '@caissebox/shared';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { buildDayReport } from './reports.service';

export interface UpdateStaffInput {
  fullName?: string;
  initials?: string;
  roleId?: string;
  active?: boolean;
  establishmentIds?: string[];
}

export interface EstablishmentSettings {
  name?: string;
  address?: string | null;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  service_mode?: 'counter' | 'waiter_pays' | 'both';
  kitchen_send_mode?: 'manual' | 'auto';
}

export interface CreateStaffInput {
  fullName: string;
  initials?: string;
  roleId: string;
  pin: string;
  establishmentIds: string[];
}

/** Back-office du client (propriétaire) : toutes les requêtes passent par la RLS. */
@Injectable()
export class BackofficeService {
  constructor(private readonly db: DbService) {}

  establishments(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query('SELECT id, name, address, receipt_header, receipt_footer, service_mode, kitchen_send_mode, access_state FROM establishments ORDER BY name');
      return rows;
    });
  }

  roles(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query('SELECT id, name, is_manager, permissions FROM roles ORDER BY is_manager DESC, name');
      return rows;
    });
  }

  staff(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query(
        `SELECT s.id, s.full_name, s.initials, s.active, r.name AS role,
                coalesce(array_agg(se.establishment_id) FILTER (WHERE se.id IS NOT NULL), '{}') AS establishment_ids
           FROM staff s
           JOIN roles r ON r.id = s.role_id
           LEFT JOIN staff_establishments se ON se.staff_id = s.id
          GROUP BY s.id, r.name
          ORDER BY s.full_name`,
      );
      return rows;
    });
  }

  /**
   * Création d'un membre du personnel. Le PIN doit être unique parmi le
   * personnel actif du client : sur la tablette, le PIN seul identifie la personne.
   */
  async createStaff(tenantId: string, input: CreateStaffInput): Promise<{ staffId: string }> {
    return this.db.withTenant({ tenantId }, async (c) => {
      const role = await c.query('SELECT 1 FROM roles WHERE id = $1', [input.roleId]);
      if (!role.rowCount) throw new NotFoundException('Rôle introuvable');
      const est = await c.query('SELECT id FROM establishments WHERE id = ANY($1::uuid[])', [input.establishmentIds]);
      if (est.rowCount !== new Set(input.establishmentIds).size) throw new NotFoundException('Établissement introuvable');

      await assertPinFree(c, input.pin);

      const initials = input.initials ?? initialsOf(input.fullName);
      const { rows } = await c.query<{ id: string }>(
        'INSERT INTO staff (tenant_id, role_id, full_name, initials, pin_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [tenantId, input.roleId, input.fullName, initials, hashPin(input.pin)],
      );
      const staffId = rows[0]!.id;
      for (const establishmentId of new Set(input.establishmentIds)) {
        await c.query('INSERT INTO staff_establishments (tenant_id, staff_id, establishment_id) VALUES ($1, $2, $3)', [
          tenantId, staffId, establishmentId,
        ]);
      }
      return { staffId };
    });
  }

  async updateStaff(tenantId: string, staffId: string, input: UpdateStaffInput) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const cur = await c.query('SELECT 1 FROM staff WHERE id = $1 FOR UPDATE', [staffId]);
      if (!cur.rowCount) throw new NotFoundException('Personne introuvable');
      if (input.roleId) {
        const role = await c.query('SELECT 1 FROM roles WHERE id = $1', [input.roleId]);
        if (!role.rowCount) throw new NotFoundException('Rôle introuvable');
      }
      const sets: string[] = [];
      const params: unknown[] = [staffId];
      const add = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.fullName !== undefined) add('full_name', input.fullName);
      if (input.initials !== undefined) add('initials', input.initials.toUpperCase());
      if (input.roleId !== undefined) add('role_id', input.roleId);
      if (input.active !== undefined) add('active', input.active);
      if (sets.length) await c.query(`UPDATE staff SET ${sets.join(', ')} WHERE id = $1`, params);
      if (input.establishmentIds) {
        const ids = [...new Set(input.establishmentIds)];
        const est = await c.query('SELECT id FROM establishments WHERE id = ANY($1::uuid[])', [ids]);
        if (est.rowCount !== ids.length) throw new NotFoundException('Établissement introuvable');
        await c.query('DELETE FROM staff_establishments WHERE staff_id = $1 AND NOT (establishment_id = ANY($2::uuid[]))', [staffId, ids]);
        for (const id of ids) {
          await c.query(
            'INSERT INTO staff_establishments (tenant_id, staff_id, establishment_id) VALUES ($1, $2, $3) ON CONFLICT (staff_id, establishment_id) DO NOTHING',
            [tenantId, staffId, id],
          );
        }
      }
      return { staffId };
    });
  }

  async setPin(tenantId: string, staffId: string, pin: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      await assertPinFree(c, pin, staffId);
      const { rowCount } = await c.query('UPDATE staff SET pin_hash = $2, pin_reset_required = false WHERE id = $1', [staffId, hashPin(pin)]);
      if (!rowCount) throw new NotFoundException('Personne introuvable');
      return { staffId };
    });
  }

  async updateRole(tenantId: string, roleId: string, permissions: Record<string, unknown>) {
    for (const [k, v] of Object.entries(permissions)) {
      if (k === 'order.discount_max_bp') {
        if (typeof v !== 'number' || v < 0 || v > 10000) throw new BadRequestException('Remise maximale invalide');
      } else if (!(k in PERMISSIONS) || typeof v !== 'boolean') {
        throw new BadRequestException(`Droit inconnu : ${k}`);
      }
    }
    return this.db.withTenant({ tenantId }, async (c) => {
      const role = await c.query<{ is_manager: boolean }>('SELECT is_manager FROM roles WHERE id = $1 FOR UPDATE', [roleId]);
      if (!role.rows[0]) throw new NotFoundException('Rôle introuvable');
      if (role.rows[0].is_manager) throw new BadRequestException('Le rôle Manager garde tous les droits');
      const { rows } = await c.query('UPDATE roles SET permissions = permissions || $2::jsonb WHERE id = $1 RETURNING id, name, is_manager, permissions', [
        roleId,
        JSON.stringify(permissions),
      ]);
      return rows[0];
    });
  }

  async updateEstablishment(tenantId: string, establishmentId: string, input: EstablishmentSettings) {
    const cols = Object.keys(input);
    if (!cols.length) throw new BadRequestException('Aucune modification');
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query(
        `UPDATE establishments SET ${cols.map((k, i) => `"${k}" = $${i + 2}`).join(', ')} WHERE id = $1
         RETURNING id, name, address, receipt_header, receipt_footer, service_mode, kitchen_send_mode, access_state`,
        [establishmentId, ...cols.map((k) => (input as Record<string, unknown>)[k])],
      );
      if (!rows[0]) throw new NotFoundException('Établissement introuvable');
      return rows[0];
    });
  }

  /** Tableau de bord : journée en cours (ou dernière journée) et 14 derniers jours. */
  dashboard(tenantId: string, establishmentId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const est = await c.query('SELECT id FROM establishments WHERE id = $1', [establishmentId]);
      if (!est.rowCount) throw new NotFoundException('Établissement introuvable');
      const last = await c.query<{ id: string }>(
        'SELECT id FROM business_days WHERE establishment_id = $1 ORDER BY opened_at DESC LIMIT 1',
        [establishmentId],
      );
      const current = last.rows[0] ? await buildDayReport(c, last.rows[0].id) : null;
      const trend = await c.query<{ business_date: string; total: string; orders: number }>(
        `SELECT d.business_date::text AS business_date,
                COALESCE(SUM(o.total_cents) FILTER (WHERE o.status = 'paid'), 0)::bigint AS total,
                COUNT(o.id) FILTER (WHERE o.status = 'paid')::int AS orders
           FROM business_days d LEFT JOIN orders o ON o.business_day_id = d.id
          WHERE d.establishment_id = $1 AND d.business_date > current_date - 14
          GROUP BY d.business_date ORDER BY d.business_date`,
        [establishmentId],
      );
      const devices = await c.query(
        `SELECT id, label, model, app_version, last_seen_at FROM devices WHERE establishment_id = $1 AND kind = 'tablet' AND status = 'deployed' ORDER BY label`,
        [establishmentId],
      );
      return {
        current,
        trend: trend.rows.map((r) => ({ date: r.business_date, totalCents: Number(r.total), orders: r.orders })),
        tablets: devices.rows,
      };
    });
  }

  customers(tenantId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query(
        `SELECT cu.id, cu.full_name, cu.phone, cu.company, cu.ice, cu.credit_limit_cents, cu.is_default, cu.archived,
                COALESCE(SUM(l.amount_cents), 0)::bigint AS balance_cents,
                MAX(l.created_at) AS last_move_at
           FROM customers cu LEFT JOIN customer_ledger l ON l.customer_id = cu.id
          GROUP BY cu.id
          ORDER BY cu.is_default DESC, cu.full_name`,
      );
      return rows.map((r) => ({ ...r, balance_cents: Number(r.balance_cents), credit_limit_cents: Number(r.credit_limit_cents) }));
    });
  }

  ledger(tenantId: string, customerId: string) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const { rows } = await c.query(
        `SELECT l.id, l.kind, l.amount_cents, l.note, l.created_at, o.number AS order_number, m.label AS method, s.full_name AS staff
           FROM customer_ledger l
           LEFT JOIN orders o ON o.id = l.order_id
           LEFT JOIN payment_methods m ON m.id = l.payment_method_id
           LEFT JOIN staff s ON s.id = l.staff_id
          WHERE l.customer_id = $1
          ORDER BY l.created_at DESC
          LIMIT 200`,
        [customerId],
      );
      return rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
    });
  }

  /** Règlement d'une ardoise saisi au back-office (hors caisse). */
  settle(tenantId: string, customerId: string, input: { amountCents: number; paymentMethodId: string; note?: string }) {
    return this.db.withTenant({ tenantId }, async (c) => {
      const cu = await c.query<{ is_default: boolean }>('SELECT is_default FROM customers WHERE id = $1', [customerId]);
      if (!cu.rows[0]) throw new NotFoundException('Client introuvable');
      if (cu.rows[0].is_default) throw new BadRequestException('« Client divers » n’a pas d’ardoise');
      const pm = await c.query<{ kind: string }>('SELECT kind FROM payment_methods WHERE id = $1 AND active', [input.paymentMethodId]);
      if (!pm.rows[0] || pm.rows[0].kind === 'customer_credit') throw new BadRequestException('Mode de règlement invalide');
      const bal = await c.query<{ b: string }>('SELECT COALESCE(SUM(amount_cents), 0) AS b FROM customer_ledger WHERE customer_id = $1', [customerId]);
      if (input.amountCents > Number(bal.rows[0]?.b ?? 0)) throw new BadRequestException('Le règlement dépasse le solde dû');
      const { rows } = await c.query(
        `INSERT INTO customer_ledger (tenant_id, customer_id, kind, amount_cents, payment_method_id, note)
         VALUES ($1, $2, 'payment', $3, $4, $5) RETURNING id`,
        [tenantId, customerId, -input.amountCents, input.paymentMethodId, input.note ?? 'Règlement saisi au back-office'],
      );
      return rows[0];
    });
  }

  me(tenantId: string, userId: string) {
    return this.db.asPlatform(async (c) => {
      const { rows } = await c.query(
        `SELECT u.full_name, u.email, t.id AS tenant_id, t.name AS tenant_name, t.status
           FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1 AND u.tenant_id = $2`,
        [userId, tenantId],
      );
      if (!rows[0]) throw new NotFoundException('Compte introuvable');
      return rows[0];
    });
  }
}

async function assertPinFree(c: PoolClient, pin: string, exceptStaffId?: string): Promise<void> {
  const existing = await c.query<{ id: string; pin_hash: string | null }>('SELECT id, pin_hash FROM staff WHERE active');
  if (existing.rows.some((r) => r.id !== exceptStaffId && verifyPin(pin, r.pin_hash))) {
    throw new ConflictException('Ce code PIN est déjà utilisé par une autre personne');
  }
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
