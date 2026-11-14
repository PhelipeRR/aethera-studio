import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, videoProjects, VelixProductionRepository, type DatabaseHandle } from '@neuralbridge/database';
import { type ProductionBrief } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCheckpointedItems } from '../src/aethera/item-checkpoint.js';
import { ProductionRunService, type ProductionStageAdapter, type ProductionTaskPort } from '../src/velix-production.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;

const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'ranking', topic: 'Top 3 jogos', targetDurationSeconds: 300, language: 'pt-BR', audience: 'gamers', tone: 'empolgado', narrativeStyle: 'ranking', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 0,
};
const GAMES = [{ id: 'game-a' }, { id: 'game-b' }, { id: 'game-c' }];
/** Never used by adapter stages: they run in-process and only reach the TaskEngine for structured calls. */
const noTasks: ProductionTaskPort = { start: async () => { throw new Error('not used'); }, cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined } as unknown as ProductionTaskPort;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-items-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: mkdtempSync(join(tmpdir(), 'aethera-items-root-')) }).run();
});
afterEach(() => handle.close());

/** An acquisition-like stage: one artifact per game, with a hook to fail or hang on a given game. */
function acquisition(calls: string[], onItem: (id: string) => Promise<void> = async () => undefined): ProductionStageAdapter {
  return {
    kind: 'media_acquisition',
    run: async (context) => {
      await runCheckpointedItems(context, GAMES, async (game) => {
        calls.push(game.id);
        await onItem(game.id);
        const artifact = context.writeArtifact({ kind: 'acquired-media', relativePath: `media/${game.id}.json`, content: JSON.stringify({ game: game.id }), mime: 'application/json' });
        return { status: 'done', result: { artifactId: artifact.id } };
      });
      return undefined;
    },
  };
}

describe('per-item checkpoint of a Studio stage', () => {
  it('fails on the second game, then a restart resumes at that game without redoing or duplicating the first', async () => {
    const calls: string[] = [];
    let failOnce = true;
    const first = new ProductionRunService(new VelixProductionRepository(handle), noTasks, [acquisition(calls, async (id) => { if (id === 'game-b' && failOnce) { failOnce = false; throw new Error('network: falha simulada'); } })]);
    const run = first.create('vp', brief, 0, 'codex');
    await first.scheduleAdapterStage({ runId: run.id, kind: 'media_acquisition', taskProjectId: 'vp', input: { games: GAMES.map((game) => game.id) } });
    await first.idle();
    expect(first.state(run.id).stages[0]).toMatchObject({ kind: 'media_acquisition', status: 'failed' });
    expect(first.state(run.id).artifacts).toHaveLength(1);

    // A new service over the same database is what the app sees after a restart.
    const second = new ProductionRunService(new VelixProductionRepository(handle), noTasks, [acquisition(calls)]);
    second.recover();
    await second.resume(run.id);
    await second.idle();
    const state = second.state(run.id);
    expect(state.stages[0]).toMatchObject({ status: 'completed', progress: 1 });
    expect(state.artifacts.map((artifact) => artifact.relativePath)).toEqual(['media/game-a.json', 'media/game-b.json', 'media/game-c.json']);
    expect(calls).toEqual(['game-a', 'game-b', 'game-b', 'game-c']);
  });

  it('continues from the saved item when the app closed in the middle of a game', async () => {
    const calls: string[] = [];
    const first = new ProductionRunService(new VelixProductionRepository(handle), noTasks, [acquisition(calls, (id) => (id === 'game-b' ? new Promise<void>(() => undefined) : Promise.resolve()))]);
    const run = first.create('vp', brief, 0, 'codex');
    await first.scheduleAdapterStage({ runId: run.id, kind: 'media_acquisition', taskProjectId: 'vp' });
    await new Promise((done) => setTimeout(done, 20));
    expect(first.state(run.id).stages[0]?.status).toBe('running');

    const second = new ProductionRunService(new VelixProductionRepository(handle), noTasks, [acquisition(calls)]);
    expect(second.recover()).toBe(1);
    await second.resume(run.id);
    await second.idle();
    expect(second.state(run.id).stages[0]?.status).toBe('completed');
    expect(second.state(run.id).artifacts).toHaveLength(3);
    expect(calls.filter((id) => id === 'game-a')).toHaveLength(1);
  });

  it('stops at the item boundary when cancelled and keeps what was saved', async () => {
    const controller = new AbortController();
    let saved: Record<string, unknown> = {};
    const context = { state: {}, signal: controller.signal, saveState: (state: Record<string, unknown>) => { saved = state; }, progress: () => undefined };
    await expect(runCheckpointedItems(context, GAMES, async (game) => { if (game.id === 'game-a') controller.abort(); return { status: 'done', result: game.id }; })).rejects.toThrow(/cancel/i);
    expect(Object.keys((saved['items'] ?? {}) as object)).toEqual(['game-a']);
  });

  it('rejects duplicate item ids instead of silently merging their results', async () => {
    const context = { state: {}, signal: new AbortController().signal, saveState: () => undefined, progress: () => undefined };
    await expect(runCheckpointedItems(context, [{ id: 'x' }, { id: 'x' }], async () => ({ status: 'done', result: 1 }))).rejects.toThrow(/duplicad/i);
  });
});
