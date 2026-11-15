import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase, verifyBackup, type DatabaseHandle } from '@neuralbridge/database';
import type { AetheraAcademyEngine, AetheraEvolutionCore, EditorialCalendarEngine } from '@neuralbridge/cinema';
import {
  computeFileSha256Streaming,
  isPortableRelativePath,
  ManagedMediaLibrary,
  resolveSafeSubpath,
  type VelixAssetMigrationReport,
} from './managed-media-library.js';
import {
  listZipEntries,
  streamZipEntry,
  writeStreamingZip,
  type ParsedZipEntry,
  type ZipInputEntry,
} from './portable-zip.js';

export const AETHERA_SYSTEM_BACKUP_SCHEMA_VERSION = 1;
export const AETHERA_SYSTEM_BACKUP_ZIP_FORMAT_VERSION = 2;
export const AETHERA_SYSTEM_BACKUP_KIND = 'aethera-system-backup';

const DB_SIDE_FILES = ['', '-wal', '-shm', '-journal'] as const;
const SAFE_JSON_NAME = /^[a-zA-Z0-9._-]+\.json$/;
const SECRET_KEY_RE = /^(?:.*auth[-_]?token.*|.*access[-_]?token.*|.*refresh[-_]?token.*|.*gateway[-_]?token.*|token|.*secret.*|.*password.*|.*passwd.*|.*api[-_]?key.*|.*credential.*|.*private[-_]?key.*)$/i;
const SECRET_BIN_RE = /\.(bin|key|pem|pfx|p12)$/i;

export interface AetheraSystemBackupCounts {
  cinemaProjects: number;
  cinemaLibraryFiles?: number;
  managedLibraryFiles?: number;
  externalBundledFiles?: number;
  creativeStudioFiles?: number;
  libraryAssets?: number;
  academyMaterials: number;
  academyKnowledge: number;
  academyExercises: number;
  evolutionMemories: number;
  calendarEvents: number;
  calendarSeries: number;
  hasDatabase: boolean;
  hasPreferences: boolean;
}

export interface BackupMissingFile {
  source: 'velix_local_assets' | 'cinema_project' | 'media_library';
  path: string;
  assetId?: string;
}

export interface BackupManifestEntry {
  archivePath: string;
  category:
    | 'database'
    | 'preferences'
    | 'academy'
    | 'evolution'
    | 'calendar'
    | 'cinema_project'
    | 'media_library'
    | 'cinema_library'
    | 'creative_studio'
    | 'external_asset';
  relativePath: string;
  originalPath?: string;
  size: number;
  sha256: string;
}

export interface BackupPathRemapping {
  legacyPath: string;
  portableRelativePath: string;
  sha256: string;
  bytes: number;
  originalName: string;
}

export interface AetheraSystemBackupManifestV2 {
  formatVersion: 2;
  kind: 'aethera-system-backup';
  app: 'AetheraStudio';
  appVersion: string;
  exportedAt: string;
  sourceUserDataDirHint: string;
  complete: boolean;
  missingFiles: BackupMissingFile[];
  excludedSecrets: string[];
  counts: AetheraSystemBackupCounts;
  entries: BackupManifestEntry[];
  pathRemappings: BackupPathRemapping[];
}

export interface AetheraSystemBackupBundle {
  schemaVersion: 1;
  kind: 'aethera-system-backup';
  app: 'AetheraStudio';
  appVersion: string;
  exportedAt: string;
  counts: AetheraSystemBackupCounts;
  databaseBase64?: string;
  preferences?: Record<string, unknown>;
  academy?: ReturnType<AetheraAcademyEngine['getSnapshot']>;
  evolution?: ReturnType<AetheraEvolutionCore['getSnapshot']>;
  calendar?: ReturnType<EditorialCalendarEngine['getSnapshot']>;
  cinemaProjects?: Record<string, unknown>;
  cinemaLibrary?: Record<string, string>;
  creativeStudioAssets?: Record<string, string>;
}

export interface SystemBackupDeps {
  appVersion: string;
  userDataDir: string;
  databaseFile: string;
  databaseHandle: DatabaseHandle | null;
  preferencesFile: string;
  calendarFile: string;
  cinemaProjectsDir: string;
  cinemaLibraryDir?: string;
  creativeStudioDir?: string;
  academyEngine: AetheraAcademyEngine;
  evolutionCore: AetheraEvolutionCore;
  editorialCalendar: EditorialCalendarEngine;
  tmpRoot?: string;
}

export interface SystemBackupEstimate {
  totalBytes: number;
  compressedEstimateBytes: number;
  counts: AetheraSystemBackupCounts;
  missingFiles: BackupMissingFile[];
  excludedSecrets: string[];
  complete: boolean;
}

export interface RestoreSections {
  database?: boolean;
  preferences?: boolean;
  cinemaProjects?: boolean;
  mediaLibrary?: boolean;
  academy?: boolean;
  evolution?: boolean;
  calendar?: boolean;
}

export type RestoreConflictMode = 'rename' | 'skip' | 'overwrite';

export interface InspectSystemBackupResult {
  ok: boolean;
  formatVersion: 1 | 2;
  exportedAt: string;
  appVersion: string;
  complete: boolean;
  counts: AetheraSystemBackupCounts;
  missingFiles: BackupMissingFile[];
  integrityErrors: string[];
  entriesCount: number;
  existingProjectConflicts: string[];
}

export interface ExportSystemBackupResult {
  ok: boolean;
  complete: boolean;
  filePath: string;
  totalBytes: number;
  counts: AetheraSystemBackupCounts;
  missingFiles: BackupMissingFile[];
  excludedSecrets: string[];
  manifest?: AetheraSystemBackupManifestV2;
}

export interface RestoreSystemBackupResult {
  ok: true;
  formatVersion: 1 | 2;
  filePath: string;
  preservedDir: string;
  counts: AetheraSystemBackupCounts;
  requiresRelaunch: boolean;
  conflicts: string[];
  remappedReferences: number;
  migrationReport?: VelixAssetMigrationReport;
}

