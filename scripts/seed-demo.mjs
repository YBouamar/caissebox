#!/usr/bin/env node
/**
 * Jeu de démonstration CaisseBox, créé uniquement par l'API (console, back-office, synchronisation),
 * exactement comme en production. Utile pour une démo commerciale ou pour tester le back-office.
 *
 * Usage :
 *   API_URL=http://localhost:3000 OPERATOR_EMAIL=ops@bacybrains.ma OPERATOR_PASSWORD=... node scripts/seed-demo.mjs
 *
 * Crée le client « Café Atlas (démo) », sa carte, son équipe, une tablette, puis 7 journées de ventes.
 * Le compte gérant créé : demo@caissebox.ma / demo-caissebox
 */
import { randomUUID } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3000';
const OP_EMAIL = process.env.OPERATOR_EMAIL ?? 'ops@bacybrains.ma';
const OP_PASSWORD = process.env.OPERATOR_PASSWORD;
const OWNER_EMAIL = process.env.DEMO_EMAIL ?? 'demo@caissebox.ma';
const OWNER_PASSWORD = 'demo-caissebox';
const DAYS = Number(process.env.DEMO_DAYS ?? 7);

if (!OP_PASSWORD) {
  console.error('OPERATOR_PASSWORD manquant');
  process.exit(1);
}

let rnd = 42;
const random = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (arr) => arr[Math.floor(random() * arr.length)];

async function call(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return data;
}

const op = (await call('POST', '/auth/login', null, { email: OP_EMAIL, password: OP_PASSWORD })).token;

const tenant = await call('POST', '/console/tenants', op, {
  name: 'Café Atlas (démo)',
  legalName: 'ATLAS CAFE SARL',
  ice: '002345678000091',
  address: '12, boulevard d’Anfa, Casablanca',
  owner: { email: OWNER_EMAIL, fullName: 'Yassine Démo', password: OWNER_PASSWORD },
  establishment: { name: 'Café Atlas Maarif', address: '12, boulevard d’Anfa, Casablanca' },
});
const E = tenant.establishmentId;
const owner = (await call('POST', '/auth/login', null, { email: OWNER_EMAIL, password: OWNER_PASSWORD })).token;
const bo = (method, path, body) => call(method, `/bo${path}`, owner, body);

await bo('PATCH', `/establishments/${E}`, {
  receipt_header: 'Café Atlas\n12, bd d’Anfa, Casablanca\nICE 002345678000091',
  receipt_footer: 'Merci et à bientôt !',
});

// Imprimantes
const caisse = await bo('POST', '/r/printers', { establishment_id: E, name: 'Caisse', connection: 'bluetooth', address: '00:11:22:AA:BB:01', paper_width_mm: 80, prints_receipts: true, opens_drawer: true });
const bar = await bo('POST', '/r/printers', { establishment_id: E, name: 'Bar', connection: 'wifi', address: '192.168.1.51', prints_preparation: true });
const cuisine = await bo('POST', '/r/printers', { establishment_id: E, name: 'Cuisine', connection: 'wifi', address: '192.168.1.52', prints_preparation: true });
void caisse;

// Carte
const CARTE = [
  ['Cafés', '#A16207', bar.id, [['Café noir', 1200], ['Café crème', 1400], ['Nss nss', 1400], ['Espresso', 1200], ['Cappuccino', 2000], ['Latte', 2200]]],
  ['Thés', '#15803D', bar.id, [['Thé à la menthe', 1200], ['Thé noir', 1200], ['Infusion verveine', 1400]]],
  ['Jus', '#EA8A00', bar.id, [['Jus d’orange', 1800], ['Jus d’avocat', 2500], ['Panaché', 2500]]],
  ['Boissons fraîches', '#0369A1', bar.id, [['Eau minérale 50 cl', 800], ['Coca-Cola 33 cl', 1200], ['Poms 33 cl', 1200]]],
  ['Petit-déjeuner', '#B45309', cuisine.id, [['Msemen au miel', 1200], ['Harcha', 1000], ['Baghrir', 1200], ['Omelette', 2500]]],
  ['Plats', '#7C3AED', cuisine.id, [['Cheese burger', 5500], ['Panini poulet', 3500], ['Salade marocaine', 3000], ['Tajine kefta', 6500]]],
  ['Desserts', '#BE185D', bar.id, [['Crêpe chocolat', 2000], ['Salade de fruits', 2500]]],
];
const items = [];
for (const [i, [name, color, printer, list]] of CARTE.entries()) {
  const fam = await bo('POST', '/r/families', { name, color, printer_id: printer, sort: i });
  for (const [iname, price] of list) {
    const it = await bo('POST', '/r/items', { family_id: fam.id, name: iname, price_cents: price, stock_mode: 'none' });
    items.push({ ...it, price: price });
  }
}
const menusFam = await bo('POST', '/r/families', { name: 'Menus', color: '#F5A524', sort: 9 });
const formule = await bo('POST', '/r/items', { family_id: menusFam.id, kind: 'menu', name: 'Formule petit-déjeuner', price_cents: 3500, printer_mode: 'none' });
const byName = (n) => items.find((i) => i.name === n);
const s1 = await bo('POST', '/r/menu-steps', { menu_item_id: formule.id, name: 'Boisson chaude', sort: 0 });
for (const n of ['Café noir', 'Café crème', 'Nss nss', 'Thé à la menthe']) await bo('POST', '/r/menu-step-choices', { step_id: s1.id, item_id: byName(n).id });
const s2 = await bo('POST', '/r/menu-steps', { menu_item_id: formule.id, name: 'Jus', sort: 1 });
await bo('POST', '/r/menu-step-choices', { step_id: s2.id, item_id: byName('Jus d’orange').id });
await bo('POST', '/r/menu-step-choices', { step_id: s2.id, item_id: byName('Jus d’avocat').id, extra_cents: 500 });
const s3 = await bo('POST', '/r/menu-steps', { menu_item_id: formule.id, name: 'Viennoiserie', sort: 2 });
for (const n of ['Msemen au miel', 'Harcha', 'Baghrir']) await bo('POST', '/r/menu-step-choices', { step_id: s3.id, item_id: byName(n).id });

