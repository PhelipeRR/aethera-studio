import { existsSync } from 'node:fs';
import sharp, { type Blend, type OverlayOptions } from 'sharp';
import type { AssetIngestionService } from './asset-ingestion.js';
import type {
  BlendMode,
  CreativeLayer,
  CreativeProjectDocument,
  LayerEffect,
  LayerMask,
  LocalizedDefect,
  ManagedAssetRef,
} from './schemas.js';

export interface ImageGenerationRequest {
  prompt: string;
  width: number;
  height: number;
  style?: string;
  referenceImagePaths?: string[];
  /** Optional img2img denoising strength (0..1) when referenceImagePaths[0] is provided */
  strength?: number;
  /** CF-1: things the model must avoid. Engines without classifier-free guidance (SDXL-Turbo) cannot use it. */
  negativePrompt?: string;
  /** CF-1: reproducible generation; omitted = engine-random. */
  seed?: number;
  /** Optional engine controls carried by a professional visual preset. */
  model?: string;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  /** Optional native ComfyUI LoRA applied to the model and, when supported, the text encoder. */
  lora?: { model: string; strengthModel?: number; strengthClip?: number };
  /** Optional ControlNet model plus a local conditioning image. */
  controlNet?: { model: string; imagePath: string; strength?: number; startPercent?: number; endPercent?: number };
  batchSize?: number;
  preset?: string;
  characterCount?: number;
  characterRegions?: Array<{ id: string; anchor: string; x: number; y: number; width: number; height: number }>;
}

export interface BackgroundRemovalRequest {
  inputImagePath: string;
  featherPx?: number;
}

export interface SemanticEvaluationRequest {
  imageBuffer: Buffer;
  positiveConcepts: string[];
  negativeConcepts: string[];
}

export interface SemanticEvaluationResult {
  evaluatorId: string;
  positiveScore: number;
  negativeScore: number;
  margin: number;
  isOffTopic: boolean;
  matchedLabel: string;
  rationale: string;
}

export interface VisualQualityInspectionRequest {
  imageBuffer: Buffer;
  compareBeforeBuffer?: Buffer;
  genre?: string;
}

export interface VisualQualityInspectionResult {
  evaluatorId: string;
  anatomicalConsistency: number;
  physicalCoherence: number;
  compositionQuality: number;
  subjectIdentityConsistency: number;
  visualArtifactSeverity: number;
  localizedDefects: LocalizedDefect[];
}

export interface LocalizedInpaintRequest {
  imageBuffer: Buffer;
  prompt: string;
  bbox: { x: number; y: number; width: number; height: number };
  strength?: number;
}

export interface ImageUpscaleRequest {
  imageBuffer: Buffer;
  /** Relative model name reported by ComfyUI's upscale_models inventory. */
  model: string;
}

/**
 * Optional external AI image generation / segmentation / multimodal evaluation adapter.
 * Kept strictly separate from deterministic Sharp/SVG layer composition.
 */
export interface ExternalImageAdapter {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  generateImage?(request: ImageGenerationRequest): Promise<Buffer>;
  removeBackground?(request: BackgroundRemovalRequest): Promise<Buffer>;
  evaluateImageSemantics?(request: SemanticEvaluationRequest): Promise<SemanticEvaluationResult>;
  inspectVisualQuality?(request: VisualQualityInspectionRequest): Promise<VisualQualityInspectionResult>;
  inpaintRegion?(request: LocalizedInpaintRequest): Promise<Buffer>;
  upscaleImage?(request: ImageUpscaleRequest): Promise<Buffer>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toSharpBlend(mode: BlendMode): Blend {
  switch (mode) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'overlay':
      return 'overlay';
    case 'add':
      return 'add';
    case 'over':
    default:
      return 'over';
  }
}

function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export interface TextBoxFitResult {
  fontSize: number;
  lines: string[];
  estimatedMaxLineWidth: number;
  estimatedTotalHeight: number;
  fitsAtRequestedSize: boolean;
  fitsAfterAutoScale: boolean;
}

/**
 * Estimates glyph metrics conservatively (accounting for wide uppercase display fonts,
 * letter-spacing, and stroke width) and auto-scales fontSize so no character clips inside targetW/targetH.
 */
