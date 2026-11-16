import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AetheraCreativeStudioRepository } from '../src/aethera-creative-studio-repository.js';
import { openDatabase, type DatabaseHandle } from '../src/open.js';

const handles: DatabaseHandle[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Aethera creative generation history repository', () => {
  it('persists a generation request and report across a database reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-generation-history-'));
    dirs.push(dir);
    const file = join(dir, 'creative.db');
    const migrationsFolder = resolve(import.meta.dirname, '../migrations');
    let handle = openDatabase(file, { migrationsFolder });
    handles.push(handle);
    const repo = new AetheraCreativeStudioRepository(handle.db);
    repo.saveGenerationRun({
      id: 'generation-1',
      projectId: null,
      artType: 'thumbnail',
      prompt: 'anime hero',
      status: 'generated',
      requestJson: JSON.stringify({ artType: 'thumbnail', prompt: 'anime hero', professionalPreset: 'anime_cinematic' }),
      reportJson: JSON.stringify({ status: 'generated', engineId: 'comfyui-native', recipe: { seed: 42 } }),
      createdAt: '2026-11-16T20:00:00.000Z',
      updatedAt: '2026-11-16T20:00:00.000Z',
    });
    expect(repo.listGenerationRuns()).toHaveLength(1);
    handle.close();
    handles.splice(handles.indexOf(handle), 1);

    handle = openDatabase(file, { migrationsFolder });
    handles.push(handle);
    const reopened = new AetheraCreativeStudioRepository(handle.db).getGenerationRun('generation-1');
    expect(reopened).toMatchObject({ id: 'generation-1', status: 'generated', prompt: 'anime hero' });
    expect(JSON.parse(reopened?.requestJson ?? '{}')).toMatchObject({ professionalPreset: 'anime_cinematic' });
  });
});
