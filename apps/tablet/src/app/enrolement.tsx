import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { ApiError } from '../core/api';
import { useApp } from '../services/CaisseProvider';
import { Field } from '../ui/Field';
import { Btn, LogoMark, T } from '../ui/kit';
import { C } from '../ui/theme';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Premier démarrage : la tablette se relie à son établissement avec l'identifiant
 * et le secret affichés une seule fois dans la console BACYBRAINS.
 */
export default function Enrolement() {
  const { phase, enroll } = useApp();
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState('https://api.caissebox.ma');
  const [deviceId, setDeviceId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase.kind === 'ready') return <Redirect href="/connexion" />;

  const submit = async () => {
    setError(null);
    const id = deviceId.trim();
    if (!UUID_RE.test(id)) return setError("L'identifiant de la tablette est incomplet");
    if (secret.trim().length < 20) return setError('Le secret est incomplet');
    setBusy(true);
    try {
      await enroll({ baseUrl: baseUrl.trim().replace(/\/$/, ''), deviceId: id, secret: secret.trim() });
      router.replace('/connexion');
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.status === 401
            ? 'Identifiant ou secret refusé. Vérifiez la saisie, ou réaffectez la tablette depuis la console pour obtenir un nouveau secret.'
            : e.message
          : "Serveur injoignable. Vérifiez le Wi-Fi et l'adresse du serveur.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <View style={{ width: 460, backgroundColor: C.navy, padding: 48, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <LogoMark size={48} />
          <T size={28} color="#FFFFFF">
            caisse
            <T w="bold" size={28} color="#FFFFFF">
              box
            </T>
          </T>
        </View>
        <View style={{ gap: 12 }}>
          <T w="bold" size={30} color="#FFFFFF">
            Mise en service de la tablette
          </T>
          <T size={16} color={C.navInk} style={{ lineHeight: 24 }}>
            Saisissez l’identifiant et le secret affichés dans la console BACYBRAINS au moment de l’affectation. La tablette charge ensuite la carte, l’équipe et la salle, puis fonctionne même sans internet.
          </T>
        </View>
        <T size={13} color={C.navInk}>
          Un service BACYBRAINS · Casablanca
        </T>
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 48, gap: 18, maxWidth: 640 }} keyboardShouldPersistTaps="handled">
          <T w="bold" size={26}>
            Enrôlement
          </T>
          <Field label="Adresse du serveur" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
          <Field label="Identifiant de la tablette" value={deviceId} onChangeText={setDeviceId} autoCapitalize="none" autoCorrect={false} placeholder="f7709b7c-fb25-4e57-9399-…" />
          <Field label="Secret d’enrôlement" value={secret} onChangeText={setSecret} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="Affiché une seule fois dans la console" />
          {error ? (
            <View style={{ backgroundColor: C.warnSoft, padding: 14, borderRadius: 12 }}>
              <T color={C.warn} w="semibold">
                {error}
              </T>
            </View>
          ) : null}
          <Btn label="Relier la tablette" kind="accent" height={60} busy={busy} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