export function fitTextToBox(params: {
  text: string;
  targetW: number;
  targetH: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  strokeWidth: number;
  uppercase?: boolean;
  minFontSize?: number;
  orientation?: 'horizontal' | 'vertical';
}): TextBoxFitResult {
  const display = params.uppercase ? params.text.toUpperCase() : params.text;
  const isVertical = params.orientation === 'vertical';

  // For vertical orientation, swap the semantic meaning of width/height:
  // the "width" of a vertical text column is actually its visual height (stacked glyphs),
  // and the "height" constraint is the visual width available for each glyph.
  const effectiveW = isVertical ? params.targetH : params.targetW;
  const effectiveH = isVertical ? params.targetW : params.targetH;

  // For vertical text, use targetW/targetH directly (no swap): targetW = visual column width,
  // targetH = visual height available for the stacked glyphs. Padding is applied per-axis.
  const vertPadX = isVertical ? Math.min(36, Math.round(params.targetW * 0.06)) : 0;
  const vertPadY = isVertical ? 16 : 0;
  const vertAvailW = isVertical ? Math.max(30, params.targetW - vertPadX) : 0;
  const vertAvailH = isVertical ? Math.max(40, params.targetH - vertPadY) : 0;
  const padX = Math.min(36, Math.round(effectiveW * 0.06));
  const padY = 16;
  const availW = Math.max(40, effectiveW - padX);
  const availH = Math.max(30, effectiveH - padY);
  const minFont = Math.max(16, params.minFontSize ?? 24);

  const measureAt = (fs: number) => {
    const charW = fs * 0.72 + Math.max(0, params.letterSpacing) + params.strokeWidth * 0.65;

    if (isVertical) {
      // Vertical text: each character occupies one vertical slot stacked top-to-bottom.
      // Column width (widest glyph) must fit within targetW; total stacked height must fit within targetH.
      const charCount = display.length;
      const estColumnWidth = charW;
      const estColumnHeight = charCount * fs * params.lineHeight;
      const lines = [display]; // single "line" containing all chars for vertical layout
      return {
        lines,
        estW: estColumnWidth,
        estH: estColumnHeight,
        fits: estColumnWidth <= vertAvailW && estColumnHeight <= vertAvailH,
      };
    }

    const maxChars = Math.max(4, Math.floor(availW / Math.max(8, charW)));
    const lines = wrapTextLines(display, maxChars);
    const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const estW = maxLen * charW;
    const estH = lines.length * fs * params.lineHeight;
    return {
      lines,
      estW,
      estH,
      fits: estW <= availW && estH <= availH,
    };
  };

  const initial = measureAt(params.fontSize);
  if (initial.fits) {
    return {
      fontSize: params.fontSize,
      lines: initial.lines,
      estimatedMaxLineWidth: Math.round(initial.estW),
      estimatedTotalHeight: Math.round(initial.estH),
      fitsAtRequestedSize: true,
      fitsAfterAutoScale: true,
    };
  }

  let currentFs = params.fontSize;
  let current = initial;
  while (currentFs > minFont) {
    currentFs = Math.max(minFont, currentFs - 4);
    current = measureAt(currentFs);
    if (current.fits) {
      return {
        fontSize: currentFs,
        lines: current.lines,
        estimatedMaxLineWidth: Math.round(current.estW),
        estimatedTotalHeight: Math.round(current.estH),
        fitsAtRequestedSize: false,
        fitsAfterAutoScale: true,
      };
    }
  }

  return {
    fontSize: currentFs,
    lines: current.lines,
    estimatedMaxLineWidth: Math.round(current.estW),
    estimatedTotalHeight: Math.round(current.estH),
    fitsAtRequestedSize: false,
    fitsAfterAutoScale: current.fits,
  };
}

async function applyMaskToBuffer(buffer: Buffer, width: number, height: number, mask: LayerMask): Promise<Buffer> {
  if (mask.kind === 'none') return buffer;

  if (mask.kind === 'circle') {
    const cx = Math.round(mask.cx * width);
    const cy = Math.round(mask.cy * height);
    const r = Math.round(mask.radius * Math.min(width, height));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/></svg>`;
    return sharp(buffer)
      .ensureAlpha()
      .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
      .png()
      .toBuffer();
  }

  if (mask.kind === 'rect') {
    const x = Math.round(mask.x * width);
    const y = Math.round(mask.y * height);
    const w = Math.max(1, Math.round(mask.width * width));
    const h = Math.max(1, Math.round(mask.height * height));
    const rx = Math.round(mask.borderRadius);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ry="${rx}" fill="#ffffff"/></svg>`;
    return sharp(buffer)
      .ensureAlpha()
      .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
      .png()
      .toBuffer();
  }

  // alphaCutout: local deterministic border-color keying fallback when no external segmentation model is active.
  return removeBorderColorBackground(buffer, mask.threshold);
}

export interface AlphaBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  nonTransparentPixels: number;
}

/**
 * Measures the tight bounding box of non-transparent pixels (alpha >= threshold) in a PNG/RGBA buffer.
 */
export async function measureAlphaBounds(buffer: Buffer, alphaThreshold = 18): Promise<AlphaBounds | null> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < h; y += 1) {
    const rowOffset = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      const alpha = data[rowOffset + x * 4 + 3] ?? 0;
      if (alpha >= alphaThreshold) {
        count += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY || count === 0) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    canvasWidth: w,
    canvasHeight: h,
    nonTransparentPixels: count,
  };
}

/**
 * Crops away empty transparent margins around a segmented subject so scaling fills the editorial box cleanly.
 */
