import {
  businessDateFor,
  changeFor,
  customerReceipt,
  EscPosBuilder,
  formatCents,
  expectedCash,
  formatOrderNumber,
  lineTotal,
  OrderLine,
  orderTotals,
  OrderTotals,
  Permission,
  planPreparation,
  preparationTicket,
  ReceiptData,
  ReceiptEstablishment,
  RoutingFamily,
  RoutingItem,
  verifyPin,
} from '@caissebox/shared';
import { LocalOp, num, Row, Store } from './store';

// Vues typées des lignes locales (noms de colonnes du serveur) ---------------

export interface StaffRow extends Row { role_id: string; full_name: string; initials: string; pin_hash: string | null; active: boolean }
export interface RoleRow extends Row { name: string; is_manager: boolean; permissions: Record<string, boolean | number> }
export interface FamilyRow extends Row { establishment_id: string | null; name: string; color: string; sort: number; printer_id: string | null; tax_rate_id: string | null; archived: boolean }
export interface ItemRow extends Row {
  family_id: string; kind: 'product' | 'menu'; name: string; price_cents: string | number; tax_rate_id: string | null;
  printer_mode: 'inherit' | 'none' | 'printer'; printer_id: string | null; stock_mode: string; available: boolean; sort: number; archived: boolean;
}
export interface OptionGroupRow extends Row { name: string; min_select: number; max_select: number }
export interface OptionRow extends Row { group_id: string; name: string; extra_cents: string | number; sort: number; archived: boolean }
export interface MenuStepRow extends Row { menu_item_id: string; name: string; min_select: number; max_select: number; sort: number }
export interface MenuChoiceRow extends Row { step_id: string; item_id: string; extra_cents: string | number; sort: number }
export interface ZoneRow extends Row { establishment_id: string; name: string; sort: number }
export interface TableRow extends Row { zone_id: string; label: string; seats: number; shape: 'square' | 'round' | 'long'; x: number; y: number; w: number; h: number; active: boolean }
export interface PrinterRow extends Row { name: string; connection: 'bluetooth' | 'wifi'; address: string; port: number; paper_width_mm: 58 | 80; prints_receipts: boolean; prints_preparation: boolean; opens_drawer: boolean; active: boolean }
export interface DayRow extends Row { business_date: string; status: 'open' | 'closed'; opened_at: string; opened_by: string; opening_float_cents: string | number; closed_at?: string | null; z_number?: number | null }
export interface SessionRow extends Row {
  business_day_id: string; register_label: string; staff_id: string; kind: 'register' | 'waiter'; status: 'open' | 'closed';
  opening_float_cents: string | number; opened_at: string; expected_cash_cents?: string | number | null; counted_cash_cents?: string | number | null; variance_cents?: string | number | null;
}
export interface OrderRow extends Row {
  business_day_id: string; number: string; order_type: 'dine_in' | 'takeaway' | 'counter'; table_id: string | null; call_number: number | null;
  customer_id: string; customer_name: string | null; waiter_id: string; covers: number | null; status: 'open' | 'paid' | 'voided';
  discount_cents: string | number; total_cents: string | number; note: string | null; opened_at: string; closed_at?: string | null;
}
export interface LineRow extends Row {
  order_id: string; parent_line_id: string | null; item_id: string; name: string; quantity: number; unit_price_cents: string | number; tax_rate_bp: number;
  discount_cents: string | number; status: 'draft' | 'sent' | 'voided' | 'comp'; note: string | null; printer_id: string | null; created_by: string; created_at: string;
  sent_at?: string | null; approved_by?: string | null;
}
export interface LineOptionRow extends Row { order_line_id: string; option_id: string; name: string; extra_cents: string | number }
export interface PaymentRow extends Row {
  order_id: string; cash_session_id: string; payment_method_id: string; amount_cents: string | number; tendered_cents: string | number | null;
  change_cents: string | number; customer_id: string | null; split_label: string | null; staff_id: string; created_at: string;
}
export interface PaymentMethodRow extends Row { label: string; kind: 'cash' | 'card' | 'customer_credit' | 'meal_voucher' | 'other'; active: boolean; sort: number }
export interface CustomerRow extends Row { full_name: string; phone: string | null; credit_limit_cents: string | number; is_default: boolean; archived: boolean }
export interface ReasonRow extends Row { category: 'void' | 'comp' | 'discount' | 'cash_out' | 'cash_variance'; label: string; active: boolean }
export interface MovementRow extends Row { cash_session_id: string; kind: 'out' | 'in' | 'no_sale' | 'waiter_handover'; amount_cents: string | number; staff_id: string; created_at: string; note: string | null }

// Erreurs ---------------------------------------------------------------------

/** Refus métier affiché tel quel à l'utilisateur. */
export class PosError extends Error {}

/** L'action demande la validation d'un manager (PIN + motif éventuel). */
export class ManagerRequired extends Error {
  constructor(
    readonly action: string,
    readonly reasonCategory: ReasonRow['category'] | null = null,
  ) {
    super(`${action} : validation d'un manager nécessaire`);
  }
}

export interface Approval {
  managerId: string;
  reasonId?: string | null;
  reasonText?: string | null;
}

export interface PrintRequest {
  printerId: string;
  label: string;
  bytes: Uint8Array;
  kitchenTicketId?: string;
}

export interface PosDeps {
  uuid: () => string;
  now?: () => Date;
  /** Réveille la synchronisation après une écriture. */
  onWrite?: () => void;
  /** File d'impression ; absente dans certains tests. */
  print?: (jobs: PrintRequest[]) => Promise<void>;
}

export interface NewLine {
  itemId: string;
  quantity?: number;
  optionIds?: string[];
  /** Menu composé : articles choisis, étape par étape. */
  menuChoices?: { stepId: string; itemId: string }[];
  note?: string | null;
}

export interface PaymentInput {
  methodId: string;
  amountCents: number;
  tenderedCents?: number;
  customerId?: string | null;
  splitLabel?: string | null;
}

export interface TicketLine {
  line: LineRow;
  children: LineRow[];
  options: LineOptionRow[];
  totalCents: number;
  details: string[];
}

const PREFIX_RE = /^([A-Z0-9]{1,4})-(\d+)$/;
export const LOCAL_ONLY_PREFIX = 'local-';

/**
 * Règles de la caisse côté tablette. Elles reprennent celles du serveur pour
 * que l'utilisateur soit prévenu tout de suite, même hors ligne ; le serveur
 * reste l'arbitre final.
 */
export class Pos {
  private readonly now: () => Date;

