import { z } from 'zod';

export const CREATIVE_PROJECT_SCHEMA_VERSION = 1 as const;

export const creativeArtTypeSchema = z.enum(['thumbnail', 'banner', 'avatar', 'watermark']);
export type CreativeArtType = z.infer<typeof creativeArtTypeSchema>;

export interface ArtSpecification {
  artType: CreativeArtType;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  aspectRatio: string;
  safeArea?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  requiresTransparency: boolean;
}

export const ART_SPECIFICATIONS: Record<CreativeArtType, ArtSpecification> = {
  thumbnail: {
    artType: 'thumbnail',
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    aspectRatio: '16:9',
    requiresTransparency: false,
  },
  banner: {
    artType: 'banner',
    width: 2560,
    height: 1440,
    minWidth: 2560,
    minHeight: 1440,
    aspectRatio: '16:9',
    safeArea: {
      x: Math.round((2560 - 1546) / 2),
      y: Math.round((1440 - 423) / 2),
      width: 1546,
      height: 423,
    },
    requiresTransparency: false,
  },
  avatar: {
    artType: 'avatar',
    width: 800,
    height: 800,
    minWidth: 800,
    minHeight: 800,
    aspectRatio: '1:1',
    requiresTransparency: false,
  },
  watermark: {
    artType: 'watermark',
    width: 150,
    height: 150,
    minWidth: 150,
    minHeight: 150,
    aspectRatio: '1:1',
    requiresTransparency: true,
  },
};

export const hexColorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

export const assetKindSchema = z.enum(['image', 'video', 'logo', 'font', 'reference', 'frame', 'cutout']);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const managedAssetRefSchema = z.object({
  id: z.string().min(1),
  kind: assetKindSchema,
  /** Portable relative path inside Creative Studio managed storage (never absolute). */
  relativePath: z.string().min(1).refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('..'), {
    message: 'Asset path must be portable and relative without traversal.',
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
  originalName: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().nonnegative().optional(),
  createdAt: z.string().min(1),
});
export type ManagedAssetRef = z.infer<typeof managedAssetRefSchema>;

export const brandKitSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1).optional(),
  channelName: z.string().min(1).max(120),
  slogan: z.string().max(160).optional(),
  niche: z.string().max(80).optional(),
  palette: z.object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
    accent: hexColorSchema,
    background: hexColorSchema,
    surface: hexColorSchema,
    text: hexColorSchema,
  }),
  typography: z.object({
    headingFont: z.string().min(1),
    bodyFont: z.string().min(1),
    titleWeight: z.number().int().min(100).max(900).default(800),
    strokeColor: hexColorSchema.default('#000000'),
    shadowColor: hexColorSchema.default('#000000CC'),
  }),
  logoAssetId: z.string().min(1).optional(),
  avatarAssetId: z.string().min(1).optional(),
  mascotAssetId: z.string().min(1).optional(),
  watermarkAssetId: z.string().min(1).optional(),
  assetManifest: z.record(z.string(), managedAssetRefSchema).default({}),
  thumbnailStyles: z.array(z.string().min(1)).default(['impact', 'tech', 'cinematic']),
  compositionPresets: z.array(z.string().min(1)).default([]),
  referenceAssetIds: z.array(z.string().min(1)).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

export const layerTransformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().positive(),
  height: z.number().positive(),
  scaleX: z.number().positive().default(1),
  scaleY: z.number().positive().default(1),
  rotationDeg: z.number().min(-360).max(360).default(0),
});
export type LayerTransform = z.infer<typeof layerTransformSchema>;

