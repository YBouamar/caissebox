import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DEFAULT_ROLES } from '@caissebox/shared';
import { PoolClient } from 'pg';
import { generateDeviceSecret, hashSecret } from '../auth/secrets';
import { DbService } from '../db/db.service';

export interface CreateTenantInput {
  name: string;
  legalName?: string;
  ice?: string;
  address?: string;
  owner: { email: string; fullName: string; password: string };
  establishment: { name: string; address?: string };
}

export type AccessState = 'normal' | 'warning_manager' | 'warning_all' | 'refuse_day_open';

const DEFAULT_PAYMENT_METHODS = [
  { label: 'Espèces', kind: 'cash' },
  { label: 'Carte bancaire', kind: 'card' },
  { label: 'Ardoise client', kind: 'customer_credit' },
  { label: 'Titre-restaurant', kind: 'meal_voucher' },
] as const;

const DEFAULT_REASONS = [
  { category: 'void', label: 'Erreur de saisie' },
  { category: 'void', label: 'Client parti' },
  { category: 'void', label: 'Produit indisponible' },
  { category: 'comp', label: 'Geste commercial' },
  { category: 'comp', label: 'Repas du personnel' },
  { category: 'discount', label: 'Client fidèle' },
  { category: 'cash_out', label: 'Achat fournisseur' },
  { category: 'cash_out', label: 'Avance au personnel' },
  { category: 'cash_variance', label: 'Erreur de rendu monnaie' },
] as const;

/** Console BACYBRAINS : création des clients, enrôlement et blocage des tablettes. */
@Injectable()
export class ConsoleService {
  constructor(private readonly db: DbService) {}

