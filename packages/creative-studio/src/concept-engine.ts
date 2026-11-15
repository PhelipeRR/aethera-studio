import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { AssetIngestionService } from './asset-ingestion.js';
import type { ExternalImageAdapter, SharpSvgCompositionEngine } from './image-generation-adapter.js';
import type { QualityGateService } from './quality-gate.js';
import {
  ART_SPECIFICATIONS,
  CREATIVE_PROJECT_SCHEMA_VERSION,
  creativeConceptProposalSchema,
  creativeProjectDocumentSchema,
  visualConceptCritiqueSchema,
  type BrandKit,
  type ConceptBlueprint,
  type ConceptMediaRequirement,
  type ConceptVisualArchetype,
  type CreativeConceptProposal,
  type CreativeLayer,
  type CreativeProjectDocument,
  type ManagedAssetRef,
  type MediaProvenance,
  type QualityAuditReport,
  type VisualConceptCritique,
} from './schemas.js';
import type { ExtractedFrameCandidate, VideoSceneHint } from './video-frame-analyzer.js';
import type { ReasoningEngineProvider } from './creative-orchestrator.js';

export interface ConceptEngineInput {
  title?: string;
  headline?: string;
  prompt: string;
  scriptText?: string;
  brandKit?: BrandKit | null;
  sceneHints?: VideoSceneHint[];
  extractedFrames?: ExtractedFrameCandidate[];
  watermarkAsset?: ManagedAssetRef | null;
  sourceCinemaProjectId?: string;
  sourceVideoAssetId?: string;
}

export interface AcquiredMediaItem {
  requirementId: string;
  role: ConceptMediaRequirement['role'];
  asset: ManagedAssetRef;
  provenance: MediaProvenance;
  description: string;
}

export interface ConceptLabProposalResult {
  concept: CreativeConceptProposal;
  preRenderCritique: VisualConceptCritique;
  postRenderCritique: VisualConceptCritique;
  acquiredMedia: AcquiredMediaItem[];
  document: CreativeProjectDocument;
  audit: QualityAuditReport;
  rejectionHistory: Array<{ rejectedTitle: string; reason: string }>;
}

interface ExtractedScriptEntities {
  keywords: string[];
  primaryObject: string;
  actionPhrase: string;
  comparisonPair: [string, string];
  shortHeadline: string;
  kicker: string;
}

const STOP_WORDS = new Set([
  'thumbnail',
  'banner',
  'avatar',
  'canal',
  'video',
  'vídeo',
  'sobre',
  'para',
  'como',
  'com',
  'alto',
  'impacto',
  'visual',
  'estilo',
  'neste',
  'nesta',
  'nesse',
  'nessa',
  'desse',
  'dessa',
  'esse',
  'essa',
  'este',
  'esta',
  'aqui',
  'onde',
  'quando',
  'porque',
  'tudo',
  'mais',
  'muito',
  'melhor',
  'melhores',
  'revelamos',
  'mostramos',
  'apresentamos',
  'explicamos',
  'confira',
  'saiba',
  'entre',
  'antes',
  'depois',
  'about',
  'this',
  'that',
  'with',
  'from',
  'into',
]);

export function extractNarrativeEntities(input: ConceptEngineInput): ExtractedScriptEntities {
  const source = `${input.headline ?? ''} ${input.title ?? ''} ${input.prompt} ${input.scriptText ?? ''} ${(input.sceneHints ?? []).map((s) => `${s.label ?? ''} ${s.narrationExcerpt ?? ''} ${s.emotion ?? ''}`).join(' ')}`;
  const tokens = source
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      unique.push(t);
    }
  }

  const lower = source.toLowerCase();
  const primaryObject = unique[0] ?? 'artefato central';
  const secondaryTerm = unique[1] ?? 'mecanismo';
  const actionPhrase =
    /combate|batalha|luta|ação|acao|poder|habilidade|skill|boss|ataque/.test(lower)
      ? `${primaryObject} em ação`
      : /transforma|evolu|upgrade|aprimor|mudan/.test(lower)
        ? `transformação com ${primaryObject}`
        : /hist[oó]ria|arquivo|origem|document|caso|mist[eé]rio/.test(lower)
          ? `evidência oculta de ${primaryObject}`
          : `${primaryObject} e ${secondaryTerm}`;

  const comparisonPair: [string, string] = /mito|verdade|realidade|teoria/.test(lower)
    ? ['MITO', 'REALIDADE']
    : /antes|depois|normal|aprimor|upgrade|evolu/.test(lower)
      ? ['NORMAL', 'APRIMORADO']
      : ['ANTES', 'DEPOIS'];

  const headlineBase =
    input.headline?.trim() ||
    unique
      .slice(0, 2)
      .join(' ')
      .toUpperCase() ||
    'FOCO PRINCIPAL';

  const kicker = /segredo|ocult|mist[eé]rio|revel/.test(lower)
    ? 'REVELADO'
    : /guia|build|tutorial|dica/.test(lower)
      ? 'GUIA VISUAL'
      : /hist[oó]ria|document|arquivo/.test(lower)
        ? 'INVESTIGAÇÃO'
        : /an[aá]lise|arco|epis[oó]dio|review/.test(lower)
          ? 'ANÁLISE'
          : unique[0]?.toUpperCase() ?? 'DESTAQUE';

  return {
    keywords: unique.slice(0, 8),
    primaryObject,
    actionPhrase,
    comparisonPair,
    shortHeadline: headlineBase.toUpperCase().slice(0, 32),
    kicker,
  };
}