const lait = await bo('POST', '/r/option-groups', { name: 'Type de lait', min_select: 0, max_select: 1 });
await bo('POST', '/r/options', { group_id: lait.id, name: 'Lait entier' });
await bo('POST', '/r/options', { group_id: lait.id, name: 'Lait d’avoine', extra_cents: 500 });
for (const n of ['Café crème', 'Cappuccino', 'Latte']) await bo('POST', '/r/item-option-groups', { item_id: byName(n).id, group_id: lait.id });

// Salle
const zones = await bo('GET', `/r/zones?establishment_id=${E}`);
const salle = zones[0];
const terrasse = await bo('POST', '/r/zones', { establishment_id: E, name: 'Terrasse', sort: 1 });
const tables = [];
for (let i = 0; i < 10; i++) {
  tables.push(await bo('POST', '/r/tables', { establishment_id: E, zone_id: salle.id, label: `T${i + 1}`, seats: i % 3 === 0 ? 2 : 4, shape: i % 4 === 0 ? 'round' : 'square', x: 24 + (i % 5) * 140, y: 24 + Math.floor(i / 5) * 140 }));
}
for (let i = 0; i < 6; i++) {
  tables.push(await bo('POST', '/r/tables', { establishment_id: E, zone_id: terrasse.id, label: `E${i + 1}`, seats: 2, shape: 'round', x: 24 + (i % 3) * 130, y: 24 + Math.floor(i / 3) * 130 }));
}

// Équipe
const roles = await bo('GET', '/roles');
const role = (n) => roles.find((r) => r.name === n).id;
const staff = {};
for (const [name, r, pin] of [['Nadia Amrani', 'Manager', '2580'], ['Karim Bennani', 'Serveur', '3691'], ['Salma El Idrissi', 'Serveur', '4702'], ['Hamza Mansouri', 'Serveur', '5813'], ['Youssef Tahiri', 'Caissier', '6924']]) {
  staff[name.split(' ')[0]] = (await bo('POST', '/staff', { fullName: name, roleId: role(r), pin, establishmentIds: [E] })).staffId;
}
const waiters = [staff.Karim, staff.Salma, staff.Hamza, staff.Youssef];

// Clients
const client = await bo('POST', '/r/customers', { full_name: 'M. Alaoui', phone: '0661234567', credit_limit_cents: 150000 });
const customers = await bo('GET', '/r/customers');
const divers = customers.find((c) => c.is_default).id;
const methods = await bo('GET', '/r/payment-methods');
const pm = (k) => methods.find((m) => m.kind === k).id;
const reasons = await bo('GET', '/r/reason-codes');
const voidReason = reasons.find((r) => r.category === 'void').id;

// Tablette
const dev = await call('POST', '/console/devices', op, { kind: 'tablet', serial: `DEMO-${Date.now()}`, model: 'Galaxy Tab A9+ 11"', purchasePriceCents: 250000 });
const dep = await call('POST', `/console/devices/${dev.deviceId}/deploy`, op, { establishmentId: E, label: 'Caisse 1' });
const tab = (await call('POST', '/auth/device', null, { deviceId: dev.deviceId, secret: dep.secret, appVersion: '0.1.0' })).token;
for (const kind of ['printer', 'printer', 'printer', 'drawer']) {
  const d = await call('POST', '/console/devices', op, { kind, serial: `DEMO-${kind}-${randomUUID().slice(0, 6)}`, purchasePriceCents: kind === 'drawer' ? 80000 : 150000 });
  await call('POST', `/console/devices/${d.deviceId}/deploy`, op, { establishmentId: E });
}

