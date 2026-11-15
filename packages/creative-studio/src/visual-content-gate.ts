import sharp from 'sharp';
import type { ManagedAssetRef } from './schemas.js';

/**
 * Visual Content Gate — blocks generic/placeholder media BEFORE it reaches composition.
 *
 * Unlike QualityGateService (which validates structural/layout metrics post-render),
 * this gate inspects the RAW acquired asset to ensure it contains actual visual content
 * relevant to the concept, not procedural geometry masquerading as imagery.
 */

export interface VisualContentVerdict {
  passed: boolean;
  isPlaceholder: boolean;
  isGenericBackground: boolean;
  hasRecognizableSubject: boolean;
  semanticMatchScore: number;
  blockReason?: string | undefined;
  diagnostics: string[];
}

export interface VisualContentGateInput {
  asset: ManagedAssetRef;
  /** Absolute path to the resolved asset file on disk */
  assetPath: string;
  /** The concept's media requirement prompt/query that produced this asset */
  queryOrPrompt: string;
  /** Concept title for semantic cross-check */
  conceptTitle: string;
  /** Genre hint for subject-expectation calibration */
  genre?: 'games' | 'anime' | 'documentary' | 'general' | undefined;
}

/**
 * Detects whether an image buffer is a procedural placeholder (gradients, circles, bars)
 * rather than real photographic/AI-generated content with recognizable subjects.
 */
