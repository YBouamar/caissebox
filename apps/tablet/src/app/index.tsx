import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '../services/CaisseProvider';
import { T } from '../ui/kit';
import { C } from '../ui/theme';

/** Aiguillage au démarrage : enrôlement, connexion ou service. */
export default function Index() {
  const { phase, user } = useApp();
  if (phase.kind === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <ActivityIndicator color={C.amber} size="large" />
        <T color={C.navInk}>Ouverture de la caisse…</T>
      </View>
    );
  }
  if (phase.kind === 'error') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 }}>
        <T w="bold" size={22}>
          La caisse n’a pas pu démarrer
        </T>
        <T color={C.muted}>{phase.message}</T>
        <T color={C.muted}>Redémarrez la tablette. Si le problème continue, contactez le support CaisseBox.</T>
      </View>
    );
  }
  if (phase.kind === 'enroll') return <Redirect href="/enrolement" />;
  return <Redirect href={user ? '/salle' : '/connexion'} />;
}
