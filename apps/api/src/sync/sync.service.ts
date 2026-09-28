import { Injectable } from '@nestjs/common';
import {
  Change,
  MAX_CHANGES_PER_PULL,
  OpResult,
  PullResponse,
  PushResponse,
  SyncOp,
  WRITE_RULES,
  WritableEntity,
} from '@caissebox/shared';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { classifyError, isTransient, SyncRuleError } from './errors';
import { afterInsert, afterPatch, beforeInsert, beforePatch, RuleContext } from './rules';

export interface DeviceScope {
  tenantId: string;
  establishmentId: string;
  deviceId: string;
}

type Row = Record<string, unknown>;

/** Tables qui portent une colonne device_id renseignée par le serveur. */
const DEVICE_STAMPED: ReadonlySet<WritableEntity> = new Set(['orders', 'audit_log']);

/** Données de référence descendues entièrement lors d'un instantané. */
const REFERENCE_TABLES = [
  'tenants', 'establishments', 'roles', 'staff', 'staff_establishments', 'tax_rates', 'payment_methods',
  'reason_codes', 'printers', 'families', 'items', 'establishment_item_overrides', 'option_groups', 'options',
  'item_option_groups', 'menu_steps', 'menu_step_choices', 'zones', 'dining_tables', 'customers', 'customer_ledger',
] as const;

/** Tables de la journée : seules celles des journées encore ouvertes descendent. */
const DAY_TABLES: Record<string, string> = {
  business_days: 'SELECT * FROM business_days WHERE establishment_id = $1 AND status = \'open\'',
  cash_sessions: 'SELECT s.* FROM cash_sessions s JOIN business_days d ON d.id = s.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
  cash_movements: 'SELECT m.* FROM cash_movements m JOIN cash_sessions s ON s.id = m.cash_session_id JOIN business_days d ON d.id = s.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
  cash_counts: 'SELECT k.* FROM cash_counts k JOIN cash_sessions s ON s.id = k.cash_session_id JOIN business_days d ON d.id = s.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
  orders: 'SELECT o.* FROM orders o JOIN business_days d ON d.id = o.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
  order_lines: 'SELECT l.* FROM order_lines l JOIN orders o ON o.id = l.order_id JOIN business_days d ON d.id = o.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
  order_line_options: 'SELECT x.* FROM order_line_options x JOIN order_lines l ON l.id = x.order_line_id JOIN orders o ON o.id = l.order_id JOIN business_days d ON d.id = o.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
  payments: 'SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id JOIN business_days d ON d.id = o.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
  kitchen_tickets: 'SELECT t.* FROM kitchen_tickets t JOIN orders o ON o.id = t.order_id JOIN business_days d ON d.id = o.business_day_id WHERE d.establishment_id = $1 AND d.status = \'open\'',
};

export interface SnapshotResponse {
  cursor: number;
  tables: Record<string, Row[]>;
}

@Injectable()
export class SyncService {
  constructor(private readonly db: DbService) {}

