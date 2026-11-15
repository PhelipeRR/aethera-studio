import { fitTextToBox } from './image-generation-adapter.js';
import type { BrandKit, CreativeLayer, CreativeProjectDocument, LayerEffect } from './schemas.js';

type Layer = CreativeLayer;
type TextLayer = Extract<CreativeLayer, { type: 'text' }>;

export interface DirectorCritiqueIssue {
  code:
    | 'DUPLICATE_SUBJECT'
    | 'TEXT_SUBJECT_COLLISION'
    | 'TEXT_OVERFLOW_FIXED'
    | 'MISSING_CONTRAST_SCRIM'
    | 'BANNER_SAFE_AREA_ADJUSTED'
    | 'BRAND_IDENTITY_REUSED';
  severity: 'info' | 'warning' | 'repaired';
  message: string;
  layerId?: string;
}

export interface CreativeDirectorReviewResult {
  document: CreativeProjectDocument;
  issues: DirectorCritiqueIssue[];
  approvedForRender: boolean;
}

function boxesOverlapRatio(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const area = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  return (ix * iy) / area;
}

function getLayerRect(layer: Layer) {
  return {
    x: layer.transform.x,
    y: layer.transform.y,
    w: layer.transform.width * layer.transform.scaleX,
    h: layer.transform.height * layer.transform.scaleY,
  };
}

/**
 * Pre-render Creative Director Agent:
 * Critiques and auto-repairs layout collisions, text overflow, duplicate-subject backgrounds,
 * banner safe-area violations, and Brand Kit identity preservation BEFORE rendering.
 */