export const layerEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dropShadow'),
    enabled: z.boolean().default(true),
    offsetX: z.number().default(0),
    offsetY: z.number().default(8),
    blur: z.number().nonnegative().default(18),
    color: hexColorSchema.default('#000000B3'),
  }),
  z.object({
    kind: z.literal('outerGlow'),
    enabled: z.boolean().default(true),
    radius: z.number().nonnegative().default(24),
    intensity: z.number().min(0).max(1).default(0.75),
    color: hexColorSchema.default('#00F0FF'),
  }),
  z.object({
    kind: z.literal('motionBlur'),
    enabled: z.boolean().default(true),
    angleDeg: z.number().min(0).max(360).default(0),
    distance: z.number().nonnegative().max(80).default(12),
  }),
  z.object({
    kind: z.literal('vignette'),
    enabled: z.boolean().default(true),
    strength: z.number().min(0).max(1).default(0.45),
    color: hexColorSchema.default('#000000'),
  }),
  z.object({
    kind: z.literal('colorGrade'),
    enabled: z.boolean().default(true),
    brightness: z.number().min(0.2).max(2).default(1),
    contrast: z.number().min(0.2).max(2.5).default(1.1),
    saturation: z.number().min(0).max(2.5).default(1.15),
    tintColor: hexColorSchema.optional(),
  }),
  z.object({
    kind: z.literal('outline'),
    enabled: z.boolean().default(true),
    width: z.number().nonnegative().max(24).default(4),
    color: hexColorSchema.default('#000000'),
  }),
  z.object({
    kind: z.literal('depthBlur'),
    enabled: z.boolean().default(true),
    radius: z.number().nonnegative().max(40).default(6),
  }),
  z.object({
    kind: z.literal('directionalLight'),
    enabled: z.boolean().default(true),
    angleDeg: z.number().min(0).max(360).default(45),
    color: hexColorSchema.default('#00F0FF'),
    intensity: z.number().min(0).max(1).default(0.45),
  }),
]);
export type LayerEffect = z.infer<typeof layerEffectSchema>;

export const layerMaskSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
  }),
  z.object({
    kind: z.literal('circle'),
    cx: z.number().min(0).max(1).default(0.5),
    cy: z.number().min(0).max(1).default(0.5),
    radius: z.number().positive().max(1).default(0.48),
  }),
  z.object({
    kind: z.literal('rect'),
    x: z.number().min(0).max(1).default(0),
    y: z.number().min(0).max(1).default(0),
    width: z.number().positive().max(1).default(1),
    height: z.number().positive().max(1).default(1),
    borderRadius: z.number().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal('alphaCutout'),
    threshold: z.number().min(0).max(255).default(24),
    featherPx: z.number().nonnegative().max(32).default(2),
  }),
]);
export type LayerMask = z.infer<typeof layerMaskSchema>;

export const blendModeSchema = z.enum(['over', 'multiply', 'screen', 'overlay', 'add']);
export type BlendMode = z.infer<typeof blendModeSchema>;

const baseLayerFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  zIndex: z.number().int(),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: blendModeSchema.default('over'),
  transform: layerTransformSchema,
  mask: layerMaskSchema.default({ kind: 'none' }),
  effects: z.array(layerEffectSchema).default([]),
};

export const backgroundLayerSchema = z.object({
  ...baseLayerFields,
  type: z.literal('background'),
  source: z.enum(['asset', 'color', 'ai']).optional(),
  assetId: z.string().min(1).optional(),
  fillColor: hexColorSchema.default('#0B1020'),
  gradientTo: hexColorSchema.optional(),
  gradientAngleDeg: z.number().min(0).max(360).default(135),
  blurRadius: z.number().min(0).max(100).optional(),
  brightness: z.number().min(0).max(2).optional(),
  generatedByAi: z.boolean().optional(),
});

export const subjectLayerSchema = z.object({
  ...baseLayerFields,
  type: z.literal('subject'),
  assetId: z.string().min(1),
  removeBackground: z.boolean().default(false),
  cutoutMethod: z.enum(['none', 'chroma_edge', 'alpha_preserve', 'rembg_semantic', 'external_adapter']).default('none'),
  rimLightColor: hexColorSchema.optional(),
  anchorBottom: z.boolean().optional(),
  groundFade: z.boolean().optional(),
  framing: z.enum(['full', 'medium', 'closeup']).optional(),
  fitMode: z.enum(['contain', 'cover']).optional(),
});

