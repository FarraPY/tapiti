import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  findNodeHandle,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { SymbolView } from 'expo-symbols';

import {
  CLEAR_FIND,
  GESTURE_TRACKER,
  INSPECT_SNIPPET,
  buildBlocker,
  findSnippet,
  siteCssSnippet,
} from './src/blocking/injected';
import { useBookmarks } from './src/bookmarks';
import { BookmarksView } from './src/ui/BookmarksView';
import { FindBar } from './src/ui/FindBar';
import { sameSite } from './src/blocking/heuristics';
import {
  hostOf,
  setBlockedHosts,
  shouldBlock,
  shouldBlockFrom,
} from './src/blocking/shouldBlock';
import { setSiteCss, siteCssFor } from './src/blocking/siteCss';
import { useLists } from './src/blocking/updateLists';
import type { NativeState } from './src/blocking/nativeRules';
import { diag, type DiagKind } from './src/diag';
import { suggest, useHistory, type Visit } from './src/history';
import { useSession } from './src/session';
import { ENGINES, blockingOn, isAppLink, toUrl, useSettings, type Settings } from './src/settings';
import { DiagnosticsView } from './src/ui/DiagnosticsView';
import { HistoryView } from './src/ui/HistoryView';
import { IconButton } from './src/ui/IconButton';
import { ShieldsPanel } from './src/ui/ShieldsPanel';
import { SettingsView } from './src/ui/SettingsView';
import { TabsView } from './src/ui/TabsView';
import { colors } from './src/ui/theme';

type Tab = {
  id: string;
  /** Lo que se le pide cargar. Cambia solo desde la barra de direcciones. */
  uri: string;
  /** Dónde está parada de verdad. */
  url: string;
  title: string;
  blocked: string[];
  canGoBack: boolean;
  canGoForward: boolean;
  progress: number;
  /** Si tiene una WKWebView montada. Las dormidas no gastan memoria. */
  live: boolean;
  /** El bloqueo dentro de la página se soltó para no colgarla. */
  gaveUp: boolean;
  /** Ventanas que la página quiso abrir sola. */
  popupsBlocked: number;
  /** Carteles del sistema que el sitio quiso mostrar. */
  dialogsBlocked: number;
};

type Panel = 'tabs' | 'settings' | 'shields' | 'history' | 'diag' | 'bookmarks' | null;

/**
 * Cuántas pestañas se mantienen cargadas a la vez. Cada una es una WKWebView con
 * su página entera en memoria: de más, iOS cierra la app. Las que pasan de este
 * tope se duermen y se recargan solas cuando volvés a ellas.
 */
const MAX_LIVE = 2;

/** Tope duro de pestañas. Coincide con lo que la sesión guarda. */
const MAX_TABS = 20;

/**
 * Cuánto vale un toque tuyo para autorizar una ventana nueva. Pasado ese rato,
 * la página que pide abrir algo lo hace sola y no se le da pestaña.
 */
const GESTURE_MS = 1500;

/** Cuántos saltos de página seguidos se toleran sin que vos los pidas, y en cuánto rato. */
const MAX_REDIRECTS = 4;
const REDIRECT_WINDOW_MS = 10000;

/**
 * Todo lo que pasa va al registro de la app (Ajustes → Qué está pasando) y también
 * a la terminal de Expo, que es lo único que sobrevive si iOS cierra la app de golpe.
 */
function log(tab: string, kind: DiagKind, detail: string) {
  diag(tab, kind, detail);
  console.log('[escudo]', kind, tab, detail);
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Browser />
    </SafeAreaProvider>
  );
}

