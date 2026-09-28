import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FetchLike } from '../src/core/api';
import { Caisse } from '../src/core/caisse';
import { ManagerRequired, OrderRow, PosError } from '../src/core/pos';
import type { PrinterTarget, PrintTransport } from '../src/core/printing';
import type { Rejection } from '../src/core/sync';
import { nodeSql } from './nodeSql';

/**
 * Parcours complet de deux tablettes contre une vraie API (et sa base PostgreSQL).
 * Prérequis : API démarrée (TEST_API_URL) et un compte opérateur (TEST_OPERATOR_EMAIL / _PASSWORD).
 */
const API = process.env.TEST_API_URL ?? 'http://localhost:3000';
const OP_EMAIL = process.env.TEST_OPERATOR_EMAIL ?? 'ops@bacybrains.ma';
const OP_PASSWORD = process.env.TEST_OPERATOR_PASSWORD ?? 'operateur-demo-1';

const reachable = await fetch(`${API}/health`).then((r) => r.ok, () => false);
if (!reachable) console.warn(`API injoignable sur ${API} : tests d'intégration de la tablette ignorés`);

async function call<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : (null as T);
}

/** Réseau simulé : on peut couper la connexion d'une tablette. */
function network() {
  const state = { online: true };
  const impl: FetchLike = async (url, init) => {
    if (!state.online) throw new TypeError('Network request failed');
    return fetch(url, init as RequestInit);
  };
  return { state, impl };
}

class FakePrinters implements PrintTransport {
  sent: { printer: string; text: string }[] = [];
  failing = new Set<string>();
  async send(printer: PrinterTarget, bytes: Uint8Array): Promise<void> {
    if (this.failing.has(printer.name)) throw new Error(`${printer.name} injoignable`);
    this.sent.push({ printer: printer.name, text: Buffer.from(bytes).toString('latin1') });
  }
}

interface Setup {
  owner: string;
  establishmentId: string;
  creds: { A: { deviceId: string; secret: string }; B: { deviceId: string; secret: string } };
  items: Record<string, string>;
  table: string;
  customer: string;
  managerPin: string;
  waiterPin: string;
}

let S: Setup;
const netA = network();
const netB = network();
const printers = new FakePrinters();
const rejectionsB: Rejection[] = [];
let A: Caisse;
let B: Caisse;
let manager: string;
let waiter: string;

async function openCaisse(net: ReturnType<typeof network>, onRejected?: (r: Rejection[]) => void) {
  return Caisse.open({ sql: nodeSql(), fetch: net.impl, transport: printers, uuid: randomUUID, onRejected, syncIntervalMs: 3600_000 });
}

async function settle(...caisses: Caisse[]) {
  for (let i = 0; i < 2; i++) for (const c of caisses) await c.sync.sync();
}

