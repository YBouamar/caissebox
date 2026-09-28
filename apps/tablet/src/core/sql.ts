/**
 * Accès SQLite commun à l'application (expo-sqlite) et aux tests (node:sqlite).
 *
 * Toutes les requêtes passent par une file unique : une transaction ne peut
 * jamais s'intercaler au milieu d'une autre, ce qui garantit que l'écriture
 * locale et l'ajout à la boîte d'envoi restent atomiques.
 */
export type SqlValue = string | number | null | Uint8Array;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlValue[]): Promise<void>;
  all<T>(sql: string, params: SqlValue[]): Promise<T[]>;
}

export interface Sql {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Exécute `fn` dans une transaction exclusive ; `tx` n'accepte que des requêtes simples. */
  transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T>;
}

export interface SqlTx {
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
}

export function createSql(driver: SqlDriver): Sql {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
  const tx: SqlTx = {
    run: (sql, params = []) => driver.run(sql, params),
    all: <T>(sql: string, params: SqlValue[] = []) => driver.all<T>(sql, params),
    first: async <T>(sql: string, params: SqlValue[] = []) => (await driver.all<T>(sql, params))[0] ?? null,
  };
  return {
    exec: (sql) => serial(() => driver.exec(sql)),
    run: (sql, params = []) => serial(() => driver.run(sql, params)),
    all: <T>(sql: string, params: SqlValue[] = []) => serial(() => driver.all<T>(sql, params)),
    first: <T>(sql: string, params: SqlValue[] = []) => serial(async () => (await driver.all<T>(sql, params))[0] ?? null),
    transaction: <T>(fn: (t: SqlTx) => Promise<T>) =>
      serial(async () => {
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(tx);
          await driver.exec('COMMIT');
          return result;
        } catch (error) {
          await driver.exec('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }),
  };
}

export const LOCAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY,
  op_id TEXT NOT NULL UNIQUE,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_entity ON outbox (entity, entity_id);
CREATE TABLE IF NOT EXISTS rejections (
  op_id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  at TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  printer_id TEXT NOT NULL,
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  kitchen_ticket_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL
);
`;