export class ConceptDrivenEngine {
  constructor(
    private readonly ingestion: AssetIngestionService,
    private readonly engine: SharpSvgCompositionEngine,
    private readonly qualityGate: QualityGateService,
    private readonly options?: {
      imageAdapter?: ExternalImageAdapter | null;
      providers?: ReasoningEngineProvider[];
    },
  ) {}

  /**
   * 1. Concept Ideation:
   * Uses available reasoning engines (4 engines down to 1, plus deterministic fallback)
   * to generate 3 narratively independent concepts — without requiring a human character.
   */
  async ideateConcepts(input: ConceptEngineInput): Promise<{
    concepts: CreativeConceptProposal[];
    enginesUsed: string[];
  }> {
    const entities = extractNarrativeEntities(input);
    const enginesUsed: string[] = [];
    const availableProviders: ReasoningEngineProvider[] = [];

    for (const p of this.options?.providers ?? []) {
      try {
        if (await p.isAvailable()) availableProviders.push(p);
      } catch {
        // ignore unavailable provider
      }
    }

    let llmConcepts: Partial<Record<'A' | 'B' | 'C', Partial<CreativeConceptProposal>>> | null = null;
    if (availableProviders.length > 0) {
      const primary = availableProviders[0]!;
      enginesUsed.push(primary.id);
      try {
        const promptForDirector = [
          `[Aethera Concept Ideation]`,
          `Title: ${input.title ?? ''}`,
          `Prompt: ${input.prompt}`,
          `Script: ${(input.scriptText ?? '').slice(0, 600)}`,
          `Scenes: ${(input.sceneHints ?? []).map((s) => `${s.timestampSec}s:${s.label ?? s.narrationExcerpt ?? s.emotion ?? ''}`).join(' | ')}`,
          `Generate 3 genuinely different thumbnail narrative concepts (A=object_focus without human, B=before_after_comparison, C=action_moment/real_scene). Return compact JSON.`,
        ].join('\n');
        const res = await primary.runPrompt(promptForDirector);
        const jsonMatch = res.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          if (Array.isArray(parsed['concepts']) && parsed['concepts'].length >= 3) {
            llmConcepts = {
              A: parsed['concepts'][0] as Partial<CreativeConceptProposal>,
              B: parsed['concepts'][1] as Partial<CreativeConceptProposal>,
              C: parsed['concepts'][2] as Partial<CreativeConceptProposal>,
            };
          }
        }
      } catch {
        // fallback cleanly to structured local concept ideation
      }
    }

    if (enginesUsed.length === 0) {
      enginesUsed.push('local-concept-director');
    }

    const topicFocus = entities.keywords.slice(0, 3).join(' ') || input.prompt.slice(0, 48);
    const hasRealFrames = (input.extractedFrames?.length ?? 0) > 0;
    const bestFrame = input.extractedFrames?.[0];
    const secondFrame = input.extractedFrames?.[1] ?? bestFrame;

    // Concept A: Object / Artifact Close-Up (explicitly NO human character required)
    const conceptA = creativeConceptProposalSchema.parse({
      id: `concept-A-${randomUUID().slice(0, 8)}`,
      label: 'A',
      title: llmConcepts?.A?.title || `O Segredo de ${entities.primaryObject}`,
      archetype: 'object_focus',
      blueprint: 'macro_center_object',
      focalSubject:
        llmConcepts?.A?.focalSubject ||
        `Close-up macro de componente/objeto emblemático ligado a ${topicFocus}, isolado com iluminação dramática`,
      visualNarrative:
        llmConcepts?.A?.visualNarrative ||
        `O objeto central ligado a ${entities.primaryObject} aparece em destaque dramático com energia e detalhes reveladores; o texto mínimo apenas confirma o gancho sem precisar explicar tudo.`,
      emotion: 'mystery',
      usesHumanCharacter: false,
      textRole: 'minimal_complement',
      headlineText: (llmConcepts?.A?.headlineText || entities.shortHeadline).slice(0, 48),
      kickerText: entities.kicker.slice(0, 32),
      editorialRationale:
        llmConcepts?.A?.editorialRationale ||
        `Conceito A evita repetir personagem genérico: coloca o elemento físico/técnico central de "${topicFocus}" como protagonista em plano macro dramático, comunicando imediatamente o tema do roteiro.`,
      mediaRequirements: [
        {
          id: 'req-A-object',
          role: 'hero_object',
          acquisitionMode: 'ai_generate',
          provenance: 'ai_generated',
          queryOrPrompt: `dramatic macro studio close-up of a mysterious intricate iconic object representing ${topicFocus}, glowing core details, moody rim lighting on dark atmospheric background, high contrast focal point, no people, no faces, no text`,
          requiresHuman: false,
        },
      ],
    });

