import { z } from 'zod';

/**
 * Protocole de synchronisation CaisseBox (développé en interne).
 *
 * Montée (push) : chaque écriture faite sur la tablette devient une opération
 * numérotée (device_seq strictement croissant par tablette) placée dans une
 * boîte d'envoi locale. La tablette envoie ses opérations par lots, dans l'ordre.
 * Le serveur les applique une par une, de façon idempotente (op_id unique) :
 * renvoyer un lot déjà reçu ne crée jamais de doublon.
 *
 * Descente (pull) : toute écriture en base (tablettes, back-office, console)
 * alimente change_log par trigger. La tablette demande les changements de son
 * établissement après son dernier curseur (server_seq).
 */

export const SYNC_PROTOCOL_VERSION = 1;
export const MAX_OPS_PER_PUSH = 500;
export const MAX_CHANGES_PER_PULL = 1000;

export const WRITABLE_ENTITIES = [
  'business_days',
  'cash_sessions',
  'cash_movements',
  'cash_counts',
  'customers',
  'customer_ledger',
  'orders',
  'order_lines',
  'order_line_options',
  'payments',
  'kitchen_tickets',
  'audit_log',
] as const;

export type WritableEntity = (typeof WRITABLE_ENTITIES)[number];

export interface EntityWriteRule {
  /** Colonnes qu'une tablette peut fournir à la création. */
  insert: readonly string[];
  /** Colonnes modifiables ensuite ; vide = ajout seul. */
  patch: readonly string[];
  /** La table a une colonne establishment_id, imposée par le serveur. */
  scopedToEstablishment: boolean;
}

export const WRITE_RULES: Readonly<Record<WritableEntity, EntityWriteRule>> = {
  business_days: {
    insert: ['id', 'business_date', 'status', 'opened_at', 'opened_by', 'opening_float_cents'],
    patch: ['status', 'closed_at', 'closed_by', 'z_number'],
    scopedToEstablishment: true,
  },
  cash_sessions: {
    insert: ['id', 'business_day_id', 'register_label', 'staff_id', 'kind', 'status', 'opening_float_cents', 'opened_at'],
    patch: ['status', 'closed_at', 'expected_cash_cents', 'counted_cash_cents', 'variance_cents', 'variance_reason'],
    scopedToEstablishment: true,
  },
  cash_movements: {
    insert: ['id', 'cash_session_id', 'kind', 'amount_cents', 'reason_code_id', 'note', 'staff_id', 'approved_by', 'created_at'],
    patch: [],
    scopedToEstablishment: true,
  },
  cash_counts: {
    insert: ['id', 'cash_session_id', 'payment_method_id', 'expected_cents', 'counted_cents', 'created_at'],
    patch: [],
    scopedToEstablishment: true,
  },
  customers: {
    insert: ['id', 'full_name', 'phone', 'company', 'ice'],
    patch: ['full_name', 'phone', 'company', 'ice'],
    scopedToEstablishment: false,
  },
  customer_ledger: {
    insert: ['id', 'customer_id', 'kind', 'amount_cents', 'order_id', 'payment_method_id', 'note', 'staff_id', 'created_at'],
    patch: [],
    scopedToEstablishment: true,
  },
  orders: {
    insert: [
      'id', 'business_day_id', 'number', 'order_type', 'table_id', 'call_number', 'customer_id',
      'customer_name', 'waiter_id', 'covers', 'status', 'discount_cents', 'total_cents', 'note', 'opened_at',
    ],
    patch: [
      'table_id', 'covers', 'customer_id', 'customer_name', 'waiter_id', 'status',
      'discount_cents', 'total_cents', 'note', 'closed_at',
    ],
    scopedToEstablishment: true,
  },
  order_lines: {
    insert: [
      'id', 'order_id', 'parent_line_id', 'item_id', 'name', 'quantity', 'unit_price_cents', 'tax_rate_bp',
      'discount_cents', 'status', 'note', 'printer_id', 'sent_at', 'created_by', 'created_at',
    ],
    patch: [
      'order_id', 'quantity', 'discount_cents', 'status', 'note', 'printer_id', 'sent_at', 'voided_at',
      'void_reason_code_id', 'approved_by',
    ],
    scopedToEstablishment: true,
  },
  order_line_options: {
    insert: ['id', 'order_line_id', 'option_id', 'name', 'extra_cents'],
    patch: [],
    scopedToEstablishment: true,
  },
  payments: {
    insert: [
      'id', 'order_id', 'cash_session_id', 'payment_method_id', 'amount_cents', 'tendered_cents',
      'change_cents', 'customer_id', 'split_label', 'staff_id', 'created_at',
    ],
    patch: [],
    scopedToEstablishment: true,
  },
  kitchen_tickets: {
    insert: ['id', 'order_id', 'printer_id', 'kind', 'line_ids', 'status', 'created_at', 'printed_at'],
    patch: ['status', 'printed_at'],
    scopedToEstablishment: true,
  },
  audit_log: {
    insert: ['id', 'action', 'entity', 'entity_id', 'staff_id', 'approved_by', 'reason_code_id', 'reason_text', 'details', 'created_at'],
    patch: [],
    scopedToEstablishment: true,
  },
};

const identifier = z.string().regex(/^[a-z_]+$/);

export const syncOpSchema = z.object({
  opId: z.string().uuid(),
  deviceSeq: z.number().int().positive(),
  entity: z.enum(WRITABLE_ENTITIES),
  entityId: z.string().uuid(),
  /** insert : création (échoue si la ligne existe avec d'autres valeurs) ; patch : modification partielle. */
  kind: z.enum(['insert', 'patch']),
  data: z.record(identifier, z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
});

export type SyncOp = z.infer<typeof syncOpSchema>;

export const pushRequestSchema = z.object({
  protocol: z.literal(SYNC_PROTOCOL_VERSION),
  ops: z.array(syncOpSchema).min(1).max(MAX_OPS_PER_PUSH),
});

export type PushRequest = z.infer<typeof pushRequestSchema>;

export type OpResultStatus = 'applied' | 'duplicate' | 'rejected';

export interface OpResult {
  opId: string;
  deviceSeq: number;
  status: OpResultStatus;
  code?: string;
  message?: string;
}

export interface PushResponse {
  results: OpResult[];
  /** Dernier device_seq traité : la tablette purge sa boîte d'envoi jusqu'ici. */
  lastDeviceSeq: number;
}

export interface Change {
  seq: number;
  entity: string;
  entityId: string;
  op: 'upsert' | 'delete';
  data: Record<string, unknown> | null;
}

export interface PullResponse {
  changes: Change[];
  nextCursor: number;
  hasMore: boolean;
}

/** Codes de rejet stables, affichés et journalisés côté tablette. */
export const SYNC_ERRORS = {
  SEQUENCE_GAP: 'Opération hors séquence : renvoyer depuis la dernière acquittée',
  UNKNOWN_ENTITY: 'Entité non synchronisable',
  FORBIDDEN_COLUMN: 'Colonne non modifiable depuis une tablette',
  NOT_FOUND: 'Ligne introuvable pour une modification',
  CONFLICT: 'La ligne existe déjà avec des valeurs différentes',
  BUSINESS_RULE: 'Règle métier refusée par le serveur',
  INVALID: 'Données invalides',
} as const;

export type SyncErrorCode = keyof typeof SYNC_ERRORS;
