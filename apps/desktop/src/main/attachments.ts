import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, win32 } from 'node:path';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, IMAGES_PER_MESSAGE, type ImageMime, type ImageUpload, type TaskImage } from '@neuralbridge/shared';

// Images attached to chat requests. They live in the app's data folder, never in the project, under a
// folder per message and a file name the app chooses; the user's file name is only shown.

export interface StoredImage extends TaskImage {
  path: string;
}

const starts = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((value, i) => bytes[at + i] === value);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The image type from the file's first bytes; null for anything else, whatever its name says. */
export function imageType(bytes: Uint8Array): ImageMime | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) return 'image/gif';
  if (starts(bytes, ascii('RIFF')) && starts(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** A display name: the last path segment, without control characters, at most 120 characters. */
function displayName(name: string, index: number, mime: ImageMime): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const clean = win32.basename(name.replaceAll('/', '\\')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return clean || `imagem-${index + 1}.${IMAGE_TYPES[mime]}`;
}

const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/** Validates every image first, so a refused message leaves nothing behind, then writes them. */
export function storeImages(root: string, images: readonly ImageUpload[]): StoredImage[] {
  if (images.length > IMAGES_PER_MESSAGE) throw new Error(`invalid: No máximo ${IMAGES_PER_MESSAGE} imagens por mensagem.`);
  const checked = images.map((image, index) => {
    const label = image.name || `imagem ${index + 1}`;
    if (image.data.byteLength > IMAGE_MAX_BYTES) throw new Error(`invalid: “${label}” passa de ${megabytes(IMAGE_MAX_BYTES)}.`);
    const mime = imageType(image.data);
    if (!mime) throw new Error(`invalid: “${label}” não é uma imagem PNG, JPEG, GIF ou WebP.`);
    return { image, mime, name: displayName(image.name, index, mime) };
  });
  if (!checked.length) return [];
  const folder = join(root, randomUUID());
  mkdirSync(folder, { recursive: true });
  return checked.map(({ image, mime, name }, index) => {
    const path = join(folder, `${index}.${IMAGE_TYPES[mime]}`);
    writeFileSync(path, image.data, { flag: 'wx' });
    return { name, mime, size: image.data.byteLength, path };
  });
}

function insideOrThrow(root: string, path: string): string {
  const absolute = resolve(path);
  const rel = relative(resolve(root), absolute);
  if (!rel || rel.startsWith('..') || win32.isAbsolute(rel)) throw new Error('forbidden: A imagem está fora da pasta de anexos.');
  return absolute;
}

/** A stored image as a data URL for the screens (the CSP allows data: images, not files). */
export function readStoredImage(root: string, path: string, mime: ImageMime): string {
  const absolute = insideOrThrow(root, path);
  if (!existsSync(absolute)) throw new Error('not_found: A imagem não existe mais.');
  return `data:${mime};base64,${readFileSync(absolute).toString('base64')}`;
}

/** Deletes the folders holding these images; paths outside the attachments folder are ignored. */
export function removeStoredImages(root: string, paths: readonly string[]): void {
  for (const path of paths) {
    let absolute: string;
    try {
      absolute = insideOrThrow(root, path);
    } catch {
      continue;
    }
    const folder = dirname(absolute);
    if (resolve(dirname(folder)) === resolve(root)) rmSync(folder, { recursive: true, force: true });
  }
}
