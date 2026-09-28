'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ActionState, api, runAction } from '@/lib/api';
import { optStr, str, toCents } from '@/lib/format';

export async function createTenant(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string | undefined;
  const res = await runAction(async () => {
    const ice = optStr(form.get('ice'));
    if (ice && !/^\d{15}$/.test(ice)) throw new RangeError("L'ICE comporte 15 chiffres");
    const password = str(form.get('password'));
    if (password.length < 10) throw new RangeError('Mot de passe provisoire : 10 caractères minimum');
    id = (
      await api<{ tenantId: string }>('/console/tenants', {
        method: 'POST',
        body: {
          name: str(form.get('name')),
          legalName: optStr(form.get('legalName')) ?? undefined,
          ice: ice ?? undefined,
          address: optStr(form.get('address')) ?? undefined,
          owner: { email: str(form.get('email')), fullName: str(form.get('fullName')), password },
          establishment: { name: str(form.get('establishment')) || str(form.get('name')), address: optStr(form.get('address')) ?? undefined },
        },
      })
    ).tenantId;
  }, 'Client créé');
  revalidatePath('/console');
  if (id) redirect(`/console/clients/${id}`);
  return res;
}

export async function addEstablishment(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(
    () => api(`/console/tenants/${str(form.get('tenantId'))}/establishments`, { method: 'POST', body: { name: str(form.get('name')), address: optStr(form.get('address')) ?? undefined } }),
    'Établissement ajouté',
  );
  revalidatePath(`/console/clients/${str(form.get('tenantId'))}`);
  return res;
}

export async function setAccess(form: FormData): Promise<void> {
  await api(`/console/establishments/${str(form.get('establishmentId'))}/access`, { method: 'POST', body: { state: str(form.get('state')) } });
  revalidatePath(`/console/clients/${str(form.get('tenantId'))}`);
  revalidatePath('/console');
}

export interface DeployState extends ActionState {
  secret?: string;
  deviceId?: string;
}

export async function deployDevice(_: DeployState, form: FormData): Promise<DeployState> {
  let out: { deviceId: string; secret?: string } | undefined;
  const res = await runAction(async () => {
    out = await api(`/console/devices/${str(form.get('deviceId'))}/deploy`, {
      method: 'POST',
      body: { establishmentId: str(form.get('establishmentId')), label: optStr(form.get('label')) ?? undefined },
    });
  }, 'Matériel affecté');
  revalidatePath(`/console/clients/${str(form.get('tenantId'))}`);
  revalidatePath('/console/parc');
  return { ...res, secret: out?.secret, deviceId: out?.deviceId };
}

export async function retireDevice(form: FormData): Promise<void> {
  await api(`/console/devices/${str(form.get('deviceId'))}/retire`, { method: 'POST', body: { status: str(form.get('status')) } });
  const back = str(form.get('back'));
  revalidatePath('/console/parc');
  if (back) revalidatePath(back);
}

export async function registerDevice(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const price = str(form.get('price'));
    await api('/console/devices', {
      method: 'POST',
      body: {
        kind: str(form.get('kind')),
        serial: str(form.get('serial')),
        model: optStr(form.get('model')) ?? undefined,
        purchasePriceCents: price ? toCents(price, "Prix d'achat") : undefined,
      },
    });
  }, 'Matériel ajouté au parc');
  revalidatePath('/console/parc');
  return res;
}
