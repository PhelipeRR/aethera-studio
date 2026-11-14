import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES, IMAGES_PER_MESSAGE } from '@neuralbridge/shared';
import { imageType, readStoredImage, removeStoredImages, storeImages } from '../src/main/attachments.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = new TextEncoder().encode('GIF89a......');
const WEBP = Uint8Array.from([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')]);
const root = () => mkdtempSync(join(tmpdir(), 'nb-attach-'));

describe('imageType', () => {
  it('trusts the bytes, not the name: PNG, JPEG, GIF and WebP only', () => {
    expect([PNG, JPEG, GIF, WEBP].map(imageType)).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0]);
    expect([svg, exe, new Uint8Array(0), Uint8Array.from([0x89, 0x50])].map(imageType)).toEqual([null, null, null, null]);
  });
});

describe('storeImages', () => {
  it('writes each image under its own folder with a name the app chooses, keeping the user name only for display', () => {
    const dir = root();
    const stored = storeImages(dir, [
      { name: '..\\..\\Windows\\tela.png', data: PNG },
      { name: 'foto\u0000.jpg', data: JPEG },
    ]);
    expect(stored.map(({ name, mime, size }) => ({ name, mime, size }))).toEqual([
      { name: 'tela.png', mime: 'image/png', size: PNG.byteLength },
      { name: 'foto.jpg', mime: 'image/jpeg', size: JPEG.byteLength },
    ]);
    expect(stored.map((image) => image.path.slice(dirname(image.path).length + 1))).toEqual(['0.png', '1.jpg']);
    expect(new Set(stored.map((image) => dirname(image.path))).size).toBe(1);
    expect(dirname(dirname(stored[0]?.path ?? ''))).toBe(dir);
  });

  it('refuses the whole message when one image is not an accepted image, too big, or there are too many', () => {
    const dir = root();
    expect(() => storeImages(dir, [{ name: 'a.png', data: PNG }, { name: 'virus.png', data: Uint8Array.from([0x4d, 0x5a]) }])).toThrow(/invalid: .*virus\.png/);
    expect(() => storeImages(dir, [{ name: 'grande.png', data: new Uint8Array(IMAGE_MAX_BYTES + 1).fill(0, 0).map((_, i) => PNG[i] ?? 0) }])).toThrow(/invalid: .*grande\.png.*5 MB/);
    expect(() => storeImages(dir, Array.from({ length: IMAGES_PER_MESSAGE + 1 }, (_, i) => ({ name: `${i}.png`, data: PNG })))).toThrow(/invalid: .*6 imagens/);
    // Nothing is left behind by a refused message.
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('readStoredImage and removeStoredImages', () => {
  it('reads a stored image as a data URL, and nothing outside the attachments folder', () => {
    const dir = root();
    const [image] = storeImages(dir, [{ name: 'a.png', data: PNG }]);
    expect(readStoredImage(dir, image?.path ?? '', 'image/png')).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
    const outside = join(root(), 'x.png');
    writeFileSync(outside, PNG);
    expect(() => readStoredImage(dir, outside, 'image/png')).toThrow(/forbidden/);
    expect(() => readStoredImage(dir, join(dir, '..', 'x.png'), 'image/png')).toThrow(/forbidden/);
  });

  it('removes the folders of stored images, and only inside the attachments folder', () => {
    const dir = root();
    const stored = storeImages(dir, [{ name: 'a.png', data: PNG }, { name: 'b.gif', data: GIF }]);
    const outside = join(root(), 'keep.png');
    writeFileSync(outside, PNG);
    removeStoredImages(dir, [...stored.map((image) => image.path), outside]);
    expect(stored.every((image) => !existsSync(image.path))).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(outside)).toBe(true);
  });
});
