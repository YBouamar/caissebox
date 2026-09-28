import { Credentials, DeviceApi, FetchLike } from './api';
import { Pos, PrinterRow, PrintRequest } from './pos';
import { PrintQueue, PrintTransport } from './printing';
import { LOCAL_SCHEMA, Sql } from './sql';
import { Store } from './store';
import { Rejection, SyncEngine } from './sync';

export interface CaisseDeps {
  sql: Sql;
  fetch: FetchLike;
  transport: PrintTransport;
  uuid: () => string;
  now?: () => Date;
  appVersion?: string;
  onRejected?: (r: Rejection[]) => void;
  syncIntervalMs?: number;
}

/**
 * Assemblage de la caisse : données locales, règles, synchronisation, impression.
 * Indépendant de React Native : les mêmes classes tournent dans les tests Node.
 */
export class Caisse {
  readonly store: Store;
  readonly pos: Pos;
  readonly printQueue: PrintQueue;
  private _sync: SyncEngine | null = null;
  private api: DeviceApi | null = null;

  private constructor(private readonly deps: CaisseDeps) {
    this.store = new Store(deps.sql, deps.uuid, deps.now);
    this.printQueue = new PrintQueue(
      deps.sql,
      deps.transport,
      (id) => {
        const p = this.store.get<PrinterRow>('printers', id);
        return p && p.active ? { id: p.id, name: p.name, connection: p.connection, address: p.address, port: Number(p.port ?? 9100) } : undefined;
      },
      { uuid: deps.uuid, now: deps.now, onKitchenTicket: (ticketId, status) => this.pos.markKitchenTicket(ticketId, status) },
    );
    this.pos = new Pos(this.store, {
      uuid: deps.uuid,
      now: deps.now,
      onWrite: () => this._sync?.nudge(),
      print: (jobs: PrintRequest[]) => this.printQueue.enqueue(jobs),
    });
  }

  static async open(deps: CaisseDeps): Promise<Caisse> {
    await deps.sql.exec(LOCAL_SCHEMA);
    const c = new Caisse(deps);
    await c.store.load();
    return c;
  }

  get sync(): SyncEngine {
    if (!this._sync) throw new Error('Tablette non enrôlée');
    return this._sync;
  }

  get enrolled(): boolean {
    return !!this.store.meta('snapshot_at') && !!this._sync;
  }

  /** Relie la caisse au serveur avec les identifiants d'enrôlement (conservés hors de SQLite). */
  connect(creds: Credentials): void {
    this.api = new DeviceApi(creds, this.deps.fetch, this.deps.appVersion);
    this._sync = new SyncEngine(this.store, this.api, {
      intervalMs: this.deps.syncIntervalMs,
      now: this.deps.now,
      onRejected: this.deps.onRejected,
    });
  }

  /** Premier démarrage : authentification et chargement complet. */
  async enroll(creds: Credentials): Promise<void> {
    this.connect(creds);
    await this.sync.snapshot();
    await this.store.setMeta({ device_id: creds.deviceId, api_url: creds.baseUrl });
  }

  /** Démarrage normal : relance de la synchro et des impressions en attente. */
  async start(): Promise<void> {
    this.sync.start();
    await this.printQueue.resume();
  }

  stop(): void {
    this._sync?.stop();
  }

  async reset(): Promise<void> {
    this.stop();
    await this.store.wipe();
    this._sync = null;
    this.api = null;
  }
}
