// node --experimental-strip-types scripts/check-blocking.ts
import assert from 'node:assert/strict';
import {
  hostOf,
  shouldBlock,
  shouldBlockFrom,
  getBlockedHosts,
} from '../src/blocking/shouldBlock.ts';

const BLOCKED_HOSTS = getBlockedHosts();
import { looksLikeAdHost, sameSite } from '../src/blocking/heuristics.ts';
import {
  CLEAR_FIND,
  FRAME_GUARD,
  GESTURE_TRACKER,
  INSPECT_SNIPPET,
  buildBlocker,
  findSnippet,
  siteCssSnippet,
} from '../src/blocking/injected.ts';
import { siteCssFor } from '../src/blocking/siteCss.ts';
import { SITE_CSS } from '../src/blocking/cosmetic.ts';
import { collapse, dropRedundant, rootOf } from '../src/blocking/parseLists.ts';
import {
  CHUNK,
  blockRule,
  buildRuleLists,
  domainFilter,
  genericCssRules,
  siteCssRules,
} from '../src/blocking/toContentRules.ts';

assert.equal(hostOf('https://ads.doubleclick.net/x?a=1'), 'ads.doubleclick.net');
assert.equal(hostOf('https://user:pw@Ads.DoubleClick.net:8443/x'), 'ads.doubleclick.net');
assert.equal(hostOf('/relative/path'), '');
assert.equal(hostOf('data:text/html,hi'), '');

// Casos derivados de la lista real, para que no se rompan al regenerarla.
assert.ok(BLOCKED_HOSTS.size > 1000, `lista sospechosamente corta: ${BLOCKED_HOSTS.size}`);
const sample = [...BLOCKED_HOSTS][0];

assert.equal(shouldBlock(`https://${sample}/ad`), true, 'dominio exacto');
assert.equal(shouldBlock(`https://a.b.${sample}/x.js`), true, 'subdominio anidado');
assert.equal(shouldBlock(`https://not${sample}/x`), false, 'sufijo sin punto no cuenta');

assert.equal(shouldBlock('https://dominio-inventado-12345.org/x'), false, 'sitio limpio');
assert.equal(shouldBlock('about:blank'), false);
assert.equal(shouldBlock(''), false);

// --- cosmético por sitio ---
const sites = Object.keys(SITE_CSS);
assert.ok(sites.length > 500, `pocos sitios con reglas: ${sites.length}`);
const site = sites[0];

assert.ok(siteCssFor(site).length > 0, 'dominio con reglas propias');
assert.equal(siteCssFor(`www.${site}`), siteCssFor(site), 'el subdominio hereda del padre');
assert.equal(siteCssFor('dominio-inventado-12345.org'), '', 'sitio sin reglas propias');

// las reglas del subdominio se suman a las del padre, no lo reemplazan
const child = sites.find((s) => {
  const parent = s.slice(s.indexOf('.') + 1);
  return parent.includes('.') && SITE_CSS[parent];
});
if (child) {
  const parent = child.slice(child.indexOf('.') + 1);
  assert.ok(
    siteCssFor(child).length > SITE_CSS[parent].length,
    `${child} debería sumar sus reglas a las de ${parent}`
  );
}

// --- reglas por forma del nombre ---
// Los positivos salieron del registro real de la app en hispasexy.org.
for (const h of [
  'bagpipewraxle.qpon',
  'qt.fleeingrexes.cyou',
  'swearerparamid.cyou',
  'yester.bambusamums.cfd',
  'e0a550682d.eca8776110.com',
  '7078218aaa.35f95a147d.com',
  '29773325-7003-ex.comanicilikeiste.com',
]) {
  assert.equal(looksLikeAdHost(h), true, `debería caer por su forma: ${h}`);
}

// Los negativos importan más: un falso positivo acá rompe sitios de verdad.
for (const h of [
  'www.google.com',
  'ajax.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  's3.amazonaws.com',
  'd2xyz123abc.cloudfront.net', // CloudFront reparte nombres al azar legítimos
  'static1.squarespace.com',
  'v16m-default.akamaized.net',
  'i.imgur.com',
  'api.una.py',
  'www.ultimahora.com',
  'abcdef123456.vercel.app',
]) {
  assert.equal(looksLikeAdHost(h), false, `NO debería caer: ${h}`);
}

// Proveedores compartidos: colapsar su raíz bloquearía medio internet.
for (const h of [
  'ajax.googleapis.com',
  'fonts.googleapis.com',
  's3.amazonaws.com',
  'd111111abcdef8.cloudfront.net',
]) {
  assert.equal(shouldBlock(`https://${h}/lib.js`), false, `proveedor compartido: ${h}`);
}

// El sitio que estás visitando nunca se juzga por su nombre.
assert.equal(sameSite('www.hispasexy.org', 'hispasexy.org'), true);
assert.equal(sameSite('ads.otrodominio.cyou', 'hispasexy.org'), false);
assert.equal(
  shouldBlockFrom('https://algo.cyou/x', 'algo.cyou', []),
  false,
  'entrar a propósito a un .cyou no se bloquea'
);
assert.equal(
  shouldBlockFrom('https://otro.cyou/x', 'hispasexy.org', []),
  true,
  'pero embebido desde otro sitio, sí'
);

// Dominios agregados a mano, con sus subdominios.
assert.equal(shouldBlockFrom('https://nereserv.com/a', 'sitio.com', ['nereserv.com']), true);
assert.equal(shouldBlockFrom('https://x.nereserv.com/a', 'sitio.com', ['nereserv.com']), true);
assert.equal(shouldBlockFrom('https://otro.com/a', 'sitio.com', ['nereserv.com']), false);

