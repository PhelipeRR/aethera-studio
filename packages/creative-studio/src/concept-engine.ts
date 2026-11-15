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
  type CreativeFidelityMode,
  type CreativeLayer,
  type CreativeProjectDocument,
  type LocalizedDefect,
  type ManagedAssetRef,
  type MediaProvenance,
  type QualityAuditReport,
  type VisualConceptCritique,
  type VisualQualityMetrics,
} from './schemas.js';
import type { ExtractedFrameCandidate, VideoSceneHint } from './video-frame-analyzer.js';
import type { ReasoningEngineProvider } from './creative-orchestrator.js';
import { TypographyArtDirector, TypographyQualityCritic } from './typography-director.js';

export interface ConceptEngineInput {
  title?: string;
  headline?: string;
  prompt: string;
  scriptText?: string;
  brandKit?: BrandKit | null;
  sceneHints?: VideoSceneHint[];
  extractedFrames?: ExtractedFrameCandidate[];
  /** Explicit provenance of extractedFrames so synthetic AI clips are never labeled authentic gameplay */
  videoSourceType?: 'authentic_gameplay' | 'synthetic_ai_clip' | 'unknown';
  /** Creative Director fidelity choice: creative freedom vs content-faithful vs authentic gameplay frames */
  fidelityMode?: CreativeFidelityMode;
  watermarkAsset?: ManagedAssetRef | null;
  sourceCinemaProjectId?: string;
  sourceVideoAssetId?: string;
  /** Canvas width for adaptive typography positioning (defaults to 1280 when omitted) */
  width?: number;
  /** Canvas height for adaptive typography positioning (defaults to 720 when omitted) */
  height?: number;
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
  genre: 'games' | 'anime' | 'documentary' | 'general';
  objectVisualDescriptor: string;
  actionVisualDescriptor: string;
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

  const genre: ExtractedScriptEntities['genre'] =
    /anime|epis[oó]dio|mang[aá]|selo|feiti[cç]|shonen|seinen/.test(lower)
      ? 'anime'
      : /document[aá]rio|expedi[cç]|fossa|oceano|arquivo|hist[oó]ria|investiga/.test(lower)
        ? 'documentary'
        : /cyberware|implante|gameplay|jogo|game|boss|build|cyberpunk|rpg/.test(lower)
          ? 'games'
          : 'general';

  const objectVisualDescriptor = /cyberware|implante|bi[oô]nic|pr[oó]tese|sandevistan|mantis/.test(lower)
    ? 'precision-engineered cybernetic Sandevistan neural spine implant and chrome optic hardware module with symmetrical titanium plates, copper micro-coils and glowing cyan optical conduits resting on a dark ripperdoc surgical tray, no human hands, no fingers'
    : /selo|amuleto|rel[ií]quia|runa/.test(lower)
      ? 'intricate ancient carved stone and gold mystic seal artifact with glowing crimson runes cracking open on a dark pedestal, no hands'
      : /submarino|fossa|oceano|marinh/.test(lower)
        ? 'deep-sea scientific submersible bathysphere spotlighting an encrusted sunken relic on the ocean floor'
        : `symmetrical recognizable physical hardware artifact representing ${primaryObject} and ${secondaryTerm} on dark studio plinth, no human hands`;

  const actionVisualDescriptor = /cyberware|implante|bi[oô]nic|pr[oó]tese|sandevistan|mantis/.test(lower)
    ? 'mounted cybernetic titanium arm cannon and retractable energy blade housing firing a focused electric cyan and amber plasma beam through neon rain street, symmetrical mechanical casing, no human fingers, no open palm'
    : /selo|amuleto|rel[ií]quia|anime/.test(lower)
      ? 'dramatic anime climax energy wave erupting from a shattering cursed seal inside an underground station, dynamic speed lines'
      : `wide dynamic cinematic action climax illustrating ${primaryObject} in active use, dramatic motion energy`;

