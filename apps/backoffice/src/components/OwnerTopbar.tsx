import { ReactNode } from 'react';
import { chooseEstablishment } from '@/lib/owner-actions';
import { initials, ownerContext } from '@/lib/owner';
import { AutoSubmitSelect } from './AutoSubmitSelect';

/** Barre du haut du back-office : titre, sélecteur d'établissement (si plusieurs), actions. */
export async function OwnerTopbar({ title, sub, children, picker = true }: { title: string; sub?: string; children?: ReactNode; picker?: boolean }) {
  const { me, establishments, current } = await ownerContext();
  return (
    <header className="topbar">
      <h1>
        {title} {sub ? <small>· {sub}</small> : null}
      </h1>
      {children ? <div className="actions">{children}</div> : null}
      {picker && establishments.length > 1 ? (
        <form action={chooseEstablishment} className="row">
          <span className="small muted">Établissement</span>
          <AutoSubmitSelect name="establishmentId" defaultValue={current.id} label="Établissement">
            {establishments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </AutoSubmitSelect>
        </form>
      ) : picker ? (
        <span className="badge muted">{current.name}</span>
      ) : null}
      <span className="avatar" title={me.full_name}>
        {initials(me.full_name)}
      </span>
    </header>
  );
}
