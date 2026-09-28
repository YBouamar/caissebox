import { Cents, formatCents } from '../money';
import { formatRate, TaxBreakdownRow } from '../tax';
import { EscPosBuilder, PaperWidth } from './builder';
import { Codepage } from './encoding';

export interface PrinterConfig {
  paperWidth: PaperWidth;
  codepage?: Codepage;
}

export function formatDateTime(date: Date, timeZone = 'Africa/Casablanca'): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

const money = (c: Cents) => formatCents(c, { ascii: true });

export interface ReceiptEstablishment {
  name: string;
  legalName?: string | null;
  address?: string | null;
  ice?: string | null;
  ifNumber?: string | null;
  rc?: string | null;
  patente?: string | null;
  header?: string | null;
  footer?: string | null;
}

export interface ReceiptData {
  establishment: ReceiptEstablishment;
  number: string;
  place: string;
  waiterName: string;
  date: Date;
  timeZone?: string;
  lines: readonly { quantity: number; name: string; totalCents: Cents; details?: readonly string[]; comp?: boolean }[];
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
  taxes: readonly TaxBreakdownRow[];
  payments: readonly { label: string; amountCents: Cents }[];
  changeCents: Cents;
  /** Réimpression : numéro du duplicata (1, 2...). */
  duplicate?: number;
  /** Addition non encore réglée. */
  proForma?: boolean;
  callNumber?: number | null;
  openDrawer?: boolean;
}

export function customerReceipt(data: ReceiptData, printer: PrinterConfig): Uint8Array {
  const p = new EscPosBuilder(printer.paperWidth, printer.codepage);
  const e = data.establishment;

  p.align('center').bold().size('double').line(e.name).size('normal').bold(false);
  for (const value of [e.legalName, e.address, e.header]) if (value) p.line(value);
  const ids = [e.ice && `ICE ${e.ice}`, e.ifNumber && `IF ${e.ifNumber}`, e.rc && `RC ${e.rc}`, e.patente && `TP ${e.patente}`]
    .filter(Boolean)
    .join(' - ');
  if (ids) p.line(ids);

  if (data.duplicate) p.feed(1).bold().line(`*** DUPLICATA N° ${data.duplicate} ***`).bold(false);
  if (data.proForma) p.feed(1).bold().line('ADDITION - CECI N\'EST PAS UN TICKET DE CAISSE').bold(false);

  p.align('left').separator();
  p.pair(`Ticket ${data.number}`, formatDateTime(data.date, data.timeZone));
  p.pair(data.place, data.waiterName);
  if (data.callNumber) {
    p.align('center').bold().size('double').line(`N° ${data.callNumber}`).size('normal').bold(false).align('left');
  }
  p.separator();

  for (const line of data.lines) {
    p.pair(`${line.quantity} x ${line.name}`, line.comp ? 'OFFERT' : money(line.totalCents));
    for (const d of line.details ?? []) p.line(`   ${d}`);
  }
  p.separator();

  if (data.discountCents > 0) {
    p.pair('Sous-total', money(data.subtotalCents));
    p.pair('Remise', `-${money(data.discountCents)}`);
  }
  p.bold().size('tall').pair('TOTAL TTC', `${money(data.totalCents)} DH`).size('normal').bold(false);

  for (const t of data.taxes) {
    p.pair(`TVA ${formatRate(t.rateBp)} sur ${money(t.ht)} HT`, money(t.tva));
  }

  if (data.payments.length) {
    p.separator();
    for (const pay of data.payments) p.pair(pay.label, money(pay.amountCents));
    if (data.changeCents > 0) p.pair('Rendu', money(data.changeCents));
  }

  p.feed(1).align('center');
  if (e.footer) p.line(e.footer);
  p.feed(3).cut();
  if (data.openDrawer) p.openDrawer();
  return p.bytes();
}

export interface PreparationData {
  kind: 'prep' | 'void';
  printerName: string;
  number: string;
  place: string;
  waiterName: string;
  date: Date;
  timeZone?: string;
  callNumber?: number | null;
  lines: readonly { quantity: number; name: string; details?: readonly string[]; note?: string | null; menuName?: string | null }[];
}

/** Bon de préparation : gros caractères, lisible de loin en cuisine. */
export function preparationTicket(data: PreparationData, printer: PrinterConfig): Uint8Array {
  const p = new EscPosBuilder(printer.paperWidth, printer.codepage);
  p.align('center');
  if (data.kind === 'void') p.bold().size('double').line('*** ANNULATION ***').size('normal').bold(false);
  p.bold().size('double').line(data.callNumber ? `N° ${data.callNumber}` : data.place).size('normal').bold(false);
  p.line(`${data.printerName} - ${data.number}`);
  p.line(`${data.waiterName} - ${formatDateTime(data.date, data.timeZone)}`);
  p.align('left').separator('=');
  for (const line of data.lines) {
    p.bold().size('tall').line(`${line.quantity} x ${line.name}`).size('normal').bold(false);
    if (line.menuName) p.line(`   (${line.menuName})`);
    for (const d of line.details ?? []) p.line(`   + ${d}`);
    if (line.note) p.bold().line(`   NOTE : ${line.note}`).bold(false);
  }
  p.separator('=').feed(3).cut();
  return p.bytes();
}
