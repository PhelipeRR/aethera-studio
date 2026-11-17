import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildEditorialScript,
  produceCinemaPackage,
  renderRealCinemaMp4,
  type SourceMediaRecord,
} from '../packages/cinema/src/index.js';
import { rankMediaSegments, VIDEO_FORMATS, type MediaSegment, type MediaSegmentCandidate, type SubjectIdentity, type VisionPolicy } from '../packages/shared/src/index.js';
import {
  BROLL_INDEX_VERSION,
  classifyBrollSemanticDecision,
  classifyTemporalSamples,
  discardFlashKeyframeTimes,
  makeBrollContactSheet,
  stableBrollSegmentId,
  validateBrollContinuity,
} from '../packages/workspace/src/aethera-broll-index.js';
import { detectSegmentCuts, probeSegmentQuality, probeSegmentTemporalSamples, windowCuts } from '../packages/workspace/src/aethera-segment-quality.js';
import { extractSegmentFrames, selectVisualAnalysisFfmpeg } from '../packages/workspace/src/aethera-visual-frames.js';
import { createAgentAdapterVisionProvider, createAntigravityCliVisionProvider, createOllamaLocalVlmProvider, createVisionProviders } from '../packages/orchestrator/src/aethera/vision-providers.js';
import { VisionRouter } from '../packages/orchestrator/src/aethera/vision-router.js';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { detectAntigravityCli, runAntigravityPrompt } from '../apps/aethera-desktop/src/main/antigravity-cli.js';
import { createReferenceClips, FFMPEG } from '../packages/workspace/test/fixtures/aethera-reference.js';

const exec = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '..');
const ffmpeg = process.env['FFMPEG_PATH'] ?? FFMPEG;
const ffprobe = process.env['FFPROBE_PATH'] ?? ffmpeg.replace(/ffmpeg(?:\.exe)?$/i, 'ffprobe.exe');
const cyberpunkPath = join(repoRoot, 'artifacts', 'creative-studio-cs6', 'cyberpunk-2077-clip.mp4');
if (!existsSync(cyberpunkPath) || statSync(cyberpunkPath).size <= 1_024) throw new Error(`cyberpunk_local_media_missing: ${cyberpunkPath}`);

const runId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const evidenceDir = join(repoRoot, 'artifacts', 'aethera-p2-broll-acceptance', runId);
mkdirSync(evidenceDir, { recursive: true });

type SegmentEvidence = {
  segment: MediaSegment;
  framePaths: string[];
  timingsMs: { frames: number; temporal: number; quality: number };
};

const policy: VisionPolicy = {
  schemaVersion: 1,
  task: 'describe',
  chain: ['local-vlm', 'antigravity', 'claude', 'codex'],
  scope: 'project',
  thresholds: null,
  version: 'p2-acceptance-v1',
  budgetUsd: 0,
  maxLatencyMs: 30_000,
};

async function probeDurationMs(path: string): Promise<number> {
  const result = JSON.parse((await exec(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { windowsHide: true })).stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; duration?: string }> };
  const duration = Number(result.format?.duration ?? result.streams?.find((stream) => stream.codec_type === 'video')?.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`invalid_duration: ${path}`);
  return Math.round(duration * 1_000);
}

async function optionalVisionRouter(root: string): Promise<{ provider: string; model: string; router: VisionRouter; available: boolean; reason?: string; health: Array<Record<string, unknown>> }> {
  const configured = [
    createOllamaLocalVlmProvider(),
    createAntigravityCliVisionProvider({ root, detect: async () => { const status = await detectAntigravityCli({ refresh: true }); return status.installed && status.authenticated !== false ? { available: true } : { available: false, reason: status.problems.join('; ') || 'Antigravity não autenticado' }; }, runPrompt: ({ prompt, cwd, model, signal }) => runAntigravityPrompt({ prompt, cwd, mode: 'read-only', ...(model ? { model } : {}), ...(signal ? { signal } : {}), timeoutMs: 45_000 }) }),
    createAgentAdapterVisionProvider({ id: 'claude', root, adapter: new ClaudeCliAdapter() }),
    createAgentAdapterVisionProvider({ id: 'codex', root, adapter: new CodexCliAdapter() }),
  ];
  const providers = createVisionProviders(configured);
  const health = await Promise.all(providers.filter((item) => ['local-vlm', 'antigravity', 'claude', 'codex'].includes(item.id)).map(async (item) => ({ provider: item.id, model: item.model, ...(await item.detect()) })));
  const first = health.find((item) => item.available);
  const cache = new Map<string, unknown>();
  const router = new VisionRouter(providers, { get: (key) => cache.get(JSON.stringify(key)), put: (key, value) => cache.set(JSON.stringify(key), value) }, [], undefined, undefined, undefined, undefined, 1_500, { enabledProviders: ['local-vlm', 'antigravity', 'claude', 'codex'], priority: ['local-vlm', 'antigravity', 'claude', 'codex'], perProviderTimeoutMs: { 'local-vlm': 2_000, antigravity: 45_000, claude: 45_000, codex: 45_000 }, maxAttempts: 4 });
  return { provider: first?.provider ?? 'none', model: first?.model ?? 'none', router, available: Boolean(first), ...(first?.available ? {} : { reason: 'Todos os provedores visuais configurados estão indisponíveis.' }), health };
}

