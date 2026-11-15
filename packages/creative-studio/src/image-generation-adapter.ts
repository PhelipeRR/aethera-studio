import { existsSync } from 'node:fs';
import sharp from 'sharp';
import type { AssetIngestionService } from './asset-ingestion.js';
import type {
  BlendMode,
  CreativeLayer,
  CreativeProjectDocument,
  LayerEffect,
  LayerMask,
  ManagedAssetRef,
} from './schemas.js';

export interface ImageGenerationRequest {
  prompt: string;
  width: number;
  height: number;
  style?: string;
  referenceImagePaths?: string[];
}

export interface BackgroundRemovalRequest {
  inputImagePath: string;
  featherPx?: number;
}

/**
 * Optional external AI image generation / segmentation adapter.
 * Kept strictly separate from deterministic Sharp/SVG layer composition.
 */
export interface ExternalImageAdapter {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  generateImage?(request: ImageGenerationRequest): Promise<Buffer>;
  removeBackground?(request: BackgroundRemovalRequest): Promise<Buffer>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toSharpBlend(mode: BlendMode): sharp.Blend {
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
    return {
      r: parseInt(clean[0]! + clean[0]!, 16),
      g: parseInt(clean[1]! + clean[1]!, 16),
      b: parseInt(clean[2]! + clean[2]!, 16),
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
        .composite([{ input: Buffer.from(svg), blend: 'screen' }])
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
        Math.max(1, effect.radius / 2),
        effect.intensity,
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
      .sort((a, b) => a.zIndex - b.zIndex);

    const baseCanvas = sharp({
      create: {
        width: doc.width,
        height: doc.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    const composites: sharp.OverlayOptions[] = [];

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

  private async renderLayer(doc: CreativeProjectDocument, layer: CreativeLayer): Promise<Buffer | null> {
    const targetW = Math.max(1, Math.round(layer.transform.width * layer.transform.scaleX));
    const targetH = Math.max(1, Math.round(layer.transform.height * layer.transform.scaleY));

    let buf: Buffer | null = null;

    switch (layer.type) {
      case 'background': {
        const assetPath = this.resolveAssetFile(doc, layer.assetId);
        if (assetPath) {
          buf = await sharp(assetPath)
            .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
            .ensureAlpha()
            .png()
            .toBuffer();
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
          subjectBuf = await sharp(assetPath)
            .resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .ensureAlpha()
            .png()
            .toBuffer();
        }
        buf = await sharp(subjectBuf)
          .resize(targetW, targetH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        if (layer.rimLightColor) {
          const rimGlow = await createAlphaSilhouetteLayer(buf, targetW, targetH, layer.rimLightColor, 10, 0.9);
          buf = await sharp({
            create: { width: targetW, height: targetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
          })
            .composite([
              { input: rimGlow, left: -4, top: -2, blend: 'screen' },
              { input: buf, left: 0, top: 0, blend: 'over' },
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
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
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
        const display = layer.uppercase ? layer.text.toUpperCase() : layer.text;
        const approxCharWidth = layer.fontSize * 0.56;
        const maxChars = Math.max(6, Math.floor(targetW / Math.max(10, approxCharWidth)));
        const lines = wrapTextLines(display, maxChars);
        const lineHeightPx = Math.round(layer.fontSize * layer.lineHeight);
        const anchor = layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
        const textX = layer.align === 'center' ? Math.round(targetW / 2) : layer.align === 'right' ? targetW - 16 : 16;

        const tspans = lines
          .map((line, idx) => {
            const yPos = Math.round(layer.fontSize + idx * lineHeightPx);
            return `<text x="${textX}" y="${yPos}" text-anchor="${anchor}" font-family="${escapeXml(layer.fontFamily)}, sans-serif" font-size="${layer.fontSize}" font-weight="${layer.fontWeight}" letter-spacing="${layer.letterSpacing}" fill="${escapeXml(layer.color)}" stroke="${escapeXml(layer.strokeColor)}" stroke-width="${layer.strokeWidth}" paint-order="stroke fill">${escapeXml(line)}</text>`;
          })
          .join('');

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">${tspans}</svg>`;
        buf = await sharp(Buffer.from(svg)).png().toBuffer();
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
