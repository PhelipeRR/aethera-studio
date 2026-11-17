import { randomUUID } from 'node:crypto';
import {
  ART_SPECIFICATIONS,
  CREATIVE_PROJECT_SCHEMA_VERSION,
  creativeProjectDocumentSchema,
  type BrandKit,
  type CreativeArtType,
  type CreativeLayer,
  type CreativeProjectDocument,
  type ManagedAssetRef,
  type QualityAuditReport,
} from './schemas.js';
import type { QualityGateService } from './quality-gate.js';
import { CreativeDirectorAgent } from './creative-director.js';

export type ThumbnailVariantStyle = 'impact' | 'tech' | 'cinematic';

export interface CreativePlanInput {
  title?: string;
  headline?: string;
  prompt: string;
  scriptText?: string;
  artType: CreativeArtType;
  brandKit?: BrandKit | null;
  backgroundAsset?: ManagedAssetRef | null;
  subjectAsset?: ManagedAssetRef | null;
  secondarySubjectAsset?: ManagedAssetRef | null;
  variantBackgroundAssets?: Partial<Record<ThumbnailVariantStyle, ManagedAssetRef | null>>;
  variantSubjectAssets?: Partial<Record<ThumbnailVariantStyle, ManagedAssetRef | null>>;
  watermarkAsset?: ManagedAssetRef | null;
  sourceCinemaProjectId?: string;
  sourceVideoAssetId?: string;
  visualFocusRequired?: boolean;
  variantStyle?: ThumbnailVariantStyle;
  avatarBackdrop?: 'light' | 'dark' | 'transparent';
  /**
   * CF-1: where `backgroundAsset` came from. `ai_composed` = a full composition generated from the visual recipe
   * (characters, scenery, effects). It is shown crisp — no blur/darkening — and legibility comes from a soft local
   * scrim behind the text instead. Omitted = legacy treatment (photo/frame used as backdrop).
   */
  backgroundOrigin?: 'ai_composed' | 'media';
}

export interface ThumbnailLabVariant {
  label: 'A' | 'B' | 'C';
  style: ThumbnailVariantStyle;
  styleTitle: string;
  editorialRationale: string;
  document: CreativeProjectDocument;
  audit: QualityAuditReport;
}

function deriveShortHeadline(prompt: string, fallback: string): string {
  const cleaned = prompt
    .replace(/[^\p{L}\p{N}\s:!?-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length === 0) return fallback;
  return cleaned.slice(0, 4).join(' ').toUpperCase();
}

export interface TopicVisualBrief {
  kickerText: string;
  leadLine: string;
  impactLine: string;
  subtitleText: string;
  topicKeywords: string[];
  scriptEvidence: string[];
}

/**
 * Extracts generic editorial hierarchy and subject-matter keywords from any video prompt,
 * script/narration, and headline without hardcoding any specific franchise or genre.
 */
export function extractTopicVisualBrief(
  prompt: string,
  headline: string,
  title?: string,
  scriptText?: string,
  channelName?: string,
): TopicVisualBrief {
  const cleanWords = headline
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const channelTokens = new Set(
    (channelName ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  );
  const headlineTokens = new Set(cleanWords.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));

  const stop = new Set([
    'thumbnail',
    'banner',
    'avatar',
    'video',
    'vídeo',
    'sobre',
    'para',
    'como',
    'com',
    'alto',
    'impacto',
    'visual',
    'gamer',
    'oficial',
    'canal',
    'estilo',
    'melhores',
    'melhor',
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
    'neste',
    'nesta',
    'nesse',
    'nessa',
    'desse',
    'dessa',
    'revelamos',
    'mostramos',
    'apresentamos',
    'explicamos',
    'confira',
    'saiba',
    'about',
    'this',
    'that',
    'with',
    'from',
    'into',
  ]);
  const combinedSource = `${scriptText ?? ''} ${prompt} ${title ?? ''}`;
  const promptTokens = combinedSource
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w.toLowerCase()) && !channelTokens.has(w.toLowerCase()));
  const uniqueTokens = Array.from(new Set(promptTokens.map((t) => t.toUpperCase()))).slice(0, 6);
  const nonHeadlineTokens = uniqueTokens.filter((t) => !headlineTokens.has(t.toLowerCase()));

  const lowerPrompt = `${scriptText ?? ''} ${prompt} ${headline}`.toLowerCase();
  const kickerText = /guia|build|tutorial|dica|como/.test(lowerPrompt)
    ? 'GUIA & BUILD'
    : /segredo|secret|ocult|rar[oa]|escondid|mist[eé]rio/.test(lowerPrompt)
      ? 'REVELADO'
      : /an[aá]lise|review|teste|compar|explica/.test(lowerPrompt)
        ? 'ANÁLISE'
        : /hist[oó]ria|document[aá]rio|origem|caso/.test(lowerPrompt)
          ? 'HISTÓRIA REAL'
          : /epis[oó]dio|arco|personagem|anime|temporada/.test(lowerPrompt)
            ? 'ANÁLISE DE ARCO'
            : nonHeadlineTokens[0] ?? 'DESTAQUE';

  let leadLine = '';
  let impactLine = headline.toUpperCase();
  if (cleanWords.length >= 2) {
    const splitIdx = Math.ceil(cleanWords.length / 2);
    leadLine = cleanWords.slice(0, splitIdx).join(' ').toUpperCase();
    impactLine = cleanWords.slice(splitIdx).join(' ').toUpperCase();
  } else {
    leadLine = nonHeadlineTokens.find((t) => t !== impactLine) ?? 'EDIÇÃO';
  }

  const evidenceSlice = (nonHeadlineTokens.length > 0 ? nonHeadlineTokens : uniqueTokens).slice(0, 3);
  const subtitleText =
    evidenceSlice.length >= 2
      ? evidenceSlice.join(' • ')
      : evidenceSlice[0]
        ? `${kickerText}: ${evidenceSlice[0]}`
        : kickerText;

  return {
    kickerText,
    leadLine,
    impactLine,
    subtitleText,
    topicKeywords: uniqueTokens,
    scriptEvidence: evidenceSlice,
  };
}