async function waitPrints(c: Caisse) {
  for (let i = 0; i < 50; i++) {
    const jobs = await c.printQueue.jobs();
    if (jobs.every((j) => j.state === 'failed')) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  if (!reachable) return;
  const op = (await call('POST', '/auth/login', undefined, { email: OP_EMAIL, password: OP_PASSWORD })).token;
  const email = `tablette-${Date.now()}@test.ma`;
  const t = await call('POST', '/console/tenants', op, {
    name: 'Café Test Tablette',
    ice: '001122334455667',
    owner: { email, fullName: 'Gérant Test', password: 'motdepasse-solide' },
    establishment: { name: 'Café Test Tablette' },
  });
  const owner = (await call('POST', '/auth/login', undefined, { email, password: 'motdepasse-solide' })).token;
  const E = t.establishmentId;
  const bar = await call('POST', '/bo/r/printers', owner, { establishment_id: E, name: 'Bar', connection: 'wifi', address: '192.168.1.51', prints_preparation: true });
  const cuisine = await call('POST', '/bo/r/printers', owner, { establishment_id: E, name: 'Cuisine', connection: 'wifi', address: '192.168.1.52', prints_preparation: true });
  await call('POST', '/bo/r/printers', owner, { establishment_id: E, name: 'Caisse', connection: 'bluetooth', address: '00:11:22:33:44:55', prints_receipts: true, opens_drawer: true });
  const cafes = await call('POST', '/bo/r/families', owner, { name: 'Cafés', printer_id: bar.id });
  const plats = await call('POST', '/bo/r/families', owner, { name: 'Plats', printer_id: cuisine.id });
  const menus = await call('POST', '/bo/r/families', owner, { name: 'Menus' });
  const cafe = await call('POST', '/bo/r/items', owner, { family_id: cafes.id, name: 'Café crème', price_cents: 1400 });
  const the = await call('POST', '/bo/r/items', owner, { family_id: cafes.id, name: 'Thé à la menthe', price_cents: 1200 });
  const burger = await call('POST', '/bo/r/items', owner, { family_id: plats.id, name: 'Cheese burger', price_cents: 5500 });
  const formule = await call('POST', '/bo/r/items', owner, { family_id: menus.id, kind: 'menu', name: 'Formule midi', price_cents: 7000, printer_mode: 'none' });
  const s1 = await call('POST', '/bo/r/menu-steps', owner, { menu_item_id: formule.id, name: 'Plat' });
  await call('POST', '/bo/r/menu-step-choices', owner, { step_id: s1.id, item_id: burger.id });
  const s2 = await call('POST', '/bo/r/menu-steps', owner, { menu_item_id: formule.id, name: 'Boisson' });
  await call('POST', '/bo/r/menu-step-choices', owner, { step_id: s2.id, item_id: the.id, extra_cents: 300 });
  const lait = await call('POST', '/bo/r/option-groups', owner, { name: 'Lait', min_select: 0, max_select: 1 });
  const avoine = await call('POST', '/bo/r/options', owner, { group_id: lait.id, name: 'Lait d’avoine', extra_cents: 500 });
  await call('POST', '/bo/r/item-option-groups', owner, { item_id: cafe.id, group_id: lait.id });
  const zones = await call('GET', `/bo/r/zones?establishment_id=${E}`, owner);
  const table = await call('POST', '/bo/r/tables', owner, { establishment_id: E, zone_id: zones[0].id, label: 'T1' });
  const roles = await call('GET', '/bo/roles', owner);
  const role = (n: string) => roles.find((r: { name: string }) => r.name === n).id;
  await call('POST', '/bo/staff', owner, { fullName: 'Nadia Amrani', roleId: role('Manager'), pin: '2580', establishmentIds: [E] });
  await call('POST', '/bo/staff', owner, { fullName: 'Karim Bennani', roleId: role('Caissier'), pin: '3691', establishmentIds: [E] });
  const customer = await call('POST', '/bo/r/customers', owner, { full_name: 'M. Alaoui', credit_limit_cents: 100000 });
  const deploy = async (serial: string, label: string) => {
    const d = await call('POST', '/console/devices', op, { kind: 'tablet', serial });
    const r = await call('POST', `/console/devices/${d.deviceId}/deploy`, op, { establishmentId: E, label });
    return { deviceId: d.deviceId as string, secret: r.secret as string };
  };
  S = {
    owner,
    establishmentId: E,
    creds: { A: await deploy(`TT-A-${Date.now()}`, 'Caisse 1'), B: await deploy(`TT-B-${Date.now()}`, 'Serveur 2') },
    items: { cafe: cafe.id, the: the.id, burger: burger.id, formule: formule.id, avoine: avoine.id, steps: `${s1.id},${s2.id}` },
    table: table.id,
    customer: customer.id,
    managerPin: '2580',
    waiterPin: '3691',
  };
  A = await openCaisse(netA);
  B = await openCaisse(netB, (r) => rejectionsB.push(...r));
});

afterAll(() => {
  A?.stop();
  B?.stop();
});

describe.skipIf(!reachable)('enrôlement et connexion', () => {
  test('instantané initial et identification par PIN', async () => {
    await A.enroll({ baseUrl: API, ...S.creds.A });
    await B.enroll({ baseUrl: API, ...S.creds.B });
    expect(A.pos.registerLabel()).toBe('Caisse 1');
    expect(A.pos.registerPrefix()).toBe('C1');
    expect(B.pos.registerPrefix()).toBe('S2');
    expect(A.pos.staff()).toHaveLength(2);
    expect(A.pos.items().length).toBe(4);
    manager = A.pos.login(S.managerPin)!.id;
    waiter = A.pos.login(S.waiterPin)!.id;
    expect(A.pos.isManager(manager)).toBe(true);
    expect(A.pos.login('0000')).toBeNull();
  });
});

