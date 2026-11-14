import type { AetheraStudioRepository } from '@neuralbridge/database';
import { normalizeGameTitle, segmentKinds, type IdentitySignal, type MediaSegment, type VerifiedSubject, type VisionPolicy } from '@neuralbridge/shared';
import { detectSegmentCuts, extractSegmentFrames, probeSegmentQuality, segmentsFromCuts, selectVisualAnalysisFfmpeg, windowCuts } from '@neuralbridge/workspace';
import type { ProductionStageAdapter } from '../velix-production.js';
import { runCheckpointedItems } from './item-checkpoint.js';
import { SubjectIdentityVerifier } from './subject-identity-verifier.js';
import { VisionRouter, type VisualAnalysisProvider } from './vision-router.js';
import { visualRenderScheduler } from './visual-work-scheduler.js';

export interface VisualIndexDeps {
  repository: AetheraStudioRepository; providers: readonly VisualAnalysisProvider[]; policy: VisionPolicy;
  projectRoot(projectId: string): string | null;
  asset(projectId: string, assetId: string): { path: string; sha256: string } | null;
  ffmpeg: string; ffmpegCandidates?: readonly string[]; ffprobe?: string;
  /** Optional trusted evidence analyzers. Absence is inconclusive, never fabricated from acquisition identity. */
  identitySignals?(input: { assetId: string; segment: MediaSegment; subject: VerifiedSubject; ocr: readonly string[]; signal: AbortSignal }): Promise<IdentitySignal[]>;
}

export type VisualTitleCandidate = { id: string; title: string; aliases: readonly string[] };

/** Longer titles win over their prefixes; genuinely different titles remain evidence of a compilation. */
export function resolveTitleMentions(text: string, candidates: readonly VisualTitleCandidate[]): VisualTitleCandidate[] {
  const normalizedText = normalizeGameTitle(text);
  const matches: Array<{ candidate: VisualTitleCandidate; title: string; start: number; end: number }> = [];
  for (const candidate of candidates) for (const title of [candidate.title, ...candidate.aliases].map(normalizeGameTitle).filter(Boolean)) {
    let start = normalizedText.indexOf(title);
    while (start >= 0) {
      const end = start + title.length;
      const bounded = (start === 0 || normalizedText[start - 1] === ' ') && (end === normalizedText.length || normalizedText[end] === ' ');
      if (bounded) matches.push({ candidate, title, start, end });
      start = normalizedText.indexOf(title, start + 1);
    }
  }
  return candidates.filter((candidate) => matches.some((match) => match.candidate.id === candidate.id && !matches.some((other) => other.candidate.id !== candidate.id && other.title.length > match.title.length && match.start < other.end && other.start < match.end)));
}