async function indexAsset(input: { assetId: string; title: string; root: string; relativePath: string; sourcePath: string; durationMs: number; vision: Awaited<ReturnType<typeof optionalVisionRouter>> }): Promise<{ index: Record<string, unknown>; segments: SegmentEvidence[]; cacheReuse: boolean; cutCount: number; elapsedMs: number }> {
  const started = process.hrtime.bigint();
  const sourceHash = createHash('sha256').update(readFileSync(input.sourcePath)).digest('hex');
  const analysisFfmpeg = await selectVisualAnalysisFfmpeg([ffmpeg]);
  const cuts = await detectSegmentCuts({ ffmpeg: analysisFfmpeg, root: input.root, relativePath: input.relativePath, durationMs: input.durationMs });
  const boundedCuts = windowCuts(cuts);
  const segments: SegmentEvidence[] = [];
  for (let index = 1; index < boundedCuts.length; index += 1) {
    const startMs = Math.round((boundedCuts[index - 1] ?? 0) * 1_000);
    const endMs = Math.round((boundedCuts[index] ?? 0) * 1_000);
    if (endMs - startMs < 100) continue;
    const qualityStart = process.hrtime.bigint();
    const quality = await probeSegmentQuality({ ffmpeg: analysisFfmpeg, root: input.root, relativePath: input.relativePath, startMs, endMs });
    const qualityMs = Number(process.hrtime.bigint() - qualityStart) / 1_000_000;
    const framesStart = process.hrtime.bigint();
    const frames = await extractSegmentFrames({ ffmpeg: analysisFfmpeg, root: input.root, relativePath: input.relativePath, startMs, endMs });
    const framesMs = Number(process.hrtime.bigint() - framesStart) / 1_000_000;
    const temporalStart = process.hrtime.bigint();
    const temporalSamples = await probeSegmentTemporalSamples({ ffmpeg: analysisFfmpeg, root: input.root, relativePath: input.relativePath, startMs, endMs });
    const temporalMs = Number(process.hrtime.bigint() - temporalStart) / 1_000_000;
    const temporal = classifyTemporalSamples(temporalSamples);
    const continuity = validateBrollContinuity({ startMs, endMs, samples: temporalSamples });
    const safeTimes = discardFlashKeyframeTimes(frames.map((frame) => frame.atMs), temporal.flashFrameTimesMs);
    const safeFrames = safeTimes.length > 0 ? frames.filter((frame) => safeTimes.includes(frame.atMs)) : frames;
    // Always route through VisionRouter, including the unavailable-provider path, so the persisted attempt is real
    // fallback evidence rather than a preflight shortcut.
    const semantic = await input.vision.router.analyze({ frames: safeFrames, context: `${input.title}; descreva somente o que está visível no trecho.`, policy });
    const semanticDecision = classifyBrollSemanticDecision({
      mediaAvailable: true,
      technicalBlocked: temporal.technicalStatus === 'technical_blocked' || quality.black || quality.frozen || !continuity.valid,
      semanticConfidence: semantic.value?.confidence ?? null,
      attempts: semantic.attempts,
    });
    const id = stableBrollSegmentId({ sourceHash, startMs, endMs, indexVersion: BROLL_INDEX_VERSION });
    const segment: MediaSegment = {
      schemaVersion: 1,
      id,
      assetId: input.assetId,
      startMs,
      endMs,
      frameHashes: safeFrames.map((frame) => frame.hash),
      kind: 'unknown',
      description: semantic.value?.description ?? '',
      tags: [],
      embeddingRefs: [],
      quality: { blur: 0, motion: quality.motion, overlayText: Boolean(semantic.value?.overlays.burnedText), watermark: Boolean(semantic.value?.overlays.watermark), black: quality.black, frozen: quality.frozen },
      analyzedBy: { provider: semantic.provider ?? 'ffmpeg-heuristics', model: semantic.model ?? 'ffmpeg-signalstats', confidence: semantic.value?.confidence ?? 0 },
      broll: {
        indexVersion: BROLL_INDEX_VERSION,
        sourceHash,
        keyframes: safeFrames.map((frame) => ({ atMs: frame.atMs, hash: frame.hash, relativePath: relative(input.root, frame.path).replaceAll('\\', '/') })),
        technicalStatus: semanticDecision.technicalStatus,
        semanticStatus: semanticDecision.semanticStatus,
        ...(semantic.value ? { semanticEvidence: semantic.value.frames.map((frame) => ({ atMs: frame.atMs, observed: frame.observed })) } : {}),
        framingScore: semantic.value ? (semantic.value.overlays.burnedText || semantic.value.overlays.watermark ? 0.5 : 1) : 0.5,
        flashFrameTimesMs: temporal.flashFrameTimesMs,
        continuity,
        diagnostics: [`quality_frames=${quality.frames}`, `mean_luma=${quality.meanLuma.toFixed(2)}`, `mean_diff=${quality.meanDiff.toFixed(2)}`, `temporal_samples=${temporalSamples.length}`, `semantic_decision=${semanticDecision.reason}`],
      },
      analysis: { version: policy.version, band: 'review', calibratedConfidence: null, limitations: ['Acceptance benchmark does not change Scene Grounding thresholds.'], attempts: semantic.attempts.map((attempt) => ({ task: 'analyze', provider: attempt.provider, outcome: attempt.outcome, ...(attempt.detail ? { detail: attempt.detail } : {}) })) },
    };
    segments.push({ segment, framePaths: safeFrames.map((frame) => frame.path), timingsMs: { frames: framesMs, temporal: temporalMs, quality: qualityMs } });
  }
  const allFrames = segments.flatMap((item) => item.framePaths);
  const contactSheetPath = join(evidenceDir, `${input.assetId}-contact-sheet.jpg`);
  if (allFrames.length > 0) await makeBrollContactSheet({ ffmpeg: analysisFfmpeg, framePaths: allFrames, outputPath: contactSheetPath, labels: segments.flatMap((item) => item.segment.broll?.keyframes.map((frame) => `${item.segment.id.slice(-8)} @ ${frame.atMs}ms`) ?? []) });
  const index = { schemaVersion: 1, indexVersion: BROLL_INDEX_VERSION, assetId: input.assetId, sourceHash, sourcePath: input.relativePath, durationMs: input.durationMs, cutsSeconds: boundedCuts, contactSheetPath: relative(repoRoot, contactSheetPath).replaceAll('\\', '/'), segments: segments.map((item) => item.segment), status: segments.some((item) => item.segment.broll?.technicalStatus === 'technical_valid') ? 'complete' : 'technical_blocked', diagnostics: [`provider=${input.vision.provider}`, `provider_model=${input.vision.model}`, ...(input.vision.available ? [] : ['provider_unavailable'])] };
  const firstHashes = segments.flatMap((item) => item.segment.frameHashes);
  const secondFrames = await Promise.all(segments.map((item) => extractSegmentFrames({ ffmpeg: analysisFfmpeg, root: input.root, relativePath: input.relativePath, startMs: item.segment.startMs, endMs: item.segment.endMs })));
  const secondHashes = secondFrames.flatMap((frames) => frames.map((frame) => frame.hash));
  writeFileSync(join(evidenceDir, `${input.assetId}-broll-index.json`), JSON.stringify(index, null, 2));
  return { index, segments, cacheReuse: JSON.stringify(firstHashes) === JSON.stringify(secondHashes), cutCount: Math.max(0, boundedCuts.length - 2), elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000 };
}

