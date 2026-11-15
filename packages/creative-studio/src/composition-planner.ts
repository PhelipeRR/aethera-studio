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
  artType: CreativeArtType;
  brandKit?: BrandKit | null;
  backgroundAsset?: ManagedAssetRef | null;
  subjectAsset?: ManagedAssetRef | null;
  watermarkAsset?: ManagedAssetRef | null;
  sourceCinemaProjectId?: string;
  sourceVideoAssetId?: string;
  variantStyle?: ThumbnailVariantStyle;
  avatarBackdrop?: 'light' | 'dark' | 'transparent';
}

export interface ThumbnailLabVariant {
  label: 'A' | 'B' | 'C';
  style: ThumbnailVariantStyle;
  styleTitle: string;
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
}

/**
 * Extracts generic editorial hierarchy and subject-matter keywords from any video prompt/headline
 * without hardcoding any specific franchise or game.
 */
export function extractTopicVisualBrief(prompt: string, headline: string, title?: string): TopicVisualBrief {
  const cleanWords = headline
    .trim()
    .split(/\s+/)
    .filter(Boolean);

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
  ]);
  const promptTokens = `${prompt} ${title ?? ''}`
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stop.has(w.toLowerCase()));
  const uniqueTokens = Array.from(new Set(promptTokens.map((t) => t.toUpperCase()))).slice(0, 4);

  const lowerPrompt = `${prompt} ${headline}`.toLowerCase();
  const kickerText = /guia|build|tutorial|dica|como/.test(lowerPrompt)
    ? 'GUIA & BUILD'
    : /segredo|secret|ocult|rar[oa]|escondid/.test(lowerPrompt)
      ? 'REVELADO'
      : /an[aá]lise|review|teste|compar/.test(lowerPrompt)
        ? 'ANÁLISE PRO'
        : uniqueTokens[0] ?? 'DESTAQUE';

  let leadLine = '';
  let impactLine = headline.toUpperCase();
  if (cleanWords.length >= 2) {
    const splitIdx = Math.ceil(cleanWords.length / 2);
    leadLine = cleanWords.slice(0, splitIdx).join(' ').toUpperCase();
    impactLine = cleanWords.slice(splitIdx).join(' ').toUpperCase();
  } else {
    leadLine = uniqueTokens.find((t) => t !== impactLine) ?? 'EDIÇÃO';
  }

  const subtitleTokens = uniqueTokens.slice(0, 3);
  const subtitleText =
    subtitleTokens.length >= 2
      ? subtitleTokens.join(' • ')
      : `${kickerText} • ${impactLine}`;

  return {
    kickerText,
    leadLine,
    impactLine,
    subtitleText,
    topicKeywords: uniqueTokens,
  };
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
    if (resolvedWatermarkAsset) assetManifest[resolvedWatermarkAsset.id] = resolvedWatermarkAsset;

    const headline = (input.headline?.trim() || deriveShortHeadline(input.prompt, input.title ?? 'AETHERA STUDIO')).slice(
      0,
      48,
    );

    const brief = extractTopicVisualBrief(input.prompt, headline, input.title);

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
        watermarkAsset: resolvedWatermarkAsset ?? null,
      });
    } else if (input.artType === 'banner') {
      layers = this.buildBannerLayers({
        width: spec.width,
        height: spec.height,
        headline: input.headline?.trim() || input.brandKit?.channelName || headline,
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
      { label: 'A', style: 'impact', styleTitle: 'A — Impacto' },
      { label: 'B', style: 'tech', styleTitle: 'B — Tecnologia' },
      { label: 'C', style: 'cinematic', styleTitle: 'C — Cinematográfica' },
    ];

    const director = new CreativeDirectorAgent();
    const results: ThumbnailLabVariant[] = [];
    for (const v of variants) {
      const planned = this.buildDocument({
        ...input,
        artType: 'thumbnail',
        variantStyle: v.style,
        title: `${input.title ?? 'Thumbnail'} (${v.styleTitle})`,
      });
      const directed = await director.directWithIterativeReview(planned, qualityGate, {
        brandKit: input.brandKit ?? null,
        maxIterations: 3,
      });
      results.push({
        label: v.label,
        style: v.style,
        styleTitle: v.styleTitle,
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
    watermarkAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const { width, height, brief, style, palette, typography, backgroundAsset, subjectAsset, watermarkAsset } = params;
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
        blurRadius: distinctBackground ? (style === 'cinematic' ? 9 : style === 'tech' ? 6 : 4) : 0,
        brightness: style === 'cinematic' ? 0.68 : style === 'tech' ? 0.74 : 0.80,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'colorGrade',
            enabled: true,
            brightness: style === 'cinematic' ? 0.86 : 0.94,
            contrast: style === 'impact' ? 1.25 : 1.18,
            saturation: style === 'cinematic' ? 1.08 : 1.24,
          },
          { kind: 'vignette', enabled: true, strength: style === 'cinematic' ? 0.72 : 0.52, color: '#000000' },
        ],
      },
      {
        id: 'vfx-atmosphere',
        type: 'vfx',
        name: `Atmosfera (${style})`,
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: style === 'cinematic' ? 0.5 : 0.65,
        blendMode: 'screen',
        preset: style === 'impact' ? 'speed_lines' : style === 'tech' ? 'particles' : 'light_leak',
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        intensity: style === 'cinematic' ? 0.55 : 0.72,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
    ];

    // Dominant, bottom-anchored editorial subject framing (no floating stickers!)
    const subjectTransform =
      style === 'impact'
        ? { x: 560, y: 24, width: 700, height: 696, scaleX: 1, scaleY: 1, rotationDeg: 0 }
        : style === 'tech'
          ? { x: 16, y: 36, width: 650, height: 684, scaleX: 1, scaleY: 1, rotationDeg: 0 }
          : { x: 240, y: 175, width: 800, height: 545, scaleX: 1, scaleY: 1, rotationDeg: 0 };

    if (subjectAsset) {
      layers.push({
        id: 'subject-hero',
        type: 'subject',
        name: 'Sujeito Principal Dominante',
        zIndex: 2,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        assetId: subjectAsset.id,
        removeBackground: true,
        cutoutMethod: 'rembg_semantic',
        rimLightColor: style === 'impact' ? palette.accent : style === 'tech' ? palette.primary : palette.secondary,
        anchorBottom: true,
        groundFade: true,
        transform: subjectTransform,
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'dropShadow',
            enabled: true,
            offsetX: style === 'tech' ? 12 : -12,
            offsetY: 10,
            blur: 28,
            color: '#000000DD',
          },
          {
            kind: 'directionalLight',
            enabled: true,
            angleDeg: style === 'tech' ? 35 : 325,
            intensity: 0.42,
            color: style === 'impact' ? palette.accent : palette.primary,
          },
        ],
      });
    }

    if (style === 'impact') {
      // A — Editorial Impact: Kicker Pill + Two-Tier Asymmetric Display Left
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
      // B — Technical HUD Split: Thin Accent Bar + Kicker + High-Contrast Telemetry Typography Right
      layers.push(
        {
          id: 'accent-bar-tech',
          type: 'shape',
          name: 'Barra Editorial Tech',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 0.95,
          blendMode: 'over',
          shapeKind: 'rect',
          fillColor: palette.primary,
          strokeWidth: 0,
          borderRadius: 4,
          transform: { x: 662, y: 108, width: 8, height: 390, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'kicker-badge',
          type: 'text',
          role: 'kicker',
          name: 'Tag Técnica',
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
          transform: { x: 690, y: 108, width: 420, height: 50, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'title-lead',
          type: 'text',
          role: 'subtitle',
          name: 'Título Técnico Superior',
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
          transform: { x: 690, y: 184, width: 540, height: 100, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 5, blur: 12, color: '#000000DD' }],
        },
        {
          id: 'title-main',
          type: 'text',
          role: 'headline',
          name: 'Título Principal HUD',
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
          transform: { x: 690, y: 276, width: 540, height: 170, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 7, blur: 16, color: '#000000EE' }],
        },
        {
          id: 'subtitle-topic',
          type: 'text',
          role: 'subtitle',
          name: 'Contexto Temático',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 0.95,
          blendMode: 'over',
          text: brief.subtitleText,
          fontFamily: typography.bodyFont,
          fontSize: 30,
          fontWeight: 800,
          color: palette.accent,
          strokeColor: '#000000',
          strokeWidth: 4,
          align: 'left',
          letterSpacing: 3,
          lineHeight: 1.1,
          uppercase: true,
          transform: { x: 690, y: 454, width: 540, height: 84, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
      );
    } else {
      // C — Cinematic Poster: Monumental Top Two-Tier Typography + Centered Hero Close-Up
      layers.push(
        {
          id: 'kicker-badge',
          type: 'text',
          role: 'kicker',
          name: 'Tag Cinematográfica',
          zIndex: 3,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: brief.kickerText,
          fontFamily: typography.headingFont,
          fontSize: 26,
          fontWeight: 900,
          color: '#FFFFFF',
          strokeColor: '#000000',
          strokeWidth: 0,
          align: 'center',
          letterSpacing: 4,
          lineHeight: 1.1,
          uppercase: true,
          pillColor: palette.secondary,
          pillRadius: 8,
          transform: { x: 440, y: 20, width: 400, height: 46, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'title-main',
          type: 'text',
          role: 'headline',
          name: 'Título Monumental Poster',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'over',
          text: `${brief.leadLine} ${brief.impactLine}`,
          fontFamily: typography.headingFont,
          fontSize: 88,
          fontWeight: typography.titleWeight,
          color: palette.text,
          strokeColor: typography.strokeColor,
          strokeWidth: 9,
          align: 'center',
          letterSpacing: 4,
          lineHeight: 1.04,
          uppercase: true,
          transform: { x: 80, y: 74, width: 1120, height: 120, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [{ kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 8, blur: 20, color: '#000000EE' }],
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
    brief: TopicVisualBrief;
    palette: BrandKit['palette'];
    typography: BrandKit['typography'];
    backgroundAsset: ManagedAssetRef | null;
    subjectAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const { width, height, headline, brief, palette, typography, backgroundAsset, subjectAsset } = params;
    const safe = ART_SPECIFICATIONS.banner.safeArea!;
    const distinctBackground =
      backgroundAsset && (!subjectAsset || backgroundAsset.id !== subjectAsset.id) ? backgroundAsset : null;

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
        blurRadius: distinctBackground ? 7 : 0,
        brightness: 0.72,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [{ kind: 'vignette', enabled: true, strength: 0.62, color: '#000000' }],
      },
      {
        id: 'vfx-banner',
        type: 'vfx',
        name: 'Partículas Panorâmicas',
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: 0.55,
        blendMode: 'screen',
        preset: 'particles',
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        intensity: 0.65,
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
        rimLightColor: palette.primary,
        anchorBottom: true,
        transform: {
          x: safe.x + safe.width - 420,
          y: safe.y + 18,
          width: 390,
          height: 390,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
        mask: { kind: 'none' },
        effects: [{ kind: 'dropShadow', enabled: true, offsetX: -10, offsetY: 12, blur: 24, color: '#000000DD' }],
      });
    }

    layers.push(
      {
        id: 'banner-accent-bar',
        type: 'shape',
        name: 'Barra Editorial do Canal',
        zIndex: 3,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        shapeKind: 'rect',
        fillColor: palette.primary,
        strokeWidth: 0,
        borderRadius: 4,
        transform: { x: safe.x + 48, y: safe.y + 78, width: 10, height: 268, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
      {
        id: 'banner-kicker',
        type: 'text',
        role: 'kicker',
        name: 'Tag de Identidade do Canal',
        zIndex: 3,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        text: brief.kickerText,
        fontFamily: typography.headingFont,
        fontSize: 32,
        fontWeight: 900,
        color: '#070B14',
        strokeColor: '#070B14',
        strokeWidth: 0,
        align: 'left',
        letterSpacing: 3,
        lineHeight: 1.1,
        uppercase: true,
        pillColor: palette.accent,
        pillRadius: 6,
        transform: { x: safe.x + 80, y: safe.y + 76, width: 420, height: 54, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
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
        fontSize: 104,
        fontWeight: typography.titleWeight,
        color: palette.text,
        strokeColor: typography.strokeColor,
        strokeWidth: 8,
        align: 'left',
        letterSpacing: 4,
        lineHeight: 1.06,
        uppercase: true,
        transform: {
          x: safe.x + 80,
          y: safe.y + 148,
          width: subjectAsset ? safe.width - 540 : safe.width - 180,
          height: 130,
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
        name: 'Subtítulo do Canal (Área Segura)',
        zIndex: 4,
        visible: true,
        locked: false,
        opacity: 0.95,
        blendMode: 'over',
        text: brief.subtitleText,
        fontFamily: typography.bodyFont,
        fontSize: 36,
        fontWeight: 800,
        color: palette.primary,
        strokeColor: '#000000',
        strokeWidth: 4,
        align: 'left',
        letterSpacing: 4,
        lineHeight: 1.1,
        uppercase: true,
        transform: {
          x: safe.x + 80,
          y: safe.y + 286,
          width: subjectAsset ? safe.width - 540 : safe.width - 180,
          height: 60,
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
