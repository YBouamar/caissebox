import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? resolve(__dirname, '../../../../db/migrations');

/**
 * Applique les fichiers SQL de db/migrations dans l'ordre, une seule fois chacun.
 * Un verrou consultatif empêche deux déploiements de migrer en même temps.
 */
export async function migrate(databaseUrl: string, dir = MIGRATIONS_DIR, log = console.log): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`Migration appliquée : ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Échec de la migration ${file} : ${(error as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
  return applied;
}
