import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { Topbar } from '@/components/Topbar';
import { api } from '@/lib/api';
import { DeviceRow, TenantRow } from '@/lib/console';
import { dateFr } from '@/lib/format';
import { createTenant } from './actions';

export const metadata: Metadata = { title: 'Console · Clients' };

export default async function ConsoleHome({ searchParams }: { searchParams: Promise<{ nouveau?: string }> }) {
  const sp = await searchParams;
  const [tenants, devices] = await Promise.all([api<TenantRow[]>('/console/tenants'), api<DeviceRow[]>('/console/devices')]);
  const deployed = devices.filter((d) => d.status === 'deployed');
  const online = deployed.filter((d) => d.kind === 'tablet' && d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 3600_000);
  const stock = devices.filter((d) => d.status === 'stock');
  return (
    <>
      <Topbar title="Clients" sub={`${tenants.length} client(s)`}>
        <Link className="btn primary" href="/console?nouveau=1">
          + Nouveau client
        </Link>
      </Topbar>
      <div className="split">
        <main className="page">
          <div className="kpis">
            <div className="kpi">
              <span className="label">Clients actifs</span>
              <span className="value">{tenants.filter((t) => t.status === 'active').length}</span>
            </div>
            <div className="kpi">
              <span className="label">Établissements</span>
              <span className="value">{tenants.reduce((s, t) => s + t.establishments, 0)}</span>
            </div>
            <div className="kpi">
              <span className="label">Tablettes en service</span>
              <span className="value">{deployed.filter((d) => d.kind === 'tablet').length}</span>
              <span className="note">{online.length} synchronisée(s) dans l’heure</span>
            </div>
            <div className="kpi">
              <span className="label">Matériel en stock</span>
              <span className="value">{stock.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">Établissements</th>
                  <th className="num">Tablettes</th>
                  <th>Depuis</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {tenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Aucun client. Créez le premier avec le bouton « Nouveau client ».
                    </td>
                  </tr>
                ) : null}
                {tenants.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link className="rowlink" href={`/console/clients/${t.id}`}>
                        {t.name}
                      </Link>
                    </td>
                    <td className="num">{t.establishments}</td>
                    <td className="num">{t.tablets}</td>
                    <td>{dateFr(t.created_at)}</td>
                    <td>{t.status === 'active' ? <span className="badge ok">Actif</span> : <span className="badge warn">{t.status === 'suspended' ? 'Suspendu' : 'Résilié'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
        {sp.nouveau ? (
          <aside className="panel">
            <div className="panel-head">
              <h2>Nouveau client</h2>
              <Link className="btn icon" href="/console" aria-label="Fermer">
                ×
              </Link>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Crée le compte avec les réglages par défaut : rôles Manager, Caissier, Serveur, TVA 10 % et 20 %, espèces, carte, ardoise, titre-restaurant, motifs courants, « Client divers » et une salle.
            </p>
            <ActionForm action={createTenant}>
              <div className="form-grid">
                <label className="field full">
                  Nom commercial
                  <input name="name" required placeholder="Café Atlas" />
                </label>
                <label className="field">
                  Raison sociale
                  <input name="legalName" placeholder="ATLAS CAFE SARL" />
                </label>
                <label className="field">
                  ICE
                  <input name="ice" inputMode="numeric" maxLength={15} />
                </label>
                <label className="field full">
                  Adresse
                  <input name="address" placeholder="12, bd Anfa, Casablanca" />
                </label>
                <label className="field full">
                  Premier établissement
                  <input name="establishment" placeholder="Même nom que le client si vide" />
                </label>
              </div>
              <section className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <strong>Compte du gérant (back-office)</strong>
                <div className="form-grid">
                  <label className="field full">
                    Nom complet
                    <input name="fullName" required />
                  </label>
                  <label className="field">
                    E-mail
                    <input name="email" type="email" required />
                  </label>
                  <label className="field">
                    Mot de passe provisoire
                    <input name="password" required minLength={10} autoComplete="new-password" />
                  </label>
                </div>
              </section>
              <Submit className="btn accent big">Créer le client</Submit>
            </ActionForm>
          </aside>
        ) : null}
      </div>
    </>
  );
}
