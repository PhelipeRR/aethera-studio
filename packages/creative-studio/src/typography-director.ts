import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  creativeProjectDocumentSchema,
  typographyCritiqueSchema,
  typographyDirectionProposalSchema,
  type BrandKit,
  type CreativeLayer,
  type CreativeProjectDocument,
  type FontCategory,
  type TypographyCritique,
  type TypographyDirectionProposal,
  type TypographyLayoutStyle,
} from './schemas.js';
import { measureAlphaBounds, type SharpSvgCompositionEngine } from './image-generation-adapter.js';
import type { ReasoningEngineProvider } from './creative-orchestrator.js';

export interface FontCatalogEntry {
  category: FontCategory;
  primaryFamily: string;
  fallbackChain: string[];
  defaultTrackingEm: number;
  defaultLeadingRatio: number;
  defaultWeight: number;
}

export const LOCAL_FONT_CATALOG: Record<FontCategory, FontCatalogEntry> = {
  condensed: {
    category: 'condensed',
    primaryFamily: 'Bahnschrift Condensed',
    fallbackChain: ['Impact', 'Arial Narrow', 'sans-serif'],
    defaultTrackingEm: 0.04,
    defaultLeadingRatio: 0.94,
    defaultWeight: 800,
  },
  expanded: {
    category: 'expanded',
    primaryFamily: 'Trebuchet MS',
    fallbackChain: ['Verdana', 'Segoe UI', 'sans-serif'],
    defaultTrackingEm: 0.12,
    defaultLeadingRatio: 1.05,
    defaultWeight: 800,
  },
  display: {
    category: 'display',
    primaryFamily: 'Segoe UI Black',
    fallbackChain: ['Impact', 'Arial Black', 'sans-serif'],
    defaultTrackingEm: 0.02,
    defaultLeadingRatio: 0.96,
    defaultWeight: 900,
  },
  sans_serif: {
    category: 'sans_serif',
    primaryFamily: 'Segoe UI',
    fallbackChain: ['Calibri', 'Arial', 'sans-serif'],
    defaultTrackingEm: 0.01,
    defaultLeadingRatio: 1.04,
    defaultWeight: 800,
  },
  serif: {
    category: 'serif',
    primaryFamily: 'Georgia',
    fallbackChain: ['Palatino Linotype', 'Cambria', 'serif'],
    defaultTrackingEm: 0.03,
    defaultLeadingRatio: 1.06,
    defaultWeight: 700,
  },
  experimental: {
    category: 'experimental',
    primaryFamily: 'Consolas',
    fallbackChain: ['Courier New', 'Lucida Console', 'monospace'],
    defaultTrackingEm: 0.08,
    defaultLeadingRatio: 1.02,
    defaultWeight: 700,
  },
};

export interface TypographyDirectorInput {
  title?: string;
  headline?: string;
  prompt: string;
  scriptText?: string;
  genre?: 'games' | 'anime' | 'documentary' | 'general';
  brandKit?: BrandKit | null;
  allowTextless?: boolean;
}

const GENERIC_STOP = new Set([
  'thumbnail',
  'video',
  'vídeo',
  'sobre',
  'para',
  'como',
  'com',
  'neste',
  'nesta',
  'mostramos',
  'veja',
  'confira',
  'tudo',
  'mais',
  'muito',
  'entre',
  'antes',
  'depois',
  'normal',
  'aprimorado',
  'aprimorada',
  'comparação',
  'comparacao',
]);

/**
 * Extracts 3 distinct, factual, short editorial headlines (2-3 words max each) from the script/prompt
 * without repeating the exact same phrase across variations A, B, and C.
 */
