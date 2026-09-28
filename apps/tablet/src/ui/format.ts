import { formatCents, parseAmount } from '@caissebox/shared';

export const dh = (cents: number | string | null | undefined) => formatCents(Number(cents ?? 0), { currency: true });
export const amount = (cents: number | string | null | undefined) => formatCents(Number(cents ?? 0));

export function parseDh(text: string): number | null {
  try {
    const c = parseAmount(text.trim() || '0');
    return c >= 0 ? c : null;
  } catch {
    return null;
  }
}

const TZ = 'Africa/Casablanca';
export const hhmm = (d: string | Date | number = new Date()) =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(d));
export const ddmm = (d: string | Date = new Date()) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: TZ }).format(new Date(d));
export const longDate = (d: Date = new Date()) => {
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase();
};
