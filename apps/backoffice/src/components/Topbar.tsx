import { ReactNode } from 'react';

export function Topbar({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <h1>
        {title} {sub ? <small>· {sub}</small> : null}
      </h1>
      {children ? <div className="actions">{children}</div> : null}
    </header>
  );
}