function createBackupTempDir(deps: SystemBackupDeps, prefix: string): string {
  const tmpBase = deps.tmpRoot ?? join(deps.userDataDir, 'tmp');
  mkdirSync(tmpBase, { recursive: true });
  return mkdtempSync(join(tmpBase, prefix));
}

function resolveSafeRelativeTarget(rootDir: string, relPath: string): string | null {
  if (!relPath || relPath.includes('\0') || relPath.startsWith('/') || relPath.startsWith('\\')) {
    return null;
  }
  if (/^[a-zA-Z]:/.test(relPath)) return null;
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some((seg) => seg === '.' || seg === '..')) {
    return null;
  }
  const baseResolved = resolve(rootDir);
  const targetResolved = resolve(baseResolved, ...segments);
  if (!targetResolved.startsWith(`${baseResolved}${sep}`)) {
    return null;
  }
  return targetResolved;
}

function copyDirectoryContents(srcDir: string, destDir: string): void {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    let stat;
    try {
      stat = lstatSync(srcPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    const destPath = join(destDir, entry);
    if (stat.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirectoryContents(srcPath, destPath);
    } else if (stat.isFile()) {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
    }
  }
}

function sanitizePreferencesObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePreferencesObject(item));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue;
      out[k] = sanitizePreferencesObject(v);
    }
    return out;
  }
  return value;
}

function walkDirectoryFiles(rootDir: string): Array<{ relPath: string; fullPath: string; size: number }> {
  const out: Array<{ relPath: string; fullPath: string; size: number }> = [];
  if (!existsSync(rootDir)) return out;
  const walk = (dir: string, parts: string[]) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      let st;
      try {
        st = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      const next = [...parts, entry];
      if (st.isDirectory()) {
        walk(fullPath, next);
      } else if (st.isFile()) {
        if (SECRET_BIN_RE.test(entry) || entry.includes('.tmp-')) continue;
        out.push({ relPath: next.join('/'), fullPath, size: st.size });
      }
    }
  };
  walk(rootDir, []);
  return out;
}

function detectExcludedSecrets(userDataDir: string): string[] {
  if (!existsSync(userDataDir)) return [];
  const excluded: string[] = [];
  for (const entry of readdirSync(userDataDir)) {
    if (SECRET_BIN_RE.test(entry) || /secret|credential|auth/i.test(entry)) {
      excluded.push(entry);
    }
  }
  return excluded;
}

const LOCAL_PATH_KEYS = new Set([
  'filePath',
  'sourcePath',
  'localPath',
  'videoPath',
  'audioPath',
  'imagePath',
  'outputPath',
  'mediaPath',
  'path',
  'uri',
]);

function looksLikeLocalFileReference(val: string): boolean {
  if (!val || val.startsWith('http://') || val.startsWith('https://') || val.startsWith('data:')) {
    return false;
  }
  if (val.startsWith('aethera-media://')) return false;
  return isAbsolute(val) || /^[a-zA-Z]:[\\/]/.test(val) || isPortableRelativePath(val);
}

function collectReferencedPathsFromProjectJson(obj: unknown, out: Set<string>): void {
  if (Array.isArray(obj)) {
    for (const item of obj) collectReferencedPathsFromProjectJson(item, out);
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof val === 'string' && LOCAL_PATH_KEYS.has(key) && looksLikeLocalFileReference(val)) {
        out.add(val);
      } else if (typeof val === 'object' && val !== null) {
        collectReferencedPathsFromProjectJson(val, out);
      }
    }
  }
}

function rewriteProjectJsonPaths(
  obj: unknown,
  remapByLegacyPath: Map<string, string>,
  sourceUserDataDirHint: string,
  userDataDir: string,
  stats: { remapped: number },
): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      rewriteProjectJsonPaths(item, remapByLegacyPath, sourceUserDataDirHint, userDataDir, stats),
    );
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    const hintNorm = sourceUserDataDirHint.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof val === 'string' && LOCAL_PATH_KEYS.has(key) && looksLikeLocalFileReference(val)) {
        const valNormForward = val.replace(/\\/g, '/');
        const normalized = valNormForward.toLowerCase();
        const remappedRel = remapByLegacyPath.get(normalized);
        if (remappedRel) {
          const resolved = resolveSafeSubpath(userDataDir, remappedRel);
          out[key] = resolved ?? remappedRel;
          stats.remapped += 1;
          continue;
        }
        if (hintNorm && normalized.startsWith(`${hintNorm}/`)) {
          const relSub = valNormForward.slice(hintNorm.length + 1);
          const resolved = resolveSafeSubpath(userDataDir, relSub);
          if (resolved) {
            out[key] = resolved;
            stats.remapped += 1;
            continue;
          }
        }
        if (isPortableRelativePath(val)) {
          const resolved = resolveSafeSubpath(userDataDir, val);
          if (resolved && existsSync(resolved)) {
            out[key] = resolved;
            stats.remapped += 1;
            continue;
          }
        }
      }
      out[key] = rewriteProjectJsonPaths(
        val,
        remapByLegacyPath,
        sourceUserDataDirHint,
        userDataDir,
        stats,
      );
    }
    return out;
  }
  return obj;
}

interface CollectedBackupPlan {
  zipEntries: ZipInputEntry[];
  entryMeta: Array<Omit<BackupManifestEntry, 'size' | 'sha256'>>;
  pathRemappings: BackupPathRemapping[];
  missingFiles: BackupMissingFile[];
  excludedSecrets: string[];
  counts: AetheraSystemBackupCounts;
  totalEstimatedBytes: number;
  compressedEstimatedBytes: number;
  tempDirsToClean: string[];
}