    // Concept B: Visual Before vs. After / Contrast Comparison
    const [leftLbl, rightLbl] = entities.comparisonPair;
    const conceptB = creativeConceptProposalSchema.parse({
      id: `concept-B-${randomUUID().slice(0, 8)}`,
      label: 'B',
      title: llmConcepts?.B?.title || `${leftLbl} vs ${rightLbl}: ${entities.primaryObject}`,
      archetype: 'before_after_comparison',
      blueprint: 'split_comparison',
      focalSubject:
        llmConcepts?.B?.focalSubject ||
        `Comparação visual lado a lado contrastando estado ${leftLbl.toLowerCase()} versus estado ${rightLbl.toLowerCase()} em ${topicFocus}`,
      visualNarrative:
        llmConcepts?.B?.visualNarrative ||
        `Tela dividida contrastando visualmente o estado comum/inicial à esquerda (dessaturado e contido) contra o estado aprimorado/intenso à direita (vibrante e carregado de efeito), criando curiosidade imediata.`,
      emotion: 'contrast',
      usesHumanCharacter: false,
      textRole: 'comparison_labels',
      headlineText: (llmConcepts?.B?.headlineText || entities.shortHeadline).slice(0, 48),
      leftComparisonLabel: leftLbl,
      rightComparisonLabel: rightLbl,
      editorialRationale:
        llmConcepts?.B?.editorialRationale ||
        `Conceito B traduz o roteiro em contraste visual direto (${leftLbl} vs ${rightLbl}), permitindo que o espectador entenda a transformação/diferença de ${entities.primaryObject} em menos de 1 segundo.`,
      mediaRequirements: [
        {
          id: 'req-B-left',
          role: 'comparison_left',
          acquisitionMode: hasRealFrames ? 'video_frame' : 'ai_generate',
          provenance: hasRealFrames ? 'real_video_frame' : 'ai_generated',
          queryOrPrompt: `restrained standard unenhanced scene of ${topicFocus}, muted desaturated cool lighting, calm baseline state, no text`,
          requiresHuman: false,
          ...(secondFrame ? { preferredTimestampSec: secondFrame.timestampSec } : {}),
        },
        {
          id: 'req-B-right',
          role: 'comparison_right',
          acquisitionMode: 'ai_generate',
          provenance: 'ai_generated',
          queryOrPrompt: `overcharged upgraded high-energy transformation scene of ${topicFocus}, glowing neon energy arcs, intense dynamic lighting and visual power surge, no text`,
          requiresHuman: false,
        },
      ],
    });

    // Concept C: Real Video Action Moment / Environmental Story as Protagonist
    const conceptC = creativeConceptProposalSchema.parse({
      id: `concept-C-${randomUUID().slice(0, 8)}`,
      label: 'C',
      title: llmConcepts?.C?.title || `${entities.actionPhrase} em Cena Real`,
      archetype: hasRealFrames ? 'action_moment' : 'transformation_scene',
      blueprint: 'fullscreen_action_hud',
      focalSubject:
        llmConcepts?.C?.focalSubject ||
        (hasRealFrames
          ? `Frame real de maior impacto do vídeo (${bestFrame?.timestampSec.toFixed(1)}s) com o efeito/ação como protagonista`
          : `Cena dinâmica de transformação/ação centrada em ${topicFocus}`),
      visualNarrative:
        llmConcepts?.C?.visualNarrative ||
        (hasRealFrames
          ? `Usa diretamente o momento real capturado do vídeo produzido como imagem principal, realçando o ponto de ação com iluminação cinematográfica e texto enxuto que não cobre a cena.`
          : `Cena ampla de ação/acontecimento onde o ambiente e o efeito visual contam o clímax do roteiro sem depender de busto recortado.`),
      emotion: 'adrenaline',
      usesHumanCharacter: false,
      textRole: 'minimal_complement',
      headlineText: (llmConcepts?.C?.headlineText || entities.shortHeadline).slice(0, 48),
      kickerText: hasRealFrames ? 'CENA REAL' : entities.kicker.slice(0, 32),
      editorialRationale:
        llmConcepts?.C?.editorialRationale ||
        `Conceito C prioriza autenticidade: coloca o momento real de ${entities.actionPhrase} em tela cheia com mínimo de texto complementar, diferenciando-se radicalmente do close-up de objeto (A) e do comparativo (B).`,
      mediaRequirements: [
        {
          id: 'req-C-action',
          role: 'primary_scene',
          acquisitionMode: hasRealFrames ? 'video_frame' : 'ai_generate',
          provenance: hasRealFrames ? 'real_video_frame' : 'ai_generated',
          queryOrPrompt: `wide dynamic cinematic action climax illustrating ${topicFocus}, dramatic motion energy and volumetric depth, no text`,
          requiresHuman: false,
          ...(bestFrame ? { preferredTimestampSec: bestFrame.timestampSec } : {}),
        },
      ],
    });

