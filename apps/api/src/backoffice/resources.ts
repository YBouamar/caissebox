import { z, ZodTypeAny } from 'zod';

/**
 * Ressources du back-office gérées par un CRUD générique et sûr.
 *
 * Chaque ressource déclare ses colonnes créables et modifiables (schémas zod),
 * ses clés étrangères (vérifiées sous RLS : une contrainte FK PostgreSQL ne voit
 * pas la RLS et accepterait l'identifiant d'un autre client) et son tri.
 * Pas de suppression physique : on archive ou on désactive. Seules les tables de
 * liaison (options d'un article, choix d'une étape de menu) se suppriment.
 */
export interface ResourceDef {
  table: string;
  create: z.ZodObject<Record<string, ZodTypeAny>>;
  update: z.ZodObject<Record<string, ZodTypeAny>>;
  /** colonne → table référencée */
  refs: Record<string, string>;
  orderBy: string;
  /** Filtres de liste autorisés en query string (égalité). */
  filters: readonly string[];
  deletable?: boolean;
}

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const cents = z.number().int().min(0).max(100_000_000);
const sort = z.number().int().min(0).max(10_000);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

function def(d: Omit<ResourceDef, 'update'> & { update?: ResourceDef['update'] }): ResourceDef {
  return { ...d, update: d.update ?? d.create };
}

const taxCreate = z.object({ label: name, rate_bp: z.number().int().min(0).max(10000), is_default: z.boolean().optional() });

const printerCreate = z.object({
  establishment_id: uuid,
  name,
  connection: z.enum(['bluetooth', 'wifi']),
  address: z.string().trim().min(3).max(64),
  port: z.number().int().min(1).max(65535).optional(),
  paper_width_mm: z.union([z.literal(58), z.literal(80)]).optional(),
  prints_receipts: z.boolean().optional(),
  prints_preparation: z.boolean().optional(),
  opens_drawer: z.boolean().optional(),
  active: z.boolean().optional(),
});

const familyCreate = z.object({
  establishment_id: uuid.nullable().optional(),
  name,
  color: color.optional(),
  sort: sort.optional(),
  printer_id: uuid.nullable().optional(),
  tax_rate_id: uuid.nullable().optional(),
  archived: z.boolean().optional(),
});

const itemCreate = z.object({
  family_id: uuid,
  kind: z.enum(['product', 'menu']).optional(),
  name,
  price_cents: cents,
  tax_rate_id: uuid.nullable().optional(),
  printer_mode: z.enum(['inherit', 'none', 'printer']).optional(),
  printer_id: uuid.nullable().optional(),
  stock_mode: z.enum(['none', 'unit', 'recipe']).optional(),
  available: z.boolean().optional(),
  sort: sort.optional(),
  archived: z.boolean().optional(),
});

const groupCreate = z.object({ name, min_select: z.number().int().min(0).max(20).optional(), max_select: z.number().int().min(1).max(20).optional() });
const optionCreate = z.object({ group_id: uuid, name, extra_cents: cents.optional(), sort: sort.optional(), archived: z.boolean().optional() });
const stepCreate = z.object({
  menu_item_id: uuid,
  name,
  min_select: z.number().int().min(0).max(20).optional(),
  max_select: z.number().int().min(1).max(20).optional(),
  sort: sort.optional(),
});
const zoneCreate = z.object({ establishment_id: uuid, name, sort: sort.optional() });
const tableCreate = z.object({
  establishment_id: uuid,
  zone_id: uuid,
  label: z.string().trim().min(1).max(12),
  seats: z.number().int().min(1).max(40).optional(),
  shape: z.enum(['square', 'round', 'long']).optional(),
  x: z.number().int().min(0).max(4000).optional(),
  y: z.number().int().min(0).max(4000).optional(),
  w: z.number().int().min(40).max(600).optional(),
  h: z.number().int().min(40).max(600).optional(),
  active: z.boolean().optional(),
});
const customerCreate = z.object({
  full_name: name,
  phone: z.string().trim().max(20).nullable().optional(),
  company: z.string().trim().max(120).nullable().optional(),
  ice: z.string().regex(/^\d{15}$/).nullable().optional(),
  credit_limit_cents: cents.optional(),
  archived: z.boolean().optional(),
});