async function renderIntegration(selection: { sourceStartMs: number; sourceEndMs: number; segmentId: string; semanticGatePassed: boolean }): Promise<Record<string, unknown>> {
  const sourceSha256 = createHash('sha256').update(readFileSync(cyberpunkPath)).digest('hex');
  const sourceMedia: SourceMediaRecord = { mediaId: 'cyberpunk-p2-source', uri: cyberpunkPath, sha256: sourceSha256, kind: 'video', origin: 'local', license: 'user_owned', duration: { value: 2, rate: 1 }, width: 1_280, height: 720, fps: { value: 24, rate: 1 }, hasAudio: false };
  const editorialScript = buildEditorialScript({ scriptId: 'aethera-p2-acceptance', source: 'agent', treatment: 'P2 B-roll selected interval rendered with the P1 Audio-First timeline.', segments: [{ beatId: 'beat_1', stage: 'hook', title: 'Night City', spokenText: 'Night City em neon.', estimatedDurationSec: 2 }] });
  const pkg = produceCinemaPackage({ projectId: 'aethera-p2-broll-acceptance', prompt: 'Cyberpunk 2077 em Night City', genre: 'gameplay_essay', targetDurationSec: 2, humorIntensity: 0, mediaCatalog: [sourceMedia], editorialScript, externalDirection: { treatment: editorialScript.treatment, beats: [{ stage: 'hook', summary: editorialScript.segments[0]?.spokenText ?? '' }] } });
  pkg.timeline.clips = pkg.timeline.clips.slice(0, 1);
  pkg.direction.shots = pkg.direction.shots.slice(0, 1);
  pkg.direction.narrativeBeats = pkg.direction.narrativeBeats.slice(0, 1);
  const firstClip = pkg.timeline.clips.find((clip) => clip.trackId === 'v1');
  if (!firstClip) throw new Error('p2_render_clip_missing');
  const sceneId = firstClip.shotId ?? firstClip.clipId;
  const rendered = await renderRealCinemaMp4({ pkg, brollSelections: [{ sceneId, mediaId: sourceMedia.mediaId, segmentId: selection.segmentId, sourceStartMs: selection.sourceStartMs, sourceEndMs: selection.sourceEndMs }], outputDir: join(evidenceDir, 'render'), fileName: 'p2-broll-audio-first.mp4', requireRealMedia: true, useNvenc: false, previewQuality: 'fast_preview', allowProceduralVoiceFallback: false, voiceStudioVoiceId: '9190edfa', segmentCacheDir: join(evidenceDir, 'segment-cache'), language: 'pt-BR' });
  const report = { mp4Path: rendered.mp4Path, sourceRange: selection, semanticGatePassed: selection.semanticGatePassed, narrationMode: rendered.narrationMode, audioFirstTimeline: rendered.audioFirstTimeline, probe: rendered.probe, deliveryValidation: rendered.deliveryValidation, incrementalRenderStats: rendered.incrementalRenderStats };
  writeFileSync(join(evidenceDir, 'integration-render.json'), JSON.stringify(report, null, 2));
  return report;
}

