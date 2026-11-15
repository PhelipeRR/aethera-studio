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

    let layers: CreativeLayer[] = [];

    if (input.artType === 'thumbnail') {
      layers = this.buildThumbnailLayers({
        width: spec.width,
        height: spec.height,
        headline,
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
      const doc = director.reviewAndRefine(planned, { brandKit: input.brandKit ?? null }).document;
      const audit = await qualityGate.auditProject(doc, { brandKit: input.brandKit ?? null });
      results.push({
        label: v.label,
        style: v.style,
        styleTitle: v.styleTitle,
        document: doc,
        audit,
      });
    }

    return results;
  }

  private buildThumbnailLayers(params: {
    width: number;
    height: number;
    headline: string;
    style: ThumbnailVariantStyle;
    palette: BrandKit['palette'];
    typography: BrandKit['typography'];
    backgroundAsset: ManagedAssetRef | null;
    subjectAsset: ManagedAssetRef | null;
    watermarkAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const { width, height, headline, style, palette, typography, backgroundAsset, subjectAsset, watermarkAsset } = params;
    // Never place an unblurred background that is the exact same asset as the hero cutout
    const distinctBackground =
      backgroundAsset && (!subjectAsset || backgroundAsset.id !== subjectAsset.id) ? backgroundAsset : null;

    const layers: CreativeLayer[] = [
      {
        id: 'bg-main',
        type: 'background',
        name: 'Fundo Principal',
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
        blurRadius: distinctBackground ? (style === 'cinematic' ? 6 : 3) : 0,
        brightness: style === 'cinematic' ? 0.78 : 0.88,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'colorGrade',
            enabled: true,
            brightness: style === 'cinematic' ? 0.86 : 0.94,
            contrast: style === 'impact' ? 1.24 : 1.15,
            saturation: style === 'cinematic' ? 1.08 : 1.22,
          },
          { kind: 'vignette', enabled: true, strength: style === 'cinematic' ? 0.68 : 0.45, color: '#000000' },
        ],
      },
      {
        id: 'vfx-scrim',
        type: 'vfx',
        name: 'Scrim de Contraste',
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: style === 'cinematic' ? 0.72 : 0.62,
        blendMode: 'multiply',
        preset: 'duotone_wash',
        primaryColor: '#000000',
        secondaryColor: palette.background,
        intensity: 0.75,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
      {
        id: 'vfx-style',
        type: 'vfx',
        name: `VFX (${style})`,
        zIndex: 2,
        visible: true,
        locked: false,
        opacity: style === 'cinematic' ? 0.55 : 0.78,
        blendMode: 'screen',
        preset: style === 'impact' ? 'speed_lines' : style === 'tech' ? 'cyber_grid' : 'light_leak',
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        intensity: style === 'cinematic' ? 0.65 : 0.82,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [],
      },
    ];

    // Layout 1: Impact (Subject Right, Bold Stacked Title Left)
    // Layout 2: Tech (Subject Left, Telemetry HUD Title Right)
    // Layout 3: Cinematic (Subject Centered Lower, Top Widescreen Monumental Title + Letterbox Framing)
    const subjectTransform =
      style === 'impact'
        ? { x: 590, y: 20, width: 660, height: 700, scaleX: 1, scaleY: 1, rotationDeg: -1.5 }
        : style === 'tech'
          ? { x: 24, y: 30, width: 610, height: 690, scaleX: 1, scaleY: 1, rotationDeg: 0 }
          : { x: 310, y: 150, width: 660, height: 570, scaleX: 1, scaleY: 1, rotationDeg: 0 };

    if (subjectAsset) {
      layers.push({
        id: 'subject-hero',
        type: 'subject',
        name: 'Sujeito / Personagem',
        zIndex: 3,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'over',
        assetId: subjectAsset.id,
        removeBackground: true,
        cutoutMethod: 'rembg_semantic',
        rimLightColor: style === 'impact' ? palette.accent : style === 'tech' ? palette.primary : palette.secondary,
        transform: subjectTransform,
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'dropShadow',
            enabled: true,
            offsetX: style === 'tech' ? 10 : -10,
            offsetY: 12,
            blur: 24,
            color: '#000000CC',
          },
          {
            kind: 'directionalLight',
            enabled: true,
            angleDeg: style === 'tech' ? 35 : 325,
            intensity: 0.45,
            color: style === 'impact' ? palette.accent : palette.primary,
          },
        ],
      });
    }

    const titleConfig =
      style === 'impact'
        ? {
            x: 48,
            y: 125,
            width: 530,
            height: 440,
            align: 'left' as const,
            fontSize: 98,
            color: palette.accent,
            letterSpacing: 1,
            rotationDeg: -1.5,
          }
        : style === 'tech'
          ? {
              x: 645,
              y: 145,
              width: 585,
              height: 420,
              align: 'right' as const,
              fontSize: 86,
              color: palette.primary,
              letterSpacing: 3,
              rotationDeg: 0,
            }
          : {
              x: 100,
              y: 28,
              width: 1080,
              height: 150,
              align: 'center' as const,
              fontSize: 82,
              color: palette.text,
              letterSpacing: 5,
              rotationDeg: 0,
            };

    layers.push({
      id: 'title-main',
      type: 'text',
      name: 'Título Principal',
      zIndex: 4,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'over',
      text: headline,
      fontFamily: typography.headingFont,
      fontSize: titleConfig.fontSize,
      fontWeight: typography.titleWeight,
      color: titleConfig.color,
      strokeColor: typography.strokeColor,
      strokeWidth: 8,
      align: titleConfig.align,
      letterSpacing: titleConfig.letterSpacing,
      lineHeight: 1.04,
      uppercase: true,
      transform: {
        x: titleConfig.x,
        y: titleConfig.y,
        width: titleConfig.width,
        height: titleConfig.height,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: titleConfig.rotationDeg,
      },
      mask: { kind: 'none' },
      effects: [
        { kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 6, blur: 16, color: '#000000DD' },
      ],
    });

    if (watermarkAsset) {
      const wmX = style === 'tech' ? width - 130 : style === 'impact' ? 48 : width - 130;
      layers.push({
        id: 'wm-brand',
        type: 'watermark',
        name: 'Marca d\'Água do Canal',
        zIndex: 5,
        visible: true,
        locked: false,
        opacity: 0.78,
        blendMode: 'over',
        assetId: watermarkAsset.id,
        monochrome: false,
        anchor: style === 'impact' ? 'bottom-left' : 'bottom-right',
        transform: { x: wmX, y: height - 122, width: 88, height: 88, scaleX: 1, scaleY: 1, rotationDeg: 0 },
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
    palette: BrandKit['palette'];
    typography: BrandKit['typography'];
    backgroundAsset: ManagedAssetRef | null;
    subjectAsset: ManagedAssetRef | null;
  }): CreativeLayer[] {
    const { width, height, headline, palette, typography, backgroundAsset, subjectAsset } = params;
    const safe = ART_SPECIFICATIONS.banner.safeArea!;
    const distinctBackground =
      backgroundAsset && (!subjectAsset || backgroundAsset.id !== subjectAsset.id) ? backgroundAsset : null;

    const layers: CreativeLayer[] = [
      {
        id: 'bg-banner',
        type: 'background',
        name: 'Fundo Banner 2560×1440',
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
        blurRadius: distinctBackground ? 8 : 0,
        brightness: 0.75,
        transform: { x: 0, y: 0, width, height, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [{ kind: 'vignette', enabled: true, strength: 0.55, color: '#000000' }],
      },
      {
        id: 'vfx-banner',
        type: 'vfx',
        name: 'Grid Futurista',
        zIndex: 1,
        visible: true,
        locked: false,
        opacity: 0.65,
        blendMode: 'screen',
        preset: 'cyber_grid',
        primaryColor: palette.primary,
        secondaryColor: palette.secondary,
        intensity: 0.7,
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
        transform: {
          x: safe.x + safe.width - 420,
          y: safe.y + 18,
          width: 385,
          height: 385,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
        mask: { kind: 'none' },
        effects: [
          { kind: 'dropShadow', enabled: true, offsetX: -8, offsetY: 10, blur: 20, color: '#000000CC' },
        ],
      });
    }

    layers.push({
      id: 'title-banner',
      type: 'text',
      name: 'Título do Canal (Área Segura)',
      zIndex: 3,
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
      align: subjectAsset ? 'left' : 'center',
      letterSpacing: 4,
      lineHeight: 1.08,
      uppercase: true,
      transform: {
        x: subjectAsset ? safe.x + 56 : safe.x + 120,
        y: safe.y + 125,
        width: subjectAsset ? safe.width - 520 : safe.width - 240,
        height: 200,
        scaleX: 1,
        scaleY: 1,
        rotationDeg: 0,
      },
      mask: { kind: 'none' },
      effects: [
        { kind: 'dropShadow', enabled: true, offsetX: 0, offsetY: 6, blur: 16, color: '#000000DD' },
      ],
    });

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
