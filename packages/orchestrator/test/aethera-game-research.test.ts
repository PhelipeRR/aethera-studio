import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AetheraStudioRepository, openDatabase, videoProjects, VelixProductionRepository, type DatabaseHandle } from '@neuralbridge/database';
import { type ProductionBrief } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameSourceError, type IgdbGame } from '../src/aethera/game-sources.js';
import { createGameResearchStageAdapter, rankingIntentFromPrompt, type GameResearchDeps } from '../src/aethera/game-research-stage.js';
import { confirmOnWeb, isPublicHttpsUrl, type PageFetcher } from '../src/aethera/web-confirmation.js';
import { ProductionRunService, type ProductionTaskPort } from '../src/velix-production.js';
import { SYNTHETIC_IGDB_GAMES } from './fixtures/igdb-synthetic.js';

// Every source below is a scripted fake over SYNTHETIC fixtures; none of it is real research data.
const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let root: string;
const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'ranking', topic: 'Top jogos', targetDurationSeconds: 600, language: 'pt-BR', audience: 'gamers', tone: 'empolgado', narrativeStyle: 'ranking', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 0,
};
const games = SYNTHETIC_IGDB_GAMES;
const fixedNow = () => new Date('2026-11-10T12:00:00.000Z');

/** A TaskEngine port whose structured runs answer with the given web proposals (the agent of the web confirmation). */
function taskPort(proposal: unknown): ProductionTaskPort {
  return { start: async () => { throw new Error('not used'); }, cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined, runStructuredReadOnly: async () => ({ structured: proposal, text: '', taskId: 'synthetic-task' }) } as unknown as ProductionTaskPort;
}
const page = (text: string, status = 200): PageFetcher => async (url) => ({ status, finalUrl: url, contentType: 'text/html', text });

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-research-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = mkdtempSync(join(tmpdir(), 'aethera-research-root-'));
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: root }).run();
});
afterEach(() => handle.close());

function setup(overrides: Partial<GameResearchDeps> & { proposal?: unknown } = {}) {
  const repository = new AetheraStudioRepository(handle.db);
  const deps: GameResearchDeps = {
    repository,
    igdb: () => ({ searchGames: async (title: string) => games.filter((game) => game.name.toLowerCase().includes(title.toLowerCase().split(':')[0] ?? '')), gamesReleasedBetween: async () => [games[0] as IgdbGame, games[2] as IgdbGame] }),
    rawg: () => null,
    fetchPage: page('<html><h1>Fixture Quest</h1><p>Lançamento em 15 de janeiro de 2027</p></html>'),
    now: fixedNow,
    ...overrides,
  };
  const service = new ProductionRunService(new VelixProductionRepository(handle), taskPort(overrides.proposal ?? { sources: [{ url: 'https://fixture-quest.example/news', publisher: 'Fixture Publishing', releaseDate: '2027-01-15', platforms: ['PC'] }] }), [createGameResearchStageAdapter(deps)]);
  return { repository, service };
}

