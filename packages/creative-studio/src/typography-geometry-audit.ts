import sharp from 'sharp';
import { fitTextToBox, type SharpSvgCompositionEngine } from './image-generation-adapter.js';
import type { CreativeLayer, CreativeProjectDocument, QualityAuditFinding } from './schemas.js';

/**
 * CS-9 — Typography audit based on the REAL rendered geometry of each text layer.
 *
 * Every measurement here comes from rasterized pixels, never from the declared transform box alone:
 * - glyph bounds: the text layer rendered in isolation without pill/effects, alpha >= 128;
 * - footprint: glyphs + pill (what visually occupies the canvas), effects excluded;
 * - collisions: pixel intersection between footprints and other text/subject/shape layers;
 * - occlusion: pixels that the text actually changes in the final composite (render with vs. without it);
 * - 224×126 readability: measured line glyph height and WCAG contrast between glyph core and its
 *   immediate surround in the downscaled final composite.
 *
 * Thresholds are fixed a priori from published guidance (WCAG 2.x contrast 3:1 for large text,
 * YouTube duration-badge zone, 5% title-safe inset) and were NOT tuned against the CS-9 reference set.
 */

export const TYPOGRAPHY_GEOMETRY_THRESHOLDS = Object.freeze({
  glyphAlpha: 128,
  coreAlpha: 200,
  /** Title-safe inset on each side, as a fraction of canvas size. */
  safeInsetRatio: 0.05,
  /** YouTube duration badge zone (bottom-right) as fraction of canvas width/height. */
  timestampZone: { widthRatio: 0.16, heightRatio: 0.12 },
  previewWidth: 224,
  previewHeight: 126,
  /** Minimum measured line glyph height (px) at 224×126. */
  headlineMinGlyphPx: 7,
  headlineComfortGlyphPx: 9,
  secondaryMinGlyphPx: 5,
  /** WCAG 2.x large-text minimum contrast. */
  minContrastRatio: 3,
  /** Luma stdev (0–255) of the glyph surround above which the background is considered busy. */
  busySurroundStdev: 45,
  /** Fraction of a text footprint covered by a subject/shape/other text before it is a collision. */
  collisionCritical: 0.1,
  collisionWarning: 0.02,
  /** Fraction of glyph core pixels that do not visibly change the final composite. */
  occlusionCritical: 0.35,
});

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLayerGeometry {
  layerId: string;
  name: string;
  role: 'headline' | 'kicker' | 'subtitle' | 'unspecified';
  text: string;
  declaredBox: CanvasRect;
  glyphBox: CanvasRect | null;
  footprintBox: CanvasRect | null;
  lineCount: number;
  glyphTouchesLayerBox: boolean;
  glyphOutsideCanvasRatio: number;
  outsideSafeAreaRatio: number;
  insideTimestampZoneRatio: number;
  lineGlyphHeightAt224: number;
  contrastRatioAt224: number | null;
  surroundLumaStdevAt224: number | null;
  occludedRatio: number;
  collisions: Array<{ otherLayerId: string; otherName: string; otherType: string; coverage: number }>;
}

export interface TypographyGeometryReport {
  canvas: { width: number; height: number };
  safeArea: CanvasRect;
  timestampZone: CanvasRect;
  layers: TextLayerGeometry[];
  findings: QualityAuditFinding[];
}

interface CanvasMask {
  data: Uint8Array; // 1 = covered
  count: number;
  box: CanvasRect | null;
}

const T = TYPOGRAPHY_GEOMETRY_THRESHOLDS;

