import { formatCents, parseAmount } from '@caissebox/shared';

export const dh = (cents: number | string | null | undefined): string => formatCents(Number(cents ?? 0), { currency: true });
export const amount = (cents: number | string | null | undefined): string => formatCents(Number(cents ?? 0));
export const rate = (bp: number): string => `${(bp / 100).toLocaleString('fr-FR')} %`;

export function toCents(input: FormDataEntryValue | null, label = 'Montant'): number {
  const text = String(input ?? '').trim();
  if (!text) throw new RangeError(`${label} obligatoire`);
  try {
    const cents = parseAmount(text);
    if (cents < 0) throw new RangeError('négatif');
    return cents;
  } catch {
    throw new RangeError(`${label} invalide : « ${text} »`);
  }
}

const tz = 'Africa/Casablanca';
export const dateFr = (d: string | Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz }).format(new Date(d)) : '';
export const timeFr = (d: string | Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(d)) : '';
export const dateTimeFr = (d: string | Date | null | undefined): string => (d ? `${dateFr(d)} ${timeFr(d)}` : '');

/** « 2026-09-28 » → « lun. 28/09 » */
export function shortDay(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d);
}

export function sinceFr(d: string | null | undefined): string {
  if (!d) return 'jamais';
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export const str = (v: FormDataEntryValue | null): string => String(v ?? '').trim();
export const optStr = (v: FormDataEntryValue | null): string | null => {
  const s = str(v);
  return s === '' ? null : s;
};
