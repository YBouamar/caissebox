'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ActionState, api, runAction } from '@/lib/api';
import { str } from '@/lib/format';

const pinOk = (pin: string) => {
  if (!/^\d{4}$/.test(pin)) throw new RangeError('Le PIN doit comporter 4 chiffres');
  if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '4321') throw new RangeError('PIN trop facile à deviner (0000, 1234…)');
  return pin;
};

export async function createStaff(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string | undefined;
  const res = await runAction(async () => {
    const establishmentIds = form.getAll('establishmentIds').map(String);
    if (!establishmentIds.length) throw new RangeError('Cochez au moins un établissement');
    id = (
      await api<{ staffId: string }>('/bo/staff', {
        method: 'POST',
        body: { fullName: str(form.get('fullName')), roleId: str(form.get('roleId')), pin: pinOk(str(form.get('pin'))), establishmentIds },
      })
    ).staffId;
  }, 'Personne ajoutée');
  revalidatePath('/equipe');
  if (id) redirect(`/equipe?personne=${id}`);
  return res;
}

export async function updateStaff(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const establishmentIds = form.getAll('establishmentIds').map(String);
    if (!establishmentIds.length) throw new RangeError('Cochez au moins un établissement');
    await api(`/bo/staff/${str(form.get('id'))}`, {
      method: 'PATCH',
      body: {
        fullName: str(form.get('fullName')),
        initials: str(form.get('initials')) || undefined,
        roleId: str(form.get('roleId')),
        active: form.get('active') === 'on',
        establishmentIds,
      },
    });
  });
  revalidatePath('/equipe');
  return res;
}

export async function changePin(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    await api(`/bo/staff/${str(form.get('id'))}/pin`, { method: 'PUT', body: { pin: pinOk(str(form.get('pin'))) } });
  }, 'Nouveau PIN enregistré. Il sera actif sur les tablettes à la prochaine synchronisation.');
  return res;
}

export async function updatePermissions(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const keys = form.getAll('keys').map(String);
    const permissions: Record<string, boolean | number> = {};
    for (const k of keys) permissions[k] = form.get(`p:${k}`) === 'on';
    const max = str(form.get('discount_max'));
    if (max !== '') {
      const pct = Number(max.replace(',', '.'));
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new RangeError('Remise maximale entre 0 et 100 %');
      permissions['order.discount_max_bp'] = Math.round(pct * 100);
    }
    await api(`/bo/roles/${str(form.get('id'))}`, { method: 'PATCH', body: { permissions } });
  }, 'Droits enregistrés');
  revalidatePath('/equipe');
  return res;
}