async function layerMaskOnCanvas(
  buffer: Buffer,
  layerX: number,
  layerY: number,
  canvasW: number,
  canvasH: number,
  alphaThreshold: number,
): Promise<{ mask: CanvasMask; outsidePixels: number; touchesLayerEdge: boolean; layerW: number; layerH: number }> {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(canvasW * canvasH);
  let count = 0;
  let outside = 0;
  let touches = false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const a = data[(y * info.width + x) * info.channels + (info.channels - 1)] ?? 0;
      if (a < alphaThreshold) continue;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) touches = true;
      const cx = layerX + x;
      const cy = layerY + y;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
      if (cx < 0 || cy < 0 || cx >= canvasW || cy >= canvasH) {
        outside += 1;
        continue;
      }
      out[cy * canvasW + cx] = 1;
      count += 1;
    }
  }
  const total = count + outside;
  return {
    mask: {
      data: out,
      count,
      box: total > 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    },
    outsidePixels: outside,
    touchesLayerEdge: touches,
    layerW: info.width,
    layerH: info.height,
  };
}

function countInRect(mask: CanvasMask, canvasW: number, rect: CanvasRect, inside: boolean): number {
  if (!mask.box || mask.count === 0) return 0;
  let n = 0;
  const b = mask.box;
  const x0 = Math.max(0, b.x);
  const y0 = Math.max(0, b.y);
  const x1 = b.x + b.width;
  const y1 = b.y + b.height;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (!mask.data[y * canvasW + x]) continue;
      const isIn = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
      if (isIn === inside) n += 1;
    }
  }
  return n;
}

function intersectionCount(a: CanvasMask, b: CanvasMask, canvasW: number): number {
  if (!a.box || !b.box) return 0;
  const x0 = Math.max(0, a.box.x, b.box.x);
  const y0 = Math.max(0, a.box.y, b.box.y);
  const x1 = Math.min(a.box.x + a.box.width, b.box.x + b.box.width);
  const y1 = Math.min(a.box.y + a.box.height, b.box.y + b.box.height);
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = y * canvasW + x;
      if (a.data[i] && b.data[i]) n += 1;
    }
  }
  return n;
}

function rectsIntersect(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/**
 * Glyph pixels of a text layer AS THE RENDERER PLACES THEM. The renderer may trim and rescale the whole layer
 * (pill included) when anything touches the box edge, so rendering the text without its pill would give a
 * different geometry. Instead the real layer is rendered twice with swapped fill colours (pill, stroke, layout
 * and transform identical): only glyph-fill pixels differ between the two renders.
 */
async function renderGlyphFillMask(
  engine: SharpSvgCompositionEngine,
  doc: CreativeProjectDocument,
  layer: Extract<CreativeLayer, { type: 'text' }>,
): Promise<Buffer | null> {
  const base = { ...layer, effects: [], opacity: 1 };
  const a = await engine.renderSingleLayer(doc, { ...base, color: '#FFFFFF' } as CreativeLayer);
  const b = await engine.renderSingleLayer(doc, { ...base, color: '#000000' } as CreativeLayer);
  if (!a || !b) return null;
  const ra = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rb = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return null;
  const out = Buffer.alloc(ra.info.width * ra.info.height * 4);
  for (let i = 0; i < ra.info.width * ra.info.height; i += 1) {
    const o = i * 4;
    const diff =
      (Math.abs((ra.data[o] ?? 0) - (rb.data[o] ?? 0)) +
        Math.abs((ra.data[o + 1] ?? 0) - (rb.data[o + 1] ?? 0)) +
        Math.abs((ra.data[o + 2] ?? 0) - (rb.data[o + 2] ?? 0))) /
      3;
    // Alpha encodes how strongly the pixel is glyph fill (0..255), independent of the pill underneath.
    out[o + 3] = Math.min(ra.data[o + 3] ?? 0, Math.round(diff));
  }
  return sharp(out, { raw: { width: ra.info.width, height: ra.info.height, channels: 4 } }).png().toBuffer();
}

function footprintLayer(layer: Extract<CreativeLayer, { type: 'text' }>): CreativeLayer {
  return { ...layer, effects: [] } as CreativeLayer;
}

function measureContrastAt224(
  composite: { data: Buffer; width: number; height: number; channels: number },
  maskSmall: { data: Buffer; width: number; height: number; channels: number },
): { contrast: number | null; surroundStdev: number | null; corePixels: number } {
  const w = composite.width;
  const h = composite.height;
  const coreLum: number[] = [];
  const ringLum: number[] = [];
  const ringLuma: number[] = [];
  const maskAt = (x: number, y: number) => (maskSmall.data[(y * w + x) * maskSmall.channels] ?? 0) / 255;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const m = maskAt(x, y);
      const idx = (y * w + x) * composite.channels;
      const r = composite.data[idx] ?? 0;
      const g = composite.data[idx + 1] ?? 0;
      const b = composite.data[idx + 2] ?? 0;
      if (m >= 0.6) {
        coreLum.push(relativeLuminance(r, g, b));
        continue;
      }
      if (m >= 0.15) continue;
      let nearText = false;
      for (let dy = -2; dy <= 2 && !nearText; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (maskAt(nx, ny) >= 0.15) {
            nearText = true;
            break;
          }
        }
      }
      if (nearText) {
        ringLum.push(relativeLuminance(r, g, b));
        ringLuma.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
  }
  if (coreLum.length === 0 || ringLum.length === 0) {
    return { contrast: null, surroundStdev: ringLuma.length > 0 ? stdev(ringLuma) : null, corePixels: coreLum.length };
  }
  const a = median(coreLum);
  const b = median(ringLum);
  const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return { contrast: Number(contrast.toFixed(2)), surroundStdev: Number(stdev(ringLuma).toFixed(1)), corePixels: coreLum.length };
}

