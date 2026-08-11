import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { applyTo, compile, hasNativeBlocking, load, remove, stored } from '../../modules/escudo-rules';
import { buildRuleLists } from './toContentRules.ts';
import type { Lists } from './updateLists.ts';

/**
 * Compila las listas para el motor de WebKit y las mantiene al día.
 *
 * Compilar es caro —se siente la primera vez— pero el sistema guarda el resultado,
 * así que solo se rehace cuando las listas cambian. La firma que se guarda evita
 * recompilar en cada arranque.
 */

const SIGNATURE_KEY = 'escudo:rules-signature';
const PREFIX = 'escudo.';

export type NativeState =
  | { phase: 'unsupported' }
  | { phase: 'idle' }
  | { phase: 'compiling'; done: number; total: number }
  | { phase: 'ready'; ids: string[] }
  | { phase: 'error'; message: string };

/** Cambia cuando cambian las listas; con eso alcanza para saber si hay que rehacer. */
function signatureOf(lists: Lists): string {
  return [
    lists.updatedAt,
    lists.counts.hosts,
    lists.counts.core,
    lists.counts.sites,
    lists.generic.length,
  ].join('-');
}

export function useNativeRules(lists: Lists, listsLoaded: boolean) {
  const [state, setState] = useState<NativeState>(
    hasNativeBlocking ? { phase: 'idle' } : { phase: 'unsupported' }
  );
  const running = useRef(false);

  const build = useCallback(
    async (force: boolean) => {
      if (!hasNativeBlocking || running.current) return;
      running.current = true;
      try {
        const signature = signatureOf(lists);
        const saved = await AsyncStorage.getItem(SIGNATURE_KEY).catch(() => null);
        const existing = await stored();

        // Ya compiladas y sin cambios: solo hay que traerlas del disco.
        if (!force && saved === signature && existing.length > 0) {
          const ids = existing.filter((id) => id.startsWith(PREFIX));
          for (const id of ids) await load(id);
          setState({ phase: 'ready', ids });
          return;
        }

        const chunks = buildRuleLists({
          hosts: lists.hosts.split(',').filter(Boolean),
          generic: lists.generic,
          sites: lists.sites,
        });

        const ids: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setState({ phase: 'compiling', done: i, total: chunks.length });
          const id = `${PREFIX}${i}`;
          await compile(id, chunks[i]);
          ids.push(id);
        }

        // Las sobrantes de una versión anterior con más tandas se tiran recién
        // ahora: primero se compila lo nuevo, después se descarta lo viejo.
        for (const old of existing) {
          if (old.startsWith(PREFIX) && !ids.includes(old)) await remove(old);
        }

        await AsyncStorage.setItem(SIGNATURE_KEY, signature).catch(() => {});
        setState({ phase: 'ready', ids });
      } catch (e) {
        setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        running.current = false;
      }
    },
    [lists]
  );

  useEffect(() => {
    if (listsLoaded) void build(false);
  }, [listsLoaded, build]);

  return { state, rebuild: () => build(true) };
}

/** Engancha las reglas ya compiladas a una vista web. */
export async function attachRules(viewTag: number | null, state: NativeState) {
  if (viewTag == null || state.phase !== 'ready') return;
  await applyTo(viewTag, state.ids).catch(() => []);
}

export { hasNativeBlocking };
