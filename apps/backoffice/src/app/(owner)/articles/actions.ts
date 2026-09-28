'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ActionState, api, runAction } from '@/lib/api';
import { optStr, str, toCents } from '@/lib/format';

const done = () => revalidatePath('/articles');

export async function saveFamily(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form.get('id'));
  const body = {
    name: str(form.get('name')),
    color: str(form.get('color')) || '#0B1F3A',
    printer_id: optStr(form.get('printer_id')),
    tax_rate_id: optStr(form.get('tax_rate_id')),
    sort: Number(form.get('sort') || 0),
  };
  let createdId: string | undefined;
  const res = await runAction(async () => {
    if (id) await api(`/bo/r/families/${id}`, { method: 'PATCH', body });
    else createdId = (await api<{ id: string }>('/bo/r/families', { method: 'POST', body })).id;
  }, id ? 'Famille enregistrée' : 'Famille créée');
  done();
  if (createdId) redirect(`/articles?famille=${createdId}`);
  return res;
}

export async function archiveFamily(form: FormData): Promise<void> {
  const id = str(form.get('id'));
  await api(`/bo/r/families/${id}`, { method: 'PATCH', body: { archived: str(form.get('archived')) === 'true' } });
  done();
  redirect('/articles');
}

function printerFields(value: string) {
  if (value === 'inherit' || value === 'none') return { printer_mode: value, printer_id: null };
  return { printer_mode: 'printer', printer_id: value };
}

export async function saveItem(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form.get('id'));
  let createdId: string | undefined;
  const res = await runAction(async () => {
    const body: Record<string, unknown> = {
      name: str(form.get('name')),
      family_id: str(form.get('family_id')),
      price_cents: toCents(form.get('price'), 'Prix TTC'),
      tax_rate_id: optStr(form.get('tax_rate_id')),
      stock_mode: str(form.get('stock_mode')) || 'none',
      available: form.get('available') === 'on',
      ...printerFields(str(form.get('printer')) || 'inherit'),
    };
    if (id) {
      await api(`/bo/r/items/${id}`, { method: 'PATCH', body });
    } else {
      body.kind = str(form.get('kind')) || 'product';
      createdId = (await api<{ id: string }>('/bo/r/items', { method: 'POST', body })).id;
    }
  }, id ? 'Article enregistré' : 'Article créé');
  done();
  revalidatePath('/menus');
  if (createdId) {
    const kind = str(form.get('kind'));
    redirect(kind === 'menu' ? `/menus?menu=${createdId}` : `/articles?famille=${str(form.get('family_id'))}&article=${createdId}`);
  }
  return res;
}

export async function setItemFlag(form: FormData): Promise<void> {
  const id = str(form.get('id'));
  const field = str(form.get('field'));
  if (field !== 'available' && field !== 'archived') return;
  await api(`/bo/r/items/${id}`, { method: 'PATCH', body: { [field]: str(form.get('value')) === 'true' } });
  done();
  revalidatePath('/menus');
  if (field === 'archived') redirect(str(form.get('back')) || '/articles');
}

export async function attachGroup(form: FormData): Promise<void> {
  const group = str(form.get('group_id'));
  if (!group) return;
  await api('/bo/r/item-option-groups', { method: 'POST', body: { item_id: str(form.get('item_id')), group_id: group } });
  done();
}

export async function detachGroup(form: FormData): Promise<void> {
  await api(`/bo/r/item-option-groups/${str(form.get('id'))}`, { method: 'DELETE' });
  done();
}

export async function createGroup(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const min = Number(form.get('min_select') || 0);
    const max = Number(form.get('max_select') || 1);
    if (max < min) throw new RangeError('Le maximum doit être supérieur ou égal au minimum');
    await api('/bo/r/option-groups', { method: 'POST', body: { name: str(form.get('name')), min_select: min, max_select: max } });
  }, 'Groupe créé');
  revalidatePath('/articles/options');
  return res;
}

export async function updateGroup(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const min = Number(form.get('min_select') || 0);
    const max = Number(form.get('max_select') || 1);
    if (max < min) throw new RangeError('Le maximum doit être supérieur ou égal au minimum');
    await api(`/bo/r/option-groups/${str(form.get('id'))}`, { method: 'PATCH', body: { name: str(form.get('name')), min_select: min, max_select: max } });
  }, 'Groupe enregistré');
  revalidatePath('/articles/options');
  return res;
}

export async function addOption(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const extra = str(form.get('extra')) ? toCents(form.get('extra'), 'Supplément') : 0;
    await api('/bo/r/options', { method: 'POST', body: { group_id: str(form.get('group_id')), name: str(form.get('name')), extra_cents: extra } });
  }, 'Option ajoutée');
  revalidatePath('/articles/options');
  return res;
}

export async function archiveOption(form: FormData): Promise<void> {
  await api(`/bo/r/options/${str(form.get('id'))}`, { method: 'PATCH', body: { archived: true } });
  revalidatePath('/articles/options');
}
