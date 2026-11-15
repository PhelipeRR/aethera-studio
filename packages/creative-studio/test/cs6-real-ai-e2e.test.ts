import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  BrandKitManager,
  CompositionPlanner,
  CreativeOrchestrator,
  ExportService,
  LayeredDocumentEditor,
  LocalPythonAiAdapter,
  ProviderChainImageAdapter,
  QualityGateService,
  SharpSvgCompositionEngine,
  VideoFrameAnalyzer,
  type ReasoningEngineProvider,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

const singleAgentFallback: ReasoningEngineProvider = {
  id: 'claude-code',
  isAvailable: async () => true,
  runPrompt: async (prompt) => ({
    text: `HEADLINE: CYBERWARE 2077\nDireção cinematográfica aplicada: ${prompt.slice(0, 50)}`,
  }),
};

describe('CS-6 Real AI E2E: SDXL-Turbo (RTX 4060 Ti) + rembg Semantic Segmentation + Cinematic Composition', () => {
  it('generates and exports real Cyberpunk 2077 thumbnails (A/B/C + prompt-edited), banner, AI mascot avatar, and watermark', async () => {
    const outDir = resolve('artifacts/creative-studio-cs6');
    const storageRoot = join(outDir, 'managed-storage');
    mkdirSync(outDir, { recursive: true });

    const localAi = new LocalPythonAiAdapter();
    expect(await localAi.isAvailable()).toBe(true);
    const chain = new ProviderChainImageAdapter([localAi]);

    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion, chain);
    const exporter = new ExportService(engine);
    const analyzer = new VideoFrameAnalyzer(ingestion);
    const qc = new QualityGateService(engine);
    const planner = new CompositionPlanner();
    const orch = new CreativeOrchestrator([singleAgentFallback], planner, qc);

    const brandKit = new BrandKitManager().create({
      channelName: 'CyberEdge BR',
      palette: {
        primary: '#00F0FF',
        secondary: '#FF006E',
        accent: '#FACC15',
        background: '#070B14',
        surface: '#111827',
        text: '#FFFFFF',
      },
    });

    // 1. Use SDXL-Turbo generated Cyberpunk 2077 image (reuse smoke-gen if present, or generate fresh)
    const cpGenPath = join(outDir, 'smoke-gen.png');
    if (!existsSync(cpGenPath)) {
      const genBuf = await chain.generateImage({
        prompt: 'cyberpunk 2077 female merc with glowing cyan cybernetic implants and mantis blades, dramatic neon night city background, ultra detailed digital art',
        width: 768,
        height: 512,
      });
      writeFileSync(cpGenPath, genBuf);
    }

    // Build a real 2s MP4 gameplay-style clip from the AI-generated Cyberpunk frame with camera zoom
    const cpVideoPath = join(outDir, 'cyberpunk-2077-clip.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-i',
      cpGenPath,
      '-vf',
      "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.002,1.12)':d=48:s=1280x720:fps=24,format=yuv420p",
      '-t',
      '2',
      '-c:v',
      'libx264',
      cpVideoPath,
    ]);

    // 2. Extract best frame via VideoFrameAnalyzer
    const frameAnalysis = await analyzer.analyzeAndExtractFrames({
      videoPath: cpVideoPath,
      sampleCount: 3,
      sceneHints: [{ timestampSec: 1.0, label: 'Mantis Blades Showcase', emotion: 'intense' }],
    });
    expect(frameAnalysis.bestCandidate).not.toBeNull();
    const bestFrameRef = frameAnalysis.bestCandidate!.asset;
    const bestFrameAbs = ingestion.resolvePortablePath(bestFrameRef.relativePath);
    writeFileSync(join(outDir, 'cyberpunk-2077-frame.png'), await sharp(bestFrameAbs).png().toBuffer());

    // 3. Real Semantic Segmentation via rembg on the Cyberpunk 2077 frame
    const cutoutBuf = await chain.removeBackground({ inputImagePath: bestFrameAbs });
    writeFileSync(join(outDir, 'cyberpunk-2077-character-cutout.png'), cutoutBuf);
    const cutoutRef = await ingestion.ingestBuffer({
      buffer: cutoutBuf,
      kind: 'cutout',
      extension: 'png',
      originalName: 'cyberpunk-cutout.png',
    });

    // Verify real alpha channel with both transparent and opaque regions (not flat opaque)
    const { data: alphaData } = await sharp(cutoutBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparentPx = 0;
    let opaquePx = 0;
    for (let i = 3; i < alphaData.length; i += 4) {
      if ((alphaData[i] ?? 255) < 30) transparentPx += 1;
      else if ((alphaData[i] ?? 0) > 220) opaquePx += 1;
    }
    expect(transparentPx).toBeGreaterThan(1000);
    expect(opaquePx).toBeGreaterThan(1000);

    // 4. Thumbnail Lab (3 variations A, B, C) using extracted frame + semantic cutout
    const lab = await orch.orchestrateThumbnailLab({
      prompt: 'Upgrades cibernéticos de Cyberpunk 2077 com Mantis Blades',
      headline: 'CYBERWARE INSANO',
      brandKit,
      backgroundAsset: bestFrameRef,
      subjectAsset: cutoutRef,
      sourceCinemaProjectId: 'cinema-cp2077-cs6',
    });
    expect(lab.variants).toHaveLength(3);

    // Enhance layers with CS-6 cinematic lighting & depth and export A, B, C
    const variantNames = ['A-impact', 'B-tech', 'C-cinematic'] as const;
    for (let i = 0; i < lab.variants.length; i += 1) {
      const v = lab.variants[i]!;
      const editor = new LayeredDocumentEditor(v.document);
      editor.applyLocalizedPromptEdit('adicione iluminação neon #00F0FF');
      const enhanced = editor.getDocument();
      // Mark subject as already semantically segmented so render uses cutout directly
      const updated = {
        ...enhanced,
        layers: enhanced.layers.map((l) =>
          l.type === 'subject' ? { ...l, removeBackground: false, cutoutMethod: 'rembg_semantic' as const } : l,
        ),
      };
      const out = await exporter.exportProject(updated, {
        outputPath: join(outDir, `cyberpunk-2077-thumb-${variantNames[i]}.png`),
        format: 'png',
      });
      expect(out.width).toBe(1280);
      expect(out.height).toBe(720);

      if (i === 0) {
        await exporter.exportProject(updated, {
          outputPath: join(outDir, 'cyberpunk-2077-thumb.aethera-creative.json'),
          format: 'project',
        });
        const promptEd = new LayeredDocumentEditor(updated);
        promptEd.applyLocalizedPromptEdit('aumente o personagem');
        promptEd.applyLocalizedPromptEdit('deixe o título mais impactante');
        await exporter.exportProject(promptEd.getDocument(), {
          outputPath: join(outDir, 'cyberpunk-2077-thumb-edited-by-prompt.png'),
          format: 'png',
        });
      }
    }

    // 5. Futuristic Gamer Banner (2560x1440)
    const bannerRes = await orch.orchestrateCreation({
      artType: 'banner',
      prompt: 'Banner de canal gamer futurista Cyberpunk neon',
      headline: 'CYBEREDGE BR',
      brandKit,
      backgroundAsset: bestFrameRef,
      subjectAsset: cutoutRef,
    });
    const bannerClean = {
      ...bannerRes.document,
      layers: bannerRes.document.layers.map((l) =>
        l.type === 'subject' ? { ...l, removeBackground: false, cutoutMethod: 'rembg_semantic' as const } : l,
      ),
    };
    const bannerOut = await exporter.exportProject(bannerClean, {
      outputPath: join(outDir, 'gamer-banner-2560x1440.png'),
      format: 'png',
    });
    expect(bannerOut.width).toBe(2560);
    expect(bannerOut.height).toBe(1440);

    // 6. Tech Mascot Avatar (800x800) generated by SDXL-Turbo + segmented by rembg
    const mascotGenBuf = await chain.generateImage({
      prompt: 'cute futuristic cyberpunk robot mascot head, glowing cyan visor, clean dark studio background, esports avatar logo',
      width: 512,
      height: 512,
    });
    const mascotGenRef = await ingestion.ingestBuffer({
      buffer: mascotGenBuf,
      kind: 'image',
      extension: 'png',
      originalName: 'mascot-ai.png',
    });
    const mascotCutoutBuf = await chain.removeBackground({
      inputImagePath: ingestion.resolvePortablePath(mascotGenRef.relativePath),
    });
    const mascotCutoutRef = await ingestion.ingestBuffer({
      buffer: mascotCutoutBuf,
      kind: 'cutout',
      extension: 'png',
      originalName: 'mascot-cutout.png',
    });
    const avatarRes = await orch.orchestrateCreation({
      artType: 'avatar',
      prompt: 'Avatar de mascote tecnológico futurista',
      brandKit,
      subjectAsset: mascotCutoutRef,
      avatarBackdrop: 'dark',
    });
    const avatarClean = {
      ...avatarRes.document,
      layers: avatarRes.document.layers.map((l) =>
        l.type === 'subject' ? { ...l, removeBackground: false, cutoutMethod: 'rembg_semantic' as const } : l,
      ),
    };
    const avatarOut = await exporter.exportProject(avatarClean, {
      outputPath: join(outDir, 'tech-mascot-avatar-800x800.png'),
      format: 'png',
    });
    expect(avatarOut.width).toBe(800);
    expect(avatarOut.height).toBe(800);

    // 7. Transparent Watermark (150x150)
    const wmRes = await orch.orchestrateCreation({
      artType: 'watermark',
      prompt: 'Marca d agua transparente CyberEdge',
      headline: 'CYBEREDGE',
      brandKit,
    });
    const wmOut = await exporter.exportProject(wmRes.document, {
      outputPath: join(outDir, 'channel-watermark-150x150.png'),
      format: 'png',
    });
    expect(wmOut.width).toBe(150);
    expect(wmOut.height).toBe(150);
    expect(wmOut.hasAlpha).toBe(true);

    writeFileSync(
      join(outDir, 'quality-report.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          thumbnailLabAudits: lab.variants.map((v) => ({ label: v.label, style: v.styleTitle, audit: v.audit })),
          bannerAudit: bannerRes.audit,
          avatarAudit: avatarRes.audit,
          watermarkAudit: wmRes.audit,
        },
        null,
        2,
      ),
    );
  }, 180_000);
});
