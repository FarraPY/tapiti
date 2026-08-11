import { FlatList, StyleSheet, Switch, Text, View } from 'react-native';

import { Sheet } from './Sheet';
import { colors } from './theme';

/** Qué se bloqueó en la página actual, y el interruptor por sitio. */
export function ShieldsPanel({
  visible,
  host,
  blocked,
  enabled,
  gaveUp,
  popupsBlocked,
  dialogsBlocked,
  onClose,
  onToggle,
}: {
  visible: boolean;
  host: string;
  blocked: string[];
  enabled: boolean;
  gaveUp: boolean;
  popupsBlocked: number;
  dialogsBlocked: number;
  onClose: () => void;
  onToggle: (on: boolean) => void;
}) {
  return (
    <Sheet visible={visible} title="Escudos" onClose={onClose}>
      <View style={styles.head}>
        <Text style={styles.host} numberOfLines={1}>
          {host || 'sin sitio'}
        </Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Bloquear en este sitio</Text>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            trackColor={{ true: colors.accent, false: colors.line }}
          />
        </View>
        <Text style={styles.count}>
          {enabled
            ? `${blocked.length} ${blocked.length === 1 ? 'dominio bloqueado' : 'dominios bloqueados'}`
            : 'Bloqueo apagado acá'}
        </Text>
        {dialogsBlocked > 0 && (
          <Text style={styles.count}>
            {dialogsBlocked}{' '}
            {dialogsBlocked === 1 ? 'cartel cancelado' : 'carteles cancelados'}
          </Text>
        )}
        {popupsBlocked > 0 && (
          <Text style={styles.count}>
            {popupsBlocked}{' '}
            {popupsBlocked === 1
              ? 'ventana que el sitio quiso abrir solo'
              : 'ventanas que el sitio quiso abrir solo'}
          </Text>
        )}
        {!enabled && <Text style={styles.hint}>Se aplica al recargar la página.</Text>}
        {gaveUp && (
          <Text style={styles.warn}>
            Este sitio vuelve a poner los anuncios apenas se los saca. El bloqueo
            dentro de la página se soltó para no trabar la app; los dominios se
            siguen bloqueando igual.
          </Text>
        )}
      </View>

      <FlatList
        data={blocked}
        keyExtractor={(d) => d}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <Text style={styles.domain}>{item}</Text>}
        ListEmptyComponent={
          enabled ? <Text style={styles.empty}>Nada bloqueado en esta página.</Text> : null
        }
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  host: { color: colors.text, fontSize: 17, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  rowLabel: { color: colors.text, fontSize: 16 },
  count: { color: colors.accent, fontSize: 14, fontWeight: '600', marginTop: 12 },
  hint: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  warn: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginTop: 10 },
  list: { padding: 16, gap: 8 },
  domain: { color: colors.textDim, fontSize: 13 },
  empty: { color: colors.textDim, fontSize: 14 },
});
