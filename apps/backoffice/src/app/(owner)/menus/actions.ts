'use server';

import { revalidatePath } from 'next/cache';
import { ActionState, api, runAction } from '@/lib/api';
import { str, toCents } from '@/lib/format';

export async function addStep(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const min = Number(form.get('min_select') || 1);
    const max = Number(form.get('max_select') || 1);
    if (max < min) throw new RangeError('Le maximum doit être supérieur ou égal au minimum');
    await api('/bo/r/menu-steps', {
      method: 'POST',
      body: { menu_item_id: str(form.get('menu_item_id')), name: str(form.get('name')), min_select: min, max_select: max, sort: Number(form.get('sort') || 0) },
    });
  }, 'Étape ajoutée');
  revalidatePath('/menus');
  return res;
}

export async function deleteStep(form: FormData): Promise<void> {
  await api(`/bo/r/menu-steps/${str(form.get('id'))}`, { method: 'DELETE' });
  revalidatePath('/menus');
}

export async function addChoice(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    const extra = str(form.get('extra')) ? toCents(form.get('extra'), 'Supplément') : 0;
    const item = str(form.get('item_id'));
    if (!item) throw new RangeError('Choisissez un article');
    await api('/bo/r/menu-step-choices', { method: 'POST', body: { step_id: str(form.get('step_id')), item_id: item, extra_cents: extra } });
  }, 'Choix ajouté');
  revalidatePath('/menus');
  return res;
}

export async function deleteChoice(form: FormData): Promise<void> {
  await api(`/bo/r/menu-step-choices/${str(form.get('id'))}`, { method: 'DELETE' });
  revalidatePath('/menus');
}
