import BUNDLED_CORE from './hostsCore.ts';
import { GENERIC_CSS as BUNDLED_GENERIC } from './cosmetic.ts';

/**
 * Bloqueo de ventanas emergentes. Va aparte del bloqueo de anuncios y se inyecta
 * siempre, incluso con el escudo apagado: que un sitio no pueda abrir ventanas
 * solo no tiene nada que ver con la publicidad, y sin esto los links normales
 * dejarían de funcionar en los sitios donde apagaste el escudo.
 *
 * Solo un toque de verdad trae `isTrusted`; un script que dispara clicks o llama a
 * `window.open` desde un temporizador no puede falsificarlo.
 */
/**
 * Ventana de mentira que se le devuelve a quien intenta abrir una emergente.
 *
 * Devolver `null` parecía lo correcto y era el error: el guion del popunder hace
 * `var w = window.open(...); w.blur(); location.href = destino;`. Con `null`
 * revienta en `w.blur()` y **la línea que te llevaba a destino nunca corre**. Por
 * eso los enlaces se marcaban y no pasaba nada. Se le da un objeto que acepta todo
 * y no hace nada, así el guion sigue de largo hasta llevarte a donde ibas.
 */
const FAKE_WINDOW = `
  function escudoFakeWindow() {
    var noop = function () {};
    var w = {
      closed: false,
      opener: null,
      name: '',
      focus: noop, blur: noop, print: noop,
      moveTo: noop, moveBy: noop, resizeTo: noop, resizeBy: noop,
      scroll: noop, scrollTo: noop, scrollBy: noop,
      postMessage: noop, addEventListener: noop, removeEventListener: noop,
      setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop,
      alert: noop,
      confirm: function () { return false; },
      prompt: function () { return null; },
      close: function () { w.closed = true; },
      document: {
        write: noop, writeln: noop, open: noop, close: noop,
        body: null, cookie: '', title: '',
        createElement: function () { return {}; },
        getElementById: function () { return null; },
        addEventListener: noop, removeEventListener: noop
      },
      location: { href: 'about:blank', replace: noop, assign: noop, reload: noop, toString: function () { return 'about:blank'; } },
      history: { back: noop, forward: noop, go: noop, pushState: noop, replaceState: noop },
      navigator: { userAgent: navigator.userAgent },
      screen: {}, localStorage: null, sessionStorage: null
    };
    w.self = w; w.window = w; w.top = w; w.parent = w; w.frames = w;
    return w;
  }
`;

