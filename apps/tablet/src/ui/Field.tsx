import { TextInput, TextInputProps, View } from 'react-native';
import { T } from './kit';
import { C, F } from './theme';

export function Field({ label, hint, style, ...rest }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T w="semibold" size={13}>
        {label}
      </T>
      <TextInput
        placeholderTextColor={C.faint}
        {...rest}
        style={[{ height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 16, color: C.ink, backgroundColor: C.surface }, style]}
      />
      {hint ? (
        <T size={12} color={C.muted}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}