export async function trimTransparentBounds(buffer: Buffer, padding = 4): Promise<Buffer> {
  const bounds = await measureAlphaBounds(buffer, 18);
  if (!bounds) return buffer;
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const right = Math.min(bounds.canvasWidth, bounds.left + bounds.width + padding);
  const bottom = Math.min(bounds.canvasHeight, bounds.top + bounds.height + padding);
  const extractW = Math.max(1, right - left);
  const extractH = Math.max(1, bottom - top);
  return sharp(buffer)
    .ensureAlpha()
    .extract({ left, top, width: extractW, height: extractH })
    .png()
    .toBuffer();
}

/**
 * Deterministic local cutout: samples the 4 corners and makes near-matching border pixels transparent.
 */
export async function removeBorderColorBackground(inputBuffer: Buffer, tolerance = 28): Promise<Buffer> {
  const { data, info } = await sharp(inputBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  if (w < 2 || h < 2 || channels < 4) return inputBuffer;

  const corners = [0, (w - 1) * channels, (h - 1) * w * channels, ((h - 1) * w + (w - 1)) * channels];
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (const offset of corners) {
    rSum += data[offset] ?? 0;
    gSum += data[offset + 1] ?? 0;
    bSum += data[offset + 2] ?? 0;
  }
  const bgR = rSum / corners.length;
  const bgG = gSum / corners.length;
  const bgB = bSum / corners.length;

  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const dr = (out[i] ?? 0) - bgR;
    const dg = (out[i + 1] ?? 0) - bgG;
    const db = (out[i + 2] ?? 0) - bgB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist <= tolerance) {
      out[i + 3] = 0;
    } else if (dist <= tolerance * 1.6) {
      const alphaFactor = (dist - tolerance) / (tolerance * 0.6);
      out[i + 3] = Math.round((out[i + 3] ?? 255) * Math.max(0, Math.min(1, alphaFactor)));
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

function parseHexColorRgb(hex: string): { r: number; g: number; b: number; alpha: number } {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    const red = clean.charAt(0);
    const green = clean.charAt(1);
    const blue = clean.charAt(2);
    return {
      r: parseInt(red + red, 16),
      g: parseInt(green + green, 16),
      b: parseInt(blue + blue, 16),
      alpha: 1,
    };
  }
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = clean.length === 8 ? (parseInt(clean.slice(6, 8), 16) || 255) / 255 : 1;
  return { r, g, b, alpha: a };
}

async function createAlphaSilhouetteLayer(
  buffer: Buffer,
  width: number,
  height: number,
  colorHex: string,
  blurRadius: number,
  opacityScale = 1,
): Promise<Buffer> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { r, g, b, alpha } = parseHexColorRgb(colorHex);
  const effectiveAlpha = Math.max(0, Math.min(1, alpha * opacityScale));
  const tinted = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    tinted[i] = r;
    tinted[i + 1] = g;
    tinted[i + 2] = b;
    tinted[i + 3] = Math.round((data[i + 3] ?? 0) * effectiveAlpha);
  }
  let sil = sharp(tinted, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
  if (blurRadius >= 0.4) {
    sil = sil.blur(Math.min(40, blurRadius));
  }
  return sil.resize(width, height, { fit: 'fill' }).png().toBuffer();
}

