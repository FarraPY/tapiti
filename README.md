# escudo-browser

Navegador iOS con bloqueo de anuncios. **Expo SDK 54**, fijado a propósito: es el SDK
que soporta el Expo Go instalado en el iPhone. No actualizar sin verificar Expo Go primero.

## El problema real

Brave en Android bloquea mejor que en iOS porque en Android usa su propio motor
adblock en la capa de red de Chromium. En iOS, Apple obliga a usar **WKWebView**, y
lo único disponible es:

1. `WKContentRuleList` — reglas JSON compiladas por WebKit. Límite ~150.000 reglas
   por lista, pero se pueden instalar varias listas.
2. Inyección de JS en `document-start` — filtrado cosmético y parcheo de
   `fetch`/`XHR`.

Ese es el techo. No es un bug de Brave.

## Fases

### Fase 1 — Expo Go (esto es lo que hay ahora)

Corre en Expo Go sin build nativo.

**Dos niveles de bloqueo de red**, porque cuestan cosas distintas:

| | dominios | costo | alcance |
|---|---|---|---|
| RN (`hosts.ts`) | 96 289 | cero por página | solo lo que ve `onShouldStartLoadWithRequest`: navegaciones e iframes |
| WebView (`hostsCore.ts`) | 58 537 | 1012 KB inyectados por página | `fetch`, `XHR`, `sendBeacon`, nodos con `src` |

La lista completa no cabe dentro de cada página. El núcleo se saca de ella
**colapsando a la raíz**: si las listas nombran varios subdominios de un mismo
dominio (`d7.cdn.traffmovie.com`, `z.cdn.traffmovie.com`, …), entra una sola
entrada, `traffmovie.com`, y el matcher por labels cubre el resto. Los subdominios
sueltos de dominios no listados se quedan afuera del núcleo.

Que el núcleo fuera solo las listas de hosts (6202) era el agujero por donde
pasaban los anuncios: `traffmovie.com`, `premiumvertising.com` y `dtscout.com`
estaban en la lista grande y no en la chica. Se veía en el registro como el mismo
dominio apareciendo `block` y `allow` a la vez.

**Este es el techo de Fase 1 y ya se está tocando.** Un megabyte de lista viajando
dentro de cada página es el precio de no tener `WKContentRuleList`, que compila las
reglas una vez de forma nativa y no cuesta nada por página.

**Cosmético** (EasyList + EasyList Spanish):

- 13 905 selectores genéricos (208 KB) — inyectados en document-start, sin parpadeo.
- 9 059 sitios con reglas propias (564 KB) — el mapa vive en RN y se inyecta **solo
  el del dominio actual**, al terminar la carga. Se ve un parpadeo breve del anuncio.

El matcher sube por los labels del host contra un `Set`: O(labels) por request, no
recorre la lista.

Las 226 reglas de excepción (`@@`) de las listas se aplican y ganan sobre los bloqueos.

Regenerar las listas:

```bash
node --experimental-strip-types scripts/fetch-lists.ts
```

**Lo que NO bloquea:** subrecursos que el parser de WebKit pide por su cuenta antes
de que corra el observer (imágenes y scripts ya presentes en el HTML inicial ganan
la carrera a veces). Para eso hace falta la Fase 2.

Sirve para probar UI y filtros cosméticos. **No sirve para medir bloqueo de red.**

```bash
npm start
```

### Fase 2 — Development build (el bloqueo de verdad)

`WKContentRuleList` no está expuesto por `react-native-webview`. Requiere un módulo
nativo en Swift, y eso significa `expo prebuild` + development build. Expo Go queda
atrás en este punto.

Trabajo pendiente:

- Módulo Expo nativo (Swift) que llame a
  `WKContentRuleListStore.compileContentRuleList(forIdentifier:encodedContentRuleList:)`
  y lo agregue al `WKUserContentController` del WebView.
- Conversor de filtros EasyList/uBO al formato JSON de `WKContentRuleList`.
- Particionar en varias listas para pasar el límite de ~150k reglas.
- Filtros cosméticos por sitio (los genéricos actuales no alcanzan).
- Scriptlets estilo uBO (`abort-on-property-read`, etc.).

Techo más alto todavía: `NEDNSProxyProvider` (Network Extension) para bloqueo a
nivel DNS. Requiere cuenta de Apple Developer de pago y entitlements — y el
certificado ad-hoc actual, con App ID explícito, no puede firmar extensiones.

