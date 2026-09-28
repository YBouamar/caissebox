import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { loadCatalog } from '@/lib/catalog';
import { amount } from '@/lib/format';
import { MenuStep, MenuStepChoice } from '@/lib/owner';
import { saveItem, setItemFlag } from '../articles/actions';
import { addChoice, addStep, deleteChoice, deleteStep } from './actions';

export const metadata: Metadata = { title: 'Menus composés' };

export default async function MenusPage({ searchParams }: { searchParams: Promise<{ menu?: string }> }) {
  const sp = await searchParams;
  const cat = await loadCatalog();
  const menus = cat.items.filter((i) => i.kind === 'menu' && !i.archived);
  const products = cat.items.filter((i) => i.kind === 'product' && !i.archived);
  const families = cat.families.filter((f) => !f.archived);
  const menu = menus.find((m) => m.id === sp.menu);
  const [steps, choices] = menu
    ? await Promise.all([api<MenuStep[]>(`/bo/r/menu-steps?menu_item_id=${menu.id}`), api<MenuStepChoice[]>('/bo/r/menu-step-choices')])
    : [[], []];
  const itemName = (id: string) => cat.items.find((i) => i.id === id)?.name ?? '?';

  return (
    <>
      <OwnerTopbar title="Menus composés" sub={`${menus.length} menu(s)`} picker={false} />
      <div className="split">
        <main className="page">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Menu</th>
                  <th>Famille</th>
                  <th className="num">Prix TTC</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {menus.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">
                      Aucun menu. Exemple : « Formule petit-déjeuner » avec une boisson chaude, un jus et une viennoiserie au choix.
                    </td>
                  </tr>
                ) : null}
                {menus.map((m) => (
                  <tr key={m.id} className={menu?.id === m.id ? 'selected' : undefined}>
                    <td>
                      <Link className="rowlink" href={`/menus?menu=${m.id}`}>
                        {m.name}
                      </Link>
                    </td>
                    <td>{cat.families.find((f) => f.id === m.family_id)?.name}</td>
                    <td className="num strong">{amount(m.price_cents)}</td>
                    <td>{m.available ? <span className="badge">En vente</span> : <span className="badge amber">Rupture</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {menu ? (
            <div className="stack" style={{ gap: 16 }}>
              {steps.map((s, idx) => (
                <section className="card" key={s.id}>
                  <div className="between">
                    <span className="card-title">
                      Étape {idx + 1} · {s.name}
                    </span>
                    <span className="row">
                      <span className="small muted">
                        {s.min_select === 0 ? 'Facultative' : `${s.min_select} choix minimum`} · {s.max_select} au maximum
                      </span>
                      <form action={deleteStep}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn small danger" type="submit">
                          Supprimer l’étape
                        </button>
                      </form>
                    </span>
                  </div>
                  <div className="list">
                    {choices
                      .filter((c) => c.step_id === s.id)
                      .map((c) => (
                        <div className="list-item" key={c.id}>
                          <span>{itemName(c.item_id)}</span>
                          <span className="row">
                            <strong>{Number(c.extra_cents) ? `+${amount(c.extra_cents)} DH` : 'inclus'}</strong>
                            <form action={deleteChoice}>
                              <input type="hidden" name="id" value={c.id} />
                              <button className="btn small icon" type="submit" aria-label={`Retirer ${itemName(c.item_id)}`}>
                                ×
                              </button>
                            </form>
                          </span>
                        </div>
                      ))}
                  </div>
                  <ActionForm action={addChoice} reset quiet>
                    <input type="hidden" name="step_id" value={s.id} />
                    <div className="form-row">
                      <label className="field" style={{ flex: '2 1 220px' }}>
                        Ajouter un choix
                        <select name="item_id" defaultValue="">
                          <option value="">Choisir un article…</option>
                          {families.map((f) => (
                            <optgroup key={f.id} label={f.name}>
                              {products
                                .filter((p) => p.family_id === f.id && !choices.some((c) => c.step_id === s.id && c.item_id === p.id))
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <label className="field" style={{ flex: '1 1 110px' }}>
                        Supplément (DH)
                        <input name="extra" inputMode="decimal" placeholder="0,00" />
                      </label>
                      <Submit className="btn">Ajouter</Submit>
                    </div>
                  </ActionForm>
                </section>
              ))}
              <section className="card">
                <span className="card-title">Nouvelle étape</span>
                <ActionForm action={addStep} reset>
                  <input type="hidden" name="menu_item_id" value={menu.id} />
                  <input type="hidden" name="sort" value={steps.length} />
                  <div className="form-row">
                    <label className="field" style={{ flex: '2 1 200px' }}>
                      Nom de l’étape
                      <input name="name" required placeholder="Boisson chaude" />
                    </label>
                    <label className="field" style={{ flex: '0 1 100px' }}>
                      Min.
                      <input name="min_select" type="number" min={0} max={20} defaultValue={1} />
                    </label>
                    <label className="field" style={{ flex: '0 1 100px' }}>
                      Max.
                      <input name="max_select" type="number" min={1} max={20} defaultValue={1} />
                    </label>
                    <Submit className="btn primary">Ajouter l’étape</Submit>
                  </div>
                </ActionForm>
              </section>
            </div>
          ) : null}
        </main>
        <aside className="panel" aria-labelledby="menu-title">
          <div className="panel-head">
            <h2 id="menu-title">{menu ? menu.name : 'Nouveau menu'}</h2>
            {menu ? (
              <Link className="btn icon" href="/menus" aria-label="Fermer">
                ×
              </Link>
            ) : null}
          </div>
          {families.length === 0 ? (
            <div className="alert info">
              Créez d’abord une famille dans <Link href="/articles">Articles</Link> (par exemple « Menus »).
            </div>
          ) : (
            <ActionForm action={saveItem} key={menu?.id ?? 'new'}>
              <input type="hidden" name="id" value={menu?.id ?? ''} />
              <input type="hidden" name="kind" value="menu" />
              <input type="hidden" name="printer" value={menu ? (menu.printer_mode === 'printer' ? (menu.printer_id ?? 'inherit') : menu.printer_mode) : 'none'} />
              <input type="hidden" name="stock_mode" value="none" />
              <label className="field">
                Nom
                <input name="name" defaultValue={menu?.name} required placeholder="Formule petit-déjeuner" />
              </label>
              <div className="form-grid">
                <label className="field">
                  Famille
                  <select name="family_id" defaultValue={menu?.family_id ?? families.find((f) => /menu/i.test(f.name))?.id ?? families[0]?.id}>
                    {families.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Prix TTC (DH)
                  <input name="price" inputMode="decimal" defaultValue={menu ? amount(menu.price_cents) : ''} required placeholder="35,00" />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" name="available" defaultChecked={menu?.available ?? true} />
                En vente
              </label>
              <p className="small muted" style={{ margin: 0 }}>
                Le menu n’envoie pas de bon lui-même : chaque choix part vers l’imprimante de sa propre famille (cuisine, bar).
              </p>
              <Submit className="btn accent big">{menu ? 'Enregistrer' : 'Créer le menu'}</Submit>
            </ActionForm>
          )}
          {menu ? (
            <form action={setItemFlag}>
              <input type="hidden" name="id" value={menu.id} />
              <input type="hidden" name="field" value="archived" />
              <input type="hidden" name="value" value="true" />
              <input type="hidden" name="back" value="/menus" />
              <button className="btn danger small" type="submit">
                Archiver le menu
              </button>
            </form>
          ) : null}
        </aside>
      </div>
    </>
  );
}
