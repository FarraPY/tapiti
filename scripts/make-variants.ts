// Variantes de icono para elegir. Genera assets/variants/*.png
//   node --experimental-strip-types scripts/make-variants.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'variants');
await mkdir(dir, { recursive: true });

type Palette = { light: string; dark: string; bg1: string; bg2: string };

const PALETTES: Record<string, Palette> = {
  verde: { light: '#3ee08a', dark: '#12965a', bg1: '#101d18', bg2: '#050b08' },
  cian: { light: '#4fd6f5', dark: '#1682b8', bg1: '#0d1a24', bg2: '#04090e' },
  blanco: { light: '#ffffff', dark: '#b9b9c6', bg1: '#1a1a20', bg2: '#08080a' },
  carmesi: { light: '#ff6b6b', dark: '#c62828', bg1: '#1d1114', bg2: '#0a0507' },
  violeta: { light: '#b79cff', dark: '#6d3fd4', bg1: '#161029', bg2: '#07050f' },
  ambar: { light: '#ffd166', dark: '#d99a12', bg1: '#1e1810', bg2: '#0a0805' },
};

const bg = (p: Palette) => `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="${p.bg1}"/><stop offset="100%" stop-color="${p.bg2}"/>
</linearGradient>`;

/**
 * Liebre facetada. Todo son rectas y ángulos: ni una curva. Las caras de la
 * izquierda van en el tono oscuro y las de la derecha en el claro, así la figura
 * tiene volumen sin usar sombras ni degradados sobre la forma.
 */
function origami(p: Palette) {
  return `
  <g>
    <!-- oreja izquierda -->
    <path fill="${p.dark}"  d="M362 108 L438 196 L470 470 L408 470 Z"/>
    <path fill="${p.light}" d="M438 196 L470 470 L446 470 L424 214 Z" opacity="0.55"/>
    <!-- oreja derecha -->
    <path fill="${p.light}" d="M662 108 L586 196 L554 470 L616 470 Z"/>
    <path fill="${p.dark}"  d="M586 196 L554 470 L578 470 L600 214 Z" opacity="0.45"/>
    <!-- cabeza: hexágono partido al medio -->
    <path fill="${p.dark}"  d="M512 424 L512 838 L344 700 L344 520 Z"/>
    <path fill="${p.light}" d="M512 424 L680 520 L680 700 L512 838 Z"/>
    <!-- hocico: una faceta que corta la punta -->
    <path fill="${p.dark}"  d="M512 838 L680 700 L512 748 Z" opacity="0.35"/>
  </g>`;
}

const variants: Record<string, string> = {};

// Cuatro paletas sobre la misma forma facetada: sirve para elegir color.
for (const key of ['verde', 'cian', 'blanco', 'carmesi'] as const) {
  const p = PALETTES[key];
  variants[`1-facetada-${key}`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <defs>${bg(p)}</defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    ${origami(p)}
  </svg>`;
}

// Dos formas distintas, para elegir también el camino.
{
  const p = PALETTES.violeta;
  // Orejas como cuñas rectas que forman una V. Marca, no dibujo.
  variants['2-cunas-violeta'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <defs>${bg(p)}</defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <path fill="${p.dark}"  d="M300 150 L432 150 L556 800 L470 800 Z"/>
    <path fill="${p.light}" d="M724 150 L592 150 L468 800 L554 800 Z"/>
  </svg>`;
}
{
  const p = PALETTES.ambar;
  // Escudo heráldico de lados rectos, con la liebre recortada adentro.
  variants['3-escudo-angular-ambar'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <defs>${bg(p)}
      <mask id="m">
        <path fill="white" d="M512 128 L836 232 L836 546 L512 900 L188 546 L188 232 Z"/>
        <g fill="black" transform="translate(512 560) scale(0.58) translate(-512 -520)">
          <path d="M362 108 L438 196 L470 470 L408 470 Z"/>
          <path d="M662 108 L586 196 L554 470 L616 470 Z"/>
          <path d="M512 424 L680 520 L680 700 L512 838 L344 700 L344 520 Z"/>
        </g>
      </mask>
      <linearGradient id="sh" x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stop-color="${p.light}"/><stop offset="100%" stop-color="${p.dark}"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <rect width="1024" height="1024" fill="url(#sh)" mask="url(#m)"/>
  </svg>`;
}

for (const [name, svg] of Object.entries(variants)) {
  const buf = Buffer.from(svg);
  await writeFile(path.join(dir, `${name}.svg`), buf);
  // 1024 para verlo grande, y 120 para juzgarlo como se ve de verdad en el teléfono.
  for (const size of [1024, 120]) {
    const out = await sharp(buf).resize(size, size).png().toBuffer();
    await writeFile(path.join(dir, `${name}${size === 120 ? '-chico' : ''}.png`), out);
  }
  console.log(`  ${name}`);
}

console.log(`\n${Object.keys(variants).length} variantes en assets/variants/`);