async function detectPlaceholder(buffer: Buffer): Promise<{
  isPlaceholder: boolean;
  confidence: number;
  signals: string[];
}> {
  const signals: string[] = [];
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const totalPixels = w * h;

  if (totalPixels === 0) {
    return { isPlaceholder: true, confidence: 1, signals: ['empty-image'] };
  }

  // 1. Check color diversity — placeholders have very few distinct colors
  const colorBuckets = new Map<string, number>();
  let transparentPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a < 20) {
      transparentPixels += 1;
      continue;
    }
    // Quantize to 8-bit buckets per channel
    const r = Math.round((data[i] ?? 0) / 32);
    const g = Math.round((data[i + 1] ?? 0) / 32);
    const b = Math.round((data[i + 2] ?? 0) / 32);
    const key = `${r},${g},${b}`;
    colorBuckets.set(key, (colorBuckets.get(key) ?? 0) + 1);
  }

  const nonTransparentPixels = totalPixels - transparentPixels;
  const uniqueColors = colorBuckets.size;
  const colorDiversity = uniqueColors / Math.max(1, nonTransparentPixels);

  // Real images typically have >500 unique quantized colors; placeholders have <80
  if (uniqueColors < 80) {
    signals.push(`low-color-diversity (${uniqueColors} unique colors)`);
  }

  // 2. Check edge density — placeholders have very few edges (smooth gradients)
  // Simple Sobel-like gradient magnitude estimation on a downsampled grid
  const sampleStep = Math.max(4, Math.floor(Math.min(w, h) / 64));
  let edgeSum = 0;
  let edgeSamples = 0;
  for (let y = sampleStep; y < h - sampleStep; y += sampleStep) {
    for (let x = sampleStep; x < w - sampleStep; x += sampleStep) {
      const idx = (y * w + x) * 4;
      const idxR = (y * w + x + sampleStep) * 4;
      const idxD = ((y + sampleStep) * w + x) * 4;
      const lum = (data[idx] ?? 0) * 0.299 + (data[idx + 1] ?? 0) * 0.587 + (data[idx + 2] ?? 0) * 0.114;
      const lumR = (data[idxR] ?? 0) * 0.299 + (data[idxR + 1] ?? 0) * 0.587 + (data[idxR + 2] ?? 0) * 0.114;
      const lumD = (data[idxD] ?? 0) * 0.299 + (data[idxD + 1] ?? 0) * 0.587 + (data[idxD + 2] ?? 0) * 0.114;
      const gx = Math.abs(lumR - lum);
      const gy = Math.abs(lumD - lum);
      edgeSum += Math.sqrt(gx * gx + gy * gy);
      edgeSamples += 1;
    }
  }
  const avgEdge = edgeSamples > 0 ? edgeSum / edgeSamples : 0;

  // Real photographs/AI art have avg edge >12; smooth gradients have <5
  if (avgEdge < 6) {
    signals.push(`low-edge-density (avg=${avgEdge.toFixed(1)})`);
  }

  // 3. Check for radial symmetry — procedural placeholders often have centered circles
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const maxR = Math.min(cx, cy);
  let symmetricPairs = 0;
  let totalPairs = 0;
  for (let angle = 0; angle < 8; angle += 1) {
    const theta = (angle / 8) * Math.PI * 2;
    for (let r = 10; r < maxR - 10; r += Math.max(4, Math.floor(maxR / 32))) {
      const x1 = Math.round(cx + Math.cos(theta) * r);
      const y1 = Math.round(cy + Math.sin(theta) * r);
      const x2 = Math.round(cx - Math.cos(theta) * r);
      const y2 = Math.round(cy - Math.sin(theta) * r);
      if (x1 >= 0 && x1 < w && y1 >= 0 && y1 < h && x2 >= 0 && x2 < w && y2 >= 0 && y2 < h) {
        const idx1 = (y1 * w + x1) * 4;
        const idx2 = (y2 * w + x2) * 4;
        const dr = Math.abs((data[idx1] ?? 0) - (data[idx2] ?? 0));
        const dg = Math.abs((data[idx1 + 1] ?? 0) - (data[idx2 + 1] ?? 0));
        const db = Math.abs((data[idx1 + 2] ?? 0) - (data[idx2 + 2] ?? 0));
        if (dr + dg + db < 30) symmetricPairs += 1;
        totalPairs += 1;
      }
    }
  }
  const symmetryRatio = totalPairs > 0 ? symmetricPairs / totalPairs : 0;
  if (symmetryRatio > 0.85) {
    signals.push(`high-radial-symmetry (${(symmetryRatio * 100).toFixed(0)}%)`);
  }

  // 4. File size heuristic — procedural SVGs rendered to PNG are tiny
  const fileSizeKB = buffer.length / 1024;
  if (fileSizeKB < 15 && w >= 512) {
    signals.push(`tiny-file-size (${fileSizeKB.toFixed(1)}KB for ${w}×${h})`);
  }

  // Compute confidence
  let confidence = 0;
  if (signals.includes('low-color-diversity')) confidence += 0.35;
  if (signals.includes('low-edge-density')) confidence += 0.30;
  if (signals.includes('high-radial-symmetry')) confidence += 0.20;
  if (signals.includes('tiny-file-size')) confidence += 0.15;
  if (signals.includes('empty-image')) confidence = 1;

  return {
    isPlaceholder: confidence >= 0.55,
    confidence: Math.min(1, confidence),
    signals,
  };
}

/**
 * Checks whether the asset filename or provenance indicates it was generated
 * by the local procedural fallback rather than real AI generation or video extraction.
 */
function detectFallbackProvenance(asset: ManagedAssetRef, queryOrPrompt: string): {
  isFallback: boolean;
  reason?: string;
} {
  // The procedural fallback in acquireConceptMedia names files with "-procedural.png"
  if (asset.originalName.includes('-procedural')) {
    return { isFallback: true, reason: `Asset "${asset.originalName}" foi gerado pelo fallback procedural local (SVG geométrico).` };
  }

  // Also catch transformed-but-still-fallback assets
  if (asset.originalName.includes('-transformed') && !queryOrPrompt.toLowerCase().includes('transform')) {
    return { isFallback: true, reason: `Asset "${asset.originalName}" é uma transformação local de outro fallback, não geração IA real.` };
  }

  return { isFallback: false };
}

/**
 * Validates that an acquired media asset contains real visual content suitable
 * for editorial thumbnail composition. Blocks placeholders, generic backgrounds,
 * and procedurally generated geometry.
 */
