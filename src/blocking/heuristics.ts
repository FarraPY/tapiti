/**
 * Reglas por forma del nombre, para dominios que ninguna lista va a tener nunca.
 *
 * Las redes de publicidad de estos sitios registran dominios nuevos todos los días
 * (`bagpipewraxle.qpon`, `e0a550682d.eca8776110.com`). Contra eso una lista siempre
 * llega tarde, pero la forma del nombre los delata.
 *
 * IMPORTANTE: esto solo se aplica a recursos de TERCEROS. El sitio que estás
 * visitando nunca se juzga por su nombre — si entrás a un `.cyou` a propósito,
 * carga normal.
 */

/**
 * Terminaciones donde la publicidad y el fraude son la norma, no la excepción.
 * Conservadora a propósito: las de uso mixto (.xyz, .online, .site) quedan afuera
 * aunque también se abusen, porque hay proyectos reales ahí.
 */
const ABUSE_TLDS = new Set([
  'qpon', 'cyou', 'cfd', 'bid', 'sbs', 'icu', 'monster', 'quest',
  'boats', 'autos', 'makeup', 'beauty', 'hair', 'skin', 'mom',
  'lol', 'rest', 'buzz', 'cam', 'uno', 'gdn', 'realtor',
]);

/**
 * Proveedores donde los nombres al azar son lo normal y legítimo: CloudFront,
 * S3, Vercel y compañía reparten subdominios generados a clientes reales. Adentro
 * de estos dominios no se juzga la forma del nombre.
 */
export const KNOWN_PROVIDERS = new Set([
  'cloudfront.net', 'amazonaws.com', 'akamaized.net', 'akamai.net', 'akamaihd.net',
  'azureedge.net', 'windows.net', 'fastly.net', 'fastlylb.net', 'jsdelivr.net',
  'googleusercontent.com', 'gstatic.com', 'googleapis.com', 'ggpht.com',
  'cloudflare.com', 'cloudflare.net', 'pages.dev', 'workers.dev', 'r2.dev',
  'wp.com', 'wordpress.com', 'shopify.com', 'squarespace.com', 'wixstatic.com',
  'herokuapp.com', 'vercel.app', 'netlify.app', 'github.io', 'githubusercontent.com',
  'firebaseapp.com', 'web.app', 'digitaloceanspaces.com', 'b-cdn.net',
  'twimg.com', 'fbcdn.net', 'licdn.com', 'ytimg.com', 'redd.it', 'imgix.net',
  'cdninstagram.com', 'whatsapp.net', 'apple.com', 'icloud.com', 'live.com',
]);

/** Etiqueta que parece generada por una máquina y no escrita por una persona. */
function looksGenerated(label: string): boolean {
  // Hexadecimal largo: 35f95a147d, eca8776110, bb3d97785c
  if (/^[0-9a-f]{8,}$/i.test(label)) return true;
  // Identificador numérico con guiones: 29773325-7003-ex
  if (/^\d{6,}[-.]/.test(label)) return true;
  // Mezcla larga de letras y dígitos sin separadores: 7078218aaa, e0a550682d
  if (label.length >= 8 && /\d/.test(label) && /[a-z]/i.test(label) && !/[-]/.test(label)) {
    const digits = (label.match(/\d/g) || []).length;
    if (digits >= label.length / 3) return true;
  }
  return false;
}

/**
 * ¿El nombre de este host de terceros lo delata como publicidad?
 * `host` ya debe venir en minúsculas.
 */
export function looksLikeAdHost(host: string): boolean {
  const parts = host.split('.');
  if (parts.length < 2) return false;

  // Un proveedor conocido reparte nombres al azar de forma legítima.
  if (KNOWN_PROVIDERS.has(parts.slice(-2).join('.'))) return false;
  if (parts.length >= 3 && KNOWN_PROVIDERS.has(parts.slice(-3).join('.'))) return false;

  if (ABUSE_TLDS.has(parts[parts.length - 1])) return true;

  // El nombre propio del dominio (`eca8776110` en `x.eca8776110.com`).
  if (looksGenerated(parts[parts.length - 2])) return true;

  // O el subdominio más a la izquierda (`29773325-7003-ex`).
  if (parts.length > 2 && looksGenerated(parts[0])) return true;

  return false;
}

/** ¿`host` es el mismo sitio que `pageHost`, o un subdominio suyo? */
export function sameSite(host: string, pageHost: string): boolean {
  if (!host || !pageHost) return false;
  if (host === pageHost) return true;
  const root = (h: string) => h.split('.').slice(-2).join('.');
  return root(host) === root(pageHost);
}
