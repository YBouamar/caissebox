import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { AutoSubmitSelect } from '@/components/AutoSubmitSelect';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { Family, ownerContext, Printer } from '@/lib/owner';
import { routeFamily, savePrinter } from './actions';

export const metadata: Metadata = { title: 'Imprimantes' };

export default async function PrintersPage({ searchParams }: { searchParams: Promise<{ imprimante?: string }> }) {
  const sp = await searchParams;
  const { current } = await ownerContext();
  const [printers, families] = await Promise.all([api<Printer[]>(`/bo/r/printers?establishment_id=${current.id}`), api<Family[]>('/bo/r/families')]);
  const printer = printers.find((p) => p.id === sp.imprimante);
  const isNew = sp.imprimante === 'nouvelle';
  const roles = (p: Printer) => [p.prints_receipts && 'Tickets clients', p.prints_preparation && 'Bons de préparation', p.opens_drawer && 'Tiroir-caisse'].filter(Boolean).join(' · ') || 'Aucun rôle';

  return (
    <>
      <OwnerTopbar title="Imprimantes" sub={`${printers.length} imprimante(s)`}>
        <Link className="btn primary" href="/imprimantes?imprimante=nouvelle">
          + Ajouter une imprimante
        </Link>
      </OwnerTopbar>
      <div className="split">
        <main className="page">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Imprimante</th>
                  <th>Connexion</th>
                  <th>Papier</th>
                  <th>Rôles</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {printers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">
                      Ajoutez l’imprimante de caisse (tickets clients, tiroir), puis une imprimante par poste de préparation (cuisine, bar).
                    </td>
                  </tr>
                ) : null}
                {printers.map((p) => (
                  <tr key={p.id} className={printer?.id === p.id ? 'selected' : undefined}>
                    <td>
                      <Link className="rowlink" href={`/imprimantes?imprimante=${p.id}`}>
                        {p.name}
                      </Link>
                    </td>
                    <td>
                      {p.connection === 'wifi' ? 'Wi-Fi' : 'Bluetooth'} <span className="sub mono">{p.connection === 'wifi' ? `${p.address}:${p.port}` : p.address}</span>
                    </td>
                    <td>{p.paper_width_mm} mm</td>
                    <td>{roles(p)}</td>
                    <td>{p.active ? <span className="badge">Active</span> : <span className="badge muted">Désactivée</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="card">
            <span className="card-title">Routage des bons de préparation</span>
            <span className="small muted">Chaque famille envoie ses bons vers une imprimante. Un article peut avoir son propre réglage dans sa fiche.</span>
            <div className="table-wrap" style={{ border: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Famille</th>
                    <th>Imprimante</th>
                  </tr>
                </thead>
                <tbody>
                  {families
                    .filter((f) => !f.archived)
                    .map((f) => (
                      <tr key={f.id}>
                        <td className="strong">
                          <span className="row">
                            <span className="dot" style={{ background: f.color }} />
                            {f.name}
                          </span>
                        </td>
                        <td>
                          <form action={routeFamily}>
                            <input type="hidden" name="family_id" value={f.id} />
                            <AutoSubmitSelect name="printer_id" defaultValue={f.printer_id ?? ''} label={`Imprimante pour ${f.name}`}>
                              <option value="">Aucun bon</option>
                              {printers
                                .filter((p) => p.prints_preparation || p.id === f.printer_id)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                            </AutoSubmitSelect>
                          </form>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
        {printer || isNew ? (
          <aside className="panel">
            <div className="panel-head">
              <h2>{printer ? printer.name : 'Nouvelle imprimante'}</h2>
              <Link className="btn icon" href="/imprimantes" aria-label="Fermer">
                ×
              </Link>
            </div>
            <ActionForm action={savePrinter} key={printer?.id ?? 'new'}>
              <input type="hidden" name="id" value={printer?.id ?? ''} />
              <input type="hidden" name="establishment_id" value={current.id} />
              <div className="form-grid">
                <label className="field full">
                  Nom
                  <input name="name" defaultValue={printer?.name} required placeholder="Cuisine" />
                </label>
                <label className="field">
                  Connexion
                  <select name="connection" defaultValue={printer?.connection ?? 'wifi'}>
                    <option value="wifi">Wi-Fi (réseau)</option>
                    <option value="bluetooth">Bluetooth</option>
                  </select>
                </label>
                <label className="field">
                  Papier
                  <select name="paper_width_mm" defaultValue={String(printer?.paper_width_mm ?? 80)}>
                    <option value="80">80 mm</option>
                    <option value="58">58 mm</option>
                  </select>
                </label>
                <label className="field">
                  Adresse
                  <input name="address" defaultValue={printer?.address} required placeholder="192.168.1.50 ou 00:11:22:AA:BB:CC" />
                  <span className="hint">IP fixe en Wi-Fi, adresse MAC en Bluetooth</span>
                </label>
                <label className="field">
                  Port (Wi-Fi)
                  <input name="port" type="number" min={1} max={65535} defaultValue={printer?.port ?? 9100} />
                </label>
              </div>
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                  Rôles
                </legend>
                <label className="check">
                  <input type="checkbox" name="prints_receipts" defaultChecked={printer?.prints_receipts ?? false} />
                  Tickets clients et duplicatas
                </label>
                <label className="check">
                  <input type="checkbox" name="prints_preparation" defaultChecked={printer?.prints_preparation ?? true} />
                  Bons de préparation (cuisine, bar)
                </label>
                <label className="check">
                  <input type="checkbox" name="opens_drawer" defaultChecked={printer?.opens_drawer ?? false} />
                  Tiroir-caisse branché sur cette imprimante
                </label>
                {printer ? (
                  <label className="check">
                    <input type="checkbox" name="active" defaultChecked={printer.active} />
                    Active
                  </label>
                ) : null}
              </fieldset>
              <Submit className="btn accent big">{printer ? 'Enregistrer' : 'Ajouter'}</Submit>
            </ActionForm>
            <div className="alert neutral small">Le test d’impression se lance depuis la tablette, qui est sur le même réseau que l’imprimante.</div>
          </aside>
        ) : null}
      </div>
    </>
  );
}
