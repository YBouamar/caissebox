import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ItemRow, NewLine, Pos } from '../core/pos';
import { amount } from './format';
import { Btn, Icon, ICONS, Row, Sheet, T } from './kit';
import { C } from './theme';

/**
 * Fenêtre de choix avant l'ajout : options et suppléments d'un article, ou
 * étapes d'un menu composé. Le bouton « Ajouter » reste grisé tant qu'un choix
 * obligatoire manque.
 */
export function ItemChooser({ pos, item, onClose, onAdd }: { pos: Pos; item: ItemRow | null; onClose: () => void; onAdd: (line: NewLine) => void }) {
  const [options, setOptions] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);

  useEffect(() => {
    setOptions(new Set());
    setPicks({});
    setQty(1);
  }, [item?.id]);

  if (!item) return null;
  const groups = pos.optionGroups(item.id);
  const steps = item.kind === 'menu' ? pos.menuSteps(item.id) : [];

  const toggleOption = (groupId: string, optionId: string, max: number) => {
    setOptions((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId);
      else {
        const inGroup = groups.find((g) => g.group.id === groupId)!.options.filter((o) => next.has(o.id));
        if (max === 1) inGroup.forEach((o) => next.delete(o.id));
        else if (inGroup.length >= max) return prev;
        next.add(optionId);
      }
      return next;
    });
  };

  const togglePick = (stepId: string, itemId: string, max: number) => {
    setPicks((prev) => {
      const cur = prev[stepId] ?? [];
      if (cur.includes(itemId)) return { ...prev, [stepId]: cur.filter((x) => x !== itemId) };
      if (max === 1) return { ...prev, [stepId]: [itemId] };
      if (cur.length >= max) return prev;
      return { ...prev, [stepId]: [...cur, itemId] };
    });
  };

  const missing = [
    ...groups.filter((g) => g.options.filter((o) => options.has(o.id)).length < g.group.min_select).map((g) => g.group.name),
    ...steps.filter((s) => (picks[s.step.id]?.length ?? 0) < s.step.min_select).map((s) => s.step.name),
  ];
  const extra =
    groups.reduce((s, g) => s + g.options.filter((o) => options.has(o.id)).reduce((t, o) => t + Number(o.extra_cents), 0), 0) +
    steps.reduce((s, st) => s + st.choices.filter((c) => picks[st.step.id]?.includes(c.item.id)).reduce((t, c) => t + Number(c.choice.extra_cents), 0), 0);
  const total = (pos.priceOf(item) + extra) * qty;

  return (
    <Sheet
      visible
      onClose={onClose}
      title={item.name}
      width={760}
      footer={
        <>
          <Row>
            <Pressable accessibilityLabel="Moins" onPress={() => setQty((q) => Math.max(1, q - 1))} style={qtyBtn}>
              <Icon d={ICONS.minus} />
            </Pressable>
            <T w="bold" size={22} style={{ minWidth: 36, textAlign: 'center' }}>
              {qty}
            </T>
            <Pressable accessibilityLabel="Plus" onPress={() => setQty((q) => Math.min(99, q + 1))} style={qtyBtn}>
              <Icon d={ICONS.add} />
            </Pressable>
          </Row>
          <Btn
            flex
            kind="accent"
            height={60}
            disabled={missing.length > 0}
            label={missing.length ? `À choisir : ${missing.join(', ')}` : `Ajouter · ${amount(total)} DH`}
            onPress={() =>
              onAdd({
                itemId: item.id,
                quantity: qty,
                optionIds: [...options],
                menuChoices: Object.entries(picks).flatMap(([stepId, ids]) => ids.map((itemId) => ({ stepId, itemId }))),
              })
            }
          />
        </>
      }
    >
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 18 }}>
        {steps.map(({ step, choices }) => (
          <View key={step.id} style={{ gap: 10 }}>
            <Row>
              <T w="bold" size={17} style={{ flex: 1 }}>
                {step.name}
              </T>
              <T size={13} color={C.muted}>
                {step.min_select > 0 ? 'Obligatoire' : 'Facultatif'} · {step.max_select > 1 ? `${step.max_select} au maximum` : '1 choix'}
              </T>
            </Row>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {choices.map(({ choice, item: it }) => {
                const on = picks[step.id]?.includes(it.id);
                const out = !pos.isAvailable(it);
                return (
                  <Pressable
                    key={choice.id}
                    disabled={out}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!on, disabled: out }}
                    onPress={() => togglePick(step.id, it.id, step.max_select)}
                    style={[choiceBox, on && choiceOn, out && { opacity: 0.4 }]}
                  >
                    <T w="semibold" size={15} color={on ? '#FFFFFF' : C.ink}>
                      {it.name}
                    </T>
                    <T size={13} color={on ? C.navInk : C.muted}>
                      {out ? 'Rupture' : Number(choice.extra_cents) ? `+${amount(choice.extra_cents)} DH` : 'Inclus'}
                    </T>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
        {groups.map(({ group, options: opts }) => (
          <View key={group.id} style={{ gap: 10 }}>
            <Row>
              <T w="bold" size={17} style={{ flex: 1 }}>
                {group.name}
              </T>
              <T size={13} color={C.muted}>
                {group.min_select > 0 ? 'Obligatoire' : 'Facultatif'} · {group.max_select > 1 ? `${group.max_select} au maximum` : '1 choix'}
              </T>
            </Row>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {opts.map((o) => {
                const on = options.has(o.id);
                return (
                  <Pressable key={o.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggleOption(group.id, o.id, group.max_select)} style={[choiceBox, on && choiceOn]}>
                    <T w="semibold" size={15} color={on ? '#FFFFFF' : C.ink}>
                      {o.name}
                    </T>
                    <T size={13} color={on ? C.navInk : C.muted}>
                      {Number(o.extra_cents) ? `+${amount(o.extra_cents)} DH` : 'Inclus'}
                    </T>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const qtyBtn = { width: 52, height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: C.input, alignItems: 'center' as const, justifyContent: 'center' as const };
const choiceBox = { minWidth: 160, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, gap: 2 };
const choiceOn = { backgroundColor: C.navy, borderColor: C.navy };
