'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, publicApi } from './api';
import { ESTABLISHMENT_COOKIE, SESSION_COOKIE, decodeToken } from './session';

export async function login(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'E-mail et mot de passe obligatoires' };
  let token: string;
  try {
    token = (await publicApi<{ token: string }>('/auth/login', { email, password })).token;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { error: 'E-mail ou mot de passe incorrect' };
    return { error: 'Service indisponible, réessayez dans un instant' };
  }
  const session = decodeToken(token);
  if (!session) return { error: 'Réponse de connexion invalide' };
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expiresAt),
  });
  redirect(session.role === 'operator' ? '/console' : '/');
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ESTABLISHMENT_COOKIE);
  redirect('/connexion');
}
