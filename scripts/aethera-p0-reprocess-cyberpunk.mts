import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CodexCliAdapter } from '../packages/agents/src/codex-adapter.js';
import { runAutonomousMediaAcquisition } from '../packages/cinema/src/analysis/resilient-media-sources.js';
import type { DistributedFrameAnalysisResult, VisionVerificationDiagnostics } from '../packages/cinema/src/qc/media-relevance-gate.js';
import { VisionRouter, type VisionCachePort } from '../packages/orchestrator/src/aethera/vision-router.js';
import { createOllamaLocalVlmProvider, createTaskEngineVisionProvider } from '../packages/orchestrator/src/aethera/vision-providers.js';

const jobRoot = process.argv[2] ?? 'C:/Users/Pheli/AppData/Roaming/AetheraStudio/cinema-workspaces/cinema_1794920117328';
const mediaDir = join(jobRoot, 'media');
const checkpointPath = join(mediaDir, '.acquisition-checkpoint.json');
const framesRoot = 'C:/Users/Pheli/AppData/Roaming/AetheraStudio/cinema-temp/relevance-frames';

type PendingEntry = [string, {
  segmentId: string;
  cand: { url: string; title?: string; origin?: string; license?: string; durationSec?: number };
  filePath: string;
  fileSizeBytes: number;
  sha256: string;
  durationSec: number;
  mediaId: string;
  round: number;
}];

const parseJson = (text: string): unknown => {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* Codex may wrap strict JSON in a short fence. */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('Codex returned no JSON object.');
};

const frameDirectoryFor = (uri: string): string => join(framesRoot, createHash('sha1').update(uri).digest('hex').slice(0, 12));

const cacheValues = new Map<string, unknown>();
const cache: VisionCachePort = {
  get: (key) => cacheValues.get(JSON.stringify(key)),
  put: (key, value) => { cacheValues.set(JSON.stringify(key), value); },
};
const cooldowns = new Map<string, { untilMs: number; reason: string }>();
const timeoutFailures = new Map<string, number>();
const codex = new CodexCliAdapter();
const codexStatus = await codex.detect({ refresh: true });
if (!codexStatus.installed || codexStatus.authenticated !== true) {
  throw new Error(`Codex visual provider unavailable: ${codexStatus.problems.join('; ') || 'not authenticated'}`);
}

