import { describe, expect, it } from 'vitest';
import {
  allocate,
  amountForSelection,
  businessDateFor,
  cashVariance,
  changeFor,
  countTotal,
  expectedCash,
  formatOrderNumber,
  OrderLine,
  orderTotals,
  planPreparation,
  RoutingFamily,
  RoutingItem,
  splitEqually,
} from '../src';

const line = (over: Partial<OrderLine> & Pick<OrderLine, 'id' | 'itemId'>): OrderLine => ({
  name: over.itemId,
  quantity: 1,
  unitPriceCents: 1000,
  taxRateBp: 1000,
  status: 'sent',
  ...over,
});

describe('totaux du ticket', () => {
  // Ticket de la table 7 des maquettes : 239,00 DH.
  const table7: OrderLine[] = [
    line({ id: 'a', itemId: 'cafe-noir', quantity: 2, unitPriceCents: 1200 }),
    line({ id: 'b', itemId: 'nss-nss', unitPriceCents: 1400 }),
    line({ id: 'c', itemId: 'menu-cheese', unitPriceCents: 7500 }),
    line({ id: 'c1', itemId: 'coca', parentLineId: 'c', unitPriceCents: 0 }),
    line({ id: 'd', itemId: 'jus-orange', unitPriceCents: 2500 }),
    line({ id: 'e', itemId: 'tajine', unitPriceCents: 4800 }),
    line({ id: 'f', itemId: 'cafe-creme', quantity: 2, unitPriceCents: 1400, status: 'draft' }),
    line({ id: 'g', itemId: 'cappuccino', unitPriceCents: 2000, status: 'draft', options: [{ name: 'Lait d\'avoine', extraCents: 500 }] }),
  ];

  it('retrouve le total et la TVA des maquettes', () => {
    const t = orderTotals(table7);
    expect(t.totalCents).toBe(23900);
    expect(t.taxes).toEqual([{ rateBp: 1000, ttc: 23900, ht: 21727, tva: 2173 }]);
  });

  it('exclut les lignes annulées et offertes du total mais les chiffre', () => {
    const t = orderTotals([
      line({ id: 'x', itemId: 'a', unitPriceCents: 4800, status: 'voided' }),
      line({ id: 'y', itemId: 'b', unitPriceCents: 1400, status: 'comp' }),
      line({ id: 'z', itemId: 'c', unitPriceCents: 1200 }),
    ]);
    expect(t.totalCents).toBe(1200);
    expect(t.voidedCents).toBe(4800);
    expect(t.compCents).toBe(1400);
  });

  it('répartit une remise globale sans fausser la TVA', () => {
    const t = orderTotals(
      [line({ id: 'a', itemId: 'a', unitPriceCents: 3000, taxRateBp: 1000 }), line({ id: 'b', itemId: 'b', unitPriceCents: 1000, taxRateBp: 2000 })],
      1000,
    );
    expect(t.totalCents).toBe(3000);
    expect(t.taxes.reduce((s, r) => s + r.ttc, 0)).toBe(3000);
  });

  it('refuse une remise supérieure au total', () => {
    expect(() => orderTotals([line({ id: 'a', itemId: 'a' })], 2000)).toThrow();
  });
});

