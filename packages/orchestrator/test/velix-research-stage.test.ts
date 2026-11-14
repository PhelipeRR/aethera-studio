import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, VelixClaimRepository, VelixDiscoveryRepository, videoProjects, VelixProductionRepository, type DatabaseHandle } from '@neuralbridge/database';
import { type ProductionBrief } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { ProductionRunService } from '../src/velix-production.js';
import { createResearchStageAdapter, researchSegments, type ResearchStageDeps } from '../src/velix-research-stage.js';
import { createScriptStageAdapter } from '../src/velix-script-stage.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const ANEEL = 'https://aneel.gov.br/dados';
let handle: DatabaseHandle;
let videoRoot: string;

const brief = (targetWords: number): ProductionBrief => ({
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar', targetDurationSeconds: 600, targetWords, language: 'pt-BR', audience: 'geral', tone: 'sóbrio', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
});

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-research-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  const root = join(mkdtempSync(join(tmpdir(), 'nb-research-root-')), 'p');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
  videoRoot = join(root, 'video');
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root }).run();
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: videoRoot }).run();
  new VelixDiscoveryRepository(handle.db).saveReference({ projectId: 'vp', searchId: null, url: ANEEL, kind: 'article', title: 'Dados de geração', publisher: 'ANEEL', publishedAt: '2025-01-10', retrievedAt: '2025-01-11' });
});
afterEach(() => handle.close());

const dossie: Turn = { structured: { narracao: 'A geração solar distribuída passou de 30 gigawatts em 2025. Muita gente acha que a conta vai cair pela metade.', serie: 'Energia', cenas: [{ blocos: [{ tipo: 'texto', frase: 'A geração solar' }] }] } };
const research: Turn = {
  structured: {
    claims: [
      { text: 'A geração solar distribuída passou de 30 gigawatts em 2025.', kind: 'fact', confidence: 0.9, evidence: [{ url: `${ANEEL}/#t1`, title: 'Dados de geração', publisher: 'ANEEL', publishedAt: '2025-01-10', excerpt: '30,1 GW instalados', confidence: 0.8, classification: 'evidence' }, { url: 'https://blog.exemplo.com/solar', title: 'Post', publisher: 'Blog', excerpt: 'mais de 30 GW', confidence: 0.4, classification: 'evidence' }, { url: 'https://x.y/z', classification: 'unusable' }] },
      { text: 'Muita gente acha que a conta vai cair pela metade.', kind: 'opinion', confidence: 0.6, evidence: [] },
    ],
    media: [{ url: 'https://video.exemplo.com/painel', title: 'Painéis no telhado', kind: 'video', reason: 'ilustra o trecho' }],
  },
};

function setup(turns: (prompt: string) => Turn) {
  const adapter = new FakeAdapter('claude', (request) => turns(request.prompt.slice(request.prompt.indexOf('<'))));
  const engine = new TaskEngine({ handle, adapters: { claude: adapter, codex: new FakeAdapter('codex', []) }, availability: async () => ({ claude: true, codex: true }) });
  const discovery = new VelixDiscoveryRepository(handle.db);
  const repository = new VelixProductionRepository(handle);
  const claims = new VelixClaimRepository(handle);
  const deps: ResearchStageDeps = {
    claims,
    approvedReferences: (projectId) => discovery.listProject(projectId).references.map(({ id, url, title, publisher, publishedAt }) => ({ id, url, title, publisher, publishedAt })),
    saveCandidate: (projectId, candidate) => { if (!discovery.referenceUrls(projectId).has(candidate.url)) discovery.saveReference({ projectId, searchId: null, url: candidate.url, kind: candidate.kind, title: candidate.title, publisher: candidate.publisher, publishedAt: null, reviewStatus: 'pending', retrievedAt: new Date().toISOString() }); },
    recordQuality: (runId, stageId, checks) => { repository.recordQualityReport({ runId, stageId, checks }); },
  };
  const production = new ProductionRunService(repository, engine, [createScriptStageAdapter(), createResearchStageAdapter(deps)]);
  return { adapter, production, claims, discovery };
}