  /**
   * Applique un lot d'opérations d'une tablette. Chaque opération est isolée
   * dans un SAVEPOINT : un rejet n'annule pas les autres. Une opération rejetée
   * est consommée (la tablette l'affiche mais ne la renvoie pas), sinon une
   * seule erreur bloquerait toute la boîte d'envoi.
   */
  async push(scope: DeviceScope, ops: SyncOp[]): Promise<PushResponse> {
    return this.db.withTenant({ tenantId: scope.tenantId, deviceId: scope.deviceId }, async (c) => {
      await c.query(
        `INSERT INTO device_sync_state (device_id, tenant_id) VALUES ($1, $2) ON CONFLICT (device_id) DO NOTHING`,
        [scope.deviceId, scope.tenantId],
      );
      const { rows } = await c.query<{ last_device_seq: string }>(
        'SELECT last_device_seq FROM device_sync_state WHERE device_id = $1 FOR UPDATE',
        [scope.deviceId],
      );
      let last = Number(rows[0]?.last_device_seq ?? 0);
      const ctx: RuleContext = { c, ...scope };
      const results: OpResult[] = [];
      const sorted = [...ops].sort((a, b) => a.deviceSeq - b.deviceSeq);
      let gap = false;

      for (const op of sorted) {
        const base = { opId: op.opId, deviceSeq: op.deviceSeq };
        const existing = await c.query<{ device_id: string; device_seq: string }>(
          'SELECT device_id, device_seq FROM sync_ops WHERE op_id = $1',
          [op.opId],
        );
        const known = existing.rows[0];
        if (known) {
          if (known.device_id === scope.deviceId && Number(known.device_seq) === op.deviceSeq) {
            results.push({ ...base, status: 'duplicate' });
          } else {
            results.push({ ...base, status: 'rejected', code: 'CONFLICT', message: 'Identifiant d\'opération déjà utilisé' });
          }
          continue;
        }
        if (op.deviceSeq <= last) {
          results.push({ ...base, status: 'rejected', code: 'CONFLICT', message: 'Numéro de séquence déjà consommé' });
          continue;
        }
        if (gap || op.deviceSeq !== last + 1) {
          gap = true;
          results.push({ ...base, status: 'rejected', code: 'SEQUENCE_GAP', message: `Attendu ${last + 1}, reçu ${op.deviceSeq}` });
          continue;
        }

        await c.query('SAVEPOINT op');
        let result: OpResult;
        try {
          await this.apply(ctx, op);
          await c.query('RELEASE SAVEPOINT op');
          result = { ...base, status: 'applied' };
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT op');
          if (isTransient(error)) throw error;
          const { code, message } = classifyError(error);
          result = { ...base, status: 'rejected', code, message };
        }
        await c.query(
          `INSERT INTO sync_ops (op_id, tenant_id, device_id, device_seq, entity, entity_id, kind, result, error_code, error_message)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            op.opId, scope.tenantId, scope.deviceId, op.deviceSeq, op.entity, op.entityId, op.kind,
            result.status, result.code ?? null, result.message ?? null,
          ],
        );
        last = op.deviceSeq;
        results.push(result);
      }

      await c.query('UPDATE device_sync_state SET last_device_seq = $2, updated_at = now() WHERE device_id = $1', [
        scope.deviceId,
        last,
      ]);
      return { results, lastDeviceSeq: last };
    });
  }

  private async apply(ctx: RuleContext, op: SyncOp): Promise<void> {
    const writeRule = WRITE_RULES[op.entity];
    if (!writeRule) throw new SyncRuleError('UNKNOWN_ENTITY', `Entité ${op.entity} non synchronisable`);
    const allowed = op.kind === 'insert' ? writeRule.insert : writeRule.patch;
    for (const column of Object.keys(op.data)) {
      if (!allowed.includes(column)) {
        throw new SyncRuleError('FORBIDDEN_COLUMN', `${op.entity}.${column} : colonne non modifiable en ${op.kind}`);
      }
    }
    if ('id' in op.data && op.data.id !== op.entityId) {
      throw new SyncRuleError('INVALID', 'data.id différent de entityId');
    }
    const table = op.entity; // Nom validé par l'énumération WRITABLE_ENTITIES.

    if (op.kind === 'insert') {
      const data: Row = { ...op.data, id: op.entityId, tenant_id: ctx.tenantId };
      if (writeRule.scopedToEstablishment) data.establishment_id = ctx.establishmentId;
      if (DEVICE_STAMPED.has(op.entity)) data.device_id = ctx.deviceId;
      await beforeInsert(ctx, op.entity, data);
      const columns = Object.keys(data);
      const sql = `INSERT INTO ${table} (${columns.map(quoteIdent).join(', ')})
                   VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})
                   ON CONFLICT (id) DO NOTHING RETURNING *`;
      const { rows } = await ctx.c.query<Row>(sql, columns.map((k) => toParam(data[k])));
      const row = rows[0];
      if (!row) throw new SyncRuleError('CONFLICT', `${table} ${op.entityId} existe déjà`);
      await afterInsert(ctx, op.entity, row);
      return;
    }

    if (Object.keys(op.data).length === 0) throw new SyncRuleError('INVALID', 'Modification vide');
    const scopeFilter = writeRule.scopedToEstablishment ? ' AND establishment_id = $2' : '';
    const params: unknown[] = [op.entityId];
    if (writeRule.scopedToEstablishment) params.push(ctx.establishmentId);
    const current = await ctx.c.query<Row>(`SELECT * FROM ${table} WHERE id = $1${scopeFilter} FOR UPDATE`, params);
    const before = current.rows[0];
    if (!before) throw new SyncRuleError('NOT_FOUND', `${table} ${op.entityId} introuvable`);

    const data: Row = { ...op.data };
    delete data.id;
    await beforePatch(ctx, op.entity, before, data);
    const columns = Object.keys(data);
    if (columns.length === 0) return;
    const sets = columns.map((k, i) => `${quoteIdent(k)} = $${i + 2}`).join(', ');
    const { rows } = await ctx.c.query<Row>(`UPDATE ${table} SET ${sets} WHERE id = $1 RETURNING *`, [
      op.entityId,
      ...columns.map((k) => toParam(data[k])),
    ]);
    const after = rows[0];
    if (!after) throw new SyncRuleError('NOT_FOUND', `${table} ${op.entityId} introuvable`);
    await afterPatch(ctx, op.entity, before, after);
  }

  /** Changements de l'établissement après le curseur de la tablette. */
  async pull(scope: DeviceScope, cursor: number, limit = MAX_CHANGES_PER_PULL): Promise<PullResponse> {
    const size = Math.min(Math.max(limit, 1), MAX_CHANGES_PER_PULL);
    return this.db.withTenant({ tenantId: scope.tenantId, deviceId: scope.deviceId }, async (c) => {
      const { rows } = await c.query<{ server_seq: string; entity: string; entity_id: string; op: 'upsert' | 'delete'; data: Row | null }>(
        `SELECT server_seq, entity, entity_id, op, data
           FROM change_log
          WHERE tenant_id = $1 AND server_seq > $2 AND (establishment_id IS NULL OR establishment_id = $3)
          ORDER BY server_seq
          LIMIT $4`,
        [scope.tenantId, cursor, scope.establishmentId, size + 1],
      );
      const hasMore = rows.length > size;
      const page = hasMore ? rows.slice(0, size) : rows;
      const changes: Change[] = page.map((r) => ({
        seq: Number(r.server_seq),
        entity: r.entity,
        entityId: r.entity_id,
        op: r.op,
        data: r.data,
      }));
      const nextCursor = changes.length ? changes[changes.length - 1]!.seq : cursor;
      await recordPulled(c, scope, nextCursor);
      return { changes, nextCursor, hasMore };
    });
  }

  /**
   * Instantané complet pour une tablette neuve ou réinitialisée, lu dans une
   * transaction REPEATABLE READ : les données et le curseur renvoyé sont
   * cohérents, la tablette enchaîne ensuite par des pull à partir de ce curseur.
   */
  async snapshot(scope: DeviceScope): Promise<SnapshotResponse> {
    return this.db.withTenant(
      { tenantId: scope.tenantId, deviceId: scope.deviceId },
      async (c) => {
        const seq = await c.query<{ cursor: string | null }>('SELECT max(server_seq) AS cursor FROM change_log WHERE tenant_id = $1', [
          scope.tenantId,
        ]);
        const cursor = Number(seq.rows[0]?.cursor ?? 0);
        const tables: Record<string, Row[]> = {};
        for (const table of REFERENCE_TABLES) {
          const scoped = await hasColumn(c, table, 'establishment_id');
          const sql =
            table === 'establishments'
              ? 'SELECT * FROM establishments WHERE id = $1'
              : scoped
                ? `SELECT * FROM ${table} WHERE establishment_id = $1`
                : `SELECT * FROM ${table}`;
          const { rows } = await c.query<Row>(sql, scoped || table === 'establishments' ? [scope.establishmentId] : []);
          tables[table] = rows;
        }
        for (const [table, sql] of Object.entries(DAY_TABLES)) {
          const { rows } = await c.query<Row>(sql, [scope.establishmentId]);
          tables[table] = rows;
        }
        await recordPulled(c, scope, cursor);
        return { cursor, tables };
      },
      { repeatableRead: true },
    );
  }
}

async function recordPulled(c: PoolClient, scope: DeviceScope, cursor: number): Promise<void> {
  await c.query(
    `INSERT INTO device_sync_state (device_id, tenant_id, last_pulled_seq) VALUES ($1, $2, $3)
     ON CONFLICT (device_id) DO UPDATE SET last_pulled_seq = GREATEST(device_sync_state.last_pulled_seq, $3), updated_at = now()`,
    [scope.deviceId, scope.tenantId, cursor],
  );
}

const columnCache = new Map<string, boolean>();
async function hasColumn(c: PoolClient, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = columnCache.get(key);
  if (cached !== undefined) return cached;
  const { rows } = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  columnCache.set(key, rows.length > 0);
  return rows.length > 0;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_]+$/.test(name)) throw new SyncRuleError('INVALID', `Nom de colonne invalide : ${name}`);
  return `"${name}"`;
}

/** Les objets et tableaux (jsonb, uuid[]) passent tels quels ; pg sérialise les tableaux. */
function toParam(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  return value;
}