describe('routage des bons de préparation', () => {
  const families = new Map<string, RoutingFamily>([
    ['cafes', { id: 'cafes', printerId: 'bar' }],
    ['plats', { id: 'plats', printerId: 'cuisine' }],
    ['menus', { id: 'menus', printerId: 'cuisine' }],
    ['fraiches', { id: 'fraiches', printerId: null }],
  ]);
  const items = new Map<string, RoutingItem>([
    ['cafe', { id: 'cafe', familyId: 'cafes', kind: 'product', printerMode: 'inherit' }],
    ['tajine', { id: 'tajine', familyId: 'plats', kind: 'product', printerMode: 'inherit' }],
    ['glace', { id: 'glace', familyId: 'plats', kind: 'product', printerMode: 'printer', printerId: 'bar' }],
    ['coca', { id: 'coca', familyId: 'fraiches', kind: 'product', printerMode: 'inherit' }],
    ['burger', { id: 'burger', familyId: 'plats', kind: 'product', printerMode: 'inherit' }],
    ['menu', { id: 'menu', familyId: 'menus', kind: 'menu', printerMode: 'inherit' }],
  ]);

  it('regroupe par imprimante et respecte les surcharges', () => {
    const plan = planPreparation(
      [
        line({ id: '1', itemId: 'cafe', status: 'draft' }),
        line({ id: '2', itemId: 'tajine', status: 'draft' }),
        line({ id: '3', itemId: 'glace', status: 'draft' }),
        line({ id: '4', itemId: 'coca', status: 'draft' }),
        line({ id: '5', itemId: 'cafe', status: 'sent' }),
      ],
      items,
      families,
    );
    expect(plan).toEqual([
      { printerId: 'bar', lineIds: ['1', '3'] },
      { printerId: 'cuisine', lineIds: ['2'] },
    ]);
  });

  it('envoie chaque composant de menu vers sa propre famille', () => {
    const plan = planPreparation(
      [
        line({ id: 'm', itemId: 'menu', status: 'draft' }),
        line({ id: 'm1', itemId: 'burger', parentLineId: 'm', status: 'draft' }),
        line({ id: 'm2', itemId: 'cafe', parentLineId: 'm', status: 'draft' }),
      ],
      items,
      families,
    );
    expect(plan).toEqual([
      { printerId: 'cuisine', lineIds: ['m1'] },
      { printerId: 'bar', lineIds: ['m2'] },
    ]);
  });
});

describe('séparation de l\'addition', () => {
  it('répartit en parts égales au centime près', () => {
    expect(splitEqually(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEqually(23900, 4).reduce((a, b) => a + b, 0)).toBe(23900);
  });

  it('répartit au prorata sans perte', () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('calcule la part 1 des maquettes par articles', () => {
    const lines = [
      { id: 'creme', quantity: 2, totalCents: 2800 },
      { id: 'cappu', quantity: 1, totalCents: 2500 },
      { id: 'jus', quantity: 1, totalCents: 2500 },
    ];
    expect(amountForSelection(lines, { creme: 2, cappu: 1, jus: 1 })).toBe(7800);
  });

  it('solde exactement une ligne payée en plusieurs fois', () => {
    const l = { id: 'x', quantity: 3, totalCents: 1000 };
    const first = amountForSelection([l], { x: 1 });
    const second = amountForSelection([{ ...l, paidQuantity: 1, paidCents: first }], { x: 1 });
    const third = amountForSelection([{ ...l, paidQuantity: 2, paidCents: first + second }], { x: 1 });
    expect(first + second + third).toBe(1000);
  });

  it('refuse de payer plus que la quantité restante', () => {
    expect(() => amountForSelection([{ id: 'x', quantity: 1, totalCents: 500, paidQuantity: 1, paidCents: 500 }], { x: 1 })).toThrow();
  });

  it('calcule le rendu de monnaie', () => {
    expect(changeFor(7800, 10000)).toEqual({ appliedCents: 7800, changeCents: 2200 });
    expect(changeFor(7800, 5000)).toEqual({ appliedCents: 5000, changeCents: 0 });
  });
});

describe('caisse et journée', () => {
  it('retrouve les espèces théoriques de la clôture du 28/09', () => {
    const expected = expectedCash({ openingFloatCents: 120000, cashPaymentsCents: 648000, cashOutCents: 15000 });
    expect(expected).toBe(753000);
    expect(cashVariance(expected, 751000)).toBe(-2000);
  });

  it('compte le fond de caisse de l\'ouverture', () => {
    expect(
      countTotal({ 20000: 2, 10000: 3, 5000: 4, 2000: 5, 1000: 10, 500: 10, 200: 15, 100: 20 }),
    ).toBe(120000);
    expect(() => countTotal({ 300: 1 })).toThrow();
  });

  it('garde la date d\'ouverture pour une journée qui finit après minuit', () => {
    expect(businessDateFor(new Date('2026-09-28T05:02:00Z'))).toBe('2026-09-28');
    expect(businessDateFor(new Date('2026-09-28T23:30:00Z'))).toBe('2026-09-29');
  });

  it('numérote les tickets par poste', () => {
    expect(formatOrderNumber('C1', 147)).toBe('C1-0147');
    expect(() => formatOrderNumber('c1', 1)).toThrow();
  });
});