/** Visual analysis is an additive production stage. Old runs/stage ordering and approval gates stay unchanged. */
export function createVisualIndexStageAdapter(deps: VisualIndexDeps): ProductionStageAdapter {
  const verifier = new SubjectIdentityVerifier();
  return {
    kind: 'visual_index',
    async run(context) {
      const root = deps.projectRoot(context.projectId);
      if (!root) throw new Error('not_found: video project root.');
      const subjects = deps.repository.listSubjects(context.runId);
      const acquisitions = deps.repository.listAcquisitions(context.runId).filter((job) => job.status === 'done' && job.result);
      if (!acquisitions.length) throw new Error('invalid: acquire media before visual indexing.');
      const analysisFfmpeg = await selectVisualAnalysisFfmpeg(deps.ffmpegCandidates ?? [deps.ffmpeg]);
      let costUsd = typeof context.state['visualCostUsd'] === 'number' ? context.state['visualCostUsd'] : 0;
      const router = new VisionRouter(deps.providers, { get: (key) => deps.repository.visionCache(key), put: (key, value) => deps.repository.saveVisionCache(key, value) }, [], {
        get: () => deps.repository.visionSpend(context.runId),
        add: (_key, amount) => {
          const total = deps.repository.addVisionSpend(context.runId, amount);
          costUsd += amount;
          context.state['visualCostUsd'] = costUsd;
          context.saveState({ ...context.state, visualCostUsd: costUsd });
          return total;
        },
      });
      await visualRenderScheduler.run(async () => {
        await runCheckpointedItems(context, acquisitions, async (job) => {
          const result = job.result;
          if (!result) return { status: 'skipped', reason: 'Acquisition result is missing.' };
          const asset = deps.asset(context.projectId, result.assetId);
          const provenance = deps.repository.provenance(result.assetId);
          if (!asset || !provenance || provenance.usage === 'blocked') return { status: 'skipped', reason: 'Missing local asset/provenance or blocked media.' };
          if (asset.sha256 !== result.contentHash) throw new Error('invalid: acquired asset hash changed; reacquire before indexing.');
          const cuts = await detectSegmentCuts({ ffmpeg: analysisFfmpeg, root, relativePath: asset.path, durationMs: result.durationMs, signal: context.signal });
          // Windows of at most 20 s inside long uncut spans, so a scene can match a precise moment of a continuous gameplay.
          const base = segmentsFromCuts(result.assetId, windowCuts(cuts), () => ({ frames: 0, meanLuma: 0, meanDiff: 0, black: false, frozen: false, motion: 0 }));
          const segments: MediaSegment[] = [];
          const identities = [];
          const subject = subjects.find((subject) => subject.id === job.subjectId);
          const candidates = deps.repository.listCandidates(context.runId).filter((candidate) => candidate.referenceId === job.referenceId);
          const metadata = candidates.map((candidate) => candidate.title).join('\n');
          const titles = resolveTitleMentions(metadata, subjects);
          const compilation = titles.length > 1 || /\b(top\s*\d+|compilation|showcase|gamescom|game awards|multi.game)\b/i.test(metadata);
          for (const segment of base) {
            context.signal.throwIfAborted();
            const frames = await extractSegmentFrames({ root, relativePath: asset.path, startMs: segment.startMs, endMs: segment.endMs, ffmpeg: analysisFfmpeg, signal: context.signal });
            const request = { frames, policy: deps.policy, budgetKey: context.runId, signal: context.signal };
            const classified = await router.classify({ ...request, labels: segmentKinds });
            const described = await router.describe(request);
            const image = await router.embedImage(request);
            const text = described.value ? await router.embedText({ ...request, texts: [described.value.description] }) : null;
            const ocr = await router.ocr(request);
            const quality = await probeSegmentQuality({ ffmpeg: analysisFfmpeg, root, relativePath: asset.path, startMs: segment.startMs, endMs: segment.endMs, signal: context.signal });
            const capabilities = [['classify', classified], ['describe', described], ['embed_image', image], ['embed_text', text], ['ocr', ocr]] as const;
            const limitations = capabilities.filter(([, value]) => !value || value.provider === null).map(([task]) => `${task}: no available provider`);
            limitations.push('blur/overlayText/watermark not measured; defaults are not clearance.');
            const analyzed: MediaSegment = { ...segment, frameHashes: frames.map((frame) => frame.hash), kind: classified.kind, description: described.value?.description ?? '', tags: described.value?.tags ?? [],
              embeddingRefs: [image, text].flatMap((value) => {
                const provider = value?.provider;
                const model = value?.model;
                return value?.value && provider && model ? value.refs.map((ref) => ({ provider, model, ref })) : [];
              }),
              quality: { ...segment.quality, motion: quality.motion, black: quality.black, frozen: quality.frozen, overlayText: ocr.value?.some((text) => text.trim().length > 0) ?? false },
              analyzedBy: { provider: classified.provider ?? 'ffmpeg-heuristics', model: classified.model ?? 'ffmpeg-signalstats', confidence: classified.confidence },
              analysis: { version: deps.policy.version, band: classified.band, calibratedConfidence: classified.calibratedConfidence, limitations,
                attempts: capabilities.flatMap(([task, value]) => value?.attempts.map((attempt) => ({ task, ...attempt })) ?? []),
              },
            };
            // Cache-vs-call is operational telemetry, not a change in segment content/identity evidence.
            if (analyzed.analysis) analyzed.analysis.attempts = analyzed.analysis.attempts.map((attempt) => ({ ...attempt, outcome: attempt.outcome === 'cached' ? 'ok' : attempt.outcome }));
            segments.push(analyzed);
            if (subject) {
              const signals: IdentitySignal[] = [];
              if (provenance.official) signals.push({ source: 'provenance', verdict: 'match', score: 0.9, evidence: provenance.url });
              if (metadata) signals.push({ source: 'metadata_text', verdict: titles.some((title) => title.id === subject.id) && !compilation ? 'match' : 'inconclusive', score: 0.8, evidence: metadata });
              for (const text of ocr.value ?? []) if (text.trim()) {
                const matching = resolveTitleMentions(text, subjects);
                signals.push({ source: 'ocr', verdict: matching.some((candidate) => candidate.id !== subject.id) ? 'mismatch' : matching.some((candidate) => candidate.id === subject.id) ? 'match' : 'inconclusive', score: 0.95, evidence: text });
              }
              signals.push(...await deps.identitySignals?.({ assetId: result.assetId, segment: analyzed, subject, ocr: ocr.value ?? [], signal: context.signal }) ?? []);
              identities.push(verifier.verify({ assetId: result.assetId, segmentId: analyzed.id, subjectId: subject.id, compilation, signals }));
            }
          }
          deps.repository.replaceSegments(result.assetId, segments);
          for (const identity of identities) {
            const previous = deps.repository.listIdentities(identity.subjectId).filter((item) => item.segmentId === identity.segmentId).at(-1);
            if (!previous || JSON.stringify({ ...previous, id: '' }) !== JSON.stringify({ ...identity, id: '' })) deps.repository.recordIdentity(identity);
          }
          return { status: 'done', result: { assetId: result.assetId, segments: segments.length } };
        });
      }, context.signal);
      context.writeArtifact({ kind: 'visual-index', relativePath: `producoes/${context.runId}/visual-index/${context.stageId}.json`, content: JSON.stringify({ schemaVersion: 1, policy: deps.policy, items: context.state['items'], limitations: ['Real B-1 benchmark pending. Unavailable providers are explicit in each segment.'] }), mime: 'application/json' });
      return { actualCostUsd: costUsd };
    },
  };
}
