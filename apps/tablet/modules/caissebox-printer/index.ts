import { requireOptionalNativeModule } from 'expo-modules-core';

interface NativePrinter {
  printTcp(host: string, port: number, base64: string, timeoutMs: number): Promise<boolean>;
  printBluetooth(address: string, base64: string, timeoutMs: number): Promise<boolean>;
  bondedDevices(): Promise<{ name: string; address: string }[]>;
  isBluetoothEnabled(): boolean;
}

/** Module natif ; absent dans Expo Go et sur le web (la caisse passe alors en impression simulée). */
export const NativePrinter = requireOptionalNativeModule<NativePrinter>('CaisseBoxPrinter');
