import type { WritableEntity } from '@caissebox/shared';
import { ApiError, DeviceApi } from './api';
import { num, OutboxOp, Row, Store } from './store';

export interface SyncStatus {
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface Rejection {
  entity: string;
  entityId: string;
  code: string;
  message: string;
}

const RETENTION_MS = 36 * 3600 * 1000;

/**
 * Moteur de synchronisation (protocole v1, voir docs/sync-protocol.md).
 *
 * 1. Montée : la boîte d'envoi part dans l'ordre, par lots. Les rejets métier sont
 *    consommés, affichés, et la ligne concernée est relue sur le serveur pour que
 *    la tablette ne garde pas une version refusée.
 * 2. Descente : les changements après le curseur sont appliqués, sauf sur les lignes
 *    qui ont encore des opérations locales en attente.
 */
export class SyncEngine {
  private _status: SyncStatus = { online: false, syncing: false, pending: 0, lastSyncAt: null, lastError: null };
  private listeners = new Set<(s: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: Store,
    private readonly api: DeviceApi,
    private readonly opts: {
      batchSize?: number;
      intervalMs?: number;
      now?: () => Date;
      onRejected?: (r: Rejection[]) => void;
      onAccessState?: (state: string) => void;
    } = {},
  ) {}

  get status(): SyncStatus {
    return this._status;
  }

  subscribe(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncStatus>): void {
    this._status = { ...this._status, ...patch };
    for (const fn of this.listeners) fn(this._status);
  }

  private get now(): Date {
    return (this.opts.now ?? (() => new Date()))();
  }

  /** Premier démarrage, ou réinitialisation : charge tout depuis le serveur. */
  async snapshot(): Promise<void> {
    const session = await this.api.authenticate();
    this.opts.onAccessState?.(session.accessState);
    const snap = await this.api.snapshot();
    await this.store.replaceAll(snap.tables);
    await this.store.renumber(snap.device.lastDeviceSeq + 1);
    await this.store.setMeta({
      cursor: snap.cursor,
      last_order_number: snap.device.lastOrderNumber,
      last_z: snap.device.lastZNumber,
      tenant_id: session.tenantId,
      establishment_id: session.establishmentId,
      access_state: session.accessState,
      register_label: session.label ?? this.store.meta('register_label') ?? 'Caisse 1',
      snapshot_at: this.now.toISOString(),
    });
    this.set({ online: true, lastSyncAt: this.now.toISOString(), lastError: null, pending: await this.store.outboxSize() });
  }

  /** Lance une synchronisation complète ; un appel pendant qu'une autre tourne la relance à la fin. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Demande une synchronisation rapide après une écriture locale. */
  nudge(delayMs = 400): void {
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => void this.sync(), delayMs);
  }

