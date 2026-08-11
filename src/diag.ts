import { useSyncExternalStore } from 'react';

export type DiagKind =
  | 'nav' // la pestaña se fue a otra página
  | 'block' // dominio cortado
  | 'allow' // dominio de terceros que SÍ pasó (para saber qué falta en las listas)
  | 'popup' // ventana que la página quiso abrir
  | 'dialog' // cartel del sistema cancelado
  | 'hijack' // toque desviado a otro dominio
  | 'chain' // cadena de redirecciones cortada
  | 'gaveup' // el bloqueo dentro de la página se soltó
  | 'flood' // reintentos en bucle
  | 'app'; // algo de la app misma

export type DiagEvent = { ts: number; tab: string; kind: DiagKind; detail: string };

/** ponytail: buffer en memoria. Si hiciera falta que sobreviva al cierre, va a disco. */
const MAX = 600;
let events: DiagEvent[] = [];
const listeners = new Set<() => void>();

export function diag(tab: string, kind: DiagKind, detail: string) {
  events = events.length >= MAX ? events.slice(1) : events.slice();
  events.push({ ts: Date.now(), tab, kind, detail });
  listeners.forEach((l) => l());
}

export function clearDiag() {
  events = [];
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDiag(): DiagEvent[] {
  return useSyncExternalStore(subscribe, () => events);
}

const LABEL: Record<DiagKind, string> = {
  nav: 'PÁGINA',
  block: 'CORTADO',
  allow: 'PASÓ',
  popup: 'VENTANA',
  dialog: 'CARTEL',
  hijack: 'DESVÍO',
  chain: 'CADENA',
  gaveup: 'SOLTADO',
  flood: 'BUCLE',
  app: 'APP',
};

export function label(kind: DiagKind): string {
  return LABEL[kind];
}

/** Todo el registro como texto plano, para pasárselo a alguien. */
export function asText(list: DiagEvent[]): string {
  return list
    .map((e) => {
      const t = new Date(e.ts).toLocaleTimeString('es', { hour12: false });
      return `${t} [${LABEL[e.kind]}] p${e.tab} ${e.detail}`;
    })
    .join('\n');
}
