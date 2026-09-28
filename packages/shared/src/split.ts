import { assertCents, Cents, divRound, sumCents } from './money';

/**
 * Répartit `total` selon des poids, sans perdre ni créer de centime
 * (méthode du plus fort reste). La somme du résultat vaut toujours `total`.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) throw new RangeError('Aucune part à répartir');
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) throw new RangeError('Poids négatif ou invalide');
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    return allocate(total, weights.map(() => 1));
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / weightSum);
  const floors = raw.map(Math.floor);
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (remainder === 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    remainder -= 1;
  }
  return floors.map((v) => v * sign);
}

/** Parts égales : 100,00 DH en 3 → 33,34 + 33,33 + 33,33. */
export function splitEqually(total: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('Nombre de parts invalide');
  return allocate(total, Array.from({ length: parts }, () => 1));
}

export interface SplittableLine {
  id: string;
  quantity: number;
  totalCents: Cents;
  /** Quantité et montant déjà réglés par des parts précédentes. */
  paidQuantity?: number;
  paidCents?: Cents;
}

/**
 * Montant d'une sélection d'articles (séparation « par articles »).
 * Quand la sélection solde une ligne, on prend exactement ce qui reste dû sur
 * cette ligne : la somme de toutes les parts retombe sur le total du ticket.
 */
export function amountForSelection(
  lines: readonly SplittableLine[],
  selection: Readonly<Record<string, number>>,
): Cents {
  let amount = 0;
  for (const [lineId, qty] of Object.entries(selection)) {
    if (qty === 0) continue;
    const line = lines.find((l) => l.id === lineId);
    if (!line) throw new RangeError(`Ligne inconnue : ${lineId}`);
    const paidQty = line.paidQuantity ?? 0;
    const paidCents = line.paidCents ?? 0;
    if (!Number.isInteger(qty) || qty < 0 || qty > line.quantity - paidQty) {
      throw new RangeError(`Quantité sélectionnée invalide pour la ligne ${lineId}`);
    }
    amount += qty + paidQty === line.quantity ? line.totalCents - paidCents : divRound(line.totalCents * qty, line.quantity);
  }
  assertCents(amount);
  return amount;
}

export function remainingDue(totalCents: Cents, payments: readonly { amountCents: Cents }[]): Cents {
  return totalCents - sumCents(payments.map((p) => p.amountCents));
}

/** Rendu de monnaie : seulement sur les espèces, jamais négatif. */
export function changeFor(dueCents: Cents, tenderedCents: Cents): { appliedCents: Cents; changeCents: Cents } {
  assertCents(dueCents);
  assertCents(tenderedCents);
  if (dueCents <= 0) throw new RangeError('Rien à payer');
  if (tenderedCents <= 0) throw new RangeError('Montant reçu invalide');
  const appliedCents = Math.min(dueCents, tenderedCents);
  return { appliedCents, changeCents: Math.max(0, tenderedCents - dueCents) };
}