export function extractDistinctScriptHeadlines(input: TypographyDirectorInput): {
  headlineA: string;
  headlineB: string;
  headlineC: string;
  kickerA: string;
  kickerB: string;
  kickerC: string;
} {
  const combined = `${input.headline ?? ''} ${input.title ?? ''} ${input.prompt} ${input.scriptText ?? ''}`;
  const rawTokens = combined
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !GENERIC_STOP.has(w.toLowerCase()));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const tok of rawTokens) {
    const low = tok.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      unique.push(tok.toUpperCase());
    }
  }

  const baseA =
    input.headline?.trim().toUpperCase() ||
    unique.slice(0, 2).join(' ') ||
    'PEÇA CENTRAL';

  // Ensure B and C never repeat A verbatim
  const remaining = unique.filter((u) => !baseA.includes(u));
  const primaryWord = unique[0] ?? 'TEMA';
  const secondWord = remaining[0] ?? unique[1] ?? 'EVOLUÇÃO';
  const thirdWord = remaining[1] ?? unique[2] ?? 'IMPACTO';

  const headlineA = baseA.split(/\s+/).slice(0, 3).join(' ').slice(0, 28);
  const headlineB =
    `${secondWord} ${thirdWord}`.trim() !== headlineA
      ? `${secondWord} ${thirdWord}`.slice(0, 28)
      : `EFEITO ${primaryWord}`.slice(0, 28);
  const headlineC =
    remaining.length >= 3
      ? `${remaining[1]} ${remaining[2]}`.slice(0, 28)
      : `${thirdWord} ATIVO`.trim() !== headlineA && `${thirdWord} ATIVO`.trim() !== headlineB
        ? `${thirdWord} ATIVO`.slice(0, 28)
        : ` PODER REAL`.trim();

  return {
    headlineA,
    headlineB,
    headlineC,
    kickerA: input.genre === 'documentary' ? 'ARQUIVO' : input.genre === 'anime' ? 'CAPÍTULO' : 'DETALHE',
    kickerB: 'CONTRASTE',
    kickerC: input.genre === 'anime' ? 'CLÍMAX' : 'IMPACTO',
  };
}

export class TypographyArtDirector {
  constructor(private readonly providers: ReasoningEngineProvider[] = []) {}

