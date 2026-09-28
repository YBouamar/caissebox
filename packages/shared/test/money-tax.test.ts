import { describe, expect, it } from 'vitest';
import { divRound, formatCents, formatRate, parseAmount, splitTTC, sumCents, taxBreakdown } from '../src';

describe('argent', () => {
  it('formate les centimes à la française', () => {
    expect(formatCents(123450, { ascii: true })).toBe('1 234,50');
    expect(formatCents(-2000, { ascii: true, currency: true })).toBe('-20,00 DH');
    expect(formatCents(5)).toBe('0,05');
  });

  it('analyse les saisies usuelles', () => {
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('12,5')).toBe(1250);
    expect(parseAmount('1 234.50 DH')).toBe(123450);
    expect(() => parseAmount('12,345')).toThrow();
    expect(() => parseAmount('abc')).toThrow();
  });

  it('arrondit les demis en s\'éloignant de zéro', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
  });

  it('refuse les montants non entiers', () => {
    expect(() => sumCents([10, 0.5])).toThrow();
  });
});

describe('TVA', () => {
  it('décompose la journée du 28/09 comme sur le rapport Z', () => {
    expect(splitTTC(1052000, 1000)).toEqual({ ht: 956364, tva: 95636 });
  });

  it('ventile par taux sans perdre de centime', () => {
    const rows = taxBreakdown([
      { ttc: 1200, rateBp: 1000 },
      { ttc: 1450, rateBp: 1000 },
      { ttc: 3000, rateBp: 2000 },
    ]);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.ht + r.tva).toBe(r.ttc);
    expect(rows[0]).toMatchObject({ rateBp: 1000, ttc: 2650 });
  });

  it('affiche les taux', () => {
    expect(formatRate(1000)).toBe('10 %');
    expect(formatRate(550)).toBe('5,5 %');
  });
});