/**
 * CF-1: a generated composition is the artwork, not a backdrop. The legacy treatment (blur up to 5px, brightness
 * 0.74, vignette 0.58) turned it into a dark blurry texture — one of the proven causes of "plain background with a
 * centred title". Blur/darkening stays only when a cut-out subject sits in front (depth separation).
 */
export function applyComposedBackgroundTreatment(
  layers: CreativeLayer[],
  palette: BrandKit['palette'],
  canvasW: number,
  canvasH: number,
): CreativeLayer[] {
  const hasSubject = layers.some((l) => l.type === 'subject' && l.visible);
  const next = layers.map((l) => {
    if (l.type !== 'background' || !l.assetId) return l;
    if (hasSubject) return { ...l, generatedByAi: true };
    return {
      ...l,
      generatedByAi: true,
      blurRadius: 0,
      brightness: 0.97,
      effects: l.effects.map((e) => (e.kind === 'vignette' ? { ...e, strength: Math.min(e.strength, 0.32) } : e)),
    };
  });
  const texts = next.filter((l) => l.type === 'text' && l.visible);
  if (texts.length === 0) return next;
  const feather = Math.round(Math.min(canvasW, canvasH) * 0.06);
  const pad = 36 + feather;
  const x0 = Math.max(0, Math.min(...texts.map((t) => t.transform.x)) - pad);
  const y0 = Math.max(0, Math.min(...texts.map((t) => t.transform.y)) - pad);
  const x1 = Math.min(canvasW, Math.max(...texts.map((t) => t.transform.x + t.transform.width)) + pad);
  const y1 = Math.min(canvasH, Math.max(...texts.map((t) => t.transform.y + t.transform.height)) + pad);
  const minTextZ = Math.min(...texts.map((t) => t.zIndex));
  next.push({
    id: 'scrim-text',
    type: 'shape',
    name: 'Véu de Legibilidade (atrás do texto)',
    zIndex: minTextZ - 1,
    visible: true,
    locked: false,
    opacity: 0.55,
    blendMode: 'over',
    shapeKind: 'rect',
    fillColor: palette.background,
    strokeWidth: 0,
    borderRadius: feather,
    featherPx: feather,
    transform: { x: x0, y: y0, width: x1 - x0, height: y1 - y0, scaleX: 1, scaleY: 1, rotationDeg: 0 },
    mask: { kind: 'none' },
    effects: [],
  });
  return next;
}

