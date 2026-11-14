import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';

// The app and installer icon is the Singularity mark: Void without its face (lote 50.04, user decision). It is the
// same artwork the app shows (scripts/extract-void-mascot.mjs), over an opaque black horizon, centred on a
// transparent square so Windows renders it on dark and light surfaces alike.
const art = await sharp('apps/desktop/src/renderer/src/assets/void/void-disk-480.webp').toBuffer();
const { width: artWidth = 480, height: artHeight = 341 } = await sharp(art).metadata();
const scale = artWidth / 725;
const horizon = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${artWidth}" height="${artHeight}"><ellipse cx="${381 * scale}" cy="${284 * scale}" rx="${174 * scale}" ry="${186 * scale}" fill="#010304"/></svg>`);
const mark = await sharp(horizon).composite([{ input: art }]).png().toBuffer();
const side = artWidth;
const square = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: mark, left: 0, top: Math.round((side - artHeight) / 2) }])
  .png()
  .toBuffer();
const svg = square;
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(async (size) => ({ size, data: await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer() })));
await mkdir('apps/desktop/build', { recursive: true });
await writeFile('apps/desktop/build/icon.png', images.at(-1).data);

const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
const entries = Buffer.alloc(images.length * 16); let offset = 6 + entries.length;
for (const [index, image] of images.entries()) {
  const entry = index * 16; const dimension = image.size >= 256 ? 0 : image.size;
  entries.writeUInt8(dimension, entry); entries.writeUInt8(dimension, entry + 1); entries.writeUInt8(0, entry + 2); entries.writeUInt8(0, entry + 3);
  entries.writeUInt16LE(1, entry + 4); entries.writeUInt16LE(32, entry + 6); entries.writeUInt32LE(image.data.length, entry + 8); entries.writeUInt32LE(offset, entry + 12); offset += image.data.length;
}
await writeFile('apps/desktop/build/icon.ico', Buffer.concat([header, entries, ...images.map((image) => image.data)]));
