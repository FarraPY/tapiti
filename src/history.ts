import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Visit = { url: string; title: string; ts: number };

const KEY = 'escudo:history';
/** ponytail: tope fijo. Si hace falta buscar en más, esto pide una base de datos. */
const MAX = 500;

export function useHistory() {
  const [history, setHistory] = useState<Visit[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setHistory(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  const visit = useCallback((url: string, title: string) => {
    if (!/^https?:/i.test(url)) return;
    setHistory((prev) => {
      // El WebView avisa varias veces por página; si ya está arriba, no se reescribe.
      if (prev[0]?.url === url && prev[0].title === title) return prev;
      // Revisitar sube la entrada en vez de duplicarla.
      const next = [{ url, title, ts: Date.now() }, ...prev.filter((v) => v.url !== url)].slice(
        0,
        MAX
      );
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
    AsyncStorage.removeItem(KEY).catch(() => {});
  }, []);

  return { history, visit, clear };
}

/** Coincidencias del historial para lo que se está escribiendo en la barra. */
export function suggest(history: Visit[], query: string, limit = 6): Visit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: Visit[] = [];
  for (const v of history) {
    if (v.url.toLowerCase().includes(q) || v.title.toLowerCase().includes(q)) {
      out.push(v);
      if (out.length === limit) break;
    }
  }
  return out;
}
