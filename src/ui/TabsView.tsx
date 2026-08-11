import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconButton } from './IconButton';
import { Sheet } from './Sheet';
import { colors } from './theme';
import { hostOf } from '../blocking/shouldBlock';

export type TabSummary = { id: string; url: string; title: string; blocked: number };

export function TabsView({
  visible,
  tabs,
  activeId,
  onClose,
  onSelect,
  onCloseTab,
  onNewTab,
  onOpenHistory,
}: {
  visible: boolean;
  tabs: TabSummary[];
  activeId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title={`${tabs.length} ${tabs.length === 1 ? 'pestaña' : 'pestañas'}`}
      onClose={onClose}
      action={
        <>
          <IconButton
            name="clock.arrow.circlepath"
            onPress={onOpenHistory}
            size={21}
            tint={colors.accent}
          />
          <IconButton name="plus" onPress={onNewTab} size={24} tint={colors.accent} />
        </>
      }
    >
      <FlatList
        data={tabs}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSelect(item.id)}
            style={({ pressed }) => [
              styles.card,
              item.id === activeId && styles.cardActive,
              pressed && styles.cardPressed,
            ]}
          >
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title || 'Pestaña nueva'}
              </Text>
              <Text style={styles.cardHost} numberOfLines={1}>
                {hostOf(item.url) || 'sin cargar'}
              </Text>
            </View>
            {item.blocked > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.blocked}</Text>
              </View>
            )}
            <IconButton
              name="xmark"
              onPress={() => onCloseTab(item.id)}
              size={15}
              tint={colors.textDim}
              style={styles.x}
            />
          </Pressable>
        )}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardActive: { borderColor: colors.accent },
  cardPressed: { backgroundColor: colors.surfaceHigh },
  cardBody: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  cardHost: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: 11,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  x: { width: 36, height: 36, borderRadius: 18 },
});