export async function auditTypographyGeometry(
  engine: SharpSvgCompositionEngine,
  doc: CreativeProjectDocument,
  renderedBuffer?: Buffer,
): Promise<TypographyGeometryReport> {
  const W = doc.width;
  const H = doc.height;
  const findings: QualityAuditFinding[] = [];
  const safeArea: CanvasRect = {
    x: Math.round(W * T.safeInsetRatio),
    y: Math.round(H * T.safeInsetRatio),
    width: Math.round(W * (1 - 2 * T.safeInsetRatio)),
    height: Math.round(H * (1 - 2 * T.safeInsetRatio)),
  };
  const tzW = Math.round(W * T.timestampZone.widthRatio);
  const tzH = Math.round(H * T.timestampZone.heightRatio);
  const timestampZone: CanvasRect = { x: W - tzW, y: H - tzH, width: tzW, height: tzH };
  const isThumbnail = doc.artType === 'thumbnail';

  const rendered = renderedBuffer ?? (await engine.renderDocumentToBuffer(doc, 'png'));
  const pw = T.previewWidth;
  const ph = T.previewHeight;
  const smallComposite = await sharp(rendered)
    .resize(pw, ph, { fit: 'fill', kernel: 'linear' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const fullComposite = await sharp(rendered).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = pw / W;
  const sy = ph / H;

  const textLayers = doc.layers.filter(
    (l): l is Extract<CreativeLayer, { type: 'text' }> => l.visible && l.type === 'text',
  );

  // Pre-compute footprints for every visible text layer and alpha masks of potential colliders.
  const footprints = new Map<string, CanvasMask>();
  for (const tl of textLayers) {
    const buf = await engine.renderSingleLayer(doc, footprintLayer(tl));
    if (!buf) continue;
    const m = await layerMaskOnCanvas(buf, Math.round(tl.transform.x), Math.round(tl.transform.y), W, H, T.glyphAlpha);
    footprints.set(tl.id, m.mask);
  }
  const colliders: Array<{ layer: CreativeLayer; mask: CanvasMask }> = [];
  for (const l of doc.layers) {
    if (!l.visible || (l.type !== 'subject' && l.type !== 'shape')) continue;
    const buf = await engine.renderSingleLayer(doc, { ...l, effects: [] } as CreativeLayer);
    if (!buf) continue;
    const m = await layerMaskOnCanvas(buf, Math.round(l.transform.x), Math.round(l.transform.y), W, H, T.glyphAlpha);
    // Full-canvas scrims/overlays are not colliders; they are part of the background treatment.
    if (m.mask.count > W * H * 0.6) continue;
    colliders.push({ layer: l, mask: m.mask });
  }

  // Real compositing order: stable sort by effective z, exactly as renderDocumentToBuffer does.
  const stackOrder = new Map<string, number>(
    doc.layers
      .filter((l) => l.visible)
      .map((l, i) => ({ l, i }))
      .sort((a, b) => effectiveZ(a.l) - effectiveZ(b.l) || a.i - b.i)
      .map((e, rank) => [e.l.id, rank] as const),
  );
  const geometries: TextLayerGeometry[] = [];
  for (const tl of textLayers) {
    const role = tl.role ?? 'unspecified';
    const isPrimary = role === 'headline' || role === 'unspecified';
    const lx = Math.round(tl.transform.x);
    const ly = Math.round(tl.transform.y);
    const declaredBox: CanvasRect = {
      x: lx,
      y: ly,
      width: Math.round(tl.transform.width * tl.transform.scaleX),
      height: Math.round(tl.transform.height * tl.transform.scaleY),
    };
    const glyphBuf = await renderGlyphFillMask(engine, doc, tl);
    if (!glyphBuf) continue;
    const glyph = await layerMaskOnCanvas(glyphBuf, lx, ly, W, H, T.glyphAlpha);
    const glyphTotal = glyph.mask.count + glyph.outsidePixels;
    const footprint = footprints.get(tl.id) ?? glyph.mask;

    const vertical = tl.orientation === 'vertical';
    const layout = rendererLayout(tl, declaredBox);
    const lineCount = vertical ? 1 : Math.max(1, layout.lines.length);
    // librsvg drops whole glyphs that overflow the layer viewport instead of cutting them at the edge,
    // so truncation is detected from the renderer's own layout as well as from edge-touching pixels.
    const truncatedByLayout = !layout.fitsAfterAutoScale && (await glyphsDroppedByRenderer(engine, doc, tl, layout.fontSize));
    const lineGlyphPx = glyph.mask.box
      ? vertical
        ? glyph.mask.box.width * sx
        : (glyph.mask.box.height / lineCount) * sy
      : 0;

    const outsideSafe = isThumbnail ? countInRect(footprint, W, safeArea, false) : 0;
    const inTimestamp = isThumbnail ? countInRect(footprint, W, timestampZone, true) : 0;

    // Occlusion / invisibility: core glyph pixels that the text does not visibly change in the final composite.
    const coreGlyph = await layerMaskOnCanvas(glyphBuf, lx, ly, W, H, T.coreAlpha);
    let occludedRatio = 0;
    // Only a layer composited ABOVE the text and overlapping it can hide it; skip the extra render otherwise.
    const glyphRect = coreGlyph.mask.box;
    const mayBeCovered =
      glyphRect !== null &&
      doc.layers.some(
        (l) =>
          l.visible &&
          l.id !== tl.id &&
          (stackOrder.get(l.id) ?? 0) > (stackOrder.get(tl.id) ?? 0) &&
          rectsIntersect(glyphRect, {
            x: Math.round(l.transform.x),
            y: Math.round(l.transform.y),
            width: Math.round(l.transform.width * l.transform.scaleX),
            height: Math.round(l.transform.height * l.transform.scaleY),
          }),
      );
    if (coreGlyph.mask.count > 0 && mayBeCovered) {
      const without: CreativeProjectDocument = {
        ...doc,
        layers: doc.layers.map((l) => (l.id === tl.id ? { ...l, visible: false } : l)) as CreativeLayer[],
      };
      const withoutBuf = await sharp(await engine.renderDocumentToBuffer(without, 'png'))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let unchanged = 0;
      const ch = fullComposite.info.channels;
      for (let i = 0; i < coreGlyph.mask.data.length; i += 1) {
        if (!coreGlyph.mask.data[i]) continue;
        const o = i * ch;
        const diff =
          (Math.abs((fullComposite.data[o] ?? 0) - (withoutBuf.data[o] ?? 0)) +
            Math.abs((fullComposite.data[o + 1] ?? 0) - (withoutBuf.data[o + 1] ?? 0)) +
            Math.abs((fullComposite.data[o + 2] ?? 0) - (withoutBuf.data[o + 2] ?? 0))) /
          3;
        if (diff < 24) unchanged += 1;
      }
      occludedRatio = unchanged / coreGlyph.mask.count;
    }

    // Contrast & surround clutter at 224×126 using the glyph mask downscaled with area averaging.
    const maskCanvas = Buffer.alloc(W * H);
    for (let i = 0; i < glyph.mask.data.length; i += 1) maskCanvas[i] = glyph.mask.data[i] ? 255 : 0;
    const maskSmall = await sharp(maskCanvas, { raw: { width: W, height: H, channels: 1 } })
      .resize(pw, ph, { fit: 'fill', kernel: 'linear' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const contrast = measureContrastAt224(
      { data: smallComposite.data, width: pw, height: ph, channels: smallComposite.info.channels },
      { data: maskSmall.data, width: pw, height: ph, channels: maskSmall.info.channels },
    );

    const collisions: TextLayerGeometry['collisions'] = [];
    const fpCount = Math.max(1, footprint.count);
    for (const other of textLayers) {
      if (other.id === tl.id) continue;
      const om = footprints.get(other.id);
      if (!om) continue;
      const inter = intersectionCount(footprint, om, W);
      if (inter > 0) collisions.push({ otherLayerId: other.id, otherName: other.name, otherType: 'text', coverage: inter / fpCount });
    }
    for (const c of colliders) {
      if (c.layer.type === 'subject' && tl.behindSubject) continue; // intentional; occlusion check governs it
      // A translucent or large shape BELOW the text is a backdrop (legibility scrim, chip), not an obstacle.
      // Shapes above the text, and thin opaque shapes below it (dividers, frames), are obstacles.
      const belowText = (stackOrder.get(c.layer.id) ?? 0) < (stackOrder.get(tl.id) ?? 0);
      // Rectangular subject panels without cutout (e.g. before/after halves) are backgrounds, as in QualityGate 5.5.
      const isPanel = c.layer.type === 'subject' && c.layer.cutoutMethod === 'none' && !c.layer.removeBackground;
      const isBackdrop =
        belowText &&
        (isPanel || (c.layer.type === 'shape' && (c.layer.opacity < 0.9 || c.mask.count > W * H * 0.1)));
      if (isBackdrop) continue;
      const inter = intersectionCount(footprint, c.mask, W);
      if (inter > 0) collisions.push({ otherLayerId: c.layer.id, otherName: c.layer.name, otherType: c.layer.type, coverage: inter / fpCount });
    }

    const geometry: TextLayerGeometry = {
      layerId: tl.id,
      name: tl.name,
      role,
      text: tl.text,
      declaredBox,
      glyphBox: glyph.mask.box,
      footprintBox: footprint.box,
      lineCount,
      glyphTouchesLayerBox: glyph.touchesLayerEdge || truncatedByLayout,
      glyphOutsideCanvasRatio: glyphTotal > 0 ? glyph.outsidePixels / glyphTotal : 0,
      outsideSafeAreaRatio: outsideSafe / fpCount,
      insideTimestampZoneRatio: inTimestamp / fpCount,
      lineGlyphHeightAt224: Number(lineGlyphPx.toFixed(2)),
      contrastRatioAt224: contrast.contrast,
      surroundLumaStdevAt224: contrast.surroundStdev,
      occludedRatio: Number(occludedRatio.toFixed(3)),
      collisions,
    };
    geometries.push(geometry);

    const label = `"${tl.text}" (${tl.name})`;
    const sev = (critical: boolean): QualityAuditFinding['severity'] => (critical ? 'critical' : 'warning');

    if (glyphTotal === 0) {
      findings.push({ code: 'TEXT_NOT_RENDERED', severity: 'critical', message: `Texto ${label} não produziu nenhum glifo visível.`, layerId: tl.id });
      continue;
    }
    if (geometry.glyphOutsideCanvasRatio > 0) {
      findings.push({
        code: 'TEXT_CLIPPED_BY_CANVAS',
        severity: 'critical',
        message: `Texto ${label}: ${(geometry.glyphOutsideCanvasRatio * 100).toFixed(1)}% dos glifos renderizados ficam fora do canvas.`,
        layerId: tl.id,
      });
    }
    if (glyph.touchesLayerEdge || truncatedByLayout) {
      findings.push({
        code: 'TEXT_CLIPPED_BY_BOX',
        severity: 'critical',
        message: truncatedByLayout
          ? `Texto ${label}: não cabe na caixa ${declaredBox.width}×${declaredBox.height} nem no tamanho mínimo (${layout.fontSize}px); o rasterizador descarta os glifos excedentes.`
          : `Texto ${label}: glifos renderizados encostam na borda da caixa da camada (corte real do rasterizador).`,
        layerId: tl.id,
      });
    }
    if (isThumbnail && geometry.outsideSafeAreaRatio > 0) {
      findings.push({
        code: 'TEXT_OUTSIDE_SAFE_AREA',
        severity: sev(isPrimary && geometry.outsideSafeAreaRatio > 0.05),
        message: `Texto ${label}: ${(geometry.outsideSafeAreaRatio * 100).toFixed(1)}% da área ocupada fica fora da área segura (${safeArea.width}×${safeArea.height} @ ${safeArea.x},${safeArea.y}).`,
        layerId: tl.id,
      });
    }
    if (isThumbnail && geometry.insideTimestampZoneRatio > 0) {
      findings.push({
        code: 'TEXT_UNDER_TIMESTAMP_BADGE',
        severity: sev(geometry.insideTimestampZoneRatio > 0.05),
        message: `Texto ${label}: ${(geometry.insideTimestampZoneRatio * 100).toFixed(1)}% fica sob o selo de duração do YouTube (canto inferior direito).`,
        layerId: tl.id,
      });
    }
    for (const c of collisions) {
      if (c.coverage < T.collisionWarning) continue;
      findings.push({
        code: c.otherType === 'text' ? 'TEXT_TEXT_COLLISION' : c.otherType === 'subject' ? 'TEXT_SUBJECT_COLLISION' : 'TEXT_SHAPE_COLLISION',
        severity: sev(c.coverage >= T.collisionCritical),
        message: `Texto ${label} colide com ${c.otherType} "${c.otherName}" em ${(c.coverage * 100).toFixed(1)}% da sua área renderizada.`,
        layerId: tl.id,
      });
    }
    if (geometry.occludedRatio > T.occlusionCritical) {
      findings.push({
        code: 'TEXT_OCCLUDED_OR_INVISIBLE',
        severity: 'critical',
        message: `Texto ${label}: ${(geometry.occludedRatio * 100).toFixed(0)}% dos glifos não alteram a imagem final (encoberto ou sem contraste com o fundo).`,
        layerId: tl.id,
      });
    }
    if (isThumbnail) {
      const minPx = isPrimary ? T.headlineMinGlyphPx : T.secondaryMinGlyphPx;
      if (lineGlyphPx < minPx) {
        findings.push({
          code: 'TEXT_TOO_SMALL_AT_224',
          severity: sev(isPrimary),
          message: `Texto ${label}: altura medida da linha em 224×126 é ${lineGlyphPx.toFixed(1)}px (mínimo ${minPx}px).`,
          layerId: tl.id,
        });
      } else if (isPrimary && lineGlyphPx < T.headlineComfortGlyphPx) {
        findings.push({
          code: 'TEXT_SMALL_AT_224',
          severity: 'warning',
          message: `Texto ${label}: ${lineGlyphPx.toFixed(1)}px em 224×126, abaixo do conforto de ${T.headlineComfortGlyphPx}px.`,
          layerId: tl.id,
        });
      }
      if (contrast.contrast === null) {
        findings.push({
          code: 'TEXT_ILLEGIBLE_AT_224',
          severity: sev(isPrimary),
          message: `Texto ${label}: nenhum pixel de glifo sobrevive como núcleo legível em 224×126.`,
          layerId: tl.id,
        });
      } else if (contrast.contrast < T.minContrastRatio) {
        findings.push({
          code: 'TEXT_LOW_CONTRAST_AT_224',
          severity: sev(isPrimary),
          message: `Texto ${label}: contraste medido em 224×126 = ${contrast.contrast}:1 (mínimo WCAG ${T.minContrastRatio}:1).`,
          layerId: tl.id,
        });
      }
      if (contrast.surroundStdev !== null && contrast.surroundStdev > T.busySurroundStdev) {
        findings.push({
          code: 'TEXT_BUSY_BACKGROUND_AT_224',
          severity: sev(isPrimary && (contrast.contrast ?? 0) < 4.5),
          message: `Texto ${label}: fundo imediato muito carregado em 224×126 (desvio de luma ${contrast.surroundStdev}).`,
          layerId: tl.id,
        });
      }
    }
  }

  return { canvas: { width: W, height: H }, safeArea, timestampZone, layers: geometries, findings };
}

/**
 * Empirical truncation check. fitTextToBox is a conservative estimator, so "does not fit" is only a suspicion.
 * The same layer is rendered at the same effective font size in a box 4× larger, where nothing can be dropped,
 * and the number of glyph components (letters/marks, from the colour-swap fill mask) is compared. Component
 * counts are invariant to the trim-and-rescale the renderer applies, unlike pixel counts.
 */
async function glyphsDroppedByRenderer(
  engine: SharpSvgCompositionEngine,
  doc: CreativeProjectDocument,
  layer: Extract<CreativeLayer, { type: 'text' }>,
  fittedFontSize: number,
): Promise<boolean> {
  const components = async (l: Extract<CreativeLayer, { type: 'text' }>) => {
    const buf = await renderGlyphFillMask(engine, doc, l);
    if (!buf) return null;
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    return countComponents(data, info.width, info.height, info.channels, T.glyphAlpha, 4);
  };
  const real = await components(layer);
  const wide = await components({
    ...layer,
    fontSize: fittedFontSize,
    transform: { ...layer.transform, width: layer.transform.width * 4, height: layer.transform.height * 4 },
  } as Extract<CreativeLayer, { type: 'text' }>);
  if (real === null || wide === null || wide === 0) return false;
  return real < wide;
}

function countComponents(data: Buffer, w: number, h: number, channels: number, alphaMin: number, minPixels: number): number {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  let components = 0;
  for (let start = 0; start < w * h; start += 1) {
    if (seen[start] || (data[start * channels + channels - 1] ?? 0) < alphaMin) continue;
    let size = 0;
    seen[start] = 1;
    stack.push(start);
    for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
      size += 1;
      const x = i % w;
      const y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || (data[j * channels + channels - 1] ?? 0) < alphaMin) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (size >= minPixels) components += 1;
  }
  return components;
}

/** Same z ordering as SharpSvgCompositionEngine.renderDocumentToBuffer. */
function effectiveZ(layer: CreativeLayer): number {
  return layer.type === 'text' && layer.behindSubject ? 0.5 : layer.zIndex;
}

/** Layout exactly as the rasterizer computes it (same fitTextToBox call as SharpSvgCompositionEngine.renderLayer). */
function rendererLayout(layer: Extract<CreativeLayer, { type: 'text' }>, box: CanvasRect) {
  const vertical = layer.orientation === 'vertical';
  return fitTextToBox({
    text: layer.text,
    targetW: vertical ? box.height : box.width,
    targetH: vertical ? box.width : box.height,
    fontSize: layer.fontSize,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    strokeWidth: layer.strokeWidth,
    uppercase: layer.uppercase,
  });
}
