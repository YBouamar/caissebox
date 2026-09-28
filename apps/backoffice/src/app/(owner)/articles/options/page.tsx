import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { amount } from '@/lib/format';
import { ItemOptionGroup, Option, OptionGroup } from '@/lib/owner';
import { addOption, archiveOption, createGroup, updateGroup } from '../actions';

export const metadata: Metadata = { title: 'Options et suppléments' };

export default async function OptionsPage() {
  const [groups, options, links] = await Promise.all([
    api<OptionGroup[]>('/bo/r/option-groups'),
    api<Option[]>('/bo/r/options'),
    api<ItemOptionGroup[]>('/bo/r/item-option-groups'),
  ]);
  return (
    <>
      <OwnerTopbar title="Options et suppléments" sub={`${groups.length} groupe(s)`} picker={false}>
        <Link className="btn" href="/articles">
          Retour aux articles
        </Link>
      </OwnerTopbar>
      <main className="page">
        <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
          Un groupe regroupe des choix proposés au serveur quand il ajoute un article : type de lait, cuisson, sauces, suppléments payants. Un minimum à 1 rend le choix obligatoire. Rattachez ensuite le groupe aux articles concernés depuis leur fiche.
        </p>
        <div className="grid-2">
          {groups.map((g) => (
            <section className="card" key={g.id}>
              <ActionForm action={updateGroup} quiet>
                <input type="hidden" name="id" value={g.id} />
                <div className="form-row">
                  <label className="field" style={{ flex: '2 1 200px' }}>
                    Groupe
                    <input name="name" defaultValue={g.name} required />
                  </label>
                  <label className="field" style={{ flex: '0 1 90px' }}>
                    Min.
                    <input name="min_select" type="number" min={0} max={20} defaultValue={g.min_select} />
                  </label>
                  <label className="field" style={{ flex: '0 1 90px' }}>
                    Max.
                    <input name="max_select" type="number" min={1} max={20} defaultValue={g.max_select} />
                  </label>
                  <Submit className="btn small">OK</Submit>
                </div>
              </ActionForm>
              <span className="small muted">Utilisé par {links.filter((l) => l.group_id === g.id).length} article(s)</span>
              <div className="list">
                {options
                  .filter((o) => o.group_id === g.id && !o.archived)
                  .map((o) => (
                    <div className="list-item" key={o.id}>
                      <span>{o.name}</span>
                      <span className="row">
                        <strong>{Number(o.extra_cents) ? `+${amount(o.extra_cents)} DH` : 'inclus'}</strong>
                        <form action={archiveOption}>
                          <input type="hidden" name="id" value={o.id} />
                          <button className="btn small icon" type="submit" aria-label={`Retirer ${o.name}`}>
                            ×
                          </button>
                        </form>
                      </span>
                    </div>
                  ))}
              </div>
              <ActionForm action={addOption} reset quiet>
                <input type="hidden" name="group_id" value={g.id} />
                <div className="form-row">
                  <label className="field" style={{ flex: '2 1 160px' }}>
                    Nouvelle option
                    <input name="name" required placeholder="Lait d’avoine" />
                  </label>
                  <label className="field" style={{ flex: '1 1 100px' }}>
                    Supplément (DH)
                    <input name="extra" inputMode="decimal" placeholder="0,00" />
                  </label>
                  <Submit className="btn">Ajouter</Submit>
                </div>
              </ActionForm>
            </section>
          ))}
          <section className="card">
            <h2>Nouveau groupe</h2>
            <ActionForm action={createGroup} reset>
              <label className="field">
                Nom
                <input name="name" required placeholder="Type de lait" />
              </label>
              <div className="form-grid">
                <label className="field">
                  Choix minimum
                  <input name="min_select" type="number" min={0} max={20} defaultValue={0} />
                </label>
                <label className="field">
                  Choix maximum
                  <input name="max_select" type="number" min={1} max={20} defaultValue={1} />
                </label>
              </div>
              <Submit className="btn primary">Créer le groupe</Submit>
            </ActionForm>
          </section>
        </div>
      </main>
    </>
  );
}