// --- lectura de listas ---
// Este código ahora lo corre también el teléfono al actualizar, así que un error
// acá no rompe una generación: rompe el escudo de quien apretó "Actualizar".
assert.equal(rootOf('d7.cdn.traffmovie.com'), 'traffmovie.com');
assert.equal(rootOf('traffmovie.com'), 'traffmovie.com');
assert.equal(rootOf('algo.com.py'), 'algo.com.py', 'sufijo de dos partes');
assert.equal(rootOf('x.y.algo.com.ar'), 'algo.com.ar', 'sufijo de dos partes anidado');

// Varios subdominios de un mismo dominio se colapsan a la raíz…
const many = new Set(['a.ads.com', 'b.ads.com', 'c.ads.com']);
assert.deepEqual([...collapse(many, new Set())], ['ads.com']);
// …pero un proveedor compartido conserva sus entradas exactas.
const shared = new Set(['a.googleapis.com', 'b.googleapis.com']);
assert.deepEqual([...collapse(shared, new Set())].sort(), ['a.googleapis.com', 'b.googleapis.com']);
// Un subdominio suelto no arrastra al dominio entero.
assert.deepEqual([...collapse(new Set(['tracker.empresa.com']), new Set())], []);

assert.deepEqual(dropRedundant(new Set(['ads.com', 'x.ads.com', 'otro.com'])), [
  'ads.com',
  'otro.com',
]);

// --- traducción al formato de Safari (Fase 2) ---
// Estas reglas las compila WebKit y las aplica en la capa de red. Un error acá no
// se ve como un error: se ve como que el bloqueo dejó de funcionar, o peor, como
// un sitio legítimo que no carga.
const df = domainFilter('traffmovie.com');
assert.ok(new RegExp(df).test('https://d7.cdn.traffmovie.com/x.js'), 'cubre subdominios');
assert.ok(new RegExp(df).test('http://traffmovie.com/'), 'cubre el dominio pelado');
assert.ok(
  !new RegExp(df).test('https://traffmovie.com.otro-sitio.net/x'),
  'no engancha a un dominio que solo EMPIEZA igual'
);
assert.ok(!new RegExp(df).test('https://notraffmovie.com/x'), 'no engancha sin el punto');

// Los puntos van escapados: si no, valdrían por cualquier carácter.
assert.ok(!new RegExp(domainFilter('ads.com')).test('https://adsXcom/x'));

const bloqueo = blockRule('ads.com');
assert.equal(bloqueo.action.type, 'block');
assert.deepEqual(bloqueo.trigger['load-type'], ['third-party'], 'solo como tercero');

// Reglas por sitio: el asterisco delante es lo que cubre los subdominios.
const reglaSitio = siteCssRules({ 'yahoo.com': '.ad,.banner' })[0];
assert.deepEqual(reglaSitio.trigger['if-domain'], ['*yahoo.com']);
assert.equal(reglaSitio.action.type, 'css-display-none');

// Los selectores genéricos se reparten en grupos.
assert.equal(genericCssRules('.a,.b,.c', 2).length, 2);

// Las listas se parten, y las excepciones se repiten en cada tanda porque solo
// anulan reglas de su propia lista.
const listas = buildRuleLists({
  hosts: Array.from({ length: CHUNK + 10 }, (_, i) => `d${i}.com`),
  allow: ['bueno.com'],
  generic: '.x',
});
assert.equal(listas.length, 3, 'dos tandas de bloqueo + una de cosmético');
for (const l of listas.slice(0, 2)) {
  const reglas = JSON.parse(l) as { action: { type: string } }[];
  assert.equal(reglas[reglas.length - 1].action.type, 'ignore-previous-rules');
}
// Y todo tiene que ser JSON válido, que es lo que recibe el compilador de WebKit.
for (const l of listas) assert.doesNotThrow(() => JSON.parse(l));

// --- el código que se inyecta en la página ---
// Va como texto, así que el compilador de TypeScript nunca lo mira. Un paréntesis
// de más ahí no rompe la app: rompe el bloqueo entero, en silencio.
//
// `new Function` acá solo COMPILA para ver si la sintaxis es válida; nunca se
// llama, así que nada de esto se ejecuta. Los datos de las listas entran al script
// por `JSON.stringify`, que los deja como literales escapados.
for (const [name, js] of [
  ['GESTURE_TRACKER', GESTURE_TRACKER],
  ['FRAME_GUARD', FRAME_GUARD],
  ['buildBlocker', buildBlocker(true, ['ejemplo.com'], true)],
  ['buildBlocker sin cosmético', buildBlocker(false, [], false)],
  ['buildBlocker sin anti-detección', buildBlocker(true, [], true, 'a.com', '.x', false)],
  ['buildBlocker con listas descargadas', buildBlocker(true, [], true, 'a.com,b.com', '.ad,.banner')],
  ['siteCssSnippet', siteCssSnippet('.a,.b')],
  ['INSPECT_SNIPPET', INSPECT_SNIPPET],
  ['findSnippet', findSnippet('hola "mundo"', { backwards: true, reset: true })],
  ['CLEAR_FIND', CLEAR_FIND],
] as const) {
  assert.doesNotThrow(() => new Function(js), `${name} no es JavaScript válido`);
}

console.log(
  `ok — blocking checks passed (${BLOCKED_HOSTS.size} dominios, ${sites.length} sitios)`
);