// Ventes via la synchronisation
let seq = 0;
let orderNo = 0;
let batch = [];
const queue = (entity, kind, entityId, data) => batch.push({ opId: randomUUID(), deviceSeq: ++seq, entity, entityId, kind, data, createdAt: new Date().toISOString() });
async function flush() {
  while (batch.length) {
    const part = batch.splice(0, 400);
    const res = await call('POST', '/sync/push', tab, { protocol: 1, ops: part });
    const bad = res.results.filter((r) => r.status === 'rejected');
    if (bad.length) throw new Error(`Opérations refusées : ${JSON.stringify(bad.slice(0, 3))}`);
  }
}

const products = items;
const today = new Date();
for (let d = DAYS - 1; d >= 0; d--) {
  const date = new Date(today.getTime() - d * 86400000);
  const iso = date.toISOString().slice(0, 10);
  const at = (h, m) => new Date(`${iso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+01:00`).toISOString();
  const dayId = randomUUID();
  const sessionId = randomUUID();
  const float = 50000;
  queue('business_days', 'insert', dayId, { business_date: iso, opened_by: staff.Nadia, opening_float_cents: float, opened_at: at(6, 2) });
  queue('cash_sessions', 'insert', sessionId, { business_day_id: dayId, register_label: 'Caisse 1', staff_id: staff.Youssef, opening_float_cents: float, opened_at: at(6, 5) });
  const weekend = [5, 6].includes(date.getDay());
  const count = d === 0 ? 38 : Math.round((weekend ? 95 : 70) + random() * 25);
  let cash = 0;
  for (let o = 0; o < count; o++) {
    const hour = 7 + Math.floor(random() * 15);
    const orderId = randomUUID();
    const dineIn = random() < 0.7;
    const waiter = dineIn ? pick(waiters.slice(0, 3)) : staff.Youssef;
    queue('orders', 'insert', orderId, {
      business_day_id: dayId,
      number: `C1-${String(++orderNo).padStart(4, '0')}`,
      order_type: dineIn ? 'dine_in' : 'counter',
      table_id: dineIn ? pick(tables).id : null,
      customer_id: divers,
      waiter_id: waiter,
      covers: dineIn ? 1 + Math.floor(random() * 3) : null,
      opened_at: at(hour, Math.floor(random() * 60)),
    });
    let total = 0;
    const n = 1 + Math.floor(random() * 3);
    for (let l = 0; l < n; l++) {
      const it = hour < 11 && random() < 0.6 ? pick(products.slice(0, 16)) : pick(products);
      const qty = random() < 0.8 ? 1 : 2;
      const lineId = randomUUID();
      queue('order_lines', 'insert', lineId, { order_id: orderId, item_id: it.id, name: it.name, quantity: qty, unit_price_cents: it.price, tax_rate_bp: 1000, created_by: waiter });
      queue('order_lines', 'patch', lineId, { status: 'sent' });
      if (random() < 0.02) {
        queue('order_lines', 'patch', lineId, { status: 'voided', approved_by: staff.Nadia, void_reason_code_id: voidReason });
      } else total += qty * it.price;
    }
    if (total === 0) {
      queue('orders', 'patch', orderId, { status: 'voided' });
      continue;
    }
    if (d === 0 && o >= count - 4) continue; // tickets encore ouverts aujourd'hui
    const r = random();
    if (r < 0.72) {
      queue('payments', 'insert', randomUUID(), { order_id: orderId, cash_session_id: sessionId, payment_method_id: pm('cash'), amount_cents: total, staff_id: staff.Youssef });
      cash += total;
    } else if (r < 0.95) {
      queue('payments', 'insert', randomUUID(), { order_id: orderId, cash_session_id: sessionId, payment_method_id: pm('card'), amount_cents: total, staff_id: staff.Youssef });
    } else if (r < 0.98) {
      const half = Math.floor(total / 2);
      queue('payments', 'insert', randomUUID(), { order_id: orderId, cash_session_id: sessionId, payment_method_id: pm('cash'), amount_cents: half, staff_id: staff.Youssef });
      queue('payments', 'insert', randomUUID(), { order_id: orderId, cash_session_id: sessionId, payment_method_id: pm('card'), amount_cents: total - half, staff_id: staff.Youssef });
      cash += half;
    } else {
      queue('payments', 'insert', randomUUID(), { order_id: orderId, cash_session_id: sessionId, payment_method_id: pm('customer_credit'), amount_cents: total, customer_id: client.id, staff_id: staff.Youssef });
    }
    queue('orders', 'patch', orderId, { status: 'paid', total_cents: total });
  }
  if (d > 0) {
    const variance = d === 1 ? -2000 : 0;
    queue('cash_sessions', 'patch', sessionId, { status: 'closed', counted_cash_cents: float + cash + variance, variance_reason: variance ? 'Erreur de rendu monnaie' : undefined });
    queue('business_days', 'patch', dayId, { status: 'closed', closed_by: staff.Nadia, z_number: DAYS - d });
  }
  await flush();
  console.log(`Journée ${iso} : ${count} tickets`);
}

console.log('\nDémo prête.');
console.log(`Back-office : ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
