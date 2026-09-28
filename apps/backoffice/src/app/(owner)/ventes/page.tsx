import type { Metadata } from 'next';
import Link from 'next/link';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { dateFr, dh, timeFr } from '@/lib/format';
import { ownerContext } from '@/lib/owner';
import { DaySummary } from '@/lib/reports';

export const metadata: Metadata = { title: 'Ventes et journées' };

export default async function SalesPage() {
  const { current } = await ownerContext();
  const days = await api<DaySummary[]>(`/bo/reports/days?establishmentId=${current.id}`);
  const closed = days.filter((d) => d.status === 'closed');
  const total = closed.reduce((s, d) => s + d.total_cents, 0);
  return (
    <>
      <OwnerTopbar title="Ventes et journées" sub={`${days.length} journée(s)`} />
      <main className="page">
        <div className="kpis">
          <div className="kpi">
            <span className="label">CA TTC des journées clôturées affichées</span>
            <span className="value">{dh(total)}</span>
            <span className="note">{closed.length} journée(s)</span>
          </div>
          <div className="kpi">
            <span className="label">Moyenne par journée</span>
            <span className="value">{dh(closed.length ? Math.round(total / closed.length) : 0)}</span>
            <span className="note">Journées clôturées uniquement</span>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Journée</th>
                <th>Ouverture</th>
                <th>Clôture</th>
                <th>Z</th>
                <th className="num">Tickets</th>
                <th className="num">CA TTC</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    Aucune journée pour le moment. Une journée s’ouvre depuis la tablette, par un manager.
                  </td>
                </tr>
              ) : null}
              {days.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link className="rowlink" href={`/ventes/${d.id}`}>
                      {dateFr(d.business_date)}
                    </Link>
                  </td>
                  <td>{dateFr(d.opened_at)} {timeFr(d.opened_at)}</td>
                  <td>{d.closed_at ? `${dateFr(d.closed_at)} ${timeFr(d.closed_at)}` : '·'}</td>
                  <td>{d.z_number ?? '·'}</td>
                  <td className="num">{d.orders}</td>
                  <td className="num strong">{dh(d.total_cents)}</td>
                  <td>{d.status === 'open' ? <span className="badge amber">En cours</span> : <span className="badge">Clôturée</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
