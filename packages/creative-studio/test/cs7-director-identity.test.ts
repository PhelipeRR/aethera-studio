import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  BrandKitManager,
  CompositionPlanner,
  CreativeDirectorAgent,
  CreativeOrchestrator,
  ExportService,
  fitTextToBox,
  LocalPythonAiAdapter,
  QualityGateService,
  SharpSvgCompositionEngine,
} from '../src/index.js';

const REPO_ROOT = existsSync(resolve(process.cwd(), 'artifacts'))
  ? process.cwd()
  : resolve(process.cwd(), '..', '..');
const CS6_FRAME_PATH = resolve(REPO_ROOT, 'artifacts', 'creative-studio-cs6', 'cyberpunk-2077-frame.png');
const CS7_ARTIFACTS_DIR = resolve(REPO_ROOT, 'artifacts', 'creative-studio-cs7');

describe('CS-7 — Visual Quality, Creative Director Agent & Persistent Identity', () => {
  const tempDirs: string[] = [];
  const makeTempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-cs7-'));
    tempDirs.push(dir);
    return dir;
  };

  afterAll(() => {
    for (const d of tempDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('auto-fits oversized display headlines inside text box and flags overflow/overlap/duplication in QualityGate', async () => {
    const storageRoot = makeTempDir();
    const fit = fitTextToBox({
      text: 'CYBERWARE IMPLANTS 2077',
      targetW: 520,
      targetH: 260,
      fontSize: 104,
      lineHeight: 1.04,
      letterSpacing: 2,
      strokeWidth: 8,
      uppercase: true,
    });
    expect(fit.fitsAfterAutoScale).toBe(true);
    expect(fit.fontSize).toBeLessThan(104);
    expect(fit.estimatedMaxLineWidth).toBeLessThanOrEqual(520);

    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const gate = new QualityGateService(engine);
    const planner = new CompositionPlanner();
    const dummyPng = await sharp({
      create: { width: 640, height: 360, channels: 4, background: { r: 20, g: 30, b: 60, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const asset = await ingestion.ingestBuffer({
      buffer: dummyPng,
      kind: 'frame',
      extension: 'png',
      originalName: 'frame.png',
    });

    // Deliberately create a broken doc with duplicate asset background + overlapping oversized title
    const brokenDoc = planner.buildDocument({
      artType: 'thumbnail',
      prompt: 'CYBERWARE OVERLOAD',
      headline: 'CYBERWARE OVERLOAD',
      subjectAsset: asset,
      backgroundAsset: asset,
    });
    const bgLayer = brokenDoc.layers.find((l) => l.type === 'background')!;
    if (bgLayer.type === 'background') {
      bgLayer.assetId = asset.id;
      bgLayer.blurRadius = 0;
    }
    const textLayer =
      brokenDoc.layers.find((l) => l.type === 'text' && l.role === 'headline') ??
      brokenDoc.layers.find((l) => l.type === 'text')!;
    if (textLayer.type === 'text') {
      textLayer.fontSize = 140;
      textLayer.transform = { ...textLayer.transform, x: 450, y: 100, width: 600, height: 300 };
    }

    const brokenAudit = await gate.auditProject(brokenDoc);
    expect(brokenAudit.findings.some((f) => f.code === 'DUPLICATE_SUBJECT_IN_BACKGROUND')).toBe(true);
    expect(brokenAudit.findings.some((f) => f.code === 'TEXT_SUBJECT_OVERLAP')).toBe(true);
    expect(brokenAudit.findings.some((f) => f.code === 'TEXT_INTERNAL_OVERFLOW')).toBe(true);

    // CreativeDirectorAgent repairs all three before render
    const director = new CreativeDirectorAgent();
    const refined = director.reviewAndRefine(brokenDoc);
    expect(refined.issues.some((i) => i.code === 'DUPLICATE_SUBJECT')).toBe(true);
    expect(refined.issues.some((i) => i.code === 'TEXT_SUBJECT_COLLISION')).toBe(true);

    const fixedAudit = await gate.auditProject(refined.document);
    expect(fixedAudit.findings.filter((f) => f.severity === 'critical')).toEqual([]);
    expect(fixedAudit.criticalCount).toBe(0);
    expect(fixedAudit.passed).toBe(true);

    // Art Director iterative loop: reject floating small subject + flat typography and recompose until approved
    const flawedDoc = planner.buildDocument({
      artType: 'thumbnail',
      prompt: 'CYBERWARE SECRETO',
      headline: 'CYBERWARE SECRETO',
      subjectAsset: asset,
    });
    // Strip kicker/subtitle and shrink subject into a floating sticker
    flawedDoc.layers = flawedDoc.layers.filter((l) => l.type !== 'text' || l.id === 'title-main');
    const sLayer = flawedDoc.layers.find((l) => l.type === 'subject')!;
    if (sLayer.type === 'subject') {
      sLayer.anchorBottom = false;
      sLayer.transform = { ...sLayer.transform, x: 750, y: 120, width: 280, height: 260 };
    }
    const loopResult = await director.directWithIterativeReview(flawedDoc, gate, { maxIterations: 3 });
    expect(loopResult.critiqueHistory.length).toBeGreaterThanOrEqual(2);
    expect(loopResult.critiqueHistory[0]?.rejected).toBe(true);
    expect(loopResult.critiqueHistory[0]?.rejectionReasons.some((r) => r.includes('SUBJECT_TOO_SMALL'))).toBe(true);
    expect(loopResult.critiqueHistory[0]?.rejectionReasons.some((r) => r.includes('FLOATING_STICKER_SUBJECT'))).toBe(true);
    expect(loopResult.critiqueHistory[0]?.rejectionReasons.some((r) => r.includes('MISSING_TYPOGRAPHIC_HIERARCHY'))).toBe(true);
    expect(loopResult.approved).toBe(true);
    expect(loopResult.audit.passed).toBe(true);
  }, 30_000);

  it('persists Brand Kit mascot/avatar/watermark across thumbnail, banner, avatar, and watermark', async () => {
    const storageRoot = makeTempDir();
    const ingestion = new AssetIngestionService({ storageRoot });
    const mascotPng = await sharp({
      create: { width: 320, height: 320, channels: 4, background: { r: 0, g: 240, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const mascotRef = await ingestion.ingestBuffer({
      buffer: mascotPng,
      kind: 'cutout',
      extension: 'png',
      originalName: 'mascot.png',
    });

    const brandManager = new BrandKitManager();
    const kit = brandManager.create({
      channelName: 'CyberEdge BR',
      slogan: 'BUILDS, SEGREDOS E ANÁLISES SEM SPOILERS',
      palette: { primary: '#00F0FF', secondary: '#FF006E', accent: '#FACC15', background: '#070B14', surface: '#111827', text: '#FFFFFF' },
    });
    const updatedKit = brandManager.registerIdentityAsset(kit.id, 'mascot', mascotRef);
    expect(updatedKit.mascotAssetId).toBe(mascotRef.id);

    const planner = new CompositionPlanner();
    const bannerDoc = planner.buildDocument({
      artType: 'banner',
      prompt: 'Channel banner',
      headline: 'CYBEREDGE BR',
      brandKit: updatedKit,
    });
    const bannerSubject = bannerDoc.layers.find((l) => l.type === 'subject');
    expect(bannerSubject && 'assetId' in bannerSubject ? bannerSubject.assetId : null).toBe(mascotRef.id);
    const bannerTexts = bannerDoc.layers
      .filter((l): l is Extract<(typeof bannerDoc.layers)[number], { type: 'text' }> => l.type === 'text')
      .map((l) => l.text);
    expect(bannerTexts).toContain('BUILDS, SEGREDOS E ANÁLISES SEM SPOILERS');
    expect(bannerTexts.filter((t) => t.toUpperCase().includes('CYBEREDGE'))).toHaveLength(1);

    const wmDoc = planner.buildDocument({
      artType: 'watermark',
      prompt: 'Channel watermark',
      brandKit: updatedKit,
    });
    const wmLayer = wmDoc.layers.find((l) => l.type === 'watermark');
    expect(wmLayer && 'assetId' in wmLayer ? wmLayer.assetId : null).toBe(mascotRef.id);
  });

  it('works generically across anime, documentary, and game topics and rejects generic or redundant banner layouts', async () => {
    const storageRoot = makeTempDir();
    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const gate = new QualityGateService(engine);
    const planner = new CompositionPlanner();

    const subjectPng = await sharp({
      create: { width: 420, height: 640, channels: 4, background: { r: 210, g: 90, b: 60, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const subjectRef = await ingestion.ingestBuffer({
      buffer: subjectPng,
      kind: 'cutout',
      extension: 'png',
      originalName: 'generic-subject.png',
    });

    const topics = [
      {
        title: 'Anime Shibuya',
        headline: 'ARCO DE SHIBUYA',
        prompt: 'Análise profunda do arco final de Shibuya no anime e a virada do protagonista',
        scriptText: 'Neste roteiro analisamos as batalhas subterrâneas, maldições antigas e sacrifícios do arco.',
      },
      {
        title: 'Documentário Espacial',
        headline: 'CORRIDA ESPACIAL',
        prompt: 'Documentário histórico sobre os arquivos secretos da corrida espacial e foguetes lunares',
        scriptText: 'Documentos desclassificados revelam falhas críticas de engenharia nos primeiros lançamentos orbitais.',
      },
      {
        title: 'Guia de Jogo',
        headline: 'CHEFE SECRETO',
        prompt: 'Guia definitivo para derrotar o chefe secreto com build de sangramento',
        scriptText: 'Mostramos os melhores talismãs, janelas de esquiva e status necessários na arena oculta.',
      },
    ];

    for (const topic of topics) {
      const variants = await planner.generateThumbnailLabVariations(
        {
          title: topic.title,
          headline: topic.headline,
          prompt: topic.prompt,
          scriptText: topic.scriptText,
          subjectAsset: subjectRef,
        },
        gate,
      );
      expect(variants).toHaveLength(3);
      for (const v of variants) {
        expect(v.editorialRationale.length).toBeGreaterThan(40);
        expect(v.audit.passed, `${topic.title} variant ${v.label}`).toBe(true);
      }
    }

    // Banner redundancy & safe-area rejection check
    const brandManager = new BrandKitManager();
    const kit = brandManager.create({
      channelName: 'AETHERA DOCS',
      slogan: 'HISTÓRIAS REAIS E ARQUIVOS',
    });
    const redundantBanner = planner.buildDocument({
      artType: 'banner',
      headline: 'AETHERA DOCS',
      prompt: 'Banner do canal AETHERA DOCS',
      brandKit: kit,
    });
    const subtitleLayer = redundantBanner.layers.find((l) => l.type === 'text' && l.role === 'subtitle');
    if (subtitleLayer && subtitleLayer.type === 'text') {
      subtitleLayer.text = 'AETHERA DOCS OFICIAL';
      subtitleLayer.transform.x = 120; // outside 507..2053 safe area
    }
    const bannerAudit = await gate.auditProject(redundantBanner, { brandKit: kit });
    expect(bannerAudit.findings.some((f) => f.code === 'BANNER_BRAND_REDUNDANCY' && f.severity === 'critical')).toBe(true);
    expect(bannerAudit.findings.some((f) => f.code === 'BANNER_SAFE_AREA_VIOLATION' && f.severity === 'critical')).toBe(true);
    expect(bannerAudit.passed).toBe(false);
  });

  it('regenerates real CS-7 artifacts with adaptive segmentation, clean AI background, distinct A/B/C layouts, and persistent mascot identity', async () => {
    const ai = new LocalPythonAiAdapter();
    const aiReady = await ai.isAvailable();
    expect(aiReady).toBe(true);
    expect(existsSync(CS6_FRAME_PATH)).toBe(true);

    mkdirSync(CS7_ARTIFACTS_DIR, { recursive: true });
    const storageRoot = makeTempDir();
    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const gate = new QualityGateService(engine);
    const planner = new CompositionPlanner();
    const exporter = new ExportService(engine);
    const orchestrator = new CreativeOrchestrator([], planner, gate);

    // 1. Adaptive segmentation on real Cyberpunk 2077 frame
    const cutoutBuffer = await ai.removeBackground({ inputImagePath: CS6_FRAME_PATH });
    const cutoutAsset = await ingestion.ingestBuffer({
      buffer: cutoutBuffer,
      kind: 'cutout',
      extension: 'png',
      originalName: 'cyberpunk-2077-character-cutout-adaptive.png',
    });
    writeFileSync(join(CS7_ARTIFACTS_DIR, 'cyberpunk-2077-character-cutout-adaptive.png'), cutoutBuffer);

    // 2. Three distinct topic-relevant AI backgrounds for Concepts A, B, and C (no duplicate character) via SDXL-Turbo
    const bgPrompts = {
      impact:
        'dark dramatic close-up of glowing cybernetic neural implant chip and surgical optic lens on black obsidian table, intense magenta and cyan rim lighting, high contrast, no people, no text',
      tech:
        'clean futuristic cyberware engineering workbench with glowing holographic arm schematic and diagnostic display, sharp architectural lighting, teal and amber accents, no people, no text',
      cinematic:
        'wide atmospheric futuristic laboratory corridor at night with rain streaks on glass, deep teal and magenta volumetric light beams, cinematic depth, no people, no characters, no text',
    } as const;

    const cleanBgBuffer = await ai.generateImage({ prompt: bgPrompts.tech, width: 1024, height: 576 });
    const bgImpactBuffer = await ai.generateImage({ prompt: bgPrompts.impact, width: 1024, height: 576 });
    const bgCinematicBuffer = await ai.generateImage({ prompt: bgPrompts.cinematic, width: 1024, height: 576 });

    const cleanBgAsset = await ingestion.ingestBuffer({
      buffer: cleanBgBuffer,
      kind: 'image',
      extension: 'png',
      originalName: 'cyberpunk-2077-clean-bg.png',
    });
    const bgImpactAsset = await ingestion.ingestBuffer({
      buffer: bgImpactBuffer,
      kind: 'image',
      extension: 'png',
      originalName: 'cyberpunk-2077-bg-impact.png',
    });
    const bgCinematicAsset = await ingestion.ingestBuffer({
      buffer: bgCinematicBuffer,
      kind: 'image',
      extension: 'png',
      originalName: 'cyberpunk-2077-bg-cinematic.png',
    });
    writeFileSync(join(CS7_ARTIFACTS_DIR, 'cyberpunk-2077-clean-bg.png'), cleanBgBuffer);

    // 3. Persistent Brand Kit with configurable slogan + AI Mascot Avatar (reused across thumbs, banner, watermark)
    const brandManager = new BrandKitManager();
    let kit = brandManager.create({
      channelName: 'CYBEREDGE BR',
      slogan: 'BUILDS, SEGREDOS E ANÁLISES SEM SPOILERS',
      palette: {
        primary: '#00F0FF',
        secondary: '#FF006E',
        accent: '#FACC15',
        background: '#070B14',
        surface: '#111827',
        text: '#FFFFFF',
      },
    });

    const mascotRaw = await ai.generateImage({
      prompt:
        'sleek futuristic cyberpunk neon cyber-fox mascot emblem icon, centered, clean dark solid background, vector esports logo style, crisp edges',
      width: 768,
      height: 768,
    });
    const mascotTempAsset = await ingestion.ingestBuffer({
      buffer: mascotRaw,
      kind: 'image',
      extension: 'png',
      originalName: 'mascot-raw.png',
    });
    const mascotCutoutBuf = await ai.removeBackground({
      inputImagePath: ingestion.resolvePortablePath(mascotTempAsset.relativePath),
    });
    const mascotCutoutAsset = await ingestion.ingestBuffer({
      buffer: mascotCutoutBuf,
      kind: 'cutout',
      extension: 'png',
      originalName: 'mascot-cutout.png',
    });
    kit = brandManager.registerIdentityAsset(kit.id, 'mascot', mascotCutoutAsset);
    kit = brandManager.registerIdentityAsset(kit.id, 'watermark', mascotCutoutAsset);

    // Export Avatar (800x800)
    const avatarRes = await orchestrator.orchestrateCreation({
      artType: 'avatar',
      prompt: 'CYBEREDGE BR mascot avatar',
      headline: 'CE',
      brandKit: kit,
      subjectAsset: mascotCutoutAsset,
      avatarBackdrop: 'dark',
    });
    expect(avatarRes.audit.passed).toBe(true);
    await exporter.exportProject(avatarRes.document, {
      outputPath: join(CS7_ARTIFACTS_DIR, 'tech-mascot-avatar-800x800.png'),
      format: 'png',
    });

    // 4. Thumbnail Lab A / B / C (with distinct AI backgrounds, distinct framings, script evidence, & persistent watermark mascot)
    const lab = await orchestrator.orchestrateThumbnailLab({
      title: 'Cyberpunk 2077 CS7',
      headline: 'CYBERWARE SECRETO',
      prompt: 'Cyberpunk 2077 implantes e builds secretas com alto impacto visual',
      scriptText:
        'Neste vídeo revelamos o implante neural secreto, os melhores cyberwares de combate e como montar a build oculta na bancada.',
      brandKit: kit,
      backgroundAsset: cleanBgAsset,
      variantBackgroundAssets: {
        impact: bgImpactAsset,
        tech: cleanBgAsset,
        cinematic: bgCinematicAsset,
      },
      subjectAsset: cutoutAsset,
      watermarkAsset: mascotCutoutAsset,
    });
    expect(lab.variants).toHaveLength(3);
    for (const v of lab.variants) {
      expect(v.editorialRationale.length).toBeGreaterThan(40);
      expect(v.audit.findings.filter((f) => f.severity === 'critical'), `Variant ${v.label} findings`).toEqual([]);
      expect(v.audit.passed).toBe(true);
      expect(v.audit.findings.some((f) => f.code === 'TEXT_INTERNAL_OVERFLOW' && f.severity === 'critical')).toBe(false);
      expect(v.audit.findings.some((f) => f.code === 'DUPLICATE_SUBJECT_IN_BACKGROUND')).toBe(false);
      await exporter.exportProject(v.document, {
        outputPath: join(CS7_ARTIFACTS_DIR, `cyberpunk-2077-thumb-${v.label}-${v.style}.png`),
        format: 'png',
      });
    }

    // 5. Banner (2560x1440) reusing exact same persistent mascot + clean AI bg
    const bannerRes = await orchestrator.orchestrateCreation({
      artType: 'banner',
      prompt: 'Banner oficial do canal gamer CYBEREDGE BR',
      headline: 'CYBEREDGE BR',
      brandKit: kit,
      backgroundAsset: cleanBgAsset,
    });
    expect(bannerRes.audit.passed).toBe(true);
    await exporter.exportProject(bannerRes.document, {
      outputPath: join(CS7_ARTIFACTS_DIR, 'gamer-banner-2560x1440.png'),
      format: 'png',
    });

    // 6. Watermark (150x150) reusing exact same persistent mascot
    const wmRes = await orchestrator.orchestrateCreation({
      artType: 'watermark',
      prompt: 'Marca dagua transparente CYBEREDGE BR',
      headline: 'CYBEREDGE',
      brandKit: kit,
    });
    expect(wmRes.audit.passed).toBe(true);
    await exporter.exportProject(wmRes.document, {
      outputPath: join(CS7_ARTIFACTS_DIR, 'brand-watermark-150x150.png'),
      format: 'png',
    });

    // Verify all 8 files exist and have non-zero size
    for (const file of [
      'cyberpunk-2077-character-cutout-adaptive.png',
      'cyberpunk-2077-clean-bg.png',
      'cyberpunk-2077-thumb-A-impact.png',
      'cyberpunk-2077-thumb-B-tech.png',
      'cyberpunk-2077-thumb-C-cinematic.png',
      'tech-mascot-avatar-800x800.png',
      'gamer-banner-2560x1440.png',
      'brand-watermark-150x150.png',
    ]) {
      const full = join(CS7_ARTIFACTS_DIR, file);
      expect(existsSync(full)).toBe(true);
      expect(readFileSync(full).byteLength).toBeGreaterThan(1024);
    }
  }, 240_000);
});