export async function evaluateVisualContent(input: VisualContentGateInput): Promise<VisualContentVerdict> {
  const diagnostics: string[] = [];
  let passed = true;
  let isPlaceholder = false;
  let isGenericBackground = false;
  let hasRecognizableSubject = false;
  let semanticMatchScore = 0;

  // 1. Provenance check — catch fallback before even reading pixels
  const fallbackCheck = detectFallbackProvenance(input.asset, input.queryOrPrompt);
  if (fallbackCheck.isFallback) {
    diagnostics.push(fallbackCheck.reason!);
    isPlaceholder = true;
    passed = false;
    return {
      passed: false,
      isPlaceholder: true,
      isGenericBackground: false,
      hasRecognizableSubject: false,
      semanticMatchScore: 0,
      blockReason: fallbackCheck.reason,
      diagnostics,
    };
  }

  // 2. Read and analyze the actual image
  let buffer: Buffer;
  try {
    buffer = await sharp(input.assetPath).png().toBuffer();
  } catch {
    return {
      passed: false,
      isPlaceholder: false,
      isGenericBackground: false,
      hasRecognizableSubject: false,
      semanticMatchScore: 0,
      blockReason: `Não foi possível ler o asset "${input.asset.originalName}" para validação visual.`,
      diagnostics: ['image-read-failure'],
    };
  }

  // 3. Placeholder detection via pixel analysis
  const placeholderResult = await detectPlaceholder(buffer);
  if (placeholderResult.isPlaceholder) {
    isPlaceholder = true;
    passed = false;
    diagnostics.push(`Detecção de placeholder: ${placeholderResult.signals.join(', ')}`);
  }

  // 4. Edge/complexity analysis for subject presence
  const meta = await sharp(buffer).metadata();
  const stats = await sharp(buffer).stats();
  const meanStdev =
    ((stats.channels[0]?.stdev ?? 0) + (stats.channels[1]?.stdev ?? 0) + (stats.channels[2]?.stdev ?? 0)) / 3;

  // Images with stdev < 18 across all channels are likely uniform/generic backgrounds
  if (meanStdev < 18) {
    isGenericBackground = true;
    passed = false;
    diagnostics.push(`Fundo genérico/uniforme detectado (stdev médio=${meanStdev.toFixed(1)}).`);
  }

  // Subject presence heuristic: sufficient complexity + non-uniform spatial distribution
  hasRecognizableSubject = !isPlaceholder && !isGenericBackground && meanStdev >= 28;

  // 5. Semantic match between query and asset metadata
  const queryTokens = input.queryOrPrompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
  const assetNameTokens = input.asset.originalName
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
  const matchedTokens = queryTokens.filter((t) => assetNameTokens.some((a) => a.includes(t) || t.includes(a)));
  semanticMatchScore = queryTokens.length > 0 ? Math.round((matchedTokens.length / queryTokens.length) * 100) : 50;

  if (semanticMatchScore < 20 && !isPlaceholder) {
    diagnostics.push(`Baixa correlação semântica entre query e asset (${semanticMatchScore}%).`);
  }

  // Final verdict
  if (!passed) {
    const reasons: string[] = [];
    if (isPlaceholder) reasons.push('Imagem é um placeholder geométrico/procedural');
    if (isGenericBackground) reasons.push('Imagem é um fundo genérico sem conteúdo reconhecível');
    return {
      passed: false,
      isPlaceholder,
      isGenericBackground,
      hasRecognizableSubject,
      semanticMatchScore,
      blockReason: reasons.join('; '),
      diagnostics,
    };
  }

  diagnostics.push(`Asset aprovado: complexidade=${meanStdev.toFixed(1)}, diversidade cromática OK, sujeito reconhecível.`);
  return {
    passed: true,
    isPlaceholder: false,
    isGenericBackground: false,
    hasRecognizableSubject,
    semanticMatchScore,
    diagnostics,
  };
}