async function applyLayerEffects(buffer: Buffer, width: number, height: number, effects: LayerEffect[]): Promise<Buffer> {
  let current = buffer;
  for (const effect of effects) {
    if (!effect.enabled) continue;
    if (effect.kind === 'colorGrade') {
      current = await sharp(current)
        .modulate({
          brightness: effect.brightness,
          saturation: effect.saturation,
        })
        .linear(effect.contrast, -(128 * (effect.contrast - 1)))
        .png()
        .toBuffer();
    } else if (effect.kind === 'depthBlur' && effect.radius > 0.3) {
      current = await sharp(current).blur(Math.max(0.4, Math.min(40, effect.radius))).png().toBuffer();
    } else if (effect.kind === 'motionBlur' && effect.distance > 0) {
      const sigma = Math.max(0.4, Math.min(12, effect.distance / 4));
      current = await sharp(current).blur(sigma).png().toBuffer();
    } else if (effect.kind === 'directionalLight') {
      const rad = (effect.angleDeg * Math.PI) / 180;
      const x1 = Math.round(50 - Math.cos(rad) * 50);
      const y1 = Math.round(50 - Math.sin(rad) * 50);
      const x2 = Math.round(50 + Math.cos(rad) * 50);
      const y2 = Math.round(50 + Math.sin(rad) * 50);
      const op = Math.max(0.05, Math.min(0.95, effect.intensity));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs>
          <linearGradient id="dl" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
            <stop offset="0%" stop-color="${escapeXml(effect.color)}" stop-opacity="${op.toFixed(2)}"/>
            <stop offset="65%" stop-color="${escapeXml(effect.color)}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#dl)"/>
      </svg>`;
      current = await sharp(current)
        .composite([{ input: Buffer.from(svg), blend: 'atop' }])
        .png()
        .toBuffer();
    } else if (effect.kind === 'dropShadow') {
      const shadowBuf = await createAlphaSilhouetteLayer(
        current,
        width,
        height,
        effect.color,
        Math.max(1, effect.blur / 2),
        0.85,
      );
      current = await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          { input: shadowBuf, left: Math.round(effect.offsetX), top: Math.round(effect.offsetY), blend: 'over' },
          { input: current, left: 0, top: 0, blend: 'over' },
        ])
        .png()
        .toBuffer();
    } else if (effect.kind === 'outerGlow') {
      const glowBuf = await createAlphaSilhouetteLayer(
        current,
        width,
        height,
        effect.color,
        Math.min(5, Math.max(1, effect.radius / 4)),
        Math.min(0.32, effect.intensity * 0.45),
      );
      current = await sharp({
        create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([
          { input: glowBuf, left: 0, top: 0, blend: 'screen' },
          { input: current, left: 0, top: 0, blend: 'over' },
        ])
        .png()
        .toBuffer();
    } else if (effect.kind === 'vignette') {
      const alpha = Math.max(0.1, Math.min(0.95, effect.strength));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs>
          <radialGradient id="v" cx="50%" cy="50%" r="70%">
            <stop offset="45%" stop-color="${escapeXml(effect.color)}" stop-opacity="0"/>
            <stop offset="100%" stop-color="${escapeXml(effect.color)}" stop-opacity="${alpha}"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#v)"/>
      </svg>`;
      current = await sharp(current)
        .composite([{ input: Buffer.from(svg), blend: 'over' }])
        .png()
        .toBuffer();
    }
  }
  return current;
}