export const GESTURE_TRACKER = `
(function () {
  if (window.__escudoGest) return;
  window.__escudoGest = true;
  // De los marcos internos se ocupa FRAME_GUARD.
  if (window.top !== window.self) return;

  var GESTURE_MS = 1000;
  /** Toque sobre un enlace o botón. Exigente: es lo que autoriza abrir ventanas. */
  var last = 0;
  /** Cualquier toque tuyo. Con esto alcanza para no tapar lo que el sitio abra. */
  var lastTouch = 0;
  var lastSent = 0;

  // No alcanza con que hayas tocado: los popunders escuchan el toque en cualquier
  // parte de la página y abren ahí mismo. Solo autoriza un toque sobre algo que de
  // verdad lleva a otro lado — un enlace o un botón.
  function mark(e) {
    if (!e || !e.isTrusted) return;
    // Cualquier toque de verdad cuenta para no tapar lo que el sitio abra después:
    // sus botones propios pueden ser un span o un div con un manejador, y no hay
    // forma de reconocerlos. Un panel de ajustes que abriste vos es del sitio.
    lastTouch = Date.now();
    if (!e.target || !e.target.closest) return;
    var el = e.target.closest('a[href], button, [role="link"], [role="button"]');
    if (!el) return;
    last = Date.now();
    // Se avisa a la app como mucho una vez cada 400 ms: es una señal, no un log.
    if (last - lastSent > 400) {
      lastSent = last;
      try {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            type: 'gesture',
            // A dónde decía ir el enlace. La app compara el destino real contra
            // esto: si no coinciden, el sitio te desvió el toque.
            href: el.href || '',
            page: location.href,
          })
        );
      } catch (e2) {}
    }
  }

  // Diálogos del sistema (alert / confirm / prompt). Los sitios de publicidad los
  // usan para los avisos falsos de "instalá una VPN". Se cancelan y se avisa a la
  // app; devolver false o null equivale a que tocaste Cancelar, que es lo seguro.
  var dialogs = 0;
  function stubDialog(name, value) {
    window[name] = function () {
      dialogs++;
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dialog', n: dialogs }));
      } catch (e) {}
      return value;
    };
  }
  stubDialog('alert', undefined);
  stubDialog('confirm', false);
  stubDialog('prompt', null);

  document.addEventListener('pointerdown', mark, true);
  document.addEventListener('touchstart', mark, true);
  document.addEventListener('click', mark, true);

  // Miniaturas: en los foros de imágenes la foto es un enlace a la versión grande,
  // y el sitio la expande ahí mismo con su propio guion. En el teléfono eso no
  // pasa, así que el enlace navega y te saca del hilo. Se expande en el lugar, y
  // otro toque la vuelve a achicar.
  /** Cuándo tocaste una miniatura. Ese toque no autoriza abrir nada. */
  var thumbAt = 0;

  function thumbLink(e) {
    if (!e.isTrusted || !e.target || !e.target.closest) return null;
    var a = e.target.closest('a[href]');
    if (!a || !/\\.(jpe?g|png|gif|webp|avif|bmp)(\\?|#|$)/i.test(a.href)) return null;
    return a.querySelector('img') ? a : null;
  }

  // Cancelar la acción por defecto no alcanza: el propio sitio navega desde su
  // código, o llama a abrir una ventana. Hay que quedarse con el toque antes de
  // que le llegue, en todos los eventos que podría estar escuchando.
  ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach(
    function (type) {
      // Sobre la ventana, no sobre el documento: la fase de captura empieza por la
      // ventana, así que un manejador del sitio puesto ahí corría antes que el mío
      // y me ganaba el primer toque. Por eso el primero fallaba y los demás no.
      window.addEventListener(
        type,
        function (e) {
          if (!thumbLink(e)) return;
          thumbAt = Date.now();
          // Solo se corta la propagación: cancelar el toque en sí rompería el
          // desplazamiento de la página.
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        },
        true
      );
    }
  );

  window.addEventListener(
    'click',
    function (e) {
      var a = thumbLink(e);
      if (!a) return;
      var img = a.querySelector('img');
      thumbAt = Date.now();
      // La app también corta la navegación a esa imagen: el sitio puede mandarte
      // ahí por su cuenta, sin pasar por el enlace.
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'thumb', url: a.href }));
      } catch (e2) {}

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (a.__escudoBig) {
        img.src = a.__escudoThumb;
        img.style.maxWidth = a.__escudoMax || '';
        img.style.width = a.__escudoW || '';
        img.style.height = a.__escudoH || '';
        a.__escudoBig = false;
      } else {
        a.__escudoThumb = img.src;
        a.__escudoMax = img.style.maxWidth;
        a.__escudoW = img.style.width;
        a.__escudoH = img.style.height;
        img.src = a.href;
        img.style.maxWidth = '100%';
        img.style.width = 'auto';
        img.style.height = 'auto';
        a.__escudoBig = true;
      }
    },
    true
  );

  // Los enlaces que abren en pestaña nueva se resuelven acá, donde el toque se
  // conoce en el instante. Si se dejaran al sistema, la app tendría que decidir
  // con un aviso que viaja después, y para cuando llega ya no consta que tocaste
  // nada: el enlace se marcaba pero no pasaba nada.
  document.addEventListener(
    'click',
    function (e) {
      // Si ya lo atendió el expansor de miniaturas, no se abre nada.
      if (e.defaultPrevented) return;
      if (!e.isTrusted || !e.target || !e.target.closest) return;
      var a = e.target.closest('a[target="_blank"], a[target="_new"]');
      if (!a || !a.href || !/^https?:/i.test(a.href)) return;
      // Solo se cancela la acción por defecto. Sin cortar la propagación: el sitio
      // puede tener su propio manejador y romperlo trae más problemas que resolver.
      e.preventDefault();
      try {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({ type: 'opentab', url: a.href })
        );
      } catch (e2) {}
    },
    true
  );

  // El bloqueador lo consulta para no tapar un cuadro que abriste vos.
  window.__escudoGestureAt = function () {
    return lastTouch;
  };

  // Muchos sitios prohíben agrandar la página con los dedos. Safari ignora esa
  // prohibición desde hace años porque es un problema de accesibilidad; el
  // componente que usa esta app, no. Se le quita el candado y se respeta el resto
  // de la configuración del sitio, que define cómo se ve en el teléfono.
  function allowZoom() {
    try {
      var m = document.querySelector('meta[name="viewport"]');
      if (!m) {
        if (!document.head) return;
        m = document.createElement('meta');
        m.setAttribute('name', 'viewport');
        m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=5');
        document.head.appendChild(m);
        return;
      }
      var c = m.getAttribute('content') || '';
      var locked = /user-scalable\\s*=\\s*(no|0)/i.test(c) || /maximum-scale\\s*=\\s*[01](\\.\\d+)?/i.test(c);
      if (!locked) return;
      var kept = c.split(',').filter(function (p) {
        return !/user-scalable|maximum-scale|minimum-scale/i.test(p);
      });
      kept.push('maximum-scale=5');
      kept.push('user-scalable=yes');
      m.setAttribute('content', kept.join(','));
    } catch (e) {}
  }

  allowZoom();
  document.addEventListener('DOMContentLoaded', allowZoom);
  // Algunos la vuelven a poner después de cargar; se insiste un rato y se deja.
  var zoomTries = 0;
  var zoomTimer = setInterval(function () {
    allowZoom();
    if (++zoomTries >= 10) clearInterval(zoomTimer);
  }, 1500);

  ${FAKE_WINDOW}

  var _open = window.open;
  window.open = function () {
    // Tocar una foto para agrandarla no autoriza abrir ventanas. Sin esto, el
    // sitio aprovechaba ese mismo toque para colar su ventana de publicidad.
    if (Date.now() - thumbAt < 1500) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'popup' }));
      } catch (e) {}
      return escudoFakeWindow();
    }
    if (Date.now() - last > GESTURE_MS) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'popup' }));
      } catch (e) {}
      return escudoFakeWindow();
    }
    // El permiso se gasta: un toque, una ventana.
    last = 0;
    return _open.apply(this, arguments);
  };
})();
true;
`;

