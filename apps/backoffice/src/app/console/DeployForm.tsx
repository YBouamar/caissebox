'use client';

import { PendingProvider, Submit, useKeepValuesAction } from '@/components/ActionForm';
import { deployDevice, DeployState } from './actions';

/**
 * Affectation d'un matériel en stock à un établissement. Pour une tablette, le
 * secret d'enrôlement n'est affiché qu'une fois : il sert au premier démarrage.
 */
export function DeployForm({ tenantId, establishments, stock }: {
  tenantId: string;
  establishments: { id: string; name: string }[];
  stock: { id: string; label: string }[];
}) {
  const { state, onSubmit, pending } = useKeepValuesAction<DeployState>(deployDevice, {});
  return (
    <PendingProvider pending={pending}>
    <form onSubmit={onSubmit} className="stack">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="form-row">
        <label className="field" style={{ flex: '2 1 220px' }}>
          Matériel en stock
          <select name="deviceId" required defaultValue="">
            <option value="" disabled>
              {stock.length ? 'Choisir…' : 'Aucun matériel en stock'}
            </option>
            {stock.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Établissement
          <select name="establishmentId" defaultValue={establishments[0]?.id}>
            {establishments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Nom sur place
          <input name="label" placeholder="Caisse 1, Serveur 2…" maxLength={40} />
        </label>
        <Submit pendingLabel="Affectation…">Affecter</Submit>
      </div>
      {state.error ? <div className="alert error">{state.error}</div> : null}
      {state.ok && state.secret ? (
        <div className="alert info stack" role="status">
          <strong>Secret d’enrôlement de la tablette (affiché une seule fois)</strong>
          <span>Saisissez-le au premier démarrage de l’application, avec l’identifiant ci-dessous. Si vous le perdez, réaffectez la tablette pour en générer un nouveau.</span>
          <span className="secret">
            Identifiant : {state.deviceId}
            <br />
            Secret : {state.secret}
          </span>
        </div>
      ) : state.ok ? (
        <div className="alert ok">{state.message}</div>
      ) : null}
    </form>
    </PendingProvider>
  );
}
