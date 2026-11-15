import { fitTextToBox } from './image-generation-adapter.js';
import type { QualityGateService } from './quality-gate.js';
import type { BrandKit, CreativeLayer, CreativeProjectDocument, LayerEffect, QualityAuditReport } from './schemas.js';

type Layer = CreativeLayer;
type TextLayer = Extract<CreativeLayer, { type: 'text' }>;
type SubjectLayer = Extract<CreativeLayer, { type: 'subject' }>;

export interface DirectorCritiqueIssue {
  code:
    | 'DUPLICATE_SUBJECT'
    | 'TEXT_SUBJECT_COLLISION'
    | 'TEXT_OVERFLOW_FIXED'
    | 'MISSING_CONTRAST_SCRIM'
    | 'BANNER_SAFE_AREA_ADJUSTED'
    | 'BRAND_IDENTITY_REUSED'
    | 'SUBJECT_REFRAMED_HERO'
    | 'TYPOGRAPHIC_HIERARCHY_ADDED'
    | 'BANNER_EDITORIAL_UPGRADED';
  severity: 'info' | 'warning' | 'repaired';
  message: string;
  layerId?: string;
}

export interface CreativeDirectorReviewResult {
  document: CreativeProjectDocument;
  issues: DirectorCritiqueIssue[];
  approvedForRender: boolean;
}

export interface ArtDirectionRoundRecord {
  iteration: number;
  rejected: boolean;
  rejectionReasons: string[];
  appliedActions: string[];
  scoreOverall: number;
  criticalCount: number;
}

