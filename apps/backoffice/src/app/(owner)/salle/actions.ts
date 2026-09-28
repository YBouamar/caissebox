'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ActionState, api, runAction } from '@/lib/api';
import { str } from '@/lib/format';

const SIZES: Record<string, { w: number; h: number }> = { square: { w: 96, h: 96 }, round: { w: 96, h: 96 }, long: { w: 180, h: 88 } };

export async function createZone(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string | undefined;
  const res = await runAction(async () => {
    id = (await api<{ id: string }>('/bo/r/zones', { method: 'POST', body: { establishment_id: str(form.get('establishment_id')), name: str(form.get('name')), sort: Number(form.get('sort') || 0) } })).id;
  }, 'Zone créée');
  revalidatePath('/salle');
  if (id) redirect(`/salle?zone=${id}`);
  return res;
}

export async function renameZone(_: ActionState, form: FormData): Promise<ActionState> {
  const res = await runAction(() => api(`/bo/r/zones/${str(form.get('id'))}`, { method: 'PATCH', body: { name: str(form.get('name')) } }), 'Zone renommée');
  revalidatePath('/salle');
  return res;
}

export async function saveTable(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form.get('id'));
  const shape = str(form.get('shape')) || 'square';
  const res = await runAction(async () => {
    const body: Record<string, unknown> = {
      label: str(form.get('label')),
      seats: Number(form.get('seats') || 4),
      shape,
      active: id ? form.get('active') === 'on' : true,
    };
    if (id) {
      if (str(form.get('shape_changed')) !== str(form.get('shape'))) Object.assign(body, SIZES[shape]);
      await api(`/bo/r/tables/${id}`, { method: 'PATCH', body });
    } else {
      const count = Number(form.get('count') || 0);
      Object.assign(body, SIZES[shape], {
        establishment_id: str(form.get('establishment_id')),
        zone_id: str(form.get('zone_id')),
        x: 24 + (count % 6) * 130,
        y: 24 + Math.floor(count / 6) * 130,
      });
      await api('/bo/r/tables', { method: 'POST', body });
    }
  }, id ? 'Table enregistrée' : 'Table ajoutée');
  revalidatePath('/salle');
  return res;
}

export async function moveTable(id: string, x: number, y: number): Promise<void> {
  await api(`/bo/r/tables/${id}`, { method: 'PATCH', body: { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) } });
  revalidatePath('/salle');
}