export const textLayerSchema = z.object({
  ...baseLayerFields,
  type: z.literal('text'),
  role: z.enum(['headline', 'kicker', 'subtitle']).optional(),
  text: z.string().min(1),
  fontFamily: z.string().min(1).default('Arial Black'),
  fontSize: z.number().positive().max(400).default(96),
  fontWeight: z.number().int().min(100).max(900).default(900),
  color: hexColorSchema.default('#FFFFFF'),
  strokeColor: hexColorSchema.default('#000000'),
  strokeWidth: z.number().nonnegative().max(24).default(6),
  align: z.enum(['left', 'center', 'right']).default('left'),
  letterSpacing: z.number().min(-10).max(40).default(0),
  lineHeight: z.number().positive().max(3).default(1.05),
  uppercase: z.boolean().default(true),
  pillColor: hexColorSchema.optional(),
  pillRadius: z.number().nonnegative().max(40).optional(),
});

export const vfxLayerSchema = z.object({
  ...baseLayerFields,
  type: z.literal('vfx'),
  preset: z.enum(['particles', 'speed_lines', 'light_leak', 'cyber_grid', 'rim_glow', 'duotone_wash']),
  primaryColor: hexColorSchema.default('#00F0FF'),
  secondaryColor: hexColorSchema.default('#FF006E'),
  intensity: z.number().min(0).max(1).default(0.7),
});

export const shapeLayerSchema = z.object({
  ...baseLayerFields,
  type: z.literal('shape'),
  shapeKind: z.enum(['rect', 'circle', 'badge', 'frame']),
  fillColor: hexColorSchema.default('#111827'),
  strokeColor: hexColorSchema.optional(),
  strokeWidth: z.number().nonnegative().default(0),
  borderRadius: z.number().nonnegative().default(16),
});

export const watermarkLayerSchema = z.object({
  ...baseLayerFields,
  type: z.literal('watermark'),
  assetId: z.string().min(1).optional(),
  label: z.string().optional(),
  monochrome: z.boolean().default(false),
  anchor: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']).default('bottom-right'),
});

export const creativeLayerSchema = z.discriminatedUnion('type', [
  backgroundLayerSchema,
  subjectLayerSchema,
  textLayerSchema,
  vfxLayerSchema,
  shapeLayerSchema,
  watermarkLayerSchema,
]);
export type CreativeLayer = z.infer<typeof creativeLayerSchema>;

export const creativeProjectDocumentSchema = z.object({
  schemaVersion: z.literal(CREATIVE_PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1).max(180),
  artType: creativeArtTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  brandKitId: z.string().min(1).optional(),
  sourceCinemaProjectId: z.string().min(1).optional(),
  sourceVideoAssetId: z.string().min(1).optional(),
  prompt: z.string().default(''),
  layers: z.array(creativeLayerSchema).min(1),
  assetManifest: z.record(z.string(), managedAssetRefSchema).default({}),
  tags: z.array(z.string()).default([]),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type CreativeProjectDocument = z.infer<typeof creativeProjectDocumentSchema>;

export const exportFormatSchema = z.enum(['png', 'jpg', 'webp', 'project']);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const qualityAuditFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['critical', 'warning', 'info']),
  message: z.string().min(1),
  layerId: z.string().optional(),
});
export type QualityAuditFinding = z.infer<typeof qualityAuditFindingSchema>;

export const heuristicScorecardSchema = z.object({
  legibility: z.number().min(0).max(100),
  contrast: z.number().min(0).max(100),
  composition: z.number().min(0).max(100),
  brandConsistency: z.number().min(0).max(100),
  overall: z.number().min(0).max(100),
  disclaimer: z.literal('Heuristic visual quality score only; does not predict actual CTR.'),
});
export type HeuristicScorecard = z.infer<typeof heuristicScorecardSchema>;

export const qualityAuditReportSchema = z.object({
  projectId: z.string().min(1),
  artType: creativeArtTypeSchema,
  passed: z.boolean(),
  autoApprovable: z.boolean(),
  criticalCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  findings: z.array(qualityAuditFindingSchema),
  scorecard: heuristicScorecardSchema,
  checkedAt: z.string().min(1),
});
export type QualityAuditReport = z.infer<typeof qualityAuditReportSchema>;
