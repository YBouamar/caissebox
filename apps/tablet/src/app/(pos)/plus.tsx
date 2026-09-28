import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useApp, usePosContext, usePrintJobs, useSyncStatus } from '../../services/CaisseProvider';
import { bondedBluetoothPrinters, nativePrintingAvailable } from '../../services/transport';
import { useGuarded } from '../../ui/Approval';
import { hhmm } from '../../ui/format';
import { Badge, Btn, Card, Row, T } from '../../ui/kit';
import { C } from '../../ui/theme';

/** Réglages du poste : synchronisation, impressions, imprimantes, informations et maintenance. */
export default function Plus() {
  const { caisse, pos, user, toast } = usePosContext();
  const { signOut, resetDevice } = useApp();
  const guard = useGuarded();
  const status = useSyncStatus();
  const jobs = usePrintJobs();
  const [rejections, setRejections] = useState<Awaited<ReturnType<typeof caisse.store.rejections>>>([]);
  const [bonded, setBonded] = useState<{ name: string; address: string }[] | null>(null);

  useEffect(() => {
    void caisse.store.rejections().then(setRejections);
  }, [caisse, status.lastSyncAt]);

  const printers = pos.printers();
  const receipt = pos.receiptPrinter();
  const nameOf = (id: string) => printers.find((p) => p.id === id)?.name ?? 'Imprimante supprimée';

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16, flexDirection: 'row', flexWrap: 'wrap' }}>
      <Card style={{ width: '49%' }}>
        <Row>
          <T w="bold" size={18} style={{ flex: 1 }}>
            Synchronisation
          </T>
          {status.online ? <Badge text="En ligne" tone="ok" /> : <Badge text="Hors ligne" tone="warn" />}
        </Row>
        <T color={C.muted}>
          {status.pending ? `${status.pending} opération(s) en attente d’envoi. ` : 'Tout est envoyé. '}
          {status.lastSyncAt ? `Dernier échange à ${hhmm(status.lastSyncAt)}.` : ''}
        </T>
        <T size={13} color={C.muted}>
          Sans internet, la caisse continue normalement : les ventes partent dès le retour du réseau.
        </T>
        {status.lastError && status.online ? <T color={C.warn}>{status.lastError}</T> : null}
        <Btn label="Synchroniser maintenant" busy={status.syncing} onPress={() => void caisse.sync.sync().then(() => toast('Synchronisation terminée', 'ok'))} />
        {rejections.length ? (
          <View style={{ gap: 6 }}>
            <T w="semibold">Refus du serveur</T>
            {rejections.slice(0, 6).map((r) => (
              <T key={r.opId} size={13} color={r.seen ? C.muted : C.warn}>
                {hhmm(r.at)} · {r.message}
              </T>
            ))}
            <Btn label="Marquer comme lus" height={40} textSize={13} onPress={() => void caisse.store.markRejectionsSeen().then(() => caisse.store.rejections().then(setRejections))} />
          </View>
        ) : null}
      </Card>

      <Card style={{ width: '49%' }}>
        <T w="bold" size={18}>
          Impressions en attente
        </T>
        {!nativePrintingAvailable ? <Badge text="Impression simulée (version de développement)" tone="amber" /> : null}
        {jobs.length === 0 ? <T color={C.muted}>Aucune impression en attente.</T> : null}
        {jobs.map((j) => (
          <View key={j.id} style={{ gap: 6, padding: 12, borderRadius: 12, backgroundColor: j.state === 'failed' ? C.warnSoft : C.surface2 }}>
            <Row>
              <T w="semibold" style={{ flex: 1 }}>
                {j.label}
              </T>
              <Badge text={j.state === 'failed' ? 'Échec' : j.state === 'printing' ? 'En cours' : 'En file'} tone={j.state === 'failed' ? 'warn' : 'muted'} />
            </Row>
            <T size={12} color={C.muted}>
              {nameOf(j.printerId)} {j.lastError ? `· ${j.lastError}` : ''}
            </T>
            {j.state === 'failed' ? (
              <Row style={{ flexWrap: 'wrap' }}>
                <Btn label="Réessayer" height={40} textSize={13} onPress={() => void caisse.printQueue.resume(j.printerId)} />
                {printers
                  .filter((p) => p.id !== j.printerId)
                  .map((p) => (
                    <Btn key={p.id} label={`Vers ${p.name}`} height={40} textSize={13} onPress={() => void caisse.printQueue.reroute(j.printerId, p.id)} />
                  ))}
                <Btn label="Abandonner" kind="danger" height={40} textSize={13} onPress={() => void caisse.printQueue.cancel(j.id)} />
              </Row>
            ) : null}
          </View>
        ))}
      </Card>

      <Card style={{ width: '49%' }}>
        <T w="bold" size={18}>
          Imprimantes de l’établissement
        </T>
        {printers.length === 0 ? <T color={C.muted}>Aucune imprimante : ajoutez-les depuis le back-office, rubrique Imprimantes.</T> : null}
        {printers.map((p) => (
          <Row key={p.id} style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T w="semibold">
                {p.name} {receipt?.id === p.id ? '· tickets de ce poste' : ''}
              </T>
              <T size={12} color={C.muted}>
                {p.connection === 'wifi' ? `Wi-Fi ${p.address}:${p.port}` : `Bluetooth ${p.address}`} · {p.paper_width_mm} mm
              </T>
            </View>
            {p.prints_receipts && receipt?.id !== p.id ? <Btn label="Tickets ici" height={40} textSize={12} onPress={() => void caisse.store.setMeta({ receipt_printer_id: p.id })} /> : null}
            <Btn label="Test" height={40} textSize={13} onPress={() => void guard(() => pos.printTest(p.id), 'Test envoyé')} />
          </Row>
        ))}
        <Btn
          label="Voir les imprimantes Bluetooth appairées"
          height={44}
          textSize={13}
          onPress={() => void bondedBluetoothPrinters().then(setBonded, (e: Error) => toast(e.message, 'error'))}
        />
        {bonded ? (
          <View style={{ gap: 4 }}>
            {bonded.length === 0 ? <T size={13} color={C.muted}>Aucun appareil appairé : appairez l’imprimante dans les paramètres Bluetooth d’Android.</T> : null}
            {bonded.map((b) => (
              <T key={b.address} size={13} color={C.muted}>
                {b.name} · {b.address}
              </T>
            ))}
          </View>
        ) : null}
      </Card>

      <Card style={{ width: '49%' }}>
        <T w="bold" size={18}>
          Ce poste
        </T>
        <T color={C.muted}>
          {pos.registerLabel()} · préfixe des tickets {pos.registerPrefix()} · prochain {pos.nextOrderNumber()}
        </T>
        <T size={12} color={C.muted}>
          Tablette {caisse.store.meta('device_id')} · version {Constants.expoConfig?.version ?? '0.1.0'} · serveur {caisse.store.meta('api_url')}
        </T>
        <Row>
          <Btn flex label="Verrouiller" onPress={signOut} />
          {user && pos.isManager(user.id) ? (
            <Btn
              flex
              kind="danger"
              label="Réinitialiser"
              onPress={() =>
                Alert.alert('Réinitialiser la tablette ?', status.pending ? `${status.pending} opération(s) ne sont pas encore envoyées et seront perdues.` : 'Les données locales seront effacées ; il faudra un nouveau secret d’enrôlement.', [
                  { text: 'Annuler', style: 'cancel' },
                  { text: 'Réinitialiser', style: 'destructive', onPress: () => void resetDevice() },
                ])
              }
            />
          ) : null}
        </Row>
      </Card>
    </ScrollView>
  );
}
