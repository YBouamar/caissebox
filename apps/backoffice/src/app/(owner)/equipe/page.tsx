import type { Metadata } from 'next';
import Link from 'next/link';
import { PERMISSIONS } from '@caissebox/shared';
import { ActionForm, Submit } from '@/components/ActionForm';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { ownerContext, Role, StaffMember } from '@/lib/owner';
import { changePin, createStaff, updatePermissions, updateStaff } from './actions';

export const metadata: Metadata = { title: 'Équipe et PIN' };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ personne?: string; roles?: string }> }) {
  const sp = await searchParams;
  const { establishments } = await ownerContext();
  const [staff, roles] = await Promise.all([api<StaffMember[]>('/bo/staff'), api<Role[]>('/bo/roles')]);
  const person = staff.find((s) => s.id === sp.personne);
  const showRoles = sp.roles === '1';
  const estName = (id: string) => establishments.find((e) => e.id === id)?.name ?? '';

  return (
    <>
      <OwnerTopbar title="Équipe et PIN" sub={`${staff.filter((s) => s.active).length} actif(s)`} picker={false}>
        <Link className="btn" href={showRoles ? '/equipe' : '/equipe?roles=1'}>
          {showRoles ? 'Voir l’équipe' : 'Rôles et droits'}
        </Link>
        <Link className="btn primary" href="/equipe?personne=nouveau">
          + Ajouter une personne
        </Link>
      </OwnerTopbar>
      <div className="split">
        <main className="page">
          {showRoles ? (
            <RolesMatrix roles={roles} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Personne</th>
                    <th>Rôle</th>
                    <th>Établissements</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        Ajoutez au moins un manager : c’est lui qui ouvre et clôture la journée sur la tablette.
                      </td>
                    </tr>
                  ) : null}
                  {staff.map((s) => (
                    <tr key={s.id} className={person?.id === s.id ? 'selected' : undefined}>
                      <td>
                        <Link className="rowlink" href={`/equipe?personne=${s.id}`}>
                          <span className="row">
                            <span className="avatar" style={{ width: 30, height: 30, fontSize: 12, background: s.active ? 'var(--amber)' : 'var(--line)' }}>
                              {s.initials}
                            </span>
                            {s.full_name}
                          </span>
                        </Link>
                      </td>
                      <td>{s.role}</td>
                      <td>{s.establishment_ids.map(estName).join(', ')}</td>
                      <td>{s.active ? <span className="badge">Actif</span> : <span className="badge muted">Désactivé</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
            Chaque personne se connecte sur la tablette avec son PIN à 4 chiffres, unique dans votre équipe. Une action non autorisée par son rôle reste possible avec le PIN d’un manager et un motif, et elle est tracée.
          </p>
        </main>
        {person || sp.personne === 'nouveau' ? (
          <aside className="panel" aria-labelledby="person-title">
            <div className="panel-head">
              <h2 id="person-title">{person ? person.full_name : 'Nouvelle personne'}</h2>
              <Link className="btn icon" href="/equipe" aria-label="Fermer">
                ×
              </Link>
            </div>
            <ActionForm action={person ? updateStaff : createStaff} key={person?.id ?? 'new'}>
              <input type="hidden" name="id" value={person?.id ?? ''} />
              <div className="form-grid">
                <label className="field full">
                  Nom complet
                  <input name="fullName" defaultValue={person?.full_name} required maxLength={80} />
                </label>
                <label className="field">
                  Rôle
                  <select name="roleId" defaultValue={roles.find((r) => r.name === person?.role)?.id ?? roles.find((r) => r.name === 'Serveur')?.id}>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                {person ? (
                  <label className="field">
                    Initiales
                    <input name="initials" defaultValue={person.initials} maxLength={3} />
                  </label>
                ) : (
                  <label className="field">
                    PIN (4 chiffres)
                    <input name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" />
                  </label>
                )}
              </div>
              <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                  Établissements
                </legend>
                {establishments.map((e) => (
                  <label className="check" key={e.id}>
                    <input type="checkbox" name="establishmentIds" value={e.id} defaultChecked={person ? person.establishment_ids.includes(e.id) : establishments.length === 1} />
                    {e.name}
                  </label>
                ))}
              </fieldset>
              {person ? (
                <label className="check">
                  <input type="checkbox" name="active" defaultChecked={person.active} />
                  Actif (décocher quand la personne quitte l’équipe : son PIN ne fonctionne plus)
                </label>
              ) : null}
              <Submit className="btn accent big">{person ? 'Enregistrer' : 'Ajouter'}</Submit>
            </ActionForm>
            {person ? (
              <section>
                <h3>Changer le PIN</h3>
                <ActionForm action={changePin} reset>
                  <input type="hidden" name="id" value={person.id} />
                  <div className="form-row">
                    <label className="field">
                      Nouveau PIN
                      <input name="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} required autoComplete="off" />
                    </label>
                    <Submit className="btn">Enregistrer le PIN</Submit>
                  </div>
                </ActionForm>
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </>
  );
}

function RolesMatrix({ roles }: { roles: Role[] }) {
  const keys = Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[];
  return (
    <div className="grid-2">
      {roles.map((r) => (
        <section className="card" key={r.id}>
          <div className="between">
            <span className="card-title">{r.name}</span>
            {r.is_manager ? <span className="badge amber">Tous les droits</span> : null}
          </div>
          <ActionForm action={updatePermissions}>
            <input type="hidden" name="id" value={r.id} />
            <div className="stack" style={{ gap: 6 }}>
              {keys.map((k) => (
                <label className="check" key={k}>
                  <input type="hidden" name="keys" value={k} />
                  <input type="checkbox" name={`p:${k}`} defaultChecked={Boolean(r.permissions[k])} disabled={r.is_manager} />
                  {PERMISSIONS[k]}
                </label>
              ))}
            </div>
            <label className="field">
              Remise maximale sans manager (%)
              <input name="discount_max" inputMode="decimal" defaultValue={String(Number(r.permissions['order.discount_max_bp'] ?? 0) / 100)} disabled={r.is_manager} />
            </label>
            {r.is_manager ? null : <Submit className="btn primary">Enregistrer les droits</Submit>}
          </ActionForm>
        </section>
      ))}
    </div>
  );
}
