import { describe, expect, it } from 'vitest';
import {
  authorize,
  customerReceipt,
  DEFAULT_ROLES,
  discountWithinLimit,
  encodeText,
  EscPosBuilder,
  preparationTicket,
  pushRequestSchema,
  WRITE_RULES,
  wrap,
} from '../src';

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('ESC/POS', () => {
  it('initialise l\'imprimante et choisit la page de codes', () => {
    const bytes = new EscPosBuilder(80, 'cp858').bytes();
    expect([...bytes]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
  });

  it('encode les accents français en CP858 et WPC1252', () => {
    expect([...encodeText('Café crème', 'cp858')]).toEqual([...Buffer.from('Caf'), 0x82, ...Buffer.from(' cr'), 0x8a, ...Buffer.from('me')]);
    expect([...encodeText('é', 'wpc1252')]).toEqual([0xe9]);
    expect([...encodeText('Jus d’orange – 25 €', 'cp858')]).toEqual([...Buffer.from("Jus d'orange - 25 "), 0xd5]);
  });

  it('remplace les caractères inconnus sans casser le flux', () => {
    expect(decode(encodeText('ş☕', 'cp858'))).toBe('s?');
  });

  it('coupe les lignes trop longues', () => {
    expect(wrap('Menu Cheese Burger avec supplément fromage', 20)).toEqual(['Menu Cheese Burger', 'avec supplément', 'fromage']);
  });

  it('aligne libellé et montant sur toute la largeur', () => {
    const p = new EscPosBuilder(58);
    p.pair('Total', '239,00');
    const text = decode(p.bytes()).slice(5);
    expect(text).toBe('Total' + ' '.repeat(32 - 5 - 6) + '239,00\n');
  });

  it('imprime un ticket client complet', () => {
    const bytes = customerReceipt(
      {
        establishment: { name: 'Café Atlas', ice: '[à paramétrer]', footer: 'Merci de votre visite' },
        number: 'C1-0147',
        place: 'Table 7',
        waiterName: 'Karim B.',
        date: new Date('2026-09-28T13:21:00Z'),
        lines: [
          { quantity: 2, name: 'Café crème', totalCents: 2800 },
          { quantity: 1, name: 'Cappuccino', totalCents: 2500, details: ['Lait d\'avoine +5,00'] },
        ],
        subtotalCents: 5300,
        discountCents: 0,
        totalCents: 5300,
        taxes: [{ rateBp: 1000, ttc: 5300, ht: 4818, tva: 482 }],
        payments: [{ label: 'Espèces', amountCents: 5300 }],
        changeCents: 4700,
        openDrawer: true,
      },
      { paperWidth: 80 },
    );
    const text = decode(bytes);
    expect(text).toContain('C1-0147');
    expect(text).toContain('28/09/2026 14:21');
    expect(text).toContain('53,00 DH');
    expect(text).toContain('TVA 10 % sur 48,18 HT');
    expect(text).toContain('Rendu');
    expect([...bytes.slice(-5)]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it('marque les duplicatas et les bons d\'annulation', () => {
    const dup = customerReceipt(
      {
        establishment: { name: 'Café Atlas' }, number: 'C1-1', place: 'Comptoir', waiterName: 'Y', date: new Date(),
        lines: [], subtotalCents: 0, discountCents: 0, totalCents: 0, taxes: [], payments: [], changeCents: 0, duplicate: 2,
      },
      { paperWidth: 58 },
    );
    expect(decode(dup)).toContain('DUPLICATA N');
    const voided = preparationTicket(
      { kind: 'void', printerName: 'Cuisine', number: 'C1-1', place: 'Table 7', waiterName: 'Karim', date: new Date(), lines: [{ quantity: 1, name: 'Tajine poulet' }] },
      { paperWidth: 80 },
    );
    expect(decode(voided)).toContain('ANNULATION');
  });
});

describe('protocole de synchronisation', () => {
  const op = {
    opId: '5b4e7c1e-8d2a-4f7b-9a1c-2f3e4d5c6b7a',
    deviceSeq: 1,
    entity: 'orders',
    entityId: '0f1e2d3c-4b5a-4968-8776-655443322110',
    kind: 'insert',
    data: { number: 'C1-0001' },
    createdAt: '2026-09-28T13:21:00+01:00',
  };

  it('valide un lot correct', () => {
    expect(pushRequestSchema.parse({ protocol: 1, ops: [op] }).ops).toHaveLength(1);
  });

  it('refuse une entité non synchronisable ou un nom de colonne suspect', () => {
    expect(() => pushRequestSchema.parse({ protocol: 1, ops: [{ ...op, entity: 'users' }] })).toThrow();
    expect(() => pushRequestSchema.parse({ protocol: 1, ops: [{ ...op, data: { 'number; drop table': 1 } }] })).toThrow();
  });

  it('ne laisse jamais une tablette fixer le client ou l\'établissement', () => {
    for (const rule of Object.values(WRITE_RULES)) {
      expect(rule.insert).not.toContain('tenant_id');
      expect(rule.insert).not.toContain('establishment_id');
      expect(rule.patch).not.toContain('tenant_id');
    }
  });

  it('garde les paiements en ajout seul', () => {
    expect(WRITE_RULES.payments.patch).toEqual([]);
    expect(WRITE_RULES.customer_ledger.patch).toEqual([]);
  });
});

describe('droits', () => {
  const serveur = DEFAULT_ROLES.find((r) => r.name === 'Serveur')!.permissions;
  it('demande le PIN manager pour une ligne envoyée', () => {
    expect(authorize(serveur, 'line.void_sent')).toEqual({ allowed: false, needsManager: true });
    expect(authorize(serveur, 'order.take')).toEqual({ allowed: true });
  });
  it('bloque les remises hors plafond', () => {
    expect(discountWithinLimit(serveur, 500)).toBe(false);
    expect(discountWithinLimit(serveur, 0)).toBe(true);
  });
});
