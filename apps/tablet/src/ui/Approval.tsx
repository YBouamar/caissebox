import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Approval, ManagerRequired, PosError, ReasonRow, StaffRow } from '../core/pos';
import { useApp } from '../services/CaisseProvider';
import { initials } from './format';
import { Btn, NumPad, PinDots, Row, Sheet, T } from './kit';
import { C } from './theme';

type Run = (fn: (approval?: Approval) => Promise<unknown>, success?: string) => Promise<boolean>;

const Ctx = createContext<Run | null>(null);

interface Pending {
  action: string;
  reason: ReasonRow['category'] | null;
  retry: (a: Approval) => Promise<unknown>;
  success?: string;
  resolve: (ok: boolean) => void;
}

const REASON_TITLES: Record<ReasonRow['category'], string> = {
  void: "Motif de l'annulation",
  comp: "Motif de l'offert",
  discount: 'Motif de la remise',
  cash_out: 'Motif de la sortie',
  cash_variance: "Motif de l'écart",
};

/**
 * Exécute une action de caisse ; si elle demande un manager, ouvre la fenêtre
 * « Validation manager » (choix du manager, PIN, motif), puis la relance.
 * Les refus métier s'affichent en bandeau.
 */
export function ApprovalProvider({ children }: { children: ReactNode }) {
  const { caisse, user, toast } = useApp();
  const [pending, setPending] = useState<Pending | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [approved, setApproved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setManagerId(null);
    setPin('');
    setApproved(null);
    setError(null);
  };

  const finish = useCallback(
    async (p: Pending, approval: Approval) => {
      try {
        await p.retry(approval);
        if (p.success) toast(p.success, 'ok');
        setPending(null);
        reset();
        p.resolve(true);
      } catch (e) {
        setError(e instanceof PosError || e instanceof ManagerRequired ? e.message : 'Erreur inattendue');
      }
    },
    [toast],
  );

  const run: Run = useCallback(
    (fn, success) =>
      new Promise<boolean>((resolve) => {
        fn()
          .then(() => {
            if (success) toast(success, 'ok');
            resolve(true);
          })
          .catch((e) => {
            if (e instanceof ManagerRequired) {
              reset();
              const p: Pending = { action: e.action, reason: e.reasonCategory, retry: (a) => fn(a), success, resolve };
              // Un manager connecté valide lui-même : il ne donne que le motif.
              if (user && caisse?.pos.isManager(user.id)) {
                if (!e.reasonCategory) {
                  void fn({ managerId: user.id }).then(
                    () => {
                      if (success) toast(success, 'ok');
                      resolve(true);
                    },
                    (err) => {
                      toast(err instanceof Error ? err.message : 'Erreur', 'error');
                      resolve(false);
                    },
                  );
                  return;
                }
                setApproved(user.id);
              }
              setPending(p);
              return;
            }
            toast(e instanceof PosError ? e.message : e instanceof Error ? e.message : 'Erreur inattendue', 'error');
            resolve(false);
          });
      }),
    [toast, user, caisse],
  );

  const managers: StaffRow[] = caisse ? caisse.pos.staff().filter((s) => caisse.pos.isManager(s.id)) : [];
  const reasons = pending?.reason && caisse ? caisse.pos.reasons(pending.reason) : [];

  const onKey = (k: string) => {
    setError(null);
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    if (k === 'C') return setPin('');
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4 && caisse && pending) {
      const s = caisse.pos.login(next, managerId ?? undefined);
      if (!s || !caisse.pos.isManager(s.id)) {
        setError('PIN manager incorrect');
        setPin('');
        return;
      }
      if (pending.reason) setApproved(s.id);
      else void finish(pending, { managerId: s.id });
    }
  };

  const cancel = () => {
    pending?.resolve(false);
    setPending(null);
    reset();
  };

  return (
    <Ctx.Provider value={run}>
      {children}
      <Sheet visible={!!pending} onClose={cancel} title={approved ? (pending?.reason ? REASON_TITLES[pending.reason] : 'Validation') : 'Validation manager'} width={620}>
        <T color={C.muted}>{pending?.action}</T>
        {approved ? (
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
            {reasons.length === 0 ? <T color={C.muted}>Aucun motif paramétré : ajoutez-en depuis le back-office.</T> : null}
            {reasons.map((r) => (
              <Btn key={r.id} label={r.label} onPress={() => pending && void finish(pending, { managerId: approved, reasonId: r.id })} height={56} />
            ))}
          </ScrollView>
        ) : (
          <View style={{ gap: 14 }}>
            <Row style={{ flexWrap: 'wrap' }}>
              {managers.map((m) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: managerId === m.id }}
                  onPress={() => {
                    setManagerId(m.id);
                    setPin('');
                    setError(null);
                  }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, paddingRight: 16, borderRadius: 14, borderWidth: managerId === m.id ? 2 : 1, borderColor: managerId === m.id ? C.navy : C.line, backgroundColor: managerId === m.id ? C.navySoft : C.surface }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center' }}>
                    <T w="bold">{initials(m.full_name)}</T>
                  </View>
                  <T w="semibold">{m.full_name}</T>
                </Pressable>
              ))}
            </Row>
            <PinDots length={4} filled={pin.length} />
            <NumPad onKey={onKey} keyHeight={56} />
          </View>
        )}
        {error ? (
          <T color={C.warn} w="semibold">
            {error}
          </T>
        ) : null}
      </Sheet>
    </Ctx.Provider>
  );
}

export function useGuarded(): Run {
  const r = useContext(Ctx);
  if (!r) throw new Error('ApprovalProvider manquant');
  return r;
}
