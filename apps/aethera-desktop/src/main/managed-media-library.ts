import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type Database from 'better-sqlite3';

export const MANAGED_LIBRARY_DIR_NAME = 'media-library';
export const MANAGED_LIBRARY_INDEX_FILE = 'index.json';

export interface ManagedMediaRecord {
  id: string;
  sha256: string;
  bytes: number;
  portablePath: string; // e.g. media-library/blobs/ab/ab123...wav
  originalName: string;
  ext: string;
  kind: 'video' | 'audio' | 'image' | 'document' | 'other';
  legacySourcePaths: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ManagedMediaIndex {
  schemaVersion: 1;
  records: ManagedMediaRecord[];
}

export interface VelixAssetMigrationReport {
  totalScanned: number;
  alreadyPortable: number;
  migratedFromDisk: number;
  remappedByHash: number;
  missing: Array<{ id: string; path: string; sha256: string }>;
}

export function inferMediaKind(filePath: string): ManagedMediaRecord['kind'] {
  const lower = filePath.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(lower)) return 'image';
  if (/\.(wav|mp3|ogg|flac|aac|m4a)$/i.test(lower)) return 'audio';
  if (/\.(mp4|mov|webm|mkv|avi)$/i.test(lower)) return 'video';
  if (/\.(txt|md|markdown|json)$/i.test(lower)) return 'document';
  return 'other';
}

export async function computeFileSha256Streaming(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    hash.update(buf);
  }
  return { sha256: hash.digest('hex'), bytes };
}

