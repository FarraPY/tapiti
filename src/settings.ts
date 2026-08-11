import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Engine = 'ddg' | 'google' | 'bing';

export const ENGINES: Record<Engine, { name: string; home: string; query: string }> = {
  ddg: { name: 'DuckDuckGo', home: 'https://duckduckgo.com', query: 'https://duckduckgo.com/?q=' },
  google: { name: 'Google', home: 'https://www.google.com', query: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', home: 'https://www.bing.com', query: 'https://www.bing.com/search?q=' },
};

export type Settings = {
  blockAds: boolean;
  engine: Engine;
  /** Sitios donde el usuario apagó el bloqueo a mano. */
  allowlist: string[];
  /** Dejar que un link salte a la app instalada (Instagram, WhatsApp…). */
  openInApps: boolean;
  /** Ocultar los huecos de publicidad con reglas de estilo, aparte de cortar la red. */
  blockCosmetic: boolean;
  /** Dominios que agregaste vos desde el registro. */
  blocklist: string[];
  /** Tapar los cuadros que se encima solos sobre la página. */
  blockOverlays: boolean;
  /** Sin historial ni cookies guardadas: todo se descarta al cerrar. */
  privateMode: boolean;
  /** Responder con medidas falsas a los sitios que revisan si hay bloqueador. */
  antiDetect: boolean;
};

const DEFAULTS: Settings = {
  blockAds: true,
  engine: 'ddg',
  allowlist: [],
  openInApps: false,
  blockCosmetic: true,
  blocklist: [],
  blockOverlays: true,
  privateMode: false,
  antiDetect: true,
};
const KEY = 'escudo:settings';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        // Merge sobre DEFAULTS: una versión vieja guardada puede no tener campos nuevos.
        if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return { settings, update, loaded };
}

/** ¿Está el bloqueo activo para este host? */
export function blockingOn(settings: Settings, host: string): boolean {
  if (!settings.blockAds) return false;
  return !settings.allowlist.some((a) => host === a || host.endsWith('.' + a));
}

/**
 * Esquemas que se quedan dentro del navegador. Cualquier otro (`instagram://`,
 * `whatsapp://`, `tg://`…) es un salto a una app instalada.
 */
const WEB_SCHEMES = /^(https?|about|data|blob):/i;

export function isAppLink(url: string): boolean {
  return !WEB_SCHEMES.test(url);
}

/** Barra de direcciones: si parece dominio lo abre, si no lo busca. */
export function toUrl(input: string, engine: Engine): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return 'https://' + s;
  return ENGINES[engine].query + encodeURIComponent(s);
}
