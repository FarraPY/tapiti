// Genera todos los iconos a partir de assets/icon.svg.
//   node --experimental-strip-types scripts/make-icons.ts
//
// El original es vectorial para que se pueda regenerar a cualquier tamaño sin
// perder nitidez. iOS redondea las esquinas por su cuenta, así que el cuadrado va
// entero y sin transparencia.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const svg = await readFile(path.join(dir, 'icon.svg'));

async function png(name: string, size: number, buf: Buffer = svg) {
  const out = await sharp(buf).resize(size, size).png().toBuffer();
  await writeFile(path.join(dir, name), out);
  console.log(`  ${name.padEnd(30)} ${size}x${size}  ${(out.length / 1024).toFixed(0)} KB`);
}

await png('icon.png', 1024);
await png('favicon.png', 64);

// Android recorta el frente a un círculo y le aplica sombra, así que el escudo va
// solo y con aire alrededor; el fondo es una capa aparte.
const foreground = svg
  .toString()
  .replace('<rect width="1024" height="1024" fill="url(#bg)"/>', '')
  .replace(
    'viewBox="0 0 1024 1024"',
    'viewBox="-160 -160 1344 1344"'
  );
await png('android-icon-foreground.png', 1024, Buffer.from(foreground));

const background = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#23232b"/><stop offset="100%" stop-color="#0d0d11"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#b)"/>
</svg>`;
await png('android-icon-background.png', 1024, Buffer.from(background));

// La versión monocroma la tiñe el sistema: solo importa la silueta, así que las
// facetas se aplanan a un único color.
const mono = svg
  .toString()
  .replace('<rect width="1024" height="1024" fill="url(#bg)"/>', '')
  .replaceAll('#c3c3ce', '#ffffff')
  .replaceAll('opacity="0.55"', '')
  .replaceAll('opacity="0.45"', '')
  .replaceAll('opacity="0.35"', '')
  .replace('viewBox="0 0 1024 1024"', 'viewBox="-160 -160 1344 1344"');
await png('android-icon-monochrome.png', 1024, Buffer.from(mono));

// La pantalla de arranque va sin fondo: Expo pone el color por debajo.
const splash = svg
  .toString()
  .replace('<rect width="1024" height="1024" fill="url(#bg)"/>', '');
await png('splash-icon.png', 512, Buffer.from(splash));

console.log('\nlisto — regenerar con: node --experimental-strip-types scripts/make-icons.ts');
