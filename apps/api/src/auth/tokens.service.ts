import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, AppConfig } from '../config';

export type Principal =
  | { typ: 'device'; deviceId: string; tenantId: string; establishmentId: string }
  | { typ: 'owner'; userId: string; tenantId: string }
  | { typ: 'operator'; userId: string };

@Injectable()
export class TokensService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  async sign(principal: Principal): Promise<string> {
    const ttl = principal.typ === 'device' ? this.config.DEVICE_TOKEN_TTL : this.config.USER_TOKEN_TTL;
    const subject = principal.typ === 'device' ? principal.deviceId : principal.userId;
    return new SignJWT({ ...principal })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject)
      .setIssuedAt()
      .setIssuer('caissebox')
      .setExpirationTime(ttl)
      .sign(this.key);
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: 'caissebox', algorithms: ['HS256'] });
      const typ = payload.typ;
      if (typ === 'device' && payload.deviceId && payload.tenantId && payload.establishmentId) {
        return {
          typ,
          deviceId: String(payload.deviceId),
          tenantId: String(payload.tenantId),
          establishmentId: String(payload.establishmentId),
        };
      }
      if (typ === 'owner' && payload.userId && payload.tenantId) {
        return { typ, userId: String(payload.userId), tenantId: String(payload.tenantId) };
      }
      if (typ === 'operator' && payload.userId) {
        return { typ, userId: String(payload.userId) };
      }
    } catch {
      // Jeton expiré, falsifié ou mal formé : même réponse pour tous les cas.
    }
    throw new UnauthorizedException('Jeton invalide ou expiré');
  }
}
