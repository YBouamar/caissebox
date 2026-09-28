import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StaffRow } from '../core/pos';
import { useApp, useClock, useStoreVersion, useSyncStatus } from '../services/CaisseProvider';
import { hhmm, initials, longDate } from '../ui/format';
import { NumPad, PinDots, T } from '../ui/kit';
import { C } from '../ui/theme';

/** « Qui êtes-vous ? » : choix de la personne puis PIN à 4 chiffres. */
export default function Connexion() {
  const { phase, caisse, user, signIn } = useApp();
  useStoreVersion();
  const status = useSyncStatus();
  const now = useClock();
  const router = useRouter();
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace('/salle');
  }, [user, router]);

  if (phase.kind !== 'ready' || !caisse) return <Redirect href="/" />;
  const pos = caisse.pos;
  const staff = pos.staff();
  const day = pos.currentDay();

  const onKey = (k: string) => {
    setError(null);
    if (!selected) return setError('Choisissez d’abord votre nom');
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    if (k === 'C') return setPin('');
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => {
        const s = pos.login(next, selected.id);
        if (!s) {
          setError('PIN incorrect');
          setPin('');
          return;
        }
        setPin('');
        signIn(s);
        router.replace(day ? '/salle' : '/caisse');
      }, 10);
    }
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ width: 420, backgroundColor: C.navy, padding: 40, gap: 12 }}>
        <T size={24} color="#FFFFFF">
          caisse
          <T w="bold" size={24} color="#FFFFFF">
            box
          </T>
        </T>
        <View style={{ flex: 1 }} />
        <T w="bold" size={64} color="#FFFFFF">
          {hhmm(now)}
        </T>
        <T size={18} color={C.navInk}>
          {longDate(now)}
        </T>
        <View style={{ flex: 1 }} />
        <T w="semibold" size={16} color="#FFFFFF">
          {String(pos.establishment()?.name ?? '')} · {pos.registerLabel()}
        </T>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <T size={13} color={day ? '#D1FAE5' : '#FDE68A'}>● {day ? `Journée ouverte à ${hhmm(day.opened_at)}` : 'Journée non ouverte'}</T>
          <T size={13} color={status.online ? '#D1FAE5' : '#FED7AA'}>● {status.online ? 'En ligne' : 'Hors ligne'}</T>
        </View>
      </View>
      <View style={{ flex: 1, flexDirection: 'row', padding: 40, gap: 40 }}>
        <View style={{ flex: 1, gap: 18 }}>
          <T w="bold" size={28}>
            Qui êtes-vous ?
          </T>
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {staff.length === 0 ? <T color={C.muted}>Aucune personne pour cet établissement : ajoutez l’équipe depuis le back-office.</T> : null}
            {staff.map((s) => {
              const on = selected?.id === s.id;
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setSelected(s);
                    setPin('');
                    setError(null);
                  }}
                  style={{ width: '48%', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: on ? C.navySoft : C.surface, borderWidth: on ? 2 : 1, borderColor: on ? C.navy : C.line }}
                >
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: on ? C.navy : C.amber, alignItems: 'center', justifyContent: 'center' }}>
                    <T w="bold" size={16} color={on ? '#FFFFFF' : C.ink}>
                      {initials(s.full_name)}
                    </T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T w="semibold" size={16} numberOfLines={1}>
                      {s.full_name}
                    </T>
                    <T size={13} color={C.muted}>
                      {pos.role(s.id)?.name}
                    </T>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <View style={{ width: 380, gap: 20, justifyContent: 'center' }}>
          <T w="semibold" size={18} style={{ textAlign: 'center' }}>
            {selected ? `Code PIN de ${selected.full_name.split(' ')[0]}` : 'Code PIN'}
          </T>
          <PinDots length={4} filled={pin.length} />
          <T color={error ? C.warn : C.muted} size={13} style={{ textAlign: 'center', minHeight: 36 }}>
            {error ?? (!day ? 'La journée n’est pas encore ouverte : seul un manager peut l’ouvrir et saisir le fond de caisse.' : 'PIN oublié ? Demandez à votre manager de le réinitialiser depuis le back-office.')}
          </T>
          <NumPad onKey={onKey} keyHeight={72} />
        </View>
      </View>
    </View>
  );
}