export class CompositionPlanner {
  buildDocument(input: CreativePlanInput): CreativeProjectDocument {
    const spec = ART_SPECIFICATIONS[input.artType];
    const now = new Date().toISOString();
    const id = `creative-${input.artType}-${randomUUID().slice(0, 10)}`;
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

    const resolvedSubjectAsset =
      input.subjectAsset ??
      (input.brandKit?.mascotAssetId
        ? (input.brandKit.assetManifest[input.brandKit.mascotAssetId] ?? null)
        : input.brandKit?.avatarAssetId
          ? (input.brandKit.assetManifest[input.brandKit.avatarAssetId] ?? null)
          : null);
    const resolvedWatermarkAsset =
      input.watermarkAsset ??
      (input.brandKit?.watermarkAssetId
        ? (input.brandKit.assetManifest[input.brandKit.watermarkAssetId] ?? null)
        : input.brandKit?.logoAssetId
          ? (input.brandKit.assetManifest[input.brandKit.logoAssetId] ?? null)
          : input.brandKit?.mascotAssetId
            ? (input.brandKit.assetManifest[input.brandKit.mascotAssetId] ?? null)
            : null);

    const assetManifest: Record<string, ManagedAssetRef> = {};
    if (input.backgroundAsset) assetManifest[input.backgroundAsset.id] = input.backgroundAsset;
    if (resolvedSubjectAsset) assetManifest[resolvedSubjectAsset.id] = resolvedSubjectAsset;
    if (input.secondarySubjectAsset) assetManifest[input.secondarySubjectAsset.id] = input.secondarySubjectAsset;
    if (resolvedWatermarkAsset) assetManifest[resolvedWatermarkAsset.id] = resolvedWatermarkAsset;

    const headline = (input.headline?.trim() || deriveShortHeadline(input.prompt, input.title ?? 'AETHERA STUDIO')).slice(
      0,
      48,
    );

    const brief = extractTopicVisualBrief(
      input.prompt,
      headline,
      input.title,
      input.scriptText,
      input.brandKit?.channelName,
    );

    let layers: CreativeLayer[] = [];

    if (input.artType === 'thumbnail') {
      layers = this.buildThumbnailLayers({
        width: spec.width,
        height: spec.height,
        headline,
        brief,
        style: input.variantStyle ?? 'impact',
        palette,
        typography,
        backgroundAsset: input.backgroundAsset ?? null,
        subjectAsset: resolvedSubjectAsset ?? null,
        secondarySubjectAsset: input.secondarySubjectAsset ?? null,
        watermarkAsset: resolvedWatermarkAsset ?? null,
      });
    } else if (input.artType === 'banner') {
      layers = this.buildBannerLayers({
        width: spec.width,
        height: spec.height,
        headline: input.headline?.trim() || input.brandKit?.channelName || headline,
        ...(input.brandKit?.slogan ? { slogan: input.brandKit.slogan } : {}),
        ...(input.brandKit?.niche ? { niche: input.brandKit.niche } : {}),
        brief,
        palette,
        typography,
        backgroundAsset: input.backgroundAsset ?? null,
        subjectAsset: resolvedSubjectAsset ?? null,
      });
    } else if (input.artType === 'avatar') {
      layers = this.buildAvatarLayers({
        width: spec.width,
        height: spec.height,
        monogram: (input.headline?.trim() || input.brandKit?.channelName || 'AE').slice(0, 3).toUpperCase(),
        backdrop: input.avatarBackdrop ?? 'dark',
        palette,
        typography,
        subjectAsset: resolvedSubjectAsset ?? null,
      });
    } else {
      layers = this.buildWatermarkLayers({
        width: spec.width,
        height: spec.height,
        label: (input.headline?.trim() || input.brandKit?.channelName || 'AETHERA').slice(0, 12).toUpperCase(),
        watermarkAsset: resolvedWatermarkAsset ?? resolvedSubjectAsset ?? null,
      });
    }

    if (input.backgroundOrigin === 'ai_composed' && (input.artType === 'banner' || input.artType === 'thumbnail')) {
      layers = applyComposedBackgroundTreatment(layers, palette, spec.width, spec.height);
    }

    return creativeProjectDocumentSchema.parse({
      schemaVersion: CREATIVE_PROJECT_SCHEMA_VERSION,
      id,
      title: input.title?.trim() || `${input.artType.toUpperCase()} — ${headline}`,
      artType: input.artType,
      width: spec.width,
      height: spec.height,
      ...(input.brandKit?.id ? { brandKitId: input.brandKit.id } : {}),
      ...(input.sourceCinemaProjectId ? { sourceCinemaProjectId: input.sourceCinemaProjectId } : {}),
      ...(input.sourceVideoAssetId ? { sourceVideoAssetId: input.sourceVideoAssetId } : {}),
      ...(input.visualFocusRequired !== undefined ? { visualFocusRequired: input.visualFocusRequired } : {}),
      prompt: input.prompt,
      layers,
      assetManifest,
      tags: [input.artType, input.variantStyle ?? 'default'],
      createdAt: now,
      updatedAt: now,
    });
  }

