import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AssetIngestionService,
  BrandKitManager,
  CompositionPlanner,
  CreativeOrchestrator,
  QualityGateService,
  SharpSvgCompositionEngine,
  VideoFrameAnalyzer,
  type ReasoningEngineProvider,
  type TechnicalEngineId,
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

function makeProvider(id: TechnicalEngineId, available: boolean): ReasoningEngineProvider {
  return {
    id,
    async isAvailable() {
      return available;
    },
    async runPrompt(prompt: string) {
      return { text: `HEADLINE: CYBERPUNK 2077\n[${id}] ${prompt.slice(0, 60)}` };
    },
  };
}

describe('CS-3 VideoFrameAnalyzer, CreativeOrchestrator (4-engine & single-agent fallback), QualityGate & Thumbnail Lab', () => {
  it('extracts real frames from an MP4 video via ffmpeg and ranks visual impact', async () => {
    const root = makeTempDir('cs3-video-');
    const videoPath = join(root, 'sample-gameplay.mp4');
    // Generate a 2s 1280x720 MP4 with testsrc2 (rich color & motion)
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
      videoPath,
    ]);

    const ingestion = new AssetIngestionService({ storageRoot: root });
    const analyzer = new VideoFrameAnalyzer(ingestion);
    const analysis = await analyzer.analyzeAndExtractFrames({
      videoPath,
      sampleCount: 3,
      sceneHints: [{ timestampSec: 1.0, label: 'Climax', emotion: 'intense' }],
    });

    expect(analysis.candidates.length).toBeGreaterThanOrEqual(3);
    expect(analysis.bestCandidate).not.toBeNull();
    expect(analysis.bestCandidate!.isBlackFrame).toBe(false);
    expect(analysis.bestCandidate!.impactScore).toBeGreaterThan(20);
    expect(analysis.bestCandidate!.asset.width).toBe(1280);
    expect(analysis.bestCandidate!.asset.height).toBe(720);
  }, 15000);

  it('runs with all 4 engines AND falls back cleanly when only 1 engine is available', async () => {
    const root = makeTempDir('cs3-orch-');
    const ingestion = new AssetIngestionService({ storageRoot: root });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const qc = new QualityGateService(engine);
    const planner = new CompositionPlanner();

    const fourEngineOrch = new CreativeOrchestrator(
      [
        makeProvider('claude-code', true),
        makeProvider('codex-cli', true),
        makeProvider('antigravity-cli', true),
        makeProvider('claude-gateway', true),
      ],
      planner,
      qc,
    );
    const fullRes = await fourEngineOrch.orchestrateCreation({
      artType: 'thumbnail',
      prompt: 'Upgrades cibernéticos de Cyberpunk 2077',
    });
    expect(fullRes.availableEngines).toEqual(['claude-code', 'codex-cli', 'antigravity-cli', 'claude-gateway']);
    expect(fullRes.traces.every((t) => !t.fallbackUsed)).toBe(true);

    // Single-agent fallback: only codex-cli available
    const singleEngineOrch = new CreativeOrchestrator(
      [
        makeProvider('claude-code', false),
        makeProvider('codex-cli', true),
        makeProvider('antigravity-cli', false),
        makeProvider('claude-gateway', false),
      ],
      planner,
      qc,
    );
    const singleRes = await singleEngineOrch.orchestrateCreation({
      artType: 'thumbnail',
      prompt: 'Upgrades cibernéticos de Cyberpunk 2077',
    });
    expect(singleRes.availableEngines).toEqual(['codex-cli']);
    expect(singleRes.traces).toHaveLength(4);
    expect(singleRes.traces.every((t) => t.assignedEngine === 'codex-cli')).toBe(true);
    expect(singleRes.audit.passed).toBe(true);
  });

  it('blocks auto-approval on banner safe-area violation and generates 3 Thumbnail Lab variations', async () => {
    const root = makeTempDir('cs3-lab-');
    const ingestion = new AssetIngestionService({ storageRoot: root });
    const engine = new SharpSvgCompositionEngine(ingestion);
    const qc = new QualityGateService(engine);
    const planner = new CompositionPlanner();
    const brandKit = new BrandKitManager().create({ channelName: 'CyberLab' });

    // Critical defect: banner text placed outside 1546x423 safe area
    const badBanner = planner.buildDocument({
      artType: 'banner',
      prompt: 'Banner gamer futurista',
      brandKit,
    });
    const badText = badBanner.layers.find((l) => l.type === 'text')!;
    badText.transform.x = 50; // outside safeArea.x (507)
    const badAudit = await qc.auditProject(badBanner, { brandKit });
    expect(badAudit.autoApprovable).toBe(false);
    expect(badAudit.findings.some((f) => f.code === 'BANNER_OUTSIDE_SAFE_AREA' && f.severity === 'critical')).toBe(true);

    // Thumbnail Lab: 3 variations (A, B, C)
    const orch = new CreativeOrchestrator([makeProvider('claude-code', true)], planner, qc);
    const lab = await orch.orchestrateThumbnailLab({
      prompt: 'Cyberpunk 2077 Mantis Blades',
      headline: 'MANTIS BLADES',
      brandKit,
    });
    expect(lab.variants.map((v) => v.label)).toEqual(['A', 'B', 'C']);
    expect(lab.variants.every((v) => v.audit.scorecard.disclaimer.includes('does not predict actual CTR'))).toBe(true);
    expect(lab.variants.every((v) => v.audit.passed)).toBe(true);
  });
});
