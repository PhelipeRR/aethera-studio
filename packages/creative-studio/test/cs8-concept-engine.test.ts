import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  BrandKitManager,
  ConceptDrivenEngine,
  CreativeOrchestrator,
  CompositionPlanner,
  ExportService,
  LayeredDocumentEditor,
  LocalPythonAiAdapter,
  QualityGateService,
  SharpSvgCompositionEngine,
  VideoFrameAnalyzer,
  creativeConceptProposalSchema,
  type ReasoningEngineProvider,
} from '../src/index.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-cs8-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore transient Windows file lock
      }
    }
  }
});

const REAL_VIDEO_PATH = resolve(__dirname, '../../../artifacts/creative-studio-cs6/cyberpunk-2077-clip.mp4');
const CS8_ARTIFACTS_DIR = resolve(__dirname, '../../../artifacts/creative-studio-cs8');

describe('CS-8 — Concept-Driven Creative Engine', () => {
  it('ideates 3 distinct narrative concepts without requiring human characters, works with 1 engine, and rejects generic repeats', async () => {
    const storageRoot = makeTempDir();
    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const gate = new QualityGateService(engine);

    const singleProvider: ReasoningEngineProvider = {
      id: 'claude-code',
      isAvailable: async () => true,
      runPrompt: async () => ({ text: 'ok' }),
    };

    const conceptEngine = new ConceptDrivenEngine(ingestion, engine, gate, {
      providers: [singleProvider],
    });

    // Multi-topic validation: anime, documentary, and game
    const topics = [
      {
        title: 'Anime: Maldição do Selo',
        headline: 'O SELO PROIBIDO',
        prompt: 'Análise do episódio em que o selo antigo desperta na estação subterrânea',
        scriptText: 'Neste roteiro investigamos o despertar do selo proibido e a transformação da energia.',
      },
      {
        title: 'Documentário: Telescópio Profundo',
        headline: 'SINAIS DO ESPAÇO',
        prompt: 'Documentário sobre os sinais captados pelo telescópio espacial na nebulosa distante',
        scriptText: 'Astrônomos comparam as imagens antigas com os novos dados infravermelhos da nebulosa.',
      },
      {
        title: 'Jogo: Relíquia Oculta',
        headline: 'RELÍQUIA OCULTA',
        prompt: 'Guia mostrando a relíquia oculta, comparação normal vs aprimorada e combate em ação',
        scriptText: 'Veja o artefato secreto em detalhe, a evolução de dano e o poder em ação contra o chefe.',
      },
    ];

    for (const t of topics) {
      const { proposals, enginesUsed } = await conceptEngine.generateConceptLab({
        title: t.title,
        headline: t.headline,
        prompt: t.prompt,
        scriptText: t.scriptText,
      });
      expect(enginesUsed.length).toBeGreaterThanOrEqual(1);
      expect(proposals).toHaveLength(3);

      const archetypes = new Set(proposals.map((p) => p.concept.archetype));
      const blueprints = new Set(proposals.map((p) => p.concept.blueprint));
      expect(archetypes.size).toBe(3);
      expect(blueprints.size).toBe(3);

      for (const p of proposals) {
        expect(p.concept.usesHumanCharacter).toBe(false);
        expect(p.concept.editorialRationale.length).toBeGreaterThan(30);
        expect(p.preRenderCritique.passed).toBe(true);
        expect(p.audit.findings.filter((f) => f.severity === 'critical'), `${t.title} (${p.concept.label})`).toEqual([]);
        expect(p.postRenderCritique.criticNotes.join(' | ') && p.postRenderCritique.passed, `${t.title} (${p.concept.label}): ${p.postRenderCritique.criticNotes.join(' | ')}`).toBe(true);
        expect(p.audit.passed).toBe(true);
      }
    }

    // Visual Concept Critic rejects duplicate / generic concepts before rendering
    const duplicate = creativeConceptProposalSchema.parse({
      id: 'dup-1',
      label: 'A',
      title: 'Genérico Repetido 1',
      archetype: 'object_focus',
      blueprint: 'macro_center_object',
      focalSubject: 'Objeto genérico',
      visualNarrative: 'Descrição mínima sem conexão com o tema do vídeo.',
      emotion: 'mystery',
      usesHumanCharacter: false,
      textRole: 'minimal_complement',
      headlineText: 'INCRÍVEL',
      editorialRationale: 'Genérico',
      mediaRequirements: [
        {
          id: 'r1',
          role: 'hero_object',
          acquisitionMode: 'ai_generate',
          provenance: 'ai_generated',
          queryOrPrompt: 'generic object',
          requiresHuman: false,
        },
      ],
    });
    const duplicate2 = creativeConceptProposalSchema.parse({
      ...duplicate,
      id: 'dup-2',
      label: 'B',
      title: 'Genérico Repetido 2',
    });

    const critiques = conceptEngine.critiqueConceptsPreRender([duplicate, duplicate2], {
      prompt: 'Relíquia oculta e combate espacial',
      scriptText: 'Relíquia antiga encontrada na estação orbital.',
    });
    expect(critiques[0]?.isGenericOrWeak).toBe(true);
    expect(critiques[1]?.isGenericOrWeak).toBe(true);
    expect(critiques[1]?.rejectionReason).toBeTruthy();

    const replaced = conceptEngine.replaceRejectedConcept(duplicate2, [duplicate], {
      prompt: 'Relíquia oculta',
      scriptText: 'Relíquia antiga encontrada na estação orbital.',
    });
    expect(replaced.archetype).not.toBe(duplicate.archetype);
    expect(replaced.blueprint).not.toBe(duplicate.blueprint);
  });

  it('supports combining elements from different concepts, natural-language edits, and undo/redo', async () => {
    const storageRoot = makeTempDir();
    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const gate = new QualityGateService(engine);
    const conceptEngine = new ConceptDrivenEngine(ingestion, engine, gate);

    const lab = await conceptEngine.generateConceptLab({
      title: 'Teste Combinação',
      headline: 'PODER OCULTO',
      prompt: 'Análise do poder oculto e transformação completa',
      scriptText: 'Mostramos o artefato oculto e a comparação antes e depois.',
    });
    expect(lab.proposals).toHaveLength(3);

    const baseDoc = lab.proposals[0]!.document;
    const donorDoc = lab.proposals[1]!.document;
    const combined = conceptEngine.combineConceptElements({
      baseDocument: baseDoc,
      donorDocument: donorDoc,
      takeFromDonor: ['typography', 'vfx'],
    });
    expect(combined.title).toContain('Mix');
    expect(Object.keys(combined.assetManifest).length).toBeGreaterThanOrEqual(1);

    const editor = new LayeredDocumentEditor(combined);
    const editRes = editor.applyLocalizedPromptEdit('Mude o título para "NOVO PODER"');
    expect(editRes.applied).toBe(true);
    const afterEdit = editor.getDocument();
    const headlineAfter = afterEdit.layers.find((l) => l.type === 'text' && l.role === 'headline');
    expect(headlineAfter?.type === 'text' ? headlineAfter.text : '').toBe('NOVO PODER');

    const undone = editor.undo();
    expect(undone).not.toBeNull();
    const headlineUndone = undone!.layers.find((l) => l.type === 'text' && l.role === 'headline');
    expect(headlineUndone?.type === 'text' ? headlineUndone.text : '').toBe('PODER OCULTO');
  });

  it('runs real E2E on cyberpunk-2077-clip.mp4 + RTX 4060 Ti generating 3 genuinely distinct concept thumbnails', async () => {
    expect(existsSync(REAL_VIDEO_PATH)).toBe(true);
    const ai = new LocalPythonAiAdapter();
    expect(await ai.isAvailable()).toBe(true);

    mkdirSync(CS8_ARTIFACTS_DIR, { recursive: true });
    const storageRoot = makeTempDir();
    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion, ai);
    const gate = new QualityGateService(engine);
    const exporter = new ExportService(engine);
    const analyzer = new VideoFrameAnalyzer(ingestion);
    const planner = new CompositionPlanner();

    // Extract real gameplay frames from cyberpunk-2077-clip.mp4
    const analysis = await analyzer.analyzeAndExtractFrames({
      videoPath: REAL_VIDEO_PATH,
      sampleCount: 4,
      sceneHints: [
        { timestampSec: 1.0, label: 'exploração inicial', emotion: 'tension' },
        { timestampSec: 2.5, label: 'ativação de cyberware em ação', emotion: 'adrenaline' },
      ],
    });
    expect(analysis.candidates.length).toBeGreaterThanOrEqual(2);

    const brandManager = new BrandKitManager();
    const kit = brandManager.create({
      channelName: 'CYBEREDGE BR',
      slogan: 'BUILDS, SEGREDOS E ANÁLISES SEM SPOILERS',
      palette: {
        primary: '#00F0FF',
        secondary: '#FF006E',
        accent: '#FACC15',
        background: '#070B14',
        surface: '#111827',
        text: '#FFFFFF',
      },
    });

    const conceptEngine = new ConceptDrivenEngine(ingestion, engine, gate, {
      imageAdapter: ai,
    });
    const orchestrator = new CreativeOrchestrator([], planner, gate);

    const lab = await orchestrator.orchestrateConceptThumbnailLab(conceptEngine, {
      title: 'Cyberpunk 2077 — Cyberwares',
      headline: 'CYBERWARE SECRETO',
      prompt: 'Cyberpunk 2077 implante cibernético secreto, comparação normal vs aprimorado e poder em ação',
      scriptText:
        'Neste vídeo mostramos o implante cibernético oculto em close-up, a comparação antes e depois da habilidade aprimorada e o poder em ação no gameplay real.',
      brandKit: kit,
      extractedFrames: analysis.candidates,
      sceneHints: [
        { timestampSec: 1.0, label: 'estado normal', emotion: 'calm' },
        { timestampSec: 2.5, label: 'poder cibernético em ação', emotion: 'adrenaline' },
      ],
    });

    expect(lab.proposals).toHaveLength(3);
    const [propA, propB, propC] = lab.proposals;
    expect(propA!.concept.archetype).toBe('object_focus');
    expect(propB!.concept.archetype).toBe('before_after_comparison');
    expect(propC!.concept.archetype).toBe('action_moment');

    // Verify provenance honesty: C uses real_video_frame, A uses ai_generated
    expect(propA!.acquiredMedia[0]?.provenance).toBe('ai_generated');
    expect(propC!.acquiredMedia[0]?.provenance).toBe('real_video_frame');

    const outFiles = [
      join(CS8_ARTIFACTS_DIR, 'cyberpunk-2077-concept-A-implante-secreto.png'),
      join(CS8_ARTIFACTS_DIR, 'cyberpunk-2077-concept-B-antes-e-depois.png'),
      join(CS8_ARTIFACTS_DIR, 'cyberpunk-2077-concept-C-poder-em-acao.png'),
    ];

    for (let i = 0; i < lab.proposals.length; i += 1) {
      const p = lab.proposals[i]!;
      expect(p.audit.passed, `Concept ${p.concept.label} audit`).toBe(true);
      expect(p.postRenderCritique.passed, `Concept ${p.concept.label} post-render critic`).toBe(true);
      await exporter.exportProject(p.document, {
        outputPath: outFiles[i]!,
        format: 'png',
      });
      expect(existsSync(outFiles[i]!)).toBe(true);
      expect(readFileSync(outFiles[i]!).byteLength).toBeGreaterThan(20_000);
    }

    // Save editorial concept report JSON for traceability
    writeFileSync(
      join(CS8_ARTIFACTS_DIR, 'concepts-report.json'),
      JSON.stringify(
        lab.proposals.map((p) => ({
          concept: p.concept,
          provenance: p.acquiredMedia.map((m) => ({ role: m.role, provenance: m.provenance, description: m.description })),
          preRenderCritique: p.preRenderCritique,
          postRenderCritique: p.postRenderCritique,
          auditScore: p.audit.scorecard,
        })),
        null,
        2,
      ),
    );
  }, 240_000);
});
