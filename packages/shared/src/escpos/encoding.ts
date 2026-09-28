/**
 * Encodage du texte pour imprimantes thermiques ESC/POS.
 * La plupart des modèles acceptent CP858 (ESC t 19) ; d'autres préfèrent
 * WPC1252 (ESC t 16). Le choix se règle par imprimante.
 */
export type Codepage = 'cp858' | 'wpc1252';

export const CODEPAGE_SELECTOR: Readonly<Record<Codepage, number>> = {
  cp858: 19,
  wpc1252: 16,
};

const CP858: Readonly<Record<string, number>> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87, ê: 0x88, ë: 0x89,
  è: 0x8a, ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f, É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93,
  ö: 0x94, ò: 0x95, û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99, Ü: 0x9a, ø: 0x9b, '£': 0x9c, Ø: 0x9d,
  '×': 0x9e, á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ª: 0xa6, º: 0xa7, '¿': 0xa8,
  '«': 0xae, '»': 0xaf, Á: 0xb5, Â: 0xb6, À: 0xb7, ã: 0xc6, Ã: 0xc7, Ê: 0xd2, Ë: 0xd3, È: 0xd4,
  '€': 0xd5, Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ó: 0xe0, ß: 0xe1, Ô: 0xe2, Ò: 0xe3, õ: 0xe4, Õ: 0xe5,
  Ú: 0xe9, Û: 0xea, Ù: 0xeb, '°': 0xf8, '·': 0xfa,
};

const WPC1252_EXTRA: Readonly<Record<string, number>> = {
  '€': 0x80, Œ: 0x8c, œ: 0x9c,
};

/** Remplace la typographie fine par des caractères imprimables partout. */
function normalize(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/Œ/g, 'OE')
    .replace(/œ/g, 'oe');
}

function stripDiacritics(ch: string): string {
  return ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function encodeText(text: string, codepage: Codepage): Uint8Array {
  const out: number[] = [];
  for (const ch of normalize(text)) {
    const code = ch.codePointAt(0) ?? 63;
    if (code >= 0x20 && code < 0x7f) {
      out.push(code);
      continue;
    }
    if (ch === '\n') {
      out.push(0x0a);
      continue;
    }
    let byte: number | undefined;
    if (codepage === 'cp858') {
      byte = CP858[ch];
    } else {
      byte = WPC1252_EXTRA[ch] ?? (code >= 0xa0 && code <= 0xff ? code : undefined);
    }
    if (byte !== undefined) {
      out.push(byte);
      continue;
    }
    const plain = stripDiacritics(ch);
    if (plain.length === 1 && plain.charCodeAt(0) < 0x7f) {
      out.push(plain.charCodeAt(0));
    } else {
      out.push(0x3f);
    }
  }
  return Uint8Array.from(out);
}
