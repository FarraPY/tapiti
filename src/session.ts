import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Lo mínimo para volver a abrir una pestaña donde estaba. */
export type SavedTab = { url: string; title: string };
export type Session = { tabs: SavedTab[]; activeIndex: number };

const KEY = 'escudo:session';
/** Bandera que queda puesta mientras la app arranca. Ver abajo. */
const BOOT = 'escudo:booting';

const MAX_TABS = 20;
/** Cuánto esperar antes de dar el arranque por bueno. */
const BOOT_OK_MS = 5000;

/** Descarta cualquier cosa rara antes de que llegue a la UI. */
function sanitize(raw: string): Session | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const s = parsed as Partial<Session>;
  if (!s || !Array.isArray(s.tabs)) return null;

  const tabs = s.tabs
    .filter((t): t is SavedTab => !!t && typeof t.url === 'string' && /^https?:\/\//i.test(t.url))
    .slice(0, MAX_TABS)
    .map((t) => ({ url: t.url, title: typeof t.title === 'string' ? t.title : '' }));

  if (tabs.length === 0) return null;
  const i = Number.isInteger(s.activeIndex) ? (s.activeIndex as number) : 0;
  return { tabs, activeIndex: Math.min(Math.max(0, i), tabs.length - 1) };
}

/**
 * Restaura las pestañas de la última vez y guarda las actuales cuando cambian.
 *
 * Protección contra bucles de cierre: se deja una bandera puesta al empezar a
 * restaurar y se saca a los pocos segundos de vida. Si al arrancar la bandera ya
 * estaba puesta, quiere decir que la vez anterior la app no llegó a estar viva —
 * entonces la sesión guardada es sospechosa y se tira, en vez de volver a
 * cargarla y cerrarse de nuevo.
 *
 * Se guarda la URL, no el historial de cada pestaña: eso vive dentro de la
 * WKWebView y no es serializable sin módulo nativo.
 */
export function useSession() {
  const [restored, setRestored] = useState<Session | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const crashed = await AsyncStorage.getItem(BOOT);
        if (crashed) {
          await AsyncStorage.multiRemove([KEY, BOOT]);
          setRecovered(true);
        } else {
          await AsyncStorage.setItem(BOOT, '1');
          const raw = await AsyncStorage.getItem(KEY);
          if (raw) setRestored(sanitize(raw));
        }
      } catch {
        // Sin sesión guardada se arranca limpio, que es un final aceptable.
      }
      setLoaded(true);
      ready.current = true;
    })();
  }, []);

  // Sobrevivió al arranque: se saca la bandera.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      AsyncStorage.removeItem(BOOT).catch(() => {});
    }, BOOT_OK_MS);
    return () => clearTimeout(t);
  }, [loaded]);

  function save(session: Session) {
    // Antes de terminar de leer no se escribe, o se pisa lo guardado con el estado inicial.
    if (!ready.current) return;
    AsyncStorage.setItem(
      KEY,
      JSON.stringify({ ...session, tabs: session.tabs.slice(0, MAX_TABS) })
    ).catch(() => {});
  }

  return { restored, loaded, save, recovered };
}
