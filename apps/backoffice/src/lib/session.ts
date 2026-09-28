import 'server-only';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'cb_session';
export const ESTABLISHMENT_COOKIE = 'cb_est';

export type Role = 'owner' | 'operator';

export interface Session {
  token: string;
  role: Role;
  userId: string;
  tenantId?: string;
  expiresAt: number;
}

/**
 * Lecture du jeton déposé à la connexion. La signature n'est pas vérifiée ici :
 * l'API la vérifie à chaque appel. On lit seulement le type et l'expiration
 * pour aiguiller l'utilisateur vers le bon espace.
 */
export function decodeToken(token: string): Session | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      typ?: string;
      userId?: string;
      tenantId?: string;
      exp?: number;
    };
    if ((payload.typ !== 'owner' && payload.typ !== 'operator') || !payload.userId || !payload.exp) return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return { token, role: payload.typ, userId: payload.userId, tenantId: payload.tenantId, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? decodeToken(token) : null;
}
