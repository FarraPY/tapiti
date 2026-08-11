import { useMemo, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Sheet } from './Sheet';
import { colors } from './theme';
import { asText, clearDiag, label, useDiag, type DiagKind } from '../diag';

const FILTERS: { key: 'todo' | DiagKind; text: string }[] = [
  { key: 'todo', text: 'Todo' },
  { key: 'block', text: 'Cortado' },
  { key: 'allow', text: 'Pasó' },
  { key: 'nav', text: 'Páginas' },
  { key: 'popup', text: 'Ventanas' },
];

/** Colores por tipo, para poder barrer la lista de un vistazo. */
const TINT: Partial<Record<DiagKind, string>> = {
  block: '#4ea36a',
  allow: '#c9762a',
  hijack: '#c4483f',
  chain: '#c4483f',
  gaveup: '#c4483f',
  flood: '#c4483f',
  nav: colors.textDim,
};

export function DiagnosticsView({
  visible,
  onClose,
  onBlockHost,
  onInspect,
  blocked,
}: {
  visible: boolean;
  onClose: () => void;
  onBlockHost: (host: string) => void;
  onInspect: () => void;
  blocked: string[];
}) {
  const events = useDiag();
  const [filter, setFilter] = useState<'todo' | DiagKind>('todo');

  // Lo último arriba: cuando algo falla, lo que importa es el final.
  const shown = useMemo(() => {
    const list = filter === 'todo' ? events : events.filter((e) => e.kind === filter);
    return [...list].reverse();
  }, [events, filter]);

  return (
    <Sheet
      visible={visible}
      title="Qué está pasando"
      onClose={onClose}
      action={
        <>
          <Pressable
            onPress={() => Share.share({ message: asText(events) }).catch(() => {})}
            hitSlop={12}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionText}>Enviar</Text>
          </Pressable>
          <Pressable
            onPress={clearDiag}
            hitSlop={12}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionText}>Limpiar</Text>
          </Pressable>
        </>
      }
    >
      <Pressable
        onPress={onInspect}
        style={({ pressed }) => [styles.inspect, pressed && styles.pressed]}
      >
        <Text style={styles.inspectText}>Inspeccionar la página ahora</Text>
        <Text style={styles.inspectSub}>
          Con el anuncio en pantalla, tocá esto: anota qué hay encimado en este momento
        </Text>
      </Pressable>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={({ pressed }) => [
              styles.chip,
              filter === f.key && styles.chipOn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.text}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={shown}
        keyExtractor={(e, i) => `${e.ts}-${i}`}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          // Los dominios que pasaron se pueden bloquear de un toque: son
          // justamente los que ninguna lista trae.
          const canBlock = item.kind === 'allow' && !blocked.includes(item.detail);
          return (
            <Pressable
              disabled={!canBlock}
              onPress={() => onBlockHost(item.detail)}
              style={({ pressed }) => [styles.row, pressed && canBlock && styles.rowPressed]}
            >
              <Text style={styles.time}>
                {new Date(item.ts).toLocaleTimeString('es', { hour12: false })}
              </Text>
              <Text style={[styles.kind, { color: TINT[item.kind] ?? colors.text }]}>
                {label(item.kind)}
              </Text>
              <Text style={styles.detail} numberOfLines={2}>
                {item.detail}
              </Text>
              {canBlock && <Text style={styles.add}>bloquear</Text>}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nada registrado todavía. Navegá un poco y volvé a abrir esto.
          </Text>
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  action: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16 },
  pressed: { backgroundColor: colors.surfaceHigh },
  actionText: { color: colors.accent, fontSize: 16 },
  inspect: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  inspectText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  inspectSub: { color: colors.textDim, fontSize: 13, marginTop: 3, lineHeight: 18 },
  filters: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'baseline',
  },
  rowPressed: { backgroundColor: colors.surface },
  add: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  time: { color: colors.textOff, fontSize: 11, fontVariant: ['tabular-nums'] },
  kind: { fontSize: 11, fontWeight: '700', width: 64 },
  detail: { color: colors.text, fontSize: 12, flex: 1 },
  empty: { color: colors.textDim, fontSize: 14, padding: 12 },
});
