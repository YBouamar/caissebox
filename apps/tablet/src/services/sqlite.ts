import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync } from 'expo-sqlite';
import { createSql, Sql, SqlValue } from '../core/sql';

const KEY_NAME = 'caissebox.db.key';

/**
 * Base locale chiffrée (SQLCipher). La clé est tirée au hasard au premier
 * lancement et rangée dans le coffre Android (SecureStore) : une base copiée hors
 * de la tablette est illisible.
 */
export async function openLocalDatabase(): Promise<Sql> {
  let key = await SecureStore.getItemAsync(KEY_NAME);
  if (!key) {
    const bytes = Crypto.getRandomBytes(32);
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(KEY_NAME, key);
  }
  const db = await openDatabaseAsync('caissebox.db');
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');
  return createSql({
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      await db.runAsync(sql, params as SqlValue[] as never);
    },
    all: <T,>(sql: string, params: SqlValue[]) => db.getAllAsync<T>(sql, params as never),
  });
}