  start(): void {
    if (this.timer) return;
    void this.sync();
    this.timer = setInterval(() => void this.sync(), this.opts.intervalMs ?? 15000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.timer = null;
    this.nudgeTimer = null;
  }

  private async runOnce(): Promise<void> {
    this.set({ syncing: true });
    try {
      await this.push();
      await this.pull();
      await this.prune();
      this.set({ online: true, lastSyncAt: this.now.toISOString(), lastError: null });
    } catch (error) {
      const offline = !(error instanceof ApiError);
      this.set({ online: !offline, lastError: offline ? 'Hors ligne' : (error as Error).message });
    } finally {
      this.set({ syncing: false, pending: await this.store.outboxSize() });
    }
  }

  async push(): Promise<void> {
    const batch = this.opts.batchSize ?? 200;
    let renumbers = 0;
    for (;;) {
      const ops = await this.store.outbox(batch);
      if (!ops.length) return;
      const res = await this.api.push(ops.map((o) => ({ opId: o.opId, deviceSeq: o.seq, entity: o.entity, entityId: o.entityId, kind: o.kind, data: o.data, createdAt: o.createdAt })));
      const byId = new Map(ops.map((o) => [o.opId, o]));
      const done: OutboxOp[] = [];
      const rejected: { op: OutboxOp; code: string; message: string }[] = [];
      let resequence = false;
      for (const r of res.results) {
        const op = byId.get(r.opId);
        if (!op) continue;
        if (r.status === 'applied' || r.status === 'duplicate') done.push(op);
        else if (r.code === 'SEQUENCE_GAP' || r.code === 'SEQUENCE_STALE') resequence = true;
        else rejected.push({ op, code: r.code ?? 'INVALID', message: r.message ?? 'Refusé' });
      }
      await this.store.acknowledge(done, rejected);
      if (rejected.length) {
        await this.reconcile(rejected.map((r) => r.op));
        this.opts.onRejected?.(rejected.map((r) => ({ entity: r.op.entity, entityId: r.op.entityId, code: r.code, message: r.message })));
      }
      if (resequence) {
        if (++renumbers > 3) throw new ApiError(409, 'Séquence de synchronisation incohérente');
        await this.store.renumber(res.lastDeviceSeq + 1);
      } else if (!done.length && !rejected.length) {
        return;
      }
    }
  }

  /** Remplace les lignes refusées par leur version serveur (ou les supprime si elles n'existent pas). */
  private async reconcile(ops: OutboxOp[]): Promise<void> {
    const items = new Map<string, { entity: WritableEntity; id: string }>();
    for (const o of ops) if (!this.store.hasPending(o.entity, o.entityId)) items.set(`${o.entity}:${o.entityId}`, { entity: o.entity, id: o.entityId });
    if (!items.size) return;
    const { rows } = await this.api.fetchRows([...items.values()]);
    await this.store.applyRemote(
      rows.map((r) => ({ entity: r.entity, entityId: r.id, op: r.data ? 'upsert' : 'delete', data: r.data })),
      true,
    );
  }

  async pull(): Promise<void> {
    let cursor = this.store.metaNumber('cursor', 0);
    for (;;) {
      const page = await this.api.pull(cursor);
      if (page.changes.length) {
        await this.store.applyRemote(page.changes.map((c) => ({ entity: c.entity, entityId: c.entityId, op: c.op, data: c.data })));
        const meta: Record<string, string | number> = {};
        for (const c of page.changes) {
          if (c.entity === 'business_days' && c.data && c.data.status === 'closed') {
            meta.last_z = Math.max(this.store.metaNumber('last_z'), num(c.data.z_number));
          }
          if (c.entity === 'establishments' && c.data && c.entityId === this.store.meta('establishment_id')) {
            meta.access_state = String(c.data.access_state);
            this.opts.onAccessState?.(meta.access_state);
          }
        }
        await this.store.setMeta({ ...meta, cursor: page.nextCursor });
      } else if (page.nextCursor !== cursor) {
        await this.store.setMeta({ cursor: page.nextCursor });
      }
      cursor = page.nextCursor;
      if (!page.hasMore) return;
    }
  }

  /** Oublie localement les journées closes depuis plus de 36 h (le serveur garde tout). */
  async prune(): Promise<void> {
    const limit = this.now.getTime() - RETENTION_MS;
    const oldDays = new Set(
      this.store
        .where<Row>('business_days', (d) => d.status === 'closed' && !!d.closed_at && new Date(String(d.closed_at)).getTime() < limit)
        .map((d) => d.id),
    );
    if (!oldDays.size) return;
    const orders = this.store.where('orders', (o) => oldDays.has(String(o.business_day_id)));
    const orderIds = new Set(orders.map((o) => o.id));
    const lines = this.store.where('order_lines', (l) => orderIds.has(String(l.order_id)));
    const lineIds = new Set(lines.map((l) => l.id));
    const sessions = this.store.where('cash_sessions', (s) => oldDays.has(String(s.business_day_id)));
    const sessionIds = new Set(sessions.map((s) => s.id));
    const forget = [
      ...[...oldDays].map((id) => ({ entity: 'business_days', id })),
      ...orders.map((r) => ({ entity: 'orders', id: r.id })),
      ...lines.map((r) => ({ entity: 'order_lines', id: r.id })),
      ...this.store.where('order_line_options', (x) => lineIds.has(String(x.order_line_id))).map((r) => ({ entity: 'order_line_options', id: r.id })),
      ...this.store.where('payments', (p) => orderIds.has(String(p.order_id))).map((r) => ({ entity: 'payments', id: r.id })),
      ...this.store.where('kitchen_tickets', (k) => orderIds.has(String(k.order_id))).map((r) => ({ entity: 'kitchen_tickets', id: r.id })),
      ...sessions.map((r) => ({ entity: 'cash_sessions', id: r.id })),
      ...this.store.where('cash_movements', (m) => sessionIds.has(String(m.cash_session_id))).map((r) => ({ entity: 'cash_movements', id: r.id })),
      ...this.store.where('cash_counts', (m) => sessionIds.has(String(m.cash_session_id))).map((r) => ({ entity: 'cash_counts', id: r.id })),
    ].filter((i) => !this.store.hasPending(i.entity, i.id));
    await this.store.forget(forget);
  }
}
