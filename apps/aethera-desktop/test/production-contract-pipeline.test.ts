import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AetheraEvolutionCore, type CinemaProductionPackage, type ProductionContract } from '../../../packages/cinema/src/index.js';
import { StagedCinemaPipeline, type StagedProductionJob } from '../src/main/cinema-pipeline.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('StagedCinemaPipeline — Production Contract', () => {
  it('persists the contract and propagates its revision to the completed package', async () => {
    const root = makeTempDir('aethera-contract-');
    let packageReady: (CinemaProductionPackage & { productionContract?: ProductionContract }) | undefined;
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: (pkg) => {
        packageReady = pkg as CinemaProductionPackage & { productionContract?: ProductionContract };
      },
      onRenderReady: () => {},
      acquireExternalMedia: async () => null,
    });

    const paused = await pipeline.start({
      projectId: 'contract_01',
      prompt: 'TOP 3 animes com combates criativos e fontes oficiais. Use cortes sincronizados e música com -14 LUFS.',
      genre: 'top_list',
      format: 'youtube_16_9',
      targetDurationSec: 12,
      humorIntensity: 20,
      renderProfile: 'draft_540p',
      language: 'pt-BR',
      useNvenc: false,
    });

    expect(paused.state).toBe('paused_pending_media');
    expect(paused.contract?.revision).toBe(1);
    expect(paused.contract?.controls.targetDurationSec).toBe(12);
    expect(paused.contract?.requirements.flatMap((requirement) => requirement.evidence).some((evidence) => evidence.stage === 'interpretacao')).toBe(true);
    const pausedMediaRequirement = paused.contract?.requirements.find((requirement) => requirement.category === 'media');
    expect(pausedMediaRequirement?.status).toBe('pending');
    expect(paused.contract?.recovery.attemptsByRequirement[pausedMediaRequirement?.id ?? '']).toHaveLength(1);
    expect(pipeline.loadJob('contract_01')?.contract?.contractId).toBe(paused.contract?.contractId);

    const completed = await pipeline.resolvePendingMedia(
      'contract_01',
      paused.pendingMedia.map((slot) => ({ slotIndex: slot.slotIndex, allowProcedural: true })),
    );

    expect(completed.state).toBe('editor');
    expect(completed.contract?.revision).toBe(1);
    expect(packageReady?.productionContract?.contractId).toBe(completed.contract?.contractId);
  }, 120_000);

  it('upgrades a persisted legacy job without discarding its existing checkpoints', async () => {
    const root = makeTempDir('aethera-contract-legacy-');
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: () => {},
      onRenderReady: () => {},
      acquireExternalMedia: async () => null,
    });

    const paused = await pipeline.start({ projectId: 'contract_legacy', prompt: 'Teste de compatibilidade', targetDurationSec: 12 });
    const jobFile = readdirSync(join(root, 'jobs')).find((name) => name.endsWith('.json'));
    expect(jobFile).toBeTruthy();
    const raw = JSON.parse(readFileSync(join(root, 'jobs', jobFile!), 'utf8')) as StagedProductionJob & { contract?: unknown; contractHistory?: unknown[] };
    delete raw.contract;
    delete raw.contractHistory;
    writeFileSync(join(root, 'jobs', jobFile!), JSON.stringify(raw), 'utf8');

    const upgraded = pipeline.loadJob('contract_legacy');
    expect(upgraded?.completedStages).toEqual(paused.completedStages);
    expect(upgraded?.contract?.revision).toBe(1);
    expect(upgraded?.prompt).toBe('Teste de compatibilidade');
  }, 60_000);

  it('versions a natural-language revision and keeps the previous contract snapshot', async () => {
    const root = makeTempDir('aethera-contract-revision-');
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: () => {},
      onRenderReady: () => {},
      runEditorialResearch: async () => null,
    });

    const initial = await pipeline.start({ projectId: 'contract_revision', prompt: 'Vídeo de 5 minutos sobre sistemas de magia.', targetDurationSec: 300 });
    expect(initial.state).toBe('paused_pending_research');
    const revised = await pipeline.revise('contract_revision', 'reduza o humor e deixe a abertura mais rápida');

    expect(revised.contract?.revision).toBe(2);
    expect(revised.contractHistory).toHaveLength(1);
    expect(revised.contractHistory?.[0]?.revision).toBe(1);
    expect(revised.contractHistory?.[0]?.sourcePrompt).not.toContain('reduza o humor');
    expect(revised.prompt).toContain('reduza o humor');
    expect(revised.contract?.revisionReason).toContain('reduza o humor');
  }, 60_000);

  it('passes the active contract context to the configured script agent', async () => {
    const root = makeTempDir('aethera-contract-agent-');
    let agentInput: Record<string, unknown> | undefined;
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: () => {},
      onRenderReady: () => {},
      acquireExternalMedia: async () => null,
      generateAgentScript: async (input) => {
        agentInput = input as unknown as Record<string, unknown>;
        return {
          providerUsed: 'test-agent',
          beats: Array.from({ length: 6 }, (_, index) => ({
            stage: index === 0 ? 'hook' : index === 5 ? 'resolution' : 'progression',
            summary: `Fala de teste ${index + 1}.`,
          })),
        };
      },
    });

    const job = await pipeline.start({
      projectId: 'contract_agent',
      prompt: 'TOP 2 animes com sistemas de magia, em português brasileiro.',
      genre: 'top_list',
      format: 'youtube_16_9',
      targetDurationSec: 12,
      humorIntensity: 20,
      renderProfile: 'draft_540p',
      language: 'pt-BR',
      useNvenc: false,
    });

    expect(job.state).toBe('paused_pending_media');
    expect(agentInput?.['contractContext']).toMatchObject({
      revision: 1,
      controls: { targetDurationSec: 12, language: 'pt-BR' },
    });
    expect((agentInput?.['contractContext'] as { requirements: Array<{ category: string }> }).requirements.some((item) => item.category === 'narrative')).toBe(true);
  }, 60_000);

  it('passes the active contract context to editorial research before any dossier is accepted', async () => {
    const root = makeTempDir('aethera-contract-research-');
    let researchContext: Record<string, unknown> | undefined;
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: () => {},
      onRenderReady: () => {},
      runEditorialResearch: async (_interpretation, _signal, context) => {
        researchContext = context as unknown as Record<string, unknown>;
        return null;
      },
    });

    const job = await pipeline.start({ projectId: 'contract_research', prompt: 'Pesquise um ranking de animes', targetDurationSec: 12 });

    expect(job.state).toBe('paused_pending_research');
    expect(researchContext?.['contractContext']).toMatchObject({ revision: 1 });
  }, 60_000);
});
