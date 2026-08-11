import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors } from './theme';

/** Panel a pantalla completa con título y botón de cerrar. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  action,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* En iOS el Modal se monta fuera del árbol de la app, así que no hereda los
          insets: sin este provider el título se mete debajo del reloj y la batería. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.actions}>
              {action}
              <Pressable
                onPress={onClose}
                hitSlop={12}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <Text style={styles.closeText}>Listo</Text>
              </Pressable>
            </View>
          </View>
          {children}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  close: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  pressed: { backgroundColor: colors.surfaceHigh },
  closeText: { color: colors.accent, fontSize: 17, fontWeight: '600' },
});