function Browser() {
  const { settings, update, loaded: settingsLoaded } = useSettings();
  const { history, visit, clear: clearHistory } = useHistory();
  const { bookmarks, add: addBookmark, remove: removeBookmark, has: isBookmarked } = useBookmarks();
  const session = useSession();
  const listsState = useLists();
  const lists = listsState.lists;
  const nativeReady = false;

  const nextId = useRef(0);
  const webRefs = useRef<Record<string, WebView | null>>({});
  /** Pestañas de la más usada recientemente a la menos. */
  const liveOrder = useRef<string[]>([]);
  /** Cuándo tocaste un enlace por última vez dentro de una página. */
  const lastGesture = useRef(0);
  /** Cuándo pediste vos una dirección desde la barra. */
  const userNav = useRef(0);
  /** A dónde decía llevar el último enlace que tocaste, y desde qué página. */
  const expected = useRef<{ href: string; page: string }>({ href: '', page: '' });
  /** Última foto que tocaste para agrandar, y cuándo. */
  const thumbNav = useRef<{ url: string; at: number }>({ url: '', at: 0 });

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [showNotice, setShowNotice] = useState(true);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<boolean | null>(null);

  // El script se arma una vez y lo comparten todas las pestañas: es un megabyte,
  // rehacerlo en cada dibujado sería caro.
  const blocker = useMemo(
    () =>
      buildBlocker(
        // Con las reglas compiladas, los dominios y el CSS genérico los aplica
        // WebKit: mandarlos otra vez dentro de cada página sería pagar dos veces.
        // El script queda solo con lo que WebKit no puede hacer — las defensas de
        // comportamiento — y pasa de un megabyte a unos pocos kilobytes.
        settings.blockCosmetic && !nativeReady,
        settings.blocklist,
        settings.blockOverlays,
        nativeReady ? '' : lists.core,
        nativeReady ? '' : lists.generic,
        settings.antiDetect
      ),
    [
      settings.blockCosmetic,
      settings.blocklist,
      settings.blockOverlays,
      settings.antiDetect,
      lists,
      nativeReady,
    ]
  );

  const ready = settingsLoaded && session.loaded && listsState.loaded;

  // Las listas descargadas reemplazan a las del programa en los dos lados: el que
  // vive en la app y el que viaja dentro de cada página.
  useEffect(() => {
    setBlockedHosts(listsState.lists.hosts);
    setSiteCss(listsState.lists.sites);
  }, [listsState.lists]);

  // Arranque: restaurar las pestañas de la última vez, o abrir una en el inicio.
  useEffect(() => {
    if (!ready || tabs.length > 0) return;
    const saved = session.restored;
    if (saved?.tabs.length) {
      const activeIdx = Math.min(saved.activeIndex, saved.tabs.length - 1);
      // Solo la pestaña que estabas mirando arranca cargada. Montarlas todas de
      // golpe es lo que hacía que iOS cerrara la app al abrirla.
      const restored = saved.tabs.map((t, i) => ({
        ...newTab(String(i), t.url, i === activeIdx),
        title: t.title,
      }));
      nextId.current = restored.length;
      setTabs(restored);
      setActiveId(restored[activeIdx].id);
    } else {
      const first = newTab('0', ENGINES[settings.engine].home);
      nextId.current = 1;
      setTabs([first]);
      setActiveId(first.id);
    }
  }, [ready]);

  // Guardar la sesión cada vez que cambian las pestañas o cuál está al frente.
  useEffect(() => {
    if (!ready || tabs.length === 0) return;
    session.save({
      tabs: tabs.map((t) => ({ url: t.url, title: t.title })),
      activeIndex: Math.max(
        0,
        tabs.findIndex((t) => t.id === activeId)
      ),
    });
  }, [tabs, activeId, ready]);

  // La pestaña al frente se despierta, y las que hace rato no tocás se duermen.
  useEffect(() => {
    if (!activeId) return;
    liveOrder.current = [activeId, ...liveOrder.current.filter((id) => id !== activeId)];
    const keep = new Set(liveOrder.current.slice(0, MAX_LIVE));
    setTabs((ts) =>
      ts.map((t) => {
        const live = t.id === activeId || (t.live && keep.has(t.id));
        if (live === t.live) return t;
        log(t.id, 'app', `${live ? 'despierta' : 'duerme'} · ${hostOf(t.url)}`);
        // Al dormirla se apunta dónde estaba, para volver ahí y no al inicio.
        return live ? { ...t, live } : { ...t, live, uri: t.url, progress: 1 };
      })
    );
  }, [activeId]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const activeHost = active ? hostOf(active.url) : '';
  const shieldsOn = blockingOn(settings, activeHost);
  const suggestions = editing ? suggest(history, address) : [];

  function patchTab(id: string, patch: Partial<Tab>) {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function openTab(uri = ENGINES[settings.engine].home) {
    if (tabs.length >= MAX_TABS) return;
    const id = String(nextId.current++);
    setTabs((ts) => [...ts, newTab(id, uri)]);
    setActiveId(id);
    setPanel(null);
  }

  /**
   * Ventana pedida por la página. Solo se abre si viene de un toque tuyo reciente:
   * los popunders de publicidad se disparan solos y acá se quedan afuera.
   */
  function openFromPage(fromTabId: string, url: string) {
    const denied = () =>
      patchTab(fromTabId, {
        popupsBlocked: (tabs.find((t) => t.id === fromTabId)?.popupsBlocked ?? 0) + 1,
      });

    const age = lastGesture.current ? Date.now() - lastGesture.current : Infinity;

    // Una ventana en blanco es la firma del popunder: el sitio la abre vacía para
    // escribirle la publicidad después. Acá no sirve de nada — la referencia a esa
    // ventana se queda del lado nativo y la pestaña nunca mostraría nada.
    if (!/^https?:\/\//i.test(url)) {
      log(fromTabId, 'popup', `rechazada (ventana en blanco): ${url.slice(0, 60)}`);
      return denied();
    }
    if (age > GESTURE_MS) {
      log(fromTabId, 'popup', `rechazada (sin toque tuyo): ${url.slice(0, 60)}`);
      return denied();
    }
    // Un toque autoriza UNA ventana y se gasta. Sin esto, dentro del rato que dura
    // el permiso el sitio abría una cascada de ventanas, cada una con su página.
    lastGesture.current = 0;
    if (shouldBlock(url)) {
      log(fromTabId, 'popup', `rechazada (dominio en la lista): ${hostOf(url)}`);
      addBlocked(fromTabId, hostOf(url));
      return;
    }
    log(fromTabId, 'popup', `aceptada (tocaste un enlace): ${url.slice(0, 60)}`);
    openTab(url);
  }

  function closeTab(id: string) {
    const rest = tabs.filter((t) => t.id !== id);
    if (rest.length === 0) {
      const fresh = newTab(String(nextId.current++), ENGINES[settings.engine].home);
      setTabs([fresh]);
      setActiveId(fresh.id);
    } else {
      setTabs(rest);
      if (id === activeId) setActiveId(rest[rest.length - 1].id);
    }
    delete webRefs.current[id];
  }

  /** Suma un dominio al contador de la pestaña, leyendo siempre el estado fresco:
   *  los avisos de bloqueo llegan en ráfaga y se pisarían entre sí. */
  function addBlocked(id: string, host: string) {
    if (!host) return;
    setTabs((ts) =>
      ts.map((t) => {
        if (t.id !== id || t.blocked.includes(host)) return t;
        // Se anota una sola vez por página: estos sitios reintentan el mismo
        // dominio decenas de veces y el registro quedaba ilegible.
        log(id, 'block', host);
        return { ...t, blocked: [...t.blocked, host] };
      })
    );
  }

  function navigate(url: string) {
    // Marca de que esta navegación la pediste vos, no un script de la página.
    userNav.current = Date.now();
    patchTab(active.id, { uri: url, url });
    setEditing(false);
    // Al elegir una sugerencia el campo conserva el foco, así que el teclado
    // quedaba tapando media pantalla sobre la página ya cargada.
    Keyboard.dismiss();
  }

  /**
   * ¿Autorizaste vos que la pestaña se vaya a otro lado? Vale si acabás de escribir
   * una dirección o de tocar un enlace. Si no, es la página redirigiéndose sola.
   */
  /**
   * Solo decide sobre destinos que ya dieron positivo como publicidad. Un toque
   * autoriza ir **a donde decía el enlace**, no a cualquier lado: si no, alcanzaba
   * con que tocaras cualquier cosa para que el sitio te mandara a su redirector.
   */
  function navAuthorized(url: string) {
    const now = Date.now();
    // Lo escribiste vos en la barra: es tu decisión y va.
    if (now - userNav.current < GESTURE_MS) return true;
    // Sin toque reciente sobre un enlace, la página se está yendo sola.
    if (now - lastGesture.current >= GESTURE_MS) return false;
    const href = expected.current.href;
    return !!href && sameSite(hostOf(href), hostOf(url));
  }

  /**
   * ¿El toque terminó donde decía el enlace? Si tocaste un enlace interno del sitio
   * y la navegación se va a otro dominio, alguien te desvió el click. Solo se juzga
   * ese caso: un enlace que ya apuntaba afuera puede redirigir con todo derecho.
   */
  /**
   * Cortar un secuestro cancela la navegación entera, también la tuya: el sitio
   * mete su redirección encima del mismo viaje que vos empezaste. Así que después
   * de cortarla hay que volver a mandarte a donde ibas.
   */
  function rescueNav(tabId: string) {
    const href = expected.current.href;
    // Se consume: si el rescate vuelve a ser secuestrado, no se reintenta en bucle.
    expected.current = { href: '', page: '' };
    if (!href || !/^https?:\/\//i.test(href)) return;
    // Solo se rescata hacia el mismo sitio. Si el enlace que tocaste ya salía
    // afuera, devolverte ahí sería llevarte al anuncio con mis propias manos:
    // el rescate existe para recuperar tu navegación dentro del sitio.
    const page = tabs.find((t) => t.id === tabId)?.url ?? '';
    if (!sameSite(hostOf(href), hostOf(page))) return;
    if (shouldBlockFrom(href, hostOf(page), settings.blocklist)) return;
    log(tabId, 'app', `te devuelvo a donde ibas: ${href.slice(0, 60)}`);
    patchTab(tabId, { uri: href, url: href });
  }

  /** ¿Esta navegación es la foto que acabás de agrandar en el lugar? */
  function isThumbNav(url: string): boolean {
    const { url: thumb, at } = thumbNav.current;
    return !!thumb && Date.now() - at < 2500 && url === thumb;
  }

  function hijackedClick(url: string): boolean {
    const { href, page } = expected.current;
    if (!href || !page) return false;
    const site = hostOf(page);
    // Solo se juzga el caso claro: tocaste un enlace del propio sitio.
    if (!site || !sameSite(hostOf(href), site)) return false;
    const dest = hostOf(url);
    return !!dest && !sameSite(dest, site);
  }

  /** Menú de la página. Se usa el de iOS para que se vea y se sienta del sistema. */
  function openMenu() {
    const fav = isBookmarked(active.url);
    const options = [
      fav ? 'Quitar de favoritos' : 'Agregar a favoritos',
      'Ver favoritos',
      'Buscar en esta página',
      'Compartir',
      'Ajustes',
      'Cancelar',
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: 5, userInterfaceStyle: 'dark', title: hostOf(active.url) },
      (i) => {
        if (i === 0) {
          if (fav) removeBookmark(active.url);
          else addBookmark(active.url, active.title);
        } else if (i === 1) setPanel('bookmarks');
        else if (i === 2) {
          setFound(null);
          setFinding(true);
        } else if (i === 3) {
          Share.share({ message: active.url, url: active.url }).catch(() => {});
        } else if (i === 4) setPanel('settings');
      }
    );
  }

  function search(text: string, opts: { backwards?: boolean; reset?: boolean }) {
    webRefs.current[activeId]?.injectJavaScript(findSnippet(text, opts));
  }

  function closeFind() {
    setFinding(false);
    setFound(null);
    webRefs.current[activeId]?.injectJavaScript(CLEAR_FIND);
  }

  function toggleSiteBlocking(on: boolean) {
    if (!activeHost) return;
    const allowlist = on
      ? settings.allowlist.filter((h) => h !== activeHost)
      : [...settings.allowlist, activeHost];
    update({ allowlist });
    // El script inyectado se fija al cargar la página, así que hay que recargar.
    webRefs.current[active.id]?.reload();
  }

  if (!ready || !active) return <View style={styles.root} />;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.bar}>
          <TextInput
            style={styles.input}
            value={editing ? address : active.url}
            onChangeText={setAddress}
            onFocus={() => {
              setAddress(active.url);
              setEditing(true);
            }}
            onBlur={() => setEditing(false)}
            onSubmitEditing={() => navigate(toUrl(address, settings.engine))}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
            placeholder={`Buscar en ${ENGINES[settings.engine].name}`}
            placeholderTextColor={colors.textDim}
          />
          <Pressable
            onPress={() => setPanel('shields')}
            hitSlop={6}
            style={({ pressed }) => [
              styles.shield,
              !shieldsOn && styles.shieldOff,
              pressed && styles.shieldPressed,
            ]}
          >
            <SymbolView
              name={shieldsOn ? 'checkmark.shield.fill' : 'shield.slash.fill'}
              size={17}
              tintColor="#fff"
              resizeMode="scaleAspectFit"
              style={styles.shieldIcon}
            />
            {shieldsOn && <Text style={styles.shieldText}>{active.blocked.length}</Text>}
          </Pressable>
        </View>

        <ProgressBar value={active.progress} />

        {finding && <FindBar found={found} onSearch={search} onClose={closeFind} />}

        {session.recovered && showNotice && (
          <Pressable
            onPress={() => setShowNotice(false)}
            style={({ pressed }) => [styles.notice, pressed && styles.noticePressed]}
          >
            <Text style={styles.noticeText}>
              La app se cerró sola la última vez, así que empezó de nuevo sin las pestañas
              guardadas. Tocá para cerrar este aviso.
            </Text>
          </Pressable>
        )}

        {/* Las pestañas se apilan una sobre otra y la inactiva se vuelve invisible,
            no se oculta con display:none: una WKWebView fuera de pantalla la purga
            iOS y al volver recargaría desde el inicio, perdiendo dónde estabas. */}
        <View style={styles.webArea}>
          {tabs.map((tab) => {
            if (!tab.live) return null;
            const isActive = tab.id === activeId;
            return (
              <View
                key={tab.id}
                style={[StyleSheet.absoluteFill, !isActive && styles.behind]}
                pointerEvents={isActive ? 'auto' : 'none'}
              >
                <TabWebView
                  // Cambiar de modo privado exige una vista nueva: el almacén de
                  // cookies se elige al crearla y no se puede cambiar en caliente.
                  key={settings.privateMode ? 'priv' : 'norm'}
                  tab={tab}
                  settings={settings}
                  blocker={blocker}
                  onRef={(r) => {
                    webRefs.current[tab.id] = r;
                  }}
                  onPatch={(patch) => patchTab(tab.id, patch)}
                  onBlocked={(host) => addBlocked(tab.id, host)}
                  onVisit={visit}
                  onOpenTab={(url) => openFromPage(tab.id, url)}
                  onLinkTab={(url) => {
                    log(tab.id, 'popup', `enlace tuyo a pestaña nueva: ${url.slice(0, 60)}`);
                    openTab(url);
                  }}
                  onGesture={(href, page) => {
                    lastGesture.current = Date.now();
                    expected.current = { href, page };
                  }}
                  isAuthorized={navAuthorized}
                  isHijacked={hijackedClick}
                  isThumbNav={isThumbNav}
                  onThumb={(url) => {
                    thumbNav.current = { url, at: Date.now() };
                  }}
                  onFind={setFound}
                  nativeState={{ phase: 'unsupported' }}
                  onRescue={() => rescueNav(tab.id)}
                />
              </View>
            );
          })}

          {suggestions.length > 0 && (
            <Suggestions items={suggestions} onPick={(url) => navigate(url)} />
          )}
        </View>

        <View style={styles.nav}>
          <IconButton
            name="chevron.backward"
            disabled={!active.canGoBack}
            onPress={() => webRefs.current[active.id]?.goBack()}
          />
          <IconButton
            name="chevron.forward"
            disabled={!active.canGoForward}
            onPress={() => webRefs.current[active.id]?.goForward()}
          />
          <IconButton
            name="arrow.clockwise"
            onPress={() => webRefs.current[active.id]?.reload()}
          />
          <IconButton
            name="square.on.square"
            badge={tabs.length}
            onPress={() => setPanel('tabs')}
          />
          <IconButton name="ellipsis.circle" onPress={openMenu} />
        </View>
      </KeyboardAvoidingView>

      <TabsView
        visible={panel === 'tabs'}
        tabs={tabs.map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          blocked: t.blocked.length,
        }))}
        activeId={activeId}
        onClose={() => setPanel(null)}
        onSelect={(id) => {
          setActiveId(id);
          setPanel(null);
        }}
        onCloseTab={closeTab}
        onNewTab={() => openTab()}
        onOpenHistory={() => setPanel('history')}
      />

      <BookmarksView
        visible={panel === 'bookmarks'}
        bookmarks={bookmarks}
        onClose={() => setPanel(null)}
        onOpen={(url) => {
          openTab(url);
          setPanel(null);
        }}
        onRemove={removeBookmark}
      />

      <HistoryView
        visible={panel === 'history'}
        history={history}
        onClose={() => setPanel(null)}
        onOpen={(url) => {
          openTab(url);
          setPanel(null);
        }}
        onClear={clearHistory}
      />

      <SettingsView
        visible={panel === 'settings'}
        settings={settings}
        onClose={() => setPanel(null)}
        onChange={update}
        onOpenDiagnostics={() => setPanel('diag')}
        lists={lists}
        listsState={listsState.state}
        onUpdateLists={listsState.update}
        nativeState={{ phase: 'unsupported' }}
        onCompileRules={() => {}}
        onResetRules={() => {}}
      />

      {panel === 'diag' && (
        <DiagnosticsView
          visible
          onClose={() => setPanel(null)}
          blocked={settings.blocklist}
          onInspect={() => {
            log(activeId, 'app', '--- inspección pedida ---');
            webRefs.current[activeId]?.injectJavaScript(INSPECT_SNIPPET);
          }}
          onBlockHost={(host) => {
            update({ blocklist: [...settings.blocklist, host] });
            log('0', 'app', `bloqueaste ${host} a mano`);
          }}
        />
      )}

      <ShieldsPanel
        visible={panel === 'shields'}
        host={activeHost}
        blocked={active.blocked}
        enabled={shieldsOn}
        gaveUp={active.gaveUp}
        popupsBlocked={active.popupsBlocked}
        dialogsBlocked={active.dialogsBlocked}
        onClose={() => setPanel(null)}
        onToggle={toggleSiteBlocking}
      />
    </SafeAreaView>
  );
}

