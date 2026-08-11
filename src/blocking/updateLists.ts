import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import BUNDLED_HOSTS from './hosts.ts';
import BUNDLED_CORE from './hostsCore.ts';
import { GENERIC_CSS, SITE_CSS } from './cosmetic.ts';
import { SOURCES, emptyParsed, finalize, parseSource } from './parseLists.ts';

/**
 * Listas descargadas por la app. Las que vienen dentro del programa envejecen: se
 * generaron el día que se compiló. Esto las reemplaza sin tener que actualizar la
 * app, que es como funcionan todos los bloqueadores.
 */
export type Lists = {
  hosts: string;
  core: string;
  generic: string;
  sites: Record<string, string>;
  updatedAt: number;
  counts: { hosts: number; core: number; sites: number };
};

const KEY = 'escudo:lists';

export const BUNDLED: Lists = {
  hosts: BUNDLED_HOSTS,
  core: BUNDLED_CORE,
  generic: GENERIC_CSS,
  sites: SITE_CSS,
  updatedAt: 0,
  counts: {
    hosts: BUNDLED_HOSTS.split(',').length,
    core: BUNDLED_CORE.split(',').length,
    sites: Object.keys(SITE_CSS).length,
  },
};

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'running'; step: string }
  | { phase: 'done'; counts: Lists['counts'] }
  | { phase: 'error'; message: string };

/** Descarga las listas, las procesa y las guarda. */
export async function downloadLists(onStep: (s: string) => void): Promise<Lists> {
  const parsed = emptyParsed();
  for (let i = 0; i < SOURCES.length; i++) {
    const src = SOURCES[i];
    onStep(`Descargando lista ${i + 1} de ${SOURCES.length}…`);
    const res = await fetch(src.url);
    if (!res.ok) throw new Error(`No respondió ${new URL(src.url).hostname} (${res.status})`);
    const text = await res.text();
    onStep(`Leyendo lista ${i + 1} de ${SOURCES.length}…`);
    parseSource(src, text, parsed);
  }

  onStep('Ordenando dominios…');
  const out = finalize(parsed);

  const lists: Lists = {
    hosts: out.hosts.join(','),
    core: out.core.join(','),
    generic: out.generic,
    sites: out.sites,
    updatedAt: Date.now(),
    counts: {
      hosts: out.hosts.length,
      core: out.core.length,
      sites: Object.keys(out.sites).length,
    },
  };

  onStep('Guardando…');
  await AsyncStorage.setItem(KEY, JSON.stringify(lists));
  return lists;
}

/**
 * Devuelve las listas en uso: las descargadas si existen, si no las del programa.
 * `loaded` avisa cuándo terminó de leer el disco, para no arrancar con las viejas
 * y recargar todo un instante después.
 */
export function useLists() {
  const [lists, setLists] = useState<Lists>(BUNDLED);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Lists;
        // Solo se adopta si trae algo: una lista vacía dejaría el escudo sin nada.
        if (saved?.hosts && saved.core) setLists(saved);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const update = useCallback(async () => {
    setState({ phase: 'running', step: 'Empezando…' });
    try {
      const next = await downloadLists((step) => setState({ phase: 'running', step }));
      setLists(next);
      setState({ phase: 'done', counts: next.counts });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const reset = useCallback(async () => {
    await AsyncStorage.removeItem(KEY).catch(() => {});
    setLists(BUNDLED);
    setState({ phase: 'idle' });
  }, []);

  return { lists, loaded, state, update, reset };
}
