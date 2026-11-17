import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectSegmentCuts, probeSegmentQuality, windowCuts } from '../packages/workspace/src/aethera-segment-quality.js';
import { extractSegmentFrames } from '../packages/workspace/src/aethera-visual-frames.js';
import { createOllamaLocalVlmProvider } from '../packages/orchestrator/src/aethera/vision-providers.js';
import { VisionRouter } from '../packages/orchestrator/src/aethera/vision-router.js';

const exec = promisify(execFile);
const ffmpeg = process.env['FFMPEG_PATH'] ?? 'C:/ffmpeg/bin/ffmpeg.exe';
const ffprobe = process.env['FFPROBE_PATH'] ?? 'C:/ffmpeg/bin/ffprobe.exe';
const repo = process.cwd();
const source = join(repo, 'artifacts/creative-studio-cs6/cyberpunk-2077-clip.mp4');
const sourceBytes = statSync(source).size;
const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const outDir = join(repo, 'artifacts', 'aethera-p2-broll-poc', runId);
const mediaDir = join(outDir, 'media');
mkdirSync(mediaDir, { recursive: true });
copyFileSync(source, join(mediaDir, 'cyberpunk-2077-clip.mp4'));

type Timed<T> = { value: T; elapsedMs: number };
async function timed<T>(run: () => Promise<T>): Promise<Timed<T>> {
  const started = process.hrtime.bigint();
  const value = await run();
  return { value, elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000 };
}

const probe = JSON.parse((await exec(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source], { windowsHide: true })).stdout) as {
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; duration?: string }>;
  format?: { duration?: string };
};
const video = probe.streams?.find((stream) => stream.codec_type === 'video');
const durationMs = Math.round(Number(probe.format?.duration ?? video?.duration ?? 0) * 1_000);
const root = outDir;
const relativePath = 'media/cyberpunk-2077-clip.mp4';
const cutsRun = await timed(() => detectSegmentCuts({ ffmpeg, root, relativePath, durationMs }));
const cuts = cutsRun.value;
const boundedCuts = windowCuts(cuts);

const segments: Array<Record<string, unknown>> = [];
for (let index = 1; index < boundedCuts.length; index += 1) {
  const startMs = Math.round((boundedCuts[index - 1] ?? 0) * 1_000);
  const endMs = Math.round((boundedCuts[index] ?? 0) * 1_000);
  if (endMs - startMs < 100) continue;
  const qualityRun = await timed(() => probeSegmentQuality({ ffmpeg, root, relativePath, startMs, endMs }));
  const firstRun = await timed(() => extractSegmentFrames({ root, relativePath, startMs, endMs, ffmpeg }));
  const frameDir = join(root, '.aethera-frames');
  const filesAfterFirst = existsSync(frameDir) ? readdirSync(frameDir).filter((name) => name.endsWith('.jpg')).sort() : [];
  const secondRun = await timed(() => extractSegmentFrames({ root, relativePath, startMs, endMs, ffmpeg }));
  const filesAfterSecond = existsSync(frameDir) ? readdirSync(frameDir).filter((name) => name.endsWith('.jpg')).sort() : [];
  const firstHashes = firstRun.value.map((frame) => frame.hash);
  const secondHashes = secondRun.value.map((frame) => frame.hash);
  segments.push({
    id: `${sourceHash.slice(0, 16)}:${startMs}-${endMs}`,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    keyframes: firstRun.value.map((frame, frameIndex) => ({
      atMs: Math.floor(startMs + ((endMs - startMs) * (frameIndex + 0.5)) / firstRun.value.length),
      hash: frame.hash,
      path: frame.path,
      bytes: statSync(frame.path).size,
    })),
    quality: qualityRun.value,
    timingsMs: { quality: qualityRun.elapsedMs, extractFirst: firstRun.elapsedMs, extractSecond: secondRun.elapsedMs },
    cache: {
      firstPassFiles: filesAfterFirst.length,
      secondPassFiles: filesAfterSecond.length,
      reusedOnSecondPass: JSON.stringify(firstHashes) === JSON.stringify(secondHashes) && filesAfterSecond.length === filesAfterFirst.length,
    },
  });
}

