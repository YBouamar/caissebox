import * as SecureStore from 'expo-secure-store';
import type { Credentials } from '../core/api';

const KEY = 'caissebox.credentials';

/** Identifiants d'enrôlement, conservés dans le coffre Android et jamais dans la base. */
export async function loadCredentials(): Promise<Credentials | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Credentials;
    return c.baseUrl && c.deviceId && c.secret ? c : null;
  } catch {
    return null;
  }
}

export async function saveCredentials(c: Credentials): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(c));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
