import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AetheraAcademyEngine, AetheraEvolutionCore, EditorialCalendarEngine } from '../../../packages/cinema/src/index.js';
import { exportSystemBackup, restoreSystemBackup } from '../src/main/system-backup.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Aethera System Backup & Restore', () => {
  it('exports and restores preferences, academy, evolution, calendar and cinema projects while preserving prior state', () => {
    const root = makeTempDir('aethera-sys-backup-');
    const userDataDir = join(root, 'userData');
    const dbFile = join(userDataDir, 'db', 'brain.db');
    const preferencesFile = join(userDataDir, 'preferences.json');
    const calendarFile = join(userDataDir, 'calendar', 'editorial-calendar-store.json');
    const cinemaProjectsDir = join(userDataDir, 'cinema-projects');
    const evolutionFile = join(userDataDir, 'evolution', 'evolution-store.json');
    const academyFile = join(userDataDir, 'evolution', 'academy-store.json');

    mkdirSync(join(userDataDir, 'db'), { recursive: true });
    mkdirSync(cinemaProjectsDir, { recursive: true });
    writeFileSync(preferencesFile, JSON.stringify({ theme: 'dark', tokenBudget: 50000 }), 'utf8');
    writeFileSync(join(cinemaProjectsDir, 'proj_1.json'), JSON.stringify({ id: 'proj_1', title: 'Dragon Ball Z' }), 'utf8');

    const evolutionCore = new AetheraEvolutionCore(evolutionFile);
    evolutionCore.ingestHumanFeedback('Usar corte seco antes da transformação.', { projectId: 'proj_1', genre: 'anime' });
    const academyEngine = new AetheraAcademyEngine(evolutionCore, academyFile);
    const editorialCalendar = new EditorialCalendarEngine(calendarFile);
    editorialCalendar.upsertEvent({
      id: 'evt_1',
      title: 'Publicar Episódio 1',
      description: 'Episódio piloto',
      channelId: 'ch_1',
      channelName: 'Canal Principal',
      plannedDateIso: '2026-11-20T18:00:00-03:00',
      timezone: 'America/Sao_Paulo',
      platform: 'youtube',
      format: 'long',
      status: 'draft',
      reviewApproved: false,
    });

    const deps = {
      appVersion: '0.1.65',
      userDataDir,
      databaseFile: dbFile,
      databaseHandle: null,
      preferencesFile,
      calendarFile,
      cinemaProjectsDir,
      academyEngine,
      evolutionCore,
      editorialCalendar,
      tmpRoot: join(root, 'tmp'),
    };

    const backupPath = join(root, 'aethera-system-backup.json');
    const exported = exportSystemBackup(deps, backupPath);
    expect(exported.ok).toBe(true);
    expect(exported.counts.cinemaProjects).toBe(1);
    expect(exported.counts.evolutionMemories).toBe(1);
    expect(exported.counts.calendarEvents).toBe(1);
    expect(exported.counts.hasPreferences).toBe(true);

    // Mutate live state before restore
    writeFileSync(preferencesFile, JSON.stringify({ theme: 'light' }), 'utf8');
    writeFileSync(join(cinemaProjectsDir, 'proj_1.json'), JSON.stringify({ id: 'proj_1', title: 'Mutated' }), 'utf8');
    const emptyEvolution = { ...evolutionCore.getSnapshot(), memories: [] };
    evolutionCore.replaceSnapshot(emptyEvolution);

    const restored = restoreSystemBackup(deps, backupPath);
    expect(restored.ok).toBe(true);
    expect(existsSync(restored.preservedDir)).toBe(true);
    expect(JSON.parse(readFileSync(preferencesFile, 'utf8'))).toEqual({ theme: 'dark', tokenBudget: 50000 });
    expect(JSON.parse(readFileSync(join(cinemaProjectsDir, 'proj_1.json'), 'utf8'))).toEqual({
      id: 'proj_1',
      title: 'Dragon Ball Z',
    });
    expect(evolutionCore.getSnapshot().memories.length).toBe(1);
    expect(JSON.parse(readFileSync(calendarFile, 'utf8')).events).toHaveLength(1);
  });

  it('rejects invalid backup files and ignores path-traversal project entries', () => {
    const root = makeTempDir('aethera-sys-invalid-');
    const userDataDir = join(root, 'userData');
    const evolutionCore = new AetheraEvolutionCore(join(userDataDir, 'evolution', 'evolution-store.json'));
    const academyEngine = new AetheraAcademyEngine(evolutionCore, join(userDataDir, 'evolution', 'academy-store.json'));
    const editorialCalendar = new EditorialCalendarEngine(join(userDataDir, 'calendar', 'editorial-calendar-store.json'));

    const deps = {
      appVersion: '0.1.65',
      userDataDir,
      databaseFile: join(userDataDir, 'db', 'brain.db'),
      databaseHandle: null,
      preferencesFile: join(userDataDir, 'preferences.json'),
      calendarFile: join(userDataDir, 'calendar', 'editorial-calendar-store.json'),
      cinemaProjectsDir: join(userDataDir, 'cinema-projects'),
      academyEngine,
      evolutionCore,
      editorialCalendar,
      tmpRoot: join(root, 'tmp'),
    };

    const badBackup = join(root, 'bad.json');
    writeFileSync(badBackup, JSON.stringify({ schemaVersion: 99, kind: 'other' }), 'utf8');
    expect(() => restoreSystemBackup(deps, badBackup)).toThrow(/Arquivo de backup inválido/);

    const traversalBackup = join(root, 'traversal.json');
    writeFileSync(
      traversalBackup,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'aethera-system-backup',
        app: 'AetheraStudio',
        cinemaProjects: {
          '../escaped.json': { bad: true },
          'safe_proj.json': { ok: true },
        },
      }),
      'utf8',
    );
    restoreSystemBackup(deps, traversalBackup);
    expect(existsSync(join(userDataDir, 'escaped.json'))).toBe(false);
    expect(existsSync(join(userDataDir, 'cinema-projects', 'safe_proj.json'))).toBe(true);
  });
});
