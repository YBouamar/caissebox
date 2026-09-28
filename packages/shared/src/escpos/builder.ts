import { Codepage, CODEPAGE_SELECTOR, encodeText } from './encoding';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type PaperWidth = 58 | 80;
export type Align = 'left' | 'center' | 'right';
export type TextSize = 'normal' | 'tall' | 'wide' | 'double';

/** Nombre de caractères par ligne en police A. */
export const COLUMNS: Readonly<Record<PaperWidth, number>> = { 58: 32, 80: 48 };

const SIZE_BYTE: Readonly<Record<TextSize, number>> = { normal: 0x00, tall: 0x01, wide: 0x10, double: 0x11 };

/**
 * Construit un flux ESC/POS. Le module d'impression natif (Bluetooth ou Wi-Fi)
 * se contente d'envoyer ces octets tels quels à l'imprimante.
 */
export class EscPosBuilder {
  private readonly chunks: number[] = [];
  private currentSize: TextSize = 'normal';
  readonly columns: number;

  constructor(
    readonly paperWidth: PaperWidth = 80,
    readonly codepage: Codepage = 'cp858',
  ) {
    this.columns = COLUMNS[paperWidth];
    this.init();
  }

  private raw(...bytes: number[]): this {
    this.chunks.push(...bytes);
    return this;
  }

  init(): this {
    return this.raw(ESC, 0x40, ESC, 0x74, CODEPAGE_SELECTOR[this.codepage]);
  }

  align(value: Align): this {
    return this.raw(ESC, 0x61, value === 'left' ? 0 : value === 'center' ? 1 : 2);
  }

  bold(on = true): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  size(value: TextSize): this {
    this.currentSize = value;
    return this.raw(GS, 0x21, SIZE_BYTE[value]);
  }

  /** Colonnes disponibles avec la taille de texte courante. */
  get width(): number {
    return this.currentSize === 'wide' || this.currentSize === 'double' ? Math.floor(this.columns / 2) : this.columns;
  }

  text(value: string): this {
    this.chunks.push(...encodeText(value, this.codepage));
    return this;
  }

  /** Écrit une ligne en coupant proprement les mots trop longs pour le papier. */
  line(value = ''): this {
    for (const part of wrap(value, this.width)) {
      this.text(part).raw(LF);
    }
    return this;
  }

  /** Libellé à gauche, montant aligné à droite. */
  pair(left: string, right: string): this {
    const width = this.width;
    const room = width - right.length - 1;
    const lines = wrap(left, Math.max(room, 1));
    lines.forEach((l, i) => {
      if (i === lines.length - 1) {
        this.text(l + ' '.repeat(Math.max(width - l.length - right.length, 1)) + right).raw(LF);
      } else {
        this.text(l).raw(LF);
      }
    });
    return this;
  }

  separator(char = '-'): this {
    return this.text(char.repeat(this.width)).raw(LF);
  }

  feed(lines = 1): this {
    return this.raw(ESC, 0x64, Math.max(0, Math.min(lines, 255)));
  }

  /** Coupe partielle après avance du papier. */
  cut(): this {
    return this.raw(GS, 0x56, 0x42, 0x03);
  }

  /** Impulsion d'ouverture du tiroir-caisse branché sur l'imprimante. */
  openDrawer(): this {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export function wrap(text: string, width: number): string[] {
  if (text === '') return [''];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (let word of words) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ' ' + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