async function buildBackupPlan(deps: SystemBackupDeps): Promise<CollectedBackupPlan> {
  const zipEntries: ZipInputEntry[] = [];
  const entryMeta: Array<Omit<BackupManifestEntry, 'size' | 'sha256'>> = [];
  const pathRemappings: BackupPathRemapping[] = [];
  const missingFiles: BackupMissingFile[] = [];
  const tempDirsToClean: string[] = [];
  const managedLibrary = new ManagedMediaLibrary(deps.userDataDir);

  let totalEstimatedBytes = 0;
  let compressedEstimatedBytes = 0;
  const addBufferEntry = (
    archivePath: string,
    category: BackupManifestEntry['category'],
    relativePath: string,
    buf: Buffer,
  ) => {
    zipEntries.push({ archivePath, buffer: buf });
    entryMeta.push({ archivePath, category, relativePath });
    totalEstimatedBytes += buf.length;
    compressedEstimatedBytes += Math.ceil(buf.length * 0.45);
  };
  const addFileEntry = (
    archivePath: string,
    category: BackupManifestEntry['category'],
    relativePath: string,
    sourceFilePath: string,
    originalPath?: string,
  ) => {
    const st = statSync(sourceFilePath);
    zipEntries.push({ archivePath, sourceFilePath });
    entryMeta.push({
      archivePath,
      category,
      relativePath,
      ...(originalPath ? { originalPath } : {}),
    });
    totalEstimatedBytes += st.size;
    const isMedia = /\.(mp4|mov|mkv|webm|mp3|png|jpe?g|webp)$/i.test(sourceFilePath);
    compressedEstimatedBytes += isMedia ? st.size : Math.ceil(st.size * 0.5);
  };

  // 1. Database snapshot (online backup)
  let hasDatabase = false;
  let dbTempFile: string | null = null;
  if (deps.databaseHandle) {
    const tempDir = createBackupTempDir(deps, 'sys-backup-db-');
    tempDirsToClean.push(tempDir);
    dbTempFile = join(tempDir, 'database.sqlite');
    backupDatabase(deps.databaseHandle, dbTempFile);
    addFileEntry('data/database.sqlite', 'database', 'database.sqlite', dbTempFile);
    hasDatabase = true;
  } else if (existsSync(deps.databaseFile)) {
    addFileEntry('data/database.sqlite', 'database', 'database.sqlite', deps.databaseFile);
    hasDatabase = true;
  }

  // 2. Sanitized Preferences (no secrets)
  let hasPreferences = false;
  if (existsSync(deps.preferencesFile)) {
    try {
      const parsed = JSON.parse(readFileSync(deps.preferencesFile, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const sanitized = sanitizePreferencesObject(parsed);
        addBufferEntry(
          'config/preferences.json',
          'preferences',
          'preferences.json',
          Buffer.from(JSON.stringify(sanitized, null, 2), 'utf8'),
        );
        hasPreferences = true;
      }
    } catch {
      // ignore unreadable preferences
    }
  }

  // 3. Academy, Evolution, Calendar JSONs
  const academySnap = deps.academyEngine.getSnapshot();
  const evolutionSnap = deps.evolutionCore.getSnapshot();
  const calendarSnap = deps.editorialCalendar.getSnapshot();
  addBufferEntry(
    'data/academy.json',
    'academy',
    'evolution/academy-store.json',
    Buffer.from(JSON.stringify(academySnap, null, 2), 'utf8'),
  );
  addBufferEntry(
    'data/evolution.json',
    'evolution',
    'evolution/evolution-store.json',
    Buffer.from(JSON.stringify(evolutionSnap, null, 2), 'utf8'),
  );
  addBufferEntry(
    'data/calendar.json',
    'calendar',
    'calendar/editorial-calendar-store.json',
    Buffer.from(JSON.stringify(calendarSnap, null, 2), 'utf8'),
  );

  // 4. Cinema projects + collect referenced external/portable paths
  const projectReferencedPaths = new Set<string>();
  let cinemaProjectCount = 0;
  if (existsSync(deps.cinemaProjectsDir)) {
    for (const fileName of readdirSync(deps.cinemaProjectsDir)) {
      if (!SAFE_JSON_NAME.test(fileName)) continue;
      const fullPath = join(deps.cinemaProjectsDir, fileName);
      try {
        const parsed = JSON.parse(readFileSync(fullPath, 'utf8')) as unknown;
        collectReferencedPathsFromProjectJson(parsed, projectReferencedPaths);
        addFileEntry(`projects/${fileName}`, 'cinema_project', `cinema-projects/${fileName}`, fullPath);
        if (!fileName.endsWith('.render.json')) cinemaProjectCount += 1;
      } catch {
        // skip unreadable project
      }
    }
  }

  // 5. Managed internal media library (userData/media-library)
  const managedFiles = walkDirectoryFiles(managedLibrary.rootDir);
  const bundledHashes = new Map<string, string>(); // sha256 -> portableRelativePath
  const managedIndex = managedLibrary.loadIndex();
  for (const rec of managedIndex.records) {
    const abs = resolveSafeSubpath(deps.userDataDir, rec.portablePath);
    if (abs && existsSync(abs)) {
      bundledHashes.set(rec.sha256, rec.portablePath);
    } else {
      missingFiles.push({ source: 'media_library', path: rec.portablePath, assetId: rec.id });
    }
  }
  for (const f of managedFiles) {
    addFileEntry(`media-library/${f.relPath}`, 'media_library', `media-library/${f.relPath}`, f.fullPath);
  }

  // 6. Legacy cinema-library and creative-studio
  const cinemaLibFiles = deps.cinemaLibraryDir ? walkDirectoryFiles(deps.cinemaLibraryDir) : [];
  for (const f of cinemaLibFiles) {
    addFileEntry(`cinema-library/${f.relPath}`, 'cinema_library', `cinema-library/${f.relPath}`, f.fullPath);
  }
  const creativeFiles = deps.creativeStudioDir ? walkDirectoryFiles(deps.creativeStudioDir) : [];
  for (const f of creativeFiles) {
    addFileEntry(`creative-studio/${f.relPath}`, 'creative_studio', `creative-studio/${f.relPath}`, f.fullPath);
  }

  // 7. velix_local_assets & referenced external files
  let libraryAssetsCount = 0;
  let externalBundledCount = 0;
  const seenExternalArchivePaths = new Set<string>();
  const ensureExternalOrManagedFile = async (
    rawPath: string,
    sourceKind: 'velix_local_assets' | 'cinema_project',
    assetId?: string,
    expectedSha256?: string,
  ) => {
    if (isPortableRelativePath(rawPath)) {
      const resolved = resolveSafeSubpath(deps.userDataDir, rawPath);
      if (!resolved || !existsSync(resolved)) {
        missingFiles.push({ source: sourceKind, path: rawPath, ...(assetId ? { assetId } : {}) });
      }
      return;
    }

    const resolvedManaged = managedLibrary.resolvePortablePath(rawPath);
    if (resolvedManaged && resolvedManaged.startsWith(resolve(deps.userDataDir)) && existsSync(resolvedManaged)) {
      return;
    }

    if (!existsSync(rawPath)) {
      missingFiles.push({ source: sourceKind, path: rawPath, ...(assetId ? { assetId } : {}) });
      return;
    }

    let st;
    try {
      st = statSync(rawPath);
    } catch {
      missingFiles.push({ source: sourceKind, path: rawPath, ...(assetId ? { assetId } : {}) });
      return;
    }
    if (!st.isFile()) return;

    const { sha256, bytes } = await computeFileSha256Streaming(rawPath);
    const actualSha = expectedSha256 && expectedSha256 === sha256 ? expectedSha256 : sha256;
    const ext = extname(rawPath).toLowerCase();
    const portableRel = managedLibrary.buildBlobPortablePath(actualSha, ext);

    if (!bundledHashes.has(actualSha) && !seenExternalArchivePaths.has(`media-library/blobs/${actualSha.slice(0, 2)}/${actualSha}${ext}`)) {
      const archivePath = `external-assets/${actualSha.slice(0, 2)}/${actualSha}${ext}`;
      if (!seenExternalArchivePaths.has(archivePath)) {
        seenExternalArchivePaths.add(archivePath);
        addFileEntry(archivePath, 'external_asset', portableRel, rawPath, rawPath);
        externalBundledCount += 1;
      }
    }

    pathRemappings.push({
      legacyPath: rawPath,
      portableRelativePath: portableRel,
      sha256: actualSha,
      bytes,
      originalName: basename(rawPath),
    });
  };

  if (deps.databaseHandle?.sqlite) {
    try {
      const rows = deps.databaseHandle.sqlite
        .prepare('SELECT id, path, bytes, sha256 FROM velix_local_assets')
        .all() as Array<{ id: string; path: string; bytes: number; sha256: string }>;
      libraryAssetsCount = rows.length;
      for (const row of rows) {
        await ensureExternalOrManagedFile(row.path, 'velix_local_assets', row.id, row.sha256);
      }
    } catch {
      libraryAssetsCount = 0;
    }
  }

  for (const refPath of projectReferencedPaths) {
    await ensureExternalOrManagedFile(refPath, 'cinema_project');
  }

  const excludedSecrets = detectExcludedSecrets(deps.userDataDir);
  const counts: AetheraSystemBackupCounts = {
    cinemaProjects: cinemaProjectCount,
    cinemaLibraryFiles: cinemaLibFiles.length,
    managedLibraryFiles: managedFiles.length,
    externalBundledFiles: externalBundledCount,
    creativeStudioFiles: creativeFiles.length,
    libraryAssets: libraryAssetsCount,
    academyMaterials: academySnap.materials.length,
    academyKnowledge: academySnap.knowledge.length,
    academyExercises: academySnap.exercises.length,
    evolutionMemories: evolutionSnap.memories.length,
    calendarEvents: calendarSnap.events.length,
    calendarSeries: calendarSnap.series.length,
    hasDatabase,
    hasPreferences,
  };

  return {
    zipEntries,
    entryMeta,
    pathRemappings,
    missingFiles,
    excludedSecrets,
    counts,
    totalEstimatedBytes,
    compressedEstimatedBytes,
    tempDirsToClean,
  };
}

export async function estimateSystemBackup(deps: SystemBackupDeps): Promise<SystemBackupEstimate> {
  const plan = await buildBackupPlan(deps);
  try {
    return {
      totalBytes: plan.totalEstimatedBytes,
      compressedEstimateBytes: plan.compressedEstimatedBytes,
      counts: plan.counts,
      missingFiles: plan.missingFiles,
      excludedSecrets: plan.excludedSecrets,
      complete: plan.missingFiles.length === 0,
    };
  } finally {
    for (const d of plan.tempDirsToClean) {
      rmSync(d, { recursive: true, force: true });
    }
  }
}

export async function exportSystemBackup(
  deps: SystemBackupDeps,
  targetFilePath: string,
  options?: { allowIncomplete?: boolean },
): Promise<ExportSystemBackupResult> {
  const plan = await buildBackupPlan(deps);
  try {
    const complete = plan.missingFiles.length === 0;
    if (!complete && !options?.allowIncomplete) {
      return {
        ok: false,
        complete: false,
        filePath: targetFilePath,
        totalBytes: plan.totalEstimatedBytes,
        counts: plan.counts,
        missingFiles: plan.missingFiles,
        excludedSecrets: plan.excludedSecrets,
      };
    }

    mkdirSync(dirname(targetFilePath), { recursive: true });
    const tmpZipPath = `${targetFilePath}.tmp-${process.pid}-${Date.now()}`;

    try {
      // First stream all payload entries to compute exact SHA-256 and sizes, then rebuild with manifest.json
      // Wait: to avoid writing the ZIP twice for large files, we compute manifest entries from the single write pass
      // by appending manifest.json as the final entry!
      const writtenPayloads = await writeStreamingZip(tmpZipPath, plan.zipEntries);
      const manifestEntries: BackupManifestEntry[] = writtenPayloads.map((w, idx) => {
        const meta = plan.entryMeta[idx]!;
        return {
          archivePath: w.archivePath,
          category: meta.category,
          relativePath: meta.relativePath,
          ...(meta.originalPath ? { originalPath: meta.originalPath } : {}),
          size: w.uncompressedSize,
          sha256: w.sha256,
        };
      });

      const manifest: AetheraSystemBackupManifestV2 = {
        formatVersion: AETHERA_SYSTEM_BACKUP_ZIP_FORMAT_VERSION,
        kind: AETHERA_SYSTEM_BACKUP_KIND,
        app: 'AetheraStudio',
        appVersion: deps.appVersion,
        exportedAt: new Date().toISOString(),
        sourceUserDataDirHint: deps.userDataDir,
        complete,
        missingFiles: plan.missingFiles,
        excludedSecrets: plan.excludedSecrets,
        counts: plan.counts,
        entries: manifestEntries,
        pathRemappings: plan.pathRemappings,
      };

      const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
      const finalEntries: ZipInputEntry[] = [
        { archivePath: 'manifest.json', buffer: manifestBuf },
        ...plan.zipEntries,
      ];
      await writeStreamingZip(tmpZipPath, finalEntries);
      renameSync(tmpZipPath, targetFilePath);

      const finalSize = statSync(targetFilePath).size;
      return {
        ok: true,
        complete,
        filePath: targetFilePath,
        totalBytes: finalSize,
        counts: plan.counts,
        missingFiles: plan.missingFiles,
        excludedSecrets: plan.excludedSecrets,
        manifest,
      };
    } catch (err) {
      rmSync(tmpZipPath, { force: true });
      throw err;
    }
  } finally {
    for (const d of plan.tempDirsToClean) {
      rmSync(d, { recursive: true, force: true });
    }
  }
}

function isZipFile(filePath: string): boolean {
  if (filePath.toLowerCase().endsWith('.zip')) return true;
  try {
    const fd = readFileSync(filePath, { flag: 'r' }).subarray(0, 4);
    return fd[0] === 0x50 && fd[1] === 0x4b && fd[2] === 0x03 && fd[3] === 0x04;
  } catch {
    return false;
  }
}

async function readAndVerifyZipManifest(
  sourceZipPath: string,
): Promise<{
  manifest: AetheraSystemBackupManifestV2;
  zipEntryMap: Map<string, ParsedZipEntry>;
  integrityErrors: string[];
}> {
  const zipEntries = listZipEntries(sourceZipPath);
  const zipEntryMap = new Map<string, ParsedZipEntry>();
  for (const e of zipEntries) {
    zipEntryMap.set(e.archivePath, e);
  }

  const manifestEntry = zipEntryMap.get('manifest.json');
  if (!manifestEntry) {
    throw new Error('Backup ZIP inválido: manifest.json ausente.');
  }

  const manifestStreamRes = await streamZipEntry(sourceZipPath, manifestEntry, { collectBuffer: true });
  let manifest: Partial<AetheraSystemBackupManifestV2>;
  try {
    manifest = JSON.parse(manifestStreamRes.buffer!.toString('utf8')) as Partial<AetheraSystemBackupManifestV2>;
  } catch {
    throw new Error('Backup ZIP inválido: manifest.json corrompido.');
  }

  if (
    !manifest ||
    manifest.formatVersion !== AETHERA_SYSTEM_BACKUP_ZIP_FORMAT_VERSION ||
    manifest.kind !== AETHERA_SYSTEM_BACKUP_KIND ||
    manifest.app !== 'AetheraStudio' ||
    !Array.isArray(manifest.entries)
  ) {
    throw new Error('Backup ZIP inválido: manifesto incompatível com Aethera Studio v2.');
  }

  const integrityErrors: string[] = [];
  for (const expected of manifest.entries) {
    const ze = zipEntryMap.get(expected.archivePath);
    if (!ze) {
      integrityErrors.push(`Entrada ausente no ZIP: ${expected.archivePath}`);
      continue;
    }
    try {
      const checked = await streamZipEntry(sourceZipPath, ze);
      if (checked.sha256 !== expected.sha256 || checked.bytes !== expected.size) {
        integrityErrors.push(
          `Hash SHA-256 ou tamanho divergente em ${expected.archivePath} (esperado ${expected.sha256.slice(0, 12)}, obtido ${checked.sha256.slice(0, 12)})`,
        );
      }
    } catch (err) {
      integrityErrors.push(err instanceof Error ? err.message : `Erro ao verificar ${expected.archivePath}`);
    }
  }

  return {
    manifest: manifest as AetheraSystemBackupManifestV2,
    zipEntryMap,
    integrityErrors,
  };
}

export async function inspectSystemBackup(
  deps: SystemBackupDeps,
  sourceFilePath: string,
): Promise<InspectSystemBackupResult> {
  if (!isZipFile(sourceFilePath)) {
    const parsed = JSON.parse(readFileSync(sourceFilePath, 'utf8')) as Partial<AetheraSystemBackupBundle>;
    if (
      !parsed ||
      parsed.schemaVersion !== AETHERA_SYSTEM_BACKUP_SCHEMA_VERSION ||
      parsed.kind !== AETHERA_SYSTEM_BACKUP_KIND ||
      parsed.app !== 'AetheraStudio'
    ) {
      throw new Error('Arquivo de backup inválido.');
    }
    const existingProjectConflicts: string[] = [];
    if (parsed.cinemaProjects && existsSync(deps.cinemaProjectsDir)) {
      for (const name of Object.keys(parsed.cinemaProjects)) {
        if (SAFE_JSON_NAME.test(name) && existsSync(join(deps.cinemaProjectsDir, name))) {
          existingProjectConflicts.push(name);
        }
      }
    }
    return {
      ok: true,
      formatVersion: 1,
      exportedAt: parsed.exportedAt ?? '',
      appVersion: parsed.appVersion ?? '',
      complete: true,
      counts: parsed.counts ?? {
        cinemaProjects: 0,
        academyMaterials: 0,
        academyKnowledge: 0,
        academyExercises: 0,
        evolutionMemories: 0,
        calendarEvents: 0,
        calendarSeries: 0,
        hasDatabase: Boolean(parsed.databaseBase64),
        hasPreferences: Boolean(parsed.preferences),
      },
      missingFiles: [],
      integrityErrors: [],
      entriesCount: Object.keys(parsed.cinemaProjects ?? {}).length,
      existingProjectConflicts,
    };
  }

  const { manifest, integrityErrors } = await readAndVerifyZipManifest(sourceFilePath);
  const existingProjectConflicts: string[] = [];
  if (existsSync(deps.cinemaProjectsDir)) {
    for (const entry of manifest.entries) {
      if (entry.category === 'cinema_project') {
        const name = basename(entry.archivePath);
        if (existsSync(join(deps.cinemaProjectsDir, name))) {
          existingProjectConflicts.push(name);
        }
      }
    }
  }

  return {
    ok: integrityErrors.length === 0,
    formatVersion: 2,
    exportedAt: manifest.exportedAt,
    appVersion: manifest.appVersion,
    complete: manifest.complete,
    counts: manifest.counts,
    missingFiles: manifest.missingFiles,
    integrityErrors,
    entriesCount: manifest.entries.length,
    existingProjectConflicts,
  };
}

export async function restoreSystemBackup(
  deps: SystemBackupDeps,
  sourceFilePath: string,
  options?: {
    sections?: RestoreSections;
    conflictMode?: RestoreConflictMode;
  },
): Promise<RestoreSystemBackupResult> {
  if (!isZipFile(sourceFilePath)) {
    return restoreLegacyJsonBackup(deps, sourceFilePath);
  }

  const sections: Required<RestoreSections> = {
    database: options?.sections?.database ?? true,
    preferences: options?.sections?.preferences ?? true,
    cinemaProjects: options?.sections?.cinemaProjects ?? true,
    mediaLibrary: options?.sections?.mediaLibrary ?? true,
    academy: options?.sections?.academy ?? true,
    evolution: options?.sections?.evolution ?? true,
    calendar: options?.sections?.calendar ?? true,
  };
  const conflictMode: RestoreConflictMode = options?.conflictMode ?? 'rename';

  const { manifest, zipEntryMap, integrityErrors } = await readAndVerifyZipManifest(sourceFilePath);
  if (integrityErrors.length > 0) {
    throw new Error(`Restauração recusada por falha de integridade: ${integrityErrors.join('; ')}`);
  }

  const stagingDir = createBackupTempDir(deps, 'sys-restore-v2-');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preservedDir = join(dirname(deps.databaseFile), 'preserved', `system-restore-${stamp}`);
  mkdirSync(preservedDir, { recursive: true });

  const conflicts: string[] = [];
  const remapStats = { remapped: 0 };
  const managedLibrary = new ManagedMediaLibrary(deps.userDataDir);

  const remapByLegacyPath = new Map<string, string>();
  for (const r of manifest.pathRemappings) {
    remapByLegacyPath.set(r.legacyPath.replace(/\\/g, '/').toLowerCase(), r.portableRelativePath);
  }

  let restoredDbApplied = false;
  let migrationReport: VelixAssetMigrationReport | undefined;

  try {
    // 1. Validate DB in staging first if selected
    const dbManifestEntry = manifest.entries.find((e) => e.category === 'database');
    let stagedDbPath: string | null = null;
    if (sections.database && dbManifestEntry) {
      const ze = zipEntryMap.get(dbManifestEntry.archivePath)!;
      stagedDbPath = join(stagingDir, 'database.sqlite');
      await streamZipEntry(sourceFilePath, ze, { destFilePath: stagedDbPath });
      const check = verifyBackup(stagedDbPath);
      if (!check.ok) {
        throw new Error(`Banco de dados no backup recusado na verificação de integridade: ${check.error}`);
      }
    }

    // 2. Restore Media Library + external assets first so paths exist on disk when projects/DB remap
    if (sections.mediaLibrary) {
      if (existsSync(managedLibrary.rootDir)) {
        copyDirectoryContents(managedLibrary.rootDir, join(preservedDir, 'media-library'));
      }
      if (deps.cinemaLibraryDir && existsSync(deps.cinemaLibraryDir)) {
        copyDirectoryContents(deps.cinemaLibraryDir, join(preservedDir, 'cinema-library'));
      }
      if (deps.creativeStudioDir && existsSync(deps.creativeStudioDir)) {
        copyDirectoryContents(deps.creativeStudioDir, join(preservedDir, 'creative-studio'));
      }

      for (const entry of manifest.entries) {
        const ze = zipEntryMap.get(entry.archivePath)!;
        if (entry.category === 'media_library') {
          const target = resolveSafeRelativeTarget(deps.userDataDir, entry.relativePath);
          if (!target) continue;
          if (entry.relativePath === 'media-library/index.json') {
            // Merge index.json safely instead of blind overwrite
            const bufRes = await streamZipEntry(sourceFilePath, ze, { collectBuffer: true });
            const incoming = JSON.parse(bufRes.buffer!.toString('utf8')) as {
              records?: Array<{
                id: string;
                sha256: string;
                bytes: number;
                portablePath: string;
                originalName: string;
                legacySourcePaths?: string[];
              }>;
            };
            for (const rec of incoming.records ?? []) {
              managedLibrary.registerRestoredBlob({
                id: rec.id,
                sha256: rec.sha256,
                bytes: rec.bytes,
                portablePath: rec.portablePath,
                originalName: rec.originalName,
                ...(rec.legacySourcePaths?.[0] ? { legacySourcePath: rec.legacySourcePaths[0] } : {}),
              });
            }
          } else {
            await streamZipEntry(sourceFilePath, ze, { destFilePath: target });
          }
        } else if (entry.category === 'external_asset') {
          const target = resolveSafeRelativeTarget(deps.userDataDir, entry.relativePath);
          if (!target) continue;
          await streamZipEntry(sourceFilePath, ze, { destFilePath: target });
          managedLibrary.registerRestoredBlob({
            sha256: entry.sha256,
            bytes: entry.size,
            portablePath: entry.relativePath,
            originalName: basename(entry.originalPath ?? entry.relativePath),
            ...(entry.originalPath ? { legacySourcePath: entry.originalPath } : {}),
          });
        } else if (entry.category === 'cinema_library' && deps.cinemaLibraryDir) {
          const relInside = entry.relativePath.replace(/^cinema-library\//, '');
          const target = resolveSafeRelativeTarget(deps.cinemaLibraryDir, relInside);
          if (target) await streamZipEntry(sourceFilePath, ze, { destFilePath: target });
        } else if (entry.category === 'creative_studio' && deps.creativeStudioDir) {
          const relInside = entry.relativePath.replace(/^creative-studio\//, '');
          const target = resolveSafeRelativeTarget(deps.creativeStudioDir, relInside);
          if (target) await streamZipEntry(sourceFilePath, ze, { destFilePath: target });
        }
      }
    }

    // 3. Apply Database atomically + migrate velix_local_assets
    if (sections.database && stagedDbPath) {
      try {
        deps.databaseHandle?.close();
      } catch {
        // already closed
      }
      mkdirSync(dirname(deps.databaseFile), { recursive: true });
      for (const suffix of DB_SIDE_FILES) {
        const current = `${deps.databaseFile}${suffix}`;
        if (existsSync(current)) {
          renameSync(current, join(preservedDir, basename(current)));
        }
      }
      copyFileSync(stagedDbPath, deps.databaseFile);
      restoredDbApplied = true;
    }

    if ((sections.database || sections.mediaLibrary) && existsSync(deps.databaseFile)) {
      const migrationDb = new Database(deps.databaseFile);
      try {
        migrationReport = await managedLibrary.migrateVelixLocalAssets(migrationDb);
        remapStats.remapped += migrationReport.remappedByHash + migrationReport.migratedFromDisk;
      } finally {
        migrationDb.close();
      }
    }

    // 4. Preferences
    if (sections.preferences) {
      const prefEntry = manifest.entries.find((e) => e.category === 'preferences');
      if (prefEntry) {
        const ze = zipEntryMap.get(prefEntry.archivePath)!;
        const res = await streamZipEntry(sourceFilePath, ze, { collectBuffer: true });
        const parsed = sanitizePreferencesObject(JSON.parse(res.buffer!.toString('utf8')));
        if (existsSync(deps.preferencesFile)) {
          copyFileSync(deps.preferencesFile, join(preservedDir, 'preferences.json'));
        }
        mkdirSync(dirname(deps.preferencesFile), { recursive: true });
        writeFileSync(deps.preferencesFile, JSON.stringify(parsed, null, 2), 'utf8');
      }
    }

    // 5. Academy / Evolution / Calendar
    if (sections.evolution) {
      const evoEntry = manifest.entries.find((e) => e.category === 'evolution');
      if (evoEntry) {
        const res = await streamZipEntry(sourceFilePath, zipEntryMap.get(evoEntry.archivePath)!, {
          collectBuffer: true,
        });
        deps.evolutionCore.replaceSnapshot(JSON.parse(res.buffer!.toString('utf8')));
      }
    }
    if (sections.academy) {
      const acaEntry = manifest.entries.find((e) => e.category === 'academy');
      if (acaEntry) {
        const res = await streamZipEntry(sourceFilePath, zipEntryMap.get(acaEntry.archivePath)!, {
          collectBuffer: true,
        });
        deps.academyEngine.replaceSnapshot(JSON.parse(res.buffer!.toString('utf8')));
      }
    }
    if (sections.calendar) {
      const calEntry = manifest.entries.find((e) => e.category === 'calendar');
      if (calEntry) {
        const res = await streamZipEntry(sourceFilePath, zipEntryMap.get(calEntry.archivePath)!, {
          collectBuffer: true,
        });
        if (existsSync(deps.calendarFile)) {
          copyFileSync(deps.calendarFile, join(preservedDir, 'editorial-calendar-store.json'));
        }
        mkdirSync(dirname(deps.calendarFile), { recursive: true });
        writeFileSync(deps.calendarFile, res.buffer!.toString('utf8'), 'utf8');
      }
    }

    // 6. Cinema Projects with path remapping & conflict protection
    if (sections.cinemaProjects) {
      mkdirSync(deps.cinemaProjectsDir, { recursive: true });
      for (const entry of manifest.entries) {
        if (entry.category !== 'cinema_project') continue;
        const fileName = basename(entry.archivePath);
        if (!SAFE_JSON_NAME.test(fileName)) continue;

        const res = await streamZipEntry(sourceFilePath, zipEntryMap.get(entry.archivePath)!, {
          collectBuffer: true,
        });
        const rawObj = JSON.parse(res.buffer!.toString('utf8')) as unknown;
        const rewritten = rewriteProjectJsonPaths(
          rawObj,
          remapByLegacyPath,
          manifest.sourceUserDataDirHint ?? '',
          deps.userDataDir,
          remapStats,
        );
        let destPath = join(deps.cinemaProjectsDir, fileName);

        if (existsSync(destPath)) {
          conflicts.push(fileName);
          if (conflictMode === 'skip') {
            continue;
          }
          if (conflictMode === 'rename') {
            const stem = fileName.replace(/\.json$/i, '');
            destPath = join(deps.cinemaProjectsDir, `${stem}-restored-${stamp}.json`);
          } else {
            copyFileSync(destPath, join(preservedDir, fileName));
          }
        }
        writeFileSync(destPath, JSON.stringify(rewritten, null, 2), 'utf8');
      }
    }

    return {
      ok: true,
      formatVersion: 2,
      filePath: sourceFilePath,
      preservedDir,
      counts: manifest.counts,
      requiresRelaunch: restoredDbApplied,
      conflicts,
      remappedReferences: remapStats.remapped,
      ...(migrationReport ? { migrationReport } : {}),
    };
  } catch (err) {
    // Best-effort rollback of database if DB was replaced before failure
    if (restoredDbApplied) {
      for (const suffix of DB_SIDE_FILES) {
        const preservedFile = join(preservedDir, `${basename(deps.databaseFile)}${suffix}`);
        if (existsSync(preservedFile)) {
          copyFileSync(preservedFile, `${deps.databaseFile}${suffix}`);
        }
      }
    }
    throw err;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

function restoreLegacyJsonBackup(
  deps: SystemBackupDeps,
  sourceFilePath: string,
): RestoreSystemBackupResult {
  const raw = readFileSync(sourceFilePath, 'utf8');
  let parsed: Partial<AetheraSystemBackupBundle>;
  try {
    parsed = JSON.parse(raw) as Partial<AetheraSystemBackupBundle>;
  } catch {
    throw new Error('Arquivo de backup inválido: JSON malformado.');
  }

  if (
    !parsed ||
    parsed.schemaVersion !== AETHERA_SYSTEM_BACKUP_SCHEMA_VERSION ||
    parsed.kind !== AETHERA_SYSTEM_BACKUP_KIND ||
    parsed.app !== 'AetheraStudio'
  ) {
    throw new Error(
      'Arquivo de backup inválido: esperado Backup Geral do Sistema do Aethera Studio.',
    );
  }

  let verifiedTempDbDir: string | null = null;
  let verifiedTempDbFile: string | null = null;
  let preservedDir = '';
  try {
    if (typeof parsed.databaseBase64 === 'string' && parsed.databaseBase64.length > 0) {
      verifiedTempDbDir = createBackupTempDir(deps, 'sys-restore-');
      verifiedTempDbFile = join(verifiedTempDbDir, 'restore-verify.db');
      writeFileSync(verifiedTempDbFile, Buffer.from(parsed.databaseBase64, 'base64'));
      const check = verifyBackup(verifiedTempDbFile);
      if (!check.ok) {
        throw new Error(`Backup do banco de dados recusado na verificação de integridade: ${check.error}`);
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    preservedDir = join(dirname(deps.databaseFile), 'preserved', `system-restore-${stamp}`);
    mkdirSync(preservedDir, { recursive: true });

    if (verifiedTempDbFile) {
      try {
        deps.databaseHandle?.close();
      } catch {
        // already closed
      }
      mkdirSync(dirname(deps.databaseFile), { recursive: true });
      for (const suffix of DB_SIDE_FILES) {
        const current = `${deps.databaseFile}${suffix}`;
        if (existsSync(current)) {
          renameSync(current, join(preservedDir, basename(current)));
        }
      }
      copyFileSync(verifiedTempDbFile, deps.databaseFile);
    }

    if (parsed.preferences && typeof parsed.preferences === 'object' && !Array.isArray(parsed.preferences)) {
      if (existsSync(deps.preferencesFile)) {
        copyFileSync(deps.preferencesFile, join(preservedDir, 'preferences.json'));
      }
      mkdirSync(dirname(deps.preferencesFile), { recursive: true });
      writeFileSync(deps.preferencesFile, JSON.stringify(sanitizePreferencesObject(parsed.preferences), null, 2), 'utf8');
    }

    if (parsed.evolution) deps.evolutionCore.replaceSnapshot(parsed.evolution);
    if (parsed.academy) deps.academyEngine.replaceSnapshot(parsed.academy);
    if (parsed.calendar && typeof parsed.calendar === 'object') {
      if (existsSync(deps.calendarFile)) {
        copyFileSync(deps.calendarFile, join(preservedDir, 'editorial-calendar-store.json'));
      }
      mkdirSync(dirname(deps.calendarFile), { recursive: true });
      writeFileSync(deps.calendarFile, JSON.stringify(parsed.calendar, null, 2), 'utf8');
    }
    if (parsed.cinemaProjects && typeof parsed.cinemaProjects === 'object' && !Array.isArray(parsed.cinemaProjects)) {
      mkdirSync(deps.cinemaProjectsDir, { recursive: true });
      for (const [fileName, content] of Object.entries(parsed.cinemaProjects)) {
        if (!SAFE_JSON_NAME.test(fileName)) continue;
        writeFileSync(join(deps.cinemaProjectsDir, fileName), JSON.stringify(content, null, 2), 'utf8');
      }
    }
    if (deps.cinemaLibraryDir && parsed.cinemaLibrary && typeof parsed.cinemaLibrary === 'object') {
      if (existsSync(deps.cinemaLibraryDir)) {
        copyDirectoryContents(deps.cinemaLibraryDir, join(preservedDir, 'cinema-library'));
      }
      mkdirSync(deps.cinemaLibraryDir, { recursive: true });
      for (const [relPath, base64Content] of Object.entries(parsed.cinemaLibrary)) {
        if (typeof base64Content !== 'string') continue;
        const safeTarget = resolveSafeRelativeTarget(deps.cinemaLibraryDir, relPath);
        if (!safeTarget) continue;
        mkdirSync(dirname(safeTarget), { recursive: true });
        writeFileSync(safeTarget, Buffer.from(base64Content, 'base64'));
      }
    }
    if (deps.creativeStudioDir && parsed.creativeStudioAssets && typeof parsed.creativeStudioAssets === 'object') {
      if (existsSync(deps.creativeStudioDir)) {
        copyDirectoryContents(deps.creativeStudioDir, join(preservedDir, 'creative-studio'));
      }
      mkdirSync(deps.creativeStudioDir, { recursive: true });
      for (const [relPath, base64Content] of Object.entries(parsed.creativeStudioAssets)) {
        if (typeof base64Content !== 'string') continue;
        const safeTarget = resolveSafeRelativeTarget(deps.creativeStudioDir, relPath);
        if (!safeTarget) continue;
        mkdirSync(dirname(safeTarget), { recursive: true });
        writeFileSync(safeTarget, Buffer.from(base64Content, 'base64'));
      }
    }
  } finally {
    if (verifiedTempDbDir) {
      rmSync(verifiedTempDbDir, { recursive: true, force: true });
    }
  }

  return {
    ok: true,
    formatVersion: 1,
    filePath: sourceFilePath,
    preservedDir,
    counts: parsed.counts ?? {
      cinemaProjects: 0,
      academyMaterials: 0,
      academyKnowledge: 0,
      academyExercises: 0,
      evolutionMemories: 0,
      calendarEvents: 0,
      calendarSeries: 0,
      hasDatabase: Boolean(verifiedTempDbFile),
      hasPreferences: Boolean(parsed.preferences),
    },
    requiresRelaunch: Boolean(verifiedTempDbFile),
    conflicts: [],
    remappedReferences: 0,
  };
}
