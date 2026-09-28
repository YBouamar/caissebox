/**
 * Tous les montants sont des entiers en centimes de dirham.
 * Aucun calcul monétaire ne passe par des décimaux flottants stockés.
 */
export type Cents = number;

export function assertCents(value: number, label = 'montant'): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} doit être un entier en centimes (reçu ${value})`);
  }
}

/** Division entière arrondie au plus proche, les demis s'éloignant de zéro. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError('Division par zéro');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total, 'total');
  return total;
}

/**
 * Formate des centimes : 123450 → "1 234,50".
 * `ascii` remplace le séparateur de milliers et le signe moins par des caractères
 * que toutes les imprimantes thermiques savent afficher.
 */
export function formatCents(cents: Cents, opts: { currency?: boolean; ascii?: boolean } = {}): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100).toString();
  const decimals = (abs % 100).toString().padStart(2, '0');
  const thousands = opts.ascii ? ' ' : ' ';
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const minus = opts.ascii ? '-' : '−';
  const text = `${negative ? minus : ''}${grouped},${decimals}`;
  return opts.currency ? `${text} DH` : text;
}

/** Analyse une saisie utilisateur ("12", "12,5", "1 234.50") en centimes. */
export function parseAmount(input: string): Cents {
  const cleaned = input.replace(/[\s  ]/g, '').replace(/DH$/i, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new RangeError(`Montant invalide : "${input}"`);
  }
  const negative = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}
