import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { Topbar } from '@/components/Topbar';
import { api } from '@/lib/api';
import { ACCESS_LABELS, DeviceRow, KIND_LABELS, STATUS_LABELS, TenantDetail } from '@/lib/console';
import { dateFr, sinceFr } from '@/lib/format';
import { addEstablishment, retireDevice, setAccess } from '../../actions';
import { DeployForm } from '../../DeployForm';

export const metadata: Metadata = { title: 'Console · Client' };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, stock] = await Promise.all([api<TenantDetail>(`/console/tenants/${id}`), api<DeviceRow[]>('/console/devices?status=stock')]);
  const estName = (eid: string | null) => t.establishments.find((e) => e.id === eid)?.name ?? '';
  return (
    <>
      <Topbar title={t.name} sub={t.legal_name ?? undefined}>
        <Link className="btn" href="/console">
          Tous les clients
        </Link>
      </Topbar>
      <main className="page">
        <div className="grid-2">
          <section className="card">
            <h2>Fiche</h2>
            <div className="list">
              <div className="list-item">
                <span className="muted">ICE</span>
                <strong>{t.ice ?? '·'}</strong>
              </div>
              <div className="list-item">
                <span className="muted">Adresse</span>
                <strong>{t.address ?? '·'}</strong>
              </div>
              <div className="list-item">
                <span className="muted">Client depuis</span>
                <strong>{dateFr(t.created_at)}</strong>
              </div>
              {t.owners.map((o) => (
                <div className="list-item" key={o.id}>
                  <span className="muted">Gérant</span>
                  <strong>
                    {o.full_name} · {o.email}
                  </strong>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <h2>Établissements</h2>
            {t.establishments.map((e) => {
              const acc = ACCESS_LABELS[e.access_state] ?? { label: e.access_state, tone: '' };
              return (
                <div key={e.id} className="stack" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                  <div className="between">
                    <strong>{e.name}</strong>
                    <span className={`badge ${acc.tone}`}>{acc.label}</span>
                  </div>
                  <form action={setAccess} className="form-row">
                    <input type="hidden" name="establishmentId" value={e.id} />
                    <input type="hidden" name="tenantId" value={t.id} />
                    <label className="field">
                      Accès (impayés)
                      <select name="state" defaultValue={e.access_state}>
                        {Object.entries(ACCESS_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn" type="submit">
                      Appliquer
                    </button>
                  </form>
                </div>
              );
            })}
            <ActionForm action={addEstablishment} reset>
              <input type="hidden" name="tenantId" value={t.id} />
              <div className="form-row">
                <label className="field">
                  Nouvel établissement
                  <input name="name" required />
                </label>
                <label className="field">
                  Adresse
                  <input name="address" />
                </label>
                <Submit className="btn">Ajouter</Submit>
              </div>
            </ActionForm>
          </section>
        </div>

        <section className="card">
          <h2>Matériel</h2>
          <div className="table-wrap" style={{ border: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Matériel</th>
                  <th>Établissement</th>
                  <th>Version</th>
                  <th>Dernière synchro</th>
                  <th>Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {t.devices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      Aucun matériel affecté.
                    </td>
                  </tr>
                ) : null}
                {t.devices.map((d) => (
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
                    <td>{estName(d.establishment_id)}</td>
                    <td>{d.app_version ?? '·'}</td>
                    <td>{d.kind === 'tablet' ? sinceFr(d.last_seen_at) : '·'}</td>
                    <td>
                      <span className={`badge ${d.status === 'deployed' ? 'ok' : 'muted'}`}>{STATUS_LABELS[d.status] ?? d.status}</span>
                    </td>
                    <td className="right">
                      {d.status === 'deployed' ? (
                        <form action={retireDevice} className="row" style={{ justifyContent: 'flex-end' }}>
                          <input type="hidden" name="deviceId" value={d.id} />
                          <input type="hidden" name="back" value={`/console/clients/${t.id}`} />
                          <select name="status" className="input" defaultValue="repair" style={{ width: 'auto', height: 32 }} aria-label="Motif du retrait">
                            <option value="repair">En réparation</option>
                            <option value="lost">Perdu ou volé</option>
                            <option value="stock">Retour en stock</option>
                          </select>
                          <button className="btn small danger" type="submit">
                            Retirer
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <strong>Affecter du matériel</strong>
            <DeployForm
              tenantId={t.id}
              establishments={t.establishments.map((e) => ({ id: e.id, name: e.name }))}
              stock={stock.map((d) => ({ id: d.id, label: `${KIND_LABELS[d.kind]} · ${d.serial}${d.model ? ` · ${d.model}` : ''}` }))}
            />
            <span className="small muted">Retirer une tablette efface son secret : elle ne peut plus se synchroniser. Pensez aussi à la verrouiller depuis Headwind MDM en cas de perte.</span>
          </div>
        </section>
      </main>
    </>
  );
}