async function applyOpacityToBuffer(buffer: Buffer, opacity: number): Promise<Buffer> {
  if (opacity >= 0.999) return buffer;
  const clamped = Math.max(0, Math.min(1, opacity));
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let i = 3; i < out.length; i += 4) {
    out[i] = Math.round((out[i] ?? 255) * clamped);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export class SharpSvgCompositionEngine {
  constructor(
    private readonly ingestion: AssetIngestionService,
    private readonly externalAdapter?: ExternalImageAdapter,
  ) {}

  private resolveAssetFile(doc: CreativeProjectDocument, assetId?: string): string | null {
    if (!assetId) return null;
    const ref: ManagedAssetRef | undefined = doc.assetManifest[assetId];
    if (!ref) return null;
    const abs = this.ingestion.resolvePortablePath(ref.relativePath);
    return existsSync(abs) ? abs : null;
  }

  async renderDocumentToBuffer(
    doc: CreativeProjectDocument,
    format: 'png' | 'jpg' | 'webp' = 'png',
    quality = 92,
  ): Promise<Buffer> {
    const orderedLayers = [...doc.layers]
      .filter((layer) => layer.visible)
      .sort((a, b) => {
        const effZ = (l: CreativeLayer): number => {
          if (l.type === 'text' && l.behindSubject) {
            return 0.5;
          }
          return l.zIndex;
        };
        return effZ(a) - effZ(b);
      });

    const baseCanvas = sharp({
      create: {
        width: doc.width,
        height: doc.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    const composites: OverlayOptions[] = [];

    for (const layer of orderedLayers) {
      const rendered = await this.renderLayer(doc, layer);
      if (!rendered) continue;

      const x = Math.round(layer.transform.x);
      const y = Math.round(layer.transform.y);
      const layerMeta = await sharp(rendered).metadata();
      const lw = layerMeta.width ?? 0;
      const lh = layerMeta.height ?? 0;
      if (lw <= 0 || lh <= 0) continue;

      // Clip layer to canvas bounds so scaled/rotated/overflowing layers composite safely
      const visLeft = Math.max(0, x);
      const visTop = Math.max(0, y);
      const visRight = Math.min(doc.width, x + lw);
      const visBottom = Math.min(doc.height, y + lh);
      const visW = visRight - visLeft;
      const visH = visBottom - visTop;
      if (visW <= 0 || visH <= 0) continue;

      let clipped = rendered;
      if (visLeft !== x || visTop !== y || visW !== lw || visH !== lh) {
        clipped = await sharp(rendered)
          .extract({ left: visLeft - x, top: visTop - y, width: visW, height: visH })
          .png()
          .toBuffer();
      }

      composites.push({
        input: clipped,
        left: visLeft,
        top: visTop,
        blend: toSharpBlend(layer.blendMode),
      });
    }

    let pipeline = baseCanvas.composite(composites);
    if (format === 'jpg') {
      pipeline = pipeline.flatten({ background: '#000000' }).jpeg({ quality });
    } else if (format === 'webp') {
      pipeline = pipeline.webp({ quality });
    } else {
      pipeline = pipeline.png();
    }

    return pipeline.toBuffer();
  }

  async measureRenderedLayerAlphaBounds(
    doc: CreativeProjectDocument,
    layer: CreativeLayer,
  ): Promise<{
    bounds: AlphaBounds;
    canvasLeft: number;
    canvasTop: number;
    canvasBottomGap: number;
    heightCoverage: number;
    areaCoverage: number;
  } | null> {
    const buf = await this.renderLayer(doc, layer);
    if (!buf) return null;
    const bounds = await measureAlphaBounds(buf, 12);
    if (!bounds) return null;
    const canvasLeft = Math.round(layer.transform.x) + bounds.left;
    const canvasTop = Math.round(layer.transform.y) + bounds.top;
    const canvasBottom = canvasTop + bounds.height;
    return {
      bounds,
      canvasLeft,
      canvasTop,
      canvasBottomGap: doc.height - canvasBottom,
      heightCoverage: bounds.height / Math.max(1, doc.height),
      areaCoverage: bounds.nonTransparentPixels / Math.max(1, doc.width * doc.height),
    };
  }

  /**
   * Public API for rendering a single layer in isolation (used by TypographyQualityCritic).
   * Delegates to the private renderLayer implementation.
   */
  async renderSingleLayer(doc: CreativeProjectDocument, layer: CreativeLayer): Promise<Buffer | null> {
    return this.renderLayer(doc, layer);
  }

  private async renderLayer(doc: CreativeProjectDocument, layer: CreativeLayer): Promise<Buffer | null> {
    const targetW = Math.max(1, Math.round(layer.transform.width * layer.transform.scaleX));
    const targetH = Math.max(1, Math.round(layer.transform.height * layer.transform.scaleY));

    let buf: Buffer | null = null;

    switch (layer.type) {
      case 'background': {
        const assetPath = this.resolveAssetFile(doc, layer.assetId);
        if (assetPath) {
          let bgPipe = sharp(assetPath)
            .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
            .ensureAlpha();
          if (layer.blurRadius && layer.blurRadius > 0.3) {
            bgPipe = bgPipe.blur(Math.min(40, layer.blurRadius));
          }
          if (layer.brightness !== undefined && Math.abs(layer.brightness - 1) > 0.02) {
            bgPipe = bgPipe.modulate({ brightness: layer.brightness });
          }
          buf = await bgPipe.png().toBuffer();
        } else {
          const toColor = layer.gradientTo ?? layer.fillColor;
          const rad = (layer.gradientAngleDeg * Math.PI) / 180;
          const x2 = Math.round(50 + Math.cos(rad) * 50);
          const y2 = Math.round(50 + Math.sin(rad) * 50);
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
            <defs>
              <linearGradient id="bg" x1="0%" y1="0%" x2="${x2}%" y2="${y2}%">
                <stop offset="0%" stop-color="${escapeXml(layer.fillColor)}"/>
                <stop offset="100%" stop-color="${escapeXml(toColor)}"/>
              </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#bg)"/>
          </svg>`;
          buf = await sharp(Buffer.from(svg)).png().toBuffer();
        }
        break;
      }

      case 'subject': {
        const assetPath = this.resolveAssetFile(doc, layer.assetId);
        if (!assetPath) return null;
        let subjectBuf: Buffer;
        if (layer.removeBackground) {
          if (this.externalAdapter?.removeBackground && (await this.externalAdapter.isAvailable())) {
            subjectBuf = await this.externalAdapter.removeBackground({ inputImagePath: assetPath });
          } else {
            subjectBuf = await removeBorderColorBackground(
              await sharp(assetPath).resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
            );
          }
        } else {
          subjectBuf = await sharp(assetPath).ensureAlpha().png().toBuffer();
        }
        // Trim transparent padding so the subject fills the editorial frame instead of shrinking inside empty margins
        let framedSubject = await trimTransparentBounds(subjectBuf, 6);
        if (layer.framing === 'closeup' || layer.framing === 'medium') {
          const sMeta = await sharp(framedSubject).metadata();
          const sw = sMeta.width ?? targetW;
          const sh = sMeta.height ?? targetH;
          if (sw >= 32 && sh >= 32) {
            const cropH = layer.framing === 'closeup' ? Math.max(32, Math.round(sh * 0.56)) : Math.max(32, Math.round(sh * 0.76));
            const targetRatio = targetW / Math.max(1, targetH);
            const maxRatioW = Math.round(cropH * targetRatio);
            const cropW =
              layer.framing === 'closeup'
                ? Math.max(32, Math.min(sw, Math.round(sw * 0.82), maxRatioW))
                : Math.max(32, Math.min(sw, maxRatioW));
            const cropLeft = Math.max(0, Math.round((sw - cropW) / 2));
            framedSubject = await sharp(framedSubject)
              .extract({ left: cropLeft, top: 0, width: Math.min(cropW, sw - cropLeft), height: Math.min(cropH, sh) })
              .png()
              .toBuffer();
          }
        }
        buf = await sharp(framedSubject)
          .resize(targetW, targetH, {
            fit: layer.fitMode ?? 'contain',
            position: layer.anchorBottom ? 'south' : 'centre',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();

        if (layer.groundFade) {
          // Soft bottom fade so waist/hip-cropped subjects integrate naturally instead of ending in a hard horizontal cut
          const fadeH = Math.max(16, Math.round(targetH * 0.16));
          const fadeY = targetH - fadeH;
          const fadeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
            <defs>
              <linearGradient id="gf" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0.18"/>
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="${targetW}" height="${fadeY}" fill="#ffffff"/>
            <rect x="0" y="${fadeY}" width="${targetW}" height="${fadeH}" fill="url(#gf)"/>
          </svg>`;
          buf = await sharp(buf)
            .ensureAlpha()
            .composite([{ input: Buffer.from(fadeSvg), blend: 'dest-in' }])
            .png()
            .toBuffer();
        }

        if (layer.rimLightColor) {
          // Subtle, natural rim highlight (thin 2px edge, low opacity) + gentle ambient wrap instead of an exaggerated neon halo
          const rimGlow = await createAlphaSilhouetteLayer(buf, targetW, targetH, layer.rimLightColor, 2.2, 0.28);
          const wrapSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
            <defs>
              <linearGradient id="rimwrap" x1="0%" y1="0%" x2="100%" y2="25%">
                <stop offset="0%" stop-color="${escapeXml(layer.rimLightColor)}" stop-opacity="0.18"/>
                <stop offset="45%" stop-color="${escapeXml(layer.rimLightColor)}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#rimwrap)"/>
          </svg>`;
          const litSubject = await sharp(buf)
            .composite([{ input: Buffer.from(wrapSvg), blend: 'atop' }])
            .png()
            .toBuffer();
          buf = await sharp({
            create: { width: targetW, height: targetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
          })
            .composite([
              { input: rimGlow, left: -2, top: -1, blend: 'screen' },
              { input: litSubject, left: 0, top: 0, blend: 'over' },
            ])
            .png()
            .toBuffer();
        }
        break;
      }

      case 'shape': {
        const rx = layer.shapeKind === 'circle' ? Math.round(Math.min(targetW, targetH) / 2) : layer.borderRadius;
        const strokeAttr = layer.strokeColor && layer.strokeWidth > 0
          ? `stroke="${escapeXml(layer.strokeColor)}" stroke-width="${layer.strokeWidth}"`
          : '';
        const fillAttr = layer.shapeKind === 'frame' ? 'fill="none"' : `fill="${escapeXml(layer.fillColor)}"`;
        const feather = Math.min(layer.featherPx ?? 0, Math.floor(Math.min(targetW, targetH) / 3));
        const svg =
          feather > 0
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
          <defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(feather / 2).toFixed(1)}"/></filter></defs>
          <rect x="${feather}" y="${feather}" width="${Math.max(1, targetW - feather * 2)}" height="${Math.max(1, targetH - feather * 2)}" rx="${rx}" ry="${rx}" ${fillAttr} filter="url(#f)"/>
        </svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
          <rect x="${layer.strokeWidth / 2}" y="${layer.strokeWidth / 2}" width="${Math.max(1, targetW - layer.strokeWidth)}" height="${Math.max(1, targetH - layer.strokeWidth)}" rx="${rx}" ry="${rx}" ${fillAttr} ${strokeAttr}/>
        </svg>`;
        buf = await sharp(Buffer.from(svg)).png().toBuffer();
        break;
      }

      case 'vfx': {
        buf = await sharp(Buffer.from(this.buildVfxSvg(targetW, targetH, layer.preset, layer.primaryColor, layer.secondaryColor, layer.intensity)))
          .png()
          .toBuffer();
        break;
      }

      case 'text': {
        // Vertical spines are laid out horizontally in a virtual (H×W) box and rotated -90° into the layer box,
        // so the line runs along the tall side (reads bottom-to-top, like a book spine). Laying the text out in
        // the narrow width and rotating around the centre pushed every glyph outside the viewport (CS-9 finding).
        const isVerticalSpine = layer.orientation === 'vertical';
        const layoutW = isVerticalSpine ? targetH : targetW;
        const layoutH = isVerticalSpine ? targetW : targetH;
        const fit = fitTextToBox({
          text: layer.text,
          targetW: layoutW,
          targetH: layoutH,
          fontSize: layer.fontSize,
          lineHeight: layer.lineHeight,
          letterSpacing: layer.letterSpacing,
          strokeWidth: layer.strokeWidth,
          uppercase: layer.uppercase,
        });
        const fittedFs = fit.fontSize;
        const lines = fit.lines;
        const lineHeightPx = Math.round(fittedFs * layer.lineHeight);
        const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
        const pad = Math.min(18, Math.round(layoutW * 0.03));
        const textX = layer.align === 'center' ? Math.round(layoutW / 2) : layer.align === 'right' ? layoutW - pad : pad;

        let pillSvg = '';
        if (layer.pillColor) {
          const pillW = Math.min(layoutW, Math.max(80, fit.estimatedMaxLineWidth + pad * 2.2));
          const pillH = Math.min(layoutH, Math.max(28, Math.round(fit.estimatedTotalHeight + 14)));
          const pillX =
            layer.align === 'center'
              ? Math.round((layoutW - pillW) / 2)
              : layer.align === 'right'
                ? layoutW - pillW
                : 0;
          const rx = layer.pillRadius ?? 8;
          pillSvg = `<rect x="${pillX}" y="0" width="${Math.round(pillW)}" height="${pillH}" rx="${rx}" ry="${rx}" fill="${escapeXml(layer.pillColor)}"/>`;
        }

        const kerningAttr =
          layer.kerningMode === 'none'
            ? 'font-kerning="none"'
            : 'font-kerning="normal" text-rendering="geometricPrecision"';

        let defsSvg = '';
        let fillValue = escapeXml(layer.color);
        if (layer.textureOverlay === 'metallic') {
          defsSvg += `<linearGradient id="tex-metal" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#FFFFFF"/>
            <stop offset="48%" stop-color="${escapeXml(layer.color)}"/>
            <stop offset="52%" stop-color="#94A3B8"/>
            <stop offset="100%" stop-color="${escapeXml(layer.color)}"/>
          </linearGradient>`;
          fillValue = 'url(#tex-metal)';
        } else if (layer.textureOverlay === 'scanlines') {
          defsSvg += `<pattern id="tex-scan" width="8" height="6" patternUnits="userSpaceOnUse">
            <rect width="8" height="4" fill="${escapeXml(layer.color)}"/>
            <rect y="4" width="8" height="2" fill="${escapeXml(layer.color)}" fill-opacity="0.55"/>
          </pattern>`;
          fillValue = 'url(#tex-scan)';
        }

        const extrudeDepth = Math.round(layer.extrusionDepthPx ?? 0);
        const extrudeColor = escapeXml(layer.extrusionColor ?? '#090D16');

        const buildTextNodes = (dx: number, dy: number, fillOverride?: string, isExtrude = false): string =>
          lines
            .map((line, idx) => {
              const yPos = Math.round(fittedFs + (layer.pillColor ? 4 : 0) + (isVerticalSpine ? pad : 0) + idx * lineHeightPx) + dy;
              const strokeAttrs =
                !isExtrude && layer.strokeWidth > 0
                  ? `stroke="${escapeXml(layer.strokeColor)}" stroke-width="${layer.strokeWidth}" paint-order="stroke fill"`
                  : '';
              return `<text x="${textX + dx}" y="${yPos}" text-anchor="${anchor}" font-family="${escapeXml(layer.fontFamily)}, sans-serif" font-size="${fittedFs}" font-weight="${layer.fontWeight}" letter-spacing="${layer.letterSpacing}" ${kerningAttr} fill="${fillOverride ?? fillValue}" ${strokeAttrs}>${escapeXml(line)}</text>`;
            })
            .join('');

        let extrusionSvg = '';
        if (extrudeDepth > 0) {
          for (let step = extrudeDepth; step >= 1; step -= 2) {
            extrusionSvg += buildTextNodes(step, step, extrudeColor, true);
          }
        }

        const mainTspans = buildTextNodes(0, 0);
        const skewX = layer.perspectiveSkewXDeg ?? 0;
        const skewY = layer.perspectiveSkewYDeg ?? 0;
        const groupTransforms: string[] = [];
        if (isVerticalSpine) {
          // Maps the virtual layoutW×layoutH (= targetH×targetW) box onto the targetW×targetH layer box.
          groupTransforms.push(`translate(0, ${targetH}) rotate(-90)`);
        }
        if (skewX !== 0 || skewY !== 0) {
          groupTransforms.push(`skewX(${skewX}) skewY(${skewY})`);
        }
        const gOpen = groupTransforms.length > 0 ? `<g transform="${groupTransforms.join(' ')}">` : '';
        const gClose = groupTransforms.length > 0 ? '</g>' : '';

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">${defsSvg ? `<defs>${defsSvg}</defs>` : ''}${gOpen}${pillSvg}${extrusionSvg}${mainTspans}${gClose}</svg>`;
        let rawTextBuf = await sharp(Buffer.from(svg)).png().toBuffer();

        // Real glyph-bounds verification: if any rendered glyph touches the box edges, contain-fit with 6px safety margin
        const glyphBounds = await measureAlphaBounds(rawTextBuf, 20);
        if (
          glyphBounds &&
          (glyphBounds.left <= 1 ||
            glyphBounds.top <= 1 ||
            glyphBounds.left + glyphBounds.width >= targetW - 2 ||
            glyphBounds.top + glyphBounds.height >= targetH - 2)
        ) {
          const croppedGlyphs = await trimTransparentBounds(rawTextBuf, 2);
          rawTextBuf = await sharp(croppedGlyphs)
            .resize(Math.max(16, targetW - 12), Math.max(16, targetH - 12), {
              fit: 'contain',
              position: layer.align === 'center' ? 'centre' : layer.align === 'right' ? 'east' : 'west',
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .extend({
              top: 6,
              bottom: 6,
              left: 6,
              right: 6,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer();
        }
        buf = rawTextBuf;
        break;
      }

      case 'watermark': {
        const assetPath = this.resolveAssetFile(doc, layer.assetId);
        if (assetPath) {
          let wm = sharp(assetPath).resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha();
          if (layer.monochrome) {
            wm = wm.grayscale();
          }
          buf = await wm.png().toBuffer();
        } else {
          const label = escapeXml((layer.label ?? 'AETHERA').slice(0, 12));
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
            <rect x="4" y="4" width="${Math.max(1, targetW - 8)}" height="${Math.max(1, targetH - 8)}" rx="20" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-opacity="0.9"/>
            <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="${Math.max(14, Math.round(targetW * 0.16))}" font-weight="900" fill="#FFFFFF">${label}</text>
          </svg>`;
          buf = await sharp(Buffer.from(svg)).png().toBuffer();
        }
        break;
      }
    }

    if (!buf) return null;

    buf = await applyMaskToBuffer(buf, targetW, targetH, layer.mask);
    buf = await applyLayerEffects(buf, targetW, targetH, layer.effects);

    if (Math.abs(layer.transform.rotationDeg) > 0.01) {
      buf = await sharp(buf)
        .rotate(layer.transform.rotationDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    }

    buf = await applyOpacityToBuffer(buf, layer.opacity);
    return buf;
  }

  private buildVfxSvg(
    width: number,
    height: number,
    preset: 'particles' | 'speed_lines' | 'light_leak' | 'cyber_grid' | 'rim_glow' | 'duotone_wash',
    primary: string,
    secondary: string,
    intensity: number,
  ): string {
    const op = Math.max(0.1, Math.min(1, intensity));
    switch (preset) {
      case 'cyber_grid': {
        const lines: string[] = [];
        const step = Math.max(32, Math.round(width / 16));
        for (let x = 0; x <= width; x += step) {
          lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${escapeXml(primary)}" stroke-opacity="${(op * 0.28).toFixed(2)}" stroke-width="1.5"/>`);
        }
        for (let y = 0; y <= height; y += step) {
          lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${escapeXml(secondary)}" stroke-opacity="${(op * 0.22).toFixed(2)}" stroke-width="1.5"/>`);
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines.join('')}</svg>`;
      }
      case 'speed_lines': {
        const cx = Math.round(width * 0.55);
        const cy = Math.round(height * 0.5);
        const rays: string[] = [];
        for (let i = 0; i < 28; i += 1) {
          const angle = (i / 28) * Math.PI * 2;
          const r1 = Math.min(width, height) * 0.28;
          const r2 = Math.max(width, height) * 0.85;
          const x1 = Math.round(cx + Math.cos(angle) * r1);
          const y1 = Math.round(cy + Math.sin(angle) * r1);
          const x2 = Math.round(cx + Math.cos(angle) * r2);
          const y2 = Math.round(cy + Math.sin(angle) * r2);
          rays.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeXml(i % 2 === 0 ? primary : secondary)}" stroke-opacity="${(op * 0.35).toFixed(2)}" stroke-width="3"/>`);
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rays.join('')}</svg>`;
      }
      case 'particles': {
        const dots: string[] = [];
        for (let i = 0; i < 36; i += 1) {
          const px = Math.round(((i * 97) % 100) * 0.01 * width);
          const py = Math.round(((i * 53 + 17) % 100) * 0.01 * height);
          const r = 2 + (i % 6);
          const color = i % 3 === 0 ? secondary : primary;
          dots.push(`<circle cx="${px}" cy="${py}" r="${r}" fill="${escapeXml(color)}" fill-opacity="${(op * 0.65).toFixed(2)}"/>`);
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${dots.join('')}</svg>`;
      }
      case 'light_leak':
      case 'rim_glow':
      case 'duotone_wash':
      default: {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <defs>
            <radialGradient id="g1" cx="20%" cy="25%" r="65%">
              <stop offset="0%" stop-color="${escapeXml(primary)}" stop-opacity="${(op * 0.65).toFixed(2)}"/>
              <stop offset="100%" stop-color="${escapeXml(primary)}" stop-opacity="0"/>
            </radialGradient>
            <radialGradient id="g2" cx="85%" cy="80%" r="60%">
              <stop offset="0%" stop-color="${escapeXml(secondary)}" stop-opacity="${(op * 0.55).toFixed(2)}"/>
              <stop offset="100%" stop-color="${escapeXml(secondary)}" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#g1)"/>
          <rect width="100%" height="100%" fill="url(#g2)"/>
        </svg>`;
      }
    }
  }
}