export const RESOURCES: Record<string, ResourceDef> = {
  'tax-rates': def({ table: 'tax_rates', create: taxCreate, update: taxCreate.partial(), refs: {}, orderBy: 'rate_bp', filters: [] }),
  printers: def({
    table: 'printers',
    create: printerCreate,
    update: printerCreate.omit({ establishment_id: true }).partial(),
    refs: { establishment_id: 'establishments' },
    orderBy: 'name',
    filters: ['establishment_id'],
  }),
  families: def({
    table: 'families',
    create: familyCreate,
    update: familyCreate.partial(),
    refs: { establishment_id: 'establishments', printer_id: 'printers', tax_rate_id: 'tax_rates' },
    orderBy: 'sort, name',
    filters: ['establishment_id', 'archived'],
  }),
  items: def({
    table: 'items',
    create: itemCreate,
    update: itemCreate.partial(),
    refs: { family_id: 'families', tax_rate_id: 'tax_rates', printer_id: 'printers' },
    orderBy: 'sort, name',
    filters: ['family_id', 'kind', 'archived'],
  }),
  'option-groups': def({ table: 'option_groups', create: groupCreate, update: groupCreate.partial(), refs: {}, orderBy: 'name', filters: [] }),
  options: def({
    table: 'options',
    create: optionCreate,
    update: optionCreate.omit({ group_id: true }).partial(),
    refs: { group_id: 'option_groups' },
    orderBy: 'sort, name',
    filters: ['group_id'],
  }),
  'item-option-groups': def({
    table: 'item_option_groups',
    create: z.object({ item_id: uuid, group_id: uuid, sort: sort.optional() }),
    update: z.object({ sort }),
    refs: { item_id: 'items', group_id: 'option_groups' },
    orderBy: 'sort',
    filters: ['item_id'],
    deletable: true,
  }),
  'menu-steps': def({
    table: 'menu_steps',
    create: stepCreate,
    update: stepCreate.omit({ menu_item_id: true }).partial(),
    refs: { menu_item_id: 'items' },
    orderBy: 'sort',
    filters: ['menu_item_id'],
    deletable: true,
  }),
  'menu-step-choices': def({
    table: 'menu_step_choices',
    create: z.object({ step_id: uuid, item_id: uuid, extra_cents: cents.optional(), sort: sort.optional() }),
    update: z.object({ extra_cents: cents.optional(), sort: sort.optional() }),
    refs: { step_id: 'menu_steps', item_id: 'items' },
    orderBy: 'sort',
    filters: ['step_id'],
    deletable: true,
  }),
  zones: def({
    table: 'zones',
    create: zoneCreate,
    update: zoneCreate.omit({ establishment_id: true }).partial(),
    refs: { establishment_id: 'establishments' },
    orderBy: 'sort, name',
    filters: ['establishment_id'],
  }),
  tables: def({
    table: 'dining_tables',
    create: tableCreate,
    update: tableCreate.omit({ establishment_id: true }).partial(),
    refs: { establishment_id: 'establishments', zone_id: 'zones' },
    orderBy: 'label',
    filters: ['establishment_id', 'zone_id'],
  }),
  'reason-codes': def({
    table: 'reason_codes',
    create: z.object({ category: z.enum(['void', 'comp', 'discount', 'cash_out', 'cash_variance']), label: name, active: z.boolean().optional() }),
    update: z.object({ label: name, active: z.boolean() }).partial(),
    refs: {},
    orderBy: 'category, label',
    filters: ['category'],
  }),
  'payment-methods': def({
    table: 'payment_methods',
    create: z.object({ label: name, kind: z.literal('other'), active: z.boolean().optional(), sort: sort.optional() }),
    update: z.object({ label: name, active: z.boolean(), sort }).partial(),
    refs: {},
    orderBy: 'sort',
    filters: [],
  }),
  customers: def({ table: 'customers', create: customerCreate, update: customerCreate.partial(), refs: {}, orderBy: 'is_default DESC, full_name', filters: ['archived'] }),
};
