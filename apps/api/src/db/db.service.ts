import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { APP_CONFIG, AppConfig } from '../config';

export interface TenantContext {
  tenantId: string;
  deviceId?: string | null;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Transaction soumise à la Row Level Security : le rôle caissebox_app ne voit
   * et n'écrit que les lignes du client courant. Tout accès métier passe par ici.
   */
  async withTenant<T>(
    ctx: TenantContext,
    fn: (client: PoolClient) => Promise<T>,
    opts: { repeatableRead?: boolean } = {},
  ): Promise<T> {
    return this.transaction(async (client) => {
      if (opts.repeatableRead) await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await client.query('SET LOCAL ROLE caissebox_app');
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.device_id', $2, true)",
        [ctx.tenantId, ctx.deviceId ?? ''],
      );
      return fn(client);
    });
  }

  /**
   * Transaction hors RLS, réservée à l'authentification et à la console
   * BACYBRAINS (opérateurs de la plateforme).
   */
  async asPlatform<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.transaction(fn);
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
