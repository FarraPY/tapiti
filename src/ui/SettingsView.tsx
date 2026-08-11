import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { Sheet } from './Sheet';
import { colors } from './theme';
import { ENGINES, type Engine, type Settings } from '../settings';
import type { Lists, UpdateState } from '../blocking/updateLists';
import type { NativeState } from '../blocking/nativeRules';

/** Cuándo se actualizaron las listas, en palabras. */
function describeAge(updatedAt: number): string {
  if (!updatedAt) return 'Nunca actualizadas: son las que vinieron con la app';
  const days = Math.floor((Date.now() - updatedAt) / 86400000);
  if (days === 0) return 'Actualizadas hoy';
  if (days === 1) return 'Actualizadas ayer';
  return `Actualizadas hace ${days} días`;
}

export function SettingsView({
  visible,
  settings,
  onClose,
  onChange,
  onOpenDiagnostics,
  lists,
  listsState,
  onUpdateLists,
  nativeState,
  onCompileRules,
  onResetRules,
}: {
  visible: boolean;
  settings: Settings;
  onClose: () => void;
  onChange: (patch: Partial<Settings>) => void;
  onOpenDiagnostics: () => void;
  lists: Lists;
  listsState: UpdateState;
  onUpdateLists: () => void;
  nativeState: NativeState;
  onCompileRules: () => void;
  onResetRules: () => void;
}) {
  const engines = Object.keys(ENGINES) as Engine[];

  return (
    <Sheet visible={visible} title="Ajustes" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.body}>
        <Section title="Bloqueo">
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Bloquear anuncios</Text>
              <Text style={styles.sub}>Apagarlo desactiva el bloqueo en todos los sitios</Text>
            </View>
            <Switch
              value={settings.blockAds}
              onValueChange={(v) => onChange({ blockAds: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Ocultar huecos de anuncios</Text>
              <Text style={styles.sub}>
                Aparte de cortar la descarga, tapa el espacio que dejan. Si un sitio
                anda mal o cierra la app, probá apagando esto primero
              </Text>
            </View>
            <Switch
              value={settings.blockCosmetic}
              onValueChange={(v) => onChange({ blockCosmetic: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Esconderse de los detectores</Text>
              <Text style={styles.sub}>
                Para los sitios que exigen apagar el bloqueador antes de dejarte leer
              </Text>
            </View>
            <Switch
              value={settings.antiDetect}
              onValueChange={(v) => onChange({ antiDetect: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Tapar carteles encimados</Text>
              <Text style={styles.sub}>
                Los cuadros grandes que aparecen solos sobre la página. Si un sitio
                necesita mostrarte una ventana y no aparece, apagá esto
              </Text>
            </View>
            <Switch
              value={settings.blockOverlays}
              onValueChange={(v) => onChange({ blockOverlays: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
        </Section>

        <Section title="Privacidad">
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Modo privado</Text>
              <Text style={styles.sub}>
                No guarda historial ni cookies. Al apagarlo o cerrar la app, todo lo
                de esta sesión se descarta
              </Text>
            </View>
            <Switch
              value={settings.privateMode}
              onValueChange={(v) => onChange({ privateMode: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
        </Section>

        <Section title="Links">
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>Abrir en apps instaladas</Text>
              <Text style={styles.sub}>
                Apagado, los links de Instagram, WhatsApp y demás se quedan acá
              </Text>
            </View>
            <Switch
              value={settings.openInApps}
              onValueChange={(v) => onChange({ openInApps: v })}
              trackColor={{ true: colors.accent, false: colors.line }}
            />
          </View>
        </Section>

        <Section title="Buscador">
          {engines.map((e) => (
            <Pressable
              key={e}
              onPress={() => onChange({ engine: e })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.label}>{ENGINES[e].name}</Text>
              {settings.engine === e && <Text style={styles.check}>✓</Text>}
            </Pressable>
          ))}
        </Section>

        <Section title={`Sitios sin bloqueo (${settings.allowlist.length})`}>
          {settings.allowlist.length === 0 ? (
            <Text style={styles.empty}>
              Ninguno. Podés apagar el bloqueo de un sitio desde el escudo naranja.
            </Text>
          ) : (
            settings.allowlist.map((host) => (
              <View key={host} style={styles.row}>
                <Text style={styles.label} numberOfLines={1}>
                  {host}
                </Text>
                <Pressable
                  onPress={() =>
                    onChange({ allowlist: settings.allowlist.filter((h) => h !== host) })
                  }
                  hitSlop={12}
                  style={({ pressed }) => pressed && styles.dim}
                >
                  <Text style={styles.remove}>Quitar</Text>
                </Pressable>
              </View>
            ))
          )}
        </Section>

        <Section title="Motor de bloqueo">
          {nativeState.phase === 'unsupported' && (
            <>
              <Text style={styles.info}>Por JavaScript</Text>
              <Text style={styles.sub}>
                Las reglas viajan dentro de cada página. Es lo que hay en Expo Go; la
                versión compilada usa el motor del sistema
              </Text>
            </>
          )}
          {nativeState.phase === 'idle' && (
            <>
              <Text style={styles.info}>Por JavaScript</Text>
              <Text style={styles.sub}>
                {nativeState.failedBefore
                  ? 'La compilación anterior quedó a medias y se limpió. Podés volver a intentarla.'
                  : 'Podés pasar al motor del sistema: bloquea antes de que el pedido salga del teléfono, también dentro de los marcos, y no pesa en cada página.'}
              </Text>
              <Pressable
                onPress={onCompileRules}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={[styles.label, styles.action]}>Activar bloqueo nativo</Text>
              </Pressable>
              <Text style={styles.sub}>
                Tarda unos minutos y se hace una sola vez. Dejá la app abierta mientras
                trabaja
              </Text>
            </>
          )}
          {nativeState.phase === 'compiling' && (
            <>
              <Text style={styles.info}>
                Compilando… {Math.round((nativeState.done / nativeState.total) * 100)}%
              </Text>
              <Text style={styles.sub}>
                Tanda {nativeState.done + 1} de {nativeState.total}. No cierres la app.
                Se hace una sola vez; después queda guardado
              </Text>
            </>
          )}
          {nativeState.phase === 'ready' && (
            <>
              <Text style={styles.info}>Nativo, en la capa de red</Text>
              <Text style={styles.sub}>
                {nativeState.ids.length} listas compiladas. Se aplican antes de que el
                pedido salga del teléfono, también dentro de los marcos, y no pesan en
                cada página
              </Text>
              <Pressable
                onPress={onResetRules}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={[styles.label, styles.action]}>Volver a JavaScript</Text>
              </Pressable>
            </>
          )}
          {nativeState.phase === 'error' && (
            <>
              <Text style={styles.fail}>
                No se pudieron compilar las reglas: {nativeState.message}. Sigue el
                bloqueo por JavaScript.
              </Text>
              <Pressable
                onPress={onResetRules}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={[styles.label, styles.action]}>Limpiar y reintentar</Text>
              </Pressable>
            </>
          )}
        </Section>

        <Section title="Diagnóstico">
          <Pressable
            onPress={onOpenDiagnostics}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.label}>Qué está pasando</Text>
              <Text style={styles.sub}>
                Todo lo que la app corta y lo que deja pasar, en vivo. Si un anuncio
                se cuela o algo falla, la respuesta está acá
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Section>

        <Section title="Listas de bloqueo">
          <Text style={styles.info}>{lists.counts.hosts.toLocaleString('es')} dominios conocidos</Text>
          <Text style={styles.info}>
            {lists.counts.sites.toLocaleString('es')} sitios con reglas propias
          </Text>
          <Text style={styles.sub}>
            AdAway · Peter Lowe · EasyPrivacy · EasyList · EasyList Spanish
          </Text>
          <Text style={[styles.sub, styles.age]}>{describeAge(lists.updatedAt)}</Text>

          <Pressable
            onPress={onUpdateLists}
            disabled={listsState.phase === 'running'}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Text style={[styles.label, styles.action]}>
              {listsState.phase === 'running' ? 'Actualizando…' : 'Actualizar ahora'}
            </Text>
            {listsState.phase === 'running' && <ActivityIndicator color={colors.accent} />}
          </Pressable>

          {listsState.phase === 'running' && (
            <Text style={styles.progress}>{listsState.step}</Text>
          )}
          {listsState.phase === 'done' && (
            <Text style={styles.ok}>
              Listo: {listsState.counts.hosts.toLocaleString('es')} dominios y{' '}
              {listsState.counts.sites.toLocaleString('es')} sitios. Recargá la página
              para que se aplique.
            </Text>
          )}
          {listsState.phase === 'error' && (
            <Text style={styles.fail}>
              No se pudo actualizar: {listsState.message}. Se siguen usando las listas
              anteriores.
            </Text>
          )}
        </Section>
      </ScrollView>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24, paddingBottom: 40 },
  section: { gap: 8 },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingLeft: 4,
  },
  card: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
  },
  rowPressed: { opacity: 0.5 },
  dim: { opacity: 0.5 },
  rowText: { flex: 1 },
  label: { color: colors.text, fontSize: 16, flexShrink: 1 },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  check: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  chevron: { color: colors.textDim, fontSize: 22 },
  remove: { color: colors.accent, fontSize: 15 },
  empty: { color: colors.textDim, fontSize: 14, paddingVertical: 14 },
  info: { color: colors.text, fontSize: 15, paddingTop: 14 },
  age: { paddingBottom: 4 },
  action: { color: colors.accent, fontWeight: '600' },
  progress: { color: colors.textDim, fontSize: 13, paddingBottom: 14 },
  ok: { color: '#4ea36a', fontSize: 13, paddingBottom: 14, lineHeight: 18 },
  fail: { color: '#c4483f', fontSize: 13, paddingBottom: 14, lineHeight: 18 },
});
