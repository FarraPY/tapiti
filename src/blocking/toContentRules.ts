/**
 * Traduce nuestras listas al formato que entiende el motor de Safari
 * (`WKContentRuleList`). Es el corazón de la Fase 2.
 *
 * A diferencia del bloqueo por JavaScript, estas reglas se compilan una vez y las
 * aplica WebKit en la capa de red, antes de que el pedido salga del teléfono: no
 * viajan dentro de cada página, alcanzan a los marcos internos y no cuestan nada
 * por página.
 *
 * Formato: una lista de objetos `{ trigger, action }`. El `url-filter` es una
 * expresión regular restringida — WebKit no acepta todo, así que se genera una
 * forma simple y conocida en vez de traducir expresiones arbitrarias.
 */

export type Trigger = {
  'url-filter': string;
  'url-filter-is-case-sensitive'?: boolean;
  'load-type'?: ('first-party' | 'third-party')[];
  'resource-type'?: string[];
  'if-domain'?: string[];
  'unless-domain'?: string[];
};

export type Rule = {
  trigger: Trigger;
  action:
    | { type: 'block' }
    | { type: 'ignore-previous-rules' }
    | { type: 'css-display-none'; selector: string };
};

/**
 * Tope de reglas por lista.
 *
 * Estaba en 25.000, que daba tandas de 4 MB de JSON: compilarlas hacía que iOS
 * matara la app por tardar demasiado. Con tandas chicas el trabajo total es el
 * mismo pero cada paso termina rápido y el sistema no considera que la app se
 * colgó. Varias listas chicas se instalan igual de bien que pocas grandes.
 */
export const CHUNK = 8000;

/** Escapa un dominio para meterlo dentro de la expresión del `url-filter`. */
function escapeHost(host: string): string {
  return host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bloquea el dominio y todos sus subdominios.
 * `traffmovie.com` -> `^https?://([^/]*\.)?traffmovie\.com[:/]`
 *
 * El final `[:/]` evita que `traffmovie.com.otro-sitio.net` caiga por error: sin
 * eso, el patrón engancharía cualquier host que empiece igual.
 */
export function domainFilter(host: string): string {
  return `^https?://([^/]*\\.)?${escapeHost(host)}[:/]`;
}

/**
 * Regla de bloqueo para un dominio. Solo como tercero: si escribís el dominio en
 * la barra, la página abre. Es la misma decisión que ya toma la app hoy.
 */
export function blockRule(host: string): Rule {
  return {
    trigger: {
      'url-filter': domainFilter(host),
      'url-filter-is-case-sensitive': false,
      'load-type': ['third-party'],
    },
    action: { type: 'block' },
  };
}

/** Excepción: anula las reglas anteriores para ese dominio. Va siempre al final. */
export function allowRule(host: string): Rule {
  return {
    trigger: {
      'url-filter': domainFilter(host),
      'url-filter-is-case-sensitive': false,
    },
    action: { type: 'ignore-previous-rules' },
  };
}

/**
 * Selectores que se ocultan en todos lados. Se parten en grupos porque un solo
 * selector con catorce mil entradas es un texto enorme dentro de una regla, y
 * WebKit lo maneja mejor repartido.
 */
export function genericCssRules(css: string, perRule = 500): Rule[] {
  const selectors = css.split(',').filter(Boolean);
  const out: Rule[] = [];
  for (let i = 0; i < selectors.length; i += perRule) {
    out.push({
      trigger: { 'url-filter': '.*' },
      action: { type: 'css-display-none', selector: selectors.slice(i, i + perRule).join(',') },
    });
  }
  return out;
}

/**
 * Reglas propias de cada sitio. `if-domain` con `*` adelante cubre los
 * subdominios, que es como WebKit espera que se escriba.
 */
export function siteCssRules(sites: Record<string, string>): Rule[] {
  const out: Rule[] = [];
  for (const [domain, selector] of Object.entries(sites)) {
    if (!selector) continue;
    out.push({
      trigger: { 'url-filter': '.*', 'if-domain': [`*${domain}`] },
      action: { type: 'css-display-none', selector },
    });
  }
  return out;
}

/**
 * Arma las listas listas para compilar.
 *
 * El orden importa: WebKit evalúa en secuencia y `ignore-previous-rules` solo
 * anula lo que vino antes, así que las excepciones van al final de su lista.
 */
export function buildRuleLists(input: {
  hosts: string[];
  allow?: string[];
  generic?: string;
  sites?: Record<string, string>;
}): string[] {
  const blocks = input.hosts.map(blockRule);
  const cosmetic = [
    ...(input.generic ? genericCssRules(input.generic) : []),
    ...(input.sites ? siteCssRules(input.sites) : []),
  ];
  const allows = (input.allow ?? []).map(allowRule);

  const lists: string[] = [];
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const chunk = blocks.slice(i, i + CHUNK);
    // Las excepciones se repiten en cada tanda: solo anulan reglas de su propia
    // lista, así que una copia suelta al final no alcanzaría.
    lists.push(JSON.stringify([...chunk, ...allows]));
  }
  if (cosmetic.length > 0) {
    for (let i = 0; i < cosmetic.length; i += CHUNK) {
      lists.push(JSON.stringify(cosmetic.slice(i, i + CHUNK)));
    }
  }
  return lists;
}