## Verificación

```bash
node --experimental-strip-types scripts/check-blocking.ts
```

## Estructura

## Defensas de comportamiento

Lo que sigue no depende de listas. Salió de pelear con un imageboard con
publicidad agresiva, y es lo que Brave no tiene **en ninguna plataforma**:

| defensa | qué corta |
|---|---|
| Ventanas por gesto | solo un toque real sobre un enlace autoriza una ventana, y se gasta en una |
| Ventana de mentira | `window.open` devuelve un objeto inerte en vez de `null`: con `null` el popunder revienta en `w.blur()` y **la navegación que seguía nunca corría** |
| Toque desviado | tocaste un enlace del sitio y la navegación termina en otro dominio |
| Cadena de redirecciones | más de 4 saltos entre dominios en 10 s sin que los pidas |
| Rescate | tras cortar un secuestro, se recarga tu destino: cortar cancela la navegación entera, también la tuya |
| Diálogos | `alert`/`confirm`/`prompt` responden como si cancelaras |
| Carteles encimados | `z-index` ≥ 2 000 000 000, o clase tipo `c6531419909601340` |
| Banners auto-servidos | enlace externo + imagen grande + (`data:` \| carpeta `/buttons/` \| `utm_*`) |
| Dominios por su forma | TLD de abuso (`.qpon`, `.cyou`) y nombres generados, **solo en terceros** |
| Anti-detección | responde con medidas falsas a quien mide los elementos que ocultamos |

Se mide siempre con copias sin parchear de `getBoundingClientRect` y
`getComputedStyle`: si no, el escudo se creería su propia mentira.

## Comodidades

Miniaturas que se expanden en el lugar en vez de navegar, zoom desbloqueado
aunque el sitio lo prohíba, favoritos, historial con sugerencias, buscar en la
página, compartir, modo privado, pestañas que sobreviven al cierre y página de
error propia.

## Diagnóstico

**Ajustes → Qué está pasando.** Registra en vivo lo cortado y —lo importante— lo
que **pasó**, que es la única forma de contestar "¿por qué sigue apareciendo este
anuncio?". Incluye **Inspeccionar la página ahora**, que describe lo que hay
encimado y el veredicto de las reglas sobre cada elemento.

Esa herramienta convirtió varios intentos a ciegas en diagnósticos de un tiro.
Los dos hallazgos que no se podían deducir leyendo el código:

- el mismo dominio apareciendo `block` y `allow` a la vez, que reveló el hueco
  entre la lista de RN y la inyectada;
- `area=6869` cuando la imagen medía `121476`, que reveló que se medía el enlace
  en vez de la imagen.

## Estructura

- `App.tsx` — UI del navegador.
- `src/blocking/hosts.ts` — **generado**. Lista completa, lado RN.
- `src/blocking/hostsCore.ts` — **generado**. Núcleo que se inyecta al WebView.
- `src/blocking/cosmetic.ts` — **generado**. Selectores genéricos y por sitio.
- `src/blocking/shouldBlock.ts` — matcher de dominios, con lista reemplazable.
- `src/blocking/heuristics.ts` — juicio por forma del nombre + proveedores exentos.
- `src/blocking/parseLists.ts` — lectura de listas. **Compartida** por el script y
  por la app: una sola forma de entenderlas, no dos que se desincronizan.
- `src/blocking/updateLists.ts` — descarga y guarda las listas desde el teléfono.
- `src/blocking/siteCss.ts` — busca las reglas cosméticas de un host.
- `src/blocking/injected.ts` — JS que corre dentro de la página.
- `scripts/fetch-lists.ts` — regenera los tres `.ts` empaquetados.
- `scripts/check-blocking.ts` — self-check.

El self-check cubre el matcher, las heurísticas (con los falsos positivos que
importan: CloudFront, S3, `ajax.googleapis.com`), el colapso de dominios, y
**compila los seis scripts inyectados**. Eso último porque van como texto: el
compilador de TypeScript nunca los mira, y un carácter de más ahí rompe el
bloqueo entero en silencio — ya pasó una vez.

Los `.ts` generados no se editan a mano. Sus imports llevan la extensión explícita
a propósito: Metro la resuelve igual, y los scripts de Node la exigen.

Los imports de `hosts.ts` llevan la extensión explícita a propósito: Metro la
resuelve igual, y los scripts de Node la exigen.
