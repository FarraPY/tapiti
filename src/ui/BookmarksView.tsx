import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconButton } from './IconButton';
import { Sheet } from './Sheet';
import { colors } from './theme';
import { hostOf } from '../blocking/shouldBlock';
import type { Bookmark } from '../bookmarks';

export function BookmarksView({
  visible,
  bookmarks,
  onClose,
  onOpen,
  onRemove,
}: {
  visible: boolean;
  bookmarks: Bookmark[];
  onClose: () => void;
  onOpen: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  return (
    <Sheet visible={visible} title="Favoritos" onClose={onClose}>
      <FlatList
        data={bookmarks}
        keyExtractor={(b) => b.url}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item.url)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title || hostOf(item.url)}
              </Text>
              <Text style={styles.host} numberOfLines={1}>
                {hostOf(item.url)}
              </Text>
            </View>
            <IconButton
              name="trash"
              onPress={() => onRemove(item.url)}
              size={16}
              tint={colors.textDim}
              style={styles.trash}
            />
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Todavía no guardaste ninguno. Usá el menú de abajo a la derecha para agregar
            la página que estés viendo.
          </Text>
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 10,
    borderRadius: 10,
  },
  rowPressed: { backgroundColor: colors.surface },
  body: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  host: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  trash: { width: 36, height: 36, borderRadius: 18 },
  empty: { color: colors.textDim, fontSize: 14, padding: 12, lineHeight: 20 },
});
