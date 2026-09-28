import type { WritableEntity } from '@caissebox/shared';
import type { Sql, SqlTx } from './sql';

export type Row = Record<string, unknown> & { id: string };

export interface LocalOp {
  entity: WritableEntity;
  kind: 'insert' | 'patch';
  id: string;
  data: Record<string, unknown>;
}

export interface RemoteChange {
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  data: Record<string, unknown> | null;
}

export interface OutboxOp {
  seq: number;
  opId: string;
  entity: WritableEntity;
  entityId: string;
  kind: 'insert' | 'patch';
  data: Record<string, unknown>;
  createdAt: string;
}

const key = (entity: string, id: string) => `${entity}\u0000${id}`;

/**
 * Données locales de la tablette.
 *
 * Toutes les lignes utiles (catalogue, salle, personnel, journée en cours) sont
 * gardées en mémoire et recopiées dans SQLite. Une écriture locale met à jour la
 * ligne et ajoute l'opération à la boîte d'envoi dans la même transaction : un
 * redémarrage ou une coupure ne peut jamais perdre l'une sans l'autre.
 */
export class Store {
  private tables = new Map<string, Map<string, Row>>();
  private metaCache = new Map<string, string>();
  private pending = new Map<string, number>();
  private listeners = new Set<() => void>();
  private _version = 0;
  private lock: Promise<unknown> = Promise.resolve();