let semantic: Record<string, unknown>;
const semanticStarted = process.hrtime.bigint();
try {
  const provider = createOllamaLocalVlmProvider();
  const available = await provider.detect?.();
  if (!available?.available) {
    semantic = {
      status: 'technical_blocked',
      provider: provider.id,
      model: provider.model,
      reason: available?.reason ?? 'provider unavailable',
      elapsedMs: Number(process.hrtime.bigint() - semanticStarted) / 1_000_000,
    };
  } else {
    const frames = segments.flatMap((segment) => (segment.keyframes as Array<{ hash: string; path: string; atMs: number }>).map((frame) => ({ ...frame }))).slice(0, provider.limits.maxImagesPerCall);
    const router = new VisionRouter([provider], { get: () => undefined, put: () => undefined });
    const route = await router.analyze({
      frames,
      context: 'Cyberpunk 2077 gameplay; prove only what is visible.',
      policy: { schemaVersion: 1, task: 'describe', chain: [provider.id], scope: 'project', thresholds: null, version: 'p2-poc-v1', maxLatencyMs: 120_000, budgetUsd: 0 },
    });
    semantic = {
      status: route.value ? 'succeeded' : 'technical_blocked',
      provider: route.provider,
      model: route.model,
      confidence: route.value?.confidence ?? null,
      nature: route.value?.nature ?? null,
      description: route.value?.description ?? null,
      attempts: route.attempts,
      elapsedMs: Number(process.hrtime.bigint() - semanticStarted) / 1_000_000,
    };
  }
} catch (error) {
  semantic = {
    status: 'technical_blocked',
    error: error instanceof Error ? error.message : String(error),
    elapsedMs: Number(process.hrtime.bigint() - semanticStarted) / 1_000_000,
  };
}

let gpu: string;
try {
  gpu = (await exec('nvidia-smi', ['--query-gpu=name,memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true })).stdout.trim();
} catch {
  gpu = 'nvidia-smi unavailable';
}

const report = {
  schemaVersion: 1,
  phase: 'P2',
  kind: 'broll-poc',
  runId,
  source: { path: source, copiedTo: join(mediaDir, 'cyberpunk-2077-clip.mp4'), bytes: sourceBytes, sha256: sourceHash, reusedWithoutDownload: true, downloads: 0 },
  mediaProbe: { durationMs, durationSec: durationMs / 1_000, width: video?.width ?? null, height: video?.height ?? null, fps: video?.r_frame_rate ?? null, codec: video?.codec_name ?? null },
  detection: { cutsSeconds: cuts, windowCutsSeconds: boundedCuts, cutCount: Math.max(0, cuts.length - 2), segmentCount: segments.length, elapsedMs: cutsRun.elapsedMs },
  segments,
  semantic,
  resources: { maxRssKb: process.resourceUsage().maxRSS, userCpuMicros: process.resourceUsage().userCPUTime, systemCpuMicros: process.resourceUsage().systemCPUTime, gpu },
  comparison: { currentAetheraHas: ['FFmpeg scene cuts', 'interior frame extraction', 'content-addressed frame hashes', 'black/freeze/motion probe', 'VisionRouter integration'], pocDoesNotClaim: ['contact-sheet generation', 'flash-frame classifier', 'HDR-to-SDR transform', 'narrative interval selector'] },
  limitation: 'O arquivo local tem duração curta; a prova valida rastreabilidade, segmentação, keyframes, qualidade e cache, mas não substitui um benchmark longo com múltiplos cortes.',
};
const reportPath = join(outDir, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, sourceHash, durationMs, cuts, segmentCount: segments.length, keyframes: segments.reduce((sum, segment) => sum + (segment.keyframes as unknown[]).length, 0), cacheReuse: segments.every((segment) => (segment.cache as { reusedOnSecondPass: boolean }).reusedOnSecondPass), semantic, maxRssKb: report.resources.maxRssKb, gpu }, null, 2));