const analyzeFrames = async (uri: string, timestampsSec: number[], segment: { narrationText: string }): Promise<DistributedFrameAnalysisResult> => {
  const frameDir = frameDirectoryFor(uri);
  const framePaths = readdirSync(frameDir)
    .filter((name) => /^frame_\d+_.*\.png$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => join(frameDir, name));
  if (framePaths.length < timestampsSec.length) throw new Error(`Existing frame cache incomplete: ${frameDir}`);
  const frames = framePaths.slice(0, timestampsSec.length).map((path, index) => ({
    path,
    hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
    atMs: Math.round((timestampsSec[index] ?? 0) * 1000),
  }));
  const taskEngine = {
    runStructuredReadOnly: async (input: {
      projectId: string | null;
      agent: 'claude' | 'codex';
      prompt: string;
      outputSchema: object;
      model?: string;
      images?: Array<{ path: string; mime: string }>;
      lean?: { systemPrompt: string };
      signal?: AbortSignal;
    }) => {
      let text = '';
      let sessionId: string | null = null;
      let model: string | null = null;
      const errors: string[] = [];
      for await (const event of codex.run({
        prompt: input.prompt,
        cwd: frameDir,
        mode: 'read-only',
        images: input.images,
        outputSchema: input.outputSchema,
        ...(input.model ? { model: input.model } : {}),
        timeoutMs: 120_000,
      }, input.signal)) {
        if (event.kind === 'session') { sessionId = event.sessionId; model = event.model; }
        if (event.kind === 'error') errors.push(event.message);
        if (event.kind === 'done') {
          text = event.result ?? text;
          if (!event.ok) throw new Error(errors.at(-1) ?? event.errorOutput ?? 'Codex visual run failed.');
        }
      }
      return { taskId: `p0-${basename(uri)}`, agent: 'codex' as const, text, structured: parseJson(text), sessionId, model };
    },
  };
  const provider = createTaskEngineVisionProvider({ id: 'codex', model: '', root: frameDir, projectId: null, enabled: true, taskEngine });
  const localVlm = createOllamaLocalVlmProvider();
  const router = new VisionRouter([localVlm, provider], cache, [], undefined, undefined, cooldowns, timeoutFailures);
  const startedAt = Date.now();
  const route = await router.analyze({
    frames,
    context: `${segment.narrationText} (context only; prove only what is visible)`,
    policy: { schemaVersion: 1, task: 'describe', chain: ['local-vlm', 'codex'], scope: 'project', thresholds: null, version: 'p0-real-cyberpunk-v4', maxLatencyMs: 120_000, budgetUsd: 0 },
  });
  if (!route.value || !route.provider) {
    const error = new Error(`VisionRouter technical_blocked: ${route.attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`).join('; ')}`) as Error & { visionDiagnostics?: VisionVerificationDiagnostics };
    error.visionDiagnostics = { status: 'technical_blocked', provider: route.provider, model: route.model, attempts: route.attempts, durationMs: Date.now() - startedAt, error: error.message };
    throw error;
  }
  const category = route.value.nature === 'interface' ? 'motion_graphic' : route.value.nature === 'dialogue' || route.value.nature === 'speech' ? 'real_person_camera' : 'gameplay';
  const analyses = frames.map((frame, index) => ({
    timestampSec: (frame.atMs ?? 0) / 1000,
    visualCategory: category as 'gameplay' | 'motion_graphic' | 'real_person_camera',
    detectedEntities: route.value?.entities.map((entity) => entity.name),
    detectedActions: route.value?.actions.map((action) => action.description),
    description: route.value?.frames[index]?.observed ?? route.value?.description,
    confidence: route.value?.confidence ?? 0,
  }));
  const result = analyses as DistributedFrameAnalysisResult;
  result.diagnostics = { status: 'succeeded', provider: route.provider, model: route.model, reportedModel: route.reportedModel, attempts: route.attempts, durationMs: Date.now() - startedAt };
  return result;
};

const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as { pendingVerificationEntries?: PendingEntry[] };
const pending = (checkpoint.pendingVerificationEntries ?? []).map(([, entry]) => entry).filter((entry) => existsSync(entry.filePath));
const uniqueSegments = [...new Map(pending.map((entry) => [entry.segmentId, entry])).values()].map((entry) => ({
  segmentId: entry.segmentId,
  subject: 'Cyberpunk 2077',
  narrationText: `Cyberpunk 2077: ${entry.cand.title ?? 'gameplay real do jogo'}.`,
  entities: ['Cyberpunk 2077'],
  expectedDurationSec: entry.durationSec,
  preferredQueries: ['Cyberpunk 2077 gameplay'],
}));
const before = new Map(pending.map((entry) => [entry.filePath, statSync(entry.filePath).size]));
let searchCalls = 0;
let downloadCalls = 0;
const report = await runAutonomousMediaAcquisition({
  projectId: 'cinema_1794920117328',
  prompt: 'A evolução dos games: do pixel ao realismo, com evidência visual real de Cyberpunk 2077.',
  genre: 'gameplay_essay',
  segments: uniqueSegments,
  mediaDir,
  checkpointPath,
  stageMode: 'verify_pending_only',
  requireVisualVerification: true,
  analyzeFrames,
  deps: {
    ytDlpSearchFn: async () => { searchCalls += 1; return []; },
    ytDlpAcquireFn: async () => { downloadCalls += 1; return null; },
  },
  limits: { maxRounds: 1, maxDurationMs: 1_200_000, verificationConcurrency: 1, discoveryConcurrency: 1, acquisitionConcurrency: 1 },
});
const missingAfterRun = pending.filter((entry) => !existsSync(entry.filePath)).map((entry) => entry.filePath);
const unchanged = missingAfterRun.length === 0 && pending.every((entry) => statSync(entry.filePath).size === before.get(entry.filePath));
console.log(JSON.stringify({
  jobRoot,
  provider: { codex: { installed: codexStatus.installed, version: codexStatus.version, authenticated: codexStatus.authenticated }, ollama: 'probed per call by VisionRouter' },
  submittedMedia: pending.map((entry) => ({ mediaId: entry.mediaId, segmentId: entry.segmentId, file: entry.filePath })),
  reusedExistingFiles: unchanged,
  missingExistingFilesAfterRun: missingAfterRun,
  searchCalls,
  downloadCalls,
  approvedForAssemblyCount: report.approvedForAssemblyCount,
  pendingVerificationCount: report.funnelMetrics.pendingVerificationCount,
  visionDiagnostics: report.funnelMetrics.visionDiagnostics,
  sceneDiagnostics: report.sceneDiagnostics,
  mediaResults: report.mediaApprovals.map((approval) => ({ mediaId: approval.mediaId, segmentId: approval.sceneId, visualVerificationStatus: approval.visualVerificationStatus, literalStatus: approval.literalCorrespondence.status, editorialRole: approval.editorialRole })),
  resumedFromCheckpoint: report.budgetBreakdown?.resumedFromCheckpoint,
}, null, 2));
