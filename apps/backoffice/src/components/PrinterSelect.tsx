import { Printer } from '@/lib/owner';

/** Choix de l'imprimante de préparation : comme la famille, aucune, ou une imprimante précise. */
export function PrinterSelect({ printers, value, name = 'printer', inheritLabel, establishments }: {
  printers: Printer[];
  value: string;
  name?: string;
  inheritLabel?: string;
  establishments: { id: string; name: string }[];
}) {
  const multi = establishments.length > 1;
  const prep = printers.filter((p) => p.active);
  return (
    <select name={name} defaultValue={value}>
      {inheritLabel ? <option value="inherit">{inheritLabel}</option> : null}
      <option value={inheritLabel ? 'none' : ''}>{inheritLabel ? 'Aucun bon de préparation' : 'Aucune'}</option>
      {prep.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {multi ? ` (${establishments.find((e) => e.id === p.establishment_id)?.name ?? ''})` : ''}
        </option>
      ))}
    </select>
  );
}
