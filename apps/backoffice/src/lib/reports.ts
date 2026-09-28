export interface DayReport {
  day: { id: string; establishmentId: string; businessDate: string; status: 'open' | 'closed'; openedAt: string; closedAt: string | null; zNumber: number | null; openingFloatCents: number };
  orders: { paid: number; open: number; voided: number; covers: number };
  totals: { ttcCents: number; htCents: number; tvaCents: number; discountCents: number; compCents: number; voidedCents: number; averageTicketCents: number };
  taxes: { rateBp: number; htCents: number; tvaCents: number; ttcCents: number }[];
  payments: { method: string; kind: string; count: number; amountCents: number }[];
  waiters: { staffId: string; name: string; orders: number; amountCents: number; cashCents: number }[];
  topItems: { name: string; quantity: number; amountCents: number }[];
  cashSessions: { id: string; label: string; staff: string; status: string; expectedCents: number | null; countedCents: number | null; varianceCents: number | null; varianceReason: string | null }[];
  cashMovements: { kind: string; count: number; amountCents: number }[];
  hours: { hour: number; orders: number; amountCents: number }[];
}

export interface Dashboard {
  current: DayReport | null;
  trend: { date: string; totalCents: number; orders: number }[];
  tablets: { id: string; label: string | null; model: string | null; app_version: string | null; last_seen_at: string | null }[];
}

export interface DaySummary {
  id: string;
  business_date: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  z_number: number | null;
  total_cents: number;
  orders: number;
}

export const MOVEMENT_LABELS: Record<string, string> = {
  out: 'Sorties de caisse',
  in: 'Apports',
  no_sale: 'Ouvertures sans vente',
  waiter_handover: 'Remises des serveurs',
};
