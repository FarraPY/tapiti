// Extensión explícita: Metro la resuelve igual y Node (los scripts) la exige.
import HOSTS from './hosts.ts';
import { looksLikeAdHost, sameSite } from './heuristics.ts';

/**
 * Lista en uso. Arranca con la que viene dentro del programa y se reemplaza por la
 * descargada cuando el usuario actualiza. Regenerar la empaquetada con:
 *   node --experimental-strip-types scripts/fetch-lists.ts
 */
let blocked = new Set(HOSTS.split(','));

export function setBlockedHosts(text: string) {
  if (text) blocked = new Set(text.split(','));
}

export function getBlockedHosts(): Set<string> {
  return blocked;
}

/** Extrae el host de una URL. Devuelve '' si no es una URL absoluta http(s). */
export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!m) return '';
  // quita userinfo y puerto
  return m[1].split('@').pop()!.split(':')[0].toLowerCase();
}

/**
 * true si el host está en la lista, o si algún dominio padre suyo lo está.
 * Sube por los labels (`a.ads.example.com` -> `ads.example.com` -> `example.com`),
 * o sea O(labels) en vez de O(dominios de la lista).
 */
export function isBlockedHost(host: string): boolean {
  let h = host;
  for (;;) {
    if (blocked.has(h)) return true;
    const dot = h.indexOf('.');
    if (dot === -1) return false;
    h = h.slice(dot + 1);
  }
}

/** true si la URL apunta a un dominio bloqueado (o a un subdominio suyo). */
export function shouldBlock(url: string): boolean {
  const host = hostOf(url);
  return host ? isBlockedHost(host) : false;
}

/**
 * Igual que `shouldBlock`, pero sabiendo desde qué página se pide el recurso.
 * Eso habilita las dos reglas que necesitan contexto: los dominios que agregaste
 * a mano, y el juicio por forma del nombre, que solo se aplica a terceros.
 */
export function shouldBlockFrom(url: string, pageHost: string, mine: string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (isBlockedHost(host)) return true;
  if (mine.some((m) => host === m || host.endsWith('.' + m))) return true;
  if (sameSite(host, pageHost)) return false;
  return looksLikeAdHost(host);
}
