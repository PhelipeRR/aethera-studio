import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { managedAssetRefSchema, type AssetKind, type ManagedAssetRef } from './schemas.js';

const execFileAsync = promisify(execFile);

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

export function isStrictlyInsideRoot(targetPath: string, rootDir: string): boolean {
  const rel = relative(resolve(rootDir), resolve(targetPath));
  return rel !== '' && !rel.startsWith('..') && !rel.includes('..\\') && !rel.includes('../') && !/^[A-Za-z]:/.test(rel);
}

export class AssetIngestionService {
  readonly storageRoot: string;
  private readonly ffprobePath: string;

  constructor(options: { storageRoot: string; ffprobePath?: string }) {
    this.storageRoot = resolve(options.storageRoot);
    this.ffprobePath = options.ffprobePath ?? process.env['NB_FFPROBE'] ?? 'ffprobe';
    mkdirSync(this.storageRoot, { recursive: true });
  }

  resolvePortablePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('..')) {
      throw new Error(`Invalid portable asset path: ${relativePath}`);
    }
    const target = resolve(this.storageRoot, normalized);
    if (!isStrictlyInsideRoot(target, this.storageRoot)) {
      throw new Error(`Asset path escapes managed storage root: ${relativePath}`);
    }
    return target;
  }

  async ingestFile(input: {
    sourcePath: string;
    kind: AssetKind;
    id?: string;
    originalName?: string;
  }): Promise<ManagedAssetRef> {
    const absSource = resolve(input.sourcePath);
    if (!existsSync(absSource)) {
      throw new Error(`Source asset not found: ${absSource}`);
    }
    const stat = statSync(absSource);
    if (!stat.isFile()) {
      throw new Error(`Source asset is not a file: ${absSource}`);
    }

    const ext = (extname(absSource) || '.bin').toLowerCase();
    const id = input.id ?? `asset-${randomUUID().slice(0, 12)}`;
    const relPath = `assets/${input.kind}/${id}${ext}`;
    const destPath = this.resolvePortablePath(relPath);
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    copyFileSync(absSource, destPath);

    return this.buildMetadata({
      id,
      kind: input.kind,
      relativePath: relPath,
      absPath: destPath,
      originalName: input.originalName ?? absSource.split(/[\\/]/).pop() ?? `${id}${ext}`,
      ext,
    });
  }

  async ingestBuffer(input: {
    buffer: Buffer;
    kind: AssetKind;
    extension: string;
    originalName: string;
    id?: string;
  }): Promise<ManagedAssetRef> {
    const ext = input.extension.startsWith('.') ? input.extension.toLowerCase() : `.${input.extension.toLowerCase()}`;
    const id = input.id ?? `asset-${randomUUID().slice(0, 12)}`;
    const relPath = `assets/${input.kind}/${id}${ext}`;
    const destPath = this.resolvePortablePath(relPath);
    mkdirSync(resolve(destPath, '..'), { recursive: true });
    writeFileSync(destPath, input.buffer);

    return this.buildMetadata({
      id,
      kind: input.kind,
      relativePath: relPath,
      absPath: destPath,
      originalName: input.originalName,
      ext,
    });
  }

  private async buildMetadata(input: {
    id: string;
    kind: AssetKind;
    relativePath: string;
    absPath: string;
    originalName: string;
    ext: string;
  }): Promise<ManagedAssetRef> {
    const bytes = readFileSync(input.absPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const mimeType = MIME_BY_EXT[input.ext] ?? 'application/octet-stream';

    let width: number | undefined;
    let height: number | undefined;
    let durationSec: number | undefined;

    if (mimeType.startsWith('image/')) {
      try {
        const meta = await sharp(input.absPath).metadata();
        if (meta.width && meta.height) {
          width = meta.width;
          height = meta.height;
        }
      } catch {
        // Non-raster or unsupported image metadata; leave dimensions undefined.
      }
    } else if (mimeType.startsWith('video/')) {
      const probed = await this.probeVideo(input.absPath);
      width = probed.width;
      height = probed.height;
      durationSec = probed.durationSec;
    }

    return managedAssetRefSchema.parse({
      id: input.id,
      kind: input.kind,
      relativePath: normalize(input.relativePath).replace(/\\/g, '/'),
      sha256,
      mimeType,
      originalName: input.originalName,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(durationSec !== undefined ? { durationSec } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  private async probeVideo(filePath: string): Promise<{ width?: number; height?: number; durationSec?: number }> {
    try {
      const { stdout } = await execFileAsync(this.ffprobePath, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '-of',
        'json',
        filePath,
      ]);
      const parsed = JSON.parse(stdout) as {
        streams?: Array<{ width?: number; height?: number }>;
        format?: { duration?: string };
      };
      const stream = parsed.streams?.[0];
      const duration = parsed.format?.duration ? Number(parsed.format.duration) : undefined;
      return {
        ...(stream?.width ? { width: stream.width } : {}),
        ...(stream?.height ? { height: stream.height } : {}),
        ...(duration !== undefined && Number.isFinite(duration) ? { durationSec: duration } : {}),
      };
    } catch {
      return {};
    }
  }
}
