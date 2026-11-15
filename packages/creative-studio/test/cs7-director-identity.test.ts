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
    const textLayer = brokenDoc.layers.find((l) => l.type === 'text')!;
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
    expect(fixedAudit.criticalCount).toBe(0);
    expect(fixedAudit.passed).toBe(true);
  });

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

    const wmDoc = planner.buildDocument({
      artType: 'watermark',
      prompt: 'Channel watermark',
      brandKit: updatedKit,
    });
    const wmLayer = wmDoc.layers.find((l) => l.type === 'watermark');
    expect(wmLayer && 'assetId' in wmLayer ? wmLayer.assetId : null).toBe(mascotRef.id);
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

    // 2. Clean atmospheric background (no duplicate character) via SDXL-Turbo
    const cleanBgBuffer = await ai.generateImage({
      prompt:
        'empty futuristic neon cyberpunk alleyway at night, rainy reflections, cyan and magenta volumetric fog, blurred bokeh city lights, no people, no characters, wide angle background',
      width: 1024,
      height: 576,
    });
    const cleanBgAsset = await ingestion.ingestBuffer({
      buffer: cleanBgBuffer,
      kind: 'image',
      extension: 'png',
      originalName: 'cyberpunk-2077-clean-bg.png',
    });
    writeFileSync(join(CS7_ARTIFACTS_DIR, 'cyberpunk-2077-clean-bg.png'), cleanBgBuffer);

    // 3. Persistent Brand Kit + AI Mascot Avatar (reused across thumbs, banner, watermark)
    const brandManager = new BrandKitManager();
    let kit = brandManager.create({
      channelName: 'CYBEREDGE BR',
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

    // 4. Thumbnail Lab A / B / C (with real cutout + clean AI bg + persistent watermark mascot)
    const lab = await orchestrator.orchestrateThumbnailLab({
      title: 'Cyberpunk 2077 CS7',
      headline: 'CYBERWARE SECRETO',
      prompt: 'Cyberpunk 2077 builds secretas com alto impacto visual',
      brandKit: kit,
      backgroundAsset: cleanBgAsset,
      subjectAsset: cutoutAsset,
      watermarkAsset: mascotCutoutAsset,
    });
    expect(lab.variants).toHaveLength(3);
    for (const v of lab.variants) {
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
