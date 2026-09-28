/**
 * Droits d'un rôle, modifiables case par case dans le back-office.
 * Une action non autorisée reste possible avec le PIN d'un manager et un motif.
 */
export const PERMISSIONS = {
  'order.take': 'Prendre des commandes',
  'order.send': 'Envoyer en préparation',
  'order.pay_own': 'Encaisser ses propres tables',
  'order.pay_any': 'Encaisser toutes les tables',
  'table.transfer_own': 'Transférer ou fusionner ses tables',
  'table.transfer_any': 'Transférer les tables des autres',
  'line.void_sent': 'Supprimer une ligne déjà envoyée',
  'line.comp': 'Offrir un article',
  'order.discount': 'Faire une remise',
  'order.reopen': 'Réouvrir ou annuler un ticket payé',
  'receipt.reprint': 'Réimprimer un ticket client',
  'cash.session': 'Ouvrir et clôturer sa session de caisse',
  'cash.movement': 'Sorties et apports de caisse',
  'cash.no_sale': 'Ouvrir le tiroir sans vente',
  'day.open_close': 'Ouvrir et clôturer la journée',
  'report.own': 'Voir sa recette',
  'report.x': 'Imprimer un rapport X',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export type PermissionSet = Partial<Record<Permission, boolean>> & { 'order.discount_max_bp'?: number };

const all = (value: boolean): PermissionSet =>
  Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, value])) as PermissionSet;

export const DEFAULT_ROLES: readonly { name: string; isManager: boolean; permissions: PermissionSet }[] = [
  { name: 'Manager', isManager: true, permissions: { ...all(true), 'order.discount_max_bp': 10000 } },
  {
    name: 'Caissier',
    isManager: false,
    permissions: {
      ...all(false),
      'order.take': true,
      'order.send': true,
      'order.pay_own': true,
      'order.pay_any': true,
      'table.transfer_own': true,
      'receipt.reprint': true,
      'cash.session': true,
      'cash.movement': true,
      'report.own': true,
      'report.x': true,
      'order.discount_max_bp': 0,
    },
  },
  {
    name: 'Serveur',
    isManager: false,
    permissions: {
      ...all(false),
      'order.take': true,
      'order.send': true,
      'order.pay_own': true,
      'table.transfer_own': true,
      'report.own': true,
      'order.discount_max_bp': 0,
    },
  },
];

export type Authorization = { allowed: true } | { allowed: false; needsManager: true };

export function authorize(perms: PermissionSet, permission: Permission): Authorization {
  return perms[permission] ? { allowed: true } : { allowed: false, needsManager: true };
}

/** Une remise en points de base (1000 = 10 %) est-elle dans le plafond du rôle ? */
export function discountWithinLimit(perms: PermissionSet, discountBp: number): boolean {
  if (!perms['order.discount']) return discountBp === 0;
  return discountBp <= (perms['order.discount_max_bp'] ?? 0);
}
