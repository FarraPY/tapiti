// Genera src/blocking/{hosts,hostsCore,cosmetic}.ts a partir de las listas públicas.
//   node --experimental-strip-types scripts/fetch-lists.ts
//
// La lectura de las listas vive en src/blocking/parseLists.ts, compartida con la
// app: así el actualizador del teléfono entiende las listas igual que este script.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SOURCES, emptyParsed, finalize, parseSource } from '../src/blocking/parseLists.ts';

const parsed = emptyParsed();

for (const src of SOURCES) {
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${src.url} -> HTTP ${res.status}`);
  const r = parseSource(src, await res.text(), parsed);
  console.log(
    `  +${String(r.net).padStart(6)} dominios  +${String(r.cosm).padStart(6)} cosméticos  ${src.url}`
  );
}

const out = finalize(parsed);

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'blocking');
const header =
  `// GENERADO por scripts/fetch-lists.ts — no editar a mano.\n` +
  `// Fuentes:\n${SOURCES.map((s) => `//   ${s.url}\n`).join('')}`;

const hostsJson = JSON.stringify(out.hosts.join(','));
await writeFile(
  path.join(dir, 'hosts.ts'),
  `${header}\n// Lista completa. Vive en RN, no se inyecta: alimenta onShouldStartLoadWithRequest.\n` +
    `const HOSTS = ${hostsJson};\nexport default HOSTS;\n`
);

const coreJson = JSON.stringify(out.core.join(','));
await writeFile(
  path.join(dir, 'hostsCore.ts'),
  `${header}\n// Subconjunto que SÍ se inyecta al WebView en cada página. Mantener chico.\n` +
    `const CORE = ${coreJson};\nexport default CORE;\n`
);

const genericJson = JSON.stringify(out.generic);
const sitesJson = JSON.stringify(out.sites);
await writeFile(
  path.join(dir, 'cosmetic.ts'),
  `${header}\n` +
    `/** Selectores que se ocultan en todo sitio, ya unidos en un solo grupo CSS. */\n` +
    `export const GENERIC_CSS: string = ${genericJson};\n\n` +
    `/** Selectores por dominio. Se inyecta solo el del sitio actual. */\n` +
    `export const SITE_CSS: Record<string, string> = ${sitesJson};\n`
);

const kb = (s: string) => (s.length / 1024).toFixed(0) + ' KB';
console.log(`\nRN    ${out.hosts.length} dominios   ${kb(hostsJson)}`);
console.log(`WebView ${out.core.length} dominios inyectados   ${kb(coreJson)}`);
console.log(`${out.exceptions} excepciones aplicadas`);
console.log(`${out.generic.split(',').length} selectores genéricos   ${kb(genericJson)}`);
console.log(`${Object.keys(out.sites).length} sitios con reglas propias   ${kb(sitesJson)}`);
