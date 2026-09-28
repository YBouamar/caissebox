import type { Metadata } from 'next';
import { ActionForm, Submit } from '@/components/ActionForm';
import { OwnerTopbar } from '@/components/OwnerTopbar';
import { api } from '@/lib/api';
import { rate } from '@/lib/format';
import { ownerContext, PaymentMethod, ReasonCode, TaxRate } from '@/lib/owner';
import { addPaymentMethod, addReason, addTax, saveEstablishment, setDefaultTax, togglePaymentMethod, toggleReason } from './actions';

export const metadata: Metadata = { title: 'Paramètres' };

const CATEGORIES: Record<string, string> = {
  void: 'Annulation',
  comp: 'Article offert',
  discount: 'Remise',
  cash_out: 'Sortie de caisse',
  cash_variance: 'Écart de caisse',
};

export default async function SettingsPage() {
  const { current } = await ownerContext();
  const [taxes, methods, reasons] = await Promise.all([
    api<TaxRate[]>('/bo/r/tax-rates'),
    api<PaymentMethod[]>('/bo/r/payment-methods'),
    api<ReasonCode[]>('/bo/r/reason-codes'),
  ]);
  return (
    <>
      <OwnerTopbar title="Paramètres" />
      <main className="page">
        <div className="grid-2">
          <section className="card">
            <h2>Établissement</h2>
            <ActionForm action={saveEstablishment} key={current.id}>
              <input type="hidden" name="id" value={current.id} />
              <div className="form-grid">
                <label className="field full">
                  Nom commercial
                  <input name="name" defaultValue={current.name} required />
                </label>
                <label className="field full">
                  Adresse
                  <input name="address" defaultValue={current.address ?? ''} />
                </label>
                <label className="field">
                  Mode de service
                  <select name="service_mode" defaultValue={current.service_mode}>
                    <option value="both">Serveurs et comptoir</option>
                    <option value="waiter_pays">Le serveur encaisse ses tables</option>
                    <option value="counter">Comptoir uniquement</option>
                  </select>
                </label>
                <label className="field">
                  Envoi en préparation
                  <select name="kitchen_send_mode" defaultValue={current.kitchen_send_mode}>
                    <option value="manual">Sur bouton « Envoyer »</option>
                    <option value="auto">Automatique à la validation</option>
                  </select>
                </label>
                <label className="field full">
                  En-tête du ticket
                  <textarea name="receipt_header" defaultValue={current.receipt_header ?? ''} placeholder={'Café Atlas\n12, bd Anfa, Casablanca\nICE 000000000000000'} />
                </label>
                <label className="field full">
                  Pied du ticket
                  <input name="receipt_footer" defaultValue={current.receipt_footer ?? ''} />
                </label>
              </div>
              <Submit className="btn accent big">Enregistrer</Submit>
            </ActionForm>
          </section>

          <div className="stack" style={{ gap: 16 }}>
            <section className="card">
              <h2>Taux de TVA</h2>
              <div className="list">
                {taxes.map((t) => (
                  <div className="list-item" key={t.id}>
                    <span>
                      <strong>{t.label}</strong> <span className="muted">· {rate(t.rate_bp)}</span>
                    </span>
                    {t.is_default ? (
                      <span className="badge amber">Par défaut</span>
                    ) : (
                      <form action={setDefaultTax}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="btn small" type="submit">
                          Mettre par défaut
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
              <ActionForm action={addTax} reset quiet>
                <div className="form-row">
                  <label className="field">
                    Libellé
                    <input name="label" required placeholder="TVA 14 %" />
                  </label>
                  <label className="field" style={{ flex: '0 1 100px' }}>
                    Taux (%)
                    <input name="rate" required inputMode="decimal" placeholder="14" />
                  </label>
                  <Submit className="btn">Ajouter</Submit>
                </div>
              </ActionForm>
            </section>

            <section className="card">
              <h2>Modes de paiement</h2>
              <div className="list">
                {methods.map((m) => (
                  <div className="list-item" key={m.id}>
                    <span>
                      <strong>{m.label}</strong> {m.active ? null : <span className="badge muted">désactivé</span>}
                    </span>
                    <form action={togglePaymentMethod}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="active" value={m.active ? 'false' : 'true'} />
                      <button className="btn small" type="submit">
                        {m.active ? 'Désactiver' : 'Activer'}
                      </button>
                    </form>
                  </div>
                ))}
              </div>
              <ActionForm action={addPaymentMethod} reset quiet>
                <div className="form-row">
                  <label className="field">
                    Autre mode
                    <input name="label" required placeholder="Glovo, chèque…" />
                  </label>
                  <Submit className="btn">Ajouter</Submit>
                </div>
              </ActionForm>
            </section>
          </div>
        </div>

        <section className="card">
          <h2>Motifs</h2>
          <span className="small muted">Proposés sur la tablette quand un manager valide une annulation, un article offert, une remise, une sortie de caisse ou un écart.</span>
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {Object.entries(CATEGORIES).map(([cat, label]) => (
              <div className="stack" key={cat}>
                <strong>{label}</strong>
                {reasons
                  .filter((r) => r.category === cat)
                  .map((r) => (
                    <div className="list-item" key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                      <span>{r.label}</span>
                      <form action={toggleReason}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="active" value={r.active ? 'false' : 'true'} />
                        <button className="btn small" type="submit" aria-label={r.active ? `Désactiver ${r.label}` : `Activer ${r.label}`}>
                          {r.active ? 'Masquer' : 'Afficher'}
                        </button>
                      </form>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <ActionForm action={addReason} reset quiet>
            <div className="form-row">
              <label className="field" style={{ flex: '0 1 200px' }}>
                Catégorie
                <select name="category">
                  {Object.entries(CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Nouveau motif
                <input name="label" required />
              </label>
              <Submit className="btn">Ajouter</Submit>
            </div>
          </ActionForm>
        </section>
      </main>
    </>
  );
}
