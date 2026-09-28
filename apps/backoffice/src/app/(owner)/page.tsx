import type { Metadata } from 'next';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { dh, shortDay, sinceFr, timeFr, dateFr } from '@/lib/format';
import { ownerContext } from '@/lib/owner';
import { Dashboard } from '@/lib/reports';

export const metadata: Metadata = { title: 'Tableau de bord' };

export default async function DashboardPage() {
  const { current: est } = await ownerContext();
  const data = await api<Dashboard>(`/bo/dashboard?establishmentId=${est.id}`);
  const r = data.current;
  const variance = r?.cashSessions.reduce((s, c) => s + (c.varianceCents ?? 0), 0) ?? 0;
  const trend = data.trend.slice(-7);
  const max = Math.max(1, ...trend.map((d) => d.totalCents));
  const maxWaiter = Math.max(1, ...(r?.waiters.map((w) => w.amountCents) ?? [1]));
  const stale = data.tablets.filter((t) => !t.last_seen_at || Date.now() - new Date(t.last_seen_at).getTime() > 60 * 60 * 1000);

  const alerts: { title: string; detail: string; tone: 'amber' | 'neutral' }[] = [];
  if (est.access_state !== 'normal') alerts.push({ title: 'Loyer en retard', detail: 'Contactez BACYBRAINS pour éviter la suspension de l’ouverture de journée.', tone: 'amber' });
  for (const t of stale) alerts.push({ title: `Tablette ${t.label ?? ''} hors ligne`, detail: `Dernière synchronisation ${sinceFr(t.last_seen_at)}`, tone: 'amber' });
  for (const s of r?.cashSessions ?? []) {
    if (s.varianceCents) alerts.push({ title: `Écart de caisse ${dh(s.varianceCents)}`, detail: `${s.label}, ${s.staff}${s.varianceReason ? ` · motif : ${s.varianceReason}` : ''}`, tone: 'neutral' });
  }
  if (r && r.totals.voidedCents > 0) alerts.push({ title: `Annulations : ${dh(r.totals.voidedCents)}`, detail: 'Détail dans Ventes et journées', tone: 'neutral' });
  if (r && r.totals.compCents > 0) alerts.push({ title: `Articles offerts : ${dh(r.totals.compCents)}`, detail: 'Validés par un manager', tone: 'neutral' });

  const dayLabel = r
    ? r.day.status === 'open'
      ? `Journée du ${dateFr(r.day.businessDate)} · en cours depuis ${timeFr(r.day.openedAt)}`
      : `Journée du ${dateFr(r.day.businessDate)} · clôturée (Z n° ${r.day.zNumber})`
    : 'Aucune journée encore ouverte';

  return (
    <>
      <OwnerTopbar title="Tableau de bord">
        <span className="badge muted" style={{ height: 40, display: 'inline-flex', alignItems: 'center', padding: '0 12px', fontSize: 13 }}>
          {dayLabel}
        </span>
      </OwnerTopbar>
      <main className="page">
        {!r ? (
          <div className="card">
            <h2>Bienvenue sur CaisseBox</h2>
            <p className="muted" style={{ margin: 0 }}>
              Les chiffres apparaîtront ici dès la première journée ouverte sur une tablette. En attendant, préparez votre carte dans <a href="/articles">Articles</a>, votre équipe dans <a href="/equipe">Équipe et PIN</a> et votre salle dans <a href="/salle">Salle et tables</a>.
            </p>
          </div>
        ) : (
          <>
            <div className="kpis">
              <div className="kpi">
                <span className="label">CA TTC {r.day.status === 'open' ? 'de la journée' : 'de la dernière journée'}</span>
                <span className="value">{dh(r.totals.ttcCents)}</span>
                <span className="note">HT {dh(r.totals.htCents)} · TVA {dh(r.totals.tvaCents)}</span>
              </div>
              <div className="kpi">
                <span className="label">Tickets encaissés</span>
                <span className="value">{r.orders.paid}</span>
                <span className="note">{r.orders.open ? `${r.orders.open} ticket(s) ouvert(s)` : 'Aucun ticket ouvert'}</span>
              </div>
              <div className="kpi">
                <span className="label">Ticket moyen</span>
                <span className="value">{dh(r.totals.averageTicketCents)}</span>
                <span className="note">{r.orders.covers ? `${r.orders.covers} couverts` : ' '}</span>
              </div>
              <div className="kpi">
                <span className="label">Écart de caisse</span>
                <span className="value">{dh(variance)}</span>
                <span className={`note${variance ? ' warn' : ''}`}>{r.cashSessions.filter((s) => s.status === 'closed').length} session(s) clôturée(s)</span>
              </div>
            </div>

            <div className="grid-main">
              <section className="card">
                <div className="card-head">
                  <span className="card-title">Chiffre d’affaires TTC, 7 dernières journées</span>
                  <span className="small muted">En DH</span>
                </div>
                {trend.length === 0 ? (
                  <div className="empty">Pas encore d’historique.</div>
                ) : (
                  <>
                    <div className="bars">
                      {trend.map((d, i) => (
                        <div className="col" key={d.date}>
                          <span className="v">{Math.round(d.totalCents / 100).toLocaleString('fr-FR')}</span>
                          <i className={i === trend.length - 1 && r.day.status === 'open' ? 'today' : undefined} style={{ height: `${Math.max(2, Math.round((d.totalCents / max) * 220))}px` }} />
                        </div>
                      ))}
                    </div>
                    <div className="bars-x">
                      {trend.map((d) => (
                        <span key={d.date}>{shortDay(d.date)}</span>
                      ))}
                    </div>
                  </>
                )}
              </section>
              <div className="stack" style={{ gap: 16 }}>
                <section className="card">
                  <span className="card-title">Recette par serveur</span>
                  {r.waiters.length === 0 ? <span className="muted">Aucun encaissement.</span> : null}
                  {r.waiters.map((w) => (
                    <div className="hbar" key={w.staffId}>
                      <span className="name">{w.name}</span>
                      <span className="track">
                        <i style={{ width: `${Math.round((w.amountCents / maxWaiter) * 100)}%` }} />
                      </span>
                      <span className="val">{dh(w.amountCents)}</span>
                    </div>
                  ))}
                </section>
                <section className="card" style={{ flexGrow: 1 }}>
                  <span className="card-title">Alertes</span>
                  {alerts.length === 0 ? <span className="muted">Rien à signaler.</span> : null}
                  {alerts.slice(0, 5).map((a, i) => (
                    <div key={i} className="list-item" style={{ background: a.tone === 'amber' ? 'var(--amber-soft)' : undefined, justifyContent: 'flex-start', alignItems: 'flex-start' }}>
                      <span className="dot" style={{ background: a.tone === 'amber' ? 'var(--amber)' : 'var(--muted)', marginTop: 6 }} />
                      <span className="stack" style={{ gap: 2 }}>
                        <strong>{a.title}</strong>
                        <span className="small muted">{a.detail}</span>
                      </span>
                    </div>
                  ))}
                </section>
              </div>
            </div>

            <section className="card">
              <span className="card-title">Meilleures ventes</span>
              {r.topItems.length === 0 ? (
                <span className="muted">Aucune vente.</span>
              ) : (
                <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                  {r.topItems.slice(0, 5).map((t, i) => (
                    <div className="stack" style={{ gap: 4 }} key={t.name}>
                      <span className="small muted">{i === 0 ? 'N° 1 des ventes' : `N° ${i + 1}`}</span>
                      <strong style={{ fontSize: 15 }}>{t.name}</strong>
                      <span className="small muted">
                        {t.quantity} vendus · {dh(t.amountCents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