  async createTenant(input: CreateTenantInput): Promise<{ tenantId: string; establishmentId: string; ownerId: string }> {
    const passwordHash = await hashSecret(input.owner.password);
    return this.db.asPlatform(async (c) => {
      const exists = await c.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [input.owner.email]);
      if (exists.rowCount) throw new ConflictException('Un compte existe déjà avec cet e-mail');

      const tenant = await c.query<{ id: string }>(
        'INSERT INTO tenants (name, legal_name, ice, address) VALUES ($1, $2, $3, $4) RETURNING id',
        [input.name, input.legalName ?? null, input.ice ?? null, input.address ?? null],
      );
      const tenantId = tenant.rows[0]!.id;

      for (const role of DEFAULT_ROLES) {
        await c.query('INSERT INTO roles (tenant_id, name, is_manager, permissions) VALUES ($1, $2, $3, $4)', [
          tenantId, role.name, role.isManager, JSON.stringify(role.permissions),
        ]);
      }
      await c.query("INSERT INTO tax_rates (tenant_id, label, rate_bp, is_default) VALUES ($1, 'TVA 10 %', 1000, true)", [tenantId]);
      await c.query("INSERT INTO tax_rates (tenant_id, label, rate_bp) VALUES ($1, 'TVA 20 %', 2000)", [tenantId]);
      for (const [i, pm] of DEFAULT_PAYMENT_METHODS.entries()) {
        await c.query('INSERT INTO payment_methods (tenant_id, label, kind, sort) VALUES ($1, $2, $3, $4)', [tenantId, pm.label, pm.kind, i]);
      }
      for (const r of DEFAULT_REASONS) {
        await c.query('INSERT INTO reason_codes (tenant_id, category, label) VALUES ($1, $2, $3)', [tenantId, r.category, r.label]);
      }
      await c.query("INSERT INTO customers (tenant_id, full_name, is_default) VALUES ($1, 'Client divers', true)", [tenantId]);

      const owner = await c.query<{ id: string }>(
        "INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'owner') RETURNING id",
        [tenantId, input.owner.email, passwordHash, input.owner.fullName],
      );
      const establishmentId = await insertEstablishment(c, tenantId, input.establishment.name, input.establishment.address);
      return { tenantId, establishmentId, ownerId: owner.rows[0]!.id };
    });
  }

  async createEstablishment(tenantId: string, name: string, address?: string): Promise<{ establishmentId: string }> {
    return this.db.asPlatform(async (c) => {
      const t = await c.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
      if (!t.rowCount) throw new NotFoundException('Client introuvable');
      return { establishmentId: await insertEstablishment(c, tenantId, name, address) };
    });
  }

  async listTenants() {
    return this.db.asPlatform(async (c) => {
      const { rows } = await c.query(
        `SELECT t.id, t.name, t.status, t.created_at,
                count(DISTINCT e.id)::int AS establishments,
                count(DISTINCT d.id) FILTER (WHERE d.kind = 'tablet' AND d.status = 'deployed')::int AS tablets
           FROM tenants t
           LEFT JOIN establishments e ON e.tenant_id = t.id
           LEFT JOIN devices d ON d.tenant_id = t.id
          GROUP BY t.id
          ORDER BY t.name`,
      );
      return rows;
    });
  }

  /** Entrée d'un matériel dans le parc (statut stock). */
  async registerDevice(input: { kind: 'tablet' | 'printer' | 'drawer'; serial: string; model?: string; purchasePriceCents?: number }) {
    return this.db.asPlatform(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'INSERT INTO devices (kind, serial, model, purchase_price_cents, purchased_at) VALUES ($1, $2, $3, $4, current_date) RETURNING id',
        [input.kind, input.serial, input.model ?? null, input.purchasePriceCents ?? null],
      );
      return { deviceId: rows[0]!.id };
    });
  }

  /**
   * Affecte un matériel à un établissement. Pour une tablette, un nouveau secret
   * est généré et renvoyé une seule fois : il sert au premier démarrage (QR code).
   */
  async deployDevice(deviceId: string, establishmentId: string, label?: string): Promise<{ deviceId: string; secret?: string }> {
    return this.db.asPlatform(async (c) => {
      const est = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM establishments WHERE id = $1', [establishmentId]);
      const tenantId = est.rows[0]?.tenant_id;
      if (!tenantId) throw new NotFoundException('Établissement introuvable');
      const dev = await c.query<{ kind: string }>('SELECT kind FROM devices WHERE id = $1 FOR UPDATE', [deviceId]);
      const kind = dev.rows[0]?.kind;
      if (!kind) throw new NotFoundException('Matériel introuvable');
      const secret = kind === 'tablet' ? generateDeviceSecret() : undefined;
      await c.query(
        `UPDATE devices SET tenant_id = $2, establishment_id = $3, status = 'deployed', label = COALESCE($4, label), secret_hash = $5
          WHERE id = $1`,
        [deviceId, tenantId, establishmentId, label ?? null, secret ? await hashSecret(secret) : null],
      );
      if (kind === 'tablet') {
        await c.query(
          `INSERT INTO device_sync_state (device_id, tenant_id) VALUES ($1, $2)
           ON CONFLICT (device_id) DO UPDATE SET tenant_id = $2, last_pulled_seq = 0, updated_at = now()`,
          [deviceId, tenantId],
        );
      }
      return { deviceId, secret };
    });
  }

  /** Retrait d'une tablette (panne, perte) : son secret est effacé, elle ne se connecte plus. */
  async retireDevice(deviceId: string, status: 'repair' | 'lost' | 'retired' | 'stock') {
    return this.db.asPlatform(async (c) => {
      const { rowCount } = await c.query(
        `UPDATE devices SET status = $2, secret_hash = NULL,
                tenant_id = CASE WHEN $2 = 'stock' THEN NULL ELSE tenant_id END,
                establishment_id = CASE WHEN $2 = 'stock' THEN NULL ELSE establishment_id END
          WHERE id = $1`,
        [deviceId, status],
      );
      if (!rowCount) throw new NotFoundException('Matériel introuvable');
      return { deviceId, status };
    });
  }

  /** Blocage progressif pour impayé ; la tablette le reçoit par la synchronisation. */
  async setAccessState(establishmentId: string, state: AccessState) {
    return this.db.asPlatform(async (c) => {
      const { rowCount } = await c.query('UPDATE establishments SET access_state = $2 WHERE id = $1', [establishmentId, state]);
      if (!rowCount) throw new NotFoundException('Établissement introuvable');
      return { establishmentId, accessState: state };
    });
  }
}

async function insertEstablishment(c: PoolClient, tenantId: string, name: string, address?: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    'INSERT INTO establishments (tenant_id, name, address) VALUES ($1, $2, $3) RETURNING id',
    [tenantId, name, address ?? null],
  );
  const id = rows[0]!.id;
  await c.query("INSERT INTO zones (tenant_id, establishment_id, name) VALUES ($1, $2, 'Salle')", [tenantId, id]);
  return id;
}
