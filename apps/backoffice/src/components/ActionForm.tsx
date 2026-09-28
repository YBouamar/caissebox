'use client';

import { createContext, FormEvent, ReactNode, startTransition, useActionState, useContext, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

type Action<S> = (state: S, form: FormData) => Promise<S>;

const PendingContext = createContext<boolean | null>(null);

/**
 * Soumission sans la remise à zéro automatique de React 19 : en cas d'erreur,
 * l'utilisateur garde sa saisie. On vide le formulaire seulement si `reset` est demandé
 * et que l'enregistrement a réussi.
 */
export function useKeepValuesAction<S extends ActionState>(action: Action<S>, initial: S) {
  const [state, formAction, pending] = useActionState<S, FormData>(action as (s: Awaited<S>, f: FormData) => Promise<S>, initial as Awaited<S>);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => formAction(data));
  };
  return { state, onSubmit, pending };
}

/** Formulaire relié à une server action, avec retour d'erreur ou de succès. */
export function ActionForm({
  action,
  children,
  className,
  reset = false,
  quiet = false,
}: {
  action: Action<ActionState>;
  children: ReactNode;
  className?: string;
  reset?: boolean;
  quiet?: boolean;
}) {
  const { state, onSubmit, pending } = useKeepValuesAction(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && reset) ref.current?.reset();
  }, [state, reset]);
  return (
    <PendingContext.Provider value={pending}>
      <form ref={ref} onSubmit={onSubmit} className={className ?? 'stack'} aria-busy={pending}>
        {children}
        {state.error ? (
          <div className="alert error" role="alert">
            {state.error}
          </div>
        ) : null}
        {state.ok && state.message && !quiet ? (
          <div className="alert ok" role="status">
            {state.message}
          </div>
        ) : null}
      </form>
    </PendingContext.Provider>
  );
}

export function PendingProvider({ pending, children }: { pending: boolean; children: ReactNode }) {
  return <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>;
}

export function Submit({ children, className = 'btn primary', name, value, pendingLabel = 'Enregistrement…' }: {
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  pendingLabel?: string;
}) {
  const ctx = useContext(PendingContext);
  const status = useFormStatus();
  const pending = ctx ?? status.pending;
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {pending ? pendingLabel : children}
    </button>
  );
}