export interface ArtDirectorLoopResult {
  document: CreativeProjectDocument;
  audit: QualityAuditReport;
  approved: boolean;
  iterations: number;
  issues: DirectorCritiqueIssue[];
  critiqueHistory: ArtDirectionRoundRecord[];
  editorialRationale: string;
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
 * Art Director Agent:
 * Acts as a genuine art director — runs pre-render structural checks AND an iterative
 * produce -> inspect -> reject -> recompose loop against QualityGateService until visual criteria pass.
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
            message: `Fundo "${bLayer.name}" compartilhava o mesmo frame do recorte "${sLayer.name}"; convertido para fundo atmosférico limpo.`,
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
          message: `Título "${tLayer.text}" ajustado de ${oldSize}px para ${fit.fontSize}px para caber na caixa (${boxW}×${boxH}).`,
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
        if (overlap > 0.24) {
          const subjectCenterX = sRect.x + sRect.w / 2;
          if (subjectCenterX >= doc.width * 0.48) {
            const maxRight = Math.max(280, sRect.x - 20);
            tLayer.transform.x = Math.min(tLayer.transform.x, 52);
            tLayer.transform.width = Math.min(tLayer.transform.width, Math.max(320, maxRight - tLayer.transform.x));
          } else {
            const newX = Math.min(doc.width - 360, sRect.x + sRect.w + 20);
            tLayer.transform.x = newX;
            tLayer.transform.width = Math.max(300, doc.width - newX - 48);
          }
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
            message: `Colisão (${Math.round(overlap * 100)}%) entre título "${tLayer.name}" e sujeito "${sLayer.name}" resolvida.`,
            layerId: tLayer.id,
          });
        }
      }
    }

    // 5. Contrast vignette check
    if (doc.artType === 'thumbnail' && layers.some((l) => l.visible && l.type === 'text')) {
      const hasContrastVignette = layers.some(
        (l) =>
          (l.visible && l.type === 'vfx' && (l.preset === 'duotone_wash' || l.preset === 'rim_glow')) ||
          l.effects.some((e: LayerEffect) => e.kind === 'vignette' && e.enabled),
      );
      if (!hasContrastVignette) {
        issues.push({
          code: 'MISSING_CONTRAST_SCRIM',
          severity: 'warning',
          message: 'Thumbnail sem vinheta de contraste para destacar tipografia sobre o fundo.',
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

  /**
   * Executes an iterative Art Director critique loop:
   * renders and audits the composition via QualityGateService, REJECTS flawed concepts with concrete defects,
   * recomposes structural layout/dominance/hierarchy/grounding, and re-audits until approved or maxIterations.
   */
  async directWithIterativeReview(
    initialDoc: CreativeProjectDocument,
    qualityGate: QualityGateService,
    options?: { brandKit?: BrandKit | null; maxIterations?: number },
  ): Promise<ArtDirectorLoopResult> {
    const maxIterations = Math.max(1, options?.maxIterations ?? 3);
    const brandKit = options?.brandKit ?? null;
    const allIssues: DirectorCritiqueIssue[] = [];
    const critiqueHistory: ArtDirectionRoundRecord[] = [];

    let currentDoc = initialDoc;
    let latestAudit: QualityAuditReport | null = null;

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const prePass = this.reviewAndRefine(currentDoc, { brandKit });
      currentDoc = prePass.document;
      allIssues.push(...prePass.issues);

      latestAudit = await qualityGate.auditProject(currentDoc, { brandKit });
      const criticalFindings = latestAudit.findings.filter((f) => f.severity === 'critical');

      if (criticalFindings.length === 0) {
        critiqueHistory.push({
          iteration,
          rejected: false,
          rejectionReasons: [],
          appliedActions: prePass.issues.map((i) => i.message),
          scoreOverall: latestAudit.scorecard.overall,
          criticalCount: 0,
        });
        const visibleTexts = currentDoc.layers
          .filter((l): l is TextLayer => l.visible && l.type === 'text')
          .map((l) => l.text)
          .join(' | ');
        const editorialRationale = `Aprovado na iteração ${iteration} (score ${latestAudit.scorecard.overall}/100): composição ${currentDoc.artType} com sujeito integrado, contraste verificado em resolução original e miniatura reduzida, e narrativa textual "${visibleTexts}".`;
        return {
          document: currentDoc,
          audit: latestAudit,
          approved: true,
          iterations: iteration,
          issues: allIssues,
          critiqueHistory,
          editorialRationale,
        };
      }

      const rejectionReasons = criticalFindings.map((f) => `[${f.code}] ${f.message}`);
      const appliedActions: string[] = [];
      const nextLayers: Layer[] = currentDoc.layers.map((l) => ({
        ...l,
        transform: { ...l.transform },
      }));

      const codes = new Set(criticalFindings.map((f) => f.code));
      const palette = brandKit?.palette ?? {
        primary: '#00F0FF',
        secondary: '#FF006E',
        accent: '#FACC15',
        background: '#070B14',
        surface: '#111827',
        text: '#FFFFFF',
      };

      if (codes.has('SUBJECT_TOO_SMALL') || codes.has('FLOATING_STICKER_SUBJECT')) {
        for (const layer of nextLayers) {
          if (layer.type !== 'subject') continue;
          const sLayer = layer as SubjectLayer;
          const targetH = Math.round(currentDoc.height * 0.9);
          const targetW = Math.min(
            Math.round(currentDoc.width * 0.58),
            Math.max(layer.transform.width, Math.round(targetH * 0.92)),
          );
          sLayer.anchorBottom = true;
          sLayer.groundFade = true;
          sLayer.transform.height = targetH;
          sLayer.transform.width = targetW;
          sLayer.transform.scaleX = 1;
          sLayer.transform.scaleY = 1;
          sLayer.transform.y = currentDoc.height - targetH;
          if (sLayer.transform.x + targetW > currentDoc.width) {
            sLayer.transform.x = Math.max(0, currentDoc.width - targetW - 12);
          }
          const actionMsg = `Sujeito "${sLayer.name}" reenquadrado para close-up dominante (${targetW}×${targetH}) ancorado na base.`;
          appliedActions.push(actionMsg);
          allIssues.push({
            code: 'SUBJECT_REFRAMED_HERO',
            severity: 'repaired',
            message: actionMsg,
            layerId: sLayer.id,
          });
        }
      }

      if (codes.has('MISSING_TYPOGRAPHIC_HIERARCHY') && currentDoc.artType === 'thumbnail') {
        const mainText = nextLayers.find((l): l is TextLayer => l.visible && l.type === 'text');
        if (mainText) {
          const kickerX = mainText.transform.x;
          const kickerY = Math.max(20, mainText.transform.y - 62);
          const kickerLayer: TextLayer = {
            id: `kicker-director-${iteration}`,
            type: 'text',
            role: 'kicker',
            name: 'Kicker Editorial (Diretor)',
            zIndex: Math.max(3, mainText.zIndex),
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'over',
            text: 'DESTAQUE PRO',
            fontFamily: mainText.fontFamily,
            fontSize: 28,
            fontWeight: 900,
            color: '#FFFFFF',
            strokeColor: '#000000',
            strokeWidth: 0,
            align: mainText.align,
            letterSpacing: 3,
            lineHeight: 1.1,
            uppercase: true,
            pillColor: palette.secondary,
            pillRadius: 8,
            transform: {
              x: kickerX,
              y: kickerY,
              width: Math.min(420, mainText.transform.width),
              height: 48,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
            },
            mask: { kind: 'none' },
            effects: [],
          };
          nextLayers.push(kickerLayer);
          const actionMsg = 'Adicionada tag kicker editorial acima do título para criar hierarquia de leitura.';
          appliedActions.push(actionMsg);
          allIssues.push({
            code: 'TYPOGRAPHIC_HIERARCHY_ADDED',
            severity: 'repaired',
            message: actionMsg,
            layerId: kickerLayer.id,
          });
        }
      }

      if (codes.has('BANNER_LACKS_EDITORIAL_STRUCTURE') && currentDoc.artType === 'banner') {
        const mainText = nextLayers.find((l): l is TextLayer => l.visible && l.type === 'text');
        if (mainText) {
          const subtitleLayer: TextLayer = {
            id: `subtitle-director-${iteration}`,
            type: 'text',
            role: 'subtitle',
            name: 'Subtítulo Editorial (Diretor)',
            zIndex: mainText.zIndex,
            visible: true,
            locked: false,
            opacity: 0.95,
            blendMode: 'over',
            text: 'GUIAS • ANÁLISES • GAMEPLAY',
            fontFamily: mainText.fontFamily,
            fontSize: 34,
            fontWeight: 800,
            color: palette.primary,
            strokeColor: '#000000',
            strokeWidth: 4,
            align: mainText.align,
            letterSpacing: 4,
            lineHeight: 1.1,
            uppercase: true,
            transform: {
              x: mainText.transform.x,
              y: Math.min(860, mainText.transform.y + mainText.transform.height + 12),
              width: mainText.transform.width,
              height: 56,
              scaleX: 1,
              scaleY: 1,
              rotationDeg: 0,
            },
            mask: { kind: 'none' },
            effects: [],
          };
          nextLayers.push(subtitleLayer);
          const actionMsg = 'Adicionado subtítulo editorial dentro da área segura do banner.';
          appliedActions.push(actionMsg);
          allIssues.push({
            code: 'BANNER_EDITORIAL_UPGRADED',
            severity: 'repaired',
            message: actionMsg,
            layerId: subtitleLayer.id,
          });
        }
      }

      if (codes.has('BANNER_BRAND_REDUNDANCY') && currentDoc.artType === 'banner') {
        const fallbackSlogan = brandKit?.slogan?.trim() || 'CONTEÚDO ORIGINAL • ANÁLISES E HISTÓRIAS';
        for (const f of criticalFindings) {
          if (f.code !== 'BANNER_BRAND_REDUNDANCY' || !f.layerId) continue;
          const redundant = nextLayers.find((l): l is TextLayer => l.id === f.layerId && l.type === 'text');
          if (!redundant) continue;
          if (redundant.role === 'kicker') {
            redundant.visible = false;
            appliedActions.push(`Removido kicker redundante "${redundant.text}" do banner.`);
          } else {
            redundant.text = fallbackSlogan;
            appliedActions.push(`Substituído subtítulo redundante pelo slogan "${fallbackSlogan}".`);
          }
        }
      }

      if (codes.has('LOW_SEMANTIC_RELEVANCE')) {
        const stop = new Set(['thumbnail', 'banner', 'avatar', 'canal', 'video', 'vídeo', 'sobre', 'para', 'com', 'alto', 'impacto', 'visual', 'gamer', 'oficial', 'estilo']);
        const topicTerm = currentDoc.prompt
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .find((w) => w.length >= 5 && !stop.has(w.toLowerCase()));
        if (topicTerm) {
          const subtitle = nextLayers.find((l): l is TextLayer => l.visible && l.type === 'text' && l.role === 'subtitle');
          if (subtitle && !subtitle.text.toLowerCase().includes(topicTerm.toLowerCase())) {
            subtitle.text = `${topicTerm.toUpperCase()} • ${subtitle.text}`.slice(0, 48);
          } else {
            currentDoc = { ...currentDoc, tags: [...currentDoc.tags, topicTerm.toLowerCase()] };
          }
          appliedActions.push(`Reforçada relevância semântica com termo central "${topicTerm}".`);
        }
      }

      critiqueHistory.push({
        iteration,
        rejected: true,
        rejectionReasons,
        appliedActions,
        scoreOverall: latestAudit.scorecard.overall,
        criticalCount: criticalFindings.length,
      });

      currentDoc = {
        ...currentDoc,
        layers: nextLayers,
        updatedAt: new Date().toISOString(),
      };
    }

    const finalPass = this.reviewAndRefine(currentDoc, { brandKit });
    currentDoc = finalPass.document;
    latestAudit = await qualityGate.auditProject(currentDoc, { brandKit });
    return {
      document: currentDoc,
      audit: latestAudit,
      approved: latestAudit.criticalCount === 0,
      iterations: maxIterations,
      issues: allIssues,
      critiqueHistory,
      editorialRationale: `Revisão concluída após ${maxIterations} iterações (score ${latestAudit.scorecard.overall}/100, críticos: ${latestAudit.criticalCount}).`,
    };
  }
}
