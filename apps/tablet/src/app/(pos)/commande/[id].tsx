import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { ItemRow, OrderRow, TicketLine } from '../../../core/pos';
import { usePosContext } from '../../../services/CaisseProvider';
import { AmountPad } from '../../../ui/AmountPad';
import { useGuarded } from '../../../ui/Approval';
import { amount, dh } from '../../../ui/format';
import { CustomerSheet } from '../../../ui/CustomerSheet';
import { ItemChooser } from '../../../ui/ItemChooser';
import { Badge, Btn, Icon, ICONS, Row, Sheet, T } from '../../../ui/kit';
import { C, F } from '../../../ui/theme';

const STATUS: Record<TicketLine['line']['status'], { text: string; tone: 'navy' | 'amber' | 'muted' | 'ok' }> = {
  draft: { text: 'Nouveau', tone: 'amber' },
  sent: { text: 'Envoyé', tone: 'muted' },
  comp: { text: 'Offert', tone: 'ok' },
  voided: { text: 'Annulé', tone: 'muted' },
};

/** Prise de commande : carte à gauche, ticket en cours à droite. */
export default function Commande() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { pos, user, toast } = usePosContext();
  const guard = useGuarded();
  const router = useRouter();
  const families = pos.families();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [chooser, setChooser] = useState<ItemRow | null>(null);
  const [lineSel, setLineSel] = useState<TicketLine | null>(null);
  const [sheet, setSheet] = useState<null | 'discount' | 'more' | 'move' | 'merge' | 'customer' | 'note'>(null);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const order = pos.store.get<OrderRow>('orders', id);
  const family = families.find((f) => f.id === familyId) ?? families[0];
  const items = search ? pos.search(search) : family ? pos.items(family.id) : [];
  const ticket = order ? pos.ticket(order.id) : [];
  const totals = useMemo(() => (order ? pos.totals(order.id) : null), [order, pos, ticket.length, pos.store.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const paid = order ? pos.paidCents(order.id) : 0;
  const drafts = order ? pos.draftCount(order.id) : 0;
  const auto = pos.kitchenSendMode() === 'auto';

  if (!order || !user) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <T w="bold" size={20}>
          Ticket introuvable
        </T>
        <Btn label="Retour à la salle" onPress={() => router.replace('/salle')} />
      </View>
    );
  }
  const closed = order.status !== 'open';
  const customer = pos.store.get('customers', order.customer_id);

  const add = (item: ItemRow) => {
    if (closed) return;
    if (!pos.isAvailable(item)) return toast(`${item.name} est en rupture`, 'error');
    if (pos.needsChoices(item)) return setChooser(item);
    void guard(() => pos.addLine(user.id, order.id, { itemId: item.id }));
  };

  const send = async () => {
    setBusy(true);
    await guard(async () => {
      const r = await pos.send(user.id, order.id);
      toast(r.lines ? `${r.lines} ligne(s) envoyée(s)${r.printers ? ` vers ${r.printers} imprimante(s)` : ''}` : 'Rien de nouveau à envoyer', 'ok');
    });
    setBusy(false);
  };

  const leave = async () => {
    // Envoi automatique : on part en préparation en quittant le ticket.
    if (auto && drafts > 0) await send();
    if (!ticket.some((l) => l.line.status !== 'voided') && paid === 0 && order.status === 'open') await pos.voidEmptyOrder(order.id).catch(() => undefined);
    router.replace(order.order_type === 'dine_in' ? '/salle' : '/emporter');
  };

  const title = pos.placeLabel(order);

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ flex: 1, padding: 20, gap: 16 }}>
        <Row>
          <Pressable accessibilityLabel="Retour" onPress={leave} style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }}>
            <Icon d={ICONS.back} />
          </Pressable>
          <View style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 }}>
            <Icon d={ICONS.search} size={20} color={C.muted} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Rechercher un article" placeholderTextColor={C.faint} style={{ flex: 1, fontFamily: F.regular, fontSize: 16, color: C.ink }} />
            {search ? (
              <Pressable onPress={() => setSearch('')} accessibilityLabel="Effacer la recherche">
                <Icon d={ICONS.close} size={18} color={C.muted} />
              </Pressable>
            ) : null}
          </View>
        </Row>
        {!search ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {families.map((f) => {
              const on = f.id === family?.id;
              return (
                <Pressable
                  key={f.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setFamilyId(f.id)}
                  style={{ height: 48, paddingHorizontal: 16, borderRadius: 12, borderWidth: on ? 0 : 1, borderColor: C.line, backgroundColor: on ? C.navy : C.surface, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                >
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: f.color }} />
                  <T w="semibold" size={15} color={on ? '#FFFFFF' : C.ink}>
                    {f.name}
                  </T>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 20 }}>
          {items.length === 0 ? <T color={C.muted}>{search ? 'Aucun article trouvé.' : 'Aucun article dans cette famille.'}</T> : null}
          {items.map((i) => {
            const out = !pos.isAvailable(i);
            const choices = pos.needsChoices(i);
            return (
              <Pressable
                key={i.id}
                accessibilityRole="button"
                accessibilityLabel={`${i.name}, ${amount(pos.priceOf(i))} DH${out ? ', en rupture' : ''}`}
                onPress={() => add(i)}
                style={({ pressed }) => ({
                  width: '23.8%',
                  height: 104,
                  borderRadius: 16,
                  backgroundColor: out ? C.surface2 : pressed ? C.navySoft : C.surface,
                  borderWidth: 1,
                  borderColor: C.line,
                  padding: 14,
                  justifyContent: 'space-between',
                })}
              >
                <T w="semibold" size={17} color={out ? C.faint : C.ink} numberOfLines={2}>
                  {i.name}
                </T>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T w="medium" size={15} color={out ? C.faint : C.ink}>
                    {amount(pos.priceOf(i))} DH
                  </T>
                  {out ? <Badge text="Rupture" tone="muted" /> : i.kind === 'menu' ? <Badge text="Menu" tone="amber" /> : choices ? <Badge text="Options" /> : null}
                </Row>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ width: 420, backgroundColor: C.surface, borderLeftWidth: 1, borderLeftColor: C.line }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.line, gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <T w="bold" size={24} numberOfLines={1}>
              {title}
            </T>
            <T size={13} color={C.muted} numberOfLines={1}>
              Ticket n° {order.number} · {pos.staffName(order.waiter_id)}
              {order.covers ? ` · ${order.covers} couverts` : ''}
              {order.call_number ? ` · appel ${order.call_number}` : ''}
            </T>
          </View>
          <Btn label={customer && !customer.is_default ? String(customer.full_name) : 'Client divers'} height={44} textSize={14} onPress={() => setSheet('customer')} disabled={closed} />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 8 }}>
          {ticket.length === 0 ? (
            <T color={C.muted} style={{ paddingVertical: 24, textAlign: 'center' }}>
              Touchez un article pour l’ajouter.
            </T>
          ) : null}
          {ticket.map((l) => {
            const st = STATUS[l.line.status];
            const voided = l.line.status === 'voided';
            return (
              <Pressable key={l.line.id} onPress={() => !closed && !voided && setLineSel(l)} style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line2, opacity: voided ? 0.45 : 1 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: C.navySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <T w="bold">{l.line.quantity}</T>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T w="semibold" size={15} style={voided ? { textDecorationLine: 'line-through' } : undefined}>
                    {l.line.name}
                  </T>
                  {l.details.length ? (
                    <T size={12} color={C.muted}>
                      {l.details.join(' · ')}
                    </T>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <T w="semibold" size={15}>
                    {l.line.status === 'comp' ? '0,00' : amount(l.totalCents)}
                  </T>
                  <Badge text={st.text} tone={st.tone} />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20, borderTopWidth: 1, borderTopColor: C.line, gap: 12 }}>
          {totals?.taxes.map((t) => (
            <Row key={t.rateBp} style={{ justifyContent: 'space-between' }}>
              <T size={13} color={C.muted}>
                Dont TVA {t.rateBp / 100} %
              </T>
              <T size={13} color={C.muted}>
                {dh(t.tva)}
              </T>
            </Row>
          ))}
          {totals && totals.orderDiscountCents > 0 ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <T size={13} color={C.muted}>
                Remise
              </T>
              <T size={13} color={C.muted}>
                −{dh(totals.orderDiscountCents)}
              </T>
            </Row>
          ) : null}
          {paid > 0 ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <T size={13} color={C.muted}>
                Déjà payé
              </T>
              <T size={13} color={C.muted}>
                {dh(paid)}
              </T>
            </Row>
          ) : null}
          <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <T w="semibold" size={16}>
              {paid > 0 ? 'Reste dû' : 'Total'}
            </T>
            <T w="bold" size={30}>
              {dh((totals?.totalCents ?? 0) - paid)}
            </T>
          </Row>
          <Row gap={8}>
            <Btn flex label="Remise" height={44} textSize={13} disabled={closed} onPress={() => { setDiscount(totals?.orderDiscountCents ?? 0); setSheet('discount'); }} />
            <Btn flex label="Addition" height={44} textSize={13} disabled={closed || !ticket.length} onPress={() => void guard(() => pos.printReceipt(user.id, order.id, { proForma: true }), 'Addition imprimée')} />
            <Btn flex label="Plus" height={44} textSize={13} disabled={closed} onPress={() => setSheet('more')} />
          </Row>
          <Row gap={8}>
            {auto ? null : <Btn flex kind="accent" height={60} textSize={16} busy={busy} disabled={closed || drafts === 0} label={drafts ? `Envoyer (${drafts} ligne${drafts > 1 ? 's' : ''})` : 'Envoyer'} onPress={send} />}
            <Btn flex kind="primary" height={60} textSize={16} disabled={closed || !totals || totals.totalCents - paid <= 0} label="Encaisser" onPress={() => router.push(`/paiement/${order.id}`)} />
          </Row>
        </View>
      </View>

      <ItemChooser
        pos={pos}
        item={chooser}
        onClose={() => setChooser(null)}
        onAdd={(line) => {
          setChooser(null);
          void guard(() => pos.addLine(user.id, order.id, line));
        }}
      />

      {/* Actions sur une ligne */}
      <Sheet visible={!!lineSel} onClose={() => setLineSel(null)} title={lineSel?.line.name ?? ''} width={560}>
        {lineSel?.line.status === 'draft' ? (
          <Row>
            <Btn flex label="− 1" height={60} textSize={20} onPress={() => { void guard(() => pos.setQuantity(order.id, lineSel.line.id, lineSel.line.quantity - 1)); setLineSel(null); }} />
            <T w="bold" size={26} style={{ minWidth: 60, textAlign: 'center' }}>
              {lineSel.line.quantity}
            </T>
            <Btn flex label="+ 1" height={60} textSize={20} onPress={() => { void guard(() => pos.setQuantity(order.id, lineSel.line.id, lineSel.line.quantity + 1)); setLineSel(null); }} />
          </Row>
        ) : (
          <T color={C.muted}>Ligne déjà envoyée en préparation : la quantité ne change plus. Pour l’enlever, utilisez « Annuler » (validation manager).</T>
        )}
        <Btn label="Note pour la cuisine" onPress={() => { setNote(lineSel?.line.note ?? ''); setSheet('note'); }} />
        <Row>
          <Btn flex label="Offrir" onPress={() => { const l = lineSel!; setLineSel(null); void guard((a) => pos.compLine(user.id, order.id, l.line.id, a), 'Article offert'); }} />
          <Btn flex kind="danger" label={lineSel?.line.status === 'draft' ? 'Supprimer' : 'Annuler'} onPress={() => { const l = lineSel!; setLineSel(null); void guard((a) => pos.voidLine(user.id, order.id, l.line.id, a), l.line.status === 'draft' ? undefined : 'Ligne annulée'); }} />
        </Row>
      </Sheet>

      <Sheet visible={sheet === 'note'} onClose={() => setSheet(null)} title="Note pour la cuisine" width={560} footer={<Btn flex kind="accent" label="Enregistrer" onPress={() => { const l = lineSel; setSheet(null); setLineSel(null); if (l) void guard(() => pos.setNote(order.id, l.line.id, note)); }} />}>
        <TextInput value={note} onChangeText={setNote} autoFocus placeholder="Bien cuit, sans oignon…" placeholderTextColor={C.faint} style={{ height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 16, color: C.ink }} />
        <Row style={{ flexWrap: 'wrap' }}>
          {['Sans sucre', 'Bien cuit', 'Sans oignon', 'À part', 'Allergie', 'Urgent'].map((q) => (
            <Btn key={q} label={q} height={40} textSize={13} onPress={() => setNote((n) => (n ? `${n}, ${q.toLowerCase()}` : q))} />
          ))}
        </Row>
      </Sheet>

      <Sheet visible={sheet === 'discount'} onClose={() => setSheet(null)} title="Remise sur le ticket" width={520} footer={<><Btn flex label="Retirer" onPress={() => { setSheet(null); void guard((a) => pos.setDiscount(user.id, order.id, 0, a)); }} /><Btn flex kind="accent" label="Appliquer" onPress={() => { setSheet(null); void guard((a) => pos.setDiscount(user.id, order.id, discount, a), 'Remise appliquée'); }} /></>}>
        <Row>
          {[5, 10, 15, 20].map((p) => (
            <Btn key={p} flex label={`${p} %`} onPress={() => setDiscount(Math.round(((totals?.subtotalCents ?? 0) * p) / 100))} />
          ))}
        </Row>
        <AmountPad cents={discount} onChange={setDiscount} keyHeight={52} />
      </Sheet>

      <Sheet visible={sheet === 'more'} onClose={() => setSheet(null)} title="Autres actions" width={520}>
        {order.order_type === 'dine_in' ? <Btn label="Changer de table" onPress={() => setSheet('move')} height={56} /> : null}
        <Btn label="Fusionner avec un autre ticket" onPress={() => setSheet('merge')} height={56} />
        <Btn
          kind="danger"
          label="Annuler le ticket vide"
          height={56}
          onPress={() => {
            setSheet(null);
            void guard(async () => {
              await pos.voidEmptyOrder(order.id);
              router.replace('/salle');
            }, 'Ticket annulé');
          }}
        />
      </Sheet>

      <Sheet visible={sheet === 'move'} onClose={() => setSheet(null)} title="Nouvelle table" width={760}>
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 14 }}>
          {pos.zones().map((z) => (
            <View key={z.id} style={{ gap: 8 }}>
              <T w="semibold" color={C.muted}>
                {z.name}
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {pos.tables(z.id).map((t) => {
                  const busyT = !!pos.orderForTable(t.id);
                  return <Btn key={t.id} label={t.label} disabled={busyT} style={{ width: 96 }} onPress={() => { setSheet(null); void guard(() => pos.updateOrder(order.id, { tableId: t.id }), `Ticket déplacé en ${t.label}`); }} />;
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'merge'} onClose={() => setSheet(null)} title="Fusionner vers" width={640}>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
          {pos.openOrders().filter((o) => o.id !== order.id).map((o) => (
            <Btn key={o.id} label={`${pos.placeLabel(o)} · ${o.number} · ${dh(pos.totals(o.id).totalCents)}`} height={56} onPress={() => { setSheet(null); void guard(async () => { await pos.mergeInto(user.id, order.id, o.id); router.replace(`/commande/${o.id}`); }, 'Tickets fusionnés'); }} />
          ))}
          {pos.openOrders().length <= 1 ? <T color={C.muted}>Aucun autre ticket ouvert.</T> : null}
        </ScrollView>
      </Sheet>

      <CustomerSheet visible={sheet === 'customer'} onClose={() => setSheet(null)} onPick={(cid) => { setSheet(null); void guard(() => pos.updateOrder(order.id, { customerId: cid })); }} />
    </View>
  );
}
