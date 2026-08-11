import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from './Sheet';
import { colors } from './theme';
import { hostOf } from '../blocking/shouldBlock';
import type { Visit } from '../history';

export function HistoryView({
  visible,
  history,
  onClose,
  onOpen,
  onClear,
}: {
  visible: boolean;
  history: Visit[];
  onClose: () => void;
  onOpen: (url: string) => void;
  onClear: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Historial"
      onClose={onClose}
      action={
        history.length > 0 ? (
          <Pressable
            onPress={onClear}
            hitSlop={12}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
          >
            <Text style={styles.clearText}>Borrar</Text>
          </Pressable>
        ) : undefined
      }
    >
      <FlatList
        data={history}
        keyExtractor={(v) => v.url}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item.url)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={styles.title} numberOfLines={1}>
              {item.title || hostOf(item.url)}
            </Text>
            <Text style={styles.url} numberOfLines={1}>
              {hostOf(item.url)} · {when(item.ts)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Todavía no visitaste nada.</Text>}
      />
    </Sheet>
  );
}

function when(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(ts).toLocaleDateString('es');
}

const styles = StyleSheet.create({
  clear: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  pressed: { backgroundColor: colors.surfaceHigh },
  clearText: { color: colors.accent, fontSize: 17 },
  list: { padding: 16, gap: 4 },
  row: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  rowPressed: { backgroundColor: colors.surface },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  url: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  empty: { color: colors.textDim, fontSize: 14, padding: 12 },
});
