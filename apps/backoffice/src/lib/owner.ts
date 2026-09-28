import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { api } from './api';
import { ESTABLISHMENT_COOKIE } from './session';

export interface Establishment {
  id: string;
  name: string;
  address: string | null;
  service_mode: 'counter' | 'waiter_pays' | 'both';
  kitchen_send_mode: 'manual' | 'auto';
  access_state: string;
  receipt_header?: string | null;
  receipt_footer?: string | null;
}

export interface Me {
  full_name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  status: string;
}

/** Contexte du propriétaire : compte, établissements, établissement sélectionné. */
export const ownerContext = cache(async () => {
  const [me, establishments] = await Promise.all([api<Me>('/bo/me'), api<Establishment[]>('/bo/establishments')]);
  const chosen = (await cookies()).get(ESTABLISHMENT_COOKIE)?.value;
  const current = establishments.find((e) => e.id === chosen) ?? establishments[0];
  if (!current) throw new Error('Aucun établissement');
  return { me, establishments, current };
});

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

// Types renvoyés par /bo/r/*
export interface TaxRate { id: string; label: string; rate_bp: number; is_default: boolean }
export interface Printer {
  id: string; establishment_id: string; name: string; connection: 'bluetooth' | 'wifi'; address: string; port: number;
  paper_width_mm: 58 | 80; prints_receipts: boolean; prints_preparation: boolean; opens_drawer: boolean; active: boolean;
}
export interface Family { id: string; establishment_id: string | null; name: string; color: string; sort: number; printer_id: string | null; tax_rate_id: string | null; archived: boolean }
export interface Item {
  id: string; family_id: string; kind: 'product' | 'menu'; name: string; price_cents: string; tax_rate_id: string | null;
  printer_mode: 'inherit' | 'none' | 'printer'; printer_id: string | null; stock_mode: 'none' | 'unit' | 'recipe';
  available: boolean; sort: number; archived: boolean;
}
export interface OptionGroup { id: string; name: string; min_select: number; max_select: number }
export interface Option { id: string; group_id: string; name: string; extra_cents: string; sort: number; archived: boolean }
export interface ItemOptionGroup { id: string; item_id: string; group_id: string; sort: number }
export interface MenuStep { id: string; menu_item_id: string; name: string; min_select: number; max_select: number; sort: number }
export interface MenuStepChoice { id: string; step_id: string; item_id: string; extra_cents: string; sort: number }
export interface Zone { id: string; establishment_id: string; name: string; sort: number }
export interface DiningTable { id: string; zone_id: string; label: string; seats: number; shape: 'square' | 'round' | 'long'; x: number; y: number; w: number; h: number; active: boolean }
export interface Customer { id: string; full_name: string; phone: string | null; company: string | null; ice: string | null; credit_limit_cents: string; is_default: boolean; archived: boolean }
export interface Role { id: string; name: string; is_manager: boolean; permissions: Record<string, boolean | number> }
export interface StaffMember { id: string; full_name: string; initials: string; active: boolean; role: string; establishment_ids: string[] }
export interface ReasonCode { id: string; category: string; label: string; active: boolean }
export interface PaymentMethod { id: string; label: string; kind: string; active: boolean; sort: number }
