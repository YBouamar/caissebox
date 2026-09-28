import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { verifySecret } from './secrets';
import { TokensService } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokensService,
  ) {}

  /** Connexion au back-office (propriétaire) ou à la console (opérateur BACYBRAINS). */
  async login(email: string, password: string): Promise<{ token: string; role: string }> {
    const user = await this.db.asPlatform(async (c) => {
      const { rows } = await c.query<{ id: string; tenant_id: string | null; role: 'owner' | 'operator'; password_hash: string }>(
        'SELECT id, tenant_id, role, password_hash FROM users WHERE lower(email) = lower($1)',
        [email],
      );
      return rows[0];
    });
    // Vérification systématique pour ne pas révéler l'existence d'un compte par le temps de réponse.
    const ok = await verifySecret(password, user?.password_hash ?? 'scrypt$00$00');
    if (!user || !ok) throw new UnauthorizedException('E-mail ou mot de passe incorrect');
    const token =
      user.role === 'operator'
        ? await this.tokens.sign({ typ: 'operator', userId: user.id })
        : await this.tokens.sign({ typ: 'owner', userId: user.id, tenantId: user.tenant_id as string });
    return { token, role: user.role };
  }

  /** Authentification d'une tablette enrôlée, par son identifiant et son secret. */
  async authenticateDevice(
    deviceId: string,
    secret: string,
    appVersion?: string,
  ): Promise<{ token: string; tenantId: string; establishmentId: string; accessState: string }> {
    const device = await this.db.asPlatform(async (c) => {
      const { rows } = await c.query<{
        id: string;
        tenant_id: string;
        establishment_id: string;
        secret_hash: string | null;
        access_state: string;
        tenant_status: string;
      }>(
        `SELECT d.id, d.tenant_id, d.establishment_id, d.secret_hash, e.access_state, t.status AS tenant_status
           FROM devices d
           JOIN establishments e ON e.id = d.establishment_id
           JOIN tenants t ON t.id = d.tenant_id
          WHERE d.id = $1 AND d.kind = 'tablet' AND d.status = 'deployed'`,
        [deviceId],
      );
      return rows[0];
    });
    const ok = await verifySecret(secret, device?.secret_hash ?? 'scrypt$00$00');
    if (!device || !ok) throw new UnauthorizedException('Tablette inconnue ou secret invalide');
    if (device.tenant_status === 'terminated') throw new UnauthorizedException('Contrat terminé');

    await this.db.asPlatform((c) =>
      c.query('UPDATE devices SET last_seen_at = now(), app_version = COALESCE($2, app_version) WHERE id = $1', [
        device.id,
        appVersion ?? null,
      ]),
    );
    const token = await this.tokens.sign({
      typ: 'device',
      deviceId: device.id,
      tenantId: device.tenant_id,
      establishmentId: device.establishment_id,
    });
    return { token, tenantId: device.tenant_id, establishmentId: device.establishment_id, accessState: device.access_state };
  }
}
