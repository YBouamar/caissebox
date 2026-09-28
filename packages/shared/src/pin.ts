import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

/**
 * Hachage des codes PIN du personnel.
 * Le même code tourne sur le serveur (Node) et sur la tablette (React Native),
 * car la tablette doit vérifier un PIN sans réseau.
 *
 * Limite assumée : un PIN à 4 chiffres n'a que 10 000 valeurs. Le hachage
 * protège contre la lecture directe ; la vraie protection est le chiffrement de
 * la base locale, le mode kiosque et l'effacement à distance de la tablette.
 */
const ITERATIONS = 20000;

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function hashPin(pin: string, salt: Uint8Array = randomBytes(16)): string {
  if (!isValidPin(pin)) throw new RangeError('Le PIN doit comporter 4 chiffres');
  const hash = pbkdf2(sha256, pin, salt, { c: ITERATIONS, dkLen: 32 });
  return `pbkdf2-sha256$${ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !isValidPin(pin)) return false;
  const [algo, iter, saltHex, hashHex] = stored.split('$');
  if (algo !== 'pbkdf2-sha256' || !iter || !saltHex || !hashHex) return false;
  const expected = hexToBytes(hashHex);
  const actual = pbkdf2(sha256, pin, hexToBytes(saltHex), { c: Number(iter), dkLen: expected.length });
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
  return diff === 0 && actual.length === expected.length;
}
