'use server';

import { revalidatePath } from 'next/cache';
import { ActionState, api, runAction } from '@/lib/api';
import { optStr, str } from '@/lib/format';

export async function saveEstablishment(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(() =>
    api(`/bo/establishments/${str(form.get('id'))}`, {
      method: 'PATCH',
      body: {
        name: str(form.get('name')),
        address: optStr(form.get('address')),
        receipt_header: optStr(form.get('receipt_header')),
        receipt_footer: optStr(form.get('receipt_footer')),
        service_mode: str(form.get('service_mode')),
        kitchen_send_mode: str(form.get('kitchen_send_mode')),
      },
    }),
  );
  revalidatePath('/', 'layout');
  return res;
}

function parseRate(v: FormDataEntryValue | null): number {
  const pct = Number(String(v ?? '').replace(',', '.').replace('%', '').trim());
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new RangeError('Taux entre 0 et 100 %');
  return Math.round(pct * 100);
}

export async function addTax(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(() =>
    api('/bo/r/tax-rates', { method: 'POST', body: { label: str(form.get('label')), rate_bp: parseRate(form.get('rate')), is_default: form.get('is_default') === 'on' } }),
  'Taux ajouté');
  revalidatePath('/parametres');
  return res;
}

export async function setDefaultTax(form: FormData): Promise<void> {
  await api(`/bo/r/tax-rates/${str(form.get('id'))}`, { method: 'PATCH', body: { is_default: true } });
  revalidatePath('/parametres');
}

export async function togglePaymentMethod(form: FormData): Promise<void> {
  await api(`/bo/r/payment-methods/${str(form.get('id'))}`, { method: 'PATCH', body: { active: str(form.get('active')) === 'true' } });
  revalidatePath('/parametres');
}

export async function addPaymentMethod(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(() => api('/bo/r/payment-methods', { method: 'POST', body: { label: str(form.get('label')), kind: 'other', sort: 50 } }), 'Mode ajouté');
  revalidatePath('/parametres');
  return res;
}

export async function addReason(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(() => api('/bo/r/reason-codes', { method: 'POST', body: { category: str(form.get('category')), label: str(form.get('label')) } }), 'Motif ajouté');
  revalidatePath('/parametres');
  return res;
}

export async function toggleReason(form: FormData): Promise<void> {
  await api(`/bo/r/reason-codes/${str(form.get('id'))}`, { method: 'PATCH', body: { active: str(form.get('active')) === 'true' } });
  revalidatePath('/parametres');
}
