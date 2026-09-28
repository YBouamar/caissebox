import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { usePosContext } from '../../services/CaisseProvider';
import { useGuarded } from '../../ui/Approval';
import { dh, hhmm } from '../../ui/format';
import { Badge, Btn, Card, Row, Sheet, T } from '../../ui/kit';
import { C, F } from '../../ui/theme';

/** Ventes à emporter et au comptoir : numéro d'appel, nom du client, suivi. */
export default function Emporter() {
  const { pos, user } = usePosContext();
  const router = useRouter();
  const guard = useGuarded();
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState('');
  const day = pos.currentDay();
  const orders = pos.orders().filter((o) => o.order_type !== 'dine_in' && o.status !== 'voided').sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  const open = orders.filter((o) => o.status === 'open');
  const paid = orders.filter((o) => o.status === 'paid').slice(0, 30);

  const create = (type: 'takeaway' | 'counter', customerName?: string) =>
    guard(async () => {
      const o = await pos.createOrder(user!.id, { type, customerName: customerName?.trim() || null });
      router.push(`/commande/${o.id}`);
    });

  if (!day) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <T color={C.muted}>La journée n’est pas ouverte.</T>
      </View>
    );
  }

  const card = (o: (typeof orders)[number]) => (
    <Pressable key={o.id} onPress={() => router.push(o.status === 'open' ? `/commande/${o.id}` : `/tickets?id=${o.id}`)} style={{ width: '32%', backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T w="bold" size={28}>
          {o.call_number ? `n° ${o.call_number}` : o.number}
        </T>
        {o.status === 'open' ? <Badge text="En cours" tone="amber" /> : <Badge text="Payé" tone="ok" />}
      </Row>
      <T w="semibold">{o.customer_name ?? (o.order_type === 'takeaway' ? 'À emporter' : 'Comptoir')}</T>
      <T size={13} color={C.muted}>
        {o.number} · {hhmm(o.opened_at)} · {pos.staffName(o.waiter_id)}
      </T>
      <T w="bold" size={18}>
        {dh(o.status === 'open' ? pos.totals(o.id).totalCents : o.total_cents)}
      </T>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, padding: 20, gap: 16 }}>
      <Row>
        <T w="bold" size={24} style={{ flex: 1 }}>
          À emporter et comptoir
        </T>
        <Btn label="+ Comptoir" onPress={() => void create('counter')} />
        <Btn label="+ À emporter" kind="accent" onPress={() => { setName(''); setAsking(true); }} />
      </Row>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <T w="semibold" color={C.muted}>
          En cours · {open.length}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{open.length ? open.map(card) : <T color={C.muted}>Aucune commande en cours.</T>}</View>
        <T w="semibold" color={C.muted}>
          Réglées aujourd’hui
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{paid.map(card)}</View>
      </ScrollView>
      <Sheet visible={asking} onClose={() => setAsking(false)} title="Commande à emporter" width={520} footer={<Btn flex kind="accent" label="Créer la commande" onPress={() => { setAsking(false); void create('takeaway', name); }} />}>
        <T color={C.muted}>Nom du client (facultatif), imprimé sur le bon et le ticket.</T>
        <TextInput value={name} onChangeText={setName} autoFocus placeholder="Prénom" placeholderTextColor={C.faint} style={{ height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 18, color: C.ink }} />
      </Sheet>
    </View>
  );
}