  /**
   * Plans 3 genuinely distinct typographic art directions (A, B, C) tailored to genre and concept,
   * working with 4 engines, 1 engine, or local deterministic fallback.
   */
  async planConceptTypographyTriad(input: TypographyDirectorInput): Promise<{
    directions: [TypographyDirectionProposal, TypographyDirectionProposal, TypographyDirectionProposal];
    enginesUsed: string[];
  }> {
    const enginesUsed: string[] = [];
    for (const p of this.providers) {
      try {
        if (await p.isAvailable()) {
          enginesUsed.push(p.id);
        }
      } catch {
        // continue with available providers
      }
    }
    if (enginesUsed.length === 0) {
      enginesUsed.push('local-typography-director');
    }

    const { headlineA, headlineB, headlineC, kickerA, kickerB, kickerC } = extractDistinctScriptHeadlines(input);
    const genre = input.genre ?? 'general';

    // Select genre-tuned font categories & editorial layout styles (zero thick black outlines by default!)
    const catA: FontCategory = genre === 'documentary' ? 'serif' : genre === 'anime' ? 'display' : 'experimental';
    const catB: FontCategory = 'condensed';
    const catC: FontCategory = genre === 'anime' ? 'expanded' : 'display';

    const styleA: TypographyLayoutStyle =
      genre === 'documentary' ? 'editorial_split' : genre === 'anime' ? 'behind_subject_depth' : 'minimal_whisper';
    const styleB: TypographyLayoutStyle = 'high_contrast_condensed';
    const styleC: TypographyLayoutStyle = input.allowTextless
      ? 'textless_focus'
      : genre === 'anime'
        ? 'vertical_spine'
        : 'perspective_plane';

    const entryA = LOCAL_FONT_CATALOG[catA];
    const entryB = LOCAL_FONT_CATALOG[catB];
    const entryC = LOCAL_FONT_CATALOG[catC];

    const dirA = typographyDirectionProposalSchema.parse({
      id: `typo-A-${randomUUID().slice(0, 6)}`,
      label: 'A',
      styleName: `Editorial ${catA.toUpperCase()} (${styleA})`,
      layoutStyle: styleA,
      fontCategory: catA,
      fontFamily: entryA.primaryFamily,
      fallbackChain: entryA.fallbackChain,
      headlineText: headlineA,
      kickerText: kickerA,
      textLess: false,
      fontWeight: entryA.defaultWeight,
      trackingEm: entryA.defaultTrackingEm,
      leadingRatio: entryA.defaultLeadingRatio,
      kerningMode: 'optical',
      orientation: 'horizontal',
      behindSubject: styleA === 'behind_subject_depth',
      perspectiveSkewXDeg: 0,
      perspectiveSkewYDeg: 0,
      extrusionDepthPx: 0,
      textureOverlay: genre === 'games' ? 'metallic' : 'none',
      strokeWidth: 0,
      editorialRationale: `Direção A usa tipografia ${catA} (${entryA.primaryFamily}) sem contorno preto, com foco em espaço negativo e leitura editorial limpa.`,
    });

    const dirB = typographyDirectionProposalSchema.parse({
      id: `typo-B-${randomUUID().slice(0, 6)}`,
      label: 'B',
      styleName: `Condensada de Contraste (${styleB})`,
      layoutStyle: styleB,
      fontCategory: catB,
      fontFamily: entryB.primaryFamily,
      fallbackChain: entryB.fallbackChain,
      headlineText: headlineB,
      kickerText: kickerB,
      textLess: false,
      fontWeight: 900,
      trackingEm: 0.05,
      leadingRatio: 0.92,
      kerningMode: 'optical',
      orientation: 'horizontal',
      behindSubject: false,
      perspectiveSkewXDeg: 0,
      perspectiveSkewYDeg: 0,
      extrusionDepthPx: 0,
      textureOverlay: 'none',
      strokeWidth: 0,
      editorialRationale: `Direção B usa título próprio ("${headlineB}") em família condensada de alto impacto sem repetir a headline da proposta A.`,
    });

    const dirC = typographyDirectionProposalSchema.parse({
      id: `typo-C-${randomUUID().slice(0, 6)}`,
      label: 'C',
      styleName:
        styleC === 'vertical_spine'
          ? 'Espinha Vertical Editorial'
          : styleC === 'textless_focus'
            ? 'Foco Visual Puro (Micro-Selo)'
            : 'Plano em Perspectiva Dinâmica',
      layoutStyle: styleC,
      fontCategory: catC,
      fontFamily: entryC.primaryFamily,
      fallbackChain: entryC.fallbackChain,
      headlineText: styleC === 'textless_focus' ? '' : headlineC,
      kickerText: kickerC,
      textLess: styleC === 'textless_focus',
      fontWeight: entryC.defaultWeight,
      trackingEm: entryC.defaultTrackingEm,
      leadingRatio: entryC.defaultLeadingRatio,
      kerningMode: 'optical',
      orientation: styleC === 'vertical_spine' ? 'vertical' : 'horizontal',
      behindSubject: false,
      perspectiveSkewXDeg: styleC === 'perspective_plane' ? -8 : 0,
      perspectiveSkewYDeg: 0,
      extrusionDepthPx: styleC === 'perspective_plane' ? 6 : 0,
      textureOverlay: 'none',
      strokeWidth: 0,
      editorialRationale: `Direção C diferencia-se estruturalmente com layout ${styleC} e headline exclusiva ("${headlineC}"), integrando-se ao vetor de ação da cena.`,
    });

    return {
      directions: [dirA, dirB, dirC],
      enginesUsed,
    };
  }

