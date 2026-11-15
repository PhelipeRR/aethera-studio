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
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { backupDatabase, verifyBackup, type DatabaseHandle } from '@neuralbridge/database';
import type { AetheraAcademyEngine, AetheraEvolutionCore, EditorialCalendarEngine } from '@neuralbridge/cinema';

export const AETHERA_SYSTEM_BACKUP_SCHEMA_VERSION = 1;
export const AETHERA_SYSTEM_BACKUP_KIND = 'aethera-system-backup';

const DB_SIDE_FILES = ['', '-wal', '-shm', '-journal'] as const;
const SAFE_JSON_NAME = /^[a-zA-Z0-9._-]+\.json$/;

export interface AetheraSystemBackupCounts {
  cinemaProjects: number;
  cinemaLibraryFiles?: number;
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

function createBackupTempDir(deps: SystemBackupDeps, prefix: string): string {
  const tmpBase = deps.tmpRoot ?? join(deps.userDataDir, 'tmp');
  mkdirSync(tmpBase, { recursive: true });
  return mkdtempSync(join(tmpBase, prefix));
}

function collectDirectoryFilesBase64(rootDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(rootDir)) return files;

  const walk = (currentDir: string, prefixParts: string[]) => {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = join(currentDir, entry);
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      const nextParts = [...prefixParts, entry];
      if (stat.isDirectory()) {
        walk(fullPath, nextParts);
      } else if (stat.isFile()) {
        try {
          files[nextParts.join('/')] = readFileSync(fullPath).toString('base64');
        } catch {
          // skip unreadable file
        }
      }
    }
  };

  walk(rootDir, []);
  return files;
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

