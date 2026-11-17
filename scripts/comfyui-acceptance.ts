import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ComfyUiImageAdapter,
  auditGeneratedImage,
  discoverComfyUi,
  type ProfessionalPresetId,
} from '../packages/creative-studio/src/index.js';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const outputDir = join(root, 'artifacts', 'comfyui-acceptance');
const referenceArgIndex = process.argv.indexOf('--reference');
const referencePath = referenceArgIndex >= 0 ? process.argv[referenceArgIndex + 1] : undefined;
const checkpointArgIndex = process.argv.indexOf('--checkpoint');
const requestedCheckpoint = checkpointArgIndex >= 0 ? process.argv[checkpointArgIndex + 1] : undefined;

async function vramMiB(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']);
    const value = Number.parseInt(stdout.trim().split(/\r?\n/)[0] ?? '', 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const status = await discoverComfyUi({ requestTimeoutMs: 1000 });
if (status.state !== 'ready' || status.models.checkpoints.length === 0) {
  console.log(JSON.stringify({ state: 'blocked', reason: status.reason ?? 'ComfyUI is not ready.', status }, null, 2));
  process.exitCode = 2;
} else {
  const checkpoint = requestedCheckpoint ?? status.models.checkpoints[0];
  if (!checkpoint) throw new Error('ComfyUI reported ready without a checkpoint.');
  const adapter = new ComfyUiImageAdapter({ endpoint: status.endpoint, checkpoint, timeoutMs: 15 * 60_000 });
  const cases: Array<{ id: string; preset: ProfessionalPresetId; prompt: string; width: number; height: number; characterCount: number; reference?: string }> = [
    { id: 'anime-close-up', preset: 'anime_cinematic', prompt: 'anime close-up portrait, one original warrior, expressive eyes, clean face and hands, cinematic key light', width: 768, height: 768, characterCount: 1 },
    { id: 'anime-combat-two', preset: 'anime_premium_cinematic', prompt: 'two distinct anime warriors in an action combat exchange, full silhouettes separated left and right, energy clash', width: 1024, height: 576, characterCount: 2 },
    { id: 'cyberpunk-trio', preset: 'cyberpunk_neon', prompt: 'three distinct cyberpunk characters in separate readable positions, rain-slick futuristic city, cyan and magenta rim light', width: 1024, height: 576, characterCount: 3 },
    { id: 'cyberpunk-group-eight', preset: 'cyberpunk_neon', prompt: 'eight distinct cyberpunk characters arranged as a readable group, no fused bodies, varied silhouettes, cinematic city depth', width: 1024, height: 576, characterCount: 8 },
    { id: 'gamer-thumbnail', preset: 'youtube_thumbnail_1280x720', prompt: 'professional gamer thumbnail, one expressive player reaction and a clear gaming setup, strong silhouette, negative space for editor text', width: 1280, height: 720, characterCount: 1 },
    { id: 'nextworth-banner', preset: 'banner_2560x1440', prompt: 'NextWorth channel banner with two original tech heroes at the far edges, layered futuristic skyline, calm center safe area for editor text', width: 1280, height: 720, characterCount: 2 },
    ...(referencePath && existsSync(referencePath)
      ? [{ id: 'reference-img2img', preset: 'gaming_cinematic' as const, prompt: 'same subject, cinematic polished key art, preserve the reference identity', width: 768, height: 768, reference: referencePath }]
      : []),
  ];
  mkdirSync(outputDir, { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  for (const testCase of cases) {
    const started = Date.now();
    const before = await vramMiB();
    let peak = before;
    const sampler = setInterval(() => {
      void vramMiB().then((current) => {
        if (current !== null && (peak === null || current > peak)) peak = current;
      });
    }, 500);
    try {
      const image = await adapter.generateImage({
        prompt: testCase.prompt,
        negativePrompt: 'text, letters, watermark, logo, blurry, malformed anatomy, extra limbs',
        width: testCase.width,
        height: testCase.height,
        seed: 10_000 + results.length,
        preset: testCase.preset,
        characterCount: testCase.characterCount,
        ...(testCase.reference ? { referenceImagePaths: [testCase.reference], strength: 0.42 } : {}),
      });
      const audit = await auditGeneratedImage(image, { expectedWidth: testCase.width, expectedHeight: testCase.height });
      const outputPath = join(outputDir, `${testCase.id}.png`);
      writeFileSync(outputPath, image);
      clearInterval(sampler);
      const after = await vramMiB();
      if (after !== null && (peak === null || after > peak)) peak = after;
      results.push({
        id: testCase.id,
        status: audit.passed ? 'passed' : 'rejected',
        model: checkpoint,
        workflow: testCase.reference ? 'native-img2img' : 'native-txt2img',
        seed: 10_000 + results.length,
        characterCount: testCase.characterCount,
        resolution: `${testCase.width}x${testCase.height}`,
        file: outputPath,
        ms: Date.now() - started,
        vramBeforeMiB: before,
        vramAfterMiB: after,
        vramPeakMiB: peak,
        audit,
        defects: audit.findings,
        corrections: [],
      });
    } catch (error) {
      clearInterval(sampler);
      const after = await vramMiB();
      if (after !== null && (peak === null || after > peak)) peak = after;
      results.push({
        id: testCase.id,
        status: 'failed',
        model: checkpoint,
        workflow: testCase.reference ? 'native-img2img' : 'native-txt2img',
        seed: 10_000 + results.length,
        characterCount: testCase.characterCount,
        resolution: `${testCase.width}x${testCase.height}`,
        ms: Date.now() - started,
        vramBeforeMiB: before,
        vramAfterMiB: after,
        vramPeakMiB: peak,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    status,
    checkpoint,
    results,
    limitations: [
      'Structural audit does not prove identity, anatomy, character count, text legibility, or visual quality; human review is required.',
      'The native acceptance path uses one full-canvas diffusion pass; regional multi-character generation and IP-Adapter identity locking require installed nodes/models and are not silently assumed.',
    ],
  };
  writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.every((result) => result.status === 'passed') ? 0 : 1;
}
