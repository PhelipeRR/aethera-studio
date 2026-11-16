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
  const cases: Array<{ id: string; preset: ProfessionalPresetId; prompt: string; width: number; height: number; reference?: string }> = [
    { id: 'anime-single-character', preset: 'anime_premium_cinematic', prompt: 'one original anime hero, dynamic but clean pose, cinematic key light', width: 768, height: 768 },
    { id: 'gaming-single-character', preset: 'gaming_cinematic', prompt: 'one heroic video game character, readable silhouette, dramatic action', width: 1024, height: 576 },
    { id: 'cyberpunk-thumbnail', preset: 'cyberpunk_neon', prompt: 'one cyberpunk hero in a rain-slick futuristic city, cyan and magenta rim light', width: 1024, height: 576 },
    { id: 'banner-safe-area', preset: 'banner_2560x1440', prompt: 'two original heroes at the far edges of a cinematic sci-fi skyline, calm center band', width: 1024, height: 576 },
    { id: 'avatar-portrait', preset: 'youtube_thumbnail_1280x720', prompt: 'single friendly original mascot bust portrait, clean silhouette, simple background', width: 768, height: 768 },
    ...(referencePath && existsSync(referencePath)
      ? [{ id: 'reference-img2img', preset: 'gaming_cinematic' as const, prompt: 'same subject, cinematic polished key art, preserve the reference identity', width: 768, height: 768, reference: referencePath }]
      : []),
  ];
  mkdirSync(outputDir, { recursive: true });
  const results: Array<Record<string, unknown>> = [];
  for (const testCase of cases) {
    const started = Date.now();
    const before = await vramMiB();
    try {
      const image = await adapter.generateImage({
        prompt: testCase.prompt,
        negativePrompt: 'text, letters, watermark, logo, blurry, malformed anatomy, extra limbs',
        width: testCase.width,
        height: testCase.height,
        seed: 10_000 + results.length,
        preset: testCase.preset,
        ...(testCase.reference ? { referenceImagePaths: [testCase.reference], strength: 0.42 } : {}),
      });
      const audit = await auditGeneratedImage(image, { expectedWidth: testCase.width, expectedHeight: testCase.height });
      writeFileSync(join(outputDir, `${testCase.id}.png`), image);
      results.push({ id: testCase.id, status: audit.passed ? 'passed' : 'rejected', ms: Date.now() - started, vramBeforeMiB: before, vramAfterMiB: await vramMiB(), audit });
    } catch (error) {
      results.push({ id: testCase.id, status: 'failed', ms: Date.now() - started, vramBeforeMiB: before, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const report = { generatedAt: new Date().toISOString(), status, checkpoint, results };
  writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = results.every((result) => result.status === 'passed') ? 0 : 1;
}
