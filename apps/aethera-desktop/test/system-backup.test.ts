import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase, type DatabaseHandle } from '@neuralbridge/database';
import {
  AetheraAcademyEngine,
  AetheraEvolutionCore,
  EditorialCalendarEngine,
} from '../../../packages/cinema/src/index.js';
import {
  estimateSystemBackup,
  exportSystemBackup,
  inspectSystemBackup,
  restoreSystemBackup,
} from '../src/main/system-backup.js';
import {
  computeFileSha256Streaming,
  ManagedMediaLibrary,
} from '../src/main/managed-media-library.js';
import {
  listZipEntries,
  normalizeSafeZipEntryPath,
  resolveSafeZipExtractPath,
  streamZipEntry,
  writeStreamingZip,
} from '../src/main/portable-zip.js';

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

function createBasicDeps(root: string, userDataDir: string, dbHandle: DatabaseHandle | null = null) {
  const dbFile = join(userDataDir, 'db', 'brain.db');
  const preferencesFile = join(userDataDir, 'preferences.json');
  const calendarFile = join(userDataDir, 'calendar', 'editorial-calendar-store.json');
  const cinemaProjectsDir = join(userDataDir, 'cinema-projects');
  const evolutionCore = new AetheraEvolutionCore(join(userDataDir, 'evolution', 'evolution-store.json'));
  const academyEngine = new AetheraAcademyEngine(
    evolutionCore,
    join(userDataDir, 'evolution', 'academy-store.json'),
  );
  const editorialCalendar = new EditorialCalendarEngine(calendarFile);
  return {
    appVersion: '0.1.65',
    userDataDir,
    databaseFile: dbFile,
    databaseHandle: dbHandle,
    preferencesFile,
    calendarFile,
    cinemaProjectsDir,
    cinemaLibraryDir: join(userDataDir, 'cinema-library'),
    academyEngine,
    evolutionCore,
    editorialCalendar,
    tmpRoot: join(root, 'tmp'),
  };
}