export function exportSystemBackup(
  deps: SystemBackupDeps,
  targetFilePath: string,
): { ok: true; filePath: string; counts: AetheraSystemBackupCounts } {
  let databaseBase64: string | undefined;
  if (deps.databaseHandle) {
    const tempDir = createBackupTempDir(deps, 'sys-backup-');
    try {
      const tempDbFile = join(tempDir, 'snapshot.db');
      backupDatabase(deps.databaseHandle, tempDbFile);
      databaseBase64 = readFileSync(tempDbFile).toString('base64');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } else if (existsSync(deps.databaseFile)) {
    databaseBase64 = readFileSync(deps.databaseFile).toString('base64');
  }

  let preferences: Record<string, unknown> | undefined;
  if (existsSync(deps.preferencesFile)) {
    try {
      const parsed = JSON.parse(readFileSync(deps.preferencesFile, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        preferences = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore corrupt preferences during export
    }
  }

  const academySnap = deps.academyEngine.getSnapshot();
  const evolutionSnap = deps.evolutionCore.getSnapshot();
  const calendarSnap = deps.editorialCalendar.getSnapshot();

  const cinemaProjects: Record<string, unknown> = {};
  if (existsSync(deps.cinemaProjectsDir)) {
    for (const fileName of readdirSync(deps.cinemaProjectsDir)) {
      if (!SAFE_JSON_NAME.test(fileName)) continue;
      try {
        cinemaProjects[fileName] = JSON.parse(
          readFileSync(join(deps.cinemaProjectsDir, fileName), 'utf8'),
        ) as unknown;
      } catch {
        // skip unreadable project json
      }
    }
  }

  const cinemaLibrary = deps.cinemaLibraryDir ? collectDirectoryFilesBase64(deps.cinemaLibraryDir) : undefined;
  const creativeStudioAssets = deps.creativeStudioDir ? collectDirectoryFilesBase64(deps.creativeStudioDir) : undefined;

  let libraryAssets = 0;
  if (deps.databaseHandle?.sqlite) {
    try {
      const row = deps.databaseHandle.sqlite.prepare('SELECT COUNT(*) AS cnt FROM velix_local_assets').get() as
        | { cnt?: number }
        | undefined;
      libraryAssets = Number(row?.cnt ?? 0);
    } catch {
      libraryAssets = 0;
    }
  }

  const counts: AetheraSystemBackupCounts = {
    cinemaProjects: Object.keys(cinemaProjects).filter((k) => !k.endsWith('.render.json')).length,
    cinemaLibraryFiles: cinemaLibrary ? Object.keys(cinemaLibrary).length : 0,
    creativeStudioFiles: creativeStudioAssets ? Object.keys(creativeStudioAssets).length : 0,
    libraryAssets,
    academyMaterials: academySnap.materials.length,
    academyKnowledge: academySnap.knowledge.length,
    academyExercises: academySnap.exercises.length,
    evolutionMemories: evolutionSnap.memories.length,
    calendarEvents: calendarSnap.events.length,
    calendarSeries: calendarSnap.series.length,
    hasDatabase: Boolean(databaseBase64),
    hasPreferences: Boolean(preferences),
  };

  const bundle: AetheraSystemBackupBundle = {
    schemaVersion: AETHERA_SYSTEM_BACKUP_SCHEMA_VERSION,
    kind: AETHERA_SYSTEM_BACKUP_KIND,
    app: 'AetheraStudio',
    appVersion: deps.appVersion,
    exportedAt: new Date().toISOString(),
    counts,
    ...(databaseBase64 ? { databaseBase64 } : {}),
    ...(preferences ? { preferences } : {}),
    academy: academySnap,
    evolution: evolutionSnap,
    calendar: calendarSnap,
    cinemaProjects,
    ...(cinemaLibrary ? { cinemaLibrary } : {}),
    ...(creativeStudioAssets ? { creativeStudioAssets } : {}),
  };

  mkdirSync(dirname(targetFilePath), { recursive: true });
  writeFileSync(targetFilePath, JSON.stringify(bundle, null, 2), 'utf8');
  return { ok: true, filePath: targetFilePath, counts };
}

export function restoreSystemBackup(
  deps: SystemBackupDeps,
  sourceFilePath: string,
): {
  ok: true;
  filePath: string;
  preservedDir: string;
  counts: AetheraSystemBackupCounts;
  requiresRelaunch: boolean;
} {
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
      'Arquivo de backup inválido: esperado Backup Geral do Sistema do Aethera Studio (schemaVersion 1).',
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
      writeFileSync(deps.preferencesFile, JSON.stringify(parsed.preferences, null, 2), 'utf8');
    }

    if (parsed.evolution) {
      deps.evolutionCore.replaceSnapshot(parsed.evolution);
    }
    if (parsed.academy) {
      deps.academyEngine.replaceSnapshot(parsed.academy);
    }
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
    if (
      deps.cinemaLibraryDir &&
      parsed.cinemaLibrary &&
      typeof parsed.cinemaLibrary === 'object' &&
      !Array.isArray(parsed.cinemaLibrary)
    ) {
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
    if (
      deps.creativeStudioDir &&
      parsed.creativeStudioAssets &&
      typeof parsed.creativeStudioAssets === 'object' &&
      !Array.isArray(parsed.creativeStudioAssets)
    ) {
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

  const counts: AetheraSystemBackupCounts = {
    cinemaProjects: parsed.cinemaProjects
      ? Object.keys(parsed.cinemaProjects).filter((k) => !k.endsWith('.render.json')).length
      : 0,
    cinemaLibraryFiles: parsed.cinemaLibrary ? Object.keys(parsed.cinemaLibrary).length : 0,
    creativeStudioFiles: parsed.creativeStudioAssets ? Object.keys(parsed.creativeStudioAssets).length : 0,
    libraryAssets: parsed.counts?.libraryAssets ?? 0,
    academyMaterials: parsed.academy?.materials?.length ?? 0,
    academyKnowledge: parsed.academy?.knowledge?.length ?? 0,
    academyExercises: parsed.academy?.exercises?.length ?? 0,
    evolutionMemories: parsed.evolution?.memories?.length ?? 0,
    calendarEvents: parsed.calendar?.events?.length ?? 0,
    calendarSeries: parsed.calendar?.series?.length ?? 0,
    hasDatabase: Boolean(verifiedTempDbFile),
    hasPreferences: Boolean(parsed.preferences),
  };

  return {
    ok: true,
    filePath: sourceFilePath,
    preservedDir,
    counts,
    requiresRelaunch: Boolean(verifiedTempDbFile),
  };
}
