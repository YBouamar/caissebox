import { splitEqually } from '@caissebox/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { OrderRow, PaymentMethodRow } from '../../../core/pos';
import { usePosContext } from '../../../services/CaisseProvider';
import { AmountPad } from '../../../ui/AmountPad';
import { useGuarded } from '../../../ui/Approval';
import { CustomerSheet } from '../../../ui/CustomerSheet';
import { amount, dh } from '../../../ui/format';
import { Btn, Card, Icon, ICONS, Row, T } from '../../../ui/kit';
import { C } from '../../../ui/theme';

type Mode = 'all' | 'items' | 'equal';

/**
 * Encaissement avec séparation : tout, par articles (chacun paie ce qu'il a pris)
 * ou en parts égales. Plusieurs modes de paiement possibles sur un même ticket.
 */
export default function Paiement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { pos, user } = usePosContext();
  const guard = useGuarded();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('all');
  const [parts, setParts] = useState(2);
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [paidQty, setPaidQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethodRow | null>(null);
  const [tendered, setTendered] = useState(0);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [done, setDone] = useState<{ change: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [partNo, setPartNo] = useState(1);

  const order = pos.store.get<OrderRow>('orders', id);
  if (!order || !user) return null;
  const ticket = pos.ticket(order.id).filter((l) => l.line.status !== 'voided' && l.line.status !== 'comp');
  const totals = pos.totals(order.id);
  const remaining = totals.totalCents - pos.paidCents(order.id);
  const methods = pos.paymentMethods();
  const lineValue = (lineId: string) => {
    const l = ticket.find((x) => x.line.id === lineId)!;
    // Part de remise répartie au prorata pour que la somme des parts retombe sur le total.
    return totals.subtotalCents ? Math.round((l.totalCents * totals.totalCents) / totals.subtotalCents) : 0;
  };

  let due = remaining;
  if (mode === 'items') {
    due = 0;
    let everything = true;
    for (const l of ticket) {
      const already = paidQty[l.line.id] ?? 0;
      const q = selection[l.line.id] ?? 0;
      const value = lineValue(l.line.id);
      if (q + already < l.line.quantity) everything = false;
      if (!q) continue;
      due += q + already === l.line.quantity ? value - Math.round((value * already) / l.line.quantity) : Math.round((value * q) / l.line.quantity);
    }
    // Dernière part : on solde exactement le reste, arrondis compris.
    due = everything ? remaining : Math.min(due, remaining);
  } else if (mode === 'equal') {
    const left = Math.max(1, parts - (partNo - 1));
    due = splitEqually(remaining, left)[0] ?? remaining;
  }

  const isCash = method?.kind === 'cash';
  const change = isCash && tendered > due ? tendered - due : 0;
  const canPay = !!method && due > 0 && (!isCash || tendered === 0 || tendered >= due) && (method.kind !== 'customer_credit' || !!customerId);

  const pay = async () => {
    if (!method) return;
    setBusy(true);
    const ok = await guard(async () => {
      const r = await pos.pay(user.id, order.id, [
        { methodId: method.id, amountCents: due, tenderedCents: isCash ? tendered || due : undefined, customerId: method.kind === 'customer_credit' ? customerId : null, splitLabel: mode === 'all' ? null : `Part ${partNo}` },
      ]);
      if (r.closed) setDone({ change: r.changeCents });
      else {
        if (mode === 'items') {
          setPaidQty((p) => {
            const n = { ...p };
            for (const [k, v] of Object.entries(selection)) n[k] = (n[k] ?? 0) + v;
            return n;
          });
          setSelection({});
        }
        setPartNo((n) => n + 1);
        setTendered(0);
        setMethod(null);
      }
    });
    setBusy(false);
    void ok;
  };

  if (done) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Card style={{ width: 560, alignItems: 'center', padding: 36, gap: 16 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.okSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon d="M5 12l5 5L20 7" size={36} color={C.okInk} stroke={2.4} />
          </View>
          <T w="bold" size={26}>
            Ticket {order.number} réglé
          </T>
          {done.change > 0 ? (
            <View style={{ alignItems: 'center', gap: 4 }}>
              <T color={C.muted}>Monnaie à rendre</T>
              <T w="bold" size={48}>
                {dh(done.change)}
              </T>
            </View>
          ) : (
            <T color={C.muted}>Le ticket client part à l’impression.</T>
          )}
          <Row style={{ width: '100%' }}>
            <Btn flex label="Duplicata" onPress={() => void guard((a) => pos.printDuplicate(user.id, order.id, a), 'Duplicata imprimé')} />
            <Btn flex kind="primary" label="Terminé" onPress={() => router.replace(order.order_type === 'dine_in' ? '/salle' : '/emporter')} />
          </Row>
        </Card>
      </View>
    );
  }

  const customer = customerId ? pos.store.get('customers', customerId) : null;

  return (
    <View style={{ flex: 1, flexDirection: 'row', padding: 20, gap: 20 }}>
      <Card style={{ flex: 1, padding: 0, gap: 0 }}>
        <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: C.line, gap: 4 }}>
          <T w="bold" size={20}>
            {pos.placeLabel(order)} · {dh(totals.totalCents)}
          </T>
          <T size={13} color={C.muted}>
            {mode === 'items' ? 'Cochez ce que paie cette personne' : `Ticket n° ${order.number}`}
          </T>
        </View>
        <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
          {ticket.map((l) => {
            const paidQ = paidQty[l.line.id] ?? 0;
            const left = l.line.quantity - paidQ;
            const sel = selection[l.line.id] ?? 0;
            const on = sel > 0;
            return (
              <Pressable
                key={l.line.id}
                disabled={mode !== 'items' || left === 0}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: mode !== 'items' || left === 0 }}
                onPress={() => setSelection((s) => ({ ...s, [l.line.id]: sel >= left ? 0 : sel + 1 }))}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: on ? C.amberSoft : 'transparent', opacity: left === 0 ? 0.4 : 1 }}
              >
                {mode === 'items' ? (
                  <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: on ? C.navy : C.input, backgroundColor: on ? C.navy : C.surface, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? (
                      <T w="bold" size={12} color="#FFFFFF">
                        {sel}
                      </T>
                    ) : null}
                  </View>
                ) : null}
                <T w="bold" style={{ width: 28 }}>
                  {left}×
                </T>
                <View style={{ flex: 1 }}>
                  <T w="semibold" size={15}>
                    {l.line.name}
                  </T>
                  {l.details.length ? (
                    <T size={12} color={C.muted}>
                      {l.details.join(' · ')}
                    </T>
                  ) : null}
                </View>
                <T w="semibold">{amount(l.totalCents)}</T>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: C.line, gap: 6 }}>
          {totals.orderDiscountCents ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <T color={C.muted}>Remise</T>
              <T color={C.muted}>−{dh(totals.orderDiscountCents)}</T>
            </Row>
          ) : null}
          <Row style={{ justifyContent: 'space-between' }}>
            <T w="semibold">Reste à encaisser</T>
            <T w="bold" size={20}>
              {dh(remaining)}
            </T>
          </Row>
        </View>
      </Card>

      <View style={{ width: 520, gap: 14 }}>
        <Row>
          <Pressable accessibilityLabel="Retour au ticket" onPress={() => router.back()} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
            <Icon d={ICONS.back} />
          </Pressable>
          <T w="bold" size={24} style={{ flex: 1 }}>
            Encaisser{partNo > 1 ? ` · part ${partNo}` : ''}
          </T>
          <View style={{ flexDirection: 'row', backgroundColor: C.line, borderRadius: 12, padding: 3 }}>
            {(
              [
                ['all', 'Tout'],
                ['items', 'Par articles'],
                ['equal', 'Parts égales'],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => { setMode(m); setSelection({}); }} style={{ height: 40, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', backgroundColor: mode === m ? C.surface : 'transparent' }}>
                <T w={mode === m ? 'bold' : 'semibold'} size={13} color={mode === m ? C.ink : C.muted}>
                  {label}
                </T>
              </Pressable>
            ))}
          </View>
        </Row>
        {mode === 'equal' ? (
          <Row>
            <T color={C.muted}>Nombre de parts</T>
            <View style={{ flex: 1 }} />
            <Btn label="−" onPress={() => setParts((p) => Math.max(partNo, p - 1))} style={{ width: 52 }} />
            <T w="bold" size={20} style={{ width: 40, textAlign: 'center' }}>
              {parts}
            </T>
            <Btn label="+" onPress={() => setParts((p) => Math.min(20, p + 1))} style={{ width: 52 }} />
          </Row>
        ) : null}
        <Card style={{ backgroundColor: C.navy, borderColor: C.navy }}>
          <T color={C.navInk}>À payer maintenant</T>
          <T w="bold" size={40} color="#FFFFFF">
            {dh(due)}
          </T>
        </Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {methods.map((m) => (
            <Pressable
              key={m.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: method?.id === m.id }}
              onPress={() => {
                setMethod(m);
                setTendered(0);
                if (m.kind === 'customer_credit' && !customerId) setPickCustomer(true);
              }}
              style={{ width: '48.8%', height: 60, borderRadius: 14, borderWidth: method?.id === m.id ? 2 : 1, borderColor: method?.id === m.id ? C.navy : C.line, backgroundColor: method?.id === m.id ? C.navySoft : C.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              <T w="semibold" size={16}>
                {m.label}
              </T>
            </Pressable>
          ))}
        </View>
        {isCash ? (
          <View style={{ gap: 8 }}>
            <Row>
              {[due, Math.ceil(due / 1000) * 1000, Math.ceil(due / 5000) * 5000, Math.ceil(due / 10000) * 10000, 20000]
                .filter((v, i, a) => v >= due && a.indexOf(v) === i)
                .slice(0, 4)
                .map((v) => (
                  <Btn key={v} flex label={v === due ? 'Compte juste' : `${amount(v)}`} height={44} textSize={13} onPress={() => setTendered(v)} />
                ))}
            </Row>
            <AmountPad cents={tendered} onChange={setTendered} label={change ? `Montant reçu · monnaie à rendre ${dh(change)}` : 'Montant reçu (facultatif)'} keyHeight={44} />
          </View>
        ) : method?.kind === 'customer_credit' ? (
          <Btn label={customer ? `Ardoise de ${customer.full_name} · solde ${dh(pos.customerBalance(customer.id))}` : 'Choisir le client'} onPress={() => setPickCustomer(true)} height={56} />
        ) : null}
        <View style={{ flex: 1 }} />
        <Btn kind="accent" height={64} textSize={18} disabled={!canPay} busy={busy} label={method ? `Encaisser ${dh(due)}` : 'Choisissez un mode de paiement'} onPress={pay} />
      </View>
      <CustomerSheet visible={pickCustomer} onClose={() => setPickCustomer(false)} onPick={(cid) => { setCustomerId(cid === pos.defaultCustomer().id ? null : cid); setPickCustomer(false); }} />
    </View>
  );
}
