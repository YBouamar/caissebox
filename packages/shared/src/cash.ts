import { assertCents, Cents, sumCents } from './money';

export interface CashSessionFigures {
  openingFloatCents: Cents;
  /** Somme des paiements en espèces effectivement encaissés (hors rendu). */
  cashPaymentsCents: Cents;
  cashInCents?: Cents;
  cashOutCents?: Cents;
  /** Remises d'espèces des serveurs qui encaissent eux-mêmes. */
  waiterHandoversCents?: Cents;
}

/** Espèces théoriques = fond + encaissé + apports + remises serveurs − sorties. */
export function expectedCash(f: CashSessionFigures): Cents {
  const parts = [
    f.openingFloatCents,
    f.cashPaymentsCents,
    f.cashInCents ?? 0,
    f.waiterHandoversCents ?? 0,
    -(f.cashOutCents ?? 0),
  ];
  return sumCents(parts);
}

/** Écart : positif = excédent, négatif = manque. */
export function cashVariance(expectedCents: Cents, countedCents: Cents): Cents {
  assertCents(expectedCents);
  assertCents(countedCents);
  return countedCents - expectedCents;
}

export const MAD_DENOMINATIONS_CENTS: readonly Cents[] = [
  20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10,
];

/** Total d'un comptage par billets et pièces : { 20000: 2, 100: 20 } → 42 000 centimes. */
export function countTotal(counts: Readonly<Record<number, number>>): Cents {
  let total = 0;
  for (const [denomination, count] of Object.entries(counts)) {
    const d = Number(denomination);
    if (!MAD_DENOMINATIONS_CENTS.includes(d)) throw new RangeError(`Coupure inconnue : ${denomination}`);
    if (!Number.isInteger(count) || count < 0) throw new RangeError(`Nombre invalide pour ${denomination}`);
    total += d * count;
  }
  return total;
}

/**
 * Date d'exploitation d'une journée : la date locale de son ouverture.
 * Une journée ouverte le 28 à 06:02 et clôturée le 29 à 01:47 reste celle du 28.
 */
export function businessDateFor(openedAt: Date, timeZone = 'Africa/Casablanca'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(openedAt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