export function isPortableRelativePath(value: string): boolean {
  if (!value || value.includes('\0')) return false;
  if (isAbsolute(value) || value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.length > 0 && !segments.some((s) => s === '.' || s === '..');
}

export function resolveSafeSubpath(rootDir: string, relPath: string): string | null {
  if (!isPortableRelativePath(relPath)) return null;
  const baseResolved = resolve(rootDir);
  const segments = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  const target = resolve(baseResolved, ...segments);
  if (!target.startsWith(`${baseResolved}${sep}`)) return null;
  return target;
}

export class ManagedMediaLibrary {
  readonly rootDir: string;
  readonly indexFile: string;

  constructor(private readonly userDataDir: string) {
    this.rootDir = join(userDataDir, MANAGED_LIBRARY_DIR_NAME);
    this.indexFile = join(this.rootDir, MANAGED_LIBRARY_INDEX_FILE);
  }

  loadIndex(): ManagedMediaIndex {
    if (!existsSync(this.indexFile)) {
      return { schemaVersion: 1, records: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Partial<ManagedMediaIndex>;
      if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.records)) {
        return { schemaVersion: 1, records: parsed.records };
      }
    } catch {
      // fall through to empty index
    }
    return { schemaVersion: 1, records: [] };
  }

  saveIndex(index: ManagedMediaIndex): void {
    mkdirSync(this.rootDir, { recursive: true });
    const tmpFile = `${this.indexFile}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpFile, JSON.stringify(index, null, 2), 'utf8');
    renameSync(tmpFile, this.indexFile);
  }

  buildBlobPortablePath(sha256: string, ext: string): string {
    const cleanExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, '');
    const prefix = sha256.slice(0, 2);
    return `${MANAGED_LIBRARY_DIR_NAME}/blobs/${prefix}/${sha256}${cleanExt}`;
  }

  resolvePortablePath(storedPath: string): string | null {
    if (!storedPath) return null;
    if (isPortableRelativePath(storedPath)) {
      return resolveSafeSubpath(this.userDataDir, storedPath);
    }
    // Check managed index by legacy source path so old Windows paths resolve after migration
    const normalizedInput = storedPath.replace(/\\/g, '/').toLowerCase();
    const index = this.loadIndex();
    const match = index.records.find((r) =>
      r.legacySourcePaths.some((p) => p.replace(/\\/g, '/').toLowerCase() === normalizedInput),
    );
    if (match) {
      const resolved = resolveSafeSubpath(this.userDataDir, match.portablePath);
      if (resolved && existsSync(resolved)) return resolved;
    }
    return existsSync(storedPath) ? storedPath : null;
  }

  findBySha256(sha256: string): ManagedMediaRecord | null {
    const index = this.loadIndex();
    return index.records.find((r) => r.sha256 === sha256) ?? null;
  }

  /**
   * Imports a file into `userData/media-library` using streaming SHA-256 deduplication.
   * Never deletes or modifies `sourcePath`.
   */
  async importFile(
    sourcePath: string,
    options?: { id?: string; kind?: ManagedMediaRecord['kind'] },
  ): Promise<{ record: ManagedMediaRecord; absolutePath: string; deduplicated: boolean }> {
    const st = statSync(sourcePath);
    if (!st.isFile()) {
      throw new Error(`Arquivo inválido para importação: ${sourcePath}`);
    }

    const { sha256, bytes } = await computeFileSha256Streaming(sourcePath);
    const ext = extname(sourcePath);
    const portablePath = this.buildBlobPortablePath(sha256, ext);
    const targetAbs = resolveSafeSubpath(this.userDataDir, portablePath);
    if (!targetAbs) {
      throw new Error(`Caminho portátil inválido gerado para ${sourcePath}`);
    }

    const index = this.loadIndex();
    const existing = index.records.find((r) => r.sha256 === sha256);
    const now = new Date().toISOString();

    if (!existsSync(targetAbs)) {
      mkdirSync(dirname(targetAbs), { recursive: true });
      const tmpTarget = `${targetAbs}.tmp-${process.pid}-${Date.now()}`;
      try {
        await pipeline(
          createReadStream(sourcePath, { highWaterMark: 64 * 1024 }),
          createWriteStream(tmpTarget),
        );
        renameSync(tmpTarget, targetAbs);
      } catch (err) {
        rmSync(tmpTarget, { force: true });
        throw err;
      }
    }

    if (existing) {
      if (!existing.legacySourcePaths.includes(sourcePath)) {
        existing.legacySourcePaths.push(sourcePath);
        existing.updatedAt = now;
        this.saveIndex(index);
      }
      return { record: existing, absolutePath: targetAbs, deduplicated: true };
    }

    const record: ManagedMediaRecord = {
      id: options?.id ?? `lib_${sha256.slice(0, 16)}_${randomUUID().slice(0, 6)}`,
      sha256,
      bytes,
      portablePath,
      originalName: basename(sourcePath),
      ext: ext.toLowerCase(),
      kind: options?.kind ?? inferMediaKind(sourcePath),
      legacySourcePaths: [sourcePath],
      createdAt: now,
      updatedAt: now,
    };

    index.records.push(record);
    this.saveIndex(index);
    return { record, absolutePath: targetAbs, deduplicated: false };
  }

  /**
   * Registers an already-copied managed blob (e.g. during backup restore) into index.json if absent.
   */
  registerRestoredBlob(input: {
    id?: string;
    sha256: string;
    bytes: number;
    portablePath: string;
    originalName: string;
    legacySourcePath?: string;
  }): ManagedMediaRecord {
    const index = this.loadIndex();
    const existing = index.records.find((r) => r.sha256 === input.sha256);
    const now = new Date().toISOString();
    if (existing) {
      if (input.legacySourcePath && !existing.legacySourcePaths.includes(input.legacySourcePath)) {
        existing.legacySourcePaths.push(input.legacySourcePath);
        existing.updatedAt = now;
        this.saveIndex(index);
      }
      return existing;
    }
    const record: ManagedMediaRecord = {
      id: input.id ?? `lib_${input.sha256.slice(0, 16)}`,
      sha256: input.sha256,
      bytes: input.bytes,
      portablePath: input.portablePath,
      originalName: input.originalName,
      ext: extname(input.portablePath).toLowerCase(),
      kind: inferMediaKind(input.originalName || input.portablePath),
      legacySourcePaths: input.legacySourcePath ? [input.legacySourcePath] : [],
      createdAt: now,
      updatedAt: now,
    };
    index.records.push(record);
    this.saveIndex(index);
    return record;
  }

  /**
   * Migrates legacy `velix_local_assets` rows (with Windows absolute paths) to portable paths
   * inside `userData/media-library`.
   */
  async migrateVelixLocalAssets(sqlite: Pick<Database.Database, 'prepare'>): Promise<VelixAssetMigrationReport> {
    const report: VelixAssetMigrationReport = {
      totalScanned: 0,
      alreadyPortable: 0,
      migratedFromDisk: 0,
      remappedByHash: 0,
      missing: [],
    };

    let rows: Array<{ id: string; path: string; bytes: number; sha256: string }> = [];
    try {
      rows = sqlite.prepare('SELECT id, path, bytes, sha256 FROM velix_local_assets').all() as Array<{
        id: string;
        path: string;
        bytes: number;
        sha256: string;
      }>;
    } catch {
      return report;
    }

    const updateStmt = sqlite.prepare('UPDATE velix_local_assets SET path = ?, bytes = ?, sha256 = ? WHERE id = ?');
    report.totalScanned = rows.length;

    for (const row of rows) {
      if (isPortableRelativePath(row.path)) {
        const resolved = resolveSafeSubpath(this.userDataDir, row.path);
        if (resolved && existsSync(resolved)) {
          report.alreadyPortable += 1;
          continue;
        }
      }

      const byHash = row.sha256 ? this.findBySha256(row.sha256) : null;
      if (byHash) {
        const blobAbs = resolveSafeSubpath(this.userDataDir, byHash.portablePath);
        if (blobAbs && existsSync(blobAbs)) {
          if (!byHash.legacySourcePaths.includes(row.path)) {
            const idx = this.loadIndex();
            const found = idx.records.find((r) => r.sha256 === byHash.sha256);
            if (found && !found.legacySourcePaths.includes(row.path)) {
              found.legacySourcePaths.push(row.path);
              found.updatedAt = new Date().toISOString();
              this.saveIndex(idx);
            }
          }
          updateStmt.run(byHash.portablePath, byHash.bytes, byHash.sha256, row.id);
          report.remappedByHash += 1;
          continue;
        }
      }

      if (row.path && existsSync(row.path)) {
        try {
          const imported = await this.importFile(row.path, { id: row.id });
          updateStmt.run(imported.record.portablePath, imported.record.bytes, imported.record.sha256, row.id);
          report.migratedFromDisk += 1;
          continue;
        } catch {
          // fall through to missing
        }
      }

      report.missing.push({ id: row.id, path: row.path, sha256: row.sha256 });
    }

    return report;
  }
}