/**
 * JS que corre en document-start dentro del WKWebView.
 * Intercepta fetch/XHR/sendBeacon, arranca nodos de anuncios y aplica el CSS
 * cosmético genérico de EasyList.
 *
 * Este es el único bloqueo posible sin módulo nativo, y tiene dos agujeros:
 * solo lleva el subconjunto `core` de dominios (la lista completa no cabe), y no
 * ve los subrecursos que el parser de WebKit pide por su cuenta antes de que
 * corra el MutationObserver. Los dos los cierra WKContentRuleList en Fase 2.
 */
export function buildBlocker(
  withCosmetic: boolean,
  userBlocked: string[] = [],
  withOverlays = true,
  // Las listas se pasan desde afuera para que la versión descargada reemplace a la
  // empaquetada sin tocar este archivo.
  core: string = BUNDLED_CORE,
  genericCss: string = BUNDLED_GENERIC,
  withAntiDetect = true
): string {
  return `
${FRAME_GUARD}
${GESTURE_TRACKER}
(function () {
  if (window.__escudo) return;
  window.__escudo = true;
  // Lo pesado (la lista de dominios) solo en la página principal: multiplicado por
  // cada marco no entraría en memoria.
  if (window.top !== window.self) return;

  // Copias sin parchear de lo que más abajo se puede llegar a falsear para engañar
  // a los detectores de bloqueadores. Todo lo que decide qué tapar tiene que usar
  // estas, o el escudo terminaría creyéndose su propia mentira.
  var realRect = Element.prototype.getBoundingClientRect;
  var realStyle = window.getComputedStyle.bind(window);
  function rectOf(el) { return realRect.call(el); }
  function styleOf(el) { return realStyle(el); }

  var HOSTS = new Set(${JSON.stringify(core)}.split(','));
  var MINE = new Set(${JSON.stringify(userBlocked)});
  // Espejo de src/blocking/heuristics.ts. Va duplicado porque este código corre
  // dentro de la página, sin acceso a los módulos de la app.
  var ABUSE_TLDS = new Set(${JSON.stringify([
    'qpon', 'cyou', 'cfd', 'bid', 'sbs', 'icu', 'monster', 'quest',
    'boats', 'autos', 'makeup', 'beauty', 'hair', 'skin', 'mom',
    'lol', 'rest', 'buzz', 'cam', 'uno', 'gdn', 'realtor',
  ])});
  var seen = new Set();
  var passed = new Set();
  var raw = 0;

  function hostOf(url) {
    try {
      var m = /^https?:\\/\\/([^/?#]+)/i.exec(String(url));
      if (!m) return '';
      return m[1].split('@').pop().split(':')[0].toLowerCase();
    } catch (e) { return ''; }
  }

  function generated(label) {
    if (/^[0-9a-f]{8,}$/i.test(label)) return true;
    if (/^\\d{6,}[-.]/.test(label)) return true;
    if (label.length >= 8 && /\\d/.test(label) && /[a-z]/i.test(label) && label.indexOf('-') === -1) {
      var digits = (label.match(/\\d/g) || []).length;
      if (digits >= label.length / 3) return true;
    }
    return false;
  }

  function sameSite(h) {
    var p = location.hostname.toLowerCase();
    if (h === p) return true;
    return h.split('.').slice(-2).join('.') === p.split('.').slice(-2).join('.');
  }

  /** Por forma del nombre. Solo se juzga a terceros: el sitio visitado nunca. */
  function looksLikeAd(h) {
    if (sameSite(h)) return false;
    var parts = h.split('.');
    if (parts.length < 2) return false;
    if (ABUSE_TLDS.has(parts[parts.length - 1])) return true;
    if (generated(parts[parts.length - 2])) return true;
    if (parts.length > 2 && generated(parts[0])) return true;
    return false;
  }

  function blocked(url) {
    var h = hostOf(url);
    if (!h) return false;
    // sube por los labels: a.ads.example.com -> ads.example.com -> example.com
    var w = h;
    for (;;) {
      if (HOSTS.has(w) || MINE.has(w)) return true;
      var dot = w.indexOf('.');
      if (dot === -1) break;
      w = w.slice(dot + 1);
    }
    return looksLikeAd(h);
  }

  function hit(url) {
    // Cuenta cruda, sin agrupar: si un script reintenta en bucle, se ve acá y en
    // ningún otro lado, porque el contador de la interfaz agrupa por dominio.
    raw++;
    if (raw % 500 === 0) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'flood', n: raw }));
      } catch (e) {}
    }
    // un dominio cuenta una sola vez por página: el contador mide cobertura,
    // no volumen de reintentos del sitio
    var h = hostOf(url);
    if (h && seen.has(h)) return;
    if (h) seen.add(h);
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'blocked', host: h }));
    } catch (e) {}
  }

  // Dominios de terceros que NO se cortaron. Es la única forma de contestar
  // "¿por qué sigue apareciendo este anuncio?": lo que falta en las listas está acá.
  function pass(url) {
    var h = hostOf(url);
    if (!h || h === location.hostname || passed.has(h)) return;
    passed.add(h);
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'allow', host: h }));
    } catch (e) {}
  }

  // --- red ---
  // Al cortar una petición hay que contestarle algo al sitio. Un rechazo suelto o
  // un silencio dejan al script de publicidad esperando, y esos scripts reintentan
  // para siempre: el reintento infinito es lo que termina agotando la pestaña.
  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (blocked(url)) {
        hit(url);
        // Respuesta vacía pero válida: el sitio la da por terminada y sigue.
        try {
          return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
        } catch (e) {
          return Promise.resolve();
        }
      }
      pass(url);
      return _fetch.apply(this, arguments);
    };
  }

  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (blocked(url)) {
      hit(url);
      this.__escudoBlocked = true;
    } else {
      pass(url);
    }
    return _xhrOpen.apply(this, arguments);
  };

  var _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (!this.__escudoBlocked) return _xhrSend.apply(this, arguments);
    // Se avisa que terminó en error, en vez de dejar la petición colgada.
    var xhr = this;
    setTimeout(function () {
      try {
        Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(xhr, 'status', { value: 0, configurable: true });
        xhr.dispatchEvent(new Event('readystatechange'));
        xhr.dispatchEvent(new Event('error'));
        xhr.dispatchEvent(new Event('loadend'));
      } catch (e) {}
    }, 0);
  };

  if (navigator.sendBeacon) {
    var _beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url) {
      if (blocked(url)) { hit(url); return true; }
      return _beacon.apply(null, arguments);
    };
  }

  // --- nodos ---
  // Techo de nodos que se arrancan por página. Si un sitio con protección
  // anti-adblock reinserta el anuncio cada vez que lo sacamos, el ida y vuelta no
  // termina nunca y la pestaña se queda sin memoria. Llegado al tope se suelta y
  // la página queda con anuncios, que es mejor que cerrar la app.
  var MAX_REMOVALS = 400;
  var removals = 0;
  var observer = null;
  var pending = [];
  var scheduled = false;

  function check(el) {
    if (!el || el.nodeType !== 1 || !el.getAttribute) return;
    if (el.__escudoSeen) return;
    el.__escudoSeen = 1;
    var src = el.getAttribute('src') || el.getAttribute('data-src');
    if (!src) return;
    if (blocked(src)) {
      hit(src);
      el.remove();
      removals++;
    } else {
      pass(src);
    }
  }

  // querySelectorAll ya devuelve todos los descendientes: recorrerlos y volver a
  // consultar dentro de cada uno hacía trabajo cuadrático, y en páginas con scroll
  // infinito eso solo crece hasta que la pestaña se queda sin aire.
  function scrub(node) {
    if (!node || node.nodeType !== 1) return;
    check(node);
    if (!node.querySelectorAll) return;
    var kids = node.querySelectorAll('[src],[data-src]');
    for (var i = 0; i < kids.length; i++) check(kids[i]);
  }

  function giveUp() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    pending = [];
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'gaveup' }));
    } catch (e) {}
  }

  // Las mutaciones se juntan y se procesan de a tandas: un sitio que agrega miles
  // de nodos por segundo no debe disparar miles de recorridos por segundo.
  // --- carteles superpuestos ---
  // Cuando el anuncio no llega por la red sino que lo dibuja un script que ya
  // estaba en la página, no hay dominio que bloquear. Lo que sí se puede leer es
  // la forma: un cuadro grande, encimado sobre todo, que aparece solo.
  var OVERLAYS = ${withOverlays};
  var overlaysHidden = 0;

  function looksLikeOverlay(el) {
    try {
      if (el.__escudoHidden || el.__escudoAllowed) return false;

      var cs = styleOf(el);
      var fixed = cs.position === 'fixed';
      if (!fixed && cs.position !== 'absolute') return false;
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;

      // Firmas que no admiten discusión, sin importar el tamaño:
      //
      // 1. z-index pegado al máximo entero (2147483647). Es "que nada quede por
      //    encima mío". Un sitio real se maneja con valores de dos o tres cifras.
      // 2. Clase de una letra y doce o más dígitos al azar (c6531419909601340),
      //    generada justamente para que ninguna regla pueda nombrarla.
      //
      // El cartel medía 139 píxeles de ancho y por eso pasaba por debajo del
      // umbral de tamaño, aunque después se despliegue sobre toda la pantalla.
      if ((parseInt(cs.zIndex, 10) || 0) >= 2000000000) return true;
      var cls = String(el.className || '').trim();
      if (/^[a-z]\\d{12,}$/i.test(cls)) return true;

      // De acá para abajo se juzga por tamaño, y ahí sí hay que ser prudente:
      // durante la carga las medidas todavía cambian, y un cuadro que abriste vos
      // hace un momento es del sitio, no publicidad.
      if (document.readyState !== 'complete') return false;
      var at = window.__escudoGestureAt ? window.__escudoGestureAt() : 0;
      if (Date.now() - at < 1500) {
        // Y queda permitido para siempre. El barrido pasa cada 0,7 segundos: sin
        // esto, un panel que abriste vos sobrevivía apenas un instante y después
        // lo tapaba igual, que es exactamente lo que se veía como "se abre y se
        // cierra solo".
        el.__escudoAllowed = 1;
        return false;
      }

      var r = rectOf(el);
      if (r.width < innerWidth * 0.4 || r.height < 60) return false;
      if (r.width * r.height < innerWidth * innerHeight * 0.08) return false;
      // Tiene que estar tapándote la pantalla ahora, no más abajo en la página.
      if (r.bottom < 0 || r.top > innerHeight) return false;

      // Un video incrustado también es un marco ancho y posicionado, pero está
      // colocado DENTRO de un contenedor del artículo. Un cartel encimado se
      // posiciona contra la página entera. Esa es la diferencia que los separa.
      if (!fixed) {
        var anchor = el.offsetParent;
        if (anchor && anchor !== document.body) return false;
        if ((parseInt(cs.zIndex, 10) || 0) < 100) return false;
      }

      // Un marco encimado no necesita z-index alto para taparte la pantalla: su
      // contenido viene escrito adentro (srcdoc) y no pasa por la red, así que no
      // hay dominio que bloquear. Es la vía por donde entraba este cartel.
      if (el.tagName === 'IFRAME' || el.querySelector('iframe')) return true;

      return fixed || (parseInt(cs.zIndex, 10) || 0) >= 100;
    } catch (e) {
      return false;
    }
  }

  /**
   * Banner con la imagen escrita adentro del HTML en base64, dentro de un enlace
   * que sale a otro dominio. Se hace así justamente para que no haya descarga que
   * cortar ni dominio que bloquear, y es lo que delata al aviso: nadie incrusta
   * una imagen del tamaño exacto de un banner por casualidad.
   */
  var BANNER_SIZES = [
    [300, 250], [336, 280], [320, 100], [320, 50], [728, 90],
    [300, 600], [160, 600], [468, 60], [250, 250], [200, 200]
  ];

  function bannerSized(w, h) {
    for (var i = 0; i < BANNER_SIZES.length; i++) {
      var b = BANNER_SIZES[i];
      // Tolerancia: el sitio suele escalarlos un poco.
      if (Math.abs(w - b[0]) <= 30 && Math.abs(h - b[1]) <= 30) return true;
    }
    return false;
  }

  /** Carpetas donde los sitios guardan la publicidad que venden ellos mismos. */
  var AD_PATH = /\\/(buttons?|banners?|ads?|publi|publicidad|anuncios?|sponsors?|partners?)\\//i;
  /** Parámetros con los que el anunciante cuenta de dónde vino el visitante. */
  var AD_PARAMS = /[?&](utm_|ref=|refid|aff|affiliate|clickid|subid|campaign|partner)/i;

  function looksLikeBannerAd(el) {
    try {
      if (el.__escudoHidden || el.__escudoAllowed || el.tagName !== 'A' || !el.href) return false;
      // Tiene que sacarte del sitio: los enlaces internos son contenido.
      var h = hostOf(el.href);
      if (!h || sameSite(h)) return false;

      var img = el.querySelector('img');
      if (!img) return false;
      // Se mide la IMAGEN, no el enlace: el enlace suele ser un elemento en línea
      // que no envuelve a la foto y mide casi nada (6869 contra 121476 en el
      // banner que se escapaba). Medir el marco en vez del cuadro.
      var r = rectOf(img);
      if (r.width < 150 || r.height < 40 || r.width * r.height < 15000) return false;

      var src = img.getAttribute('src') || '';
      // Cualquiera de las tres firmas alcanza:
      //   la imagen viaja incrustada para que no haya descarga que cortar,
      //   está guardada en la carpeta de publicidad del propio sitio,
      //   o el enlace lleva la etiqueta con la que el anunciante cuenta clics.
      if (src.slice(0, 11) === 'data:image/') return true;
      if (AD_PATH.test(src)) return true;
      if (AD_PARAMS.test(el.href)) return true;
      // O simplemente mide como un banner de manual.
      return bannerSized(r.width, r.height);
    } catch (e) {
      return false;
    }
  }

  function hideIfOverlay(el) {
    if (!el || el.nodeType !== 1) return;
    if (looksLikeOverlay(el) || looksLikeBannerAd(el)) hideOverlay(el);
  }

  /**
   * Barrido periódico. Mirar solo el instante en que el nodo se inserta no
   * alcanza: estos carteles se insertan vacíos y recién después reciben tamaño,
   * posición y contenido. Se revisa lo que cuelga del cuerpo y todos los marcos,
   * que son pocos y baratos de recorrer.
   */
  function sweep() {
    if (!OVERLAYS) return;
    try {
      var kids = document.body ? document.body.children : [];
      for (var i = 0; i < kids.length; i++) hideIfOverlay(kids[i]);
      var frames = document.querySelectorAll('iframe');
      for (var j = 0; j < frames.length; j++) {
        hideIfOverlay(frames[j]);
        if (frames[j].parentElement) hideIfOverlay(frames[j].parentElement);
      }
      // Banners: cualquier imagen dentro de un enlace, en cualquier parte del
      // árbol. Se los juzga por lo que son, no por dónde cuelgan.
      var linked = document.querySelectorAll('a[href] img');
      for (var k = 0; k < linked.length; k++) {
        var link = linked[k].closest('a[href]');
        if (link) hideIfOverlay(link);
      }
    } catch (e) {}
  }
  setInterval(sweep, 700);

  // Inspección a pedido: describe lo que hay encimado en el momento exacto en que
  // el cartel está en pantalla. Se dispara desde el panel de diagnóstico.
  window.__escudoInspect = function () {
    try {
      function describe(el, why) {
        var cs = styleOf(el);
        var r = rectOf(el);
        return (
          why + ' ' + el.tagName +
          (el.id ? '#' + el.id : '') +
          (el.className ? '.' + String(el.className).trim().split(/\\s+/).join('.').slice(0, 24) : '') +
          ' ' + cs.position + ' z=' + cs.zIndex +
          ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
          ' top=' + Math.round(r.top) +
          ' padre=' + (el.parentElement ? el.parentElement.tagName : '-') +
          ' src=' + String(el.getAttribute ? (el.getAttribute('src') || el.src || '') : '').slice(0, 55) +
          ' txt=' + (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 45) +
          (el.__escudoHidden ? ' [TAPADO]' : '')
        );
      }

      var out = [];
      // Todo lo que muestre algo y sea grande, esté donde esté y como esté
      // posicionado. Un aviso puede ser un marco, una imagen, un video o un lienzo.
      var media = document.querySelectorAll('iframe, img, video, canvas, embed, object, picture');
      var big = [];
      for (var m = 0; m < media.length; m++) {
        var mr = rectOf(media[m]);
        if (mr.width * mr.height > 15000) big.push([media[m], mr.width * mr.height]);
      }
      big.sort(function (a, b) { return b[1] - a[1]; });
      for (var n = 0; n < big.length && n < 8; n++) {
        var el0 = big[n][0];
        var link = el0.closest ? el0.closest('a[href]') : null;
        // Veredicto de las reglas sobre el enlace que lo contiene: si no se tapa,
        // esto dice exactamente qué condición falló.
        var verdict = '';
        if (link) {
          try {
            var lh = hostOf(link.href);
            var lr = rectOf(el0);
            var lsrc = el0.getAttribute ? el0.getAttribute('src') || '' : '';
            verdict =
              ' | externo=' + (lh && !sameSite(lh) ? 'si' : 'NO') +
              ' area=' + Math.round(lr.width * lr.height) +
              ' rutaAd=' + (AD_PATH.test(lsrc) ? 'si' : 'no') +
              ' params=' + (AD_PARAMS.test(link.href) ? 'si' : 'no') +
              ' medida=' + (bannerSized(lr.width, lr.height) ? 'si' : 'no') +
              ' => VEREDICTO=' + (looksLikeBannerAd(link) ? 'TAPAR' : 'dejar');
          } catch (ve) {
            verdict = ' | error al evaluar: ' + ve;
          }
        }
        out.push(
          describe(el0, 'MEDIA') +
            ' dentroDe=' + (link ? 'A->' + String(link.href).slice(0, 45) : '-') +
            verdict
        );
      }
      // Y cualquier cosa encimada o con z-index alto que se vea ahora.
      var all = document.querySelectorAll('body *');
      for (var i = 0; i < all.length && out.length < 20; i++) {
        var el = all[i];
        var cs2 = styleOf(el);
        if (cs2.display === 'none' || cs2.visibility === 'hidden') continue;
        var z = parseInt(cs2.zIndex, 10) || 0;
        var pos = cs2.position === 'fixed' || cs2.position === 'absolute';
        if (!pos && z < 100) continue;
        var r2 = rectOf(el);
        if (r2.width * r2.height < 20000) continue;
        if (r2.bottom < 0 || r2.top > innerHeight) continue;
        out.push(describe(el, 'ENCIMA'));
      }

      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          type: 'inspect',
          items: out,
          frames: frames.length,
        })
      );
    } catch (e) {}
  };

  /**
   * Sube por los contenedores del elemento tapado y esconde los que quedaron
   * vacíos. Sin esto queda el hueco reservado donde estaba el aviso, que es tan
   * molesto como el aviso. Se frena en cuanto encuentra algo con texto o con algo
   * visible adentro, así que nunca se lleva contenido por delante.
   */
  function collapseEmpty(el) {
    var p = el.parentElement;
    for (var depth = 0; p && p !== document.body && depth < 4; depth++) {
      if ((p.textContent || '').trim().length > 0) break;
      var visible = false;
      for (var i = 0; i < p.children.length; i++) {
        var c = p.children[i];
        if (c.__escudoHidden) continue;
        var cr = rectOf(c);
        if (cr.width > 2 && cr.height > 2) {
          visible = true;
          break;
        }
      }
      if (visible) break;
      p.__escudoHidden = 1;
      p.style.setProperty('display', 'none', 'important');
      p = p.parentElement;
    }
  }

  function hideOverlay(el) {
    el.__escudoHidden = 1;
    el.style.setProperty('display', 'none', 'important');
    collapseEmpty(el);
    overlaysHidden++;
    try {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: 'overlay', n: overlaysHidden })
      );
    } catch (e) {}
  }

  function flush() {
    scheduled = false;
    var batch = pending;
    pending = [];
    for (var i = 0; i < batch.length; i++) {
      scrub(batch[i]);
      if (OVERLAYS) hideIfOverlay(batch[i]);
    }
    if (removals > MAX_REMOVALS) giveUp();
  }

  observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) pending.push(added[j]);
    }
    if (pending.length > 20000) return giveUp();
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 50);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // --- cosmético ---
  // Idempotente y llamable de nuevo desde RN (injectJavaScript) para sumar
  // las reglas propias del sitio, que no viajan en este script.
  window.__escudoCss = function (selectors) {
    if (!selectors) return;
    var s = document.createElement('style');
    s.textContent = selectors + '{display:none !important}';
    (document.head || document.documentElement).appendChild(s);
  };
  ${withCosmetic ? `window.__escudoCss(${JSON.stringify(genericCss)});` : '/* cosmético apagado */'}

  // --- contra los sitios que exigen apagar el bloqueador ---
  // Detectan el bloqueo poniendo un elemento señuelo con pinta de anuncio y
  // midiéndolo: si quedó en cero, saben que hay un bloqueador y tapan el
  // contenido. Acá se les responde con las medidas que esperan, pero SOLO para
  // los elementos que este escudo ocultó. Todo lo demás se mide de verdad, y lo
  // que decide qué tapar usa las copias sin parchear de arriba.
  ${
    withAntiDetect
      ? `
  (function () {
    var FAKE = { width: 300, height: 250 };

    var _rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      var r = _rect.call(this);
      if (!this.__escudoHidden || r.width || r.height) return r;
      return {
        x: 0, y: 0, top: 0, left: 0,
        right: FAKE.width, bottom: FAKE.height,
        width: FAKE.width, height: FAKE.height,
        toJSON: function () { return this; }
      };
    };

    var _gcs = window.getComputedStyle;
    window.getComputedStyle = function (el, pseudo) {
      var cs = _gcs.call(window, el, pseudo);
      if (!el || !el.__escudoHidden) return cs;
      var lie = { display: 'block', visibility: 'visible', opacity: '1' };
      try {
        return new Proxy(cs, {
          get: function (t, k) {
            if (k in lie) return lie[k];
            if (k === 'getPropertyValue') {
              return function (p) { return p in lie ? lie[p] : t.getPropertyValue(p); };
            }
            var v = t[k];
            return typeof v === 'function' ? v.bind(t) : v;
          }
        });
      } catch (e) {
        return cs;
      }
    };

    ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth'].forEach(function (prop) {
      var d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
      if (!d || !d.get) return;
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get: function () {
          if (!this.__escudoHidden) return d.get.call(this);
          return prop.indexOf('Height') > 0 ? FAKE.height : FAKE.width;
        }
      });
    });
  })();
  `
      : '/* engaño a detectores apagado */'
  }
})();
true;
`;
}