const vision = await optionalVisionRouter(repoRoot);
const realDurationMs = await probeDurationMs(cyberpunkPath);
const real = await indexAsset({ assetId: 'cyberpunk-2077', title: 'Cyberpunk 2077', root: repoRoot, relativePath: 'artifacts/creative-studio-cs6/cyberpunk-2077-clip.mp4', sourcePath: cyberpunkPath, durationMs: realDurationMs, vision });

const syntheticRoot = join(evidenceDir, 'synthetic-multicut');
const syntheticPaths = await createReferenceClips(syntheticRoot);
const syntheticRelativePath = syntheticPaths['fixture-game-a'];
if (!syntheticRelativePath) throw new Error('synthetic_fixture_missing');
const syntheticSource = join(syntheticRoot, syntheticRelativePath);
const synthetic = await indexAsset({ assetId: 'fixture-game-a', title: 'Controlled multi-cut fixture', root: syntheticRoot, relativePath: syntheticRelativePath, sourcePath: syntheticSource, durationMs: await probeDurationMs(syntheticSource), vision });

const format = VIDEO_FORMATS['youtube-long'];
const subject: SubjectIdentity = { schemaVersion: 1, id: 'identity-cyberpunk', assetId: 'cyberpunk-2077', segmentId: real.segments[0]?.segment.id ?? 'none', subjectId: 'cyberpunk-2077', signals: [{ source: 'local-artifact', verdict: 'match', score: 1, evidence: 'Local Cyberpunk artifact' }, { source: 'benchmark-input', verdict: 'match', score: 1, evidence: 'Acceptance benchmark input' }], status: 'verified', calibratedConfidence: 1, verifiedBy: 'rules' };
const candidateFor = (item: SegmentEvidence): MediaSegmentCandidate => ({ asset: { referenceId: item.segment.assetId, kind: 'video', title: 'Cyberpunk 2077 gameplay', publisher: 'local', url: 'https://local.invalid/cyberpunk', publishedAt: null, rightsStatus: 'verified_allowed', width: 1_280, height: 720, durationSeconds: realDurationMs / 1_000, basis: 'editorial_use' }, segment: item.segment, identity: { ...subject, segmentId: item.segment.id } });
const scene = { id: 'scene-p2', chapter: null, narration: 'Night City em neon.', startMs: 0, endMs: 2_000, claimIds: [], visualObjective: 'Mostrar Night City em neon', sceneType: 'broll' as const, searchTerms: ['Night City', 'neon'], visual: { type: 'none' as const }, onScreenText: '', transition: 'cut' as const, camera: 'static' as const, locked: false, reviewStatus: 'pending' as const };
const ranked = rankMediaSegments(scene, real.segments.map(candidateFor), { format, usedReferenceIds: [], usedSegmentIds: [], subjectId: 'cyberpunk-2077', thresholds: { autoAt: 0.95, reviewAt: 0.8 } });
const eligible = ranked.find((item) => item.eligible);
const technicalForRender = real.segments.find((item) => !item.segment.quality.black && !item.segment.quality.frozen && item.segment.broll?.continuity.valid);
if (!technicalForRender) throw new Error('p2_no_technical_segment_for_render');
const integration = await renderIntegration({ sourceStartMs: eligible?.sourceStartMs ?? technicalForRender.segment.startMs, sourceEndMs: eligible?.sourceEndMs ?? technicalForRender.segment.endMs, segmentId: eligible?.candidate.segment.id ?? technicalForRender.segment.id, semanticGatePassed: Boolean(eligible) });
writeFileSync(join(evidenceDir, 'vision-health.json'), JSON.stringify(vision.health, null, 2));