function TabWebView({
  tab,
  settings,
  blocker,
  onRef,
  onPatch,
  onBlocked,
  onVisit,
  onOpenTab,
  onLinkTab,
  onGesture,
  isAuthorized,
  isHijacked,
  isThumbNav,
  onThumb,
  onFind,
  nativeState,
  onRescue,
}: {
  tab: Tab;
  settings: Settings;
  /** Script ya armado con las listas en uso. Se calcula una vez para todas las pestañas. */
  blocker: string;
  onRef: (r: WebView | null) => void;
  onPatch: (patch: Partial<Tab>) => void;
  onBlocked: (host: string) => void;
  onVisit: (url: string, title: string) => void;
  onOpenTab: (url: string) => void;
  onLinkTab: (url: string) => void;
  onGesture: (href: string, page: string) => void;
  isAuthorized: (url: string) => boolean;
  isHijacked: (url: string) => boolean;
  isThumbNav: (url: string) => boolean;
  onThumb: (url: string) => void;
  onFind: (found: boolean) => void;
  nativeState: NativeState;
  onRescue: () => void;
}) {
  const ref = useRef<WebView | null>(null);
  // ponytail: el script se decide con el host de la página actual, así que al
  // salir de un sitio de la allowlist la primera carga arrastra su ajuste. El
  // panel de escudos recarga la pestaña, que es el caso que importa.
  const on = blockingOn(settings, hostOf(tab.url));
  // Un objeto nuevo en cada render hace que el WebView vuelva a cargar la URL.
  const source = useMemo(() => ({ uri: tab.uri }), [tab.uri]);
  /** Cuándo empezó cada navegación de la pestaña entera, para detectar cadenas. */
  const navTimes = useRef<number[]>([]);

  return (
    <WebView
      ref={(r) => {
        ref.current = r;
        onRef(r);
      }}
      source={source}
      style={styles.web}
      injectedJavaScriptBeforeContentLoaded={on ? blocker : GESTURE_TRACKER}
      // Se inyecta en TODOS los marcos, no solo en la página principal: un cartel
      // dibujado dentro de un marco de publicidad quedaba fuera de alcance. El
      // script se ocupa solo de cargar lo pesado cuando está en la página principal.
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
      onNavigationStateChange={(nav: WebViewNavigation) => {
        onPatch({
          canGoBack: nav.canGoBack,
          canGoForward: nav.canGoForward,
          title: nav.title || tab.title,
          ...(nav.loading ? null : { url: nav.url }),
        });
        // En modo privado no queda rastro de por dónde anduviste.
        if (!nav.loading && !settings.privateMode) onVisit(nav.url, nav.title || '');
      }}
      onLoadStart={(e) => {
        log(tab.id, 'nav', `abriendo ${e.nativeEvent.url.slice(0, 70)}`);
        onPatch({
          blocked: [],
          progress: 0.05,
          gaveUp: false,
          popupsBlocked: 0,
          dialogsBlocked: 0,
        });
      }}
      onLoadProgress={(e) => onPatch({ progress: e.nativeEvent.progress })}
      onLoadEnd={(e) => {
        log(
          tab.id,
          'nav',
          `lista ${hostOf(e.nativeEvent.url)} ${on ? '(con escudo)' : '(SIN escudo)'}`
        );
        onPatch({ progress: 1 });
        if (!on) return;
        // ponytail: las reglas por sitio se aplican al terminar la carga, no en
        // document-start — el mapa entero (564 KB) no puede viajar en cada página.
        // Se ve un parpadeo del anuncio. Lo cierra WKContentRuleList en Fase 2.
        const css = siteCssFor(hostOf(e.nativeEvent.url));
        if (css) ref.current?.injectJavaScript(siteCssSnippet(css));
      }}
      // Un link con target="_blank" no abre nada por su cuenta en WKWebView:
      // hay que darle una pestaña nosotros. Acá entran también los popunders de
      // publicidad, así que quien recibe esto los filtra antes de abrir nada.
      onOpenWindow={(e) => {
        const url = e.nativeEvent.targetUrl;
        if (url && !isAppLink(url)) onOpenTab(url);
      }}
      onMessage={(e) => {
        try {
          const msg = JSON.parse(e.nativeEvent.data);
          if (msg.type === 'blocked' && msg.host) onBlocked(msg.host);
          else if (msg.type === 'allow' && msg.host) log(tab.id, 'allow', msg.host);
          else if (msg.type === 'gesture') onGesture(msg.href || '', msg.page || '');
          // Enlace a pestaña nueva, ya confirmado como toque real dentro de la
          // página. No pasa por el filtro de ventanas emergentes.
          else if (msg.type === 'opentab' && msg.url) onLinkTab(msg.url);
          // Tocaste una foto: ya se agrandó en el lugar, así que ninguna
          // navegación a esa imagen tiene sentido en los próximos segundos.
          else if (msg.type === 'thumb' && msg.url) onThumb(msg.url);
          else if (msg.type === 'find') onFind(!!msg.found);
          else if (msg.type === 'gaveup') {
            log(tab.id, 'gaveup', 'el sitio reinserta anuncios sin parar; se soltó');
            onPatch({ gaveUp: true });
          } else if (msg.type === 'flood') {
            log(tab.id, 'flood', `${msg.n} cortes seguidos: algo reintenta en bucle`);
          } else if (msg.type === 'inspect') {
            log(tab.id, 'app', `encimados: ${msg.frames} marcos en la página`);
            for (const it of msg.items || []) log(tab.id, 'app', `  ${it}`);
          } else if (msg.type === 'overlay') {
            log(tab.id, 'block', `cartel encimado tapado (${msg.n})`);
          } else if (msg.type === 'dialog') {
            log(tab.id, 'dialog', 'cartel del sitio cancelado');
            onPatch({ dialogsBlocked: msg.n });
          }
          // window.open cortado dentro de la página: nunca llega a onOpenWindow.
          else if (msg.type === 'popup') onPatch({ popupsBlocked: tab.popupsBlocked + 1 });
        } catch {
          // mensaje ajeno a nuestro protocolo, se ignora
        }
      }}
      onShouldStartLoadWithRequest={(req) => {
        // Saltos a apps instaladas (instagram://, whatsapp://…).
        if (isAppLink(req.url)) {
          if (settings.openInApps) Linking.openURL(req.url).catch(() => {});
          return false;
        }

        // Cadena de redirecciones: las de publicidad encadenan saltos por dominios
        // recién creados, que nunca van a estar en ninguna lista. Se cuenta el
        // patrón en lugar del dominio. Una cadena legítima (un login, un acortador)
        // son dos o tres saltos; estas dan vueltas sin parar hasta agotar la memoria.
        if (req.isTopFrame !== false) {
          // La foto que acabás de agrandar no tiene que abrirse además a pantalla
          // completa. El sitio te manda ahí por su cuenta, sin pasar por el enlace.
          if (isThumbNav(req.url)) {
            log(tab.id, 'app', 'foto ya agrandada, no se abre aparte');
            return false;
          }
          // Tocaste un enlace del sitio y esto va a parar a otro lado.
          if (isHijacked(req.url)) {
            log(tab.id, 'hijack', `toque desviado a ${req.url.slice(0, 60)}`);
            onRescue();
            return false;
          }
          // Moverse dentro del mismo sitio no es una cadena: es navegar. Solo
          // cuentan los saltos que cambian de dominio, que es lo que hacen estas
          // cadenas de publicidad al rebotar de un lado a otro.
          const from = hostOf(tab.url);
          const to = hostOf(req.url);
          if (to && from && to !== from) {
            const now = Date.now();
            const recent = navTimes.current.filter((t) => now - t < REDIRECT_WINDOW_MS);
            if (recent.length >= MAX_REDIRECTS && !isAuthorized(req.url)) {
              log(tab.id, 'chain', `salto ${recent.length + 1} a ${req.url.slice(0, 50)}`);
              return false;
            }
            navTimes.current = [...recent, now];
          }
        }
        if (!on || !shouldBlockFrom(req.url, hostOf(tab.url), settings.blocklist)) return true;

        // Los iframes de anuncios se cortan siempre.
        if (req.isTopFrame === false) {
          onBlocked(hostOf(req.url));
          return false;
        }
        // La pestaña entera yéndose a un dominio de publicidad solo se permite si
        // vos lo pediste. Si no, es el sitio secuestrando la pestaña para pasarla
        // por una cadena de redirecciones — que es lo que terminaba cerrando la app.
        if (!isAuthorized(req.url)) {
          log(tab.id, 'hijack', `la página se fue sola a ${req.url.slice(0, 60)}`);
          onRescue();
          return false;
        }
        return true;
      }}
      incognito={settings.privateMode}
      renderError={(domain, code, desc) => (
        <ErrorPage message={desc} onRetry={() => ref.current?.reload()} />
      )}
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled
      allowsInlineMediaPlayback
      // Todo pasa por el filtro de arriba. Con la lista por defecto, cada iframe
      // con srcdoc terminaba en un intento de abrirlo como app y llenaba de avisos.
      originWhitelist={['*']}
    />
  );
}

