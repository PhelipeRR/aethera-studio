import sharp from 'sharp';
import { fitTextToBox, type SharpSvgCompositionEngine } from './image-generation-adapter.js';
import { auditTypographyGeometry, type TextLayerGeometry } from './typography-geometry-audit.js';
import {
  ART_SPECIFICATIONS,
  qualityAuditReportSchema,
  type BrandKit,
  type CreativeProjectDocument,
  type QualityAuditFinding,
  type QualityAuditReport,
} from './schemas.js';

export class QualityGateService {
  constructor(private readonly engine: SharpSvgCompositionEngine) {}

  async auditProject(
    doc: CreativeProjectDocument,
    options?: { brandKit?: BrandKit | null; renderedBuffer?: Buffer },
  ): Promise<QualityAuditReport> {
    const findings: QualityAuditFinding[] = [];
    const spec = ART_SPECIFICATIONS[doc.artType];

    // 1. Resolution & aspect ratio
    if (doc.width < spec.minWidth || doc.height < spec.minHeight) {
      findings.push({
        code: 'RESOLUTION_TOO_LOW',
        severity: 'critical',
        message: `Resolução ${doc.width}×${doc.height} abaixo do mínimo ${spec.minWidth}×${spec.minHeight} para ${doc.artType}.`,
      });
    }

    // 2. Render actual buffer and inspect real pixels
    const rendered = options?.renderedBuffer ?? (await this.engine.renderDocumentToBuffer(doc, 'png'));
    const meta = await sharp(rendered).metadata();
    if (meta.width !== doc.width || meta.height !== doc.height) {
      findings.push({
        code: 'RENDER_DIMENSION_MISMATCH',
        severity: 'critical',
        message: `Imagem renderizada (${meta.width}×${meta.height}) diverge do documento (${doc.width}×${doc.height}).`,
      });
    }

    // 3. Watermark transparency check
    if (doc.artType === 'watermark') {
      const { data } = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let transparentPixels = 0;
      const totalPixels = Math.max(1, data.length / 4);
      for (let i = 3; i < data.length; i += 4) {
        if ((data[i] ?? 255) < 250) transparentPixels += 1;
      }
      const transparentRatio = transparentPixels / totalPixels;
      if (transparentRatio < 0.15) {
        findings.push({
          code: 'WATERMARK_NOT_TRANSPARENT',
          severity: 'critical',
          message: `Marca d'água possui apenas ${(transparentRatio * 100).toFixed(1)}% de área transparente.`,
        });
      }
    }

    // 4. Banner safe-area check (1546x423)
    if (doc.artType === 'banner' && spec.safeArea) {
      const safe = spec.safeArea;
      for (const layer of doc.layers) {
        if (!layer.visible || (layer.type !== 'text' && layer.type !== 'subject')) continue;
        const lx1 = layer.transform.x;
        const ly1 = layer.transform.y;
        const lx2 = lx1 + layer.transform.width * layer.transform.scaleX;
        const ly2 = ly1 + layer.transform.height * layer.transform.scaleY;
        const outsideSafe =
          lx1 < safe.x || ly1 < safe.y || lx2 > safe.x + safe.width || ly2 > safe.y + safe.height;
        if (outsideSafe) {
          findings.push({
            code: 'BANNER_OUTSIDE_SAFE_AREA',
            severity: layer.type === 'text' ? 'critical' : 'warning',
            message: `Camada "${layer.name}" ultrapassa a área segura do banner (${safe.width}×${safe.height}).`,
            layerId: layer.id,
          });
        }
      }
    }

    // 5. Text legibility & bounds check
    const visibleTexts = doc.layers.filter((l) => l.visible && l.type === 'text');
    let legibility = 88;
    if (doc.artType === 'thumbnail' && visibleTexts.length === 0) {
      legibility = 62;
      findings.push({
        code: 'THUMBNAIL_MISSING_TITLE',
        severity: 'warning',
        message: 'Thumbnail sem camada de título visível.',
      });
    }
    for (const layer of visibleTexts) {
      if (layer.type !== 'text') continue;
      if (
        doc.artType === 'thumbnail' &&
        layer.role !== 'kicker' &&
        layer.role !== 'subtitle' &&
        layer.fontSize < 56
      ) {
        legibility -= 25;
        findings.push({
          code: 'TITLE_TOO_SMALL_FOR_FEED',
          severity: 'critical',
          message: `Título "${layer.text}" com fonte ${layer.fontSize}px pode ficar ilegível em miniaturas mobile.`,
          layerId: layer.id,
        });
      }
      const wordCount = layer.text.trim().split(/\s+/).length;
      if (doc.artType === 'thumbnail' && wordCount > 6) {
        legibility -= 15;
        findings.push({
          code: 'TITLE_TOO_LONG',
          severity: 'warning',
          message: `Título com ${wordCount} palavras; recomenda-se até 5 palavras para leitura instantânea.`,
          layerId: layer.id,
        });
      }
      if (
        layer.transform.x < 0 ||
        layer.transform.y < 0 ||
        layer.transform.x + layer.transform.width * layer.transform.scaleX > doc.width ||
        layer.transform.y + layer.transform.height * layer.transform.scaleY > doc.height
      ) {
        legibility -= 20;
        findings.push({
          code: 'CLIPPED_ELEMENT',
          severity: 'critical',
          message: `Camada de texto "${layer.name}" está cortada fora dos limites do canvas.`,
          layerId: layer.id,
        });
      }

      const boxW = Math.round(layer.transform.width * layer.transform.scaleX);
      const boxH = Math.round(layer.transform.height * layer.transform.scaleY);
      const layerOrientation =
        layer.type === 'text' ? (layer as Extract<typeof layer, { type: 'text' }>).orientation : undefined;
      const textFit = fitTextToBox({
        text: layer.text,
        targetW: boxW,
        targetH: boxH,
        fontSize: layer.fontSize,
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing,
        strokeWidth: layer.strokeWidth,
        uppercase: layer.uppercase,
        minFontSize: layer.role === 'kicker' || layer.role === 'subtitle' ? 18 : 24,
        ...(layerOrientation ? { orientation: layerOrientation } : {}),
      });
      if (!textFit.fitsAfterAutoScale) {
        legibility -= 25;
        findings.push({
          code: 'TEXT_INTERNAL_OVERFLOW',
          severity: 'critical',
          message: `Texto "${layer.text}" excede a caixa (${boxW}×${boxH}) mesmo após redução responsiva para ${textFit.fontSize}px.`,
          layerId: layer.id,
        });
      } else if (!textFit.fitsAtRequestedSize) {
        legibility -= 6;
        findings.push({
          code: 'TEXT_INTERNAL_OVERFLOW',
          severity: 'warning',
          message: `Texto "${layer.text}" exigiu auto-ajuste de ${layer.fontSize}px para ${textFit.fontSize}px para não cortar na caixa (${boxW}×${boxH}).`,
          layerId: layer.id,
        });
      }
    }

    // 5.5. Text vs. Subject overlap & duplicate-subject check
    const visibleSubjects = doc.layers.filter((l) => l.visible && l.type === 'subject');
    const visibleBackgrounds = doc.layers.filter((l) => l.visible && l.type === 'background');
    for (const tLayer of visibleTexts) {
      const tx1 = tLayer.transform.x;
      const ty1 = tLayer.transform.y;
      const tx2 = tx1 + tLayer.transform.width * tLayer.transform.scaleX;
      const ty2 = ty1 + tLayer.transform.height * tLayer.transform.scaleY;
      const tArea = Math.max(1, (tx2 - tx1) * (ty2 - ty1));

      for (const sLayer of visibleSubjects) {
        if (sLayer.type === 'subject' && sLayer.cutoutMethod === 'none' && !sLayer.removeBackground) continue;
        const sx1 = sLayer.transform.x;
        const sy1 = sLayer.transform.y;
        const sx2 = sx1 + sLayer.transform.width * sLayer.transform.scaleX;
        const sy2 = sy1 + sLayer.transform.height * sLayer.transform.scaleY;
        const ix = Math.max(0, Math.min(tx2, sx2) - Math.max(tx1, sx1));
        const iy = Math.max(0, Math.min(ty2, sy2) - Math.max(ty1, sy1));
        const overlapRatio = (ix * iy) / tArea;
        if (overlapRatio > 0.32) {
          legibility -= 18;
          findings.push({
            code: 'TEXT_SUBJECT_OVERLAP',
            severity: 'critical',
            message: `Título "${tLayer.name}" invade ${(overlapRatio * 100).toFixed(0)}% da área do sujeito "${sLayer.name}".`,
            layerId: tLayer.id,
          });
        } else if (overlapRatio > 0.14) {
          legibility -= 6;
          findings.push({
            code: 'TEXT_SUBJECT_OVERLAP',
            severity: 'warning',
            message: `Título "${tLayer.name}" sobrepõe ${(overlapRatio * 100).toFixed(0)}% da zona de proteção do sujeito "${sLayer.name}".`,
            layerId: tLayer.id,
          });
        }
      }
    }

    for (const sLayer of visibleSubjects) {
      if (sLayer.type !== 'subject' || !sLayer.assetId) continue;
      for (const bLayer of visibleBackgrounds) {
        if (bLayer.type !== 'background') continue;
        if (bLayer.assetId && bLayer.assetId === sLayer.assetId && (bLayer.blurRadius ?? 0) < 12 && !bLayer.generatedByAi) {
          findings.push({
            code: 'DUPLICATE_SUBJECT_IN_BACKGROUND',
            severity: 'critical',
            message: `Sujeito "${sLayer.name}" usa o mesmo asset do fundo "${bLayer.name}" sem separação/desfoque ou fundo limpo, gerando duplicação visual.`,
            layerId: sLayer.id,
          });
        }
      }
    }

    // 5.6. Editorial dominance, floating-sticker detection, typographic hierarchy & empty-space audit
    let totalSubjectAreaCoverage = 0;
    if (doc.artType === 'thumbnail') {
      for (const sLayer of visibleSubjects) {
        if (sLayer.type !== 'subject') continue;
        const measured = await this.engine.measureRenderedLayerAlphaBounds(doc, sLayer);
        if (!measured) continue;
        totalSubjectAreaCoverage += measured.areaCoverage;
        if (measured.heightCoverage < 0.48 || measured.areaCoverage < 0.08) {
          findings.push({
            code: 'SUBJECT_TOO_SMALL',
            severity: 'critical',
            message: `Sujeito "${sLayer.name}" ocupa apenas ${(measured.heightCoverage * 100).toFixed(0)}% da altura e ${(measured.areaCoverage * 100).toFixed(1)}% da área; precisa de enquadramento editorial dominante (>= 48% altura).`,
            layerId: sLayer.id,
          });
        }
        if (measured.canvasBottomGap > 28) {
          findings.push({
            code: 'FLOATING_STICKER_SUBJECT',
            severity: 'critical',
            message: `Sujeito "${sLayer.name}" termina ${measured.canvasBottomGap}px acima da base, parecendo adesivo flutuante; ancore na base ou faça close-up integrado.`,
            layerId: sLayer.id,
          });
        }
      }

      const textSizes = visibleTexts
        .filter((l): l is Extract<typeof l, { type: 'text' }> => l.type === 'text')
        .map((l) => l.fontSize);
      const maxFs = textSizes.length > 0 ? Math.max(...textSizes) : 0;
      const minFs = textSizes.length > 0 ? Math.min(...textSizes) : 0;
      // Hierarchy is satisfied when: (a) multiple text layers exist with scale contrast or explicit kicker/subtitle,
      // OR (b) a single strong headline exists (textless or single-headline thumbnails are editorially valid),
      // OR (c) no text layers exist (pure visual focus). Only flag as critical when there are 2+ text layers
      // that lack any differentiation — a single headline alone is NOT a hierarchy failure.
      const hasMultipleTextLayers = visibleTexts.length >= 2;
      const hasScaleContrast = hasMultipleTextLayers && maxFs >= minFs * 1.25;
      const hasExplicitSecondaryRole = visibleTexts.some(
        (l) => l.type === 'text' && (l.role === 'kicker' || l.role === 'subtitle'),
      );
      const hasHierarchy = !hasMultipleTextLayers || hasScaleContrast || hasExplicitSecondaryRole;
      if (!hasHierarchy) {
        legibility -= 15;
        findings.push({
          code: 'MISSING_TYPOGRAPHIC_HIERARCHY',
          severity: 'critical',
          message: 'Múltiplas camadas de texto sem diferenciação de escala ou função editorial (kicker/subtítulo).',
        });
      }

      const textAreaCoverage =
        visibleTexts.reduce((acc, l) => acc + l.transform.width * l.transform.scaleX * l.transform.height * l.transform.scaleY, 0) /
        Math.max(1, doc.width * doc.height);
      if (visibleSubjects.length > 0 && totalSubjectAreaCoverage + textAreaCoverage < 0.24) {
        findings.push({
          code: 'EXCESSIVE_EMPTY_SPACE',
          severity: 'warning',
          message: `Composição com excesso de espaço vazio (${((1 - (totalSubjectAreaCoverage + textAreaCoverage)) * 100).toFixed(0)}% sem foco visual).`,
        });
      }
    }

    if (doc.artType === 'banner') {
      const hasBannerSubtitle = visibleTexts.some((l) => l.type === 'text' && (l.role === 'subtitle' || l.role === 'kicker')) || visibleTexts.length >= 2;
      if (!hasBannerSubtitle) {
        findings.push({
          code: 'BANNER_LACKS_EDITORIAL_STRUCTURE',
          severity: 'critical',
          message: 'Banner sem estrutura editorial (necessita subtítulo/slogan de canal além do título principal).',
        });
      }

      // Check Desktop / Mobile / TV universal safe area (1546x423 centered in 2560x1440)
      const safe = ART_SPECIFICATIONS.banner.safeArea!;
      for (const layer of [...visibleTexts, ...visibleSubjects]) {
        const lx1 = layer.transform.x;
        const ly1 = layer.transform.y;
        const lx2 = lx1 + layer.transform.width * layer.transform.scaleX;
        const ly2 = ly1 + layer.transform.height * layer.transform.scaleY;
        if (lx1 < safe.x || ly1 < safe.y || lx2 > safe.x + safe.width || ly2 > safe.y + safe.height) {
          findings.push({
            code: 'BANNER_SAFE_AREA_VIOLATION',
            severity: 'critical',
            message: `Camada "${layer.name}" ultrapassa a área segura universal do banner (1546×423) para Desktop, Celular e TV.`,
            layerId: layer.id,
          });
        }
      }

      // Check brand-name redundancy across banner text layers (e.g. channel name repeated in kicker/subtitle)
      const headlineLayer = visibleTexts.find((l) => l.type === 'text' && l.role === 'headline') ?? visibleTexts[0];
      if (headlineLayer && headlineLayer.type === 'text') {
        const headlineTokens = headlineLayer.text
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 3);
        if (headlineTokens.length > 0) {
          for (const other of visibleTexts) {
            if (other.id === headlineLayer.id || other.type !== 'text') continue;
            const otherTokens = other.text
              .toLowerCase()
              .replace(/[^\p{L}\p{N}\s]/gu, ' ')
              .split(/\s+/)
              .filter((w) => w.length >= 3);
            const overlap = otherTokens.filter((t) => headlineTokens.includes(t));
            if (otherTokens.length > 0 && overlap.length / otherTokens.length >= 0.5) {
              findings.push({
                code: 'BANNER_BRAND_REDUNDANCY',
                severity: 'critical',
                message: `Camada "${other.name}" ("${other.text}") repete o nome do canal presente em "${headlineLayer.text}"; use um slogan distinto.`,
                layerId: other.id,
              });
            }
          }
        }
      }
    }

