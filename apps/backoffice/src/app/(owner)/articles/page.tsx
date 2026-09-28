import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { PrinterSelect } from '@/components/PrinterSelect';
import { loadCatalog, STOCK_LABELS, taxLabel } from '@/lib/catalog';
import { amount } from '@/lib/format';
import { Family, Item, ownerContext, Printer, TaxRate } from '@/lib/owner';
import { archiveFamily, attachGroup, detachGroup, saveFamily, saveItem, setItemFlag } from './actions';

export const metadata: Metadata = { title: 'Articles' };

type Search = { famille?: string; article?: string; archives?: string };

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { establishments } = await ownerContext();
  const cat = await loadCatalog();
  const showArchived = sp.archives === '1';
  const families = cat.families.filter((f) => f.archived === showArchived || !f.archived);
  const activeFamilies = cat.families.filter((f) => !f.archived);
  const family = cat.families.find((f) => f.id === sp.famille);
  const products = cat.items.filter((i) => i.kind === 'product');
  const rows = products.filter((i) => (family ? i.family_id === family.id : true) && i.archived === showArchived);
  const item = sp.article && sp.article !== 'nouveau' ? cat.items.find((i) => i.id === sp.article) : undefined;
  const isNew = sp.article === 'nouveau';
  const famName = (id: string) => cat.families.find((f) => f.id === id)?.name ?? '';
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { famille: sp.famille, archives: sp.archives, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/articles?${s}` : '/articles';
  };

  return (
    <>
      <OwnerTopbar title="Articles" sub={`${products.filter((i) => !i.archived).length} articles, ${activeFamilies.length} familles`} picker={false}>
        <Link className="btn" href="/articles/options">
          Options et suppléments
        </Link>
        <Link className="btn primary" href={qs({ article: 'nouveau' })}>
          + Nouvel article
        </Link>
      </OwnerTopbar>
      <div className="split">
        <main className="page">
          <div className="chips">
            <Link className="chip" href={showArchived ? '/articles?archives=1' : '/articles'} aria-current={!family ? 'true' : undefined}>
              <span className="dot" style={{ background: '#94A3B8' }} />
              Toutes
            </Link>
            {families
              .filter((f) => !f.archived)
              .map((f) => (
                <Link key={f.id} className="chip" href={`/articles?famille=${f.id}${showArchived ? '&archives=1' : ''}`} aria-current={family?.id === f.id ? 'true' : undefined}>
                  <span className="dot" style={{ background: f.color }} />
                  {f.name}
                </Link>
              ))}
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Famille</th>
                  <th className="num">Prix TTC</th>
                  <th className="num">TVA</th>
                  <th>Stock</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      {activeFamilies.length === 0 ? 'Commencez par créer une famille (Cafés, Jus, Plats…) dans le panneau de droite.' : 'Aucun article ici pour le moment.'}
                    </td>
                  </tr>
                ) : null}
                {rows.map((i) => (
                  <tr key={i.id} className={item?.id === i.id ? 'selected' : undefined}>
                    <td>
                      <Link className="rowlink" href={qs({ article: i.id })}>
                        {i.name}
                      </Link>
                    </td>
                    <td>{famName(i.family_id)}</td>
                    <td className="num strong">{amount(i.price_cents)}</td>
                    <td className="num">{taxLabel(cat.taxes, i.tax_rate_id, cat.families.find((f) => f.id === i.family_id)?.tax_rate_id)}</td>
                    <td>{STOCK_LABELS[i.stock_mode]}</td>
                    <td>{i.archived ? <span className="badge muted">Archivé</span> : i.available ? <span className="badge">En vente</span> : <span className="badge amber">Rupture</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small">
            {showArchived ? <Link href={qs({ archives: undefined })}>Masquer les articles archivés</Link> : <Link href={qs({ archives: '1' })}>Voir les articles archivés</Link>}
          </div>
        </main>

        <aside className="panel" aria-labelledby="fiche-title">
          {item || isNew ? (
            <ItemPanel
              key={item?.id ?? 'new'}
              item={item}
              families={activeFamilies}
              defaultFamily={family?.id}
              taxes={cat.taxes}
              printers={cat.printers}
              establishments={establishments}
              closeHref={qs({ article: undefined })}
              groups={cat.groups}
              options={cat.options}
              links={cat.links.filter((l) => l.item_id === item?.id)}
            />
          ) : family ? (
            <FamilyPanel key={family.id} family={family} taxes={cat.taxes} printers={cat.printers} establishments={establishments} count={cat.items.filter((i) => i.family_id === family.id && !i.archived).length} />
          ) : (
            <FamilyPanel key="new" taxes={cat.taxes} printers={cat.printers} establishments={establishments} count={0} />
          )}
        </aside>
      </div>
    </>
  );
}

function TaxSelect({ taxes, value, emptyLabel }: { taxes: TaxRate[]; value: string | null; emptyLabel: string }) {
  return (
    <select name="tax_rate_id" defaultValue={value ?? ''}>
      <option value="">{emptyLabel}</option>
      {taxes.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
          {t.is_default ? ' (par défaut)' : ''}
        </option>
      ))}
    </select>
  );
}

function FamilyPanel({ family, taxes, printers, establishments, count }: { family?: Family; taxes: TaxRate[]; printers: Printer[]; establishments: { id: string; name: string }[]; count: number }) {
  return (
    <>
      <div className="panel-head">
        <h2 id="fiche-title">{family ? `Famille ${family.name}` : 'Nouvelle famille'}</h2>
      </div>
      {family ? (
        <p className="muted small" style={{ margin: 0 }}>
          {count} article(s). L’imprimante et la TVA de la famille s’appliquent à ses articles, sauf réglage propre à un article.
        </p>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Les familles organisent la carte sur la tablette (Cafés, Thés, Jus, Plats…) et décident où part le bon de préparation.
        </p>
      )}
      <ActionForm action={saveFamily}>
        <input type="hidden" name="id" value={family?.id ?? ''} />
        <div className="form-grid">
          <label className="field full">
            Nom
            <input name="name" defaultValue={family?.name} required maxLength={120} />
          </label>
          <label className="field">
            Couleur sur la tablette
            <input type="color" name="color" defaultValue={family?.color ?? '#0B1F3A'} />
          </label>
          <label className="field">
            Ordre
            <input type="number" name="sort" min={0} defaultValue={family?.sort ?? 0} />
          </label>
          <label className="field">
            Imprimante de préparation
            <PrinterSelect printers={printers} establishments={establishments} name="printer_id" value={family?.printer_id ?? ''} />
          </label>
          <label className="field">
            Taux de TVA
            <TaxSelect taxes={taxes} value={family?.tax_rate_id ?? null} emptyLabel="Taux par défaut" />
          </label>
        </div>
        <div className="actions">
          <Submit className="btn accent big">{family ? 'Enregistrer' : 'Créer la famille'}</Submit>
        </div>
      </ActionForm>
      {family ? (
        <form action={archiveFamily}>
          <input type="hidden" name="id" value={family.id} />
          <input type="hidden" name="archived" value={family.archived ? 'false' : 'true'} />
          <button className="btn danger small" type="submit">
            {family.archived ? 'Réactiver la famille' : 'Archiver la famille'}
          </button>
        </form>
      ) : null}
    </>
  );
}

function ItemPanel(props: {
  item?: Item;
  families: Family[];
  defaultFamily?: string;
  taxes: TaxRate[];
  printers: Printer[];
  establishments: { id: string; name: string }[];
  closeHref: string;
  groups: { id: string; name: string; min_select: number; max_select: number }[];
  options: { id: string; group_id: string; name: string; extra_cents: string; archived: boolean }[];
  links: { id: string; group_id: string }[];
}) {
  const { item, families, taxes, printers, establishments } = props;
  const family = families.find((f) => f.id === (item?.family_id ?? props.defaultFamily));
  const famPrinter = printers.find((p) => p.id === family?.printer_id);
  const printerValue = item ? (item.printer_mode === 'printer' ? (item.printer_id ?? 'inherit') : item.printer_mode) : 'inherit';
  const attached = props.links.map((l) => ({ link: l, group: props.groups.find((g) => g.id === l.group_id) })).filter((x) => x.group);
  const available = props.groups.filter((g) => !props.links.some((l) => l.group_id === g.id));
  if (families.length === 0) {
    return (
      <>
        <div className="panel-head">
          <h2 id="fiche-title">Nouvel article</h2>
        </div>
        <div className="alert info">Créez d’abord une famille.</div>
      </>
    );
  }
  return (
    <>
      <div className="panel-head">
        <h2 id="fiche-title">{item ? item.name : 'Nouvel article'}</h2>
        <Link className="btn icon" href={props.closeHref} aria-label="Fermer la fiche">
          ×
        </Link>
      </div>
      <ActionForm action={saveItem}>
        <input type="hidden" name="id" value={item?.id ?? ''} />
        <div className="form-grid">
          <label className="field full">
            Nom sur le ticket
            <input name="name" defaultValue={item?.name} required maxLength={120} />
          </label>
          <label className="field">
            Famille
            <select name="family_id" defaultValue={item?.family_id ?? props.defaultFamily ?? families[0]?.id}>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Prix TTC (DH)
            <input name="price" inputMode="decimal" defaultValue={item ? amount(item.price_cents) : ''} placeholder="12,00" required />
          </label>
          <label className="field">
            Taux de TVA
            <TaxSelect taxes={taxes} value={item?.tax_rate_id ?? null} emptyLabel="Comme la famille" />
          </label>
          <label className="field">
            Imprimante de préparation
            <PrinterSelect printers={printers} establishments={establishments} value={printerValue} inheritLabel={`Comme la famille${famPrinter ? ` (${famPrinter.name})` : ''}`} />
          </label>
          {!item ? (
            <label className="field full">
              Type
              <select name="kind" defaultValue="product">
                <option value="product">Article simple</option>
                <option value="menu">Menu composé (étapes et choix)</option>
              </select>
            </label>
          ) : null}
        </div>
        <section className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          <div className="between">
            <strong style={{ fontSize: 15 }}>Stock</strong>
            <div className="segmented" role="radiogroup" aria-label="Type de stock">
              {(['none', 'unit', 'recipe'] as const).map((m) => (
                <label key={m}>
                  <input type="radio" name="stock_mode" value={m} defaultChecked={(item?.stock_mode ?? 'none') === m} />
                  <span>{m === 'none' ? 'Aucun' : m === 'unit' ? 'Unitaire' : 'À recette'}</span>
                </label>
              ))}
            </div>
          </div>
          <span className="small muted">Unitaire : une bouteille vendue sort une bouteille. À recette : la fiche technique décompte les ingrédients (module stock).</span>
          <label className="check">
            <input type="checkbox" name="available" defaultChecked={item?.available ?? true} />
            En vente (décocher pour une rupture : l’article reste visible mais grisé sur la tablette)
          </label>
        </section>
        <div className="actions">
          <Submit className="btn accent big">{item ? 'Enregistrer' : 'Créer l’article'}</Submit>
        </div>
      </ActionForm>

      {item ? (
        <>
          <section>
            <h3>Options et suppléments</h3>
            {attached.length === 0 ? <span className="small muted">Aucun groupe d’options (lait, cuisson, sauces…).</span> : null}
            {attached.map(({ link, group }) => (
              <div key={link.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 12px' }} className="stack">
                <div className="between">
                  <strong>{group!.name}</strong>
                  <form action={detachGroup}>
                    <input type="hidden" name="id" value={link.id} />
                    <button className="btn small" type="submit">
                      Retirer
                    </button>
                  </form>
                </div>
                <span className="small muted">
                  {group!.min_select > 0 ? `Obligatoire · ${group!.min_select} au minimum` : 'Facultatif'} · {group!.max_select} au maximum
                </span>
                <div className="chips">
                  {props.options
                    .filter((o) => o.group_id === group!.id && !o.archived)
                    .map((o) => (
                      <span key={o.id} className="badge">
                        {o.name}
                        {Number(o.extra_cents) ? ` · +${amount(o.extra_cents)} DH` : ''}
                      </span>
                    ))}
                </div>
              </div>
            ))}
            {available.length ? (
              <form action={attachGroup} className="form-row">
                <input type="hidden" name="item_id" value={item.id} />
                <label className="field">
                  Ajouter un groupe
                  <select name="group_id" defaultValue="">
                    <option value="" disabled>
                      Choisir…
                    </option>
                    {available.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn" type="submit">
                  Ajouter
                </button>
              </form>
            ) : (
              <Link className="small" href="/articles/options">
                Créer un groupe d’options
              </Link>
            )}
          </section>
          <section>
            <form action={setItemFlag}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="field" value="archived" />
              <input type="hidden" name="value" value={item.archived ? 'false' : 'true'} />
              <input type="hidden" name="back" value={props.closeHref} />
              <button className="btn danger small" type="submit">
                {item.archived ? 'Remettre à la carte' : 'Archiver l’article'}
              </button>
            </form>
            <span className="small muted">Un article archivé disparaît de la tablette mais reste dans l’historique des ventes.</span>
          </section>
        </>
      ) : null}
    </>
  );
}
