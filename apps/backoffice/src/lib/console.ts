export interface TenantRow { id: string; name: string; status: string; created_at: string; establishments: number; tablets: number }
export interface DeviceRow {
  id: string; kind: 'tablet' | 'printer' | 'drawer'; serial: string; model: string | null; label: string | null; status: string;
  app_version: string | null; last_seen_at: string | null; purchase_price_cents?: string | null; purchased_at?: string | null;
  tenant_name?: string | null; establishment_name?: string | null; tenant_id?: string | null; establishment_id: string | null;
}
export interface TenantDetail {
  id: string; name: string; legal_name: string | null; ice: string | null; address: string | null; status: string; created_at: string;
  establishments: { id: string; name: string; address: string | null; access_state: string; service_mode: string; created_at: string }[];
  owners: { id: string; email: string; full_name: string; created_at: string }[];
  devices: DeviceRow[];
}

export const KIND_LABELS = { tablet: 'Tablette', printer: 'Imprimante', drawer: 'Tiroir-caisse' } as const;
export const STATUS_LABELS: Record<string, string> = { stock: 'En stock', deployed: 'En service', repair: 'En réparation', lost: 'Perdu', retired: 'Réformé' };
export const ACCESS_LABELS: Record<string, { label: string; tone: string }> = {
  normal: { label: 'Normal', tone: '' },
  warning_manager: { label: 'Rappel au manager', tone: 'amber' },
  warning_all: { label: 'Rappel à tous', tone: 'amber' },
  refuse_day_open: { label: 'Ouverture bloquée', tone: 'warn' },
};