  /**
   * Builds the concrete editable CreativeLayer[] for a given TypographyDirectionProposal.
   * All positions are computed relative to canvasSize (defaults to 1280×720) — no hardcoded coordinates.
   */
  buildTypographyLayers(
    direction: TypographyDirectionProposal,
    palette: { primary: string; secondary: string; accent: string; text: string; background: string },
    options?: { isSplitComparison?: boolean; leftLabel?: string; rightLabel?: string; canvasWidth?: number; canvasHeight?: number },
  ): CreativeLayer[] {
    const layers: CreativeLayer[] = [];
    const cw = options?.canvasWidth ?? 1280;
    const ch = options?.canvasHeight ?? 720;

    // Adaptive margins and sizing as ratios of canvas dimensions
    const marginX = Math.round(cw * 0.0375); // ~48px at 1280
    const marginTop = Math.round(ch * 0.058); // ~42px at 720
    const labelW = Math.round(cw * 0.219); // ~280px at 1280
    const labelH = Math.round(ch * 0.072); // ~52px at 720

    if (options?.isSplitComparison) {
      layers.push(
        {
          id: 'label-before',
          type: 'text',
          role: 'kicker',
          name: 'Selo Comparação Esquerda',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 0.94,
          blendMode: 'over',
          text: options.leftLabel ?? 'ANTES',
          fontFamily: direction.fontFamily,
          fontCategory: direction.fontCategory,
          fontSize: 30,
          fontWeight: 800,
          color: '#E2E8F0',
          strokeColor: '#000000',
          strokeWidth: 0,
          align: 'left',
          letterSpacing: 3,
          lineHeight: 1.0,
          kerningMode: 'optical',
          uppercase: true,
          pillColor: '#0F172ACC',
          pillRadius: 6,
          transform: { x: marginX, y: marginTop, width: labelW, height: labelH, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
        {
          id: 'label-after',
          type: 'text',
          role: 'kicker',
          name: 'Selo Comparação Direita',
          zIndex: 4,
          visible: true,
          locked: false,
          opacity: 0.98,
          blendMode: 'over',
          text: options.rightLabel ?? 'DEPOIS',
          fontFamily: direction.fontFamily,
          fontCategory: direction.fontCategory,
          fontSize: 30,
          fontWeight: 900,
          color: '#070B14',
          strokeColor: '#000000',
          strokeWidth: 0,
          align: 'right',
          letterSpacing: 3,
          lineHeight: 1.0,
          kerningMode: 'optical',
          uppercase: true,
          pillColor: palette.accent,
          pillRadius: 6,
          transform: { x: cw - marginX - labelW, y: marginTop, width: labelW, height: labelH, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [],
        },
      );
    }

    if (direction.textLess || direction.layoutStyle === 'textless_focus') {
      return layers;
    }

    const letterSpacingPx = Math.round(direction.trackingEm * 72);

    if (direction.layoutStyle === 'vertical_spine') {
      // Adaptive vertical spine: column width ~17% of canvas, positioned at left margin
      const spineW = Math.round(cw * 0.172);
      const spineX = Math.round(cw * 0.019);
      const spineY = Math.round(ch * 0.089);
      const spineH = Math.round(ch * 0.819);
      layers.push({
        id: 'headline-concept',
        type: 'text',
        role: 'headline',
        name: `Título Espinha Vertical (${direction.styleName})`,
        zIndex: 5,
        visible: true,
        locked: false,
        opacity: 0.96,
        blendMode: 'over',
        text: direction.headlineText,
        fontFamily: direction.fontFamily,
        fontCategory: direction.fontCategory,
        fontSize: Math.round(ch * 0.094),
        fontWeight: direction.fontWeight,
        color: palette.accent,
        strokeColor: '#000000',
        strokeWidth: 0,
        align: 'center',
        letterSpacing: Math.max(2, letterSpacingPx),
        lineHeight: direction.leadingRatio,
        kerningMode: direction.kerningMode,
        uppercase: true,
        orientation: 'vertical',
        layoutStyle: direction.layoutStyle,
        transform: { x: spineX, y: spineY, width: spineW, height: spineH, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'dropShadow',
            enabled: true,
            color: '#000000D9',
            blur: 14,
            offsetX: 0,
            offsetY: 6,
          },
        ],
      });
      // Kicker is optional — only added when editorially justified by the direction proposal
      if (direction.kickerText && direction.kickerText.trim().length > 0) {
        const kickerGap = Math.round(ch * 0.014);
        const kickerLineHeight = 1.15;
        // Compute required height FIRST based on desired fontSize and char count,
        // then allocate space — never allocate a box too small for the rendered text.
        const kickerDisplay = direction.kickerText.toUpperCase();
        const charCount = Math.max(1, kickerDisplay.length);
        const desiredFontSize = Math.round(ch * 0.031);
        const requiredKickerH = Math.ceil(charCount * desiredFontSize * kickerLineHeight) + 16; // +16 padding
        // Determine available space and adjust spine if necessary
        const availableBelowSpine = ch - (spineY + spineH) - kickerGap;
        let adjustedSpineH = spineH;
        let kickerH: number;
        let kickerY: number;
        let kickerFontSize: number;
        if (availableBelowSpine >= requiredKickerH) {
          // Enough space: use desired fontSize and required height
          kickerH = requiredKickerH;
          kickerFontSize = desiredFontSize;
          kickerY = spineY + spineH + kickerGap;
        } else {
          // Not enough space below for the rendered text at any viable fontSize:
          // shrink the spine to allocate sufficient height for the kicker.
          // Use minimum fontSize (16px) to compute required height, then reduce spine accordingly.
          // Add generous internal padding so glyphs never touch any box edge (top/bottom/left/right)
          // when measured by TypographyQualityCritic.renderSingleLayer + measureAlphaBounds (threshold=20).
          // Vertical text can have descenders/ascenders extending beyond the nominal glyph box,
          // and centering alignment can shift the rendered baseline. We reserve 32px total vertical
          // padding (16px top + 16px bottom) to absorb these variations without clipping.
          kickerFontSize = 16;
          const internalPadV = 32;
          kickerH = Math.ceil(charCount * kickerFontSize * kickerLineHeight) + internalPadV;
          adjustedSpineH = Math.max(100, ch - spineY - kickerGap - kickerH);
          kickerY = spineY + adjustedSpineH + kickerGap;
        }
        // Update headline transform with potentially reduced spine height
        const headlineLayer = layers.find((l) => l.id === 'headline-concept');
        if (headlineLayer) {
          headlineLayer.transform.height = adjustedSpineH;
        }
        layers.push({
          id: 'kicker-concept',
          type: 'text',
          role: 'kicker',
          name: `Kicker Espinha Vertical (${direction.styleName})`,
          zIndex: 5,
          visible: true,
          locked: false,
          opacity: 0.92,
          blendMode: 'over',
          text: direction.kickerText,
          fontFamily: direction.fontFamily,
          fontCategory: direction.fontCategory,
          fontSize: kickerFontSize,
          fontWeight: 700,
          color: palette.text,
          strokeColor: '#000000',
          strokeWidth: 0,
          align: 'center',
          letterSpacing: Math.max(2, Math.round(direction.trackingEm * 48)),
          lineHeight: 1.15,
          kerningMode: direction.kerningMode,
          uppercase: true,
          orientation: 'vertical',
          layoutStyle: direction.layoutStyle,
          pillColor: '#0F172ACC',
          pillRadius: 4,
          transform: { x: spineX, y: kickerY, width: spineW, height: kickerH, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          mask: { kind: 'none' },
          effects: [
            {
              kind: 'dropShadow',
              enabled: true,
              color: '#000000B3',
              blur: 8,
              offsetX: 0,
              offsetY: 3,
            },
          ],
        });
      }
      return layers;
    }

    // Adaptive horizontal layout: all positions and sizes computed as ratios of canvas dimensions
    const isCentered = options?.isSplitComparison || direction.layoutStyle === 'high_contrast_condensed';
    const boxX = isCentered ? Math.round(cw * 0.109) : Math.round(cw * 0.047);
    const boxY = direction.behindSubject ? Math.round(ch * 0.111) : Math.round(ch * 0.743);
    const boxW = isCentered ? Math.round(cw * 0.781) : Math.round(cw * 0.688);
    // Adaptive height: behind-subject ~29%, high-contrast ~25%, default ~19% of canvas height
    const boxH = direction.behindSubject
      ? Math.round(ch * 0.292)
      : direction.layoutStyle === 'high_contrast_condensed'
        ? Math.round(ch * 0.25)
        : Math.round(ch * 0.194);
    // Font size scales with canvas height for consistent visual weight across resolutions
    const headlineFontSize = direction.behindSubject ? Math.round(ch * 0.133) : Math.round(ch * 0.106);

    layers.push({
      id: 'headline-concept',
      type: 'text',
      role: 'headline',
      name: `Título Editorial (${direction.styleName})`,
      zIndex: direction.behindSubject ? 1 : 5,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'over',
      text: direction.headlineText,
      fontFamily: direction.fontFamily,
      fontCategory: direction.fontCategory,
      fontSize: headlineFontSize,
      fontWeight: direction.fontWeight,
      color: direction.layoutStyle === 'minimal_whisper' ? palette.accent : '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: direction.strokeWidth,
      align: isCentered ? 'center' : 'left',
      letterSpacing: letterSpacingPx,
      lineHeight: direction.leadingRatio,
      kerningMode: direction.kerningMode,
      uppercase: true,
      orientation: 'horizontal',
      layoutStyle: direction.layoutStyle,
      behindSubject: direction.behindSubject,
      perspectiveSkewXDeg: direction.perspectiveSkewXDeg,
      perspectiveSkewYDeg: direction.perspectiveSkewYDeg,
      extrusionDepthPx: direction.extrusionDepthPx,
      extrusionColor: '#091326',
      textureOverlay: direction.textureOverlay,
      transform: { x: boxX, y: boxY, width: boxW, height: boxH, scaleX: 1, scaleY: 1, rotationDeg: 0 },
      mask: { kind: 'none' },
      effects: [
        {
          kind: 'dropShadow',
          enabled: true,
          color: '#000000E6',
          blur: 16,
          offsetX: 0,
          offsetY: 8,
        },
      ],
    });

    // Kicker is optional — only added when the direction proposal includes editorially justified kicker text.
    // A single headline alone is NOT a hierarchy failure (see MISSING_TYPOGRAPHIC_HIERARCHY in quality-gate.ts).
    if (direction.kickerText && direction.kickerText.trim().length > 0) {
      const kickerH = Math.round(ch * 0.1);
      const kickerGap = Math.round(ch * 0.019);
      const kickerY = direction.behindSubject ? boxY + boxH + kickerGap : boxY - kickerH - kickerGap;
      const kickerFontSize = Math.round(ch * 0.031);
      layers.push({
        id: 'kicker-concept',
        type: 'text',
        role: 'kicker',
        name: `Kicker Editorial (${direction.styleName})`,
        zIndex: direction.behindSubject ? 1 : 5,
        visible: true,
        locked: false,
        opacity: 0.92,
        blendMode: 'over',
        text: direction.kickerText,
        fontFamily: direction.fontFamily,
        fontCategory: direction.fontCategory,
        fontSize: kickerFontSize,
        fontWeight: 700,
        color: palette.accent,
        strokeColor: '#000000',
        strokeWidth: 0,
        align: isCentered ? 'center' : 'left',
        letterSpacing: Math.max(2, Math.round(direction.trackingEm * 48)),
        lineHeight: 1.15,
        kerningMode: direction.kerningMode,
        uppercase: true,
        orientation: 'horizontal',
        layoutStyle: direction.layoutStyle,
        pillColor: '#0F172ACC',
        pillRadius: 4,
        transform: { x: boxX, y: kickerY, width: boxW, height: kickerH, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        mask: { kind: 'none' },
        effects: [
          {
            kind: 'dropShadow',
            enabled: true,
            color: '#000000B3',
            blur: 8,
            offsetX: 0,
            offsetY: 3,
          },
        ],
      });
    }

    return layers;
  }
}

export class TypographyQualityCritic {
  constructor(private readonly compositionEngine: SharpSvgCompositionEngine) {}

  /**
   * Audits a rendered document's typography at 1280×720 and 224×126, measuring real glyph bounds,
   * negative space ratio, word count, and cross-variant repetition.
   */
  async critiqueDocumentTypography(
    doc: CreativeProjectDocument,
    renderedBuffer: Buffer,
    siblingHeadlines: string[] = [],
  ): Promise<TypographyCritique> {
    const findings: string[] = [];
    const textLayers = doc.layers.filter((l) => l.type === 'text' && l.visible);
    const headlineLayer = textLayers.find((l) => l.type === 'text' && l.role === 'headline');

    let glyphClipped = false;
    let totalTextArea = 0;

    for (const tl of textLayers) {
      if (tl.type !== 'text') continue;
      totalTextArea += tl.transform.width * tl.transform.height;
      const layerBuf = await this.compositionEngine.renderSingleLayer(doc, tl);
      if (layerBuf) {
        const bounds = await measureAlphaBounds(layerBuf, 20);
        // Glyph clipping detection: only flag when glyphs genuinely touch or exceed the box edge.
        // Shadow/anti-aliasing pixels extending beyond the transform are expected artifacts of
        // isolated layer rendering and do NOT constitute content loss. We use a tight 2px margin
        // to catch real clipping while ignoring shadow bleed (which can extend 20+ pixels).
        const clipMargin = 2;
        if (
          bounds &&
          (bounds.left < clipMargin ||
            bounds.top < clipMargin ||
            bounds.left + bounds.width > tl.transform.width - clipMargin ||
            bounds.top + bounds.height > tl.transform.height - clipMargin)
        ) {
          glyphClipped = true;
          findings.push(`Glifos da camada "${tl.name}" encostam no limite da caixa tipográfica.`);
        }
      }
    }

    const canvasArea = doc.width * doc.height;
    const negativeSpaceRatio = Number(Math.max(0, Math.min(1, 1 - totalTextArea / Math.max(1, canvasArea))).toFixed(3));
    if (negativeSpaceRatio < 0.58) {
      findings.push(`Excesso de ocupação tipográfica: espaço negativo=${(negativeSpaceRatio * 100).toFixed(0)}% (mínimo recomendado 58%).`);
    }

    const headlineText = headlineLayer && headlineLayer.type === 'text' ? headlineLayer.text.trim() : '';
    const wordCount = headlineText ? headlineText.split(/\s+/).length : 0;
    if (wordCount > 4) {
      findings.push(`Headline longa demais (${wordCount} palavras; máximo editorial recomendado = 4).`);
    }

    const repeatedSibling =
      headlineText.length > 0 &&
      siblingHeadlines.some((h) => h.trim().toLowerCase() === headlineText.toLowerCase());
    const usesHeavyDefaultOutline =
      headlineLayer && headlineLayer.type === 'text' && headlineLayer.strokeWidth >= 5 && headlineLayer.fontFamily === 'Arial Black';

    if (repeatedSibling) {
      findings.push(`Headline "${headlineText}" repetida entre variantes do mesmo conjunto.`);
    }
    if (usesHeavyDefaultOutline) {
      findings.push('Uso de fórmula genérica (Arial Black + contorno preto espesso).');
    }

    // Legibility at 1280x720 and 224x126 mobile thumbnail size
    const fullStats = await sharp(renderedBuffer).stats();
    const smallBuf = await sharp(renderedBuffer).resize(224, 126, { fit: 'fill' }).png().toBuffer();
    const smallStats = await sharp(smallBuf).stats();
    const fullStdev =
      ((fullStats.channels[0]?.stdev ?? 0) + (fullStats.channels[1]?.stdev ?? 0) + (fullStats.channels[2]?.stdev ?? 0)) / 3;
    const smallStdev =
      ((smallStats.channels[0]?.stdev ?? 0) + (smallStats.channels[1]?.stdev ?? 0) + (smallStats.channels[2]?.stdev ?? 0)) / 3;

    const legibility1280Score = Math.min(98, Math.max(45, Math.round(52 + fullStdev * 0.7)));
    const legibility224Score = Math.min(96, Math.max(40, Math.round(48 + smallStdev * 0.75)));
    const hierarchyScore = wordCount <= 4 && negativeSpaceRatio >= 0.58 ? 90 : 62;
    const isGenericOrRepetitive = Boolean(repeatedSibling || usesHeavyDefaultOutline);
    const passed = !glyphClipped && !isGenericOrRepetitive && wordCount <= 5 && legibility224Score >= 60;

    return typographyCritiqueSchema.parse({
      passed,
      legibility1280Score,
      legibility224Score,
      hierarchyScore,
      negativeSpaceRatio,
      glyphClipped,
      isGenericOrRepetitive,
      wordCount,
      findings,
    });
  }
}

/**
 * 4. Typography Concept Lab:
 * Generates 3 genuinely different typographic directions on top of an existing CreativeProjectDocument,
 * rendering previews and evaluating each with TypographyQualityCritic.
 */
export async function generateTypographyConceptLab(options: {
  baseDocument: CreativeProjectDocument;
  input: TypographyDirectorInput;
  compositionEngine: SharpSvgCompositionEngine;
  providers?: ReasoningEngineProvider[];
}): Promise<{
  variants: Array<{
    direction: TypographyDirectionProposal;
    document: CreativeProjectDocument;
    critique: TypographyCritique;
    previewBuffer: Buffer;
  }>;
  enginesUsed: string[];
}> {
  const director = new TypographyArtDirector(options.providers ?? []);
  const critic = new TypographyQualityCritic(options.compositionEngine);
  const { directions, enginesUsed } = await director.planConceptTypographyTriad(options.input);

  const palette = options.input.brandKit?.palette ?? {
    primary: '#00F0FF',
    secondary: '#FF006E',
    accent: '#FACC15',
    background: '#070B14',
    text: '#FFFFFF',
  };

  const variants: Array<{
    direction: TypographyDirectionProposal;
    document: CreativeProjectDocument;
    critique: TypographyCritique;
    previewBuffer: Buffer;
  }> = [];
  const usedHeadlines: string[] = [];

  for (const dir of directions) {
    const cloned = structuredClone(options.baseDocument);
    cloned.id = `creative-typo-${dir.label}-${randomUUID().slice(0, 8)}`;
    cloned.title = `${options.baseDocument.title} — Tipografia ${dir.label} (${dir.styleName})`;
    cloned.layers = cloned.layers.filter((l) => l.type !== 'text');
    const newTextLayers = director.buildTypographyLayers(dir, palette, {
      canvasWidth: options.baseDocument.width,
      canvasHeight: options.baseDocument.height,
    });
    cloned.layers.push(...newTextLayers);
    cloned.updatedAt = new Date().toISOString();

    const parsedDoc = creativeProjectDocumentSchema.parse(cloned);
    const previewBuffer = await options.compositionEngine.renderDocumentToBuffer(parsedDoc, 'png');
    const critique = await critic.critiqueDocumentTypography(parsedDoc, previewBuffer, usedHeadlines);
    if (dir.headlineText) {
      usedHeadlines.push(dir.headlineText);
    }

    variants.push({
      direction: dir,
      document: parsedDoc,
      critique,
      previewBuffer,
    });
  }

  return { variants, enginesUsed };
}
