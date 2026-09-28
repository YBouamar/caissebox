import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { OrderRow } from '../../core/pos';
import { usePosContext } from '../../services/CaisseProvider';
import { useGuarded } from '../../ui/Approval';
import { amount, dh, hhmm } from '../../ui/format';
import { Badge, Btn, Card, Chip, Row, T } from '../../ui/kit';
import { C } from '../../ui/theme';

/** Tickets de la journée : consultation, duplicata, réouverture d'un ticket en cours. */
export default function Tickets() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { pos, user } = usePosContext();
  const router = useRouter();
  const guard = useGuarded();
  const [filter, setFilter] = useState<'all' | 'open' | 'paid' | 'mine'>('all');
  const [selected, setSelected] = useState<string | null>(params.id ?? null);
  const all = pos.orders().filter((o) => o.status !== 'voided').sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  const list = all.filter((o) => (filter === 'open' ? o.status === 'open' : filter === 'paid' ? o.status === 'paid' : filter === 'mine' ? o.waiter_id === user?.id : true));
  const order = pos.store.get<OrderRow>('orders', selected);
  const methods = new Map(pos.paymentMethods().map((m) => [m.id, m.label]));

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ flex: 1, padding: 20, gap: 14 }}>
        <Row>
          <Chip label={`Tous · ${all.length}`} active={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="En cours" active={filter === 'open'} onPress={() => setFilter('open')} />
          <Chip label="Payés" active={filter === 'paid'} onPress={() => setFilter('paid')} />
          <Chip label="Les miens" active={filter === 'mine'} onPress={() => setFilter('mine')} />
        </Row>
        <ScrollView contentContainerStyle={{ gap: 6 }}>
          {list.length === 0 ? <T color={C.muted}>Aucun ticket.</T> : null}
          {list.map((o) => (
            <Pressable key={o.id} onPress={() => setSelected(o.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: selected === o.id ? C.amberSoft : C.surface, borderWidth: 1, borderColor: C.line }}>
              <T w="bold" style={{ width: 90 }}>
                {o.number}
              </T>
              <T style={{ flex: 1 }} numberOfLines={1}>
                {pos.placeLabel(o)} · {pos.staffName(o.waiter_id)}
              </T>
              <T color={C.muted}>{hhmm(o.opened_at)}</T>
              <T w="semibold" style={{ width: 110, textAlign: 'right' }}>
                {dh(o.status === 'open' ? pos.totals(o.id).totalCents : o.total_cents)}
              </T>
              {o.status === 'open' ? <Badge text="En cours" tone="amber" /> : <Badge text="Payé" tone="ok" />}
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={{ width: 420, backgroundColor: C.surface, borderLeftWidth: 1, borderLeftColor: C.line, padding: 24, gap: 14 }}>
        {order ? (
          <>
            <T w="bold" size={22}>
              Ticket {order.number}
            </T>
            <T color={C.muted}>
              {pos.placeLabel(order)} · {pos.staffName(order.waiter_id)} · {hhmm(order.opened_at)}
            </T>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
              {pos.ticket(order.id).map((l) => (
                <Row key={l.line.id} style={{ alignItems: 'flex-start', opacity: l.line.status === 'voided' ? 0.45 : 1 }}>
                  <T w="bold" style={{ width: 30 }}>
                    {l.line.quantity}
                  </T>
                  <View style={{ flex: 1 }}>
                    <T w="semibold">{l.line.name}</T>
                    {l.details.length ? (
                      <T size={12} color={C.muted}>
                        {l.details.join(' · ')}
                      </T>
                    ) : null}
                  </View>
                  <T>{l.line.status === 'voided' ? 'annulé' : l.line.status === 'comp' ? 'offert' : amount(l.totalCents)}</T>
                </Row>
              ))}
              <Card style={{ marginTop: 8, backgroundColor: C.surface2 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T w="semibold">Total</T>
                  <T w="bold" size={20}>
                    {dh(pos.totals(order.id).totalCents)}
                  </T>
                </Row>
                {pos.store.where('payments', (p) => p.order_id === order.id).map((p) => (
                  <Row key={p.id} style={{ justifyContent: 'space-between' }}>
                    <T color={C.muted}>{methods.get(String(p.payment_method_id)) ?? 'Paiement'}</T>
                    <T color={C.muted}>{dh(Number(p.amount_cents))}</T>
                  </Row>
                ))}
              </Card>
            </ScrollView>
            {order.status === 'open' ? (
              <Btn kind="primary" height={56} label="Ouvrir le ticket" onPress={() => router.push(`/commande/${order.id}`)} />
            ) : (
              <Btn kind="accent" height={56} label="Imprimer un duplicata" onPress={() => void guard((a) => pos.printDuplicate(user!.id, order.id, a).then((n) => n), 'Duplicata imprimé')} />
            )}
          </>
        ) : (
          <T color={C.muted}>Choisissez un ticket pour voir son détail.</T>
        )}
      </View>
    </View>
  );
}
