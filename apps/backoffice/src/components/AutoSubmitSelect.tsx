'use client';

import { ReactNode } from 'react';

/** Liste déroulante qui soumet son formulaire dès qu'on change la valeur. */
export function AutoSubmitSelect({ name, defaultValue, children, label }: { name: string; defaultValue?: string; children: ReactNode; label: string }) {
  return (
    <select className="input" name={name} defaultValue={defaultValue} aria-label={label} onChange={(e) => e.currentTarget.form?.requestSubmit()} style={{ width: 'auto' }}>
      {children}
    </select>
  );
}
