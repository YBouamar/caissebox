import { View } from 'react-native';
import { amount } from './format';
import { NumPad, T } from './kit';
import { C } from './theme';

/**
 * Saisie d'un montant au pavé : les chiffres entrent par la droite, comme sur un
 * terminal de paiement (1, 2, 5, 0 → 12,50).
 */
export function AmountPad({ cents, onChange, label, keyHeight = 60 }: { cents: number; onChange: (c: number) => void; label?: string; keyHeight?: number }) {
  const onKey = (k: string) => {
    if (k === '⌫') return onChange(Math.floor(cents / 10));
    if (k === '00') return onChange(Math.min(99_999_999, cents * 100));
    const next = cents * 10 + Number(k);
    if (next <= 99_999_999) onChange(next);
  };
  return (
    <View style={{ gap: 12 }}>
      {label ? (
        <T size={13} color={C.muted} w="semibold">
          {label}
        </T>
      ) : null}
      <View style={{ height: 64, borderRadius: 14, borderWidth: 1.5, borderColor: C.input, backgroundColor: C.surface, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 18 }}>
        <T w="bold" size={30}>
          {amount(cents)} DH
        </T>
      </View>
      <NumPad onKey={onKey} extra="00" keyHeight={keyHeight} />
    </View>
  );
}
