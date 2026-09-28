import * as Crypto from 'expo-crypto';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { Credentials } from '../core/api';
import { Caisse } from '../core/caisse';
import type { PrintJob } from '../core/printing';
import type { StaffRow } from '../core/pos';
import type { Rejection, SyncStatus } from '../core/sync';
import { clearCredentials, loadCredentials, saveCredentials } from './credentials';
import { openLocalDatabase } from './sqlite';
import { printTransport } from './transport';

type Phase = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'enroll' } | { kind: 'ready' };

interface Toast {
  id: number;
  tone: 'info' | 'ok' | 'error';
  text: string;
}

interface Ctx {
  phase: Phase;
  caisse: Caisse | null;
  user: StaffRow | null;
  toasts: Toast[];
  enroll(creds: Credentials): Promise<void>;
  signIn(staff: StaffRow): void;
  signOut(): void;
  toast(text: string, tone?: Toast['tone']): void;
  resetDevice(): Promise<void>;
}

const CaisseContext = createContext<Ctx | null>(null);
const AUTO_LOCK_MS = 5 * 60 * 1000;

/**
 * Démarrage de la caisse : base chiffrée, identifiants d'enrôlement, synchro et
 * file d'impression. Garde aussi la personne connectée (verrouillage après
 * 5 minutes d'inactivité ou mise en veille).
 */
export function CaisseProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [caisse, setCaisse] = useState<Caisse | null>(null);
  const [user, setUser] = useState<StaffRow | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastActivity = useRef(Date.now());
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);

  const onRejected = useCallback(
    (r: Rejection[]) => toast(`Refusé par le serveur : ${r[0]?.message ?? ''}${r.length > 1 ? ` (+${r.length - 1})` : ''}`, 'error'),
    [toast],
  );

  useEffect(() => {
    let alive = true;
    let opened: Caisse | null = null;
    (async () => {
      try {
        const sql = await openLocalDatabase();
        const c = await Caisse.open({ sql, fetch: ((url: string, init: RequestInit) => fetch(url, init)) as never, transport: printTransport, uuid: Crypto.randomUUID, onRejected, appVersion: '0.1.0' });
        opened = c;
        const creds = await loadCredentials();
        if (!alive) return;
        setCaisse(c);
        if (creds && c.store.meta('snapshot_at')) {
          c.connect(creds);
          await c.start();
          setPhase({ kind: 'ready' });
        } else {
          setPhase({ kind: 'enroll' });
        }
      } catch (e) {
        if (alive) setPhase({ kind: 'error', message: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
      opened?.stop();
    };
  }, [onRejected]);

  // Verrouillage automatique.
  useEffect(() => {
    const t = setInterval(() => {
      if (user && Date.now() - lastActivity.current > AUTO_LOCK_MS) setUser(null);
    }, 15000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') setUser(null);
      if (s === 'active') caisse?.enrolled && void caisse.sync.sync();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [user, caisse]);

  const value = useMemo<Ctx>(
    () => ({
      phase,
      caisse,
      user,
      toasts,
      toast,
      async enroll(creds) {
        if (!caisse) throw new Error('Base locale non prête');
        await caisse.enroll(creds);
        await saveCredentials(creds);
        await caisse.start();
        setPhase({ kind: 'ready' });
      },
      signIn(staff) {
        lastActivity.current = Date.now();
        setUser(staff);
      },
      signOut() {
        setUser(null);
      },
      async resetDevice() {
        if (!caisse) return;
        await caisse.reset();
        await clearCredentials();
        setUser(null);
        setPhase({ kind: 'enroll' });
      },
    }),
    [phase, caisse, user, toasts, toast],
  );

  return (
    <CaisseContext.Provider value={value}>
      <ActivityTracker onActivity={() => (lastActivity.current = Date.now())}>{children}</ActivityTracker>
    </CaisseContext.Provider>
  );
}

function ActivityTracker({ children, onActivity }: { children: ReactNode; onActivity: () => void }) {
  // Toute interaction repousse le verrouillage (voir _layout : onTouchStart).
  activityHook = onActivity;
  return <>{children}</>;
}
let activityHook: () => void = () => undefined;
export const markActivity = () => activityHook();

export function useApp(): Ctx {
  const ctx = useContext(CaisseContext);
  if (!ctx) throw new Error('CaisseProvider manquant');
  return ctx;
}

/** Caisse prête et personne connectée (écrans de service). */
export function usePosContext() {
  const { caisse, user, toast } = useApp();
  if (!caisse) throw new Error('Caisse non démarrée');
  useStoreVersion();
  return { caisse, pos: caisse.pos, user, toast };
}

/** Rafraîchit le composant à chaque changement des données locales. */
export function useStoreVersion(): number {
  const { caisse } = useApp();
  return useSyncExternalStore(
    (fn) => caisse?.store.subscribe(fn) ?? (() => undefined),
    () => caisse?.store.version ?? 0,
  );
}

const offline: SyncStatus = { online: false, syncing: false, pending: 0, lastSyncAt: null, lastError: null };

export function useSyncStatus(): SyncStatus {
  const { caisse } = useApp();
  return useSyncExternalStore(
    (fn) => (caisse?.enrolled ? caisse.sync.subscribe(fn) : () => undefined),
    () => (caisse?.enrolled ? caisse.sync.status : offline),
  );
}

export function usePrintJobs(): PrintJob[] {
  const { caisse } = useApp();
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  useEffect(() => {
    if (!caisse) return;
    let alive = true;
    const refresh = () => void caisse.printQueue.jobs().then((j) => alive && setJobs(j));
    refresh();
    const unsub = caisse.printQueue.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, [caisse]);
  return jobs;
}

/** Heure courante, rafraîchie chaque minute pour l'en-tête. */
export function useClock(): Date {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);
  return now;
}
