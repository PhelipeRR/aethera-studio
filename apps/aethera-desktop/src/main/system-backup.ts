import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { backupDatabase, verifyBackup, type DatabaseHandle } from '@neuralbridge/database';
import type { AetheraAcademyEngine, AetheraEvolutionCore, EditorialCalendarEngine } from '@neuralbridge/cinema';

export const AETHERA_SYSTEM_BACKUP_SCHEMA_VERSION = 1;
export const AETHERA_SYSTEM_BACKUP_KIND = 'aethera-system-backup';

const DB_SIDE_FILES = ['', '-wal', '-shm', '-journal'] as const;
const SAFE_JSON_NAME = /^[a-zA-Z0-9._-]+\.json$/;

export interface AetheraSystemBackupCounts {
  cinemaProjects: number;
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
}

export interface SystemBackupDeps {
  appVersion: string;
  userDataDir: string;
  databaseFile: string;
  databaseHandle: DatabaseHandle | null;
  preferencesFile: string;
  calendarFile: string;
  cinemaProjectsDir: string;
  academyEngine: AetheraAcademyEngine;
  evolutionCore: AetheraEvolutionCore;
  editorialCalendar: EditorialCalendarEngine;
  tmpRoot?: string;
}

export function exportSystemBackup(
  deps: SystemBackupDeps,
  targetFilePath: string,
): { ok: true; filePath: string; counts: AetheraSystemBackupCounts } {
  let databaseBase64: string | undefined;
  if (deps.databaseHandle) {
    const tempDir = mkdtempSync(join(deps.tmpRoot ?? join(deps.userDataDir, 'tmp'), 'sys-backup-'));
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

  const counts: AetheraSystemBackupCounts = {
    cinemaProjects: Object.keys(cinemaProjects).filter((k) => !k.endsWith('.render.json')).length,
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
  if (typeof parsed.databaseBase64 === 'string' && parsed.databaseBase64.length > 0) {
    verifiedTempDbDir = mkdtempSync(join(deps.tmpRoot ?? join(deps.userDataDir, 'tmp'), 'sys-restore-'));
    verifiedTempDbFile = join(verifiedTempDbDir, 'restore-verify.db');
    writeFileSync(verifiedTempDbFile, Buffer.from(parsed.databaseBase64, 'base64'));
    const check = verifyBackup(verifiedTempDbFile);
    if (!check.ok) {
      rmSync(verifiedTempDbDir, { recursive: true, force: true });
      throw new Error(`Backup do banco de dados recusado na verificação de integridade: ${check.error}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preservedDir = join(dirname(deps.databaseFile), 'preserved', `system-restore-${stamp}`);
  mkdirSync(preservedDir, { recursive: true });

  try {
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
  } finally {
    if (verifiedTempDbDir) {
      rmSync(verifiedTempDbDir, { recursive: true, force: true });
    }
  }

  const counts: AetheraSystemBackupCounts = {
    cinemaProjects: parsed.cinemaProjects
      ? Object.keys(parsed.cinemaProjects).filter((k) => !k.endsWith('.render.json')).length
      : 0,
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
