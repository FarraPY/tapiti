import { SITE_CSS } from './cosmetic.ts';

/** Reglas por sitio en uso. Se reemplazan al actualizar las listas. */
let sites: Record<string, string> = SITE_CSS;

export function setSiteCss(next: Record<string, string>) {
  if (next && Object.keys(next).length > 0) sites = next;
}

export function siteCount(): number {
  return Object.keys(sites).length;
}

/**
 * Reglas cosméticas propias del host y de sus dominios padre
 * (una regla para `example.com` también aplica en `www.example.com`).
 * Devuelve '' si el sitio no tiene reglas propias.
 */
export function siteCssFor(host: string): string {
  const parts: string[] = [];
  let h = host;
  for (;;) {
    const css = sites[h];
    if (css) parts.push(css);
    const dot = h.indexOf('.');
    if (dot === -1) break;
    h = h.slice(dot + 1);
  }
  return parts.join(',');
}