  constructor(
    readonly store: Store,
    private readonly deps: PosDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private async write(ops: LocalOp[]): Promise<void> {
    await this.store.write(ops);
    this.deps.onWrite?.();
  }

  // Contexte ------------------------------------------------------------------

  get establishmentId(): string {
    const id = this.store.meta('establishment_id');
    if (!id) throw new PosError('Tablette non enrôlée');
    return id;
  }

  establishment(): Row | undefined {
    return this.store.get('establishments', this.store.meta('establishment_id'));
  }

  tenant(): Row | undefined {
    return this.store.all('tenants')[0];
  }

  serviceMode(): 'counter' | 'waiter_pays' | 'both' {
    return (this.establishment()?.service_mode as 'counter' | 'waiter_pays' | 'both') ?? 'both';
  }

  kitchenSendMode(): 'manual' | 'auto' {
    return (this.establishment()?.kitchen_send_mode as 'manual' | 'auto') ?? 'manual';
  }

  registerLabel(): string {
    return this.store.meta('register_label') ?? 'Caisse 1';
  }

  /** Préfixe des numéros de ticket : « Caisse 1 » → C1, « Serveur 2 » → S2. */
  registerPrefix(): string {
    const stored = this.store.meta('register_prefix');
    if (stored) return stored;
    const label = this.registerLabel().toUpperCase().normalize('NFD').replace(/[^A-Z0-9 ]/g, '');
    const words = label.split(/\s+/).filter(Boolean);
    const prefix = ((words[0]?.[0] ?? 'T') + (words.slice(1).join('').replace(/[^0-9]/g, '') || '1')).slice(0, 4);
    return prefix;
  }

  // Personnel et droits ---------------------------------------------------------

  staff(): StaffRow[] {
    const est = this.store.meta('establishment_id');
    const linked = new Set(this.store.where('staff_establishments', (l) => l.establishment_id === est).map((l) => String(l.staff_id)));
    return this.store
      .where<StaffRow>('staff', (s) => s.active && linked.has(s.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'));
  }

  staffName(id: string | null | undefined): string {
    const s = this.store.get<StaffRow>('staff', id);
    if (!s) return '';
    const [first, ...rest] = s.full_name.split(/\s+/);
    return rest.length ? `${first} ${rest[rest.length - 1]![0]}.` : (first ?? '');
  }

  role(staffId: string): RoleRow | undefined {
    return this.store.get<RoleRow>('roles', this.store.get<StaffRow>('staff', staffId)?.role_id);
  }

  isManager(staffId: string): boolean {
    return !!this.role(staffId)?.is_manager;
  }

  can(staffId: string, perm: Permission): boolean {
    const role = this.role(staffId);
    return !!role && (role.is_manager || role.permissions[perm] === true);
  }

  maxDiscountBp(staffId: string): number {
    const role = this.role(staffId);
    if (!role) return 0;
    return role.is_manager ? 10000 : num(role.permissions['order.discount_max_bp']);
  }

  /** Identifie la personne par son seul PIN (unique dans l'équipe). */
  login(pin: string, staffId?: string): StaffRow | null {
    const candidates = staffId ? this.staff().filter((s) => s.id === staffId) : this.staff();
    return candidates.find((s) => verifyPin(pin, s.pin_hash)) ?? null;
  }

  /** Vérifie le PIN d'un manager pour valider une action. */
  checkManager(pin: string): StaffRow {
    const s = this.login(pin);
    if (!s || !this.isManager(s.id)) throw new PosError('PIN manager incorrect');
    return s;
  }

  private require(actor: string, perm: Permission, action: string, approval?: Approval, reason: ReasonRow['category'] | null = null): string | null {
    if (this.can(actor, perm) && !reason) return null;
    if (!approval) throw new ManagerRequired(action, reason);
    if (!this.isManager(approval.managerId)) throw new PosError("La personne qui valide n'est pas manager");
    if (reason && !approval.reasonId && !approval.reasonText) throw new PosError('Motif obligatoire');
    return approval.managerId;
  }

  /**
   * Manager qui valide : la personne elle-même si elle est manager, sinon celle de
   * l'approbation. Le serveur exige un manager pour ces actions, quel que soit le rôle.
   */
  private managerFor(actor: string, action: string, approval?: Approval, reason: ReasonRow['category'] | null = null): string {
    const manager = this.isManager(actor) && !approval ? actor : approval?.managerId;
    if (!manager || (reason && !approval)) throw new ManagerRequired(action, reason);
    if (!this.isManager(manager)) throw new PosError("La personne qui valide n'est pas manager");
    if (reason && !approval?.reasonId && !approval?.reasonText) throw new PosError('Motif obligatoire');
    return manager;
  }

  reasons(category: ReasonRow['category']): ReasonRow[] {
    return this.store.where<ReasonRow>('reason_codes', (r) => r.category === category && r.active);
  }

  private audit(action: string, entity: string, entityId: string, actor: string, approval: Approval | undefined, details: Record<string, unknown> = {}): LocalOp {
    return {
      entity: 'audit_log',
      kind: 'insert',
      id: this.deps.uuid(),
      data: {
        action,
        entity,
        entity_id: entityId,
        staff_id: actor,
        approved_by: approval?.managerId ?? null,
        reason_code_id: approval?.reasonId ?? null,
        reason_text: approval?.reasonText ?? null,
        details,
        created_at: this.nowIso(),
      },
    };
  }

  // Catalogue -------------------------------------------------------------------

  families(): FamilyRow[] {
    const est = this.store.meta('establishment_id');
    return this.store
      .where<FamilyRow>('families', (f) => !f.archived && (!f.establishment_id || f.establishment_id === est))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'fr'));
  }

  private override(itemId: string): Row | undefined {
    return this.store.all('establishment_item_overrides').find((o) => o.item_id === itemId);
  }

  priceOf(item: ItemRow): number {
    const o = this.override(item.id);
    return o && o.price_cents !== null && o.price_cents !== undefined ? num(o.price_cents) : num(item.price_cents);
  }

  isAvailable(item: ItemRow): boolean {
    const o = this.override(item.id);
    return o && o.available !== null && o.available !== undefined ? Boolean(o.available) : item.available;
  }

  items(familyId?: string): ItemRow[] {
    const fams = new Set(this.families().map((f) => f.id));
    return this.store
      .where<ItemRow>('items', (i) => !i.archived && fams.has(i.family_id) && (!familyId || i.family_id === familyId))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'fr'));
  }

  search(text: string): ItemRow[] {
    const q = text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!q) return [];
    return this.items().filter((i) => i.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)).slice(0, 40);
  }

  optionGroups(itemId: string): { group: OptionGroupRow; options: OptionRow[] }[] {
    return this.store
      .where('item_option_groups', (l) => l.item_id === itemId)
      .sort((a, b) => num(a.sort) - num(b.sort))
      .map((l) => this.store.get<OptionGroupRow>('option_groups', String(l.group_id)))
      .filter((g): g is OptionGroupRow => !!g)
      .map((group) => ({
        group,
        options: this.store.where<OptionRow>('options', (o) => o.group_id === group.id && !o.archived).sort((a, b) => a.sort - b.sort),
      }));
  }

  menuSteps(menuItemId: string): { step: MenuStepRow; choices: { choice: MenuChoiceRow; item: ItemRow }[] }[] {
    return this.store
      .where<MenuStepRow>('menu_steps', (s) => s.menu_item_id === menuItemId)
      .sort((a, b) => a.sort - b.sort)
      .map((step) => ({
        step,
        choices: this.store
          .where<MenuChoiceRow>('menu_step_choices', (c) => c.step_id === step.id)
          .sort((a, b) => a.sort - b.sort)
          .map((choice) => ({ choice, item: this.store.get<ItemRow>('items', choice.item_id)! }))
          .filter((c) => c.item && !c.item.archived),
      }));
  }

  /** Article qui ouvre une fenêtre de choix (options ou menu) avant d'être ajouté. */
  needsChoices(item: ItemRow): boolean {
    return item.kind === 'menu' || this.optionGroups(item.id).length > 0;
  }

  taxRateBp(item: ItemRow): number {
    const fam = this.store.get<FamilyRow>('families', item.family_id);
    const rateId = item.tax_rate_id ?? fam?.tax_rate_id;
    const rate = (rateId && this.store.get('tax_rates', rateId)) || this.store.all('tax_rates').find((t) => t.is_default);
    return rate ? num(rate.rate_bp) : 1000;
  }

  paymentMethods(): PaymentMethodRow[] {
    return this.store.where<PaymentMethodRow>('payment_methods', (m) => m.active).sort((a, b) => a.sort - b.sort);
  }

  defaultCustomer(): CustomerRow {
    const c = this.store.all<CustomerRow>('customers').find((x) => x.is_default);
    if (!c) throw new PosError('« Client divers » introuvable : synchronisation incomplète');
    return c;
  }

  customers(text = ''): CustomerRow[] {
    const q = text.trim().toLowerCase();
    return this.store
      .where<CustomerRow>('customers', (c) => !c.archived && !c.is_default && (!q || c.full_name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'fr'));
  }

  /** Solde d'ardoise ; les dettes locales provisoires s'effacent dès que celles du serveur arrivent. */
  customerBalance(customerId: string): number {
    const rows = this.store.where('customer_ledger', (l) => l.customer_id === customerId);
    const serverCharges = new Set(rows.filter((l) => !l.id.startsWith(LOCAL_ONLY_PREFIX) && l.kind === 'charge').map((l) => String(l.order_id)));
    return rows
      .filter((l) => !(l.id.startsWith(LOCAL_ONLY_PREFIX) && serverCharges.has(String(l.order_id))))
      .reduce((s, l) => s + num(l.amount_cents), 0);
  }

  /**
   * Règlement d'ardoise encaissé sur la tablette. En espèces, un apport est
   * aussi enregistré pour que le tiroir tombe juste à la clôture.
   */
  async settleCredit(actor: string, customerId: string, amountCents: number, methodId: string): Promise<void> {
    const c = this.store.get<CustomerRow>('customers', customerId);
    if (!c || c.is_default) throw new PosError('Client introuvable');
    const method = this.store.get<PaymentMethodRow>('payment_methods', methodId);
    if (!method?.active || method.kind === 'customer_credit') throw new PosError('Mode de règlement invalide');
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new PosError('Montant invalide');
    if (amountCents > this.customerBalance(customerId)) throw new PosError('Le règlement dépasse le solde dû');
    const at = this.nowIso();
    const ops: LocalOp[] = [
      { entity: 'customer_ledger', kind: 'insert', id: this.deps.uuid(), data: { customer_id: customerId, kind: 'payment', amount_cents: -amountCents, payment_method_id: methodId, note: 'Règlement en caisse', staff_id: actor, created_at: at } },
    ];
    if (method.kind === 'cash') {
      const session = this.sessionForPayment(actor);
      if (!session) throw new PosError('Ouvrez votre session de caisse pour encaisser des espèces');
      ops.push({ entity: 'cash_movements', kind: 'insert', id: this.deps.uuid(), data: { cash_session_id: session.id, kind: 'in', amount_cents: amountCents, note: `Règlement ardoise ${c.full_name}`, staff_id: actor, created_at: at } });
    }
    await this.write(ops);
    if (method.kind === 'cash') await this.openDrawer();
  }

  printers(): PrinterRow[] {
    return this.store.where<PrinterRow>('printers', (p) => p.active && p.establishment_id === this.store.meta('establishment_id'));
  }

  receiptPrinter(): PrinterRow | undefined {
    const preferred = this.store.meta('receipt_printer_id');
    const list = this.printers();
    return list.find((p) => p.id === preferred && p.prints_receipts) ?? list.find((p) => p.prints_receipts);
  }

  // Salle ------------------------------------------------------------------------

  zones(): ZoneRow[] {
    const est = this.store.meta('establishment_id');
    return this.store.where<ZoneRow>('zones', (z) => z.establishment_id === est).sort((a, b) => a.sort - b.sort);
  }

  tables(zoneId: string): TableRow[] {
    return this.store.where<TableRow>('dining_tables', (t) => t.zone_id === zoneId && t.active).sort((a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true }));
  }

  // Journée et caisse ---------------------------------------------------------------

  currentDay(): DayRow | undefined {
    return this.store.all<DayRow>('business_days').find((d) => d.status === 'open');
  }

  requireDay(): DayRow {
    const d = this.currentDay();
    if (!d) throw new PosError("La journée n'est pas ouverte");
    return d;
  }

  accessState(): string {
    return String(this.establishment()?.access_state ?? this.store.meta('access_state') ?? 'normal');
  }

  async openDay(actor: string, floatCents: number, approval?: Approval): Promise<DayRow> {
    if (this.currentDay()) throw new PosError('Une journée est déjà ouverte');
    if (this.accessState() === 'refuse_day_open') throw new PosError('Ouverture de journée suspendue : contactez CaisseBox');
    if (!Number.isInteger(floatCents) || floatCents < 0) throw new PosError('Fond de caisse invalide');
    const openedBy = this.managerFor(actor, 'Ouverture de journée', approval);
    const now = this.now();
    const day = { business_date: businessDateFor(now), opened_by: openedBy, opening_float_cents: floatCents, opened_at: now.toISOString(), status: 'open' };
    const id = this.deps.uuid();
    await this.write([{ entity: 'business_days', kind: 'insert', id, data: day }]);
    return this.store.get<DayRow>('business_days', id)!;
  }

  sessions(): SessionRow[] {
    const day = this.currentDay();
    return day ? this.store.where<SessionRow>('cash_sessions', (s) => s.business_day_id === day.id) : [];
  }

  openSessionFor(staffId: string): SessionRow | undefined {
    return this.sessions().find((s) => s.status === 'open' && s.staff_id === staffId);
  }

  /** Session où encaisser : celle de la personne, sinon la caisse de ce poste. */
  sessionForPayment(staffId: string): SessionRow | undefined {
    return this.openSessionFor(staffId) ?? this.sessions().find((s) => s.status === 'open' && s.kind === 'register' && s.register_label === this.registerLabel());
  }

  async openSession(actor: string, floatCents: number, kind: 'register' | 'waiter' = 'register'): Promise<SessionRow> {
    const day = this.requireDay();
    if (this.openSessionFor(actor)) throw new PosError('Vous avez déjà une session de caisse ouverte');
    if (!this.can(actor, 'cash.session') && kind === 'register') throw new PosError("Votre rôle n'ouvre pas de session de caisse");
    const id = this.deps.uuid();
    const label = kind === 'register' ? this.registerLabel() : `Serveur ${this.staffName(actor)}`;
    await this.write([
      {
        entity: 'cash_sessions',
        kind: 'insert',
        id,
        data: { business_day_id: day.id, register_label: label, staff_id: actor, kind, status: 'open', opening_float_cents: floatCents, opened_at: this.nowIso() },
      },
    ]);
    return this.store.get<SessionRow>('cash_sessions', id)!;
  }

  sessionFigures(sessionId: string) {
    const s = this.store.get<SessionRow>('cash_sessions', sessionId);
    if (!s) throw new PosError('Session inconnue');
    const methods = new Map(this.store.all<PaymentMethodRow>('payment_methods').map((m) => [m.id, m]));
    const payments = this.store.where<PaymentRow>('payments', (p) => p.cash_session_id === sessionId);
    const byMethod = new Map<string, { method: PaymentMethodRow | undefined; count: number; amountCents: number }>();
    for (const p of payments) {
      const m = byMethod.get(p.payment_method_id) ?? { method: methods.get(p.payment_method_id), count: 0, amountCents: 0 };
      m.count++;
      m.amountCents += num(p.amount_cents);
      byMethod.set(p.payment_method_id, m);
    }
    const mv = this.store.where<MovementRow>('cash_movements', (m) => m.cash_session_id === sessionId);
    const sum = (k: MovementRow['kind']) => mv.filter((m) => m.kind === k).reduce((t, m) => t + num(m.amount_cents), 0);
    const cashPayments = payments.filter((p) => methods.get(p.payment_method_id)?.kind === 'cash').reduce((t, p) => t + num(p.amount_cents), 0);
    const figures = {
      openingFloatCents: num(s.opening_float_cents),
      cashPaymentsCents: cashPayments,
      cashInCents: sum('in'),
      cashOutCents: sum('out'),
      waiterHandoversCents: sum('waiter_handover'),
    };
    return { session: s, figures, expectedCents: expectedCash(figures), byMethod: [...byMethod.values()], movements: mv };
  }

  async cashMovement(actor: string, sessionId: string, kind: 'out' | 'in' | 'no_sale', amountCents: number, opts: { reasonId?: string | null; note?: string | null } = {}, approval?: Approval): Promise<void> {
    const s = this.store.get<SessionRow>('cash_sessions', sessionId);
    if (!s || s.status !== 'open') throw new PosError('Session de caisse fermée');
    let approvedBy: string | null = null;
    if (kind === 'no_sale') {
      approvedBy = this.managerFor(actor, 'Ouverture du tiroir sans vente', approval);
      amountCents = 0;
    } else {
      approvedBy = this.require(actor, 'cash.movement', kind === 'out' ? 'Sortie de caisse' : 'Apport en caisse', approval);
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw new PosError('Montant invalide');
      if (kind === 'out' && !opts.reasonId) throw new PosError('Motif obligatoire pour une sortie de caisse');
      if (kind === 'out' && amountCents > this.sessionFigures(sessionId).expectedCents) throw new PosError('La sortie dépasse les espèces en caisse');
    }
    await this.write([
      {
        entity: 'cash_movements',
        kind: 'insert',
        id: this.deps.uuid(),
        data: { cash_session_id: sessionId, kind, amount_cents: amountCents, reason_code_id: opts.reasonId ?? null, note: opts.note ?? null, staff_id: actor, approved_by: approvedBy, created_at: this.nowIso() },
      },
    ]);
    if (kind === 'no_sale') await this.openDrawer();
  }

  async closeSession(actor: string, sessionId: string, countedCents: number, varianceReason?: string | null): Promise<{ expectedCents: number; varianceCents: number }> {
    const { session, expectedCents } = this.sessionFigures(sessionId);
    if (session.status !== 'open') throw new PosError('Session déjà clôturée');
    if (session.staff_id !== actor && !this.isManager(actor)) throw new PosError('Seule la personne de la session ou un manager peut la clôturer');
    if (!Number.isInteger(countedCents) || countedCents < 0) throw new PosError('Comptage invalide');
    const varianceCents = countedCents - expectedCents;
    if (varianceCents !== 0 && !varianceReason?.trim()) throw new PosError("Motif obligatoire en cas d'écart de caisse");
    await this.write([
      {
        entity: 'cash_sessions',
        kind: 'patch',
        id: sessionId,
        data: {
          status: 'closed',
          closed_at: this.nowIso(),
          counted_cash_cents: countedCents,
          expected_cash_cents: expectedCents,
          variance_cents: varianceCents,
          variance_reason: varianceCents ? varianceReason!.trim() : null,
        },
      },
    ]);
    return { expectedCents, varianceCents };
  }

  nextZNumber(): number {
    return this.store.metaNumber('last_z') + 1;
  }

  async closeDay(actor: string, approval?: Approval): Promise<number> {
    const day = this.requireDay();
    const manager = this.managerFor(actor, 'Clôture de journée', approval);
    const open = this.openOrders();
    if (open.length) throw new PosError(`${open.length} ticket(s) encore ouvert(s)`);
    const sessions = this.sessions().filter((s) => s.status === 'open');
    if (sessions.length) throw new PosError(`${sessions.length} session(s) de caisse encore ouverte(s)`);
    const z = this.nextZNumber();
    const printer = this.receiptPrinter();
    const report = printer ? this.reportBytes(printer, `RAPPORT Z N° ${z}`) : null;
    await this.write([{ entity: 'business_days', kind: 'patch', id: day.id, data: { status: 'closed', closed_at: this.nowIso(), closed_by: manager, z_number: z } }]);
    await this.store.setMeta({ last_z: z });
    if (printer && report) await this.deps.print?.([{ printerId: printer.id, label: `Rapport Z n° ${z}`, bytes: report }]);
    return z;
  }

  // Tickets -------------------------------------------------------------------------

  orders(): OrderRow[] {
    const day = this.currentDay();
    return day ? this.store.where<OrderRow>('orders', (o) => o.business_day_id === day.id) : [];
  }

  openOrders(): OrderRow[] {
    return this.orders().filter((o) => o.status === 'open');
  }

  orderForTable(tableId: string): OrderRow | undefined {
    return this.openOrders().find((o) => o.table_id === tableId);
  }

  nextOrderNumber(): string {
    const prefix = this.registerPrefix();
    const last = this.store.meta('last_order_number');
    const m = last ? PREFIX_RE.exec(last) : null;
    const counter = m && m[1] === prefix ? Number(m[2]) + 1 : 1;
    return formatOrderNumber(prefix, counter);
  }

  async createOrder(actor: string, input: { type: OrderRow['order_type']; tableId?: string | null; covers?: number | null; waiterId?: string; customerName?: string | null }): Promise<OrderRow> {
    const day = this.requireDay();
    if (!this.can(actor, 'order.take')) throw new PosError("Votre rôle ne permet pas de prendre des commandes");
    if (input.type === 'dine_in') {
      if (!input.tableId) throw new PosError('Choisissez une table');
      const existing = this.orderForTable(input.tableId);
      if (existing) return existing;
    }
    const number = this.nextOrderNumber();
    const id = this.deps.uuid();
    const callNumber = input.type === 'dine_in' ? null : this.nextCallNumber();
    await this.store.setMeta({ last_order_number: number });
    await this.write([
      {
        entity: 'orders',
        kind: 'insert',
        id,
        data: {
          business_day_id: day.id,
          number,
          order_type: input.type,
          table_id: input.type === 'dine_in' ? input.tableId : null,
          call_number: callNumber,
          customer_id: this.defaultCustomer().id,
          customer_name: input.customerName ?? null,
          waiter_id: input.waiterId ?? actor,
          covers: input.covers ?? null,
          status: 'open',
          discount_cents: 0,
          total_cents: 0,
          opened_at: this.nowIso(),
        },
      },
    ]);
    return this.store.get<OrderRow>('orders', id)!;
  }

  private nextCallNumber(): number {
    const used = this.orders().map((o) => num(o.call_number));
    return (used.length ? Math.max(...used) : 0) % 99 + 1;
  }

  lines(orderId: string): LineRow[] {
    return this.store.where<LineRow>('order_lines', (l) => l.order_id === orderId).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  }

  private lineOptions(lineId: string): LineOptionRow[] {
    return this.store.where<LineOptionRow>('order_line_options', (o) => o.order_line_id === lineId);
  }

  toOrderLine(l: LineRow): OrderLine {
    return {
      id: l.id,
      parentLineId: l.parent_line_id,
      itemId: l.item_id,
      name: l.name,
      quantity: l.quantity,
      unitPriceCents: num(l.unit_price_cents),
      taxRateBp: l.tax_rate_bp,
      discountCents: num(l.discount_cents),
      status: l.status,
      options: this.lineOptions(l.id).map((o) => ({ name: o.name, extraCents: num(o.extra_cents) })),
      note: l.note,
    };
  }

  totals(orderId: string): OrderTotals {
    const order = this.store.get<OrderRow>('orders', orderId);
    return orderTotals(this.lines(orderId).map((l) => this.toOrderLine(l)), num(order?.discount_cents));
  }

  /** Lignes affichées sur le ticket : un menu regroupe ses composants. */
  ticket(orderId: string): TicketLine[] {
    const all = this.lines(orderId);
    return all
      .filter((l) => !l.parent_line_id)
      .map((line) => {
        const children = all.filter((c) => c.parent_line_id === line.id);
        const options = this.lineOptions(line.id);
        const totalCents = line.status === 'voided' ? 0 : [line, ...children].reduce((s, l) => s + lineTotal(this.toOrderLine(l)), 0);
        const details = [
          ...options.map((o) => (num(o.extra_cents) ? `${o.name} +${(num(o.extra_cents) / 100).toFixed(2).replace('.', ',')}` : o.name)),
          ...children.map((c) => (num(c.unit_price_cents) ? `${c.name} +${(num(c.unit_price_cents) / 100).toFixed(2).replace('.', ',')}` : c.name)),
          ...(line.note ? [`Note : ${line.note}`] : []),
        ];
        return { line, children, options, totalCents, details };
      });
  }

  paidCents(orderId: string): number {
    return this.store.where<PaymentRow>('payments', (p) => p.order_id === orderId).reduce((s, p) => s + num(p.amount_cents), 0);
  }

  remainingCents(orderId: string): number {
    return this.totals(orderId).totalCents - this.paidCents(orderId);
  }

  private requireOpenOrder(orderId: string): OrderRow {
    const o = this.store.get<OrderRow>('orders', orderId);
    if (!o) throw new PosError('Ticket introuvable');
    if (o.status !== 'open') throw new PosError('Ticket déjà clos');
    return o;
  }

  async addLine(actor: string, orderId: string, input: NewLine): Promise<string> {
    this.requireOpenOrder(orderId);
    const item = this.store.get<ItemRow>('items', input.itemId);
    if (!item || item.archived) throw new PosError('Article introuvable');
    if (!this.isAvailable(item)) throw new PosError(`${item.name} est en rupture`);
    const qty = input.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new PosError('Quantité invalide');
    // Article simple déjà sur le ticket et pas encore envoyé : on augmente la quantité.
    const simple = item.kind === 'product' && !(input.optionIds?.length) && !input.note?.trim() && this.optionGroups(item.id).length === 0;
    if (simple) {
      const same = this.lines(orderId).find((l) => l.item_id === item.id && l.status === 'draft' && !l.parent_line_id && !l.note && this.lineOptions(l.id).length === 0 && num(l.unit_price_cents) === this.priceOf(item));
      if (same && same.quantity + qty <= 99) {
        await this.write([{ entity: 'order_lines', kind: 'patch', id: same.id, data: { quantity: same.quantity + qty } }]);
        return same.id;
      }
    }
    const createdAt = this.nowIso();
    const lineId = this.deps.uuid();
    const ops: LocalOp[] = [
      {
        entity: 'order_lines',
        kind: 'insert',
        id: lineId,
        data: {
          order_id: orderId, parent_line_id: null, item_id: item.id, name: item.name, quantity: qty, unit_price_cents: this.priceOf(item),
          tax_rate_bp: this.taxRateBp(item), discount_cents: 0, status: 'draft', note: input.note?.trim() || null, created_by: actor, created_at: createdAt,
        },
      },
    ];
    // Options et suppléments, avec contrôle des minimums et maximums.
    const groups = this.optionGroups(item.id);
    const chosen = new Set(input.optionIds ?? []);
    for (const { group, options } of groups) {
      const n = options.filter((o) => chosen.has(o.id)).length;
      if (n < group.min_select) throw new PosError(`${group.name} : ${group.min_select} choix minimum`);
      if (n > group.max_select) throw new PosError(`${group.name} : ${group.max_select} choix maximum`);
    }
    for (const optionId of chosen) {
      const opt = this.store.get<OptionRow>('options', optionId);
      if (!opt || !groups.some((g) => g.group.id === opt.group_id)) throw new PosError('Option invalide pour cet article');
      ops.push({ entity: 'order_line_options', kind: 'insert', id: this.deps.uuid(), data: { order_line_id: lineId, option_id: opt.id, name: opt.name, extra_cents: num(opt.extra_cents) } });
    }
    // Menu composé : un composant par choix, prix = supplément éventuel.
    if (item.kind === 'menu') {
      const steps = this.menuSteps(item.id);
      const picks = input.menuChoices ?? [];
      for (const { step, choices } of steps) {
        const mine = picks.filter((p) => p.stepId === step.id);
        if (mine.length < step.min_select) throw new PosError(`${step.name} : ${step.min_select} choix minimum`);
        if (mine.length > step.max_select) throw new PosError(`${step.name} : ${step.max_select} choix maximum`);
        for (const pick of mine) {
          const c = choices.find((x) => x.item.id === pick.itemId);
          if (!c) throw new PosError(`${step.name} : choix invalide`);
          ops.push({
            entity: 'order_lines',
            kind: 'insert',
            id: this.deps.uuid(),
            data: {
              order_id: orderId, parent_line_id: lineId, item_id: c.item.id, name: c.item.name, quantity: qty, unit_price_cents: num(c.choice.extra_cents),
              tax_rate_bp: this.taxRateBp(c.item), discount_cents: 0, status: 'draft', note: null, created_by: actor, created_at: createdAt,
            },
          });
        }
      }
    }
    await this.write(ops);
    return lineId;
  }

  /** Modifie la quantité d'une ligne pas encore envoyée (et de ses composants). */
  async setQuantity(orderId: string, lineId: string, quantity: number): Promise<void> {
    this.requireOpenOrder(orderId);
    const line = this.store.get<LineRow>('order_lines', lineId);
    if (!line || line.order_id !== orderId) throw new PosError('Ligne introuvable');
    if (line.status !== 'draft') throw new PosError('La quantité ne se modifie plus après envoi en préparation');
    if (quantity === 0) return this.removeDraft(orderId, lineId);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new PosError('Quantité invalide');
    const children = this.lines(orderId).filter((c) => c.parent_line_id === lineId);
    await this.write([line, ...children].map((l) => ({ entity: 'order_lines' as const, kind: 'patch' as const, id: l.id, data: { quantity } })));
  }

  async removeDraft(orderId: string, lineId: string): Promise<void> {
    const line = this.store.get<LineRow>('order_lines', lineId);
    if (!line || line.order_id !== orderId) throw new PosError('Ligne introuvable');
    if (line.status !== 'draft') throw new PosError('Ligne déjà envoyée : utilisez « Annuler » (validation manager)');
    const children = this.lines(orderId).filter((c) => c.parent_line_id === lineId);
    const at = this.nowIso();
    await this.write([line, ...children].map((l) => ({ entity: 'order_lines' as const, kind: 'patch' as const, id: l.id, data: { status: 'voided', voided_at: at } })));
  }

  async setNote(orderId: string, lineId: string, note: string): Promise<void> {
    this.requireOpenOrder(orderId);
    const line = this.store.get<LineRow>('order_lines', lineId);
    if (!line || line.status === 'voided') throw new PosError('Ligne introuvable');
    await this.write([{ entity: 'order_lines', kind: 'patch', id: lineId, data: { note: note.trim() || null } }]);
  }

  draftCount(orderId: string): number {
    return this.lines(orderId).filter((l) => l.status === 'draft' && !l.parent_line_id).length;
  }

  private routing() {
    const items = new Map<string, RoutingItem>(
      this.store.all<ItemRow>('items').map((i) => [i.id, { id: i.id, familyId: i.family_id, kind: i.kind, printerMode: i.printer_mode, printerId: i.printer_id }]),
    );
    const families = new Map<string, RoutingFamily>(this.store.all<FamilyRow>('families').map((f) => [f.id, { id: f.id, printerId: f.printer_id }]));
    return { items, families };
  }

  placeLabel(order: OrderRow): string {
    if (order.order_type === 'dine_in') return `Table ${this.store.get<TableRow>('dining_tables', order.table_id)?.label ?? '?'}`;
    if (order.order_type === 'takeaway') return order.customer_name ? `À emporter · ${order.customer_name}` : 'À emporter';
    return 'Comptoir';
  }

  /**
   * Envoi en préparation : les lignes « nouvelles » passent à « envoyées » et un
   * bon part vers chaque imprimante concernée (cuisine, bar…).
   */
  async send(actor: string, orderId: string): Promise<{ printers: number; lines: number }> {
    const order = this.requireOpenOrder(orderId);
    if (!this.can(actor, 'order.send')) throw new PosError("Votre rôle ne permet pas d'envoyer en préparation");
    const lines = this.lines(orderId);
    const drafts = lines.filter((l) => l.status === 'draft');
    if (!drafts.length) return { printers: 0, lines: 0 };
    const { items, families } = this.routing();
    const batches = planPreparation(drafts.map((l) => this.toOrderLine(l)), items, families);
    const at = this.nowIso();
    const ops: LocalOp[] = drafts.map((l) => ({ entity: 'order_lines', kind: 'patch', id: l.id, data: { status: 'sent', sent_at: at } }));
    const jobs: PrintRequest[] = [];
    const printers = new Map(this.store.all<PrinterRow>('printers').map((p) => [p.id, p]));
    for (const b of batches) {
      const printer = printers.get(b.printerId);
      if (!printer) continue;
      const ticketId = this.deps.uuid();
      ops.push({ entity: 'kitchen_tickets', kind: 'insert', id: ticketId, data: { order_id: orderId, printer_id: b.printerId, kind: 'prep', line_ids: b.lineIds, status: 'queued', created_at: at } });
      jobs.push({ printerId: printer.id, label: `Bon ${printer.name} · ${order.number}`, bytes: this.prepBytes(order, printer, b.lineIds, 'prep'), kitchenTicketId: ticketId });
    }
    await this.write(ops);
    if (jobs.length) await this.deps.print?.(jobs);
    return { printers: jobs.length, lines: drafts.filter((l) => !l.parent_line_id).length };
  }

  private prepBytes(order: OrderRow, printer: PrinterRow, lineIds: string[], kind: 'prep' | 'void'): Uint8Array {
    const byId = new Map(this.lines(order.id).map((l) => [l.id, l]));
    return preparationTicket(
      {
        kind,
        printerName: printer.name,
        number: order.number,
        place: this.placeLabel(order),
        waiterName: this.staffName(order.waiter_id),
        date: this.now(),
        callNumber: order.call_number,
        lines: lineIds
          .map((id) => byId.get(id))
          .filter((l): l is LineRow => !!l)
          .map((l) => ({
            quantity: l.quantity,
            name: l.name,
            details: this.lineOptions(l.id).map((o) => o.name),
            note: l.note,
            menuName: l.parent_line_id ? (byId.get(l.parent_line_id)?.name ?? null) : null,
          })),
      },
      { paperWidth: printer.paper_width_mm },
    );
  }

  /** Annulation d'une ligne envoyée : manager + motif, et bon d'annulation en cuisine. */
  async voidLine(actor: string, orderId: string, lineId: string, approval?: Approval): Promise<void> {
    const order = this.requireOpenOrder(orderId);
    const line = this.store.get<LineRow>('order_lines', lineId);
    if (!line || line.order_id !== orderId || line.parent_line_id) throw new PosError('Ligne introuvable');
    if (line.status === 'draft') return this.removeDraft(orderId, lineId);
    if (line.status === 'voided') return;
    const manager = this.managerFor(actor, 'Annulation après envoi', approval, 'void');
    if (!approval?.reasonId) throw new PosError("Choisissez un motif d'annulation");
    const children = this.lines(orderId).filter((c) => c.parent_line_id === lineId && c.status !== 'voided');
    const at = this.nowIso();
    const ops: LocalOp[] = [line, ...children].map((l) => ({
      entity: 'order_lines' as const,
      kind: 'patch' as const,
      id: l.id,
      data: { status: 'voided', voided_at: at, approved_by: manager, void_reason_code_id: approval.reasonId },
    }));
    ops.push(this.audit('line.void', 'order_lines', lineId, actor, approval, { name: line.name, quantity: line.quantity, order: order.number }));
    // Bon d'annulation vers les imprimantes qui avaient reçu la ligne.
    const { items, families } = this.routing();
    const jobs: PrintRequest[] = [];
    const targets = new Map<string, string[]>();
    for (const l of [line, ...children]) {
      const item = items.get(l.item_id);
      if (!item) continue;
      const printerId = item.kind === 'menu' ? null : item.printerMode === 'none' ? null : item.printerMode === 'printer' ? item.printerId : families.get(item.familyId)?.printerId;
      if (printerId) targets.set(printerId, [...(targets.get(printerId) ?? []), l.id]);
    }
    for (const [printerId, ids] of targets) {
      const printer = this.store.get<PrinterRow>('printers', printerId);
      if (!printer) continue;
      const ticketId = this.deps.uuid();
      ops.push({ entity: 'kitchen_tickets', kind: 'insert', id: ticketId, data: { order_id: orderId, printer_id: printerId, kind: 'void', line_ids: ids, status: 'queued', created_at: at } });
      jobs.push({ printerId, label: `Annulation ${printer.name} · ${order.number}`, bytes: this.prepBytes(order, printer, ids, 'void'), kitchenTicketId: ticketId });
    }
    await this.write(ops);
    if (jobs.length) await this.deps.print?.(jobs);
  }

  async compLine(actor: string, orderId: string, lineId: string, approval?: Approval): Promise<void> {
    this.requireOpenOrder(orderId);
    const line = this.store.get<LineRow>('order_lines', lineId);
    if (!line || line.order_id !== orderId || line.parent_line_id) throw new PosError('Ligne introuvable');
    if (line.status === 'voided' || line.status === 'comp') throw new PosError('Ligne déjà annulée ou offerte');
    const manager = this.managerFor(actor, 'Article offert', approval);
    const children = this.lines(orderId).filter((c) => c.parent_line_id === lineId && c.status !== 'voided');
    const ops: LocalOp[] = [line, ...children].map((l) => ({ entity: 'order_lines' as const, kind: 'patch' as const, id: l.id, data: { status: 'comp', approved_by: manager } }));
    ops.push(this.audit('line.comp', 'order_lines', lineId, actor, approval ?? { managerId: manager }, { name: line.name, quantity: line.quantity }));
    await this.write(ops);
  }

  async setDiscount(actor: string, orderId: string, discountCents: number, approval?: Approval): Promise<void> {
    const order = this.requireOpenOrder(orderId);
    const subtotal = this.totals(orderId).subtotalCents;
    if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents > subtotal) throw new PosError('Remise invalide');
    if (subtotal - discountCents < this.paidCents(orderId)) throw new PosError('La remise ferait passer le total sous les paiements déjà reçus');
    const bp = subtotal ? Math.round((discountCents * 10000) / subtotal) : 0;
    if (discountCents > 0 && (!this.can(actor, 'order.discount') || bp > this.maxDiscountBp(actor))) {
      if (!approval) throw new ManagerRequired('Remise au-delà de votre limite', 'discount');
      if (!this.isManager(approval.managerId)) throw new PosError("La personne qui valide n'est pas manager");
    }
    const ops: LocalOp[] = [{ entity: 'orders', kind: 'patch', id: orderId, data: { discount_cents: discountCents } }];
    if (discountCents > 0) ops.push(this.audit('order.discount', 'orders', orderId, actor, approval, { discount_cents: discountCents, number: order.number }));
    await this.write(ops);
  }

  async updateOrder(orderId: string, patch: { covers?: number | null; customerId?: string; customerName?: string | null; tableId?: string; waiterId?: string; note?: string | null }): Promise<void> {
    const order = this.requireOpenOrder(orderId);
    const data: Record<string, unknown> = {};
    if (patch.covers !== undefined) data.covers = patch.covers;
    if (patch.customerId !== undefined) data.customer_id = patch.customerId;
    if (patch.customerName !== undefined) data.customer_name = patch.customerName;
    if (patch.waiterId !== undefined) data.waiter_id = patch.waiterId;
    if (patch.note !== undefined) data.note = patch.note;
    if (patch.tableId !== undefined && patch.tableId !== order.table_id) {
      if (order.order_type !== 'dine_in') throw new PosError('Seul un ticket de table change de table');
      if (this.orderForTable(patch.tableId)) throw new PosError('Cette table est déjà occupée : utilisez « Fusionner »');
      data.table_id = patch.tableId;
    }
    if (Object.keys(data).length) await this.write([{ entity: 'orders', kind: 'patch', id: orderId, data }]);
  }

  /** Fusion : toutes les lignes non annulées d'un ticket passent sur un autre, le premier est annulé. */
  async mergeInto(actor: string, fromId: string, intoId: string): Promise<void> {
    this.requireOpenOrder(fromId);
    this.requireOpenOrder(intoId);
    if (fromId === intoId) return;
    if (this.paidCents(fromId) > 0) throw new PosError('Un ticket déjà partiellement payé ne peut pas être fusionné');
    const moving = this.lines(fromId).filter((l) => l.status !== 'voided');
    const ops: LocalOp[] = moving.map((l) => ({ entity: 'order_lines', kind: 'patch', id: l.id, data: { order_id: intoId } }));
    ops.push({ entity: 'orders', kind: 'patch', id: fromId, data: { status: 'voided', closed_at: this.nowIso() } });
    ops.push(this.audit('order.merge', 'orders', fromId, actor, undefined, { into: intoId }));
    await this.write(ops);
  }

  async voidEmptyOrder(orderId: string): Promise<void> {
    this.requireOpenOrder(orderId);
    if (this.lines(orderId).some((l) => l.status !== 'voided')) throw new PosError('Le ticket contient encore des articles');
    if (this.paidCents(orderId) > 0) throw new PosError('Le ticket a déjà des paiements');
    await this.write([{ entity: 'orders', kind: 'patch', id: orderId, data: { status: 'voided', closed_at: this.nowIso() } }]);
  }

  // Encaissement ------------------------------------------------------------------------

  /**
   * Enregistre un ou plusieurs paiements. Quand le ticket est soldé, il est clos,
   * le ticket client part à l'impression et le tiroir s'ouvre s'il y a des espèces.
   */
  async pay(actor: string, orderId: string, parts: PaymentInput[], opts: { printReceipt?: boolean } = {}): Promise<{ closed: boolean; changeCents: number; remainingCents: number }> {
    const order = this.requireOpenOrder(orderId);
    const session = this.sessionForPayment(actor);
    if (!session) throw new PosError("Aucune session de caisse ouverte : ouvrez la caisse avant d'encaisser");
    const own = order.waiter_id === actor;
    if (!this.can(actor, 'order.pay_any') && !(own && this.can(actor, 'order.pay_own'))) throw new PosError("Votre rôle ne permet pas d'encaisser ce ticket");
    if (this.draftCount(orderId) > 0 && this.kitchenSendMode() === 'auto') await this.send(actor, orderId);
    let remaining = this.remainingCents(orderId);
    if (remaining <= 0 && this.totals(orderId).totalCents > 0) throw new PosError('Ticket déjà soldé');
    const methods = new Map(this.store.all<PaymentMethodRow>('payment_methods').map((m) => [m.id, m]));
    const ops: LocalOp[] = [];
    let change = 0;
    let cash = false;
    const at = this.nowIso();
    for (const p of parts) {
      const method = methods.get(p.methodId);
      if (!method?.active) throw new PosError('Mode de paiement inconnu ou désactivé');
      if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new PosError('Montant invalide');
      let amount = p.amountCents;
      let changeCents = 0;
      if (method.kind === 'cash') {
        cash = true;
        const tendered = p.tenderedCents ?? amount;
        const applied = changeFor(Math.min(amount, remaining), tendered);
        amount = applied.appliedCents;
        changeCents = applied.changeCents;
      }
      if (amount > remaining) throw new PosError(`Paiement supérieur au reste dû (${(remaining / 100).toFixed(2).replace('.', ',')} DH)`);
      if (method.kind === 'customer_credit') {
        const c = this.store.get<CustomerRow>('customers', p.customerId);
        if (!c || c.is_default) throw new PosError('Le crédit client exige un client identifié (pas « Client divers »)');
        const limit = num(c.credit_limit_cents);
        if (limit > 0 && this.customerBalance(c.id) + amount > limit) throw new PosError(`Plafond d'ardoise dépassé pour ${c.full_name}`);
      }
      remaining -= amount;
      change += changeCents;
      ops.push({
        entity: 'payments',
        kind: 'insert',
        id: this.deps.uuid(),
        data: {
          order_id: orderId, cash_session_id: session.id, payment_method_id: method.id, amount_cents: amount,
          tendered_cents: method.kind === 'cash' ? (p.tenderedCents ?? amount) : null, change_cents: changeCents,
          customer_id: method.kind === 'customer_credit' ? p.customerId : null, split_label: p.splitLabel ?? null, staff_id: actor, created_at: at,
        },
      });
      if (method.kind === 'customer_credit' && p.customerId && order.customer_id !== p.customerId) {
        ops.push({ entity: 'orders', kind: 'patch', id: orderId, data: { customer_id: p.customerId } });
      }
    }
    const total = this.totals(orderId).totalCents;
    const closed = remaining === 0;
    if (closed) ops.push({ entity: 'orders', kind: 'patch', id: orderId, data: { status: 'paid', total_cents: total, closed_at: at } });
    // L'ardoise (dette) est créée par le serveur à partir du paiement ; on la reflète localement pour les plafonds.
    await this.write(ops);
    for (const op of ops.filter((o) => o.entity === 'payments' && methods.get(String(o.data.payment_method_id))?.kind === 'customer_credit')) {
      await this.store.applyRemote(
        [{ entity: 'customer_ledger', entityId: `local-${op.id}`, op: 'upsert', data: { id: `local-${op.id}`, customer_id: op.data.customer_id, kind: 'charge', amount_cents: op.data.amount_cents, order_id: orderId, created_at: at } }],
        true,
      );
    }
    if (closed && (opts.printReceipt ?? true)) await this.printReceipt(actor, orderId, { changeCents: change, openDrawer: cash });
    else if (cash) await this.openDrawer();
    return { closed, changeCents: change, remainingCents: remaining };
  }

  receiptEstablishment(): ReceiptEstablishment {
    const e = this.establishment();
    const t = this.tenant();
    return {
      name: String(e?.name ?? t?.name ?? 'CaisseBox'),
      legalName: (t?.legal_name as string) ?? null,
      address: (e?.address as string) ?? (t?.address as string) ?? null,
      ice: (t?.ice as string) ?? null,
      ifNumber: (t?.if_number as string) ?? null,
      rc: (t?.rc as string) ?? null,
      patente: (t?.patente as string) ?? null,
      header: (e?.receipt_header as string) ?? null,
      footer: (e?.receipt_footer as string) ?? null,
    };
  }

  receiptData(orderId: string, opts: { changeCents?: number; duplicate?: number; proForma?: boolean; openDrawer?: boolean } = {}): ReceiptData {
    const order = this.store.get<OrderRow>('orders', orderId);
    if (!order) throw new PosError('Ticket introuvable');
    const t = this.totals(orderId);
    const methods = new Map(this.store.all<PaymentMethodRow>('payment_methods').map((m) => [m.id, m]));
    const payments = this.store.where<PaymentRow>('payments', (p) => p.order_id === orderId);
    return {
      establishment: this.receiptEstablishment(),
      number: order.number,
      place: this.placeLabel(order),
      waiterName: this.staffName(order.waiter_id),
      date: order.closed_at ? new Date(order.closed_at) : this.now(),
      lines: this.ticket(orderId)
        .filter((l) => l.line.status !== 'voided')
        .map((l) => ({ quantity: l.line.quantity, name: l.line.name, totalCents: l.line.status === 'comp' ? 0 : l.totalCents, details: l.details, comp: l.line.status === 'comp' })),
      subtotalCents: t.subtotalCents,
      discountCents: t.orderDiscountCents,
      totalCents: t.totalCents,
      taxes: t.taxes,
      payments: payments.map((p) => ({ label: methods.get(p.payment_method_id)?.label ?? 'Paiement', amountCents: num(p.amount_cents) })),
      changeCents: opts.changeCents ?? payments.reduce((s, p) => s + num(p.change_cents), 0),
      duplicate: opts.duplicate,
      proForma: opts.proForma,
      callNumber: order.call_number,
      openDrawer: opts.openDrawer,
    };
  }

  async printReceipt(actor: string, orderId: string, opts: { changeCents?: number; openDrawer?: boolean; proForma?: boolean } = {}): Promise<void> {
    const printer = this.receiptPrinter();
    if (!printer) throw new PosError('Aucune imprimante de tickets configurée');
    const order = this.store.get<OrderRow>('orders', orderId)!;
    const data = this.receiptData(orderId, { ...opts, openDrawer: opts.openDrawer && printer.opens_drawer });
    void actor;
    await this.deps.print?.([{ printerId: printer.id, label: `${opts.proForma ? 'Addition' : 'Ticket'} ${order.number}`, bytes: customerReceipt(data, { paperWidth: printer.paper_width_mm }) }]);
  }

  /** Duplicata : numéroté et tracé ; au-delà du premier, droit « réimprimer » nécessaire. */
  async printDuplicate(actor: string, orderId: string, approval?: Approval): Promise<number> {
    const order = this.store.get<OrderRow>('orders', orderId);
    if (!order || order.status !== 'paid') throw new PosError('Seul un ticket payé a un duplicata');
    const count = this.store.where('audit_log', (a) => a.action === 'receipt.duplicate' && a.entity_id === orderId).length + 1;
    if (!this.can(actor, 'receipt.reprint') && !approval) throw new ManagerRequired('Réimpression du ticket');
    const printer = this.receiptPrinter();
    if (!printer) throw new PosError('Aucune imprimante de tickets configurée');
    await this.write([this.audit('receipt.duplicate', 'orders', orderId, actor, approval, { duplicate: count })]);
    await this.deps.print?.([{ printerId: printer.id, label: `Duplicata ${order.number}`, bytes: customerReceipt(this.receiptData(orderId, { duplicate: count }), { paperWidth: printer.paper_width_mm }) }]);
    return count;
  }

  async printTest(printerId: string): Promise<void> {
    const p = this.store.get<PrinterRow>('printers', printerId);
    if (!p) throw new PosError('Imprimante inconnue');
    const b = new EscPosBuilder(p.paper_width_mm).init().align('center').bold().size('double').line('CaisseBox').size('normal').bold(false);
    b.line(`Test d'impression · ${p.name}`).line(`${p.connection === 'wifi' ? `Wi-Fi ${p.address}:${p.port}` : `Bluetooth ${p.address}`}`).line(`Papier ${p.paper_width_mm} mm`).separator();
    b.align('left').line('Accents : é è à ç ô ù').pair('Montant', '1 234,50 DH').feed(3).cut();
    await this.deps.print?.([{ printerId: p.id, label: `Test ${p.name}`, bytes: b.bytes() }]);
  }

  async openDrawer(): Promise<void> {
    const printer = this.printers().find((p) => p.opens_drawer);
    if (!printer) return;
    // ESC p 0 25 250 : impulsion sur la broche 2 du tiroir.
    await this.deps.print?.([{ printerId: printer.id, label: 'Ouverture du tiroir', bytes: new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]) }]);
  }

  /** Marque un bon de préparation comme imprimé (appelé par la file d'impression). */
  async markKitchenTicket(ticketId: string, status: 'printed' | 'failed'): Promise<void> {
    if (!this.store.get('kitchen_tickets', ticketId)) return;
    await this.write([{ entity: 'kitchen_tickets', kind: 'patch', id: ticketId, data: { status, printed_at: status === 'printed' ? this.nowIso() : null } }]);
  }

  // Rapport X (journée en cours) -----------------------------------------------------------

  /** Impression du rapport X (lecture sans remise à zéro), global ou d'un serveur. */
  async printXReport(actor: string, staffId?: string): Promise<void> {
    if (!this.can(actor, 'report.x') && !(staffId === actor && this.can(actor, 'report.own'))) throw new PosError("Votre rôle n'imprime pas ce rapport");
    const printer = this.receiptPrinter();
    if (!printer) throw new PosError('Aucune imprimante de tickets configurée');
    await this.deps.print?.([{ printerId: printer.id, label: 'Rapport X', bytes: this.reportBytes(printer, 'RAPPORT X', staffId) }]);
  }

  private reportBytes(printer: PrinterRow, title: string, staffId?: string): Uint8Array {
    const x = this.xReport(staffId);
    const money = (c: number) => `${formatCents(c, { ascii: true })} DH`;
    const b = new EscPosBuilder(printer.paper_width_mm).init().align('center').bold().size('double').line(title).size('normal').bold(false);
    b.line(this.receiptEstablishment().name).line(`Journée du ${x.day.business_date}`).line(staffId ? `Serveur : ${this.staffName(staffId)}` : 'Tous les serveurs');
    b.line(`Édité le ${this.now().toLocaleString('fr-FR', { timeZone: 'Africa/Casablanca' })}`).align('left').separator();
    b.pair('Tickets encaissés', String(x.orders)).pair('Tickets ouverts', String(x.openOrders)).bold().pair('CA TTC', money(x.totalCents)).bold(false).pair('Ticket moyen', money(x.averageCents)).separator();
    for (const t of x.taxes) b.pair(`TVA ${t.rateBp / 100} % HT`, money(t.ht)).pair(`TVA ${t.rateBp / 100} %`, money(t.tva));
    b.separator().bold().line('Paiements').bold(false);
    for (const p of x.payments) b.pair(p.label, money(p.amountCents));
    if (!staffId) {
      b.separator().bold().line('Serveurs').bold(false);
      for (const w of x.waiters) b.pair(`${w.name} (${w.orders})`, money(w.amountCents));
    }
    b.feed(3).cut();
    return b.bytes();
  }

  xReport(staffId?: string) {
    const day = this.requireDay();
    const paid = this.orders().filter((o) => o.status === 'paid' && (!staffId || o.waiter_id === staffId));
    const methods = new Map(this.store.all<PaymentMethodRow>('payment_methods').map((m) => [m.id, m]));
    const byMethod = new Map<string, number>();
    const byWaiter = new Map<string, { name: string; orders: number; amountCents: number }>();
    let ttc = 0;
    const taxes = new Map<number, { rateBp: number; ht: number; tva: number; ttc: number }>();
    for (const o of paid) {
      const t = this.totals(o.id);
      ttc += t.totalCents;
      for (const r of t.taxes) {
        const agg = taxes.get(r.rateBp) ?? { rateBp: r.rateBp, ht: 0, tva: 0, ttc: 0 };
        agg.ht += r.ht;
        agg.tva += r.tva;
        agg.ttc += r.ttc;
        taxes.set(r.rateBp, agg);
      }
      const w = byWaiter.get(o.waiter_id) ?? { name: this.staffName(o.waiter_id), orders: 0, amountCents: 0 };
      w.orders++;
      w.amountCents += t.totalCents;
      byWaiter.set(o.waiter_id, w);
      for (const p of this.store.where<PaymentRow>('payments', (x) => x.order_id === o.id)) {
        const label = methods.get(p.payment_method_id)?.label ?? 'Autre';
        byMethod.set(label, (byMethod.get(label) ?? 0) + num(p.amount_cents));
      }
    }
    return {
      day,
      orders: paid.length,
      openOrders: this.openOrders().length,
      totalCents: ttc,
      averageCents: paid.length ? Math.round(ttc / paid.length) : 0,
      taxes: [...taxes.values()].sort((a, b) => a.rateBp - b.rateBp),
      payments: [...byMethod.entries()].map(([label, amountCents]) => ({ label, amountCents })),
      waiters: [...byWaiter.values()].sort((a, b) => b.amountCents - a.amountCents),
    };
  }
}

