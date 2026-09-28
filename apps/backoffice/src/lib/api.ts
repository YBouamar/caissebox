import 'server-only';
import { redirect } from 'next/navigation';
import { getSession } from './session';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: { message?: string | string[]; issues?: { path: string; message: string }[] } = {};
  try {
    body = await res.json();
  } catch {
    // corps vide
  }
  const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  return new ApiError(res.status, msg ?? `Erreur ${res.status}`, body.issues);
}

/** Appel de l'API depuis le serveur Next, avec le jeton de la session. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = await getSession();
  if (!session) redirect('/connexion');
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/connexion?expire=1');
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

/** Appel sans session (connexion). */
export async function publicApi<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Enveloppe commune des server actions : renvoie un message lisible au formulaire. */
export async function runAction(fn: () => Promise<unknown>, success = 'Enregistré'): Promise<ActionState> {
  try {
    await fn();
    return { ok: true, message: success };
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = error.issues?.map((i) => `${i.path ? `${i.path} : ` : ''}${i.message}`).join(' · ');
      return { error: detail ? `${error.message} (${detail})` : error.message };
    }
    if (error instanceof Error && 'digest' in error) throw error; // redirect() de Next
    if (error instanceof RangeError) return { error: error.message };
    return { error: 'Erreur inattendue, réessayez' };
  }
}
