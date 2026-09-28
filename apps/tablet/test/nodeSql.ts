import { createRequire } from 'node:module';
import { createSql, Sql, SqlValue } from '../src/core/sql';

const require = createRequire(import.meta.url);

/** Pilote SQLite pour les tests : node:sqlite (synchrone), présenté comme l'API asynchrone d'expo-sqlite. */
export function nodeSql(path = ':memory:'): Sql {
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => { exec(s: string): void; prepare(s: string): { run(...p: SqlValue[]): unknown; all(...p: SqlValue[]): unknown[] } } };
  const db = new DatabaseSync(path);
  return createSql({
    exec: async (sql) => db.exec(sql),
    run: async (sql, params) => {
      db.prepare(sql).run(...params);
    },
    all: async <T,>(sql: string, params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
  });
}
