'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ActionState, api, runAction } from '@/lib/api';
import { optStr, str } from '@/lib/format';

export async function savePrinter(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form.get('id'));
  let created: string | undefined;
  const res = await runAction(async () => {
    const connection = str(form.get('connection'));
    const address = str(form.get('address'));
    if (connection === 'bluetooth' && !/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(address)) throw new RangeError('Adresse Bluetooth attendue au format 00:11:22:AA:BB:CC');
    if (connection === 'wifi' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(address)) throw new RangeError('Adresse IP attendue, par exemple 192.168.1.50');
    const body: Record<string, unknown> = {
      name: str(form.get('name')),
      connection,
      address: connection === 'bluetooth' ? address.toUpperCase() : address,
      port: Number(form.get('port') || 9100),
      paper_width_mm: Number(form.get('paper_width_mm') || 80),
      prints_receipts: form.get('prints_receipts') === 'on',
      prints_preparation: form.get('prints_preparation') === 'on',
      opens_drawer: form.get('opens_drawer') === 'on',
      active: id ? form.get('active') === 'on' : true,
    };
    if (id) await api(`/bo/r/printers/${id}`, { method: 'PATCH', body });
    else created = (await api<{ id: string }>('/bo/r/printers', { method: 'POST', body: { ...body, establishment_id: str(form.get('establishment_id')) } })).id;
  }, id ? 'Imprimante enregistrée' : 'Imprimante ajoutée');
  revalidatePath('/imprimantes');
  if (created) redirect(`/imprimantes?imprimante=${created}`);
  return res;
}

export async function routeFamily(form: FormData): Promise<void> {
  await api(`/bo/r/families/${str(form.get('family_id'))}`, { method: 'PATCH', body: { printer_id: optStr(form.get('printer_id')) } });
  revalidatePath('/imprimantes');
  revalidatePath('/articles');
}