  /**
   * Les écritures sont sérialisées : chacune part de l'état mémoire laissé par la
   * précédente (pas de mise à jour perdue, numéros de séquence jamais en double).
   */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.lock.then(task, task);
    this.lock = next.catch(() => undefined);
    return next;
  }

  constructor(
    private readonly sql: Sql,
    private readonly uuid: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get version(): number {
    return this._version;
  }

  async load(): Promise<void> {
    this.tables.clear();
    this.metaCache.clear();
    this.pending.clear();
    for (const r of await this.sql.all<{ entity: string; id: string; data: string }>('SELECT entity, id, data FROM records')) {
      this.table(r.entity).set(r.id, JSON.parse(r.data) as Row);
    }
    for (const m of await this.sql.all<{ key: string; value: string }>('SELECT key, value FROM meta')) this.metaCache.set(m.key, m.value);
    for (const o of await this.sql.all<{ entity: string; entity_id: string }>('SELECT entity, entity_id FROM outbox')) {
      this.bumpPending(o.entity, o.entity_id, 1);
    }
    this.notify();
  }

  // Lecture ------------------------------------------------------------------

  private table(entity: string): Map<string, Row> {
    let t = this.tables.get(entity);
    if (!t) {
      t = new Map();
      this.tables.set(entity, t);
    }
    return t;
  }

  get<T extends Row = Row>(entity: string, id: string | null | undefined): T | undefined {
    if (!id) return undefined;
    return this.tables.get(entity)?.get(id) as T | undefined;
  }

  all<T extends Row = Row>(entity: string): T[] {
    return [...(this.tables.get(entity)?.values() ?? [])] as T[];
  }

  where<T extends Row = Row>(entity: string, pred: (row: T) => boolean): T[] {
    return this.all<T>(entity).filter(pred);
  }

  count(entity: string): number {
    return this.tables.get(entity)?.size ?? 0;
  }

  hasPending(entity: string, id: string): boolean {
    return (this.pending.get(key(entity, id)) ?? 0) > 0;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this._version++;
    for (const fn of this.listeners) fn();
  }

  private bumpPending(entity: string, id: string, delta: number): void {
    const k = key(entity, id);
    const n = (this.pending.get(k) ?? 0) + delta;
    if (n <= 0) this.pending.delete(k);
    else this.pending.set(k, n);
  }

  // Méta ---------------------------------------------------------------------

  meta(name: string): string | undefined {
    return this.metaCache.get(name);
  }

  metaNumber(name: string, fallback = 0): number {
    const v = this.metaCache.get(name);
    return v === undefined ? fallback : Number(v);
  }

  setMeta(values: Record<string, string | number | null>): Promise<void> {
    return this.exclusive(() => this._setMeta(values));
  }

  private async _setMeta(values: Record<string, string | number | null>): Promise<void> {
    await this.sql.transaction(async (tx) => {
      for (const [k, v] of Object.entries(values)) await writeMeta(tx, k, v);
    });
    for (const [k, v] of Object.entries(values)) {
      if (v === null) this.metaCache.delete(k);
      else this.metaCache.set(k, String(v));
    }
    this.notify();
  }

  // Écriture locale ------------------------------------------------------------

  /**
   * Applique des opérations locales et les place dans la boîte d'envoi, avec des
   * numéros de séquence contigus. Tout ou rien.
   */
  write(ops: LocalOp[]): Promise<void> {
    return this.exclusive(() => this._write(ops));
  }

  private async _write(ops: LocalOp[]): Promise<void> {
    if (!ops.length) return;
    const createdAt = this.now().toISOString();
    const staged = new Map<string, Row>();
    const current = (entity: string, id: string) => staged.get(key(entity, id)) ?? this.get(entity, id);
    let seq = this.metaNumber('next_seq', 1);
    const outbox: OutboxOp[] = [];
    for (const op of ops) {
      const before = current(op.entity, op.id);
      if (op.kind === 'insert' && before) throw new Error(`${op.entity} ${op.id} existe déjà`);
      const row: Row = op.kind === 'insert' ? { ...op.data, id: op.id } : { ...(before ?? { id: op.id }), ...op.data, id: op.id };
      staged.set(key(op.entity, op.id), row);
      outbox.push({ seq: seq++, opId: this.uuid(), entity: op.entity, entityId: op.id, kind: op.kind, data: op.data, createdAt });
    }
    await this.sql.transaction(async (tx) => {
      for (const [k, row] of staged) {
        const [entity] = k.split('\u0000');
        await tx.run('INSERT OR REPLACE INTO records (entity, id, data) VALUES (?, ?, ?)', [entity!, row.id, JSON.stringify(row)]);
      }
      for (const o of outbox) {
        await tx.run('INSERT INTO outbox (seq, op_id, entity, entity_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          o.seq, o.opId, o.entity, o.entityId, o.kind, JSON.stringify(o.data), o.createdAt,
        ]);
      }
      await writeMeta(tx, 'next_seq', seq);
    });
    for (const [k, row] of staged) this.table(k.split('\u0000')[0]!).set(row.id, row);
    for (const o of outbox) this.bumpPending(o.entity, o.entityId, 1);
    this.metaCache.set('next_seq', String(seq));
    this.notify();
  }

  // Boîte d'envoi --------------------------------------------------------------

  async outbox(limit: number): Promise<OutboxOp[]> {
    const rows = await this.sql.all<{ seq: number; op_id: string; entity: WritableEntity; entity_id: string; kind: 'insert' | 'patch'; data: string; created_at: string }>(
      'SELECT seq, op_id, entity, entity_id, kind, data, created_at FROM outbox ORDER BY seq LIMIT ?',
      [limit],
    );
    return rows.map((r) => ({ seq: r.seq, opId: r.op_id, entity: r.entity, entityId: r.entity_id, kind: r.kind, data: JSON.parse(r.data), createdAt: r.created_at }));
  }

  async outboxSize(): Promise<number> {
    return (await this.sql.first<{ n: number }>('SELECT count(*) AS n FROM outbox'))?.n ?? 0;
  }

  /** Retire les opérations traitées par le serveur ; les rejets sont gardés pour affichage. */
  acknowledge(done: OutboxOp[], rejected: { op: OutboxOp; code: string; message: string }[]): Promise<void> {
    return this.exclusive(() => this._acknowledge(done, rejected));
  }

  private async _acknowledge(done: OutboxOp[], rejected: { op: OutboxOp; code: string; message: string }[]): Promise<void> {
    const at = this.now().toISOString();
    await this.sql.transaction(async (tx) => {
      for (const o of [...done, ...rejected.map((r) => r.op)]) await tx.run('DELETE FROM outbox WHERE op_id = ?', [o.opId]);
      for (const r of rejected) {
        await tx.run('INSERT OR REPLACE INTO rejections (op_id, entity, entity_id, kind, data, code, message, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          r.op.opId, r.op.entity, r.op.entityId, r.op.kind, JSON.stringify(r.op.data), r.code, r.message, at,
        ]);
      }
    });
    for (const o of [...done, ...rejected.map((r) => r.op)]) this.bumpPending(o.entity, o.entityId, -1);
    this.notify();
  }

  /**
   * Renumérote les opérations en attente à partir de `from` : après une
   * réinstallation, ou si le serveur signale un trou. Les op_id ne changent pas,
   * donc une opération déjà reçue reste reconnue comme doublon.
   */
  renumber(from: number): Promise<void> {
    return this.exclusive(() => this._renumber(from));
  }

  private async _renumber(from: number): Promise<void> {
    let next = from;
    await this.sql.transaction(async (tx) => {
      const rows = await tx.all<{ seq: number }>('SELECT seq FROM outbox ORDER BY seq');
      // Décalage en deux temps pour ne jamais heurter la clé primaire.
      await tx.run('UPDATE outbox SET seq = -seq');
      for (const r of rows) await tx.run('UPDATE outbox SET seq = ? WHERE seq = ?', [next++, -r.seq]);
      await writeMeta(tx, 'next_seq', next);
    });
    this.metaCache.set('next_seq', String(next));
  }

  async rejections(): Promise<{ opId: string; entity: string; entityId: string; code: string; message: string; at: string; seen: boolean }[]> {
    const rows = await this.sql.all<{ op_id: string; entity: string; entity_id: string; code: string; message: string; at: string; seen: number }>(
      'SELECT op_id, entity, entity_id, code, message, at, seen FROM rejections ORDER BY at DESC LIMIT 100',
    );
    return rows.map((r) => ({ opId: r.op_id, entity: r.entity, entityId: r.entity_id, code: r.code, message: r.message, at: r.at, seen: r.seen === 1 }));
  }

  async markRejectionsSeen(): Promise<void> {
    await this.sql.run('UPDATE rejections SET seen = 1');
    this.notify();
  }

  // Données du serveur ---------------------------------------------------------

  /**
   * Applique des changements venus du serveur. Une ligne qui a encore des
   * opérations locales en attente n'est pas écrasée : elle redescendra, à jour,
   * une fois ces opérations envoyées.
   */
  applyRemote(changes: RemoteChange[], force = false): Promise<number> {
    return this.exclusive(() => this._applyRemote(changes, force));
  }

  private async _applyRemote(changes: RemoteChange[], force = false): Promise<number> {
    const kept: RemoteChange[] = force ? changes : changes.filter((c) => !this.hasPending(c.entity, c.entityId));
    if (!kept.length) return 0;
    await this.sql.transaction(async (tx) => {
      for (const c of kept) {
        if (c.op === 'delete' || !c.data) await tx.run('DELETE FROM records WHERE entity = ? AND id = ?', [c.entity, c.entityId]);
        else await tx.run('INSERT OR REPLACE INTO records (entity, id, data) VALUES (?, ?, ?)', [c.entity, c.entityId, JSON.stringify(c.data)]);
      }
    });
    for (const c of kept) {
      if (c.op === 'delete' || !c.data) this.table(c.entity).delete(c.entityId);
      else this.table(c.entity).set(c.entityId, c.data as Row);
    }
    this.notify();
    return kept.length;
  }

  /**
   * Remplace toutes les données par un instantané du serveur, puis réapplique
   * par-dessus les opérations locales pas encore envoyées.
   */
  replaceAll(tables: Record<string, Record<string, unknown>[]>): Promise<void> {
    return this.exclusive(() => this._replaceAll(tables));
  }

  private async _replaceAll(tables: Record<string, Record<string, unknown>[]>): Promise<void> {
    const pendingOps = await this.outbox(100000);
    await this.sql.transaction(async (tx) => {
      await tx.run('DELETE FROM records');
      for (const [entity, rows] of Object.entries(tables)) {
        for (const row of rows) await tx.run('INSERT INTO records (entity, id, data) VALUES (?, ?, ?)', [entity, String(row.id), JSON.stringify(row)]);
      }
      for (const o of pendingOps) {
        const cur = await tx.first<{ data: string }>('SELECT data FROM records WHERE entity = ? AND id = ?', [o.entity, o.entityId]);
        const base = cur ? (JSON.parse(cur.data) as Row) : { id: o.entityId };
        const row = o.kind === 'insert' ? { ...o.data, id: o.entityId } : { ...base, ...o.data };
        await tx.run('INSERT OR REPLACE INTO records (entity, id, data) VALUES (?, ?, ?)', [o.entity, o.entityId, JSON.stringify(row)]);
      }
    });
    await this.load();
  }

  /** Supprime des lignes locales (données de journées closes, trop anciennes). */
  forget(items: { entity: string; id: string }[]): Promise<void> {
    return this.exclusive(() => this._forget(items));
  }

  private async _forget(items: { entity: string; id: string }[]): Promise<void> {
    if (!items.length) return;
    await this.sql.transaction(async (tx) => {
      for (const i of items) await tx.run('DELETE FROM records WHERE entity = ? AND id = ?', [i.entity, i.id]);
    });
    for (const i of items) this.table(i.entity).delete(i.id);
    this.notify();
  }

  /** Effacement complet (retrait de la tablette). */
  async wipe(): Promise<void> {
    await this.sql.transaction(async (tx) => {
      for (const t of ['records', 'outbox', 'rejections', 'print_jobs', 'meta']) await tx.run(`DELETE FROM ${t}`);
    });
    await this.load();
  }
}

async function writeMeta(tx: SqlTx, k: string, v: string | number | null): Promise<void> {
  if (v === null) await tx.run('DELETE FROM meta WHERE key = ?', [k]);
  else await tx.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [k, String(v)]);
}

/** Les montants arrivent du serveur en texte (bigint) et du local en nombre. */
export const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
