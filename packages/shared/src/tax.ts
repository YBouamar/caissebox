import { assertCents, Cents, divRound } from './money';

/** Taux en points de base : 1000 = 10 %. */
export type RateBp = number;

export const DEFAULT_TAX_RATE_BP: RateBp = 1000;

export function assertRate(rateBp: number): asserts rateBp is RateBp {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
    throw new RangeError(`Taux de TVA invalide : ${rateBp}`);
  }
}

/** Décompose un montant TTC en HT et TVA (les prix sont saisis TTC). */
export function splitTTC(ttc: Cents, rateBp: RateBp): { ht: Cents; tva: Cents } {
  assertCents(ttc);
  assertRate(rateBp);
  const ht = divRound(ttc * 10000, 10000 + rateBp);
  return { ht, tva: ttc - ht };
}

export interface TaxBreakdownRow {
  rateBp: RateBp;
  ttc: Cents;
  ht: Cents;
  tva: Cents;
}

/**
 * Ventilation par taux : on additionne d'abord les TTC de chaque taux, puis on
 * calcule la TVA une seule fois par taux. Ainsi la somme HT + TVA retombe
 * toujours exactement sur le TTC du ticket.
 */
export function taxBreakdown(entries: readonly { ttc: Cents; rateBp: RateBp }[]): TaxBreakdownRow[] {
  const byRate = new Map<RateBp, Cents>();
  for (const e of entries) {
    assertCents(e.ttc);
    assertRate(e.rateBp);
    byRate.set(e.rateBp, (byRate.get(e.rateBp) ?? 0) + e.ttc);
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateBp, ttc]) => ({ rateBp, ttc, ...splitTTC(ttc, rateBp) }));
}

export function formatRate(rateBp: RateBp): string {
  assertRate(rateBp);
  const whole = Math.floor(rateBp / 100);
  const frac = rateBp % 100;
  return frac === 0 ? `${whole} %` : `${whole},${String(frac).padStart(2, '0').replace(/0$/, '')} %`;
}