export class CreativeDirectorAgent {
  reviewAndRefine(
    doc: CreativeProjectDocument,
    options?: { brandKit?: BrandKit | null },
  ): CreativeDirectorReviewResult {
    const issues: DirectorCritiqueIssue[] = [];
    const layers: Layer[] = doc.layers.map((l) => ({
      ...l,
      transform: { ...l.transform },
    }));

    const subjectLayers = layers.filter((l) => l.visible && l.type === 'subject');
    const backgroundLayers = layers.filter((l) => l.visible && l.type === 'background');

    // 1. Prevent duplicate subject in background (raw same frame behind its own cutout)
    for (const sLayer of subjectLayers) {
      if (sLayer.type !== 'subject' || !sLayer.assetId) continue;
      for (const bLayer of backgroundLayers) {
        if (bLayer.type !== 'background') continue;
        if (bLayer.assetId && bLayer.assetId === sLayer.assetId && (bLayer.blurRadius ?? 0) < 14 && !bLayer.generatedByAi) {
          bLayer.blurRadius = 22;
          bLayer.brightness = Math.min(bLayer.brightness ?? 1, 0.58);
          bLayer.source = 'color';
          delete bLayer.assetId;
          issues.push({
            code: 'DUPLICATE_SUBJECT',
            severity: 'repaired',
            message: `Fundo "${bLayer.name}" compartilhava o mesmo frame do recorte "${sLayer.name}"; convertido para fundo atmosférico limpo para evitar duplicação.`,
            layerId: bLayer.id,
          });
        }
      }
    }

    // 2. Responsive typography fit on every visible text layer before render
    for (const layer of layers) {
      if (!layer.visible || layer.type !== 'text') continue;
      const tLayer = layer as TextLayer;
      const boxW = Math.round(tLayer.transform.width * tLayer.transform.scaleX);
      const boxH = Math.round(tLayer.transform.height * tLayer.transform.scaleY);
      const fit = fitTextToBox({
        text: tLayer.text,
        targetW: boxW,
        targetH: boxH,
        fontSize: tLayer.fontSize,
        lineHeight: tLayer.lineHeight,
        letterSpacing: tLayer.letterSpacing,
        strokeWidth: tLayer.strokeWidth,
        uppercase: tLayer.uppercase,
      });
      if (!fit.fitsAtRequestedSize) {
        const oldSize = tLayer.fontSize;
        tLayer.fontSize = fit.fontSize;
        issues.push({
          code: 'TEXT_OVERFLOW_FIXED',
          severity: 'repaired',
          message: `Título "${tLayer.text}" ajustado de ${oldSize}px para ${fit.fontSize}px para caber sem cortes na caixa (${boxW}×${boxH}).`,
          layerId: tLayer.id,
        });
      }
    }

    // 3. Banner Safe-Area enforcement (1546x423 centered inside 2560x1440)
    if (doc.artType === 'banner') {
      const safe = { x: 507, y: 508, width: 1546, height: 423 };
      for (const layer of layers) {
        if (!layer.visible || (layer.type !== 'text' && layer.type !== 'subject')) continue;
        const rect = getLayerRect(layer);
        if (rect.x < safe.x) {
          layer.transform.x = safe.x + 24;
          issues.push({
            code: 'BANNER_SAFE_AREA_ADJUSTED',
            severity: 'repaired',
            message: `Camada "${layer.name}" reposicionada para dentro da área segura do banner.`,
            layerId: layer.id,
          });
        }
        if (rect.x + rect.w > safe.x + safe.width) {
          layer.transform.x = Math.max(safe.x + 12, safe.x + safe.width - rect.w - 20);
        }
        if (rect.y < safe.y) {
          layer.transform.y = safe.y + 16;
        }
        if (rect.y + rect.h > safe.y + safe.height) {
          layer.transform.y = Math.max(safe.y + 12, safe.y + safe.height - rect.h - 16);
        }
      }
    }

    // 4. Title vs. Subject protection zone collision resolution
    for (const tLayer of layers) {
      if (!tLayer.visible || tLayer.type !== 'text') continue;
      for (const sLayer of subjectLayers) {
        const tRect = getLayerRect(tLayer);
        const sRect = getLayerRect(sLayer);
        const overlap = boxesOverlapRatio(tRect, sRect);
        if (overlap > 0.22) {
          // If subject is on the right, push text left and narrow it; if subject is on the left, push text right.
          const subjectCenterX = sRect.x + sRect.w / 2;
          if (subjectCenterX >= doc.width * 0.48) {
            const maxRight = Math.max(260, sRect.x - 24);
            tLayer.transform.x = Math.min(tLayer.transform.x, 48);
            tLayer.transform.width = Math.min(tLayer.transform.width, Math.max(320, maxRight - tLayer.transform.x));
          } else {
            const newX = Math.min(doc.width - 360, sRect.x + sRect.w + 24);
            tLayer.transform.x = newX;
            tLayer.transform.width = Math.max(300, doc.width - newX - 48);
          }
          // Re-fit font size to new narrowed box
          const refit = fitTextToBox({
            text: tLayer.text,
            targetW: Math.round(tLayer.transform.width * tLayer.transform.scaleX),
            targetH: Math.round(tLayer.transform.height * tLayer.transform.scaleY),
            fontSize: tLayer.fontSize,
            lineHeight: tLayer.lineHeight,
            letterSpacing: tLayer.letterSpacing,
            strokeWidth: tLayer.strokeWidth,
            uppercase: tLayer.uppercase,
          });
          tLayer.fontSize = refit.fontSize;
          issues.push({
            code: 'TEXT_SUBJECT_COLLISION',
            severity: 'repaired',
            message: `Colisão (${Math.round(overlap * 100)}%) entre título "${tLayer.name}" e sujeito "${sLayer.name}" resolvida com zona de proteção.`,
            layerId: tLayer.id,
          });
        }
      }
    }

    // 5. Ensure contrast scrim VFX exists on thumbnails when both background and text are present
    if (doc.artType === 'thumbnail' && layers.some((l) => l.visible && l.type === 'text')) {
      const hasGradientOrVignette = layers.some(
        (l) =>
          (l.visible && l.type === 'vfx' && (l.preset === 'duotone_wash' || l.preset === 'rim_glow')) ||
          l.effects.some((e: LayerEffect) => e.kind === 'vignette' && e.enabled),
      );
      if (!hasGradientOrVignette) {
        issues.push({
          code: 'MISSING_CONTRAST_SCRIM',
          severity: 'warning',
          message: 'Thumbnail sem camada de scrim/vinheta para garantir contraste do título sobre o fundo.',
        });
      }
    }

    // 6. Track persistent Brand Kit identity reuse
    const kit = options?.brandKit;
    if (kit) {
      const mascotId = kit.mascotAssetId ?? kit.avatarAssetId;
      if (mascotId && layers.some((l) => 'assetId' in l && l.assetId === mascotId)) {
        issues.push({
          code: 'BRAND_IDENTITY_REUSED',
          severity: 'info',
          message: `Identidade persistente do Brand Kit "${kit.channelName}" aplicada (${mascotId}).`,
        });
      }
    }

    return {
      document: {
        ...doc,
        layers,
        updatedAt: new Date().toISOString(),
      },
      issues,
      approvedForRender: true,
    };
  }
}