  async generateThumbnailLabVariations(
    input: Omit<CreativePlanInput, 'artType' | 'variantStyle'>,
    qualityGate: QualityGateService,
  ): Promise<ThumbnailLabVariant[]> {
    const variants: Array<{ label: 'A' | 'B' | 'C'; style: ThumbnailVariantStyle; styleTitle: string }> = [
      { label: 'A', style: 'impact', styleTitle: 'A — Close-Up de Impacto' },
      { label: 'B', style: 'tech', styleTitle: 'B — Evidência & Análise Editorial' },
      { label: 'C', style: 'cinematic', styleTitle: 'C — Narrativa Cinematográfica' },
    ];

    const brief = extractTopicVisualBrief(
      input.prompt,
      input.headline?.trim() || input.title || 'DESTAQUE',
      input.title,
      input.scriptText,
      input.brandKit?.channelName,
    );

    const director = new CreativeDirectorAgent();
    const results: ThumbnailLabVariant[] = [];
    for (const v of variants) {
      const bgForVariant = input.variantBackgroundAssets?.[v.style] ?? input.backgroundAsset ?? null;
      const subjForVariant = input.variantSubjectAssets?.[v.style] ?? input.subjectAsset ?? null;
      const planned = this.buildDocument({
        ...input,
        backgroundAsset: bgForVariant,
        subjectAsset: subjForVariant,
        artType: 'thumbnail',
        variantStyle: v.style,
        title: `${input.title ?? 'Thumbnail'} (${v.styleTitle})`,
      });
      const directed = await director.directWithIterativeReview(planned, qualityGate, {
        brandKit: input.brandKit ?? null,
        maxIterations: 3,
      });
      const focusSummary = brief.topicKeywords.slice(0, 3).join(', ') || brief.impactLine;
      const editorialRationale =
        v.style === 'impact'
          ? `Conceito A (Close-Up de Impacto): enquadramento fechado no sujeito à direita para máxima leitura emocional em miniatura mobile, combinado com título em 2 níveis de alto contraste à esquerda focado em ${focusSummary}.`
          : v.style === 'tech'
            ? `Conceito B (Evidência Editorial): sujeito em meio-corpo à esquerda integrado ao ambiente temático nítido à direita, sem barras decorativas, com bloco tipográfico factual baseado no roteiro (${brief.subtitleText}).`
            : `Conceito C (Narrativa Cinematográfica): composição assimétrica em plano aberto com respiro visual para o cenário de ${focusSummary}, iluminação atmosférica integrada e tipografia limpa em canto oposto ao sujeito.`;

      results.push({
        label: v.label,
        style: v.style,
        styleTitle: v.styleTitle,
        editorialRationale,
        document: directed.document,
        audit: directed.audit,
      });
    }

    return results;
  }