describe('research stage adapter', () => {
  it('turns script claims into reviewable evidence, sends everything else to Discovery as pending and blocks unsupported facts', async () => {
    const { adapter, production, claims, discovery } = setup((prompt) => (prompt.startsWith('<evidencias>') ? research : dossie));
    const run = production.create('vp', brief(300));
    await production.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'api' });
    await production.idle();
    await production.scheduleAdapterStage({ runId: run.id, kind: 'research', taskProjectId: 'api' });
    await production.idle();
    const state = production.view(run.id);
    expect(state.stages.map((stage) => [stage.kind, stage.status])).toEqual([['script', 'completed'], ['research', 'completed']]);
    const prompt = adapter.requests.at(-1)?.prompt ?? '';
    expect(prompt).toContain('<trecho>A geração solar distribuída passou de 30 gigawatts em 2025.');
    expect(prompt).toContain(`ANEEL: Dados de geração (${ANEEL}), 2025-01-10`);

    const listed = claims.list(run.id);
    expect(listed).toHaveLength(2);
    expect(listed.map((claim) => claim.kind)).toEqual(expect.arrayContaining(['fact', 'opinion']));
    expect(listed[0]?.evidence.map((item) => [item.url, item.classification, item.status])).toEqual([[ANEEL, 'evidence', 'candidate'], ['https://blog.exemplo.com/solar', 'discovery', 'candidate']]);
    expect(listed[0]?.evidence[0]?.referenceId).toBeTruthy();
    expect(discovery.pendingReferences('vp').map((item) => [item.url, item.kind])).toEqual([['https://blog.exemplo.com/solar', 'article'], ['https://video.exemplo.com/painel', 'video']]);
    expect(discovery.listProject('vp').rights).toHaveLength(0);

    // Found is not authorized: nothing passes until a person approves evidence from an approved reference.
    expect(state.qualityReports.at(-1)).toMatchObject({ blocking: true, exportable: false, checks: [{ id: 'claims-supported', passed: false }] });
    const discoveryEvidence = listed[0]?.evidence[1]?.id ?? '';
    expect(() => claims.decideEvidence(discoveryEvidence, 'approved')).toThrow(/referência aprovada/);
    claims.decideEvidence(listed[0]?.evidence[0]?.id ?? '', 'approved', 'confere com a tabela');
    expect(claims.gate(run.id)).toMatchObject({ passed: true, facts: 1, supported: 1, labelled: 1 });

    const file = JSON.parse(readFileSync(join(videoRoot, 'producoes', run.id, 'pesquisa', 'afirmacoes.json'), 'utf8')) as { claims: unknown[]; gate: { passed: boolean } };
    expect(file.claims).toHaveLength(2);
    expect(file.gate.passed).toBe(false);
  });

  it('reuses the cache for the same segment and sources, and a person relabelling a claim sticks', async () => {
    let researchCalls = 0;
    const { production, claims } = setup((prompt) => { if (prompt.startsWith('<evidencias>')) { researchCalls += 1; return research; } return dossie; });
    const first = production.create('vp', brief(300));
    await production.scheduleAdapterStage({ runId: first.id, kind: 'script', taskProjectId: 'api' });
    await production.idle();
    await production.scheduleAdapterStage({ runId: first.id, kind: 'research', taskProjectId: 'api' });
    await production.idle();
    const second = production.create('vp', { ...brief(300), topic: 'Energia solar 2' });
    await production.scheduleAdapterStage({ runId: second.id, kind: 'script', taskProjectId: 'api' });
    await production.idle();
    await production.scheduleAdapterStage({ runId: second.id, kind: 'research', taskProjectId: 'api' });
    await production.idle();
    expect(researchCalls).toBe(1);
    const secondClaims = claims.list(second.id);
    expect(secondClaims).toHaveLength(2);
    const fact = secondClaims.find((claim) => claim.text === 'A geração solar distribuída passou de 30 gigawatts em 2025.');
    expect(fact).toMatchObject({ kind: 'fact', kindSource: 'agent' });
    if (!fact) throw new Error('expected the cached fact claim to be present');
    claims.setKind(fact.id, 'estimate');
    expect(claims.list(second.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: fact.id, kind: 'estimate', kindSource: 'user' })]));
    expect(claims.gate(second.id).passed).toBe(true);
  });

  it('refuses to research before there is a script, and splits a Dossiê narration into segments', async () => {
    const { production } = setup(() => dossie);
    const run = production.create('vp', brief(300));
    await production.scheduleAdapterStage({ runId: run.id, kind: 'research', taskProjectId: 'api' });
    await production.idle();
    expect(production.view(run.id).stages[0]).toMatchObject({ status: 'failed', error: { message: expect.stringMatching(/gere o roteiro/) } });
    expect(existsSync(join(videoRoot, 'producoes', run.id, 'pesquisa'))).toBe(false);
    const sentence = 'Esta frase tem exatamente oito palavras no total.';
    const segments = researchSegments({ schemaVersion: 1, mode: 'dossie-v1', title: 't', targetWords: 900, words: 900, narration: Array(110).fill(sentence).join(' ') });
    expect(segments).toHaveLength(3);
    expect(segments.every((segment) => segment.chapter === null)).toBe(true);
  });
});