/** Pantalla propia cuando la página no carga, en vez del error crudo del sistema. */
function ErrorPage({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <View style={styles.error}>
      <SymbolView
        name="wifi.exclamationmark"
        size={44}
        tintColor={colors.textDim}
        resizeMode="scaleAspectFit"
        style={styles.errorIcon}
      />
      <Text style={styles.errorTitle}>No se pudo abrir la página</Text>
      <Text style={styles.errorText}>
        Puede ser que no tengas internet, o que el sitio no esté respondiendo.
      </Text>
      {!!message && (
        <Text style={styles.errorDetail} numberOfLines={3}>
          {message}
        </Text>
      )}
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
      >
        <Text style={styles.retryText}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

function ProgressBar({ value }: { value: number }) {
  if (value >= 1 || value <= 0) return null;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(value * 100)}%` }]} />
    </View>
  );
}

function Suggestions({ items, onPick }: { items: Visit[]; onPick: (url: string) => void }) {
  return (
    <View style={styles.suggestions}>
      <ScrollView keyboardShouldPersistTaps="handled">
        {items.map((v) => (
          <Pressable
            key={v.url}
            onPress={() => onPick(v.url)}
            style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
          >
            <Text style={styles.suggestionTitle} numberOfLines={1}>
              {v.title || hostOf(v.url)}
            </Text>
            <Text style={styles.suggestionUrl} numberOfLines={1}>
              {v.url}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function newTab(id: string, uri: string, live = true): Tab {
  return {
    id,
    uri,
    url: uri,
    title: '',
    blocked: [],
    canGoBack: false,
    canGoForward: false,
    progress: 1,
    live,
    gaveUp: false,
    popupsBlocked: 0,
    dialogsBlocked: 0,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  shield: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 40,
    minWidth: 44,
    borderRadius: 20,
    paddingHorizontal: 11,
    backgroundColor: colors.accent,
  },
  shieldOff: { backgroundColor: colors.surfaceHigh },
  shieldPressed: { opacity: 0.6 },
  shieldIcon: { width: 17, height: 17 },
  shieldText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  progressTrack: { height: 2, backgroundColor: colors.bg },
  progressFill: { height: 2, backgroundColor: colors.accent },
  notice: { backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 10 },
  noticePressed: { opacity: 0.6 },
  noticeText: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  error: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 36,
    gap: 6,
  },
  errorIcon: { width: 44, height: 44, marginBottom: 10 },
  errorTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  errorText: { color: colors.textDim, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  errorDetail: { color: colors.textOff, fontSize: 12, textAlign: 'center', marginTop: 4 },
  retry: {
    marginTop: 20,
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: colors.accent,
  },
  retryPressed: { opacity: 0.7 },
  retryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  webArea: { flex: 1, backgroundColor: '#fff' },
  web: { flex: 1, backgroundColor: '#fff' },
  behind: { opacity: 0 },
  suggestions: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    maxHeight: 260,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  suggestion: { paddingHorizontal: 20, paddingVertical: 11 },
  suggestionPressed: { backgroundColor: colors.surface },
  suggestionTitle: { color: colors.text, fontSize: 15 },
  suggestionUrl: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
});
