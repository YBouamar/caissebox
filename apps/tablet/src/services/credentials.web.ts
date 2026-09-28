// Aperçu web : identifiants dans le stockage de session du navigateur.
import type { Credentials } from '../core/api';

const KEY = 'caissebox.credentials';

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(c: Credentials): Promise<void> {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(c));
  } catch {
    // stockage indisponible
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // stockage indisponible
  }
}
