import { copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { readImage } from './channel-identity-apply.js';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface ProjectVideo { relativePath: string; size: number; modifiedAt: string; }

const SKIPPED_DIRS = new Set(['node_modules', '.git', '.velix-tmp', 'channel-assets']);
// Intermediate files of the Motion/FFmpeg pipeline, never a finished video.
const INTERMEDIATE = /\.(part|motion)\.mp4$/iu;
const MAX_DEPTH = 4;
const MAX_VIDEOS = 200;
/** Same ceiling as the other in-app previews: the bytes cross IPC as a data URL. */
export const PREVIEW_LIMIT_BYTES = 100_000_000;
export const SAVE_LIMIT_BYTES = 25 * 1024 * 1024;
const GENERATED_TYPES: Record<string, string> = { '.png': 'PNG', '.svg': 'SVG', '.jpg': 'JPEG', '.jpeg': 'JPEG' };

/** Resolves a path typed or listed in the renderer, refusing anything that leaves the project root (symlinks included). */
export async function confinedProjectFile(root: string, relativePath: string): Promise<string> {
  const realRoot = await realpath(root);
  const candidate = resolve(realRoot, relativePath);
  const real = await realpath(candidate).catch(() => { throw new Error('not_found: arquivo não encontrado no projeto.'); });
  const rel = relative(realRoot, real);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('forbidden: o arquivo precisa estar dentro do projeto.');
  if (!(await stat(real)).isFile()) throw new Error('not_found: arquivo não encontrado no projeto.');
  return real;
}

/** Finished MP4s of the project (Motion, Studio and direct renders), newest first. Read-only. */
export async function listProjectVideos(root: string): Promise<ProjectVideo[]> {
  const realRoot = await realpath(root);
  const found: ProjectVideo[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_VIDEOS) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4') && !INTERMEDIATE.test(entry.name)) {
        const info = await stat(path);
        found.push({ relativePath: relative(realRoot, path).split(sep).join('/'), size: info.size, modifiedAt: info.mtime.toISOString() });
      }
    }
  };
  await walk(realRoot, 0);
  return found.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export async function projectVideoPreview(root: string, relativePath: string): Promise<string> {
  const file = await confinedProjectFile(root, relativePath);
  if (extname(file).toLowerCase() !== '.mp4') throw new Error('invalid: a prévia aceita só MP4.');
  if ((await stat(file)).size > PREVIEW_LIMIT_BYTES) throw new Error('invalid: vídeo acima de 100 MB; use "Salvar no PC" para abrir no seu player.');
  return `data:video/mp4;base64,${(await readFile(file)).toString('base64')}`;
}

/** Keeps a generated video thumbnail (JPEG or PNG) in the project, where the publish step reads it. YouTube takes up to 2 MB, 16:9. */
export async function saveProjectThumbnail(root: string, title: string, imageBase64: string): Promise<string> {
  const png = readImage(imageBase64, 'a thumbnail');
  if (png.width < 640 || Math.abs(png.width / png.height - 16 / 9) > 0.01) throw new Error('invalid: a thumbnail precisa ser 16:9 com pelo menos 640 de largura.');
  if (png.bytes.byteLength > 2 * 1024 * 1024) throw new Error('invalid: a thumbnail passa de 2 MB.');
  const slug = title.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'thumbnail';
  const relativePath = `channel-assets/thumbnails/${slug}-${Date.now().toString(36)}.${png.type === 'image/png' ? 'png' : 'jpg'}`;
  const realRoot = await realpath(root);
  await mkdir(join(realRoot, 'channel-assets', 'thumbnails'), { recursive: true });
  await writeFile(join(realRoot, ...relativePath.split('/')), png.bytes);
  return relativePath;
}

type SaveDialog =(defaultName: string, filterName: string, extension: string) => Promise<string | null>;

/** Copies a project file to a place the person picks; returns false when they cancel. */
export async function saveProjectFileTo(root: string, relativePath: string, pick: SaveDialog): Promise<boolean> {
  const file = await confinedProjectFile(root, relativePath);
  const extension = extname(file).slice(1).toLowerCase();
  const target = await pick(basename(file), extension.toUpperCase() || 'Arquivo', extension);
  if (!target) return false;
  await copyFile(file, target);
  return true;
}

/** Writes an image the renderer generated (PNG/SVG/JPEG only, bounded) to a place the person picks. */
export async function saveGeneratedFileTo(fileName: string, dataBase64: string, pick: SaveDialog): Promise<boolean> {
  const name = Array.from(basename(fileName), (char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char)).join('');
  const extension = extname(name).toLowerCase();
  const type = GENERATED_TYPES[extension];
  if (!type) throw new Error('invalid: só é possível salvar PNG, SVG ou JPEG.');
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > SAVE_LIMIT_BYTES) throw new Error('invalid: arquivo vazio ou acima de 25 MB.');
  const target = await pick(name, type, extension.slice(1));
  if (!target) return false;
  await writeFile(target, bytes);
  return true;
}
