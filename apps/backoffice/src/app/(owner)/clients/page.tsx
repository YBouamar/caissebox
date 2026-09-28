import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm, Submit } from '@/components/ActionForm';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { amount, dateFr, dh } from '@/lib/format';
import { PaymentMethod } from '@/lib/owner';
import { saveCustomer, settle } from './actions';

export const metadata: Metadata = { title: 'Clients et ardoises' };

interface CustomerRow {
  id: string; full_name: string; phone: string | null; company: string | null; ice: string | null;
  credit_limit_cents: number; is_default: boolean; archived: boolean; balance_cents: number; last_move_at: string | null;
}
interface LedgerRow { id: string; kind: string; amount_cents: number; note: string | null; created_at: string; order_number: string | null; method: string | null; staff: string | null }

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ client?: string; q?: string }> }) {
  const sp = await searchParams;
  const all = await api<CustomerRow[]>('/bo/customers');
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = all.filter((c) => !q || c.full_name.toLowerCase().includes(q) || (c.phone ?? '').includes(q) || (c.company ?? '').toLowerCase().includes(q));
  const customer = all.find((c) => c.id === sp.client);
  const [ledger, methods] = customer && !customer.is_default
    ? await Promise.all([api<LedgerRow[]>(`/bo/customers/${customer.id}/ledger`), api<PaymentMethod[]>('/bo/r/payment-methods')])
    : [[], []];
  const due = all.reduce((s, c) => s + Math.max(0, c.balance_cents), 0);

  return (
    <>
      <OwnerTopbar title="Clients et ardoises" sub={`${all.length - 1} client(s)`} picker={false}>
        <Link className="btn primary" href="/clients?client=nouveau">
          + Nouveau client
        </Link>
      </OwnerTopbar>
      <div className="split">
        <main className="page">
          <div className="kpis">
            <div className="kpi">
              <span className="label">Total des ardoises</span>
              <span className="value">{dh(due)}</span>
              <span className="note">{all.filter((c) => c.balance_cents > 0).length} client(s) avec un solde</span>
            </div>
          </div>
          <form className="form-row" action="/clients">
            <label className="field">
              Rechercher
              <input name="q" defaultValue={sp.q} placeholder="Nom, téléphone, société" />
            </label>
            <button className="btn" type="submit">
              Rechercher
            </button>
          </form>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Téléphone</th>
                  <th className="num">Plafond</th>
                  <th className="num">Solde dû</th>
                  <th>Dernier mouvement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={customer?.id === c.id ? 'selected' : undefined}>
                    <td>
                      <Link className="rowlink" href={`/clients?client=${c.id}`}>
                        {c.full_name} {c.is_default ? <span className="badge muted">par défaut</span> : null}
                      </Link>
                      {c.company ? <span className="sub">{c.company}</span> : null}
                    </td>
                    <td>{c.phone ?? ''}</td>
                    <td className="num">{c.is_default ? '·' : c.credit_limit_cents ? dh(c.credit_limit_cents) : 'Aucun'}</td>
                    <td className="num strong" style={{ color: c.credit_limit_cents && c.balance_cents > c.credit_limit_cents ? 'var(--warn-ink)' : undefined }}>
                      {c.is_default ? '·' : dh(c.balance_cents)}
                    </td>
                    <td>{dateFr(c.last_move_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            « Client divers » est attribué automatiquement aux tickets sans client. Une ardoise (paiement à crédit) exige un client identifié.
          </p>
        </main>
        {customer || sp.client === 'nouveau' ? (
          <aside className="panel" aria-labelledby="client-title">
            <div className="panel-head">
              <h2 id="client-title">{customer ? customer.full_name : 'Nouveau client'}</h2>
              <Link className="btn icon" href="/clients" aria-label="Fermer">
                ×
              </Link>
            </div>
            {customer?.is_default ? (
              <div className="alert neutral">Compte technique utilisé pour les ventes sans client. Il ne peut pas avoir d’ardoise.</div>
            ) : (
              <>
                {customer ? (
                  <div className="kpi accent">
                    <span className="label">Solde dû</span>
                    <span className="value">{dh(customer.balance_cents)}</span>
                    <span className="note">{customer.credit_limit_cents ? `Plafond ${dh(customer.credit_limit_cents)}` : 'Sans plafond'}</span>
                  </div>
                ) : null}
                <ActionForm action={saveCustomer} key={customer?.id ?? 'new'}>
                  <input type="hidden" name="id" value={customer?.id ?? ''} />
                  <div className="form-grid">
                    <label className="field full">
                      Nom
                      <input name="full_name" defaultValue={customer?.full_name} required />
                    </label>
                    <label className="field">
                      Téléphone
                      <input name="phone" defaultValue={customer?.phone ?? ''} inputMode="tel" />
                    </label>
                    <label className="field">
                      Plafond d’ardoise (DH)
                      <input name="limit" inputMode="decimal" defaultValue={customer?.credit_limit_cents ? amount(customer.credit_limit_cents) : ''} placeholder="0 = sans plafond" />
                    </label>
                    <label className="field">
                      Société
                      <input name="company" defaultValue={customer?.company ?? ''} />
                    </label>
                    <label className="field">
                      ICE
                      <input name="ice" defaultValue={customer?.ice ?? ''} inputMode="numeric" maxLength={15} />
                    </label>
                  </div>
                  <Submit className="btn accent big">{customer ? 'Enregistrer' : 'Créer le client'}</Submit>
                </ActionForm>
                {customer && customer.balance_cents > 0 ? (
                  <section>
                    <h3>Enregistrer un règlement</h3>
                    <ActionForm action={settle} reset>
                      <input type="hidden" name="id" value={customer.id} />
                      <div className="form-grid">
                        <label className="field">
                          Montant (DH)
                          <input name="amount" inputMode="decimal" required defaultValue={amount(customer.balance_cents)} />
                        </label>
                        <label className="field">
                          Mode
                          <select name="paymentMethodId">
                            {methods
                              .filter((m) => m.active && m.kind !== 'customer_credit')
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="field full">
                          Note
                          <input name="note" placeholder="Virement du 28/09" />
                        </label>
                      </div>
                      <Submit className="btn primary">Enregistrer le règlement</Submit>
                    </ActionForm>
                    <span className="small muted">Un règlement en espèces reçu en salle se saisit plutôt sur la tablette, pour qu’il entre dans la caisse du jour.</span>
                  </section>
                ) : null}
                {customer ? (
                  <section>
                    <h3>Historique</h3>
                    {ledger.length === 0 ? <span className="small muted">Aucun mouvement.</span> : null}
                    <div className="list">
                      {ledger.map((l) => (
                        <div className="list-item" key={l.id}>
                          <span className="stack" style={{ gap: 2 }}>
                            <strong>{l.kind === 'charge' ? `Ticket ${l.order_number ?? ''}` : l.kind === 'payment' ? `Règlement${l.method ? ` · ${l.method}` : ''}` : 'Ajustement'}</strong>
                            <span className="small muted">
                              {dateFr(l.created_at)}
                              {l.staff ? ` · ${l.staff}` : ''}
                              {l.note && l.kind !== 'charge' ? ` · ${l.note}` : ''}
                            </span>
                          </span>
                          <strong style={{ color: l.amount_cents < 0 ? 'var(--ok-ink)' : undefined }}>{dh(l.amount_cents)}</strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            )}
          </aside>
        ) : null}
      </div>
    </>
  );
}