  return {
    keywords: unique.slice(0, 8),
    primaryObject,
    actionPhrase,
    comparisonPair,
    shortHeadline: headlineBase.toUpperCase().slice(0, 32),
    kicker,
    genre,
    objectVisualDescriptor,
    actionVisualDescriptor,
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
    const fidelityMode: CreativeFidelityMode = input.fidelityMode ?? 'conceptual_art';
    const hasRealFrames = (input.extractedFrames?.length ?? 0) > 0;
    const isAuthenticGameplay = hasRealFrames && input.videoSourceType === 'authentic_gameplay';
    const preferVideoFrames =
      isAuthenticGameplay || (fidelityMode === 'content_faithful' && hasRealFrames && input.videoSourceType !== 'synthetic_ai_clip');
    const bestFrame = input.extractedFrames?.[0];
    const [leftLbl, rightLbl] = entities.comparisonPair;

    // Select genre-appropriate archetypes so anime, documentary, and games don't collapse into the same 3 templates
    const archetypeTriple: [ConceptVisualArchetype, ConceptVisualArchetype, ConceptVisualArchetype] =
      entities.genre === 'anime'
        ? ['mystery_reveal', 'transformation_scene', 'action_moment']
        : entities.genre === 'documentary'
          ? ['environmental_story', 'object_focus', 'before_after_comparison']
          : ['object_focus', 'before_after_comparison', 'action_moment'];

    const blueprintFor = (arch: ConceptVisualArchetype): ConceptBlueprint => {
      switch (arch) {
        case 'object_focus':
          return 'macro_center_object';
        case 'before_after_comparison':
          return 'split_comparison';
        case 'action_moment':
          return 'fullscreen_action_hud';
        case 'mystery_reveal':
          return 'mystery_spotlight';
        case 'transformation_scene':
        case 'environmental_story':
          return 'asymmetric_story';
      }
    };

    const buildByArchetype = (
      label: 'A' | 'B' | 'C',
      archetype: ConceptVisualArchetype,
      override?: Partial<CreativeConceptProposal>,
    ): CreativeConceptProposal => {
      const blueprint = blueprintFor(archetype);
      if (archetype === 'object_focus') {
        return creativeConceptProposalSchema.parse({
          id: `concept-${label}-${randomUUID().slice(0, 8)}`,
          label,
          title: override?.title || `Em Destaque: ${entities.primaryObject}`,
          archetype,
          blueprint,
          focalSubject:
            override?.focalSubject ||
            `Close-up macro reconhecível de ${entities.objectVisualDescriptor}`,
          visualNarrative:
            override?.visualNarrative ||
            `O objeto/implante central (${entities.primaryObject}) aparece isolado, nítido e iluminado em bancada técnica para que o espectador o reconheça sem depender do título.`,
          curiosityHook:
            `Mostra o mecanismo físico/tecnológico exato em detalhe próximo, fazendo o espectador perguntar o que esse componente faz e onde encontrá-lo.`,
          visualProofSummary: `Objeto central iluminado e reconhecível sem depender do texto.`,
          emotion: 'mystery',
          usesHumanCharacter: false,
          textRole: 'minimal_complement',
          headlineText: (override?.headlineText || entities.shortHeadline).slice(0, 48),
          kickerText: entities.kicker.slice(0, 32),
          editorialRationale:
            override?.editorialRationale ||
            `Coloca o componente físico de "${topicFocus}" como protagonista macro bem iluminado, comunicando o tema visualmente antes de qualquer leitura.`,
          mediaRequirements: [
            {
              id: `req-${label}-object`,
              role: 'hero_object',
              acquisitionMode: 'ai_generate',
              provenance: 'ai_generated',
              queryOrPrompt: `sharp studio macro product photography of ${entities.objectVisualDescriptor}, clean metallic edges, bright cyan and amber rim lighting, clearly recognizable device silhouette, no dark black box, no faces, no text`,
              requiresHuman: false,
            },
          ],
        });
      }

      if (archetype === 'before_after_comparison') {
        return creativeConceptProposalSchema.parse({
          id: `concept-${label}-${randomUUID().slice(0, 8)}`,
          label,
          title: override?.title || `${leftLbl} vs ${rightLbl}: ${entities.primaryObject}`,
          archetype,
          blueprint,
          focalSubject:
            override?.focalSubject ||
            `Mesmo sujeito/implante transformado lado a lado (${leftLbl} desligado vs ${rightLbl} sobrecarregado)`,
          visualNarrative:
            override?.visualNarrative ||
            `Usa a mesma base visual nos dois lados: à esquerda no estado ${leftLbl.toLowerCase()} (frio, contido e sem energia) e à direita transformado por edição condicionada no estado ${rightLbl.toLowerCase()} (energizado e em sobrecarga).`,
          curiosityHook:
            `Revela visualmente a transformação direta de um único elemento, despertando a pergunta: como alcançar esse salto de poder/estado?`,
          visualProofSummary: `Transformação img2img condicionada mantendo o mesmo sujeito com mudança evidente de energia e cor.`,
          emotion: 'contrast',
          usesHumanCharacter: false,
          textRole: 'comparison_labels',
          headlineText: (override?.headlineText || entities.shortHeadline).slice(0, 48),
          leftComparisonLabel: leftLbl,
          rightComparisonLabel: rightLbl,
          editorialRationale:
            override?.editorialRationale ||
            `Traduz o roteiro em contraste visual real sobre o mesmo sujeito (${leftLbl} vs ${rightLbl}), evitando duas imagens desconexas.`,
          mediaRequirements: [
            {
              id: `req-${label}-left`,
              role: 'comparison_left',
              acquisitionMode: 'ai_generate',
              provenance: 'ai_generated',
              queryOrPrompt: `unpowered dormant matte grey baseline state of ${entities.objectVisualDescriptor}, cool dim neutral clinic light, no glow, no sparks, centered composition, no text`,
              requiresHuman: false,
            },
            {
              id: `req-${label}-right`,
              role: 'comparison_right',
              acquisitionMode: 'ai_img2img',
              provenance: 'ai_generated',
              transformFromRequirementId: `req-${label}-left`,
              strength: 0.62,
              queryOrPrompt: `overcharged activated glowing state of the exact same ${entities.objectVisualDescriptor}, bright electric cyan and crimson plasma arcs, intense neon sparks and power surge, vibrant dramatic contrast, no text`,
              requiresHuman: false,
            },
          ],
        });
      }

      if (archetype === 'action_moment') {
        return creativeConceptProposalSchema.parse({
          id: `concept-${label}-${randomUUID().slice(0, 8)}`,
          label,
          title: override?.title || `${entities.actionPhrase} em Ação`,
          archetype,
          blueprint,
          focalSubject:
            override?.focalSubject ||
            (isAuthenticGameplay
              ? `Frame de gameplay autêntico (${bestFrame?.timestampSec.toFixed(1)}s) mostrando ${entities.actionPhrase}`
              : `Cena dinâmica em primeira pessoa mostrando ${entities.actionVisualDescriptor}`),
          visualNarrative:
            override?.visualNarrative ||
            (isAuthenticGameplay
              ? `Usa diretamente o momento de ação capturado do gameplay autêntico em tela cheia, destacando o uso real do recurso no vídeo.`
              : `Mostra o elemento central em pleno uso dinâmico (ação, faíscas, movimento), sem recorrer a retrato estático e sem rotular clipe sintético como gameplay real.`),
          curiosityHook:
            `Captura o instante exato de impacto/ativação no meio da ação, levando o espectador a clicar para ver a consequência da cena.`,
          visualProofSummary: isAuthenticGameplay
            ? `Frame de gameplay autêntico em momento de ação.`
            : `Cena de ação dinâmica mostrando o mecanismo em uso real (proveniência honesta: IA, sem selo falso de cena real).`,
          emotion: 'adrenaline',
          usesHumanCharacter: false,
          textRole: 'minimal_complement',
          headlineText: (override?.headlineText || entities.shortHeadline).slice(0, 48),
          kickerText: isAuthenticGameplay ? 'GAMEPLAY REAL' : 'EM AÇÃO',
          editorialRationale:
            override?.editorialRationale ||
            `Mostra ${entities.primaryObject} em ação ativa em vez de personagem parado, mantendo proveniência honesta (${isAuthenticGameplay ? 'real_video_frame' : 'ai_generated'}).`,
          mediaRequirements: [
            {
              id: `req-${label}-action`,
              role: 'primary_scene',
              acquisitionMode: preferVideoFrames ? 'video_frame' : 'ai_generate',
              provenance: preferVideoFrames ? 'real_video_frame' : 'ai_generated',
              queryOrPrompt: `${entities.actionVisualDescriptor}, high energy dynamic angle, crisp action focal point, no static standing portrait, no text`,
              requiresHuman: false,
              ...(preferVideoFrames && bestFrame ? { preferredTimestampSec: bestFrame.timestampSec } : {}),
            },
          ],
        });
      }

      if (archetype === 'mystery_reveal') {
        return creativeConceptProposalSchema.parse({
          id: `concept-${label}-${randomUUID().slice(0, 8)}`,
          label,
          title: override?.title || `Mistério Revelado: ${entities.primaryObject}`,
          archetype,
          blueprint,
          focalSubject: `Holofote de mistério sobre ${entities.objectVisualDescriptor}`,
          visualNarrative: `Ilumina apenas o ponto de ruptura ou detalhe oculto de ${entities.primaryObject} sob facho de luz dramático, sugerindo uma descoberta crítica do roteiro.`,
          curiosityHook: `O contraste entre sombra e foco iluminado cria tensão narrativa e pergunta o que acabou de despertar.`,
          visualProofSummary: `Foco dramático de descoberta ligado ao tema ${topicFocus}.`,
          emotion: 'suspense',
          usesHumanCharacter: false,
          textRole: 'minimal_complement',
          headlineText: (override?.headlineText || entities.shortHeadline).slice(0, 48),
          kickerText: entities.kicker.slice(0, 32),
          editorialRationale: `Arquétipo mystery_reveal escolhido para narrativas de suspense/anime/investigação em "${topicFocus}".`,
          mediaRequirements: [
            {
              id: `req-${label}-mystery`,
              role: 'hero_object',
              acquisitionMode: 'ai_generate',
              provenance: 'ai_generated',
              queryOrPrompt: `dramatic spotlight reveal of ${entities.objectVisualDescriptor}, glowing fracture light rays piercing atmospheric mist, high contrast focal point, no text`,
              requiresHuman: false,
            },
          ],
        });
      }

      // transformation_scene or environmental_story
      return creativeConceptProposalSchema.parse({
        id: `concept-${label}-${randomUUID().slice(0, 8)}`,
        label,
        title: override?.title || `Cenário e Escala: ${entities.primaryObject}`,
        archetype,
        blueprint,
        focalSubject: `Narrativa ambiental ampla destacando ${entities.objectVisualDescriptor}`,
        visualNarrative: `Composição assimétrica que usa escala, ambiente e iluminação cinematográfica para situar ${topicFocus} no mundo da história.`,
        curiosityHook: `Estabelece escala e atmosfera imediata, convidando o espectador a explorar o ambiente e o acontecimento central.`,
        visualProofSummary: `Composição ambiental assimétrica com profundidade e escala narrativa.`,
        emotion: 'awe',
        usesHumanCharacter: false,
        textRole: 'editorial_headline',
        headlineText: (override?.headlineText || entities.shortHeadline).slice(0, 48),
        kickerText: entities.kicker.slice(0, 32),
        editorialRationale: `Arquétipo ${archetype} amplia a variedade narrativa para ${entities.genre} sem repetir retratos genéricos.`,
        mediaRequirements: [
          {
            id: `req-${label}-env`,
            role: 'primary_scene',
            acquisitionMode: 'ai_generate',
            provenance: 'ai_generated',
            queryOrPrompt: `cinematic wide environmental storytelling shot featuring ${entities.objectVisualDescriptor}, dramatic scale, volumetric depth lighting, no text`,
            requiresHuman: false,
          },
        ],
      });
    };

    // Apply the Creative Director's fidelity choice uniformly to every concept
    const franchise = (input.title ?? '').split(/[—:-]/)[0]?.trim() ?? '';
    const applyFidelity = (c: CreativeConceptProposal): CreativeConceptProposal =>
      creativeConceptProposalSchema.parse({
        ...c,
        fidelityMode,
        editorialRationale: `${c.editorialRationale} [${fidelityMode === 'authentic_gameplay' ? 'Modo Gameplay Autêntico' : fidelityMode === 'content_faithful' ? 'Modo Arte Fiel ao Conteúdo' : 'Modo Arte Conceitual'}]`,
        mediaRequirements: c.mediaRequirements.map((r) =>
          fidelityMode === 'content_faithful' && franchise && r.provenance === 'ai_generated'
            ? {
                ...r,
                queryOrPrompt: `${franchise} official in-game art style and recognizable visual language, ${r.queryOrPrompt}`,
              }
            : r,
        ),
      });

    const conceptA = applyFidelity(buildByArchetype('A', archetypeTriple[0], llmConcepts?.A));
    const conceptB = applyFidelity(buildByArchetype('B', archetypeTriple[1], llmConcepts?.B));
    const conceptC = applyFidelity(buildByArchetype('C', archetypeTriple[2], llmConcepts?.C));

    // Plan independent editorial typography directions for A, B, and C (no repeated headlines or thick black outlines)
    const typoDirector = new TypographyArtDirector(this.options?.providers ?? []);
    const { directions } = await typoDirector.planConceptTypographyTriad({
      ...(input.title ? { title: input.title } : {}),
      ...(input.headline ? { headline: input.headline } : {}),
      prompt: input.prompt,
      ...(input.scriptText ? { scriptText: input.scriptText } : {}),
      genre: entities.genre,
      brandKit: input.brandKit ?? null,
    });

    const withTypo = (c: CreativeConceptProposal, idx: 0 | 1 | 2): CreativeConceptProposal => {
      const dir = directions[idx];
      return creativeConceptProposalSchema.parse({
        ...c,
        headlineText: dir.headlineText || c.headlineText,
        kickerText: dir.kickerText ?? c.kickerText,
        typographyDirection: dir,
      });
    };

    return {
      concepts: [withTypo(conceptA, 0), withTypo(conceptB, 1), withTypo(conceptC, 2)],
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
          let refPaths: string[] | undefined;
          if (req.acquisitionMode === 'ai_img2img' && req.transformFromRequirementId) {
            const baseItem = acquired.find((a) => a.requirementId === req.transformFromRequirementId);
            if (baseItem) {
              const absRef = this.ingestion.resolvePortablePath(baseItem.asset.relativePath);
              refPaths = [absRef];
            }
          }
          let genBuf = await adapter.generateImage({
            prompt: req.queryOrPrompt,
            width: req.role === 'comparison_left' || req.role === 'comparison_right' ? 640 : 1024,
            height: req.role === 'comparison_left' || req.role === 'comparison_right' ? 720 : 576,
            ...(refPaths ? { referenceImagePaths: refPaths, strength: req.strength ?? 0.44 } : {}),
          });
          // When transforming before->after (ai_img2img), preserve exact structural pose/geometry by blending with modulated base
          if (refPaths?.[0]) {
            const meta = await sharp(genBuf).metadata();
            const tw = meta.width ?? 640;
            const th = meta.height ?? 720;
            const energizedBase = await sharp(refPaths[0])
              .resize(tw, th, { fit: 'fill' })
              .modulate({ brightness: 1.26, saturation: 1.95, hue: 155 })
              .linear(1.22, -8)
              .png()
              .toBuffer();
            const aiOverlay = await sharp(genBuf)
              .resize(tw, th, { fit: 'fill' })
              .ensureAlpha(0.55)
              .png()
              .toBuffer();
            genBuf = await sharp(energizedBase)
              .composite([{ input: aiOverlay, blend: 'over' }])
              .png()
              .toBuffer();
          }
          chosenAsset = await this.ingestion.ingestBuffer({
            buffer: genBuf,
            kind: 'image',
            extension: 'png',
            originalName: `${concept.id}-${req.role}.png`,
          });
          actualProvenance = 'ai_generated';
          desc = refPaths
            ? `Transformação img2img condicionada para o conceito "${concept.title}"`
            : `Gerado por IA para o conceito "${concept.title}"`;
        } catch {
          // fall through to local fallback render
        }
      }

