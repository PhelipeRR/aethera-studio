import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { AetheraCreativeStudioRepository, openDatabase } from '../../database/src/index.js';
import {
  AssetIngestionService,
  BrandKitManager,
  CompositionPlanner,
  CreativeOrchestrator,
  ExportService,
  LayeredDocumentEditor,
  QualityGateService,
  SharpSvgCompositionEngine,
  VideoFrameAnalyzer,
  type ReasoningEngineProvider,
} from '../src/index.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const singleFallbackProvider: ReasoningEngineProvider = {
  id: 'claude-code',
  isAvailable: async () => true,
  runPrompt: async (prompt) => ({
    text: `HEADLINE: CYBERWARE 2077\nDirection OK for ${prompt.slice(0, 40)}`,
  }),
};

describe('CS-5 E2E Real Examples: Cyberpunk 2077 Thumbnail, Gamer Banner, Mascot Avatar, Watermark & SQLite Persistence', () => {
  it('executes full E2E pipeline for all 4 real creative assets, SQLite persistence, and idempotent video watermark', async () => {
    const root = makeTempDir('cs5-e2e-');
    const exportsDir = join(root, 'exports');
    const ingestion = new AssetIngestionService({ storageRoot: root });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const exporter = new ExportService(engine);
    const analyzer = new VideoFrameAnalyzer(ingestion);
    const qc = new QualityGateService(engine);
    const planner = new CompositionPlanner();
    const orch = new CreativeOrchestrator([singleFallbackProvider], planner, qc);

    // 0. Open real SQLite DB with migration 0121
    const dbPath = join(root, 'aethera-studio.db');
    const dbHandle = openDatabase(dbPath, { migrationsFolder: join(process.cwd(), 'packages/database/migrations') });
    const repo = new AetheraCreativeStudioRepository(dbHandle.db);

    const brandKit = new BrandKitManager().create({
      channelName: 'CyberEdge BR',
      palette: { primary: '#00F0FF', secondary: '#FF006E', accent: '#FACC15', background: '#070B14', surface: '#111827', text: '#FFFFFF' },
    });
    repo.saveBrandKit({
      id: brandKit.id,
      channelId: null,
      channelName: brandKit.channelName,
      dataJson: JSON.stringify(brandKit),
      createdAt: brandKit.createdAt,
      updatedAt: brandKit.updatedAt,
    });

    // 1. Real Cyberpunk 2077-style gameplay MP4 -> Frame Extraction -> Thumbnail Lab (3 variations)
    const gameplayMp4 = join(root, 'cyberpunk-gameplay.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=24:duration=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      gameplayMp4,
    ]);

    const frames = await analyzer.analyzeAndExtractFrames({
      videoPath: gameplayMp4,
      sampleCount: 3,
      sceneHints: [{ timestampSec: 1.0, label: 'Mantis Blades Upgrade', emotion: 'adrenaline' }],
    });
    expect(frames.bestCandidate).not.toBeNull();

    const mascotPng = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 8, g: 12, b: 20, alpha: 1 } },
    })
      .composite([
        {
          input: Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="180" fill="#00F0FF"/><rect x="176" y="210" width="160" height="44" rx="12" fill="#070B14"/></svg>',
          ),
        },
      ])
      .png()
      .toBuffer();
    const mascotRef = await ingestion.ingestBuffer({
      buffer: mascotPng,
      kind: 'image',
      extension: 'png',
      originalName: 'tech-mascot.png',
    });

    const lab = await orch.orchestrateThumbnailLab({
      prompt: 'Upgrades cibernéticos de Cyberpunk 2077 com implantes lendários',
      headline: 'CYBERWARE INSANO',
      brandKit,
      backgroundAsset: frames.bestCandidate!.asset,
      subjectAsset: mascotRef,
      sourceCinemaProjectId: 'cinema-cp2077-1',
    });
    expect(lab.variants).toHaveLength(3);
    const chosenThumb = lab.variants[0]!.document;
    expect(lab.variants[0]!.audit.passed).toBe(true);

    // Export thumbnail PNG + portable project JSON + animated MP4 preview
    const thumbPng = await exporter.exportProject(chosenThumb, {
      outputPath: join(exportsDir, 'cyberpunk-2077-thumb.png'),
      format: 'png',
    });
    const thumbProj = await exporter.exportProject(chosenThumb, {
      outputPath: join(exportsDir, 'cyberpunk-2077-thumb.aethera-creative.json'),
      format: 'project',
    });
    const animPreview = await exporter.exportAnimatedPreview(chosenThumb, {
      outputPath: join(exportsDir, 'cyberpunk-2077-preview.mp4'),
      format: 'mp4',
      durationSec: 2,
    });
    expect(thumbPng.width).toBe(1280);
    expect(thumbPng.height).toBe(720);
    expect(existsSync(animPreview.outputPath)).toBe(true);
    expect(animPreview.bytes).toBeGreaterThan(1000);

    // Reopen saved portable project and edit ONLY the title layer
    const reopened = exporter.loadPortableProject(thumbProj.outputPath);
    const editor = new LayeredDocumentEditor(reopened);
    const editRes = editor.applyLocalizedPromptEdit('Mude o título para "PHANTOM LIBERTY"');
    expect(editRes.applied).toBe(true);
    const editedDoc = editor.getDocument();
    repo.saveProject({
      id: editedDoc.id,
      artType: editedDoc.artType,
      title: editedDoc.title,
      brandKitId: editedDoc.brandKitId ?? null,
      sourceCinemaProjectId: editedDoc.sourceCinemaProjectId ?? null,
      schemaVersion: editedDoc.schemaVersion,
      dataJson: JSON.stringify(editedDoc),
      createdAt: editedDoc.createdAt,
      updatedAt: editedDoc.updatedAt,
    });
    expect(repo.getProject(editedDoc.id)?.title).toBe(editedDoc.title);

    // 2. Futuristic Gamer Banner (2560x1440)
    const bannerRes = await orch.orchestrateCreation({
      artType: 'banner',
      prompt: 'Banner de canal gamer futurista com neon ciano e magenta',
      headline: 'CYBEREDGE BR',
      brandKit,
      subjectAsset: mascotRef,
    });
    expect(bannerRes.audit.passed).toBe(true);
    const bannerOut = await exporter.exportProject(bannerRes.document, {
      outputPath: join(exportsDir, 'gamer-banner.png'),
      format: 'png',
    });
    expect(bannerOut.width).toBe(2560);
    expect(bannerOut.height).toBe(1440);

    // 3. Tech Mascot Avatar (800x800)
    const avatarRes = await orch.orchestrateCreation({
      artType: 'avatar',
      prompt: 'Avatar de mascote tecnológico minimalista',
      brandKit,
      subjectAsset: mascotRef,
      avatarBackdrop: 'dark',
    });
    expect(avatarRes.audit.passed).toBe(true);
    const avatarOut = await exporter.exportProject(avatarRes.document, {
      outputPath: join(exportsDir, 'mascot-avatar.png'),
      format: 'png',
    });
    expect(avatarOut.width).toBe(800);
    expect(avatarOut.height).toBe(800);

    // 4. Transparent Watermark (150x150) + Idempotent application onto MP4
    const wmRes = await orch.orchestrateCreation({
      artType: 'watermark',
      prompt: 'Marca d agua transparente do canal CyberEdge',
      headline: 'CYBEREDGE',
      brandKit,
    });
    expect(wmRes.audit.passed).toBe(true);
    const wmOut = await exporter.exportProject(wmRes.document, {
      outputPath: join(exportsDir, 'channel-watermark.png'),
      format: 'png',
    });
    expect(wmOut.width).toBe(150);
    expect(wmOut.height).toBe(150);
    expect(wmOut.hasAlpha).toBe(true);

    const wmVideo1 = join(exportsDir, 'video-watermarked-1.mp4');
    const wmPass1 = await exporter.applyWatermarkToVideo({
      inputVideoPath: gameplayMp4,
      watermarkPngPath: wmOut.outputPath,
      outputVideoPath: wmVideo1,
    });
    expect(wmPass1.applied).toBe(true);
    expect(wmPass1.skippedAlreadyWatermarked).toBe(false);

    const wmVideo2 = join(exportsDir, 'video-watermarked-2.mp4');
    const wmPass2 = await exporter.applyWatermarkToVideo({
      inputVideoPath: wmVideo1,
      watermarkPngPath: wmOut.outputPath,
      outputVideoPath: wmVideo2,
    });
    expect(wmPass2.applied).toBe(false);
    expect(wmPass2.skippedAlreadyWatermarked).toBe(true);

    dbHandle.close();
  }, 30000);
});
