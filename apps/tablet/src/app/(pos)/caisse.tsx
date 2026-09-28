import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { MAD_DENOMINATIONS_CENTS } from '@caissebox/shared';
import { usePosContext } from '../../services/CaisseProvider';
import { AmountPad } from '../../ui/AmountPad';
import { useGuarded } from '../../ui/Approval';
import { amount, dh, hhmm } from '../../ui/format';
import { Badge, Btn, Card, Divider, Row, Sheet, T } from '../../ui/kit';
import { C, F } from '../../ui/theme';

/**
 * Caisse : ouverture de la journée (fond de caisse), session de la personne,
 * mouvements, rapport X, clôture de session avec comptage, clôture de journée (Z).
 */
export default function Caisse() {
  const { pos, user } = usePosContext();
  const guard = useGuarded();
  const router = useRouter();
  const [float, setFloat] = useState(50000);
  const [sheet, setSheet] = useState<null | 'open-session' | 'out' | 'in' | 'close' | 'x'>(null);
  const [cents, setCents] = useState(0);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [useCounts, setUseCounts] = useState(false);
  if (!user) return null;
  const day = pos.currentDay();

  if (!day) {
    return (
      <ScrollView contentContainerStyle={{ padding: 32, alignItems: 'center' }}>
        <Card style={{ width: 620, gap: 18 }}>
          <T w="bold" size={26}>
            Ouverture de la journée
          </T>
          <T color={C.muted}>
            La journée démarre à l’ouverture et peut se poursuivre après minuit. Saisissez le fond de caisse compté dans le tiroir. Journée suivante : Z n° {pos.nextZNumber()}.
          </T>
          {pos.accessState() === 'refuse_day_open' ? (
            <View style={{ backgroundColor: C.warnSoft, padding: 14, borderRadius: 12 }}>
              <T w="semibold" color={C.warn}>
                Ouverture suspendue : contactez CaisseBox pour régulariser le loyer.
              </T>
            </View>
          ) : null}
          <AmountPad cents={float} onChange={setFloat} label="Fond de caisse" />
          <Btn
            kind="accent"
            height={64}
            label="Ouvrir la journée"
            onPress={() =>
              void guard(async (a) => {
                await pos.openDay(user.id, float, a);
                if (pos.can(user.id, 'cash.session') && !pos.openSessionFor(user.id)) await pos.openSession(user.id, float);
              }, 'Journée ouverte').then((ok) => ok && router.replace('/salle'))
            }
          />
        </Card>
      </ScrollView>
    );
  }

  const mine = pos.openSessionFor(user.id);
  const fig = mine ? pos.sessionFigures(mine.id) : null;
  const sessions = pos.sessions();
  const counted = useCounts ? Object.entries(counts).reduce((s, [d, n]) => s + Number(d) * n, 0) : cents;
  const variance = fig ? counted - fig.expectedCents : 0;
  const x = pos.xReport(pos.can(user.id, 'report.x') ? undefined : user.id);
  const warning = pos.accessState();

  const resetForm = () => {
    setCents(0);
    setReasonId(null);
    setNote('');
    setCounts({});
    setUseCounts(false);
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row', padding: 20, gap: 20 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 16 }}>
        {warning === 'warning_all' || (warning === 'warning_manager' && pos.isManager(user.id)) ? (
          <View style={{ backgroundColor: C.amberSoft, padding: 14, borderRadius: 12 }}>
            <T w="semibold" color={C.amberInk}>
              Loyer CaisseBox en retard : merci de régulariser pour éviter la suspension de l’ouverture de journée.
            </T>
          </View>
        ) : null}
        <Card>
          <Row>
            <T w="bold" size={22} style={{ flex: 1 }}>
              {mine ? `Ma session · ${mine.register_label}` : 'Pas de session de caisse ouverte'}
            </T>
            {mine ? <Badge text={`Ouverte à ${hhmm(mine.opened_at)}`} tone="ok" /> : null}
          </Row>
          {fig ? (
            <>
              <Row style={{ justifyContent: 'space-between' }}>
                <T color={C.muted}>Fond de caisse</T>
                <T>{dh(fig.figures.openingFloatCents)}</T>
              </Row>
              <Row style={{ justifyContent: 'space-between' }}>
                <T color={C.muted}>Encaissements en espèces</T>
                <T>{dh(fig.figures.cashPaymentsCents)}</T>
              </Row>
              {fig.figures.cashInCents ? (
                <Row style={{ justifyContent: 'space-between' }}>
                  <T color={C.muted}>Apports</T>
                  <T>{dh(fig.figures.cashInCents)}</T>
                </Row>
              ) : null}
              {fig.figures.cashOutCents ? (
                <Row style={{ justifyContent: 'space-between' }}>
                  <T color={C.muted}>Sorties</T>
                  <T>−{dh(fig.figures.cashOutCents)}</T>
                </Row>
              ) : null}
              <Divider />
              <Row style={{ justifyContent: 'space-between' }}>
                <T w="semibold">Espèces attendues dans le tiroir</T>
                <T w="bold" size={24}>
                  {dh(fig.expectedCents)}
                </T>
              </Row>
              {fig.byMethod.filter((m) => m.method?.kind !== 'cash').map((m) => (
                <Row key={m.method?.id ?? 'x'} style={{ justifyContent: 'space-between' }}>
                  <T color={C.muted}>
                    {m.method?.label ?? 'Autre'} ({m.count})
                  </T>
                  <T>{dh(m.amountCents)}</T>
                </Row>
              ))}
              <Row style={{ flexWrap: 'wrap' }}>
                <Btn label="Sortie de caisse" onPress={() => { resetForm(); setSheet('out'); }} />
                <Btn label="Apport" onPress={() => { resetForm(); setSheet('in'); }} />
                <Btn label="Ouvrir le tiroir" onPress={() => void guard((a) => pos.cashMovement(user.id, mine!.id, 'no_sale', 0, {}, a), 'Tiroir ouvert')} />
                <Btn kind="primary" label="Clôturer ma session" onPress={() => { resetForm(); setSheet('close'); }} />
              </Row>
            </>
          ) : (
            <>
              <T color={C.muted}>Ouvrez une session pour encaisser sur ce poste. Chaque caissier ou serveur qui encaisse a la sienne.</T>
              <Btn kind="accent" label="Ouvrir ma session" onPress={() => { setCents(0); setSheet('open-session'); }} />
            </>
          )}
        </Card>

        <Card>
          <T w="bold" size={18}>
            Sessions de la journée
          </T>
          {sessions.map((s) => (
            <Row key={s.id} style={{ justifyContent: 'space-between' }}>
              <T w="semibold" style={{ flex: 1 }}>
                {s.register_label} · {pos.staffName(s.staff_id)}
              </T>
              {s.status === 'open' ? (
                <Badge text="Ouverte" tone="amber" />
              ) : (
                <T color={Number(s.variance_cents) ? C.warn : C.muted}>Écart {dh(Number(s.variance_cents ?? 0))}</T>
              )}
            </Row>
          ))}
          {!sessions.length ? <T color={C.muted}>Aucune session.</T> : null}
        </Card>
      </ScrollView>

      <View style={{ width: 440, gap: 16 }}>
        <Card>
          <Row>
            <T w="bold" size={18} style={{ flex: 1 }}>
              Rapport X {pos.can(user.id, 'report.x') ? '· journée' : '· ma recette'}
            </T>
            <Btn label="Imprimer" height={40} textSize={13} onPress={() => void guard(() => pos.printXReport(user.id, pos.can(user.id, 'report.x') ? undefined : user.id), 'Rapport X imprimé')} />
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <T color={C.muted}>CA TTC</T>
            <T w="bold" size={26}>
              {dh(x.totalCents)}
            </T>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <T color={C.muted}>Tickets · ticket moyen</T>
            <T>
              {x.orders} · {dh(x.averageCents)}
            </T>
          </Row>
          {x.payments.map((p) => (
            <Row key={p.label} style={{ justifyContent: 'space-between' }}>
              <T color={C.muted}>{p.label}</T>
              <T>{dh(p.amountCents)}</T>
            </Row>
          ))}
          <Divider />
          {x.waiters.map((w) => (
            <Row key={w.name} style={{ justifyContent: 'space-between' }}>
              <T>
                {w.name} ({w.orders})
              </T>
              <T w="semibold">{dh(w.amountCents)}</T>
            </Row>
          ))}
        </Card>
        {pos.isManager(user.id) || pos.can(user.id, 'day.open_close') ? (
          <Card>
            <T w="bold" size={18}>
              Clôture de la journée · Z n° {pos.nextZNumber()}
            </T>
            <T color={C.muted} size={13}>
              {x.openOrders ? `${x.openOrders} ticket(s) encore ouvert(s). ` : ''}
              {sessions.filter((s) => s.status === 'open').length ? `${sessions.filter((s) => s.status === 'open').length} session(s) encore ouverte(s). ` : ''}
              La clôture est définitive : plus aucune vente ne pourra être ajoutée à cette journée.
            </T>
            <Btn kind="danger" height={56} label="Clôturer la journée" onPress={() => void guard((a) => pos.closeDay(user.id, a), 'Journée clôturée, rapport Z imprimé')} />
          </Card>
        ) : null}
      </View>

      <Sheet visible={sheet === 'open-session'} onClose={() => setSheet(null)} title="Ouvrir ma session" width={520} footer={<Btn flex kind="accent" label="Ouvrir" onPress={() => { setSheet(null); void guard(() => pos.openSession(user.id, cents, pos.can(user.id, 'cash.session') ? 'register' : 'waiter'), 'Session ouverte'); }} />}>
        <AmountPad cents={cents} onChange={setCents} label="Fond de caisse de la session" keyHeight={52} />
      </Sheet>

      <Sheet visible={sheet === 'out' || sheet === 'in'} onClose={() => setSheet(null)} title={sheet === 'out' ? 'Sortie de caisse' : 'Apport en caisse'} width={620} footer={<Btn flex kind="accent" label="Enregistrer" onPress={() => { const kind = sheet as 'out' | 'in'; setSheet(null); void guard((a) => pos.cashMovement(user.id, mine!.id, kind, cents, { reasonId, note: note || null }, a), 'Mouvement enregistré'); }} />}>
        {sheet === 'out' ? (
          <Row style={{ flexWrap: 'wrap' }}>
            {pos.reasons('cash_out').map((r) => (
              <Btn key={r.id} label={r.label} kind={reasonId === r.id ? 'primary' : 'outline'} height={44} textSize={13} onPress={() => setReasonId(r.id)} />
            ))}
          </Row>
        ) : null}
        <AmountPad cents={cents} onChange={setCents} keyHeight={48} />
        <TextInput value={note} onChangeText={setNote} placeholder="Précision (facultatif)" placeholderTextColor={C.faint} style={{ height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 15, color: C.ink }} />
      </Sheet>

      <Sheet
        visible={sheet === 'close'}
        onClose={() => setSheet(null)}
        title="Clôture de ma session"
        width={820}
        footer={
          <Btn
            flex
            kind="accent"
            height={60}
            label={`Clôturer · compté ${dh(counted)}`}
            onPress={() => {
              setSheet(null);
              void guard(async () => {
                const r = await pos.closeSession(user.id, mine!.id, counted, note || null);
                return r;
              }, 'Session clôturée');
            }}
          />
        }
      >
        <Row>
          <T color={C.muted} style={{ flex: 1 }}>
            Comptez les espèces du tiroir. Le montant attendu n’est affiché qu’après la saisie, pour un comptage honnête.
          </T>
          <Btn label={useCounts ? 'Saisir un total' : 'Compter par billets'} height={40} textSize={13} onPress={() => setUseCounts((v) => !v)} />
        </Row>
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <View style={{ flex: 1 }}>
            {useCounts ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {MAD_DENOMINATIONS_CENTS.map((d) => (
                  <View key={d} style={{ width: '48%', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T w="semibold" style={{ width: 70 }}>
                      {amount(d)}
                    </T>
                    <Btn label="−" height={40} style={{ width: 44 }} onPress={() => setCounts((c) => ({ ...c, [d]: Math.max(0, (c[d] ?? 0) - 1) }))} />
                    <T w="bold" style={{ width: 34, textAlign: 'center' }}>
                      {counts[d] ?? 0}
                    </T>
                    <Btn label="+" height={40} style={{ width: 44 }} onPress={() => setCounts((c) => ({ ...c, [d]: (c[d] ?? 0) + 1 }))} />
                  </View>
                ))}
              </View>
            ) : (
              <AmountPad cents={cents} onChange={setCents} keyHeight={48} />
            )}
          </View>
          <View style={{ width: 280, gap: 10 }}>
            <Card style={{ backgroundColor: C.surface2 }}>
              <T color={C.muted}>Compté</T>
              <T w="bold" size={28}>
                {dh(counted)}
              </T>
              {counted > 0 && fig ? (
                <>
                  <T color={C.muted}>Attendu {dh(fig.expectedCents)}</T>
                  <T w="bold" size={20} color={variance === 0 ? C.okInk : C.warn}>
                    {variance === 0 ? 'Aucun écart' : `Écart ${dh(variance)}`}
                  </T>
                </>
              ) : null}
            </Card>
            {variance !== 0 && counted > 0 ? (
              <>
                <Row style={{ flexWrap: 'wrap' }}>
                  {pos.reasons('cash_variance').map((r) => (
                    <Btn key={r.id} label={r.label} height={40} textSize={12} kind={note === r.label ? 'primary' : 'outline'} onPress={() => setNote(r.label)} />
                  ))}
                </Row>
                <TextInput value={note} onChangeText={setNote} placeholder="Motif de l’écart (obligatoire)" placeholderTextColor={C.faint} style={{ height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 15, color: C.ink }} />
              </>
            ) : null}
          </View>
        </View>
      </Sheet>
    </View>
  );
}