describe('Aethera Managed Media Library & Portable ZIP System Backup', () => {
  it('imports files into userData/media-library with SHA-256 deduplication and preserves originals', async () => {
    const root = makeTempDir('aethera-lib-import-');
    const userDataDir = join(root, 'userData');
    const externalDir = join(root, 'external-music');
    mkdirSync(externalDir, { recursive: true });

    const originalWav = join(externalDir, 'alien-ui.wav');
    const duplicateWav = join(externalDir, 'alien-ui-copy.wav');
    const payload = Buffer.from('RIFF-AUDIO-SAMPLE-1234567890');
    writeFileSync(originalWav, payload);
    writeFileSync(duplicateWav, payload);

    const library = new ManagedMediaLibrary(userDataDir);
    const first = await library.importFile(originalWav);
    const second = await library.importFile(duplicateWav);

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(first.record.sha256).toBe(second.record.sha256);
    expect(first.record.portablePath).toMatch(/^media-library\/blobs\/[0-9a-f]{2}\/[0-9a-f]{64}\.wav$/);
    expect(existsSync(first.absolutePath)).toBe(true);
    expect(readFileSync(first.absolutePath)).toEqual(payload);
    // Original files untouched
    expect(existsSync(originalWav)).toBe(true);
    expect(existsSync(duplicateWav)).toBe(true);
    expect(library.resolvePortablePath(first.record.portablePath)).toBe(first.absolutePath);
  });

  it('exports .zip with manifest, excludes secrets, estimates size, and restores cleanly', async () => {
    const root = makeTempDir('aethera-sys-zip-');
    const userDataDir = join(root, 'userData');
    const deps = createBasicDeps(root, userDataDir);

    mkdirSync(join(userDataDir, 'db'), { recursive: true });
    mkdirSync(deps.cinemaProjectsDir, { recursive: true });
    writeFileSync(
      deps.preferencesFile,
      JSON.stringify({ theme: 'dark', tokenBudget: 50000, apiKey: 'SUPER_SECRET_KEY', authToken: 'TOK_123' }),
      'utf8',
    );
    writeFileSync(join(userDataDir, 'aethera-claude-gateway.bin'), Buffer.from('encrypted-secret-blob'));
    writeFileSync(
      join(deps.cinemaProjectsDir, 'proj_1.json'),
      JSON.stringify({ id: 'proj_1', title: 'Dragon Ball Z' }),
      'utf8',
    );

    deps.evolutionCore.ingestHumanFeedback('Usar corte seco antes da transformação.', {
      projectId: 'proj_1',
      genre: 'anime',
    });
    deps.editorialCalendar.upsertEvent({
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

    const estimate = await estimateSystemBackup(deps);
    expect(estimate.complete).toBe(true);
    expect(estimate.totalBytes).toBeGreaterThan(0);
    expect(estimate.excludedSecrets).toContain('aethera-claude-gateway.bin');

    const backupZipPath = join(root, 'aethera-system-backup.zip');
    const exported = await exportSystemBackup(deps, backupZipPath);
    expect(exported.ok).toBe(true);
    expect(exported.complete).toBe(true);
    expect(exported.manifest?.formatVersion).toBe(2);
    expect(exported.excludedSecrets).toContain('aethera-claude-gateway.bin');

    const zipEntries = listZipEntries(backupZipPath);
    expect(zipEntries.some((e) => e.archivePath.includes('aethera-claude-gateway.bin'))).toBe(false);

    // Mutate live state before restore
    writeFileSync(deps.preferencesFile, JSON.stringify({ theme: 'light' }), 'utf8');
    writeFileSync(
      join(deps.cinemaProjectsDir, 'proj_1.json'),
      JSON.stringify({ id: 'proj_1', title: 'Mutated' }),
      'utf8',
    );
    deps.evolutionCore.replaceSnapshot({ ...deps.evolutionCore.getSnapshot(), memories: [] });

    const inspection = await inspectSystemBackup(deps, backupZipPath);
    expect(inspection.ok).toBe(true);
    expect(inspection.formatVersion).toBe(2);
    expect(inspection.integrityErrors).toEqual([]);
    expect(inspection.existingProjectConflicts).toContain('proj_1.json');

    const restored = await restoreSystemBackup(deps, backupZipPath, { conflictMode: 'overwrite' });
    expect(restored.ok).toBe(true);
    expect(restored.formatVersion).toBe(2);
    expect(existsSync(restored.preservedDir)).toBe(true);

    const restoredPrefs = JSON.parse(readFileSync(deps.preferencesFile, 'utf8')) as Record<string, unknown>;
    expect(restoredPrefs).toEqual({ theme: 'dark', tokenBudget: 50000 });
    expect(restoredPrefs['apiKey']).toBeUndefined();
    expect(restoredPrefs['authToken']).toBeUndefined();
    expect(JSON.parse(readFileSync(join(deps.cinemaProjectsDir, 'proj_1.json'), 'utf8'))).toEqual({
      id: 'proj_1',
      title: 'Dragon Ball Z',
    });
    expect(deps.evolutionCore.getSnapshot().memories.length).toBe(1);
    expect(JSON.parse(readFileSync(deps.calendarFile, 'utf8')).events).toHaveLength(1);
  });

  it('refuses to mark backup complete when a required referenced file is missing', async () => {
    const root = makeTempDir('aethera-sys-missing-ref-');
    const userDataDir = join(root, 'userData');
    const dbFile = join(userDataDir, 'db', 'brain.db');
    mkdirSync(join(userDataDir, 'db'), { recursive: true });

    const dbHandle = openDatabase(dbFile, {
      migrationsFolder: join(import.meta.dirname, '../../../packages/database/migrations'),
    });
    try {
      dbHandle.sqlite.exec(
        "INSERT INTO video_projects (id, name, root_path) VALUES ('p1', 'Test', 'c:/tmp/p1');",
      );
      dbHandle.sqlite.exec(
        "INSERT INTO velix_local_assets (id, project_id, path, bytes, sha256, rights_status) VALUES ('a1', 'p1', 'C:/nonexistent-drive/missing-sfx.wav', 123, 'deadbeef', 'verified_allowed');",
      );

      const deps = createBasicDeps(root, userDataDir, dbHandle);
      const estimate = await estimateSystemBackup(deps);
      expect(estimate.complete).toBe(false);
      expect(estimate.missingFiles).toHaveLength(1);
      expect(estimate.missingFiles[0]?.path).toContain('missing-sfx.wav');

      const res = await exportSystemBackup(deps, join(root, 'incomplete.zip'));
      expect(res.ok).toBe(false);
      expect(res.complete).toBe(false);
      expect(res.missingFiles).toHaveLength(1);
      expect(existsSync(join(root, 'incomplete.zip'))).toBe(false);
    } finally {
      dbHandle.close();
    }
  });

  it('rejects tampered ZIP backups with SHA-256 integrity mismatch and blocks path traversal', async () => {
    const root = makeTempDir('aethera-sys-integrity-');
    const userDataDir = join(root, 'userData');
    const deps = createBasicDeps(root, userDataDir);
    mkdirSync(deps.cinemaProjectsDir, { recursive: true });
    writeFileSync(join(deps.cinemaProjectsDir, 'safe.json'), JSON.stringify({ ok: true }), 'utf8');

    const backupZip = join(root, 'valid.zip');
    await exportSystemBackup(deps, backupZip);

    // Tamper with safe.json content while keeping old manifest sha256
    const entries = listZipEntries(backupZip);
    const rebuilt: Array<{ archivePath: string; buffer: Buffer }> = [];
    for (const e of entries) {
      const data = await streamZipEntry(backupZip, e, { collectBuffer: true });
      if (e.archivePath === 'projects/safe.json') {
        rebuilt.push({ archivePath: e.archivePath, buffer: Buffer.from('{"ok":false,"tampered":true}') });
      } else {
        rebuilt.push({ archivePath: e.archivePath, buffer: data.buffer! });
      }
    }
    const tamperedZip = join(root, 'tampered.zip');
    await writeStreamingZip(tamperedZip, rebuilt);

    const inspectTampered = await inspectSystemBackup(deps, tamperedZip);
    expect(inspectTampered.ok).toBe(false);
    expect(inspectTampered.integrityErrors.length).toBeGreaterThan(0);
    await expect(restoreSystemBackup(deps, tamperedZip)).rejects.toThrow(/falha de integridade/i);

    // Path traversal guards
    expect(normalizeSafeZipEntryPath('../evil.txt')).toBeNull();
    expect(normalizeSafeZipEntryPath('C:\\Windows\\evil.txt')).toBeNull();
    expect(normalizeSafeZipEntryPath('/etc/passwd')).toBeNull();
    expect(resolveSafeZipExtractPath(userDataDir, 'a/../../evil.txt')).toBeNull();

    // Legacy JSON traversal rejection still holds
    const traversalJson = join(root, 'traversal.json');
    writeFileSync(
      traversalJson,
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
    await restoreSystemBackup(deps, traversalJson);
    expect(existsSync(join(userDataDir, 'escaped.json'))).toBe(false);
    expect(existsSync(join(userDataDir, 'cinema-projects', 'safe_proj.json'))).toBe(true);
  });

  it('performs real cross-directory restore & velix_local_assets migration even after original folder is deleted', async () => {
    const root = makeTempDir('aethera-sys-e2e-migration-');
    const srcUserData = join(root, 'pc-antigo-userData');
    const externalSourceDir = join(root, 'pc-antigo-musicas');
    const dstUserData = join(root, 'pc-novo-userData');

    mkdirSync(join(srcUserData, 'db'), { recursive: true });
    mkdirSync(join(srcUserData, 'cinema-projects'), { recursive: true });
    mkdirSync(externalSourceDir, { recursive: true });

    const sfxFile = join(externalSourceDir, 'alien-hud.wav');
    const clipFile = join(externalSourceDir, 'cyberpunk-clip.mp4');
    const sfxBytes = Buffer.from('RIFF-WAV-ALIEN-HUD-PAYLOAD-9999');
    const clipBytes = Buffer.from('FTYP-MP4-CYBERPUNK-CLIP-PAYLOAD-8888');
    writeFileSync(sfxFile, sfxBytes);
    writeFileSync(clipFile, clipBytes);

    const sfxHash = (await computeFileSha256Streaming(sfxFile)).sha256;
    const clipHash = (await computeFileSha256Streaming(clipFile)).sha256;

    // 1. Import clipFile into ManagedMediaLibrary, keep sfxFile as legacy velix_local_assets absolute path
    const srcLib = new ManagedMediaLibrary(srcUserData);
    const importedClip = await srcLib.importFile(clipFile);

    const srcDbFile = join(srcUserData, 'db', 'brain.db');
    const srcDb = openDatabase(srcDbFile, {
      migrationsFolder: join(import.meta.dirname, '../../../packages/database/migrations'),
    });
    try {
      srcDb.sqlite.exec(
        "INSERT INTO video_projects (id, name, root_path) VALUES ('proj_cp', 'Cyberpunk', 'C:/old/proj');",
      );
      srcDb.sqlite
        .prepare(
          'INSERT INTO velix_local_assets (id, project_id, path, bytes, sha256, rights_status) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('legacy_sfx_1', 'proj_cp', sfxFile, sfxBytes.length, sfxHash, 'verified_allowed');

      writeFileSync(
        join(srcUserData, 'cinema-projects', 'proj_cp.json'),
        JSON.stringify({
          timeline: {
            projectId: 'proj_cp',
            clips: [{ videoPath: importedClip.absolutePath, audioPath: sfxFile }],
          },
        }),
        'utf8',
      );

      const srcDeps = createBasicDeps(root, srcUserData, srcDb);
      const backupZip = join(root, 'portable-backup.zip');
      const exported = await exportSystemBackup(srcDeps, backupZip);
      expect(exported.ok).toBe(true);
      expect(exported.complete).toBe(true);
      expect(exported.counts.externalBundledFiles).toBe(1);
      expect(exported.counts.managedLibraryFiles).toBeGreaterThanOrEqual(2);
    } finally {
      srcDb.close();
    }

    // 2. Simulate formatted PC / deleted original directories
    rmSync(externalSourceDir, { recursive: true, force: true });
    rmSync(srcUserData, { recursive: true, force: true });
    expect(existsSync(sfxFile)).toBe(false);
    expect(existsSync(clipFile)).toBe(false);

    // 3. Restore into brand-new target directory (dstUserData)
    const dstDeps = createBasicDeps(root, dstUserData, null);
    const restored = await restoreSystemBackup(dstDeps, join(root, 'portable-backup.zip'));
    expect(restored.ok).toBe(true);
    expect(restored.formatVersion).toBe(2);
    expect(restored.remappedReferences).toBeGreaterThanOrEqual(2);
    expect(restored.migrationReport?.remappedByHash).toBe(1);

    // 4. Verify SQLite velix_local_assets migrated to portable relative path & file is accessible in dstUserData
    const dstDb = new Database(dstDeps.databaseFile);
    try {
      const row = dstDb
        .prepare('SELECT id, path, sha256 FROM velix_local_assets WHERE id = ?')
        .get('legacy_sfx_1') as { id: string; path: string; sha256: string };
      expect(row.path).toBe(`media-library/blobs/${sfxHash.slice(0, 2)}/${sfxHash}.wav`);
      const dstLib = new ManagedMediaLibrary(dstUserData);
      const resolvedSfx = dstLib.resolvePortablePath(row.path);
      expect(resolvedSfx).not.toBeNull();
      expect(existsSync(resolvedSfx!)).toBe(true);
      expect(readFileSync(resolvedSfx!)).toEqual(sfxBytes);
    } finally {
      dstDb.close();
    }

    // 5. Verify restored project JSON paths were rebuilt to dstUserData and are readable
    const restoredProj = JSON.parse(
      readFileSync(join(dstDeps.cinemaProjectsDir, 'proj_cp.json'), 'utf8'),
    ) as { timeline: { clips: Array<{ videoPath: string; audioPath: string }> } };
    const restoredClipPath = restoredProj.timeline.clips[0]!.videoPath;
    const restoredAudioPath = restoredProj.timeline.clips[0]!.audioPath;
    expect(restoredClipPath.startsWith(dstUserData)).toBe(true);
    expect(restoredAudioPath.startsWith(dstUserData)).toBe(true);
    expect(readFileSync(restoredClipPath)).toEqual(clipBytes);
    expect(readFileSync(restoredAudioPath)).toEqual(sfxBytes);
    expect((await computeFileSha256Streaming(restoredClipPath)).sha256).toBe(clipHash);
  });

  it('supports selective restore and conflict preservation without silent overwrites', async () => {
    const root = makeTempDir('aethera-sys-selective-');
    const srcDir = join(root, 'src');
    const dstDir = join(root, 'dst');
    const srcDeps = createBasicDeps(root, srcDir);
    const dstDeps = createBasicDeps(root, dstDir);

    mkdirSync(srcDeps.cinemaProjectsDir, { recursive: true });
    mkdirSync(dstDeps.cinemaProjectsDir, { recursive: true });
    writeFileSync(srcDeps.preferencesFile, JSON.stringify({ theme: 'dark' }), 'utf8');
    writeFileSync(dstDeps.preferencesFile, JSON.stringify({ theme: 'light' }), 'utf8');
    writeFileSync(join(srcDeps.cinemaProjectsDir, 'proj_a.json'), JSON.stringify({ from: 'backup' }), 'utf8');
    writeFileSync(join(dstDeps.cinemaProjectsDir, 'proj_a.json'), JSON.stringify({ from: 'existing' }), 'utf8');

    const backupZip = join(root, 'selective.zip');
    await exportSystemBackup(srcDeps, backupZip);

    const restored = await restoreSystemBackup(dstDeps, backupZip, {
      sections: { cinemaProjects: true, preferences: false },
      conflictMode: 'rename',
    });

    expect(restored.conflicts).toContain('proj_a.json');
    // Existing preferences and existing proj_a.json preserved untouched
    expect(JSON.parse(readFileSync(dstDeps.preferencesFile, 'utf8'))).toEqual({ theme: 'light' });
    expect(JSON.parse(readFileSync(join(dstDeps.cinemaProjectsDir, 'proj_a.json'), 'utf8'))).toEqual({
      from: 'existing',
    });
    // Restored project saved alongside with -restored- suffix
    const projectFiles = readdirSync(dstDeps.cinemaProjectsDir);
    expect(projectFiles.some((f) => f.startsWith('proj_a-restored-'))).toBe(true);
  });
});
