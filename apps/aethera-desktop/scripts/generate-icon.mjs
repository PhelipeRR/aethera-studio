// Aethera Studio app, installer, and web favicon icon generator.
// Canonical brand mark: exact prism path, gradient (#6a46d8 -> #9c7df2 -> #d8fb4f),
// and ink dot (#111111) from apps/aethera-web/src/components/AetheraMark.tsx.
// Run from anywhere: node apps/aethera-desktop/scripts/generate-icon.mjs
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, '..');
const repoRoot = resolve(desktopDir, '../..');
const outDir = join(desktopDir, 'build');

export const AETHERA_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32" fill="none">
  <defs>
    <linearGradient id="aethera-prism" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6a46d8"/>
      <stop offset="55%" stop-color="#9c7df2"/>
      <stop offset="100%" stop-color="#d8fb4f"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="8" fill="#ececee"/>
  <path d="M16 4L27.5 26H21.8L16 14.2L10.2 26H4.5L16 4Z" fill="url(#aethera-prism)"/>
  <circle cx="16" cy="22.5" r="2.5" fill="#111111"/>
</svg>
`;

const svgAtSize = (size) =>
  Buffer.from(AETHERA_ICON_SVG.replace('width="512" height="512"', `width="${size}" height="${size}"`));

function tryLoadSharp() {
  try {
    const req = createRequire(join(desktopDir, 'package.json'));
    return req('sharp');
  } catch {
    return null;
  }
}

async function renderPngBuffer(size, sharpLib) {
  if (sharpLib) {
    return sharpLib(svgAtSize(size), { density: Math.max(96, size * 4) })
      .resize(size, size)
      .png()
      .toBuffer();
  }
  const tmpBase = join(tmpdir(), `aethera-icon-${process.pid}-${size}-${Date.now()}`);
  const svgPath = `${tmpBase}.svg`;
  const pngPath = `${tmpBase}.png`;
  try {
    await writeFile(svgPath, svgAtSize(size));
    await execFileAsync('convert', [
      '-background',
      'none',
      '-density',
      String(Math.max(144, size * 4)),
      svgPath,
      '-resize',
      `${size}x${size}`,
      `PNG32:${pngPath}`,
    ]);
    return await readFile(pngPath);
  } finally {
    await rm(svgPath, { force: true }).catch(() => {});
    await rm(pngPath, { force: true }).catch(() => {});
  }
}

function packIco(images) {
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
  return Buffer.concat([header, entries, ...images.map((image) => image.data)]);
}

const sharpLib = tryLoadSharp();
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = await Promise.all(
  icoSizes.map(async (size) => ({ size, data: await renderPngBuffer(size, sharpLib) })),
);
const png512 = await renderPngBuffer(512, sharpLib);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'icon.svg'), AETHERA_ICON_SVG, 'utf-8');
await writeFile(join(outDir, 'icon.png'), png512);
await writeFile(join(outDir, 'icon.ico'), packIco(icoImages));

// Keep web & desktop renderer favicons synced with the exact same SVG mark
for (const publicDir of [
  join(desktopDir, 'src', 'renderer', 'public'),
  join(repoRoot, 'apps', 'aethera-web', 'public'),
]) {
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'favicon.svg'), AETHERA_ICON_SVG, 'utf-8');
}

console.log(`Aethera icons written to ${outDir} (icon.ico [${icoSizes.join(', ')} px], icon.png [512 px], icon.svg)`);