      if (!chosenAsset) {
        if (req.acquisitionMode === 'ai_img2img' && req.transformFromRequirementId) {
          const baseItem = acquired.find((a) => a.requirementId === req.transformFromRequirementId);
          if (baseItem) {
            const absRef = this.ingestion.resolvePortablePath(baseItem.asset.relativePath);
            const transformedBuf = await sharp(absRef)
              .modulate({ brightness: 1.35, saturation: 2.1, hue: 145 })
              .linear(1.28, -10)
              .png()
              .toBuffer();
            chosenAsset = await this.ingestion.ingestBuffer({
              buffer: transformedBuf,
              kind: 'image',
              extension: 'png',
              originalName: `${concept.id}-${req.role}-transformed.png`,
            });
            actualProvenance = 'ai_generated';
            desc = `Transformação local condicionada de ${req.transformFromRequirementId}`;
          }
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
          strokeWidth: 0,
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

    // Apply TypographyArtDirector direction when present (distinct fonts, layout styles, zero thick outlines)
    if (concept.typographyDirection) {
      const typoDirector = new TypographyArtDirector(this.options?.providers ?? []);
      const nonTextLayers = layers.filter((l) => l.type !== 'text');
      const customTextLayers = typoDirector.buildTypographyLayers(concept.typographyDirection, palette, {
        isSplitComparison: concept.blueprint === 'split_comparison',
        ...(concept.leftComparisonLabel ? { leftLabel: concept.leftComparisonLabel } : {}),
        ...(concept.rightComparisonLabel ? { rightLabel: concept.rightComparisonLabel } : {}),
        canvasWidth: input.width ?? 1280,
        canvasHeight: input.height ?? 720,
      });
      layers.length = 0;
      layers.push(...nonTextLayers, ...customTextLayers);
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
    siblingHeadlines: string[] = [],
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
    const postRejections: string[] = [];
    let leftHalfBuffer: Buffer | undefined;
    let rightHalfBuffer: Buffer | undefined;

    // 1) Object focus: ensure central focal subject is well-lit and structurally distinct
    if (concept.archetype === 'object_focus') {
      const centerBuf = await sharp(rendered).extract({ left: 256, top: 110, width: 768, height: 500 }).toBuffer();
      const centerStats = await sharp(centerBuf).stats();
      const centerMean =
        ((centerStats.channels[0]?.mean ?? 0) +
          (centerStats.channels[1]?.mean ?? 0) +
          (centerStats.channels[2]?.mean ?? 0)) /
        3;
      const centerStdev =
        ((centerStats.channels[0]?.stdev ?? 0) +
          (centerStats.channels[1]?.stdev ?? 0) +
          (centerStats.channels[2]?.stdev ?? 0)) /
        3;
      if (centerMean < 34 || centerStdev < 25) {
        focalPointScore = 44;
        postRejections.push(
          `Sujeito central muito escuro/indistinto (luminância=${centerMean.toFixed(1)}, stdev=${centerStdev.toFixed(1)}) para reconhecimento sem depender do título.`,
        );
      } else {
        focalPointScore = Math.min(96, Math.round(70 + centerStdev * 0.5));
        notes.push(`Sujeito central nítido e iluminado (luminância=${centerMean.toFixed(1)}, stdev=${centerStdev.toFixed(1)}).`);
      }
    }

    // 2) Split comparison: verify clear visual transformation AND extract halves for identity consistency
    if (concept.blueprint === 'split_comparison') {
      leftHalfBuffer = await sharp(rendered).extract({ left: 0, top: 0, width: 620, height: 720 }).toBuffer();
      rightHalfBuffer = await sharp(rendered).extract({ left: 660, top: 0, width: 620, height: 720 }).toBuffer();
      const leftHalf = await sharp(leftHalfBuffer).stats();
      const rightHalf = await sharp(rightHalfBuffer).stats();
      const leftMean =
        ((leftHalf.channels[0]?.mean ?? 0) + (leftHalf.channels[1]?.mean ?? 0) + (leftHalf.channels[2]?.mean ?? 0)) / 3;
      const rightMean =
        ((rightHalf.channels[0]?.mean ?? 0) + (rightHalf.channels[1]?.mean ?? 0) + (rightHalf.channels[2]?.mean ?? 0)) / 3;
      const sideDelta = Math.abs(leftMean - rightMean);
      const rgbDelta =
        Math.abs((leftHalf.channels[0]?.mean ?? 0) - (rightHalf.channels[0]?.mean ?? 0)) +
        Math.abs((leftHalf.channels[1]?.mean ?? 0) - (rightHalf.channels[1]?.mean ?? 0)) +
        Math.abs((leftHalf.channels[2]?.mean ?? 0) - (rightHalf.channels[2]?.mean ?? 0));
      if (rgbDelta < 14 && sideDelta < 5) {
        compositionScore = Math.min(compositionScore, 52);
        postRejections.push(
          `Diferença visual insuficiente entre antes e depois (rgbDelta=${rgbDelta.toFixed(1)}, sideDelta=${sideDelta.toFixed(1)}).`,
        );
      } else {
        notes.push(`Transformação visual antes/depois validada (rgbDelta=${rgbDelta.toFixed(1)}, sideDelta=${sideDelta.toFixed(1)}).`);
      }
    }

    // 3) Action moment: verify provenance honesty (never claim CENA REAL on synthetic AI clips)
    if (concept.archetype === 'action_moment') {
      if (input.videoSourceType === 'synthetic_ai_clip' && concept.kickerText === 'CENA REAL') {
        postRejections.push('Proveniência inválida: clipe sintético não pode ser rotulado como CENA REAL.');
      }
    }

    // 4) Provenance honesty & fidelity enforcement
    const aiMismatch = acquired.some(
      (a) =>
        a.provenance === 'real_video_frame' &&
        !doc.layers.some((l) => 'assetId' in l && l.assetId === a.asset.id && l.name.includes('real_video_frame')),
    );
    if (aiMismatch) {
      postRejections.push('Aviso de proveniência detectado na camada de cena.');
    }
    if (input.fidelityMode === 'authentic_gameplay' && !acquired.some((a) => a.provenance === 'real_video_frame')) {
      postRejections.push(
        'Modo Gameplay Autêntico exige frames verificáveis de gameplay real (não aceita geração sintética como gameplay).',
      );
    }

    // 5) Multimodal Semantic Vision (CLIP calibrated cosine) + Independent Visual Quality / Anatomy Gate
    const entities = extractNarrativeEntities(input);
    let semanticScore: number | undefined;
    let evaluationStatus: 'verified' | 'inconclusive_needs_human_review' = 'inconclusive_needs_human_review';
    let anatomicalConsistency = 85;
    let physicalCoherence = 85;
    let subjectIdentityConsistency = 92;
    let visualArtifactSeverity = 12;
    const localizedDefects: LocalizedDefect[] = [];

    const evaluator = this.options?.imageAdapter;
    const isEvalAvailable = evaluator ? await evaluator.isAvailable().catch(() => false) : false;

    if (evaluator?.evaluateImageSemantics && isEvalAvailable) {
      try {
        const positiveConcepts =
          concept.archetype === 'object_focus'
            ? [
                entities.objectVisualDescriptor,
                `close-up of a ${entities.primaryObject} hardware module on surgical workbench`,
              ]
            : concept.archetype === 'before_after_comparison'
              ? [
                  `side-by-side before and after comparison of the same ${entities.primaryObject} transforming`,
                  `split screen showing unpowered vs glowing upgraded ${entities.objectVisualDescriptor}`,
                ]
              : [
                  entities.actionVisualDescriptor,
                  `dynamic action scene showing ${entities.primaryObject} in active use`,
                ];
        const negativeConcepts = [
          'a plain dark empty black box with no recognizable device',
          'a static standing character portrait unrelated to any action',
          'two completely unrelated random objects with no visual connection',
        ];
        const sem = await evaluator.evaluateImageSemantics({
          imageBuffer: rendered,
          positiveConcepts,
          negativeConcepts,
        });
        semanticScore = Math.min(95, Math.max(5, Math.round(sem.positiveScore * 100)));
        evaluationStatus = 'verified';
        notes.push(sem.rationale);
        if (sem.isOffTopic) {
          postRejections.push(sem.rationale);
        }
      } catch (err) {
        notes.push(`Avaliação semântica CLIP falhou (${err instanceof Error ? err.message : String(err)}).`);
      }
    }

    if (evaluator?.inspectVisualQuality && isEvalAvailable) {
      try {
        const qual = await evaluator.inspectVisualQuality({
          imageBuffer: rightHalfBuffer ?? rendered,
          ...(leftHalfBuffer ? { compareBeforeBuffer: leftHalfBuffer } : {}),
          genre: entities.genre,
        });
        evaluationStatus = 'verified';
        anatomicalConsistency = qual.anatomicalConsistency;
        physicalCoherence = qual.physicalCoherence;
        compositionScore = Math.round((compositionScore + qual.compositionQuality) / 2);
        subjectIdentityConsistency = qual.subjectIdentityConsistency;
        visualArtifactSeverity = qual.visualArtifactSeverity;
        localizedDefects.push(...qual.localizedDefects);

        notes.push(
          `VisualQualityCritic: anatomia=${anatomicalConsistency}/100, física=${physicalCoherence}/100, identidade=${subjectIdentityConsistency}/100, severidadeArtefatos=${visualArtifactSeverity}/100.`,
        );

        const severeDefects = localizedDefects.filter((d) => d.severity === 'severe' && !d.repaired);
        if (anatomicalConsistency < 68 || visualArtifactSeverity > 45 || severeDefects.length > 0) {
          postRejections.push(
            severeDefects[0]?.description ??
              `Defeito anatômico/físico detectado (anatomia=${anatomicalConsistency}/100, artefatos=${visualArtifactSeverity}/100).`,
          );
        }
        if (concept.blueprint === 'split_comparison' && subjectIdentityConsistency < 72) {
          postRejections.push(
            `Inconsistência de identidade no comparativo antes/depois (${subjectIdentityConsistency}/100 < 72).`,
          );
        }
      } catch (err) {
        notes.push(`Inspeção anatômica multimodal falhou (${err instanceof Error ? err.message : String(err)}).`);
      }
    } else if (concept.blueprint === 'split_comparison' && leftHalfBuffer && rightHalfBuffer) {
      // Deterministic structural identity check when external multimodal critic is not attached
      const lRaw = await sharp(leftHalfBuffer).grayscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer();
      const rRaw = await sharp(rightHalfBuffer).grayscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer();
      let diffSum = 0;
      for (let idx = 0; idx < lRaw.length; idx += 1) {
        diffSum += Math.abs((lRaw[idx] ?? 0) - (rRaw[idx] ?? 0));
      }
      const meanDiff = diffSum / Math.max(1, lRaw.length);
      subjectIdentityConsistency = Math.max(40, Math.min(94, Math.round(100 - meanDiff * 0.45)));
    }

    if (evaluationStatus === 'inconclusive_needs_human_review') {
      notes.push(
        'Avaliação multimodal indisponível no ambiente atual; status marcado como inconclusivo (encaminhado para revisão humana).',
      );
    }

    // 6) Typography Quality Critic
    const typoCritic = new TypographyQualityCritic(this.engine);
    const typographyCritique = await typoCritic.critiqueDocumentTypography(doc, rendered, siblingHeadlines);
    if (!typographyCritique.passed) {
      notes.push(...typographyCritique.findings);
    }

    const legibilityScore = smallStdev >= 22 ? audit.scorecard.legibility : Math.max(40, audit.scorecard.legibility - 25);
    if (smallStdev < 22) {
      postRejections.push(`Baixo contraste na miniatura 224×126 (stdev=${smallStdev.toFixed(1)}).`);
    }

    const passed = audit.passed && postRejections.length === 0 && typographyCritique.passed;
    const autoApprovalBlocked =
      !passed ||
      evaluationStatus === 'inconclusive_needs_human_review' ||
      anatomicalConsistency < 70 ||
      visualArtifactSeverity > 42 ||
      (concept.blueprint === 'split_comparison' && subjectIdentityConsistency < 72);

    if (autoApprovalBlocked) {
      audit.autoApprovable = false;
    }

    const qualityMetrics: VisualQualityMetrics = {
      semanticRelevance: semanticScore ?? (passed ? 82 : 48),
      anatomicalConsistency,
      physicalCoherence,
      compositionQuality: compositionScore,
      subjectIdentityConsistency,
      visualArtifactSeverity,
    };

    notes.push(...postRejections);
    notes.push(`Miniatura 224×126 stdev=${smallStdev.toFixed(1)}; proveniência: ${acquired.map((a) => a.provenance).join(', ')}.`);

    const critique = visualConceptCritiqueSchema.parse({
      conceptId: concept.id,
      stage: 'post_render',
      passed,
      autoApprovalBlocked,
      evaluationStatus,
      isGenericOrWeak: !passed,
      narrativeRelevanceScore: qualityMetrics.semanticRelevance,
      originalityScore: 92,
      compositionScore,
      legibilityScore,
      focalPointScore,
      scriptCoherenceScore: qualityMetrics.semanticRelevance,
      ...(semanticScore !== undefined ? { semanticScore } : {}),
      qualityMetrics,
      localizedDefects,
      typographyCritique,
      ...(!passed ? { rejectionReason: postRejections[0] ?? typographyCritique.findings[0] ?? 'Falha nos critérios pós-render do Visual Concept Critic.' } : {}),
      criticNotes: notes,
    });

    return { critique, audit };
  }

  /**
   * Automatically repairs a concept rejected by the post-render visual audit so it can be re-rendered.
   */
  repairPostRenderConcept(
    concept: CreativeConceptProposal,
    critique: VisualConceptCritique,
    input: ConceptEngineInput,
  ): CreativeConceptProposal {
    const entities = extractNarrativeEntities(input);
    const updatedReqs = concept.mediaRequirements.map((req) => {
      if (concept.archetype === 'object_focus') {
        return {
          ...req,
          queryOrPrompt: `bright well-lit studio macro photography of ${entities.objectVisualDescriptor}, luminous key light, metallic reflections, high contrast details, clearly recognizable device, no dark shadow box, no text`,
        };
      }
      if (concept.archetype === 'before_after_comparison' && req.role === 'comparison_right') {
        return {
          ...req,
          acquisitionMode: 'ai_img2img' as const,
          transformFromRequirementId: concept.mediaRequirements[0]?.id ?? 'req-B-left',
          strength: 0.72,
          queryOrPrompt: `dramatically overcharged glowing transformation of the exact same ${entities.objectVisualDescriptor}, intense bright cyan and fiery orange energy surge, high contrast, no text`,
        };
      }
      if (concept.archetype === 'action_moment') {
        return {
          ...req,
          acquisitionMode: 'ai_generate' as const,
          provenance: 'ai_generated' as const,
          queryOrPrompt: `${entities.actionVisualDescriptor}, bright sparks, dynamic motion blur, unmistakable action in progress, no text`,
        };
      }
      return req;
    });

    return creativeConceptProposalSchema.parse({
      ...concept,
      id: `${concept.id}-repaired`,
      kickerText:
        concept.archetype === 'action_moment' && input.videoSourceType === 'synthetic_ai_clip'
          ? 'EM AÇÃO'
          : concept.kickerText,
      editorialRationale: `${concept.editorialRationale} [Reparado após auditoria visual: ${critique.rejectionReason ?? 'refino de clareza/contraste'}]`,
      mediaRequirements: updatedReqs,
    });
  }

  /**
   * Full CS-8 Concept-Driven Thumbnail Lab pipeline:
   * Ideate -> Pre-Render Critic -> Acquire Media -> Build -> Post-Render Visual Audit (with auto-repair & re-render).
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
    const usedHeadlines: string[] = [];
    const adapter = this.options?.imageAdapter;
    const isAdapterReady = adapter ? await adapter.isAvailable().catch(() => false) : false;

    for (let i = 0; i < finalConcepts.length; i += 1) {
      let concept = finalConcepts[i]!;
      const preRenderCritique = this.critiqueConceptsPreRender([concept], input)[0]!;
      let acquiredMedia = await this.acquireConceptMedia(concept, input);
      let document = this.buildConceptDocument(concept, acquiredMedia, input);
      let { critique: postRenderCritique, audit } = await this.critiqueRenderedConcept(
        concept,
        document,
        acquiredMedia,
        input,
        usedHeadlines,
      );

      // 4) Localized Inpainting Repair first when localized anatomical/mechanical defects are found
      if (
        !postRenderCritique.passed &&
        postRenderCritique.localizedDefects.length > 0 &&
        adapter?.inpaintRegion &&
        isAdapterReady &&
        acquiredMedia[0]
      ) {
        const defect = postRenderCritique.localizedDefects[0]!;
        const targetItem = acquiredMedia[acquiredMedia.length - 1]!;
        try {
          const absAssetPath = this.ingestion.resolvePortablePath(targetItem.asset.relativePath);
          const origBuf = await sharp(absAssetPath).png().toBuffer();
          const entities = extractNarrativeEntities(input);
          const repairedBuf = await adapter.inpaintRegion({
            imageBuffer: origBuf,
            bbox: defect.bbox,
            prompt: `clean symmetrical mechanical hardware module of ${entities.objectVisualDescriptor}, coherent structure, no fingers, no deformed joints, no text`,
            strength: 0.54,
          });
          const repairedAsset = await this.ingestion.ingestBuffer({
            buffer: repairedBuf,
            kind: 'image',
            extension: 'png',
            originalName: `${concept.id}-inpainted.png`,
          });
          rejectionHistoryByIndex[i]!.push({
            rejectedTitle: `${concept.title} (inpainting localizado em ${defect.category})`,
            reason: defect.description,
          });
          acquiredMedia = acquiredMedia.map((m, idx) =>
            idx === acquiredMedia.length - 1
              ? { ...m, asset: repairedAsset, description: `${m.description} [Inpaint localizado: ${defect.category}]` }
              : m,
          );
          document = this.buildConceptDocument(concept, acquiredMedia, input);
          const afterInpaint = await this.critiqueRenderedConcept(
            concept,
            document,
            acquiredMedia,
            input,
            usedHeadlines,
          );
          postRenderCritique = afterInpaint.critique;
          audit = afterInpaint.audit;
        } catch {
          // fall through to full concept repair if localized inpaint fails
        }
      }

      if (!postRenderCritique.passed) {
        rejectionHistoryByIndex[i]!.push({
          rejectedTitle: `${concept.title} (pós-render)`,
          reason: postRenderCritique.rejectionReason ?? 'Falha na auditoria visual pós-render.',
        });
        concept = this.repairPostRenderConcept(concept, postRenderCritique, input);
        acquiredMedia = await this.acquireConceptMedia(concept, input);
        document = this.buildConceptDocument(concept, acquiredMedia, input);
        const reAudited = await this.critiqueRenderedConcept(concept, document, acquiredMedia, input, usedHeadlines);
        postRenderCritique = reAudited.critique;
        audit = reAudited.audit;
      }

      if (concept.headlineText) {
        usedHeadlines.push(concept.headlineText);
      }

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