    return {
      concepts: [conceptA, conceptB, conceptC],
      enginesUsed,
    };
  }

  /**
   * 3a. Pre-Render Visual Concept Critic:
   * Rejects generic, repetitive, or script-disconnected concepts BEFORE rendering.
   */
  critiqueConceptsPreRender(
    concepts: CreativeConceptProposal[],
    input: ConceptEngineInput,
  ): VisualConceptCritique[] {
    const entities = extractNarrativeEntities(input);
    const seenArchetypes = new Set<ConceptVisualArchetype>();
    const seenBlueprints = new Set<ConceptBlueprint>();
    const seenSubjects = new Set<string>();

    return concepts.map((c) => {
      const notes: string[] = [];
      let narrativeRelevance = 88;
      let originality = 92;
      let scriptCoherence = 90;
      let isGenericOrWeak = false;
      let rejectionReason: string | undefined;

      const combinedConceptText = `${c.title} ${c.focalSubject} ${c.visualNarrative} ${c.editorialRationale} ${c.headlineText}`.toLowerCase();
      const matchedKeywords = entities.keywords.filter((k) => combinedConceptText.includes(k.toLowerCase()));
      if (entities.keywords.length > 0 && matchedKeywords.length === 0) {
        narrativeRelevance = 32;
        scriptCoherence = 30;
        isGenericOrWeak = true;
        rejectionReason = `Conceito "${c.title}" é semanticamente genérico e não incorpora elementos do roteiro (${entities.keywords.slice(0, 3).join(', ')}).`;
        notes.push(rejectionReason);
      }

      if (seenArchetypes.has(c.archetype) || seenBlueprints.has(c.blueprint)) {
        originality = 30;
        isGenericOrWeak = true;
        rejectionReason = `Conceito "${c.title}" repete arquétipo (${c.archetype}) ou blueprint (${c.blueprint}) de outra proposta.`;
        notes.push(rejectionReason);
      }
      seenArchetypes.add(c.archetype);
      seenBlueprints.add(c.blueprint);

      const subjKey = c.focalSubject.trim().toLowerCase().slice(0, 40);
      if (seenSubjects.has(subjKey)) {
        originality = 25;
        isGenericOrWeak = true;
        rejectionReason = `Conceito "${c.title}" reutiliza o mesmo sujeito focal de outra proposta.`;
        notes.push(rejectionReason);
      }
      seenSubjects.add(subjKey);

      if (c.visualNarrative.trim().length < 25) {
        narrativeRelevance = Math.min(narrativeRelevance, 45);
        isGenericOrWeak = true;
        rejectionReason = `Narrativa visual insuficiente para explicar a proposta sem depender só do texto.`;
        notes.push(rejectionReason);
      }

      if (!isGenericOrWeak) {
        notes.push(`Conceito distinto (${c.archetype}/${c.blueprint}) com foco claro em "${c.focalSubject.slice(0, 60)}".`);
      }

      return visualConceptCritiqueSchema.parse({
        conceptId: c.id,
        stage: 'pre_render',
        passed: !isGenericOrWeak,
        isGenericOrWeak,
        narrativeRelevanceScore: narrativeRelevance,
        originalityScore: originality,
        compositionScore: 86,
        legibilityScore: 88,
        focalPointScore: 90,
        scriptCoherenceScore: scriptCoherence,
        ...(rejectionReason ? { rejectionReason } : {}),
        criticNotes: notes,
      });
    });
  }

  /**
   * Ensures any rejected generic concept is replaced by a distinct narrative archetype before acquisition.
   */
  replaceRejectedConcept(
    rejected: CreativeConceptProposal,
    existing: CreativeConceptProposal[],
    input: ConceptEngineInput,
  ): CreativeConceptProposal {
    const entities = extractNarrativeEntities(input);
    const usedArchetypes = new Set(existing.filter((x) => x.id !== rejected.id).map((x) => x.archetype));
    const usedBlueprints = new Set(existing.filter((x) => x.id !== rejected.id).map((x) => x.blueprint));

    const fallbackOrder: Array<{ archetype: ConceptVisualArchetype; blueprint: ConceptBlueprint }> = [
      { archetype: 'mystery_reveal', blueprint: 'mystery_spotlight' },
      { archetype: 'object_focus', blueprint: 'macro_center_object' },
      { archetype: 'before_after_comparison', blueprint: 'split_comparison' },
      { archetype: 'environmental_story', blueprint: 'asymmetric_story' },
    ];
    const picked =
      fallbackOrder.find((cand) => !usedArchetypes.has(cand.archetype) && !usedBlueprints.has(cand.blueprint)) ??
      fallbackOrder[0]!;

    const topicFocus = entities.keywords.slice(0, 3).join(' ') || entities.primaryObject;
    return creativeConceptProposalSchema.parse({
      ...rejected,
      id: `concept-${rejected.label}-rebuilt-${randomUUID().slice(0, 6)}`,
      title: `Revelação: ${entities.primaryObject}`,
      archetype: picked.archetype,
      blueprint: picked.blueprint,
      focalSubject: `Elemento-chave de ${topicFocus} sob holofote dramático e contraste narrativo`,
      visualNarrative: `Substitui proposta genérica por cena focada em ${topicFocus}, destacando visualmente o ponto de virada do roteiro.`,
      usesHumanCharacter: false,
      headlineText: entities.shortHeadline,
      editorialRationale: `Proposta reconstruída pelo Visual Concept Critic para garantir originalidade e ligação direta com ${topicFocus}.`,
      mediaRequirements: [
        {
          id: `req-${rejected.label}-rebuilt`,
          role: 'hero_object',
          acquisitionMode: 'ai_generate',
          provenance: 'ai_generated',
          queryOrPrompt: `cinematic focal spotlight scene of ${topicFocus}, dramatic contrast, clean silhouette, no text`,
          requiresHuman: false,
        },
      ],
    });
  }

  /**
   * 2. Concept-Specific Asset Acquisition:
   * Acquires real video frames first when requested & available, or AI-generated concept assets,
   * strictly preserving provenance (never labeling AI images as real video frames).
   */
  async acquireConceptMedia(
    concept: CreativeConceptProposal,
    input: ConceptEngineInput,
  ): Promise<AcquiredMediaItem[]> {
    const acquired: AcquiredMediaItem[] = [];
    const frames = input.extractedFrames ?? [];
    const adapter = this.options?.imageAdapter;
    const adapterAvailable = adapter ? await adapter.isAvailable().catch(() => false) : false;

    for (let idx = 0; idx < concept.mediaRequirements.length; idx += 1) {
      const req = concept.mediaRequirements[idx]!;
      let chosenAsset: ManagedAssetRef | null = null;
      let actualProvenance: MediaProvenance = req.provenance;
      let desc = req.queryOrPrompt;

      if ((req.acquisitionMode === 'video_frame' || req.acquisitionMode === 'video_frame_crop') && frames.length > 0) {
        const match =
          req.preferredTimestampSec !== undefined
            ? frames.reduce((best, cur) =>
                Math.abs(cur.timestampSec - req.preferredTimestampSec!) <
                Math.abs(best.timestampSec - req.preferredTimestampSec!)
                  ? cur
                  : best,
              )
            : frames[idx % frames.length]!;
        chosenAsset = match.asset;
        actualProvenance = 'real_video_frame';
        desc = `Frame real extraído em ${match.timestampSec.toFixed(2)}s (impactScore=${match.impactScore})`;
      } else if (req.acquisitionMode === 'brand_reference' && input.brandKit?.mascotAssetId) {
        const ref = input.brandKit.assetManifest[input.brandKit.mascotAssetId] ?? null;
        if (ref) {
          chosenAsset = ref;
          actualProvenance = 'brand_asset';
          desc = `Referência persistente do Brand Kit (${input.brandKit.channelName})`;
        }
      }

      if (!chosenAsset && adapter && adapter.generateImage && adapterAvailable) {
        try {
          const genBuf = await adapter.generateImage({
            prompt: req.queryOrPrompt,
            width: req.role === 'comparison_left' || req.role === 'comparison_right' ? 640 : 1024,
            height: req.role === 'comparison_left' || req.role === 'comparison_right' ? 720 : 576,
          });
          chosenAsset = await this.ingestion.ingestBuffer({
            buffer: genBuf,
            kind: 'image',
            extension: 'png',
            originalName: `${concept.id}-${req.role}.png`,
          });
          actualProvenance = 'ai_generated';
          desc = `Gerado por IA para o conceito "${concept.title}"`;
        } catch {
          // fall through to local fallback render
        }
      }

      if (!chosenAsset) {
        // Deterministic local procedural canvas if no AI/video frame is available
        const isWarm = req.role === 'comparison_right' || concept.label === 'A';
        const w = req.role === 'comparison_left' || req.role === 'comparison_right' ? 640 : 1024;
        const h = req.role === 'comparison_left' || req.role === 'comparison_right' ? 720 : 576;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
          <defs>
            <radialGradient id="g" cx="50%" cy="50%" r="68%">
              <stop offset="0%" stop-color="${isWarm ? '#FACC15' : '#38BDF8'}" stop-opacity="0.95"/>
              <stop offset="45%" stop-color="${isWarm ? '#E11D48' : '#1D4ED8'}" stop-opacity="0.7"/>
              <stop offset="100%" stop-color="#0B1120" stop-opacity="1"/>
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="#0B1120"/>
          <rect width="100%" height="100%" fill="url(#g)"/>
          <circle cx="${Math.round(w / 2)}" cy="${Math.round(h / 2)}" r="${Math.round(Math.min(w, h) * 0.28)}" fill="${isWarm ? '#F59E0B' : '#0EA5E9'}" fill-opacity="0.35" stroke="${isWarm ? '#FEF08A' : '#BAE6FD'}" stroke-width="10"/>
          <rect x="${Math.round(w * 0.15)}" y="${Math.round(h * 0.18)}" width="${Math.round(w * 0.7)}" height="${Math.round(h * 0.12)}" rx="12" fill="#FFFFFF" fill-opacity="0.16"/>
        </svg>`;
        const fallbackBuf = await sharp(Buffer.from(svg)).png().toBuffer();
        chosenAsset = await this.ingestion.ingestBuffer({
          buffer: fallbackBuf,
          kind: 'image',
          extension: 'png',
          originalName: `${concept.id}-${req.role}-procedural.png`,
        });
        actualProvenance = 'ai_generated';
        desc = `Composição local de fallback para ${req.role}`;
      }

      acquired.push({
        requirementId: req.id,
        role: req.role,
        asset: chosenAsset,
        provenance: actualProvenance,
        description: desc,
      });
    }

    return acquired;
  }

  /**
   * Builds a fully editable layered CreativeProjectDocument tailored to the concept's blueprint.
   */
  buildConceptDocument(
    concept: CreativeConceptProposal,
    acquired: AcquiredMediaItem[],
    input: ConceptEngineInput,
  ): CreativeProjectDocument {
    const spec = ART_SPECIFICATIONS.thumbnail;
    const now = new Date().toISOString();
    const id = `creative-thumbnail-${randomUUID().slice(0, 10)}`;
    const palette = input.brandKit?.palette ?? {
      primary: '#00F0FF',
      secondary: '#FF006E',
      accent: '#FACC15',
      background: '#070B14',
      surface: '#111827',
      text: '#FFFFFF',
    };
    const typography = input.brandKit?.typography ?? {
      headingFont: 'Arial Black',
      bodyFont: 'Segoe UI',
      titleWeight: 900,
      strokeColor: '#000000',
      shadowColor: '#000000CC',
    };

    const assetManifest: Record<string, ManagedAssetRef> = {};
    for (const item of acquired) {
      assetManifest[item.asset.id] = item.asset;
    }
    if (input.watermarkAsset) {
      assetManifest[input.watermarkAsset.id] = input.watermarkAsset;
    }

    const layers: CreativeLayer[] = [];

    if (concept.blueprint === 'split_comparison') {
      const leftMedia = acquired.find((a) => a.role === 'comparison_left') ?? acquired[0]!;
      const rightMedia = acquired.find((a) => a.role === 'comparison_right') ?? acquired[acquired.length - 1]!;

      layers.push(
        {
          id: 'bg-comparison-base',
          type: 'background',
          name: 'Base Comparativa',
          zIndex: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          source: 'color',
          fillColor: '#050811',
          gradientAngleDeg: 90,
          transform: { x: 0, y: 0, width: spec.width, height: spec.height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'subject-left-before',
          type: 'subject',
          name: `Comparação Esquerda (${leftMedia.provenance})`,
          zIndex: 1,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          assetId: leftMedia.asset.id,
          removeBackground: false,
          cutoutMethod: 'none',
          fitMode: 'cover',
          transform: { x: 0, y: 0, width: 636, height: 720, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'colorGrade', enabled: true, brightness: 0.78, contrast: 1.05, saturation: 0.55 }],
        },
        {
          id: 'subject-right-after',
          type: 'subject',
          name: `Comparação Direita (${rightMedia.provenance})`,
          zIndex: 1,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          assetId: rightMedia.asset.id,
          removeBackground: false,
          cutoutMethod: 'none',
          fitMode: 'cover',
          transform: { x: 644, y: 0, width: 636, height: 720, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'colorGrade', enabled: true, brightness: 1.02, contrast: 1.25, saturation: 1.3 }],
        },
        {
          id: 'split-divider',
          type: 'shape',
          name: 'Divisor Visual Antes/Depois',
          zIndex: 2,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          shapeKind: 'rect',
          fillColor: palette.accent,
          strokeWidth: 0,
          borderRadius: 0,
          transform: { x: 636, y: 0, width: 8, height: 720, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'label-before',
          type: 'text',
          role: 'kicker',
          name: 'Rótulo Antes',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: concept.leftComparisonLabel ?? 'ANTES',
          fontFamily: typography.headingFont,
          fontSize: 34,
          fontWeight: 900,
          color: '#FFFFFF',
          strokeColor: '#000000',
          strokeWidth: 0,
          align: 'center',
          letterSpacing: 3,
          lineHeight: 1.1,
          uppercase: true,
          pillColor: '#334155',
          pillRadius: 8,
          transform: { x: 48, y: 40, width: 240, height: 56, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'label-after',
          type: 'text',
          role: 'kicker',
          name: 'Rótulo Depois',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: concept.rightComparisonLabel ?? 'DEPOIS',
          fontFamily: typography.headingFont,
          fontSize: 34,
          fontWeight: 900,
          color: '#070B14',
          strokeColor: '#070B14',
          strokeWidth: 0,
          align: 'center',
          letterSpacing: 3,
          lineHeight: 1.1,
          uppercase: true,
          pillColor: palette.accent,
          pillRadius: 8,
          transform: { x: 992, y: 40, width: 240, height: 56, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'title-comparison',
          type: 'text',
          role: 'headline',
          name: 'Título Comparativo Complementar',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: concept.headlineText,
          fontFamily: typography.headingFont,
          fontSize: 72,
          fontWeight: typography.titleWeight,
          color: '#FFFFFF',
          strokeColor: '#000000',
          strokeWidth: 9,
          align: 'center',
          letterSpacing: 2,
          lineHeight: 1.05,
          uppercase: true,
          transform: { x: 140, y: 568, width: 1000, height: 118, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 6, blur: 16, color: '#000000EE' }],
        },
      );
    } else if (concept.blueprint === 'fullscreen_action_hud') {
      const actionMedia = acquired[0]!;
      layers.push(
        {
          id: 'bg-action-scene',
          type: 'background',
          name: `Cena Real Protagonista (${actionMedia.provenance})`,
          zIndex: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          assetId: actionMedia.asset.id,
          source: 'asset',
          fillColor: palette.background,
          gradientAngleDeg: 180,
          blurRadius: 0,
          brightness: 0.96,
          transform: { x: 0, y: 0, width: spec.width, height: spec.height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [
            { kind: 'colorGrade', enabled: true, brightness: 0.98, contrast: 1.18, saturation: 1.16 },
            { kind: 'vignette', enabled: true, strength: 0.42, color: '#000000' },
          ],
        },
        {
          id: 'vfx-action-highlight',
          type: 'vfx',
          name: 'Realce de Ação',
          zIndex: 1,
          visible: true,
          locked: false,
          opacity: 0.45,
          blendMode: 'screen',
          preset: 'light_leak',
          primaryColor: palette.primary,
          secondaryColor: palette.secondary,
          intensity: 0.55,
          transform: { x: 0, y: 0, width: spec.width, height: spec.height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'kicker-action',
          type: 'text',
          role: 'kicker',
          name: 'Tag de Ação',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: concept.kickerText ?? 'EM AÇÃO',
          fontFamily: typography.headingFont,
          fontSize: 28,
          fontWeight: 900,
          color: '#070B14',
          strokeColor: '#070B14',
          strokeWidth: 0,
          align: 'left',
          letterSpacing: 3,
          lineHeight: 1.1,
          uppercase: true,
          pillColor: palette.primary,
          pillRadius: 8,
          transform: { x: 56, y: 486, width: 320, height: 48, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'title-action',
          type: 'text',
          role: 'headline',
          name: 'Título Complementar de Ação',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: concept.headlineText,
          fontFamily: typography.headingFont,
          fontSize: 82,
          fontWeight: typography.titleWeight,
          color: '#FFFFFF',
          strokeColor: '#000000',
          strokeWidth: 9,
          align: 'left',
          letterSpacing: 2,
          lineHeight: 1.04,
          uppercase: true,
          transform: { x: 56, y: 546, width: 920, height: 126, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 8, blur: 18, color: '#000000EE' }],
        },
      );
    } else {
      // macro_center_object / mystery_spotlight / asymmetric_story (Object-focused or non-human focal subject)
      const heroObj = acquired[0]!;
      layers.push(
        {
          id: 'bg-object-spotlight',
          type: 'background',
          name: `Cenário Macro (${heroObj.provenance})`,
          zIndex: 0,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          assetId: heroObj.asset.id,
          source: 'asset',
          fillColor: palette.background,
          gradientAngleDeg: 135,
          blurRadius: 0,
          brightness: 0.94,
          transform: { x: 0, y: 0, width: spec.width, height: spec.height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [
            { kind: 'colorGrade', enabled: true, brightness: 0.96, contrast: 1.24, saturation: 1.18 },
            { kind: 'vignette', enabled: true, strength: 0.56, color: '#000000' },
          ],
        },
        {
          id: 'kicker-object',
          type: 'text',
          role: 'kicker',
          name: 'Tag Narrativa do Objeto',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: concept.kickerText ?? 'SEGREDO',
          fontFamily: typography.headingFont,
          fontSize: 30,
          fontWeight: 900,
          color: '#FFFFFF',
          strokeColor: '#000000',
          strokeWidth: 0,
          align: 'left',
          letterSpacing: 3,
          lineHeight: 1.1,
          uppercase: true,
          pillColor: palette.secondary,
          pillRadius: 8,
          transform: { x: 56, y: 54, width: 380, height: 52, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'title-object',
          type: 'text',
          role: 'headline',
          name: 'Título Complementar do Objeto',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: concept.headlineText,
          fontFamily: typography.headingFont,
          fontSize: 84,
          fontWeight: typography.titleWeight,
          color: palette.accent,
          strokeColor: '#000000',
          strokeWidth: 9,
          align: 'left',
          letterSpacing: 2,
          lineHeight: 1.04,
          uppercase: true,
          transform: { x: 56, y: 544, width: 920, height: 128, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 8, blur: 18, color: '#000000EE' }],
        },
      );
    }

    if (input.watermarkAsset) {
      layers.push({
        id: 'wm-brand',
        type: 'watermark',
        name: "Marca d'Água do Canal",
        zIndex: 5,
        visible: true,
        locked: false,
        opacity: 0.85,
        blendMode: 'over',
        assetId: input.watermarkAsset.id,
        monochrome: false,
        anchor: 'bottom-right',
        transform: {
          x: spec.width - 116,
          y: spec.height - 112,
          width: 82,
          height: 82,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
        mask: { kind: 'none' },
        effects: [],
      });
    }

    return creativeProjectDocumentSchema.parse({
      schemaVersion: CREATIVE_PROJECT_SCHEMA_VERSION,
      id,
      title: `${input.title?.trim() || 'Thumbnail'} — ${concept.label}: ${concept.title}`,
      artType: 'thumbnail',
      width: spec.width,
      height: spec.height,
      ...(input.brandKit?.id ? { brandKitId: input.brandKit.id } : {}),
      ...(input.sourceCinemaProjectId ? { sourceCinemaProjectId: input.sourceCinemaProjectId } : {}),
      ...(input.sourceVideoAssetId ? { sourceVideoAssetId: input.sourceVideoAssetId } : {}),
      prompt: input.prompt,
      layers,
      assetManifest,
      tags: [
        'thumbnail',
        concept.archetype,
        concept.blueprint,
        ...extractNarrativeEntities(input)
          .keywords.slice(0, 10)
          .map((k) => k.toLowerCase()),
        ...acquired.map((a) => a.provenance),
      ],
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * 3b. Post-Render Visual Concept Critic:
   * Evaluates rendered pixels at original & small mobile size, split contrast when split_comparison,
   * provenance honesty, and QualityGateService findings — never relying solely on geometry heuristics.
   */
  async critiqueRenderedConcept(
    concept: CreativeConceptProposal,
    doc: CreativeProjectDocument,
    acquired: AcquiredMediaItem[],
    input: ConceptEngineInput,
  ): Promise<{ critique: VisualConceptCritique; audit: QualityAuditReport }> {
    const rendered = await this.engine.renderDocumentToBuffer(doc, 'png');
    const audit = await this.qualityGate.auditProject(doc, {
      brandKit: input.brandKit ?? null,
      renderedBuffer: rendered,
    });

    const smallBuf = await sharp(rendered).resize(224, 126, { fit: 'fill' }).png().toBuffer();
    const smallStats = await sharp(smallBuf).stats();
    const smallStdev =
      ((smallStats.channels[0]?.stdev ?? 0) + (smallStats.channels[1]?.stdev ?? 0) + (smallStats.channels[2]?.stdev ?? 0)) /
      3;

    let focalPointScore = 86;
    let compositionScore = audit.scorecard.composition;
    const notes: string[] = [];

    // Verify split comparison actually has visual contrast between left and right halves
    if (concept.blueprint === 'split_comparison') {
      const leftHalf = await sharp(rendered).extract({ left: 0, top: 0, width: 620, height: 720 }).stats();
      const rightHalf = await sharp(rendered).extract({ left: 660, top: 0, width: 620, height: 720 }).stats();
      const leftMean =
        ((leftHalf.channels[0]?.mean ?? 0) + (leftHalf.channels[1]?.mean ?? 0) + (leftHalf.channels[2]?.mean ?? 0)) / 3;
      const rightMean =
        ((rightHalf.channels[0]?.mean ?? 0) + (rightHalf.channels[1]?.mean ?? 0) + (rightHalf.channels[2]?.mean ?? 0)) / 3;
      const sideDelta = Math.abs(leftMean - rightMean);
      if (sideDelta < 3) {
        compositionScore = Math.min(compositionScore, 55);
        notes.push(`Baixa diferença visual entre os lados da comparação (${sideDelta.toFixed(1)}).`);
      } else {
        notes.push(`Contraste comparativo entre esquerda e direita validado (delta luminância ${sideDelta.toFixed(1)}).`);
      }
    }

    // Verify provenance honesty: AI generated assets are never tagged as real_video_frame
    const aiMismatch = acquired.some(
      (a) =>
        a.provenance === 'real_video_frame' &&
        !doc.layers.some((l) => 'assetId' in l && l.assetId === a.asset.id && l.name.includes('real_video_frame')),
    );
    if (aiMismatch) {
      notes.push('Aviso de proveniência detectado na camada de cena.');
    }

    const legibilityScore = smallStdev >= 22 ? audit.scorecard.legibility : Math.max(40, audit.scorecard.legibility - 25);
    const passed = audit.passed && !aiMismatch && smallStdev >= 22;
    notes.push(`Miniatura 224×126 stdev=${smallStdev.toFixed(1)}; proveniência: ${acquired.map((a) => a.provenance).join(', ')}.`);

    const critique = visualConceptCritiqueSchema.parse({
      conceptId: concept.id,
      stage: 'post_render',
      passed,
      isGenericOrWeak: !passed,
      narrativeRelevanceScore: passed ? 90 : 50,
      originalityScore: 92,
      compositionScore,
      legibilityScore,
      focalPointScore,
      scriptCoherenceScore: 90,
      ...(!passed ? { rejectionReason: 'Falha nos critérios pós-render do Visual Concept Critic.' } : {}),
      criticNotes: notes,
    });

    return { critique, audit };
  }

  /**
   * Full CS-8 Concept-Driven Thumbnail Lab pipeline:
   * Ideate -> Pre-Render Critic (reject & replace generic) -> Acquire Media -> Build -> Post-Render Critic.
   */
  async generateConceptLab(input: ConceptEngineInput): Promise<{
    proposals: ConceptLabProposalResult[];
    enginesUsed: string[];
  }> {
    const { concepts: rawConcepts, enginesUsed } = await this.ideateConcepts(input);
    const preCritiques = this.critiqueConceptsPreRender(rawConcepts, input);
    const finalConcepts: CreativeConceptProposal[] = [];
    const rejectionHistoryByIndex: Array<Array<{ rejectedTitle: string; reason: string }>> = [[], [], []];

    for (let i = 0; i < rawConcepts.length; i += 1) {
      let current = rawConcepts[i]!;
      const crit = preCritiques[i]!;
      if (crit.isGenericOrWeak) {
        rejectionHistoryByIndex[i]!.push({
          rejectedTitle: current.title,
          reason: crit.rejectionReason ?? 'Conceito genérico ou repetitivo.',
        });
        current = this.replaceRejectedConcept(current, finalConcepts, input);
      }
      finalConcepts.push(current);
    }

    const proposals: ConceptLabProposalResult[] = [];
    for (let i = 0; i < finalConcepts.length; i += 1) {
      const concept = finalConcepts[i]!;
      const preRenderCritique = this.critiqueConceptsPreRender([concept], input)[0]!;
      const acquiredMedia = await this.acquireConceptMedia(concept, input);
      const document = this.buildConceptDocument(concept, acquiredMedia, input);
      const { critique: postRenderCritique, audit } = await this.critiqueRenderedConcept(
        concept,
        document,
        acquiredMedia,
        input,
      );

      proposals.push({
        concept,
        preRenderCritique,
        postRenderCritique,
        acquiredMedia,
        document,
        audit,
        rejectionHistory: rejectionHistoryByIndex[i]!,
      });
    }

    return { proposals, enginesUsed };
  }

  /**
   * 4. Thumbnail Lab Combination:
   * Combines visual elements (e.g., typography/colors from donor, or scene/subject from donor)
   * into a new editable layered CreativeProjectDocument with portable assetManifest.
   */
  combineConceptElements(options: {
    baseDocument: CreativeProjectDocument;
    donorDocument: CreativeProjectDocument;
    takeFromDonor: Array<'typography' | 'vfx' | 'watermark' | 'background'>;
  }): CreativeProjectDocument {
    const base = structuredClone(options.baseDocument);
    const donor = options.donorDocument;
    const mergedManifest: Record<string, ManagedAssetRef> = { ...base.assetManifest };

    if (options.takeFromDonor.includes('typography')) {
      const donorHeadline = donor.layers.find((l) => l.type === 'text' && l.role === 'headline');
      const baseHeadline = base.layers.find((l) => l.type === 'text' && l.role === 'headline');
      if (donorHeadline && donorHeadline.type === 'text' && baseHeadline && baseHeadline.type === 'text') {
        baseHeadline.color = donorHeadline.color;
        baseHeadline.fontFamily = donorHeadline.fontFamily;
        baseHeadline.strokeColor = donorHeadline.strokeColor;
      }
    }

    if (options.takeFromDonor.includes('vfx')) {
      const donorVfx = donor.layers.find((l) => l.type === 'vfx');
      if (donorVfx) {
        base.layers = base.layers.filter((l) => l.type !== 'vfx');
        base.layers.push(structuredClone(donorVfx));
      }
    }

    if (options.takeFromDonor.includes('watermark')) {
      const donorWm = donor.layers.find((l) => l.type === 'watermark');
      if (donorWm && donorWm.type === 'watermark') {
        base.layers = base.layers.filter((l) => l.type !== 'watermark');
        base.layers.push(structuredClone(donorWm));
        if (donorWm.assetId && donor.assetManifest[donorWm.assetId]) {
          mergedManifest[donorWm.assetId] = donor.assetManifest[donorWm.assetId]!;
        }
      }
    }

    if (options.takeFromDonor.includes('background')) {
      const donorBg = donor.layers.find((l) => l.type === 'background');
      if (donorBg && donorBg.type === 'background') {
        base.layers = base.layers.filter((l) => l.type !== 'background');
        base.layers.unshift(structuredClone(donorBg));
        if (donorBg.assetId && donor.assetManifest[donorBg.assetId]) {
          mergedManifest[donorBg.assetId] = donor.assetManifest[donorBg.assetId]!;
        }
      }
    }

    base.id = `creative-thumbnail-${randomUUID().slice(0, 10)}`;
    base.title = `${base.title} + Mix`;
    base.assetManifest = mergedManifest;
    base.updatedAt = new Date().toISOString();
    return creativeProjectDocumentSchema.parse(base);
  }
}