describe('game_research stage', () => {
  it('confirms a game when IGDB and a verified official page agree, and keeps the evidence file', async () => {
    const { repository, service } = setup();
    const run = service.create('vp', brief, 0, 'codex');
    await service.scheduleAdapterStage({ runId: run.id, kind: 'game_research', taskProjectId: 'vp', input: { agent: 'codex', titles: ['Fixture Quest'] } });
    await service.idle();
    expect(service.state(run.id).stages[0]).toMatchObject({ kind: 'game_research', status: 'completed' });
    const [subject] = repository.listSubjects(run.id);
    expect(subject).toMatchObject({ id: `${run.id}:igdb:900001`, title: 'Fixture Quest', verification: 'confirmed', releaseDate: '2027-01-15', datePrecision: 'day', platforms: ['PC (Microsoft Windows)', 'PlayStation 5'], externalIds: { igdb: '900001' }, aliases: ['FQ'] });
    const evidence = JSON.parse(readFileSync(join(root, 'research/games/fixture-quest.json'), 'utf8')) as { checkedAt: string; observations: Array<{ source: string; status: string; retrievedAt: string }> };
    expect(evidence.checkedAt).toBe('2026-11-10T12:00:00.000Z');
    expect(evidence.observations.map((item) => [item.source, item.status])).toEqual([['igdb', 'ok'], ['web', 'ok']]);
  });

  it('leaves the game unconfirmed when the cited page does not mention it', async () => {
    const { repository, service } = setup({ fetchPage: page('<html>Página genérica sem o jogo</html>') });
    const run = service.create('vp', brief, 0, 'codex');
    await service.scheduleAdapterStage({ runId: run.id, kind: 'game_research', taskProjectId: 'vp', input: { titles: ['Fixture Quest'] } });
    await service.idle();
    expect(repository.listSubjects(run.id)[0]?.verification).toBe('unconfirmed');
  });

  it('shows a conflict when the official page gives another date', async () => {
    const { repository, service } = setup({ proposal: { sources: [{ url: 'https://fixture-quest.example/news', publisher: 'Fixture Publishing', releaseDate: '2027-03-01', platforms: [] }] }, fetchPage: page('Fixture Quest chega em 2027') });
    const run = service.create('vp', brief, 0, 'codex');
    await service.scheduleAdapterStage({ runId: run.id, kind: 'game_research', taskProjectId: 'vp', input: { titles: ['Fixture Quest'] } });
    await service.idle();
    expect(repository.listSubjects(run.id)[0]).toMatchObject({ verification: 'conflicting', releaseDate: '2027-01-15' });
  });

  it('records a title IGDB does not have as unconfirmed instead of guessing a close match', async () => {
    const { repository, service } = setup({ proposal: { sources: [] } });
    const run = service.create('vp', brief, 0, 'codex');
    await service.scheduleAdapterStage({ runId: run.id, kind: 'game_research', taskProjectId: 'vp', input: { titles: ['Fixture Quest Remastered'] } });
    await service.idle();
    expect(repository.listSubjects(run.id)[0]).toMatchObject({ id: `${run.id}:title:fixture-quest-remastered`, verification: 'unconfirmed', releaseDate: null, externalIds: {} });
  });

  it('fails with guidance and no partial data when IGDB credentials are missing', async () => {
    const { repository, service } = setup({ igdb: () => null });
    const run = service.create('vp', brief, 0, 'codex');
    await service.scheduleAdapterStage({ runId: run.id, kind: 'game_research', taskProjectId: 'vp', input: { titles: ['Fixture Quest'] } });
    await service.idle();
    const stage = service.state(run.id).stages[0];
    expect(stage?.status).toBe('failed');
    expect(stage?.error).toContain('auth_required');
    expect(repository.listSubjects(run.id)).toEqual([]);
  });

  it('keeps finished games when IGDB goes down mid-way and resumes at the next game', async () => {
    let down = true;
    const searched: string[] = [];
    const igdb = () => ({ searchGames: async (title: string) => { searched.push(title); if (title === 'Fixture Silk' && down) throw new GameSourceError('unavailable', 'IGDB indisponível (HTTP 503).', true); return games.filter((game) => game.name === title); }, gamesReleasedBetween: async () => [] });
    const { repository, service } = setup({ igdb, proposal: { sources: [] } });
    const run = service.create('vp', brief, 0, 'codex');
    await service.scheduleAdapterStage({ runId: run.id, kind: 'game_research', taskProjectId: 'vp', input: { titles: ['Fixture Quest', 'Fixture Silk'] } });
    await service.idle();
    expect(service.state(run.id).stages[0]?.status).toBe('failed');
    expect(repository.listSubjects(run.id).map((subject) => subject.title)).toEqual(['Fixture Quest']);
    down = false;
    await service.resume(run.id);
    await service.idle();
    expect(repository.listSubjects(run.id).map((subject) => subject.title)).toEqual(['Fixture Quest', 'Fixture Silk']);
    expect(searched).toEqual(['Fixture Quest', 'Fixture Silk', 'Fixture Silk']);
  });

  it('turns a period into IGDB candidates once and researches each of them', async () => {
    const { repository, service } = setup({ proposal: { sources: [] } });
    const run = service.create('vp', brief, 0, 'codex');
    await service.scheduleAdapterStage({ runId: run.id, kind: 'game_research', taskProjectId: 'vp', input: { period: { from: '2027-01-01', to: '2028-01-01' }, count: 2 } });
    await service.idle();
    expect(repository.listSubjects(run.id).map((subject) => [subject.title, subject.releaseDate])).toEqual([['Fixture Quest', '2027-01-15'], ['Fixture Silk', '2027']]);
  });
});

describe('web confirmation', () => {
  it('accepts only public https pages proposed by the agent', () => {
    expect(isPublicHttpsUrl('https://www.example.com/game')).toBe(true);
    for (const url of ['http://example.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://intranet/x', 'https://user:pass@example.com', 'file:///C:/x', 'https://server.local/x']) expect(isPublicHttpsUrl(url)).toBe(false);
  });

  it('turns an unavailable agent or a malformed answer into a note, not a source', async () => {
    const failing = await confirmOnWeb({ title: 'Fixture Quest', runStructured: async () => { throw new Error('agente desconectado'); }, fetchPage: page(''), retrievedAt: () => 'now' });
    expect(failing).toEqual({ observations: [], notes: ['web: agente indisponível (agente desconectado).'] });
    const malformed = await confirmOnWeb({ title: 'Fixture Quest', runStructured: async () => ({ structured: { sources: 'x' } }), fetchPage: page(''), retrievedAt: () => 'now' });
    expect(malformed.observations).toEqual([]);
  });

  it('marks pages that fail to load as unverified', async () => {
    const result = await confirmOnWeb({ title: 'Fixture Quest', runStructured: async () => ({ structured: { sources: [{ url: 'https://fixture-quest.example/', publisher: 'X', releaseDate: '2027-01-15', platforms: [] }] } }), fetchPage: async () => { throw new Error('timeout'); }, retrievedAt: () => '2026-11-10T12:00:00.000Z' });
    expect(result.observations[0]).toMatchObject({ status: 'unverified', note: 'página não carregou: timeout' });
  });
});

describe('ranking intent', () => {
  it('reads count and period from the request through a structured agent answer', async () => {
    const intent = await rankingIntentFromPrompt('Top 10 jogos de janeiro de 2027', async () => ({ structured: { count: 10, from: '2027-01-01', to: '2027-02-01', criteria: 'mais aguardados' } }));
    expect(intent).toEqual({ kind: 'ranking', count: 10, subjectKind: 'game', criteria: 'mais aguardados', period: { from: '2027-01-01', to: '2027-02-01' } });
  });
});
