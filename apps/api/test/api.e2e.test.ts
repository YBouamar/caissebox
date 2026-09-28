import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashSecret } from '../src/auth/secrets';
import { loadConfig } from '../src/config';
import { migrate } from '../src/db/migrate';

/**
 * Tests d'intégration sur un vrai PostgreSQL 16.
 * TEST_PG_ADMIN_URL pointe sur une base d'administration ; une base jetable est recréée à chaque exécution.
 */
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@localhost:55432/postgres';
const DB_NAME = 'caissebox_it';
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${DB_NAME}`);

let app: INestApplication;
let pool: Pool;
let http: ReturnType<typeof request>;

interface Tenant {
  tenantId: string;
  establishmentId: string;
  ownerToken: string;
  deviceToken: string;
  deviceId: string;
  managerId: string;
  waiterId: string;
  itemId: string;
  stockItemId: string;
  defaultCustomerId: string;
  cash: string;
  credit: string;
  voidReason: string;
}

let A: Tenant;
let B: Tenant;
let operatorToken: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let seqs = new Map<string, number>();
function op(t: Tenant, entity: string, kind: 'insert' | 'patch', entityId: string, data: Record<string, unknown>) {
  const next = (seqs.get(t.deviceId) ?? 0) + 1;
  seqs.set(t.deviceId, next);
  return { opId: randomUUID(), deviceSeq: next, entity, entityId, kind, data, createdAt: new Date().toISOString() };
}

async function push(t: Tenant, ops: unknown[]) {
  const res = await http.post('/sync/push').set(auth(t.deviceToken)).send({ protocol: 1, ops });
  expect(res.status).toBe(200);
  return res.body as { results: { status: string; code?: string; message?: string }[]; lastDeviceSeq: number };
}

async function setupTenant(name: string, email: string, serial: string): Promise<Tenant> {
  const created = await http
    .post('/console/tenants')
    .set(auth(operatorToken))
    .send({
      name,
      owner: { email, fullName: `Gérant ${name}`, password: 'motdepasse-solide' },
      establishment: { name: `${name} Maarif` },
    });
  expect(created.status).toBe(201);
  const { tenantId, establishmentId } = created.body;

  const login = await http.post('/auth/login').send({ email, password: 'motdepasse-solide' });
  expect(login.status).toBe(200);
  const ownerToken = login.body.token as string;

  const roles = (await http.get('/bo/roles').set(auth(ownerToken))).body as { id: string; name: string }[];
  const roleId = (n: string) => roles.find((r) => r.name === n)!.id;
  const manager = await http.post('/bo/staff').set(auth(ownerToken)).send({
    fullName: 'Karim Bennani', roleId: roleId('Manager'), pin: '1234', establishmentIds: [establishmentId],
  });
  expect(manager.status).toBe(201);
  const waiter = await http.post('/bo/staff').set(auth(ownerToken)).send({
    fullName: 'Sara Alaoui', roleId: roleId('Serveur'), pin: '5678', establishmentIds: [establishmentId],
  });
  expect(waiter.status).toBe(201);
  const dupPin = await http.post('/bo/staff').set(auth(ownerToken)).send({
    fullName: 'Autre', roleId: roleId('Serveur'), pin: '5678', establishmentIds: [establishmentId],
  });
  expect(dupPin.status).toBe(409);

  // Catalogue minimal (le back-office catalogue viendra ensuite).
  const q = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0];
  const family = await q("INSERT INTO families (tenant_id, name) VALUES ($1, 'Boissons chaudes') RETURNING id", [tenantId]);
  const item = await q(
    "INSERT INTO items (tenant_id, family_id, name, price_cents, stock_mode) VALUES ($1, $2, 'Café noir', 1250, 'unit') RETURNING id",
    [tenantId, family.id],
  );
  const stockItem = await q("INSERT INTO stock_items (tenant_id, establishment_id, name, unit) VALUES ($1, $2, 'Café noir', 'u') RETURNING id", [
    tenantId, establishmentId,
  ]);
  await q('INSERT INTO recipes (tenant_id, item_id, stock_item_id, quantity) VALUES ($1, $2, $3, 1)', [tenantId, item.id, stockItem.id]);
  const defaultCustomer = await q('SELECT id FROM customers WHERE tenant_id = $1 AND is_default', [tenantId]);
  const cash = await q("SELECT id FROM payment_methods WHERE tenant_id = $1 AND kind = 'cash'", [tenantId]);
  const credit = await q("SELECT id FROM payment_methods WHERE tenant_id = $1 AND kind = 'customer_credit'", [tenantId]);
  const voidReason = await q("SELECT id FROM reason_codes WHERE tenant_id = $1 AND category = 'void' LIMIT 1", [tenantId]);

  const device = await http.post('/console/devices').set(auth(operatorToken)).send({ kind: 'tablet', serial, model: 'Galaxy Tab A9+' });
  expect(device.status).toBe(201);
  const deployed = await http
    .post(`/console/devices/${device.body.deviceId}/deploy`)
    .set(auth(operatorToken))
    .send({ establishmentId, label: 'Caisse 1' });
  expect(deployed.status).toBe(200);
  expect(deployed.body.secret).toBeTruthy();
  const devAuth = await http.post('/auth/device').send({ deviceId: device.body.deviceId, secret: deployed.body.secret, appVersion: '0.1.0' });
  expect(devAuth.status).toBe(200);

  return {
    tenantId,
    establishmentId,
    ownerToken,
    deviceToken: devAuth.body.token,
    deviceId: device.body.deviceId,
    managerId: manager.body.staffId,
    waiterId: waiter.body.staffId,
    itemId: item.id,
    stockItemId: stockItem.id,
    defaultCustomerId: defaultCustomer.id,
    cash: cash.id,
    credit: credit.id,
    voidReason: voidReason.id,
  };
}

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();
  await migrate(DB_URL, undefined, () => undefined);

  pool = new Pool({ connectionString: DB_URL });
  await pool.query("INSERT INTO users (email, password_hash, full_name, role) VALUES ('ops@bacybrains.ma', $1, 'Opérateur', 'operator')", [
    await hashSecret('operateur-secret'),
  ]);

  const config = loadConfig({ DATABASE_URL: DB_URL, JWT_SECRET: 'x'.repeat(40) } as NodeJS.ProcessEnv);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  http = request(app.getHttpServer());

  const login = await http.post('/auth/login').send({ email: 'ops@bacybrains.ma', password: 'operateur-secret' });
  operatorToken = login.body.token;

  A = await setupTenant('Café Atlas', 'atlas@example.ma', 'TAB-A-001');
  B = await setupTenant('Snack Oasis', 'oasis@example.ma', 'TAB-B-001');
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('authentification et droits', () => {
  test('santé', async () => {
    const res = await http.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('mauvais mot de passe', async () => {
    const res = await http.post('/auth/login').send({ email: 'atlas@example.ma', password: 'faux' });
    expect(res.status).toBe(401);
  });

  test('une tablette ne peut pas appeler la console, un propriétaire ne peut pas synchroniser', async () => {
    expect((await http.get('/console/tenants').set(auth(A.deviceToken))).status).toBe(403);
    expect((await http.get('/sync/pull').set(auth(A.ownerToken))).status).toBe(403);
    expect((await http.get('/sync/pull')).status).toBe(401);
  });

  test('tablette retirée : le secret ne fonctionne plus', async () => {
    const device = await http.post('/console/devices').set(auth(operatorToken)).send({ kind: 'tablet', serial: 'TAB-X' });
    const dep = await http.post(`/console/devices/${device.body.deviceId}/deploy`).set(auth(operatorToken)).send({ establishmentId: A.establishmentId });
    await http.post(`/console/devices/${device.body.deviceId}/retire`).set(auth(operatorToken)).send({ status: 'lost' });
    const res = await http.post('/auth/device').send({ deviceId: device.body.deviceId, secret: dep.body.secret });
    expect(res.status).toBe(401);
  });
});

describe('synchronisation : service complet', () => {
  const ids = {
    day: randomUUID(),
    session: randomUUID(),
    order: randomUUID(),
    line: randomUUID(),
    line2: randomUUID(),
    customer: randomUUID(),
    pay1: randomUUID(),
    pay2: randomUUID(),
  };
  let firstBatch: unknown[] = [];

  test('ouverture de journée, session, ticket, lignes', async () => {
    firstBatch = [
      op(A, 'business_days', 'insert', ids.day, { business_date: '2026-09-28', opened_by: A.managerId, opening_float_cents: 50000 }),
      op(A, 'cash_sessions', 'insert', ids.session, {
        business_day_id: ids.day, register_label: 'Caisse 1', staff_id: A.managerId, opening_float_cents: 50000,
      }),
      op(A, 'orders', 'insert', ids.order, {
        business_day_id: ids.day, number: 'C1-0001', order_type: 'counter', customer_id: A.defaultCustomerId, waiter_id: A.waiterId,
      }),
      op(A, 'order_lines', 'insert', ids.line, {
        order_id: ids.order, item_id: A.itemId, name: 'Café noir', quantity: 4, unit_price_cents: 1250, tax_rate_bp: 1000, created_by: A.waiterId,
      }),
      op(A, 'order_lines', 'insert', ids.line2, {
        order_id: ids.order, item_id: A.itemId, name: 'Café noir', quantity: 1, unit_price_cents: 1250, tax_rate_bp: 1000, created_by: A.waiterId,
      }),
      op(A, 'order_lines', 'patch', ids.line, { status: 'sent' }),
      op(A, 'order_lines', 'patch', ids.line2, { status: 'sent' }),
    ];
    const res = await push(A, firstBatch);
    expect(res.results.map((r) => r.status)).toEqual(Array(7).fill('applied'));
    expect(res.lastDeviceSeq).toBe(7);
  });

  test('renvoyer le même lot ne crée aucun doublon', async () => {
    const res = await push(A, firstBatch);
    expect(res.results.every((r) => r.status === 'duplicate')).toBe(true);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM order_lines WHERE order_id = $1', [ids.order]);
    expect(rows[0].n).toBe(2);
  });

  test("annulation d'une ligne envoyée : manager et motif obligatoires", async () => {
    const refused = await push(A, [op(A, 'order_lines', 'patch', ids.line2, { status: 'voided', approved_by: A.waiterId })]);
    expect(refused.results[0]).toMatchObject({ status: 'rejected', code: 'BUSINESS_RULE' });
    const ok = await push(A, [
      op(A, 'order_lines', 'patch', ids.line2, { status: 'voided', approved_by: A.managerId, void_reason_code_id: A.voidReason }),
    ]);
    expect(ok.results[0]!.status).toBe('applied');
  });

  test('séquence trouée : le reste du lot est refusé sans être consommé', async () => {
    const good = op(A, 'customers', 'insert', ids.customer, { full_name: 'Hassan Tazi', phone: '0661000000' });
    seqs.set(A.deviceId, good.deviceSeq + 1); // on « saute » un numéro
    const after = op(A, 'customers', 'patch', ids.customer, { phone: '0662000000' });
    const res = await push(A, [after]);
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'SEQUENCE_GAP' });
    expect(res.lastDeviceSeq).toBe(good.deviceSeq - 1);
    const retry = await push(A, [good, { ...after, opId: randomUUID(), deviceSeq: good.deviceSeq + 1 }]);
    expect(retry.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    seqs.set(A.deviceId, good.deviceSeq + 1);
  });

  test('colonne interdite et paiement supérieur au reste dû', async () => {
    const res = await push(A, [
      op(A, 'orders', 'patch', ids.order, { tenant_id: B.tenantId }),
      op(A, 'payments', 'insert', randomUUID(), {
        order_id: ids.order, cash_session_id: ids.session, payment_method_id: A.cash, amount_cents: 999999, staff_id: A.managerId,
      }),
    ]);
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'FORBIDDEN_COLUMN' });
    expect(res.results[1]).toMatchObject({ status: 'rejected', code: 'BUSINESS_RULE' });
  });

  test('clôture du ticket refusée tant que les paiements ne couvrent pas le total', async () => {
    const res = await push(A, [op(A, 'orders', 'patch', ids.order, { status: 'paid', total_cents: 1 })]);
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'BUSINESS_RULE' });
  });

  test('crédit client : refusé pour « Client divers »', async () => {
    const res = await push(A, [
      op(A, 'payments', 'insert', randomUUID(), {
        order_id: ids.order, cash_session_id: ids.session, payment_method_id: A.credit, amount_cents: 1000,
        customer_id: A.defaultCustomerId, staff_id: A.managerId,
      }),
    ]);
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'BUSINESS_RULE' });
  });

  test('paiement fractionné espèces + ardoise, clôture du ticket, stock', async () => {
    const res = await push(A, [
      op(A, 'payments', 'insert', ids.pay1, {
        order_id: ids.order, cash_session_id: ids.session, payment_method_id: A.cash, amount_cents: 3000,
        tendered_cents: 5000, change_cents: 2000, staff_id: A.managerId, split_label: '1/2',
      }),
      op(A, 'payments', 'insert', ids.pay2, {
        order_id: ids.order, cash_session_id: ids.session, payment_method_id: A.credit, amount_cents: 2000,
        customer_id: ids.customer, staff_id: A.managerId, split_label: '2/2',
      }),
      op(A, 'orders', 'patch', ids.order, { status: 'paid', total_cents: 5000 }),
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied']);

    const order = (await pool.query('SELECT status, total_cents, device_id FROM orders WHERE id = $1', [ids.order])).rows[0];
    expect(order).toMatchObject({ status: 'paid', total_cents: '5000', device_id: A.deviceId });
    const ledger = (await pool.query('SELECT kind, amount_cents FROM customer_ledger WHERE customer_id = $1', [ids.customer])).rows;
    expect(ledger).toEqual([{ kind: 'charge', amount_cents: '2000' }]);
    const stock = (await pool.query('SELECT sum(quantity)::float AS q FROM stock_movements WHERE stock_item_id = $1', [A.stockItemId])).rows[0];
    expect(stock.q).toBe(-4); // la ligne annulée ne sort pas du stock
  });

  test('un ticket payé est inaltérable', async () => {
    const res = await push(A, [op(A, 'orders', 'patch', ids.order, { note: 'modif' })]);
    expect(res.results[0]!.status).toBe('rejected');
  });

  test('clôture de journée refusée tant que la session est ouverte, puis Z n°1', async () => {
    const early = await push(A, [op(A, 'business_days', 'patch', ids.day, { status: 'closed', closed_by: A.managerId, z_number: 1 })]);
    expect(early.results[0]).toMatchObject({ status: 'rejected', code: 'BUSINESS_RULE' });

    const noReason = await push(A, [op(A, 'cash_sessions', 'patch', ids.session, { status: 'closed', counted_cash_cents: 52000 })]);
    expect(noReason.results[0]).toMatchObject({ status: 'rejected', code: 'BUSINESS_RULE' });

    const res = await push(A, [
      op(A, 'cash_sessions', 'patch', ids.session, { status: 'closed', counted_cash_cents: 53000, expected_cash_cents: 12345 }),
      op(A, 'business_days', 'patch', ids.day, { status: 'closed', closed_by: A.managerId, z_number: 1 }),
    ]);
    expect(res.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    const session = (await pool.query('SELECT expected_cash_cents, variance_cents FROM cash_sessions WHERE id = $1', [ids.session])).rows[0];
    expect(session).toEqual({ expected_cash_cents: '53000', variance_cents: '0' });
    const audit = (await pool.query("SELECT details FROM audit_log WHERE action = 'cash_session.expected_corrected'")).rows[0];
    expect(audit.details).toEqual({ tablet: 12345, server: 53000 });
  });

  test('pull : changements ordonnés, pagination, curseur', async () => {
    const page1 = await http.get('/sync/pull?cursor=0&limit=5').set(auth(A.deviceToken));
    expect(page1.status).toBe(200);
    expect(page1.body.changes).toHaveLength(5);
    expect(page1.body.hasMore).toBe(true);
    let cursor = page1.body.nextCursor as number;
    const all = [...page1.body.changes];
    for (;;) {
      const page = await http.get(`/sync/pull?cursor=${cursor}&limit=1000`).set(auth(A.deviceToken));
      all.push(...page.body.changes);
      cursor = page.body.nextCursor;
      if (!page.body.hasMore) break;
    }
    const seqList = all.map((c: { seq: number }) => c.seq);
    expect([...seqList].sort((a, b) => a - b)).toEqual(seqList);
    const entities = new Set(all.map((c: { entity: string }) => c.entity));
    for (const e of ['staff', 'items', 'business_days', 'orders', 'payments', 'customer_ledger']) expect(entities.has(e)).toBe(true);
    // Aucune donnée d'un autre client.
    expect(all.some((c: { data: { tenant_id?: string } | null }) => c.data?.tenant_id === B.tenantId)).toBe(false);
  });

  test('snapshot cohérent', async () => {
    const res = await http.get('/sync/snapshot').set(auth(A.deviceToken));
    expect(res.status).toBe(200);
    expect(res.body.cursor).toBeGreaterThan(0);
    expect(res.body.tables.staff).toHaveLength(2);
    expect(res.body.tables.payment_methods).toHaveLength(4);
    expect(res.body.tables.business_days).toHaveLength(0); // journée clôturée
    expect(res.body.tables.establishments).toHaveLength(1);
  });
});

describe('isolation entre clients', () => {
  test("une tablette ne peut ni lire ni modifier les données d'un autre client", async () => {
    const order = (await pool.query('SELECT id FROM orders WHERE tenant_id = $1 LIMIT 1', [A.tenantId])).rows[0];
    const res = await push(B, [op(B, 'orders', 'patch', order.id, { note: 'piratage' })]);
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'NOT_FOUND' });

    const pull = await http.get('/sync/pull?cursor=0').set(auth(B.deviceToken));
    expect(pull.body.changes.every((c: { data: { tenant_id?: string; id?: string } | null; entity: string }) =>
      c.entity === 'tenants' ? c.data?.id === B.tenantId : c.data?.tenant_id === B.tenantId,
    )).toBe(true);
  });

  test("insertion rattachée à une journée d'un autre client refusée", async () => {
    const day = (await pool.query('SELECT id FROM business_days WHERE tenant_id = $1 LIMIT 1', [A.tenantId])).rows[0];
    const res = await push(B, [
      op(B, 'orders', 'insert', randomUUID(), {
        business_day_id: day.id, number: 'X-1', order_type: 'counter', customer_id: B.defaultCustomerId, waiter_id: B.waiterId,
      }),
    ]);
    expect(res.results[0]!.status).toBe('rejected');
  });

  test('blocage pour impayé : ouverture de journée refusée', async () => {
    await http.post(`/console/establishments/${B.establishmentId}/access`).set(auth(operatorToken)).send({ state: 'refuse_day_open' });
    const res = await push(B, [
      op(B, 'business_days', 'insert', randomUUID(), { business_date: '2026-09-28', opened_by: B.managerId, opening_float_cents: 0 }),
    ]);
    expect(res.results[0]).toMatchObject({ status: 'rejected', code: 'BUSINESS_RULE' });
  });
});
