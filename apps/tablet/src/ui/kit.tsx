import { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleProp, StyleSheet, Text, TextProps, TextStyle, View, ViewStyle } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { C, F, R } from './theme';

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

export function T({ w = 'regular', size = 14, color = C.ink, style, ...rest }: TextProps & { w?: Weight; size?: number; color?: string }) {
  return <Text {...rest} style={[{ fontFamily: F[w], fontSize: size, color }, style]} />;
}

export function Icon({ d, size = 22, color = C.ink, stroke = 1.8 }: { d: string; size?: number; color?: string; stroke?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <Path d={d} />
    </Svg>
  );
}

export const ICONS = {
  salle: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  emporter: 'M6 8h12l-1 12H7L6 8zM9 8a3 3 0 0 1 6 0',
  tickets: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  caisse: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  clients: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  plus: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M15 5l-7 7 7 7',
  search: 'M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  close: 'M6 6l12 12M18 6L6 18',
  printer: 'M7 8V3h10v5M6 17H4v-7h16v7h-2M7 14h10v7H7z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  minus: 'M5 12h14',
  add: 'M12 5v14M5 12h14',
  del: 'M9 7V4h6v3M4 7h16M6 7l1 13h10l1-13',
  sync: 'M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5',
} as const;

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect width="100" height="100" rx="24" fill="#FFFFFF" />
      <SvgText x="47" y="66" textAnchor="middle" fontFamily={F.bold} fontWeight="700" fontSize="52" letterSpacing={-3} fill={C.navy}>
        cb
      </SvgText>
      <Rect x="72" y="72" width="14" height="14" rx="3" fill={C.amber} />
    </Svg>
  );
}

type BtnKind = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger';

export function Btn({
  label,
  onPress,
  kind = 'outline',
  disabled,
  busy,
  height = 48,
  style,
  textSize = 15,
  icon,
  flex,
}: {
  label: string;
  onPress?: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  busy?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
  textSize?: number;
  icon?: string;
  flex?: boolean;
}) {
  const bg = kind === 'primary' ? C.navy : kind === 'accent' ? C.amber : kind === 'ghost' ? 'transparent' : C.surface;
  const fg = kind === 'primary' ? '#FFFFFF' : kind === 'danger' ? C.warn : C.ink;
  const border = kind === 'outline' || kind === 'danger' ? C.input : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        { height, borderRadius: height >= 56 ? 14 : R.md, backgroundColor: bg, borderWidth: 1.5, borderColor: border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flexDirection: 'row', gap: 8 },
        flex && { flex: 1 },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon d={icon} color={fg} size={20} /> : null}
      <T w={kind === 'accent' ? 'bold' : 'semibold'} size={textSize} color={fg} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: 18, gap: 12 }, style]}>{children}</View>;
}

export function Badge({ text, tone = 'navy' }: { text: string; tone?: 'navy' | 'amber' | 'muted' | 'ok' | 'warn' }) {
  const bg = { navy: C.navySoft, amber: C.amberSoft, muted: C.line, ok: C.okSoft, warn: C.warnSoft }[tone];
  const fg = { navy: C.navy, amber: C.amberInk, muted: C.muted, ok: C.okInk, warn: C.warn }[tone];
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: bg, alignSelf: 'flex-start' }}>
      <T w="semibold" size={11} color={fg}>
        {text}
      </T>
    </View>
  );
}

export function Chip({ label, active, onPress, dot }: { label: string; active?: boolean; onPress: () => void; dot?: string }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={{ height: 48, paddingHorizontal: 16, borderRadius: R.md, borderWidth: active ? 0 : 1, borderColor: C.line, backgroundColor: active ? C.navy : C.surface, flexDirection: 'row', alignItems: 'center', gap: 8 }}
    >
      {dot ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} /> : null}
      <T w="semibold" size={15} color={active ? '#FFFFFF' : C.ink}>
        {label}
      </T>
    </Pressable>
  );
}

/** Pavé numérique (PIN, montants). */
export function NumPad({ onKey, keyHeight = 64, extra = 'C' }: { onKey: (k: string) => void; keyHeight?: number; extra?: string }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', extra, '0', '⌫'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {keys.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={k === '⌫' ? 'Effacer' : k}
          onPress={() => onKey(k)}
          style={({ pressed }) => ({ width: '31%', flexGrow: 1, height: keyHeight, borderRadius: 14, backgroundColor: pressed ? C.navySoft : C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' })}
        >
          <T w="semibold" size={24}>
            {k}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

export function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <View accessibilityLabel={`${filled} chiffres saisis sur ${length}`} style={{ flexDirection: 'row', gap: 14, justifyContent: 'center' }}>
      {Array.from({ length }, (_, i) => (
        <View key={i} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: i < filled ? C.navy : 'transparent', borderWidth: 2, borderColor: C.navy }} />
      ))}
    </View>
  );
}

/** Fenêtre modale centrée. */
export function Sheet({ visible, onClose, title, children, width = 560, footer }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; width?: number; footer?: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['landscape', 'landscape-left', 'landscape-right']}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fermer" />
        <View style={[s.sheet, { width }]}>
          <View style={s.sheetHead}>
            <T w="bold" size={22} style={{ flex: 1 }}>
              {title}
            </T>
            <Pressable accessibilityLabel="Fermer" onPress={onClose} style={s.close}>
              <Icon d={ICONS.close} size={20} />
            </Pressable>
          </View>
          <View style={{ gap: 14 }}>{children}</View>
          {footer ? <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function Row({ children, style, gap = 10 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: C.line }} />;
}

export const text = (style: TextStyle) => style;

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,31,58,0.55)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: C.surface, borderRadius: 20, padding: 24, gap: 16, maxHeight: '94%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  close: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
});
