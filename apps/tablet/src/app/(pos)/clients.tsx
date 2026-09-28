import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { CustomerRow } from '../../core/pos';
import { usePosContext } from '../../services/CaisseProvider';
import { AmountPad } from '../../ui/AmountPad';
import { useGuarded } from '../../ui/Approval';
import { dh } from '../../ui/format';
import { Btn, Card, Row, T } from '../../ui/kit';
import { C, F } from '../../ui/theme';

/** Clients et ardoises : solde, historique récent, règlement en caisse. */
export default function Clients() {
  const { pos, user } = usePosContext();
  const guard = useGuarded();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<CustomerRow | null>(null);
  const [cents, setCents] = useState(0);
  const [methodId, setMethodId] = useState<string | null>(null);
  const list = pos.customers(q);
  const methods = pos.paymentMethods().filter((m) => m.kind !== 'customer_credit');
  const balance = sel ? pos.customerBalance(sel.id) : 0;
  const history = sel ? pos.store.where('customer_ledger', (l) => l.customer_id === sel.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 12) : [];

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ flex: 1, padding: 20, gap: 14 }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Rechercher un client (nom, téléphone)" placeholderTextColor={C.faint} style={{ height: 52, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 16, color: C.ink }} />
        <ScrollView contentContainerStyle={{ gap: 6 }}>
          {list.length === 0 ? <T color={C.muted}>Aucun client. Les clients et leurs plafonds se créent depuis le back-office.</T> : null}
          {list.map((c) => {
            const b = pos.customerBalance(c.id);
            const limit = Number(c.credit_limit_cents);
            return (
              <Pressable key={c.id} onPress={() => { setSel(c); setCents(Math.max(0, b)); setMethodId(null); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: sel?.id === c.id ? C.amberSoft : C.surface, borderWidth: 1, borderColor: C.line }}>
                <View style={{ flex: 1 }}>
                  <T w="semibold" size={16}>
                    {c.full_name}
                  </T>
                  <T size={13} color={C.muted}>
                    {c.phone ?? ''}
                    {limit ? ` · plafond ${dh(limit)}` : ''}
                  </T>
                </View>
                <T w="bold" size={16} color={limit && b > limit ? C.warn : C.ink}>
                  {dh(b)}
                </T>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ width: 460, backgroundColor: C.surface, borderLeftWidth: 1, borderLeftColor: C.line, padding: 24, gap: 14 }}>
        {sel ? (
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <T w="bold" size={22}>
              {sel.full_name}
            </T>
            <Card style={{ backgroundColor: C.amberSoft, borderColor: '#F7D89A' }}>
              <T color={C.amberInk}>Solde de l’ardoise</T>
              <T w="bold" size={32}>
                {dh(balance)}
              </T>
            </Card>
            {balance > 0 ? (
              <>
                <Row style={{ flexWrap: 'wrap' }}>
                  {methods.map((m) => (
                    <Btn key={m.id} label={m.label} kind={methodId === m.id ? 'primary' : 'outline'} height={44} textSize={13} onPress={() => setMethodId(m.id)} />
                  ))}
                </Row>
                <AmountPad cents={cents} onChange={setCents} keyHeight={44} label="Montant réglé" />
                <Btn kind="accent" height={56} disabled={!methodId || cents <= 0} label={`Encaisser le règlement · ${dh(cents)}`} onPress={() => void guard(() => pos.settleCredit(user!.id, sel.id, cents, methodId!), 'Règlement enregistré').then((ok) => ok && setCents(0))} />
              </>
            ) : null}
            <T w="semibold" color={C.muted}>
              Derniers mouvements
            </T>
            {history.map((h) => (
              <Row key={h.id} style={{ justifyContent: 'space-between' }}>
                <T color={C.muted}>{h.kind === 'charge' ? 'Ticket à crédit' : h.kind === 'payment' ? 'Règlement' : 'Ajustement'}</T>
                <T w="semibold" color={Number(h.amount_cents) < 0 ? C.okInk : C.ink}>
                  {dh(Number(h.amount_cents))}
                </T>
              </Row>
            ))}
            {!history.length ? <T color={C.muted}>Aucun mouvement récent sur cette tablette.</T> : null}
          </ScrollView>
        ) : (
          <T color={C.muted}>Choisissez un client.</T>
        )}
      </View>
    </View>
  );
}
