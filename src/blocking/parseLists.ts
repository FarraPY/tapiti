/**
 * Lectura de listas de bloqueo. Vive acá, y no en el script, porque lo usan los
 * dos: el script que genera los archivos y la app cuando actualiza sola desde el
 * teléfono. Una sola forma de entender las listas, no dos que se desincronizan.
 */
import { KNOWN_PROVIDERS } from './heuristics.ts';

export type Format = 'hosts' | 'adblock';
export type Source = { url: string; format: Format; tier: 'core' | 'full'; cosmetic: boolean };

export const SOURCES: Source[] = [
  { url: 'https://adaway.org/hosts.txt', format: 'hosts', tier: 'core', cosmetic: false },
  {
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
    format: 'hosts',
    tier: 'core',
    cosmetic: false,
  },
  { url: 'https://easylist.to/easylist/easyprivacy.txt', format: 'adblock', tier: 'full', cosmetic: false },
  { url: 'https://easylist.to/easylist/easylist.txt', format: 'adblock', tier: 'full', cosmetic: true },
  {
    url: 'https://easylist-downloads.adblockplus.org/easylistspanish.txt',
    format: 'adblock',
    tier: 'full',
    cosmetic: true,
  },
];

/** No son dominios reales, o romperían la resolución local. */
const ALLOW = new Set([
  'localhost', 'localhost.localdomain', 'broadcasthost', 'ip6-localhost',
  'ip6-loopback', 'ip6-localnet', 'ip6-mcastprefix', 'ip6-allnodes',
  'ip6-allrouters', 'ip6-allhosts',
]);

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const COMPOUND = new Set([
  'co.uk', 'com.ar', 'com.br', 'com.mx', 'com.au', 'co.jp', 'com.py', 'com.co',
  'co.za', 'com.tr', 'com.pe', 'com.ve', 'com.ec', 'org.uk', 'net.au', 'co.nz',
  'com.es', 'com.pl', 'co.in', 'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.my',
]);

/** Resultado de leer todas las listas. */
export type Parsed = {
  block: Set<string>;
  core: Set<string>;
  allow: Set<string>;
  generic: Set<string>;
  sites: Map<string, Set<string>>;
};

export function emptyParsed(): Parsed {
  return {
    block: new Set(),
    core: new Set(),
    allow: new Set(),
    generic: new Set(),
    sites: new Map(),
  };
}

function addDomain(into: Set<string>, host: string) {
  const h = host.toLowerCase();
  if (DOMAIN.test(h) && !ALLOW.has(h)) into.add(h);
}

/** `||dominio^` o `||dominio^$opts` -> dominio. Null si la regla no es de dominio puro. */
function netDomainOf(rule: string): string | null {
  if (!rule.startsWith('||')) return null;
  const [pattern, opts = ''] = rule.slice(2).split('$');
  // `domain=` hace la regla contextual: sin ese contexto bloquearía de más.
  if (opts.includes('domain=')) return null;
  const m = /^([^/^*|]+)[\^|]?$/.exec(pattern);
  if (!m) return null;
  const host = m[1].toLowerCase();
  return DOMAIN.test(host) ? host : null;
}

export function parseHosts(text: string, out: Parsed, core: boolean): number {
  let n = 0;
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const host = parts.length > 1 ? parts[1] : parts[0];
    const before = out.block.size;
    addDomain(out.block, host);
    if (core) addDomain(out.core, host);
    if (out.block.size > before) n++;
  }
  return n;
}

export function parseAdblock(
  text: string,
  out: Parsed,
  useCosmetic: boolean,
  core: boolean
): { net: number; cosm: number } {
  let net = 0;
  let cosm = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    // Excepciones cosméticas: fuera, no queremos ocultar de más ni de menos.
    if (line.includes('#@#')) continue;

    const cosmetic = /^([^#]*)##(.+)$/.exec(line);
    if (cosmetic) {
      if (!useCosmetic) continue;
      const [, domainPart, selector] = cosmetic;
      if (!domainPart) {
        out.generic.add(selector);
        cosm++;
      } else {
        for (const d of domainPart.split(',')) {
          // `~dominio` es una exclusión; sin soporte, se ignora esa parte.
          if (d.startsWith('~') || !DOMAIN.test(d)) continue;
          let set = out.sites.get(d);
          if (!set) out.sites.set(d, (set = new Set()));
          set.add(selector);
          cosm++;
        }
      }
      continue;
    }

    if (line.startsWith('@@')) {
      const host = netDomainOf(line.slice(2));
      if (host) addDomain(out.allow, host);
      continue;
    }

    const host = netDomainOf(line);
    if (host) {
      const before = out.block.size;
      addDomain(out.block, host);
      if (core) addDomain(out.core, host);
      if (out.block.size > before) net++;
    }
  }
  return { net, cosm };
}

/** Dominio raíz aproximado: `d7.cdn.traffmovie.com` -> `traffmovie.com`. */
export function rootOf(host: string): string {
  const p = host.split('.');
  if (p.length <= 2) return host;
  const last2 = p.slice(-2).join('.');
  return COMPOUND.has(last2) ? p.slice(-3).join('.') : last2;
}

/**
 * Colapsa a la raíz los dominios de los que la lista trae varios subdominios: una
 * entrada reemplaza a diez y así la lista entra en cada página. Los proveedores
 * compartidos nunca se colapsan — ahí adentro vive medio internet legítimo.
 */
export function collapse(hosts: Set<string>, extra: Set<string>): Set<string> {
  const groups = new Map<string, string[]>();
  for (const h of hosts) {
    const root = rootOf(h);
    const g = groups.get(root);
    if (g) g.push(h);
    else groups.set(root, [h]);
  }
  const out = new Set<string>();
  for (const [root, members] of groups) {
    if (KNOWN_PROVIDERS.has(root)) {
      for (const m of members) out.add(m);
      continue;
    }
    if (members.length >= 2 || members[0] === root) out.add(root);
    else if (extra.has(members[0])) out.add(members[0]);
  }
  return out;
}

/** Quita subdominios cuyo dominio padre ya está en el set: el matcher los cubre. */
export function dropRedundant(hosts: Set<string>): string[] {
  const kept: string[] = [];
  for (const h of hosts) {
    let parent = h.slice(h.indexOf('.') + 1);
    let covered = false;
    while (parent.includes('.')) {
      if (hosts.has(parent)) {
        covered = true;
        break;
      }
      parent = parent.slice(parent.indexOf('.') + 1);
    }
    if (!covered) kept.push(h);
  }
  return kept.sort();
}

/** Texto de una lista -> se vuelca en `out`. */
export function parseSource(src: Source, text: string, out: Parsed) {
  const core = src.tier === 'core';
  return src.format === 'hosts'
    ? { net: parseHosts(text, out, core), cosm: 0 }
    : parseAdblock(text, out, src.cosmetic, core);
}

/** Cierra el proceso: aplica excepciones y arma las listas finales. */
export function finalize(out: Parsed) {
  for (const a of out.allow) {
    out.block.delete(a);
    out.core.delete(a);
  }
  return {
    hosts: dropRedundant(out.block),
    core: dropRedundant(collapse(out.block, out.core)),
    generic: [...out.generic].sort().join(','),
    sites: Object.fromEntries(
      [...out.sites].sort().map(([d, s]) => [d, [...s].sort().join(',')])
    ) as Record<string, string>,
    exceptions: out.allow.size,
  };
}
