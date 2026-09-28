'use client';

import { PendingProvider, Submit, useKeepValuesAction } from '@/components/ActionForm';
import { login } from '@/lib/auth-actions';

export function LoginForm({ expired }: { expired: boolean }) {
  const { state, onSubmit, pending } = useKeepValuesAction(login, {});
  return (
    <PendingProvider pending={pending}>
      <form onSubmit={onSubmit}>
        <h1 style={{ fontSize: 28 }}>Connexion</h1>
        <p className="muted" style={{ margin: 0 }}>
          Back-office de votre établissement ou console BACYBRAINS.
        </p>
        {expired ? <div className="alert info">Votre session a expiré, reconnectez-vous.</div> : null}
        <label className="field">
          E-mail
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          Mot de passe
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {state.error ? (
          <div className="alert error" role="alert">
            {state.error}
          </div>
        ) : null}
        <Submit className="btn accent big" pendingLabel="Connexion…">
          Se connecter
        </Submit>
      </form>
    </PendingProvider>
  );
}