  private buildThumbnailLayers(params: {
    width: number;
    height: number;
    headline: string;
    brief: TopicVisualBrief;
    style: ThumbnailVariantStyle;
    palette: BrandKit['palette'];
    typography: BrandKit['typography'];
    backgroundAsset: ManagedAssetRef | null;
    subjectAsset: ManagedAssetRef | null;
    secondarySubjectAsset?: ManagedAssetRef | null;
    watermarkAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const {
      width,
      height,
      brief,
      style,
      palette,
      typography,
      backgroundAsset,
      subjectAsset,
      secondarySubjectAsset,
      watermarkAsset,
    } = params;
    // Never place an unblurred background that is the exact same asset as the hero cutout
    const distinctBackground =
      backgroundAsset && (!subjectAsset || backgroundAsset.id !== subjectAsset.id) ? backgroundAsset : null;

    const layers: CreativeLayer[] = [
      {
        id: 'bg-main',
        type: 'background',
        name: `Fundo Temático (${brief.topicKeywords[0] ?? style})`,
        zIndex: 0,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        ...(distinctBackground ? { assetId: distinctBackground.id } : {}),
        source: distinctBackground ? 'asset' : 'color',
        fillColor: palette.background,
        gradientTo: style === 'impact' ? palette.secondary : style === 'tech' ? palette.surface : '#050811',
        gradientAngleDeg: style === 'cinematic' ? 180 : style === 'tech' ? 90 : 135,
        blurRadius: distinctBackground ? (style === 'cinematic' ? 3.5 : style === 'tech' ? 1.5 : 5) : 0,
        brightness: style === 'cinematic' ? 0.78 : style === 'tech' ? 0.84 : 0.74,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'colorGrade',
            enabled: true,
            brightness: style === 'cinematic' ? 0.92 : 0.96,
            contrast: style === 'impact' ? 1.22 : 1.15,
            saturation: style === 'cinematic' ? 1.08 : 1.18,
          },
          { kind: 'vignette', enabled: true, strength: style === 'cinematic' ? 0.62 : 0.45, color: '#000000' },
        ],
      },
      {
        id: 'vfx-atmosphere',
        type: 'vfx',
        name: `Atmosfera (${style})`,
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: style === 'cinematic' ? 0.35 : 0.42,
        blendMode: 'screen',
        preset: style === 'impact' ? 'speed_lines' : style === 'tech' ? 'particles' : 'light_leak',
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        intensity: style === 'cinematic' ? 0.4 : 0.5,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
    ];

    // Three genuinely distinct framings & compositions (closeup right / medium left / wide cinematic right)
    const subjectTransform =
      style === 'impact'
        ? { x: 560, y: 16, width: 700, height: 704, scaleX: 1, scaleY: 1, rotationDeg: 0 }
        : style === 'tech'
          ? { x: 16, y: 40, width: 580, height: 680, scaleX: 1, scaleY: 1, rotationDeg: 0 }
          : { x: 630, y: 80, width: 630, height: 640, scaleX: 1, scaleY: 1, rotationDeg: 0 };

    const activeSubject = style === 'tech' && secondarySubjectAsset ? secondarySubjectAsset : subjectAsset;
    if (activeSubject) {
      layers.push({
        id: 'subject-hero',
        type: 'subject',
        name:
          style === 'impact'
            ? 'Close-Up Principal'
            : style === 'tech'
              ? 'Sujeito Editorial (Meio-Corpo)'
              : 'Sujeito Cinematográfico',
        zIndex: 2,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        assetId: activeSubject.id,
        removeBackground: true,
        cutoutMethod: 'rembg_semantic',
        ...(style !== 'cinematic' ? { rimLightColor: palette.primary } : {}),
        anchorBottom: true,
        groundFade: true,
        framing: style === 'impact' ? 'closeup' : style === 'tech' ? 'medium' : 'full',
        fitMode: 'contain',
        transform: subjectTransform,
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'dropShadow',
            enabled: true,
            offsetX: style === 'tech' ? 12 : -12,
            offsetY: 10,
            blur: 24,
            color: '#000000CC',
          },
          {
            kind: 'directionalLight',
            enabled: true,
            angleDeg: style === 'tech' ? 35 : 325,
            intensity: 0.34,
            color: palette.primary,
          },
        ],
      });
    }

    if (style === 'impact') {
      // A — Close-Up de Impacto: Kicker narrativo + título assimétrico de alto impacto à esquerda
      layers.push(
        {
          id: 'kicker-badge',
          type: 'text',
          role: 'kicker',
          name: 'Tag Editorial (Kicker)',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: brief.kickerText,
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
          transform: { x: 52, y: 92, width: 420, height: 54, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'title-lead',
          type: 'text',
          role: 'subtitle',
          name: 'Linha de Apoio Editorial',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: brief.leadLine,
          fontFamily: typography.headingFont,
          fontSize: 66,
          fontWeight: 900,
          color: '#FFFFFF',
          strokeColor: typography.strokeColor,
          strokeWidth: 7,
          align: 'left',
          letterSpacing: 2,
          lineHeight: 1.05,
          uppercase: true,
          transform: { x: 52, y: 170, width: 520, height: 110, scaleX: 1, scaleY: 1, rotationDeg: -1 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 5, blur: 12, color: '#000000DD' }],
        },
        {
          id: 'title-main',
          type: 'text',
          role: 'headline',
          name: 'Palavra de Impacto Principal',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: brief.impactLine,
          fontFamily: typography.headingFont,
          fontSize: 112,
          fontWeight: typography.titleWeight,
          color: palette.accent,
          strokeColor: typography.strokeColor,
          strokeWidth: 9,
          align: 'left',
          letterSpacing: 1,
          lineHeight: 1.02,
          uppercase: true,
          transform: { x: 52, y: 270, width: 530, height: 260, scaleX: 1, scaleY: 1, rotationDeg: -1.5 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 8, blur: 18, color: '#000000EE' }],
        },
      );
    } else if (style === 'tech') {
      // B — Evidência & Análise Editorial: sem barra decorativa; hierarquia limpa à direita + evidência do roteiro
      layers.push(
        {
          id: 'kicker-badge',
          type: 'text',
          role: 'kicker',
          name: 'Tag Editorial de Análise',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: brief.kickerText,
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
          pillRadius: 6,
          transform: { x: 650, y: 108, width: 420, height: 50, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'title-lead',
          type: 'text',
          role: 'subtitle',
          name: 'Título Editorial Superior',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: brief.leadLine,
          fontFamily: typography.headingFont,
          fontSize: 64,
          fontWeight: 900,
          color: '#FFFFFF',
          strokeColor: typography.strokeColor,
          strokeWidth: 7,
          align: 'left',
          letterSpacing: 2,
          lineHeight: 1.05,
          uppercase: true,
          transform: { x: 650, y: 184, width: 570, height: 100, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 5, blur: 12, color: '#000000DD' }],
        },
        {
          id: 'title-main',
          type: 'text',
          role: 'headline',
          name: 'Título Principal Editorial',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: brief.impactLine,
          fontFamily: typography.headingFont,
          fontSize: 102,
          fontWeight: typography.titleWeight,
          color: palette.primary,
          strokeColor: typography.strokeColor,
          strokeWidth: 8,
          align: 'left',
          letterSpacing: 2,
          lineHeight: 1.02,
          uppercase: true,
          transform: { x: 650, y: 276, width: 570, height: 170, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 7, blur: 16, color: '#000000EE' }],
        },
        {
          id: 'subtitle-topic',
          type: 'text',
          role: 'subtitle',
          name: 'Evidência do Roteiro',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 0.95,
          blendMode: 'over',
          text: brief.subtitleText,
          fontFamily: typography.bodyFont,
          fontSize: 28,
          fontWeight: 800,
          color: palette.accent,
          strokeColor: '#000000',
          strokeWidth: 4,
          align: 'left',
          letterSpacing: 2,
          lineHeight: 1.15,
          uppercase: true,
          transform: { x: 650, y: 454, width: 570, height: 84, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
      );
    } else {
      // C — Narrativa Cinematográfica: composição assimétrica em plano aberto (sem pílula genérica no topo)
      layers.push(
        {
          id: 'title-main',
          type: 'text',
          role: 'headline',
          name: 'Título Cinematográfico',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: `${brief.leadLine} ${brief.impactLine}`.trim(),
          fontFamily: typography.headingFont,
          fontSize: 82,
          fontWeight: typography.titleWeight,
          color: palette.text,
          strokeColor: typography.strokeColor,
          strokeWidth: 8,
          align: 'left',
          letterSpacing: 3,
          lineHeight: 1.06,
          uppercase: true,
          transform: { x: 56, y: 196, width: 560, height: 220, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 8, blur: 20, color: '#000000EE' }],
        },
        {
          id: 'subtitle-topic',
          type: 'text',
          role: 'subtitle',
          name: 'Contexto Narrativo',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 0.92,
          blendMode: 'over',
          text: brief.subtitleText,
          fontFamily: typography.bodyFont,
          fontSize: 28,
          fontWeight: 700,
          color: palette.accent,
          strokeColor: '#000000',
          strokeWidth: 4,
          align: 'left',
          letterSpacing: 2,
          lineHeight: 1.15,
          uppercase: true,
          transform: { x: 56, y: 428, width: 540, height: 80, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
      );
    }

    if (watermarkAsset) {
      const wmX = style === 'tech' ? width - 122 : style === 'impact' ? 52 : width - 122;
      layers.push({
        id: 'wm-brand',
        type: 'watermark',
        name: 'Marca d\'Água do Canal',
        zIndex: 5,
        visible: true,
        locked: false,
        opacity: 0.85,
        blendMode: 'over',
        assetId: watermarkAsset.id,
        monochrome: false,
        anchor: style === 'impact' ? 'bottom-left' : 'bottom-right',
        transform: { x: wmX, y: height - 116, width: 84, height: 84, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      });
    }

    return layers;
  }

  private buildBannerLayers(params: {
    width: number;
    height: number;
    headline: string;
    slogan?: string;
    niche?: string;
    brief: TopicVisualBrief;
    palette: BrandKit['palette'];
    typography: BrandKit['typography'];
    backgroundAsset: ManagedAssetRef | null;
    subjectAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const { width, height, headline, slogan, niche, palette, typography, backgroundAsset, subjectAsset } = params;
    const safe = ART_SPECIFICATIONS.banner.safeArea!;
    const distinctBackground =
      backgroundAsset && (!subjectAsset || backgroundAsset.id !== subjectAsset.id) ? backgroundAsset : null;

    const headlineWords = new Set(
      headline
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2),
    );
    const resolvedSlogan =
      slogan?.trim() ||
      (niche?.trim() && !headlineWords.has(niche.trim().toLowerCase())
        ? niche.trim()
        : 'CONTEÚDO ORIGINAL • ANÁLISES E HISTÓRIAS');

    const layers: CreativeLayer[] = [
      {
        id: 'bg-banner',
        type: 'background',
        name: 'Fundo Panorâmico Banner 2560×1440',
        zIndex: 0,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        ...(distinctBackground ? { assetId: distinctBackground.id } : {}),
        source: distinctBackground ? 'asset' : 'color',
        fillColor: palette.background,
        gradientTo: palette.surface,
        gradientAngleDeg: 120,
        blurRadius: distinctBackground ? 5 : 0,
        brightness: 0.74,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [{ kind: 'vignette', enabled: true, strength: 0.58, color: '#000000' }],
      },
      {
        id: 'vfx-banner',
        type: 'vfx',
        name: 'Atmosfera Panorâmica',
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: 0.35,
        blendMode: 'screen',
        preset: 'particles',
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        intensity: 0.45,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
    ];

    if (subjectAsset) {
      layers.push({
        id: 'subject-banner',
        type: 'subject',
        name: 'Mascote Persistente (Área Segura)',
        zIndex: 2,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        assetId: subjectAsset.id,
        removeBackground: true,
        cutoutMethod: 'rembg_semantic',
        anchorBottom: true,
        transform: {
          x: safe.x + safe.width - 410,
          y: safe.y + 18,
          width: 380,
          height: 380,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
        mask: { kind: 'none' },
        effects: [{ kind: 'dropShadow', enabled: true, offsetX: -8, offsetY: 10, blur: 20, color: '#000000CC' }],
      });
    }

    layers.push(
      {
        id: 'title-banner',
        type: 'text',
        role: 'headline',
        name: 'Título do Canal (Área Segura)',
        zIndex: 4,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        text: headline,
        fontFamily: typography.headingFont,
        fontSize: 108,
        fontWeight: typography.titleWeight,
        color: palette.text,
        strokeColor: typography.strokeColor,
        strokeWidth: 8,
        align: 'left',
        letterSpacing: 4,
        lineHeight: 1.06,
        uppercase: true,
        transform: {
          x: safe.x + 56,
          y: safe.y + 92,
          width: subjectAsset ? safe.width - 510 : safe.width - 140,
          height: 140,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
        mask: { kind: 'none' },
        effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 8, blur: 18, color: '#000000EE' }],
      },
      {
        id: 'subtitle-banner',
        type: 'text',
        role: 'subtitle',
        name: 'Slogan do Canal (Área Segura)',
        zIndex: 4,
        visible: true,
        locked: false,
        opacity: 0.96,
        blendMode: 'over',
        text: resolvedSlogan,
        fontFamily: typography.bodyFont,
        fontSize: 44,
        fontWeight: 800,
        color: palette.primary,
        strokeColor: '#000000',
        strokeWidth: 5,
        align: 'left',
        letterSpacing: 3,
        lineHeight: 1.12,
        uppercase: true,
        transform: {
          x: safe.x + 56,
          y: safe.y + 244,
          width: subjectAsset ? safe.width - 510 : safe.width - 140,
          height: 88,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
        mask: { kind: 'none' },
        effects: [],
      },
    );

    return layers;
  }

  private buildAvatarLayers(params: {
    width: number;
    height: number;
    monogram: string;
    backdrop: 'light' | 'dark' | 'transparent';
    palette: BrandKit['palette'];
    typography: BrandKit['typography'];
    subjectAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const { width, height, monogram, backdrop, palette, typography, subjectAsset } = params;
    const layers: CreativeLayer[] = [
      {
        id: 'bg-avatar',
        type: 'background',
        name: `Fundo Avatar (${backdrop})`,
        zIndex: 0,
        visible: backdrop !== 'transparent',
        locked: false,
        opacity: backdrop === 'transparent' ? 0 : 1,
        blendMode: 'over',
        fillColor: backdrop === 'light' ? '#F8FAFC' : palette.background,
        gradientTo: backdrop === 'light' ? '#E2E8F0' : palette.surface,
        gradientAngleDeg: 135,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'circle', cx: 0.5, cy: 0.5, radius: 0.49 },
        effects: [],
      },
      {
        id: 'ring-avatar',
        type: 'shape',
        name: 'Anel de Identidade',
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        shapeKind: 'circle',
        fillColor: backdrop === 'light' ? '#FFFFFF' : '#0F172A',
        strokeColor: palette.primary,
        strokeWidth: 18,
        borderRadius: 400,
        transform: { x: 40, y: 40, width: width - 80, height: height - 80, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
    ];

    if (subjectAsset) {
      layers.push({
        id: 'subject-avatar',
        type: 'subject',
        name: 'Mascote / Ícone',
        zIndex: 2,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        assetId: subjectAsset.id,
        removeBackground: true,
        cutoutMethod: 'chroma_edge',
        transform: { x: 120, y: 120, width: width - 240, height: height - 240, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'circle', cx: 0.5, cy: 0.5, radius: 0.48 },
        effects: [],
      });
    } else {
      layers.push({
        id: 'monogram-avatar',
        type: 'text',
        name: 'Monograma',
        zIndex: 2,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        text: monogram,
        fontFamily: typography.headingFont,
        fontSize: 240,
        fontWeight: 900,
        color: backdrop === 'light' ? '#0F172A' : palette.primary,
        strokeColor: palette.secondary,
        strokeWidth: 8,
        align: 'center',
        letterSpacing: 6,
        lineHeight: 1,
        uppercase: true,
        transform: { x: 100, y: 240, width: width - 200, height: 340, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      });
    }

    return layers;
  }

  private buildWatermarkLayers(params: {
    width: number;
    height: number;
    label: string;
    watermarkAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const { width, height, label, watermarkAsset } = params;
    return [
      {
        id: 'wm-main',
        type: 'watermark',
        name: 'Marca d\'Água Transparente',
        zIndex: 0,
        visible: true,
        locked: false,
        opacity: 0.8,
        blendMode: 'over',
        ...(watermarkAsset ? { assetId: watermarkAsset.id } : {}),
        label,
        monochrome: true,
        anchor: 'center',
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
    ];
  }
}
