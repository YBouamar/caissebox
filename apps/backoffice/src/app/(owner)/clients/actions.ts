'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ActionState, api, runAction } from '@/lib/api';
import { optStr, str, toCents } from '@/lib/format';

export async function saveCustomer(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form.get('id'));
  let created: string | undefined;
  const res = await runAction(async () => {
    const ice = optStr(form.get('ice'));
    if (ice && !/^\d{15}$/.test(ice)) throw new RangeError("L'ICE comporte 15 chiffres");
    const body = {
      full_name: str(form.get('full_name')),
      phone: optStr(form.get('phone')),
      company: optStr(form.get('company')),
      ice,
      credit_limit_cents: str(form.get('limit')) ? toCents(form.get('limit'), 'Plafond') : 0,
    };
    if (id) await api(`/bo/r/customers/${id}`, { method: 'PATCH', body });
    else created = (await api<{ id: string }>('/bo/r/customers', { method: 'POST', body })).id;
  }, id ? 'Client enregistré' : 'Client créé');
  revalidatePath('/clients');
  if (created) redirect(`/clients?client=${created}`);
  return res;
}

export async function settle(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    await api(`/bo/customers/${str(form.get('id'))}/settlements`, {
      method: 'POST',
      body: { amountCents: toCents(form.get('amount'), 'Montant'), paymentMethodId: str(form.get('paymentMethodId')), note: optStr(form.get('note')) ?? undefined },
    });
  }, 'Règlement enregistré');
  revalidatePath('/clients');
  return res;
}
