import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CodexCliAdapter } from '@neuralbridge/agents';
import { rankMediaSegments, VIDEO_FORMATS, type MediaSegment, type MediaSegmentCandidate, type StoryboardScene, type SubjectIdentity, type VisionPolicy } from '../packages/shared/src/index.js';
import { createAgentAdapterVisionProvider } from '../packages/orchestrator/src/aethera/vision-providers.js';
import { VisionRouter } from '../packages/orchestrator/src/aethera/vision-router.js';

const exec = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '..');
const sourceReportPath = join(repoRoot, 'artifacts', 'aethera-p2-broll-acceptance', '20261117212450', 'report.json');
const sourceIndexPath = join(repoRoot, 'artifacts', 'aethera-p2-broll-acceptance', '20261117212450', 'cyberpunk-2077-broll-index.json');
const sourceReport = JSON.parse(readFileSync(sourceReportPath, 'utf8')) as { realCyberpunk: { segments: Array<{ keyframes: Array<{ atMs: number; relativePath: string }>; evidence: Array<{ atMs: number; observed: string }> }> }; integrationRender: { mp4Path: string } };
const sourceIndex = JSON.parse(readFileSync(sourceIndexPath, 'utf8')) as { segments: MediaSegment[] };
const sourceSegment = sourceIndex.segments[0];
const sourceEvidence = sourceReport.realCyberpunk.segments[0];
if (!sourceSegment || !sourceEvidence) throw new Error('p2.6 source segment missing');

