import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { applyTo, compile, hasNativeBlocking, load, remove, stored } from '../../modules/escudo-rules';
import { buildRuleLists } from './toContentRules.ts';
import type { Lists } from './updateLists.ts';

/**
 * Compila las listas para el motor de WebKit y las mantiene al día.
 *
 * Compilar es MUY caro: son cien mil reglas. Por eso nunca se hace sola al abrir
 * la app — iOS mata cualquier app que tarde demasiado en arrancar, y como el
 * arranque se repite, entraba en un bucle de cierres. Se dispara a mano desde
 * Ajustes, se hace de a tandas chicas con una pausa entre cada una, y el
 * resultado queda guardado por el sistema: se hace una vez y listo.
 */

const SIGNATURE_KEY = 'escudo:rules-signature';
/** Queda puesta mientras se compila. Si aparece al arrancar, algo salió mal. */
const BUSY_KEY = 'escudo:rules-compiling';
const PREFIX = 'escudo.';

/** Respiro entre tandas para que el sistema no crea que la app se colgó. */
const BREATH_MS = 250;

export type NativeState =
  | { phase: 'unsupported' }
  | { phase: 'idle'; canCompile: boolean; failedBefore: boolean }
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useNativeRules(lists: Lists, listsLoaded: boolean) {
  const [state, setState] = useState<NativeState>(
    hasNativeBlocking
      ? { phase: 'idle', canCompile: true, failedBefore: false }
      : { phase: 'unsupported' }
  );
  const running = useRef(false);

  /** Al abrir solo se levanta lo ya compilado. Nunca se compila sin que lo pidas. */
  useEffect(() => {
    if (!hasNativeBlocking || !listsLoaded) return;
    (async () => {
      const [saved, busy, existing] = await Promise.all([
        AsyncStorage.getItem(SIGNATURE_KEY).catch(() => null),
        AsyncStorage.getItem(BUSY_KEY).catch(() => null),
        stored(),
      ]);

      // La vez anterior se cortó en el medio: se limpia y se avisa, pero no se
      // vuelve a intentar solo. Reintentar solo es lo que causaba el bucle.
      if (busy) {
        await AsyncStorage.removeItem(BUSY_KEY).catch(() => {});
        for (const id of existing) if (id.startsWith(PREFIX)) await remove(id);
        await AsyncStorage.removeItem(SIGNATURE_KEY).catch(() => {});
        setState({ phase: 'idle', canCompile: true, failedBefore: true });
        return;
      }

      const ids = existing.filter((id) => id.startsWith(PREFIX));
      if (ids.length > 0 && saved === signatureOf(lists)) {
        for (const id of ids) await load(id);
        setState({ phase: 'ready', ids });
      } else {
        setState({ phase: 'idle', canCompile: true, failedBefore: false });
      }
    })().catch(() => {
      setState({ phase: 'idle', canCompile: true, failedBefore: true });
    });
  }, [listsLoaded, lists]);

  const build = useCallback(async () => {
    if (!hasNativeBlocking || running.current) return;
    running.current = true;
    try {
      await AsyncStorage.setItem(BUSY_KEY, '1').catch(() => {});
      const existing = await stored();

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
        // Le devuelve el turno al sistema entre tanda y tanda.
        await pause(BREATH_MS);
      }

      // Las sobrantes de una versión con más tandas se tiran recién ahora: primero
      // se compila lo nuevo, después se descarta lo viejo.
      for (const old of existing) {
        if (old.startsWith(PREFIX) && !ids.includes(old)) await remove(old);
      }

      await AsyncStorage.setItem(SIGNATURE_KEY, signatureOf(lists)).catch(() => {});
      await AsyncStorage.removeItem(BUSY_KEY).catch(() => {});
      setState({ phase: 'ready', ids });
    } catch (e) {
      await AsyncStorage.removeItem(BUSY_KEY).catch(() => {});
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      running.current = false;
    }
  }, [lists]);

  const reset = useCallback(async () => {
    const existing = await stored();
    for (const id of existing) if (id.startsWith(PREFIX)) await remove(id);
    await AsyncStorage.multiRemove([SIGNATURE_KEY, BUSY_KEY]).catch(() => {});
    setState({ phase: 'idle', canCompile: true, failedBefore: false });
  }, []);

  return { state, build, reset };
}

/** Engancha las reglas ya compiladas a una vista web. */
export async function attachRules(viewTag: number | null, state: NativeState) {
  if (viewTag == null || state.phase !== 'ready') return;
  await applyTo(viewTag, state.ids).catch(() => []);
}

export { hasNativeBlocking };
