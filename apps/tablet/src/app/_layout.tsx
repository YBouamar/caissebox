import { SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold, useFonts } from '@expo-google-fonts/space-grotesk';
import { Stack } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CaisseProvider, markActivity } from '../services/CaisseProvider';
import { ApprovalProvider } from '../ui/Approval';
import { Toasts } from '../ui/Shell';
import { C } from '../ui/theme';

export default function RootLayout() {
  useKeepAwake();
  const [loaded] = useFonts({ SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold });
  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: C.navy, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.amber} size="large" />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <StatusBar hidden />
      <CaisseProvider>
        <ApprovalProvider>
          <View style={{ flex: 1, backgroundColor: C.bg }} onTouchStart={markActivity}>
            <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: C.bg } }} />
            <Toasts />
          </View>
        </ApprovalProvider>
      </CaisseProvider>
    </SafeAreaProvider>
  );
}