const outputDir = join(repoRoot, 'artifacts', 'aethera-p2.6-semantic-acceptance', new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14));
mkdirSync(outputDir, { recursive: true });
const framePaths = sourceEvidence.keyframes.map((frame) => ({ ...frame, path: join(repoRoot, frame.relativePath) }));
const subject: SubjectIdentity = { schemaVersion: 1, id: 'identity-cyberpunk-p2.6', assetId: 'cyberpunk-2077', segmentId: sourceSegment.id, subjectId: 'cyberpunk-2077', signals: [{ source: 'local-artifact', verdict: 'match', score: 1, evidence: 'Cyberpunk local artifact already used by the P2 benchmark.' }], status: 'verified', calibratedConfidence: 1, verifiedBy: 'rules' };
const candidate: MediaSegmentCandidate = {
  asset: { referenceId: 'cyberpunk-2077', kind: 'video', title: 'Cyberpunk 2077 gameplay', publisher: 'local', url: 'https://local.invalid/cyberpunk', publishedAt: null, rightsStatus: 'verified_allowed', width: 1_280, height: 720, durationSeconds: 2, basis: 'editorial_use' },
  segment: sourceSegment,
  identity: subject,
};
const scenes: Array<{ id: string; label: string; criterion: string; scene: StoryboardScene }> = [
  { id: 'positive', label: 'positive', criterion: 'The visible woman with pink hair and neon street corresponds to the requested visual subject.', scene: { id: 'scene-positive', chapter: null, narration: 'Mostre uma mulher de cabelo rosa em uma rua noturna com neon.', startMs: 0, endMs: 2_000, claimIds: [], visualObjective: 'Mostrar mulher de cabelo rosa em rua neon', sceneType: 'broll', searchTerms: ['mulher', 'cabelo rosa', 'rua', 'neon'], visual: { type: 'none' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' } },
  { id: 'negative', label: 'negative', criterion: 'The requested space battle and spacecraft are not visible in either keyframe.', scene: { id: 'scene-negative', chapter: null, narration: 'Mostre uma batalha espacial com uma nave em órbita.', startMs: 0, endMs: 2_000, claimIds: [], visualObjective: 'Mostrar batalha espacial e nave', sceneType: 'broll', searchTerms: ['batalha espacial', 'nave', 'órbita'], visual: { type: 'none' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' } },
  { id: 'ambiguous', label: 'ambiguous', criterion: 'The frames show a cyberpunk-like scene but do not visibly prove the exact game or character identity; signs are unreadable.', scene: { id: 'scene-ambiguous', chapter: null, narration: 'Identifique com certeza o jogo e o personagem exibidos.', startMs: 0, endMs: 2_000, claimIds: [], visualObjective: 'Provar identidade exata do jogo e personagem', sceneType: 'broll', searchTerms: ['identidade', 'jogo', 'personagem'], visual: { type: 'none' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' } },
];
const ranked = scenes.map(({ id, label, criterion, scene }) => {
  const result = rankMediaSegments(scene, [candidate], { format: VIDEO_FORMATS['youtube-long'], usedReferenceIds: [], usedSegmentIds: [], subjectId: 'cyberpunk-2077', thresholds: { autoAt: 0.95, reviewAt: 0.8 } });
  const item = result[0];
  return { id, label, criterion, frames: sourceEvidence.keyframes, visualEvidence: sourceEvidence.evidence, result: item ? { eligible: item.eligible, reviewRequired: item.reviewRequired, confidence: item.confidence, confidenceBand: item.confidenceBand, score: item.score, breakdown: item.breakdown, reason: item.reason } : null };
});

const codexAdapter = new CodexCliAdapter();
const codexProvider = createAgentAdapterVisionProvider({ id: 'codex', root: repoRoot, adapter: codexAdapter });
const codexHealth = await codexProvider.detect();
let codexInference: Record<string, unknown> = { status: 'not_run', reason: 'Codex não autorizado ou indisponível no health check.' };
if (codexHealth.available) {
  const policy: VisionPolicy = { schemaVersion: 1, task: 'describe', chain: ['codex'], scope: 'project', thresholds: null, version: 'p2.6-codex-real-v1', budgetUsd: 0, maxLatencyMs: 45_000 };
  const cache = new Map<string, unknown>();
  const router = new VisionRouter([codexProvider], { get: (key) => cache.get(JSON.stringify(key)), put: (key, value) => cache.set(JSON.stringify(key), value) }, [], undefined, undefined, undefined, undefined, 1_500, { enabledProviders: ['codex'], priority: ['codex'], perProviderTimeoutMs: { codex: 45_000 }, maxAttempts: 1 });
  const result = await router.analyze({ frames: framePaths.map((frame) => ({ hash: frame.hash, path: frame.path, atMs: frame.atMs })), context: 'Descreva somente o que está visível; não assuma a identidade do jogo.', policy });
  codexInference = { status: result.value ? 'ok' : 'failed', health: codexHealth, provider: result.provider, model: result.model, attempts: result.attempts, evidence: result.value?.frames ?? [], confidence: result.value?.confidence ?? null };
} else {
  codexInference = { ...codexInference, health: { installed: codexHealth.installed, authenticated: codexHealth.authenticated, features: codexHealth.features, problems: codexHealth.problems } };
}

const renderPath = sourceReport.integrationRender.mp4Path;
const renderProbe = JSON.parse((await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', renderPath], { windowsHide: true })).stdout) as { format?: { duration?: string }; streams?: Array<{ codec_name?: string; codec_type?: string }> };
const report = { schemaVersion: 1, phase: 'P2.6', source: { reportPath: sourceReportPath, indexPath: sourceIndexPath, downloadedAgain: false, segmentId: sourceSegment.id, frames: framePaths }, criteria: { thresholds: { autoAt: 0.95, reviewAt: 0.8 }, note: 'Thresholds copied from the P2 acceptance benchmark; no threshold was changed.' }, cases: ranked, codex: codexInference, ffmpeg: { path: renderPath, duration: Number(renderProbe.format?.duration ?? 0), streams: renderProbe.streams ?? [] }, persistedAnalysis: { provider: sourceSegment.analyzedBy.provider, model: sourceSegment.analyzedBy.model, confidence: sourceSegment.analyzedBy.confidence, technicalStatus: sourceSegment.broll?.technicalStatus, semanticStatus: sourceSegment.broll?.semanticStatus, evidence: sourceSegment.broll?.semanticEvidence ?? [], attempts: sourceSegment.analysis?.attempts ?? [] } };
writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath: join(outputDir, 'report.json'), codex: codexInference, cases: ranked.map((item) => ({ label: item.label, eligible: item.result?.eligible, reviewRequired: item.result?.reviewRequired, reason: item.result?.reason })), ffmpeg: report.ffmpeg }, null, 2));
