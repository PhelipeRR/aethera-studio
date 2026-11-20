// Aethera Studio app and installer icon: the prism logo shown in the app header
// (packages/desktop-shared/src/renderer/src/app/AetheraShell.tsx, AetheraPrismLogo).
// Run from the repository root: node apps/aethera-desktop/scripts/generate-icon.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'apps/aethera-desktop/package.json'));
const sharp = require('sharp');

// Same prism path, gradient (#6a46d8 -> #9c7df2 -> #d8fb4f), and ink dot as AetheraMark (Web & Desktop).
const svg = (size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="p" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6a46d8"/><stop offset="55%" stop-color="#9c7df2"/><stop offset="100%" stop-color="#d8fb4f"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="#ececee"/>
  <path d="M16 4L27.5 26H21.8L16 14.2L10.2 26H4.5L16 4Z" fill="url(#p)"/>
  <circle cx="16" cy="22.5" r="2.5" fill="#111111"/>
</svg>`);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map(async (size) => ({ size, data: await sharp(svg(size), { density: Math.max(72, size * 3) }).resize(size, size).png().toBuffer() })),
);

const out = 'apps/aethera-desktop/build';
await mkdir(out, { recursive: true });

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const entries = Buffer.alloc(images.length * 16);
let offset = 6 + entries.length;
for (const [index, image] of images.entries()) {
  const entry = index * 16;
  const dimension = image.size >= 256 ? 0 : image.size;
  entries.writeUInt8(dimension, entry);
  entries.writeUInt8(dimension, entry + 1);
  entries.writeUInt16LE(1, entry + 4);
  entries.writeUInt16LE(32, entry + 6);
  entries.writeUInt32LE(image.data.length, entry + 8);
  entries.writeUInt32LE(offset, entry + 12);
  offset += image.data.length;
}
await writeFile(join(out, 'icon.ico'), Buffer.concat([header, entries, ...images.map((image) => image.data)]));
console.log(`icon.ico written with ${sizes.join(', ')} px`);