/**
 * Guardia liviana para TODOS los marcos, incluidos los internos. No lleva listas:
 * solo cancela los carteles del sistema y tapa lo que se encima, que es lo único
 * que hace falta adentro de un marco de publicidad. Va por la otra ranura de
 * inyección, la que corre después de cargar, porque esa sí admite marcos internos.
 */
export const FRAME_GUARD = `
(function () {
  if (window.__escudoFrame) return;
  window.__escudoFrame = true;
  if (window.top === window.self) return;

  function stub(name, value) {
    window[name] = function () {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dialog', n: 1 }));
      } catch (e) {}
      return value;
    };
  }
  stub('alert', undefined);
  stub('confirm', false);
  stub('prompt', null);

  ${FAKE_WINDOW}
  window.open = function () { return escudoFakeWindow(); };
})();
true;
`;

/** Inspección disparada a mano desde el panel de diagnóstico. */
export const INSPECT_SNIPPET = `window.__escudoInspect && window.__escudoInspect(); true;`;

/**
 * Buscar texto dentro de la página. `window.find` es del propio motor: resalta la
 * coincidencia y hace desplazar hasta ella. Con `reset` empieza de arriba; sin él,
 * sigue desde la última, que es lo que hacen los botones de anterior y siguiente.
 */
export function findSnippet(text: string, opts: { backwards?: boolean; reset?: boolean } = {}) {
  return `
(function () {
  try {
    if (${!!opts.reset} && window.getSelection) window.getSelection().removeAllRanges();
    var ok = window.find(${JSON.stringify(text)}, false, ${!!opts.backwards}, true, false, true, false);
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'find', found: !!ok }));
  } catch (e) {}
})();
true;
`;
}

/** Suelta el resaltado al cerrar la barra de búsqueda. */
export const CLEAR_FIND = `
(function () {
  try { if (window.getSelection) window.getSelection().removeAllRanges(); } catch (e) {}
})();
true;
`;

/** Snippet para aplicar las reglas cosméticas de un sitio ya cargado. */
export function siteCssSnippet(selectors: string): string {
  return `window.__escudoCss && window.__escudoCss(${JSON.stringify(selectors)}); true;`;
}
