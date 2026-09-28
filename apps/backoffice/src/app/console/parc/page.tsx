import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { Topbar } from '@/components/Topbar';
import { api } from '@/lib/api';
import { DeviceRow, KIND_LABELS, STATUS_LABELS } from '@/lib/console';
import { dateFr, dh, sinceFr } from '@/lib/format';
import { registerDevice } from '../actions';

export const metadata: Metadata = { title: 'Console · Parc matériel' };

const FILTERS = ['tous', 'stock', 'deployed', 'repair', 'lost', 'retired'] as const;

export default async function FleetPage({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const sp = await searchParams;
  const devices = await api<DeviceRow[]>('/console/devices');
  const filter = FILTERS.includes(sp.statut as (typeof FILTERS)[number]) ? sp.statut : 'tous';
  const rows = filter === 'tous' ? devices : devices.filter((d) => d.status === filter);
  const value = devices.filter((d) => d.status !== 'retired' && d.status !== 'lost').reduce((s, d) => s + Number(d.purchase_price_cents ?? 0), 0);
  return (
    <>
      <Topbar title="Parc matériel" sub={`${devices.length} équipement(s)`} />
      <div className="split">
        <main className="page">
          <div className="kpis">
            <div className="kpi">
              <span className="label">Valeur d’achat du parc actif</span>
              <span className="value">{dh(value)}</span>
            </div>
            <div className="kpi">
              <span className="label">En service</span>
              <span className="value">{devices.filter((d) => d.status === 'deployed').length}</span>
            </div>
            <div className="kpi">
              <span className="label">En stock</span>
              <span className="value">{devices.filter((d) => d.status === 'stock').length}</span>
            </div>
            <div className="kpi">
              <span className="label">En réparation</span>
              <span className="value">{devices.filter((d) => d.status === 'repair').length}</span>
            </div>
          </div>
          <div className="chips">
            {FILTERS.map((f) => (
              <Link key={f} className="chip" href={f === 'tous' ? '/console/parc' : `/console/parc?statut=${f}`} aria-current={filter === f ? 'true' : undefined}>
                {f === 'tous' ? 'Tous' : STATUS_LABELS[f]}
              </Link>
            ))}
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Matériel</th>
                  <th>Client</th>
                  <th>Achat</th>
                  <th>Dernière synchro</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Rien ici.
                    </td>
                  </tr>
                ) : null}
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>
                        {KIND_LABELS[d.kind]} {d.label ? `· ${d.label}` : ''}
                      </strong>
                      <span className="sub mono">
                        {d.serial}
                        {d.model ? ` · ${d.model}` : ''}
                      </span>
                    </td>
                    <td>
                      {d.tenant_id ? (
                        <Link href={`/console/clients/${d.tenant_id}`}>
                          {d.tenant_name}
                          {d.establishment_name && d.establishment_name !== d.tenant_name ? ` · ${d.establishment_name}` : ''}
                        </Link>
                      ) : (
                        <span className="muted">·</span>
                      )}
                    </td>
                    <td>
                      {d.purchase_price_cents ? dh(d.purchase_price_cents) : '·'}
                      <span className="sub">{dateFr(d.purchased_at)}</span>
                    </td>
                    <td>{d.kind === 'tablet' && d.status === 'deployed' ? sinceFr(d.last_seen_at) : '·'}</td>
                    <td>
                      <span className={`badge ${d.status === 'deployed' ? 'ok' : d.status === 'stock' ? '' : 'muted'}`}>{STATUS_LABELS[d.status] ?? d.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
        <aside className="panel">
          <div className="panel-head">
            <h2>Entrée en stock</h2>
          </div>
          <ActionForm action={registerDevice} reset>
            <div className="form-grid">
              <label className="field">
                Type
                <select name="kind" defaultValue="tablet">
                  <option value="tablet">Tablette</option>
                  <option value="printer">Imprimante</option>
                  <option value="drawer">Tiroir-caisse</option>
                </select>
              </label>
              <label className="field">
                Prix d’achat (DH)
                <input name="price" inputMode="decimal" placeholder="2 500" />
              </label>
              <label className="field full">
                Numéro de série
                <input name="serial" required minLength={3} />
              </label>
              <label className="field full">
                Modèle
                <input name="model" placeholder="Galaxy Tab A9+ 11''" />
              </label>
            </div>
            <Submit className="btn accent big">Ajouter au parc</Submit>
          </ActionForm>
        </aside>
      </div>
    </>
  );
}
