import { useRouter } from 'expo-router';
import { useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, View } from 'react-native';
import { TableRow } from '../../core/pos';
import { usePosContext } from '../../services/CaisseProvider';
import { useGuarded } from '../../ui/Approval';
import { dh } from '../../ui/format';
import { Btn, Card, Chip, Row, Sheet, T } from '../../ui/kit';
import { C } from '../../ui/theme';

/** Plan de salle : état des tables (libre, occupée avec montant), ouverture d'un ticket. */
export default function Salle() {
  const { pos, user } = usePosContext();
  const router = useRouter();
  const guard = useGuarded();
  const zones = pos.zones();
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 900, h: 600 });
  const [coversFor, setCoversFor] = useState<TableRow | null>(null);
  const zone = zones.find((z) => z.id === zoneId) ?? zones[0];
  const day = pos.currentDay();

  if (!day) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <Card style={{ width: 560, alignItems: 'flex-start' }}>
          <T w="bold" size={24}>
            La journée n’est pas ouverte
          </T>
          <T color={C.muted}>Un manager ouvre la journée depuis l’écran Caisse, en saisissant le fond de caisse.</T>
          <Btn label="Aller à la caisse" kind="primary" onPress={() => router.replace('/caisse')} />
        </Card>
      </View>
    );
  }

  const tables = zone ? pos.tables(zone.id) : [];
  const maxX = Math.max(1, ...tables.map((t) => t.x + t.w));
  const maxY = Math.max(1, ...tables.map((t) => t.y + t.h));
  const scale = Math.min(1.6, (box.w - 32) / maxX, (box.h - 32) / maxY);
  const occupied = (t: TableRow) => pos.orderForTable(t.id);

  const openTable = async (t: TableRow, covers?: number) => {
    const existing = pos.orderForTable(t.id);
    if (existing) return router.push(`/commande/${existing.id}`);
    await guard(async () => {
      const o = await pos.createOrder(user!.id, { type: 'dine_in', tableId: t.id, covers: covers ?? null });
      router.push(`/commande/${o.id}`);
    });
  };

  const counter = async () => {
    await guard(async () => {
      const o = await pos.createOrder(user!.id, { type: 'counter' });
      router.push(`/commande/${o.id}`);
    });
  };

  return (
    <View style={{ flex: 1, padding: 20, gap: 16 }}>
      <Row>
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0, maxWidth: '60%' }}>
          {zones.map((z) => (
            <Chip key={z.id} label={`${z.name} · ${pos.tables(z.id).length}`} active={z.id === zone?.id} onPress={() => setZoneId(z.id)} />
          ))}
        </ScrollView>
        <View style={{ flex: 1 }} />
        <Row gap={16}>
          <Legend color={C.surface} border={C.input} label="Libre" />
          <Legend color={C.navy} label="Occupée" />
        </Row>
        <Btn label="+ Ticket comptoir" kind="accent" onPress={counter} />
      </Row>
      <View
        style={{ flex: 1, backgroundColor: C.surface2, borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: 'hidden' }}
        onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {tables.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <T color={C.muted}>Aucune table dans cette zone. Le plan se dessine depuis le back-office, rubrique Salle et tables.</T>
          </View>
        ) : null}
        {tables.map((t) => {
          const o = occupied(t);
          const total = o ? pos.totals(o.id).totalCents : 0;
          const w = t.w * scale;
          const h = t.h * scale;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              accessibilityLabel={o ? `Table ${t.label}, occupée, ${dh(total)}` : `Table ${t.label}, libre, ${t.seats} places`}
              onPress={() => (o ? openTable(t) : setCoversFor(t))}
              onLongPress={() => void openTable(t)}
              style={({ pressed }) => ({
                position: 'absolute',
                left: 16 + t.x * scale,
                top: 16 + t.y * scale,
                width: w,
                height: h,
                borderRadius: t.shape === 'round' ? Math.min(w, h) / 2 : 14,
                backgroundColor: o ? C.navy : C.surface,
                borderWidth: o ? 0 : 1.5,
                borderColor: C.input,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <T w="bold" size={Math.max(14, Math.min(22, 18 * scale))} color={o ? '#FFFFFF' : C.ink}>
                {t.label}
              </T>
              <T size={12} color={o ? C.navInk : C.muted}>
                {o ? `${pos.staffName(o.waiter_id)}${o.covers ? ` · ${o.covers} couv.` : ''}` : `${t.seats} places`}
              </T>
              {o ? (
                <T w="semibold" size={13} color={C.amber}>
                  {dh(total)}
                </T>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Sheet visible={!!coversFor} onClose={() => setCoversFor(null)} title={`Table ${coversFor?.label ?? ''} · couverts`} width={520}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <Btn
              key={n}
              label={String(n)}
              height={64}
              textSize={22}
              style={{ width: 104 }}
              onPress={() => {
                const t = coversFor!;
                setCoversFor(null);
                void openTable(t, n);
              }}
            />
          ))}
        </View>
        <Btn
          label="Sans préciser"
          kind="ghost"
          onPress={() => {
            const t = coversFor!;
            setCoversFor(null);
            void openTable(t);
          }}
        />
      </Sheet>
    </View>
  );
}

function Legend({ color, border, label }: { color: string; border?: string; label: string }) {
  return (
    <Row gap={6}>
      <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: color, borderWidth: border ? 1.5 : 0, borderColor: border }} />
      <T size={13} color={C.muted}>
        {label}
      </T>
    </Row>
  );
}
