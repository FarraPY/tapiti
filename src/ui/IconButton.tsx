import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { colors } from './theme';

/**
 * Botón con icono nativo (SF Symbols) y respuesta visible al tocarlo:
 * el fondo se enciende mientras el dedo está apoyado.
 */
export function IconButton({
  name,
  onPress,
  disabled,
  badge,
  size = 22,
  tint,
  style,
}: {
  name: SymbolViewProps['name'];
  onPress: () => void;
  disabled?: boolean;
  badge?: number;
  size?: number;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      style={({ pressed }) => [
        styles.btn,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <SymbolView
        name={name}
        size={size}
        tintColor={disabled ? colors.textOff : (tint ?? colors.text)}
        resizeMode="scaleAspectFit"
        // Sin peso definido los símbolos se ven finitos al lado del texto del sistema.
        weight="medium"
        style={{ width: size, height: size }}
      />
      {badge !== undefined && badge > 1 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.surfaceHigh, opacity: 0.85 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    backgroundColor: colors.accent,
    borderRadius: 9,
    minWidth: 18,
    paddingHorizontal: 5,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