describe.skipIf(!reachable)('service', () => {
  let order: OrderRow;

  test("ouverture de journée réservée au manager, puis session de caisse", async () => {
    await expect(A.pos.openDay(waiter, 50000)).rejects.toBeInstanceOf(ManagerRequired);
    await A.pos.openDay(waiter, 50000, { managerId: manager });
    await A.pos.openSession(waiter, 50000);
    await settle(A, B);
    expect(Number(B.pos.currentDay()?.opening_float_cents)).toBe(50000);
  });

  test('ticket de table : article avec option, menu composé, envoi en cuisine et au bar', async () => {
    order = await A.pos.createOrder(waiter, { type: 'dine_in', tableId: S.table, covers: 2 });
    expect(order.number).toBe('C1-0001');
    await A.pos.addLine(waiter, order.id, { itemId: S.items.cafe!, quantity: 2, optionIds: [S.items.avoine!] });
    const [plat, boisson] = S.items.steps!.split(',');
    await expect(A.pos.addLine(waiter, order.id, { itemId: S.items.formule!, menuChoices: [{ stepId: plat!, itemId: S.items.burger! }] })).rejects.toThrow('Boisson');
    await A.pos.addLine(waiter, order.id, {
      itemId: S.items.formule!,
      menuChoices: [
        { stepId: plat!, itemId: S.items.burger! },
        { stepId: boisson!, itemId: S.items.the! },
      ],
    });
    // 2 × (14 + 5) + 70 + 3 = 111 DH
    expect(A.pos.totals(order.id).totalCents).toBe(11100);
    const sent = await A.pos.send(waiter, order.id);
    expect(sent).toEqual({ printers: 2, lines: 2 });
    await waitPrints(A);
    expect(printers.sent.map((p) => p.printer).sort()).toEqual(['Bar', 'Cuisine']);
    expect(printers.sent.find((p) => p.printer === 'Bar')!.text).toContain('Lait d');
    expect(printers.sent.find((p) => p.printer === 'Cuisine')!.text).toContain('Cheese burger');
    await settle(A, B);
    expect(await A.store.outboxSize()).toBe(0);
    expect(B.pos.orderForTable(S.table)?.number).toBe('C1-0001');
    expect(B.pos.totals(order.id).totalCents).toBe(11100);
    expect(A.store.where('kitchen_tickets', (k) => k.order_id === order.id).every((k) => k.status === 'printed')).toBe(true);
  });

  test("annulation après envoi : validation manager, motif et bon d'annulation", async () => {
    const line = A.pos.ticket(order.id).find((l) => l.line.name === 'Café crème')!.line;
    await expect(A.pos.voidLine(waiter, order.id, line.id)).rejects.toBeInstanceOf(ManagerRequired);
    const reason = A.pos.reasons('void')[0]!;
    printers.sent = [];
    await A.pos.voidLine(waiter, order.id, line.id, { managerId: manager, reasonId: reason.id });
    await waitPrints(A);
    expect(printers.sent[0]!.printer).toBe('Bar');
    expect(printers.sent[0]!.text).toContain('ANNULATION');
    expect(A.pos.totals(order.id).totalCents).toBe(7300);
    await settle(A);
    expect(await A.store.outboxSize()).toBe(0);
  });

  test('hors ligne : la tablette B prend et encaisse un ticket, tout part au retour du réseau', async () => {
    netB.state.online = false;
    const sB = await B.pos.openSession(B.pos.login(S.managerPin)!.id, 0);
    expect(sB.status).toBe('open');
    const take = await B.pos.createOrder(manager, { type: 'counter' });
    expect(take.number).toBe('S2-0001');
    await B.pos.addLine(manager, take.id, { itemId: S.items.the!, quantity: 3 });
    await B.pos.send(manager, take.id);
    const cash = B.pos.paymentMethods().find((m) => m.kind === 'cash')!;
    const res = await B.pos.pay(manager, take.id, [{ methodId: cash.id, amountCents: 3600, tenderedCents: 5000 }]);
    expect(res).toMatchObject({ closed: true, changeCents: 1400 });
    await B.sync.sync();
    expect(B.sync.status.online).toBe(false);
    expect(await B.store.outboxSize()).toBeGreaterThan(5);
    netB.state.online = true;
    await settle(B, A);
    expect(await B.store.outboxSize()).toBe(0);
    expect(A.store.get<OrderRow>('orders', take.id)?.status).toBe('paid');
    expect(printers.sent.some((p) => p.printer === 'Caisse' && p.text.includes('S2-0001'))).toBe(true);
  });

  test('paiement concurrent hors ligne : le serveur refuse le second, B se corrige', async () => {
    netB.state.online = false;
    const cash = A.pos.paymentMethods().find((m) => m.kind === 'cash')!;
    const credit = A.pos.paymentMethods().find((m) => m.kind === 'customer_credit')!;
    await B.pos.pay(manager, order.id, [{ methodId: cash.id, amountCents: 7300 }], { printReceipt: false });
    expect(B.store.get<OrderRow>('orders', order.id)?.status).toBe('paid');
    // A encaisse le même ticket à l'ardoise, et synchronise en premier.
    await expect(A.pos.pay(waiter, order.id, [{ methodId: credit.id, amountCents: 7300, customerId: A.pos.defaultCustomer().id }])).rejects.toThrow('client identifié');
    await A.pos.pay(waiter, order.id, [{ methodId: credit.id, amountCents: 7300, customerId: S.customer }]);
    await settle(A);
    netB.state.online = true;
    await settle(B);
    expect(rejectionsB.some((r) => r.entity === 'payments')).toBe(true);
    // B reprend la version du serveur : payé à l'ardoise, sans son paiement espèces.
    const payments = B.store.where('payments', (p) => p.order_id === order.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.payment_method_id).toBe(credit.id);
    expect(A.pos.customerBalance(S.customer)).toBe(7300);
    expect((await B.store.rejections()).length).toBeGreaterThan(0);
  });

  test("imprimante en panne : le bon attend, puis part après relance", async () => {
    const t = await A.pos.createOrder(waiter, { type: 'dine_in', tableId: S.table });
    await A.pos.addLine(waiter, t.id, { itemId: S.items.burger! });
    printers.failing.add('Cuisine');
    printers.sent = [];
    const q = A.printQueue as unknown as { opts: { retryDelayMs?: number } };
    q.opts.retryDelayMs = 1;
    await A.pos.send(waiter, t.id);
    for (let i = 0; i < 100 && !(await A.printQueue.jobs()).some((j) => j.state === 'failed'); i++) await new Promise((r) => setTimeout(r, 10));
    const jobs = await A.printQueue.jobs();
    expect(jobs[0]).toMatchObject({ state: 'failed', attempts: 3 });
    printers.failing.clear();
    await A.printQueue.resume();
    expect(printers.sent.map((p) => p.printer)).toEqual(['Cuisine']);
    // Ticket vide : on le solde pour pouvoir clôturer.
    const cash = A.pos.paymentMethods().find((m) => m.kind === 'cash')!;
    await A.pos.pay(waiter, t.id, [{ methodId: cash.id, amountCents: 5500 }], { printReceipt: false });
  });

  test('clôture : session de caisse puis journée (Z n° 1), chiffres identiques au serveur', async () => {
    await expect(A.pos.closeDay(manager)).rejects.toThrow('session');
    const mine = A.pos.openSessionFor(waiter)!;
    const fig = A.pos.sessionFigures(mine.id);
    expect(fig.expectedCents).toBe(50000 + 5500);
    await expect(A.pos.closeSession(waiter, mine.id, 55000)).rejects.toThrow('Motif');
    await A.pos.closeSession(waiter, mine.id, 55000, 'Erreur de rendu');
    await settle(A, B);
    const sB = B.pos.openSessionFor(manager)!;
    await B.pos.closeSession(manager, sB.id, B.pos.sessionFigures(sB.id).expectedCents);
    await settle(B, A);
    const x = A.pos.xReport();
    expect(await A.pos.closeDay(manager)).toBe(1);
    await settle(A, B);
    expect(B.pos.currentDay()).toBeUndefined();
    expect(B.pos.nextZNumber()).toBe(2);
    const days = await call('GET', `/bo/reports/days?establishmentId=${S.establishmentId}`, S.owner);
    const report = await call('GET', `/bo/reports/days/${days[0].id}`, S.owner);
    expect(report.day.zNumber).toBe(1);
    expect(report.totals.ttcCents).toBe(x.totalCents);
    expect(report.orders.paid).toBe(x.orders);
    expect(report.cashSessions.find((s: { varianceCents: number }) => s.varianceCents === -500)).toBeTruthy();
  });

  test('réinstallation : nouvel instantané, numérotation et séquence reprennent sans conflit', async () => {
    const fresh = await openCaisse(netA);
    await fresh.enroll({ baseUrl: API, ...S.creds.A });
    expect(fresh.pos.nextOrderNumber()).toBe('C1-0003');
    expect(fresh.pos.nextZNumber()).toBe(2);
    await fresh.pos.openDay(manager, 0);
    await fresh.sync.sync();
    expect(await fresh.store.outboxSize()).toBe(0);
    expect(fresh.sync.status.lastError).toBeNull();
    fresh.stop();
  });

  test('refus locaux lisibles', async () => {
    await B.sync.sync();
    await expect(B.pos.createOrder(manager, { type: 'counter' })).resolves.toBeTruthy();
    await expect(B.pos.addLine(manager, 'inconnu', { itemId: S.items.the! })).rejects.toBeInstanceOf(PosError);
  });
});
