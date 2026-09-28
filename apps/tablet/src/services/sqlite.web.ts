// Aperçu web (démonstration et contrôle visuel des écrans) : SQLite en mémoire via sql.js.
// La vraie tablette utilise sqlite.ts (SQLCipher chiffré).
// @ts-expect-error pas de types pour la version asm.js
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { createSql, Sql, SqlValue } from '../core/sql';

export async function openLocalDatabase(): Promise<Sql> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const rows = <T,>(sql: string, params: SqlValue[]): T[] => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const out: T[] = [];
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    stmt.free();
    return out;
  };
  return createSql({
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params) => {
      db.run(sql, params);
    },
    all: async <T,>(sql: string, params: SqlValue[]) => rows<T>(sql, params),
  });
}