const report = { schemaVersion: 1, phase: 'P2', runId, sourceReuse: { cyberpunkPath, downloads: 0, sha256: createHash('sha256').update(readFileSync(cyberpunkPath)).digest('hex') }, vision: { provider: vision.provider, model: vision.model, available: vision.available, ...(vision.reason ? { reason: vision.reason } : {}) }, realCyberpunk: { durationMs: realDurationMs, cutCount: real.cutCount, segmentCount: real.segments.length, technicalValid: real.segments.filter((item) => item.segment.broll?.technicalStatus === 'technical_valid').length, semanticAdequate: real.segments.filter((item) => item.segment.broll?.semanticStatus === 'semantic_adequate').length, needsReview: real.segments.filter((item) => item.segment.broll?.semanticStatus === 'needs_review').length, technicalBlocked: real.segments.filter((item) => item.segment.broll?.technicalStatus === 'technical_blocked').length, cacheReuse: real.cacheReuse, contactSheet: real.index.contactSheetPath, segments: real.segments.map((item) => ({ id: item.segment.id, startMs: item.segment.startMs, endMs: item.segment.endMs, technicalStatus: item.segment.broll?.technicalStatus, semanticStatus: item.segment.broll?.semanticStatus, evidence: item.segment.broll?.semanticEvidence ?? [], attempts: item.segment.analysis?.attempts ?? [], keyframes: item.segment.broll?.keyframes ?? [], diagnostics: item.segment.broll?.diagnostics ?? [], timingsMs: item.timingsMs })) }, syntheticMultiCut: { cutCount: synthetic.cutCount, segmentCount: synthetic.segments.length, black: synthetic.segments.filter((item) => item.segment.quality.black).length, frozen: synthetic.segments.filter((item) => item.segment.quality.frozen).length, flashCandidates: synthetic.segments.reduce((sum, item) => sum + (item.segment.broll?.flashFrameTimesMs.length ?? 0), 0), cacheReuse: synthetic.cacheReuse, contactSheet: synthetic.index.contactSheetPath }, sceneGrounding: { eligibleCount: ranked.filter((item) => item.eligible).length, reviewCount: ranked.filter((item) => item.reviewRequired).length, selectedSegmentId: eligible?.candidate.segment.id ?? null, selectedReason: eligible?.reason ?? 'Nenhum trecho semanticamente elegível; render técnico não é aprovação editorial.', ranked: ranked.map((item) => ({ segmentId: item.candidate.segment.id, eligible: item.eligible, reviewRequired: item.reviewRequired, score: item.score, breakdown: item.breakdown, reason: item.reason, evidence: item.match.evidence ?? [] })) }, integrationRender: integration, resources: { maxRssKb: process.resourceUsage().maxRSS, userCpuMicros: process.resourceUsage().userCPUTime, systemCpuMicros: process.resourceUsage().systemCPUTime } };
writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath: join(evidenceDir, 'report.json'), mp4Path: integration.mp4Path, vision: { provider: vision.provider, model: vision.model, available: vision.available, ...(vision.reason ? { reason: vision.reason } : {}) }, realSegments: real.segments.length, syntheticSegments: synthetic.segments.length, semanticEligible: ranked.filter((item) => item.eligible).length, cacheReuse: { real: real.cacheReuse, synthetic: synthetic.cacheReuse } }, null, 2));
