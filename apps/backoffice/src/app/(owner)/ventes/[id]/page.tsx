import type { Metadata } from 'next';
import Link from 'next/link';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { dateFr, dh, rate, timeFr } from '@/lib/format';
import { DayReport, MOVEMENT_LABELS } from '@/lib/reports';
import { PrintButton } from './PrintButton';

export const metadata: Metadata = { title: 'Rapport de journée' };

export default async function DayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await api<DayReport>(`/bo/reports/days/${id}`);
  const title = r.day.status === 'closed' ? `Rapport Z n° ${r.day.zNumber}` : 'Rapport X (journée en cours)';
  const maxHour = Math.max(1, ...r.hours.map((h) => h.amountCents));
  const paymentsTotal = r.payments.reduce((s, p) => s + p.amountCents, 0);
  return (
    <>
      <OwnerTopbar title={title} sub={dateFr(r.day.businessDate)} picker={false}>
        <Link href="/ventes" className="btn">
          Toutes les journées
        </Link>
        <PrintButton />
      </OwnerTopbar>
      <main className="page">
        <div className="kpis">
          <div className="kpi accent">
            <span className="label">CA TTC</span>
            <span className="value">{dh(r.totals.ttcCents)}</span>
            <span className="note">
              Ouverte à {timeFr(r.day.openedAt)}
              {r.day.closedAt ? `, clôturée le ${dateFr(r.day.closedAt)} à ${timeFr(r.day.closedAt)}` : ''}
            </span>
          </div>
          <div className="kpi">
            <span className="label">Tickets</span>
            <span className="value">{r.orders.paid}</span>
            <span className="note">
              {r.orders.voided} annulé(s) · {r.orders.open} ouvert(s)
            </span>
          </div>
          <div className="kpi">
            <span className="label">Ticket moyen</span>
            <span className="value">{dh(r.totals.averageTicketCents)}</span>
            <span className="note">{r.orders.covers} couverts</span>
          </div>
          <div className="kpi">
            <span className="label">Fond de caisse initial</span>
            <span className="value">{dh(r.day.openingFloatCents)}</span>
            <span className="note">Saisi à l’ouverture</span>
          </div>
        </div>

        <div className="grid-2">
          <section className="card">
            <span className="card-title">Ventilation de la TVA</span>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Taux</th>
                    <th className="num">HT</th>
                    <th className="num">TVA</th>
                    <th className="num">TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {r.taxes.map((t) => (
                    <tr key={t.rateBp}>
                      <td>{rate(t.rateBp)}</td>
                      <td className="num">{dh(t.htCents)}</td>
                      <td className="num">{dh(t.tvaCents)}</td>
                      <td className="num strong">{dh(t.ttcCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{dh(r.totals.htCents)}</td>
                    <td className="num">{dh(r.totals.tvaCents)}</td>
                    <td className="num">{dh(r.totals.ttcCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="row wrap small muted">
              <span>Remises : {dh(r.totals.discountCents)}</span>·<span>Offerts : {dh(r.totals.compCents)}</span>·<span>Annulations : {dh(r.totals.voidedCents)}</span>
            </div>
          </section>

          <section className="card">
            <span className="card-title">Modes de paiement</span>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Mode</th>
                    <th className="num">Nombre</th>
                    <th className="num">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {r.payments.map((p) => (
                    <tr key={p.method}>
                      <td className="strong">{p.method}</td>
                      <td className="num">{p.count}</td>
                      <td className="num strong">{dh(p.amountCents)}</td>
                    </tr>
                  ))}
                  {r.payments.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="empty">
                        Aucun paiement
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total encaissé</td>
                    <td />
                    <td className="num">{dh(paymentsTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>

        <section className="card">
          <span className="card-title">Recette par serveur</span>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Serveur</th>
                  <th className="num">Tickets</th>
                  <th className="num">Dont espèces</th>
                  <th className="num">Total TTC</th>
                </tr>
              </thead>
              <tbody>
                {r.waiters.map((w) => (
                  <tr key={w.staffId}>
                    <td className="strong">{w.name}</td>
                    <td className="num">{w.orders}</td>
                    <td className="num">{dh(w.cashCents)}</td>
                    <td className="num strong">{dh(w.amountCents)}</td>
                  </tr>
                ))}
                {r.waiters.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      Aucun encaissement
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <div className="grid-2">
          <section className="card">
            <span className="card-title">Sessions de caisse</span>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Caisse</th>
                    <th className="num">Théorique</th>
                    <th className="num">Compté</th>
                    <th className="num">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {r.cashSessions.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.label}</strong>
                        <span className="sub">
                          {s.staff}
                          {s.status === 'open' ? ' · ouverte' : ''}
                          {s.varianceReason ? ` · ${s.varianceReason}` : ''}
                        </span>
                      </td>
                      <td className="num">{s.expectedCents === null ? '·' : dh(s.expectedCents)}</td>
                      <td className="num">{s.countedCents === null ? '·' : dh(s.countedCents)}</td>
                      <td className="num strong" style={{ color: s.varianceCents ? 'var(--warn-ink)' : undefined }}>
                        {s.varianceCents === null ? '·' : dh(s.varianceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.cashMovements.length ? (
              <div className="list">
                {r.cashMovements.map((m) => (
                  <div className="list-item" key={m.kind}>
                    <span>
                      {MOVEMENT_LABELS[m.kind] ?? m.kind} ({m.count})
                    </span>
                    <strong>{dh(m.amountCents)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="card">
            <span className="card-title">Articles les plus vendus</span>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th className="num">Qté</th>
                    <th className="num">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {r.topItems.map((t) => (
                    <tr key={t.name}>
                      <td className="strong">{t.name}</td>
                      <td className="num">{t.quantity}</td>
                      <td className="num">{dh(t.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {r.hours.length ? (
          <section className="card">
            <span className="card-title">Activité par heure</span>
            <div className="bars" style={{ height: 180 }}>
              {r.hours.map((h) => (
                <div className="col" key={h.hour}>
                  <span className="v">{h.orders}</span>
                  <i style={{ height: `${Math.max(2, Math.round((h.amountCents / maxHour) * 140))}px` }} />
                </div>
              ))}
            </div>
            <div className="bars-x">
              {r.hours.map((h) => (
                <span key={h.hour}>{h.hour} h</span>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
