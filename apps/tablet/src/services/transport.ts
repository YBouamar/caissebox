import { PermissionsAndroid, Platform } from 'react-native';
import { NativePrinter } from '../../modules/caissebox-printer';
import type { PrinterTarget, PrintTransport } from '../core/printing';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

let btAsked = false;
async function ensureBluetoothPermission(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31 || btAsked) return;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  btAsked = res === PermissionsAndroid.RESULTS.GRANTED;
  if (!btAsked) throw new Error('Autorisation Bluetooth refusée');
}

/** Transport réel (module natif) ; en son absence (Expo Go, web), impression simulée dans la console. */
export const printTransport: PrintTransport = {
  async send(printer: PrinterTarget, bytes: Uint8Array, timeoutMs: number) {
    if (!NativePrinter) {
      console.log(`[impression simulée] ${printer.name} : ${bytes.length} octets`);
      await new Promise((r) => setTimeout(r, 300));
      return;
    }
    const data = toBase64(bytes);
    if (printer.connection === 'wifi') await NativePrinter.printTcp(printer.address, printer.port || 9100, data, timeoutMs);
    else {
      await ensureBluetoothPermission();
      await NativePrinter.printBluetooth(printer.address, data, timeoutMs);
    }
  },
};

export async function bondedBluetoothPrinters(): Promise<{ name: string; address: string }[]> {
  if (!NativePrinter) return [];
  await ensureBluetoothPermission();
  return NativePrinter.bondedDevices();
}

export const nativePrintingAvailable = !!NativePrinter;