    // 5.7. Semantic relevance between prompt topic and visual layers/tags
    const stopWords = new Set(['thumbnail', 'banner', 'avatar', 'canal', 'video', 'vídeo', 'sobre', 'para', 'com', 'alto', 'impacto', 'visual', 'gamer', 'oficial', 'estilo']);
    const topicTokens = doc.prompt
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !stopWords.has(w));
    if (topicTokens.length > 0) {
      const visualCorpus = [
        doc.title,
        ...doc.tags,
        ...visibleTexts.map((l) => (l.type === 'text' ? l.text : '')),
        ...doc.layers.map((l) => l.name),
      ]
        .join(' ')
        .toLowerCase();
      const matched = topicTokens.some((tok) => visualCorpus.includes(tok));
      if (!matched) {
        findings.push({
          code: 'LOW_SEMANTIC_RELEVANCE',
          severity: 'critical',
          message: `Composição semanticamente genérica: elementos visuais/textuais não refletem termos centrais do tema (${topicTokens.slice(0, 3).join(', ')}).`,
        });
      }
    }

    // 6. Contrast score from real image stats (original resolution + reduced mobile preview resolution)
    const stats = await sharp(rendered).stats();
    const meanStdev =
      ((stats.channels[0]?.stdev ?? 0) + (stats.channels[1]?.stdev ?? 0) + (stats.channels[2]?.stdev ?? 0)) / 3;
    const smallW = doc.artType === 'banner' ? 320 : 224;
    const smallH = doc.artType === 'banner' ? 180 : 126;
    const smallBuf = await sharp(rendered).resize(smallW, smallH, { fit: 'fill' }).png().toBuffer();
    const smallStats = await sharp(smallBuf).stats();
    const smallStdev =
      ((smallStats.channels[0]?.stdev ?? 0) + (smallStats.channels[1]?.stdev ?? 0) + (smallStats.channels[2]?.stdev ?? 0)) / 3;
    const contrast = Math.min(100, Math.max(20, Math.round((meanStdev / 68) * 100)));
    if (contrast < 35) {
      findings.push({
        code: 'LOW_VISUAL_CONTRAST',
        severity: 'warning',
        message: 'Contraste visual baixo detectado na composição final.',
      });
    }
    if (smallStdev < 22) {
      legibility -= 15;
      findings.push({
        code: 'THUMBNAIL_LOW_LEGIBILITY_AT_SMALL_SIZE',
        severity: 'warning',
        message: `Legibilidade e contraste reduzidos na prévia em miniatura (${smallW}×${smallH}, stdev ${smallStdev.toFixed(1)}).`,
      });
    }

    // 6.5. CS-9: typography audited on REAL rendered glyph geometry (clipping, collisions, safe area,
    // timestamp badge, occlusion, measured size and contrast at 224×126). Replaces box-only assumptions.
    let typographyGeometry: TextLayerGeometry[] | undefined;
    if (doc.artType === 'thumbnail' && visibleTexts.length > 0) {
      const geo = await auditTypographyGeometry(this.engine, doc, rendered);
      typographyGeometry = geo.layers;
      for (const f of geo.findings) {
        findings.push(f);
        legibility -= f.severity === 'critical' ? 20 : 5;
      }
    }

    // 7. Brand Kit consistency
    let brandConsistency = 85;
    if (options?.brandKit) {
      const paletteSet = new Set(Object.values(options.brandKit.palette).map((c) => c.toUpperCase()));
      const usesBrandColor = doc.layers.some((l) => {
        if (l.type === 'text') return paletteSet.has(l.color.toUpperCase());
        if (l.type === 'background') return paletteSet.has(l.fillColor.toUpperCase());
        if (l.type === 'vfx') return paletteSet.has(l.primaryColor.toUpperCase());
        return false;
      });
      if (!usesBrandColor) {
        brandConsistency = 55;
        findings.push({
          code: 'BRAND_KIT_COLOR_DRIFT',
          severity: 'warning',
          message: `Composição não utiliza cores principais do Brand Kit "${options.brandKit.channelName}".`,
        });
      } else {
        brandConsistency = 95;
      }
    }

    // 7.5. Subject cutout / segmentation quality check
    const subjectLayers = doc.layers.filter((l) => l.visible && l.type === 'subject');
    for (const sLayer of subjectLayers) {
      if (sLayer.type === 'subject' && sLayer.removeBackground && sLayer.cutoutMethod === 'none') {
        findings.push({
          code: 'SUBJECT_CUTOUT_UNSPECIFIED',
          severity: 'warning',
          message: `Camada "${sLayer.name}" solicita remoção de fundo sem método semântico definido.`,
          layerId: sLayer.id,
        });
      }
    }

    // 8. Video fidelity check for Cinema Pipeline thumbnails
    if (doc.sourceCinemaProjectId && doc.artType === 'thumbnail') {
      const hasFrameOrSubject = doc.layers.some(
        (l) => l.visible && (l.type === 'background' || l.type === 'subject') && 'assetId' in l && Boolean(l.assetId),
      );
      if (!hasFrameOrSubject) {
        findings.push({
          code: 'THUMBNAIL_NO_REAL_VIDEO_FRAME',
          severity: 'warning',
          message: 'Thumbnail vinculada ao Cinema Pipeline não referencia frame extraído do vídeo.',
        });
      }
    }

    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;
    const composition = Math.max(20, 94 - criticalCount * 25 - warningCount * 7);
    const overall = Math.round(
      Math.max(0, Math.min(100, legibility * 0.35 + contrast * 0.25 + composition * 0.25 + brandConsistency * 0.15)),
    );

    return qualityAuditReportSchema.parse({
      projectId: doc.id,
      artType: doc.artType,
      passed: criticalCount === 0,
      autoApprovable: criticalCount === 0,
      criticalCount,
      warningCount,
      findings,
      scorecard: {
        legibility: Math.max(0, Math.min(100, legibility)),
        contrast,
        composition,
        brandConsistency,
        overall,
        disclaimer: 'Heuristic visual quality score only; does not predict actual CTR.',
      },
      checkedAt: new Date().toISOString(),
      ...(typographyGeometry ? { typographyGeometry: typographyGeometry as unknown as Array<Record<string, unknown>> } : {}),
    });
  }
}
