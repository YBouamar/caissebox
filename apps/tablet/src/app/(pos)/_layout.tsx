import { Redirect, Slot } from 'expo-router';
import { View } from 'react-native';
import { useApp } from '../../services/CaisseProvider';
import { Header, NavRail } from '../../ui/Shell';

/** Écrans de service : il faut une tablette enrôlée et une personne connectée. */
export default function PosLayout() {
  const { phase, user } = useApp();
  if (phase.kind !== 'ready') return <Redirect href="/" />;
  if (!user) return <Redirect href="/connexion" />;
  return (
    <View style={{ flex: 1 }}>
      <Header />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <NavRail />
        <View style={{ flex: 1 }}>
          <Slot />
        </View>
      </View>
    </View>
  );
}
