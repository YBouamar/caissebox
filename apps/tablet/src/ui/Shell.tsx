import { usePathname, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useApp, useClock, usePrintJobs, useSyncStatus } from '../services/CaisseProvider';
import { ddmm, hhmm, initials } from './format';
import { Icon, ICONS, LogoMark, T } from './kit';
import { C } from './theme';

/** Bandeau du haut : établissement, journée, état réseau, personne connectée, heure. */
export function Header() {
  const { caisse, user, signOut } = useApp();
  const router = useRouter();
  const status = useSyncStatus();
  const jobs = usePrintJobs();
  const now = useClock();
  if (!caisse) return null;
  const pos = caisse.pos;
  const day = pos.currentDay();
  const failed = jobs.filter((j) => j.state === 'failed').length;
  const role = user ? pos.role(user.id)?.name : '';
  const net = !status.online
    ? { bg: '#3B1D12', fg: '#FED7AA', dot: '#FB923C', text: status.pending ? `Hors ligne · ${status.pending} en attente` : 'Hors ligne' }
    : status.pending
      ? { bg: C.navy2, fg: '#FDE68A', dot: C.amber, text: `Envoi · ${status.pending}` }
      : { bg: C.navy2, fg: '#D1FAE5', dot: C.ok, text: 'En ligne' };
  return (
    <View style={{ height: 64, backgroundColor: C.navy, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, gap: 16 }}>
      <LogoMark size={36} />
      <T w="semibold" size={18} color="#FFFFFF" numberOfLines={1} style={{ maxWidth: 260 }}>
        {String(pos.establishment()?.name ?? 'CaisseBox')}
      </T>
      <View style={{ width: 1, height: 24, backgroundColor: C.navyLine }} />
      <T size={14} color={C.navInk}>
        {day ? `Journée du ${ddmm(day.opened_at)} · ouverte à ${hhmm(day.opened_at)}` : 'Journée non ouverte'}
      </T>
      <View style={{ flex: 1 }} />
      {failed ? (
        <Pressable onPress={() => router.push('/plus')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#3B1D12' }}>
          <Icon d={ICONS.printer} size={16} color="#FED7AA" />
          <T size={13} color="#FED7AA">
            {failed} impression(s) en échec
          </T>
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push('/plus')} accessibilityLabel={`État de la connexion : ${net.text}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: net.bg }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: net.dot }} />
        <T size={13} color={net.fg}>
          {net.text}
        </T>
      </Pressable>
      {user ? (
        <Pressable onPress={signOut} accessibilityLabel="Changer d'utilisateur" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center' }}>
            <T w="bold">{initials(user.full_name)}</T>
          </View>
          <View>
            <T w="semibold" color="#FFFFFF">
              {pos.staffName(user.id)}
            </T>
            <T size={12} color={C.navInk}>
              {role}
            </T>
          </View>
        </Pressable>
      ) : null}
      <T w="semibold" size={18} color="#FFFFFF">
        {hhmm(now)}
      </T>
    </View>
  );
}

const NAV = [
  { href: '/salle', label: 'Salle', icon: ICONS.salle },
  { href: '/emporter', label: 'À emporter', icon: ICONS.emporter },
  { href: '/tickets', label: 'Tickets', icon: ICONS.tickets },
  { href: '/caisse', label: 'Caisse', icon: ICONS.caisse },
  { href: '/clients', label: 'Clients', icon: ICONS.clients },
  { href: '/plus', label: 'Plus', icon: ICONS.plus },
] as const;

/** Colonne de navigation à gauche. */
export function NavRail() {
  const path = usePathname();
  const router = useRouter();
  return (
    <View style={{ width: 88, backgroundColor: C.surface, borderRightWidth: 1, borderRightColor: C.line, paddingVertical: 12, paddingHorizontal: 8, gap: 4 }}>
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(`${n.href}/`) || (n.href === '/salle' && (path.startsWith('/commande') || path.startsWith('/paiement')));
        return (
          <Pressable
            key={n.href}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => router.replace(n.href)}
            style={{ height: 72, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: active ? C.navySoft : 'transparent' }}
          >
            <Icon d={n.icon} size={24} color={active ? C.navy : C.muted} />
            <T w="semibold" size={12} color={active ? C.navy : C.muted}>
              {n.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', bottom: 24, left: 0, right: 0, alignItems: 'center', gap: 8 }}>
      {toasts.map((t) => (
        <View
          key={t.id}
          accessibilityLiveRegion="polite"
          style={{ maxWidth: 720, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: t.tone === 'error' ? C.warn : t.tone === 'ok' ? C.okInk : C.navy, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 }}
        >
          <T w="semibold" color="#FFFFFF">
            {t.text}
          </T>
        </View>
      ))}
    </View>
  );
}
