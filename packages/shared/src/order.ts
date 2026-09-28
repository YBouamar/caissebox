import { assertCents, Cents, sumCents } from './money';
import { allocate } from './split';
import { RateBp, TaxBreakdownRow, taxBreakdown } from './tax';

export type LineStatus = 'draft' | 'sent' | 'voided' | 'comp';

export interface LineOption {
  name: string;
  extraCents: Cents;
}

export interface OrderLine {
  id: string;
  parentLineId?: string | null;
  itemId: string;
  name: string;
  quantity: number;
  unitPriceCents: Cents;
  taxRateBp: RateBp;
  discountCents?: Cents;
  status: LineStatus;
  options?: readonly LineOption[];
  note?: string | null;
}

/** Valeur brute d'une ligne : (prix unitaire + suppléments) × quantité. */
export function lineGross(line: OrderLine): Cents {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw new RangeError(`Quantité invalide sur « ${line.name} »`);
  }
  assertCents(line.unitPriceCents);
  const extras = sumCents((line.options ?? []).map((o) => o.extraCents));
  return (line.unitPriceCents + extras) * line.quantity;
}

/** Montant dû pour une ligne : 0 si annulée ou offerte. */
export function lineTotal(line: OrderLine): Cents {
  if (line.status === 'voided' || line.status === 'comp') return 0;
  const gross = lineGross(line);
  const discount = line.discountCents ?? 0;
  assertCents(discount);
  if (discount < 0 || discount > gross) throw new RangeError(`Remise invalide sur « ${line.name} »`);
  return gross - discount;
}

export interface OrderTotals {
  subtotalCents: Cents;
  orderDiscountCents: Cents;
  totalCents: Cents;
  taxes: TaxBreakdownRow[];
  compCents: Cents;
  voidedCents: Cents;
}

/**
 * Totaux d'un ticket. La remise globale est répartie sur les lignes au prorata
 * pour que la ventilation de TVA reste exacte.
 */
export function orderTotals(lines: readonly OrderLine[], orderDiscountCents: Cents = 0): OrderTotals {
  assertCents(orderDiscountCents);
  const totals = lines.map(lineTotal);
  const subtotalCents = sumCents(totals);
  if (orderDiscountCents < 0 || orderDiscountCents > subtotalCents) {
    throw new RangeError('La remise dépasse le total du ticket');
  }
  const discountShares = subtotalCents > 0 ? allocate(orderDiscountCents, totals) : totals.map(() => 0);
  const taxes = taxBreakdown(
    lines.map((line, i) => ({ ttc: (totals[i] ?? 0) - (discountShares[i] ?? 0), rateBp: line.taxRateBp })),
  ).filter((row) => row.ttc !== 0);
  return {
    subtotalCents,
    orderDiscountCents,
    totalCents: subtotalCents - orderDiscountCents,
    taxes,
    compCents: sumCents(lines.filter((l) => l.status === 'comp').map(lineGross)),
    voidedCents: sumCents(lines.filter((l) => l.status === 'voided').map(lineGross)),
  };
}

// Routage vers les imprimantes de préparation -----------------------------------

export interface RoutingItem {
  id: string;
  familyId: string;
  kind: 'product' | 'menu';
  printerMode: 'inherit' | 'none' | 'printer';
  printerId?: string | null;
}

export interface RoutingFamily {
  id: string;
  printerId?: string | null;
}

/** Imprimante de préparation d'un article : la sienne, celle de sa famille, ou aucune. */
export function preparationPrinterFor(
  item: RoutingItem,
  families: ReadonlyMap<string, RoutingFamily>,
): string | null {
  if (item.printerMode === 'none') return null;
  if (item.printerMode === 'printer') return item.printerId ?? null;
  return families.get(item.familyId)?.printerId ?? null;
}

export interface PreparationBatch {
  printerId: string;
  lineIds: string[];
}

/**
 * Regroupe les lignes à envoyer : un seul bon par imprimante et par envoi.
 * La ligne « menu » elle-même n'est pas imprimée quand elle a des composants :
 * chaque composant part vers l'imprimante de sa propre famille.
 */
export function planPreparation(
  lines: readonly OrderLine[],
  items: ReadonlyMap<string, RoutingItem>,
  families: ReadonlyMap<string, RoutingFamily>,
): PreparationBatch[] {
  const toSend = lines.filter((l) => l.status === 'draft');
  const parentsWithChildren = new Set(toSend.map((l) => l.parentLineId).filter((id): id is string => !!id));
  const batches = new Map<string, string[]>();
  for (const line of toSend) {
    if (parentsWithChildren.has(line.id)) continue;
    const item = items.get(line.itemId);
    if (!item) throw new RangeError(`Article inconnu : ${line.itemId}`);
    const printerId = preparationPrinterFor(item, families);
    if (!printerId) continue;
    const ids = batches.get(printerId) ?? [];
    ids.push(line.id);
    batches.set(printerId, ids);
  }
  return [...batches.entries()].map(([printerId, lineIds]) => ({ printerId, lineIds }));
}

/** Numéro de ticket continu par poste : « C1 » + 147 → « C1-0147 ». */
export function formatOrderNumber(registerPrefix: string, counter: number): string {
  if (!/^[A-Z0-9]{1,4}$/.test(registerPrefix)) throw new RangeError('Préfixe de poste invalide');
  if (!Number.isInteger(counter) || counter < 1) throw new RangeError('Compteur invalide');
  return `${registerPrefix}-${String(counter).padStart(4, '0')}`;
}
