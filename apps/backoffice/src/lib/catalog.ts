import 'server-only';
import { api } from './api';
import { Family, Item, ItemOptionGroup, Option, OptionGroup, Printer, TaxRate } from './owner';

export async function loadCatalog() {
  const [families, items, taxes, printers, groups, options, links] = await Promise.all([
    api<Family[]>('/bo/r/families'),
    api<Item[]>('/bo/r/items'),
    api<TaxRate[]>('/bo/r/tax-rates'),
    api<Printer[]>('/bo/r/printers'),
    api<OptionGroup[]>('/bo/r/option-groups'),
    api<Option[]>('/bo/r/options'),
    api<ItemOptionGroup[]>('/bo/r/item-option-groups'),
  ]);
  return { families, items, taxes, printers, groups, options, links };
}

export function taxLabel(taxes: TaxRate[], id: string | null, fallback?: string | null): string {
  const t = taxes.find((x) => x.id === (id ?? fallback)) ?? taxes.find((x) => x.is_default);
  return t ? `${(t.rate_bp / 100).toLocaleString('fr-FR')} %` : '·';
}

export const STOCK_LABELS: Record<Item['stock_mode'], string> = { none: 'Non suivi', unit: 'Unitaire', recipe: 'À recette' };
