import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { DiningTable, ownerContext, Zone } from '@/lib/owner';
import { createZone, renameZone, saveTable } from './actions';
import { FloorEditor } from './FloorEditor';

export const metadata: Metadata = { title: 'Salle et tables' };

const SHAPES = { square: 'Carrée', round: 'Ronde', long: 'Rectangulaire' } as const;

export default async function FloorPage({ searchParams }: { searchParams: Promise<{ zone?: string; table?: string }> }) {
  const sp = await searchParams;
  const { current } = await ownerContext();
  const [zones, tables] = await Promise.all([
    api<Zone[]>(`/bo/r/zones?establishment_id=${current.id}`),
    api<DiningTable[]>(`/bo/r/tables?establishment_id=${current.id}`),
  ]);
  const zone = zones.find((z) => z.id === sp.zone) ?? zones[0];
  const zoneTables = tables.filter((t) => t.zone_id === zone?.id);
  const table = tables.find((t) => t.id === sp.table);

  return (
    <>
      <OwnerTopbar title="Salle et tables" sub={`${tables.filter((t) => t.active).length} tables, ${zones.length} zone(s)`} />
      <div className="split">
        <main className="page">
          <div className="chips">
            {zones.map((z) => (
              <Link key={z.id} href={`/salle?zone=${z.id}`} className="chip" aria-current={z.id === zone?.id ? 'true' : undefined}>
                {z.name} · {tables.filter((t) => t.zone_id === z.id && t.active).length}
              </Link>
            ))}
          </div>
          {zone ? <FloorEditor key={zone.id} tables={zoneTables} selected={table?.id} zoneId={zone.id} /> : null}
          <p className="small muted" style={{ margin: 0 }}>
            Glissez les tables pour reproduire votre salle : le serveur verra exactement ce plan sur sa tablette. Cliquez sur une table pour la modifier.
          </p>
        </main>
        <aside className="panel">
          {table ? (
            <>
              <div className="panel-head">
                <h2>Table {table.label}</h2>
                <Link className="btn icon" href={`/salle?zone=${zone?.id ?? ''}`} aria-label="Fermer">
                  ×
                </Link>
              </div>
              <ActionForm action={saveTable} key={table.id}>
                <input type="hidden" name="id" value={table.id} />
                <input type="hidden" name="shape_changed" value={table.shape} />
                <div className="form-grid">
                  <label className="field">
                    Nom
                    <input name="label" defaultValue={table.label} required maxLength={12} />
                  </label>
                  <label className="field">
                    Places
                    <input name="seats" type="number" min={1} max={40} defaultValue={table.seats} />
                  </label>
                  <label className="field full">
                    Forme
                    <select name="shape" defaultValue={table.shape}>
                      {Object.entries(SHAPES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="check">
                  <input type="checkbox" name="active" defaultChecked={table.active} />
                  Table en service
                </label>
                <Submit className="btn accent big">Enregistrer</Submit>
              </ActionForm>
            </>
          ) : zone ? (
            <>
              <div className="panel-head">
                <h2>Ajouter une table</h2>
              </div>
              <ActionForm action={saveTable} reset>
                <input type="hidden" name="establishment_id" value={current.id} />
                <input type="hidden" name="zone_id" value={zone.id} />
                <input type="hidden" name="count" value={zoneTables.length} />
                <div className="form-grid">
                  <label className="field">
                    Nom
                    <input name="label" required maxLength={12} placeholder={`T${tables.length + 1}`} />
                  </label>
                  <label className="field">
                    Places
                    <input name="seats" type="number" min={1} max={40} defaultValue={4} />
                  </label>
                  <label className="field full">
                    Forme
                    <select name="shape" defaultValue="square">
                      {Object.entries(SHAPES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Submit className="btn accent big">Ajouter dans « {zone.name} »</Submit>
              </ActionForm>
              <section>
                <h3>Renommer la zone</h3>
                <ActionForm action={renameZone} quiet key={zone.id}>
                  <input type="hidden" name="id" value={zone.id} />
                  <div className="form-row">
                    <label className="field">
                      Nom
                      <input name="name" defaultValue={zone.name} required />
                    </label>
                    <Submit className="btn">Renommer</Submit>
                  </div>
                </ActionForm>
              </section>
            </>
          ) : null}
          <section>
            <h3>Nouvelle zone</h3>
            <ActionForm action={createZone} reset>
              <input type="hidden" name="establishment_id" value={current.id} />
              <input type="hidden" name="sort" value={zones.length} />
              <div className="form-row">
                <label className="field">
                  Nom
                  <input name="name" required placeholder="Terrasse" />
                </label>
                <Submit className="btn">Créer</Submit>
              </div>
            </ActionForm>
          </section>
        </aside>
      </div>
    </>
  );
}
