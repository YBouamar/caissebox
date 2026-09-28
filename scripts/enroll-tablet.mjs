#!/usr/bin/env node
/**
 * Crée une tablette dans le parc, l'affecte au premier établissement d'un client
 * et affiche son identifiant et son secret d'enrôlement (valables une seule fois).
 *
 * Usage :
 *   API_URL=http://localhost:3000 OPERATOR_EMAIL=ops@bacybrains.ma OPERATOR_PASSWORD=... \
 *   CLIENT="Café Atlas" LABEL="Caisse 1" node scripts/enroll-tablet.mjs
 * CLIENT est facultatif (premier client de la liste sinon).
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const email = process.env.OPERATOR_EMAIL ?? 'ops@bacybrains.ma';
const password = process.env.OPERATOR_PASSWORD;
const clientName = (process.env.CLIENT ?? '').toLowerCase();
const label = process.env.LABEL ?? 'Caisse 1';

if (!password) {
  console.error('OPERATOR_PASSWORD manquant');
  process.exit(1);
}

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const op = (await call('POST', '/auth/login', null, { email, password })).token;
const tenants = await call('GET', '/console/tenants', op);
const tenant = tenants.find((t) => t.name.toLowerCase().includes(clientName)) ?? tenants[0];
if (!tenant) {
  console.error("Aucun client : créez-en un dans la console, ou lancez d'abord scripts/seed-demo.mjs");
  process.exit(1);
}
const detail = await call('GET', `/console/tenants/${tenant.id}`, op);
const est = detail.establishments[0];
const device = await call('POST', '/console/devices', op, { kind: 'tablet', serial: `TAB-${Date.now()}`, model: 'Tablette de test' });
const res = await call('POST', `/console/devices/${device.deviceId}/deploy`, op, { establishmentId: est.id, label });

console.log('');
console.log(`Tablette « ${label} » affectée à ${tenant.name} (${est.name})`);
console.log('');
console.log(`Identifiant de la tablette : ${res.deviceId}`);
console.log(`Secret d'enrôlement        : ${res.secret}`);
console.log('');
