'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ESTABLISHMENT_COOKIE } from './session';

export async function chooseEstablishment(form: FormData): Promise<void> {
  const id = String(form.get('establishmentId') ?? '');
  if (/^[0-9a-f-]{36}$/.test(id)) {
    (await cookies()).set(ESTABLISHMENT_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath('/', 'layout');
}
