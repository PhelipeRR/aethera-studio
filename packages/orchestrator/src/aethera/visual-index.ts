import type { AetheraStudioRepository } from '@neuralbridge/database';
import { normalizeGameTitle, segmentKinds, type IdentitySignal, type MediaSegment, type VerifiedSubject, type VisionPolicy } from '@neuralbridge/shared';
import { BROLL_INDEX_VERSION, canReuseBrollIndex, classifyBrollSemanticDecision, classifyTemporalSamples, detectSegmentCuts, discardFlashKeyframeTimes, extractSegmentFrames, makeBrollContactSheet, probeSegmentQuality, probeSegmentTemporalSamples, resumableBrollSegments, segmentsFromCuts, selectVisualAnalysisFfmpeg, stableBrollSegmentId, validateBrollContinuity, windowCuts } from '@neuralbridge/workspace';
import { join, relative } from 'node:path';
import type { ProductionStageAdapter } from '../velix-production.js';
import { runCheckpointedItems } from './item-checkpoint.js';
import { SubjectIdentityVerifier } from './subject-identity-verifier.js';
import { VisionRouter, type VisualAnalysisProvider, type VisionRouterConfig } from './vision-router.js';
import { visualRenderScheduler } from './visual-work-scheduler.js';

export interface VisualIndexDeps {
  repository: AetheraStudioRepository; providers: readonly VisualAnalysisProvider[] | ((projectId: string) => readonly VisualAnalysisProvider[]); policy: VisionPolicy;
  visionConfig?: VisionRouterConfig;
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
      const providers = typeof deps.providers === 'function' ? deps.providers(context.projectId) : deps.providers;
      const router = new VisionRouter(providers, { get: (key) => deps.repository.visionCache(key), put: (key, value) => deps.repository.saveVisionCache(key, value) }, [], {
        get: () => deps.repository.visionSpend(context.runId),
        add: (_key, amount) => {
          const total = deps.repository.addVisionSpend(context.runId, amount);
          costUsd += amount;
          context.state['visualCostUsd'] = costUsd;
          context.saveState({ ...context.state, visualCostUsd: costUsd });
          return total;
        },
      }, undefined, undefined, undefined, undefined, deps.visionConfig);
      await visualRenderScheduler.run(async () => {
        await runCheckpointedItems(context, acquisitions, async (job) => {
          const result = job.result;
          if (!result) return { status: 'skipped', reason: 'media_unavailable: acquisition result is missing.', decisionStatus: 'media_unavailable', diagnostics: ['acquisition_result_missing'] };
          const asset = deps.asset(context.projectId, result.assetId);
          const provenance = deps.repository.provenance(result.assetId);
          if (!asset) return { status: 'skipped', reason: 'media_unavailable: local asset is absent.', decisionStatus: 'media_unavailable', diagnostics: [`asset_id=${result.assetId}`] };
          if (!provenance) return { status: 'skipped', reason: 'technical_blocked: provenance is absent.', decisionStatus: 'technical_blocked', diagnostics: [`asset_id=${result.assetId}`, 'provenance_missing'] };
          if (provenance.usage === 'blocked') return { status: 'skipped', reason: 'editorial_rejected: media usage is blocked.', decisionStatus: 'editorial_rejected', diagnostics: [`asset_id=${result.assetId}`, 'provenance_usage_blocked'] };
          if (asset.sha256 !== result.contentHash) throw new Error('invalid: acquired asset hash changed; reacquire before indexing.');
          const previousIndex = deps.repository.brollIndex(result.assetId);
          if (previousIndex && canReuseBrollIndex(previousIndex, { sourceHash: asset.sha256, indexVersion: BROLL_INDEX_VERSION }) && previousIndex.segments.length > 0) {
            deps.repository.replaceSegments(result.assetId, previousIndex.segments);
            return { status: 'done', result: { assetId: result.assetId, segments: previousIndex.segments.length, reusedBrollIndex: true } };
          }
          const cuts = await detectSegmentCuts({ ffmpeg: analysisFfmpeg, root, relativePath: asset.path, durationMs: result.durationMs, signal: context.signal });
          // Windows of at most 20 s inside long uncut spans, so a scene can match a precise moment of a continuous gameplay.
          const base = segmentsFromCuts(result.assetId, windowCuts(cuts), () => ({ frames: 0, meanLuma: 0, meanDiff: 0, black: false, frozen: false, motion: 0 }));
          const segments: MediaSegment[] = [];
          let indexedSegments: MediaSegment[] = [];
          const resumed = previousIndex ? resumableBrollSegments(previousIndex, { sourceHash: asset.sha256, indexVersion: BROLL_INDEX_VERSION }) : new Map<string, MediaSegment>();
          const contactSheetName = stableBrollSegmentId({ sourceHash: asset.sha256, startMs: 0, endMs: Math.max(1, result.durationMs), indexVersion: BROLL_INDEX_VERSION });
          const contactSheetRelativePath = `artifacts/aethera/broll/${contactSheetName}.jpg`;
          deps.repository.saveBrollIndex({ schemaVersion: 1, indexVersion: BROLL_INDEX_VERSION, assetId: result.assetId, sourceHash: asset.sha256, sourcePath: asset.path, durationMs: result.durationMs, cutsSeconds: windowCuts(cuts), contactSheetPath: null, segments: [...resumed.values()], status: 'indexing', diagnostics: resumed.size > 0 ? [`resumed_segments=${resumed.size}`] : [] });
          const identities = [];
          const subject = subjects.find((subject) => subject.id === job.subjectId);
          const candidates = deps.repository.listCandidates(context.runId).filter((candidate) => candidate.referenceId === job.referenceId);
          const metadata = candidates.map((candidate) => candidate.title).join('\n');
          const titles = resolveTitleMentions(metadata, subjects);
          const compilation = titles.length > 1 || /\b(top\s*\d+|compilation|showcase|gamescom|game awards|multi.game)\b/i.test(metadata);
          for (const segment of base) {
            context.signal.throwIfAborted();
            const segmentId = stableBrollSegmentId({ sourceHash: asset.sha256, startMs: segment.startMs, endMs: segment.endMs, indexVersion: BROLL_INDEX_VERSION });
            const resumedSegment = resumed.get(segmentId);
            if (resumedSegment) {
              segments.push(resumedSegment);
              indexedSegments = [...segments];
              continue;
            }
            const frames = await extractSegmentFrames({ root, relativePath: asset.path, startMs: segment.startMs, endMs: segment.endMs, ffmpeg: analysisFfmpeg, signal: context.signal });
            const temporalSamples = await probeSegmentTemporalSamples({ ffmpeg: analysisFfmpeg, root, relativePath: asset.path, startMs: segment.startMs, endMs: segment.endMs, signal: context.signal });
            const temporal = classifyTemporalSamples(temporalSamples);
            const continuity = validateBrollContinuity({ startMs: segment.startMs, endMs: segment.endMs, samples: temporalSamples });
            const safeFrameTimes = discardFlashKeyframeTimes(frames.map((frame) => frame.atMs ?? 0), temporal.flashFrameTimesMs);
            const visionFrames = frames.filter((frame) => safeFrameTimes.includes(frame.atMs));
            const request = { frames: visionFrames, policy: deps.policy, budgetKey: context.runId, signal: context.signal };
            const classified = await router.classify({ ...request, labels: segmentKinds });
            const described = await router.describe(request);
            const image = await router.embedImage(request);
            const text = described.value ? await router.embedText({ ...request, texts: [described.value.description] }) : null;
            const ocr = await router.ocr(request);
            const semantic = await router.analyze({ ...request, context: `Trecho do ativo ${result.assetId}; descreva somente o que está visível.` });
            const quality = await probeSegmentQuality({ ffmpeg: analysisFfmpeg, root, relativePath: asset.path, startMs: segment.startMs, endMs: segment.endMs, signal: context.signal });
            const capabilities = [['classify', classified], ['describe', described], ['embed_image', image], ['embed_text', text], ['ocr', ocr], ['analyze', semantic]] as const;
            const semanticTechnicalBlocked = !semantic.value && semantic.attempts.length > 0 && semantic.attempts.every((attempt) => attempt.outcome === 'unavailable' || attempt.outcome === 'error' || attempt.outcome === 'over_budget');
            const semanticDecision = classifyBrollSemanticDecision({ mediaAvailable: true, technicalBlocked: temporal.technicalStatus === 'technical_blocked' || quality.black || quality.frozen || !continuity.valid || semanticTechnicalBlocked, semanticConfidence: semantic.value?.confidence ?? null, attempts: semantic.attempts });
            const limitations = capabilities.filter(([, value]) => !value || value.provider === null).map(([task]) => `${task}: no available provider`);
            limitations.push('blur/overlayText/watermark not measured; defaults are not clearance.');
            const analyzed: MediaSegment = { ...segment, id: segmentId, frameHashes: visionFrames.map((frame) => frame.hash), kind: classified.kind, description: described.value?.description ?? '', tags: described.value?.tags ?? [],
              embeddingRefs: [image, text].flatMap((value) => {
                const provider = value?.provider;
                const model = value?.model;
                return value?.value && provider && model ? value.refs.map((ref) => ({ provider, model, ref })) : [];
              }),
              quality: { ...segment.quality, motion: quality.motion, black: quality.black, frozen: quality.frozen, overlayText: ocr.value?.some((text) => text.trim().length > 0) ?? false },
              analyzedBy: { provider: classified.provider ?? 'ffmpeg-heuristics', model: classified.model ?? 'ffmpeg-signalstats', confidence: classified.confidence },
              broll: { indexVersion: BROLL_INDEX_VERSION, sourceHash: asset.sha256, keyframes: visionFrames.map((frame, index) => ({ atMs: Math.floor(segment.startMs + ((segment.endMs - segment.startMs) * (index + 0.5)) / visionFrames.length), hash: frame.hash, relativePath: relative(root, frame.path).replaceAll('\\', '/') })), technicalStatus: semanticDecision.technicalStatus, semanticStatus: semanticDecision.semanticStatus, ...(semantic.value ? { semanticEvidence: semantic.value.frames.map((frame) => ({ atMs: frame.atMs, observed: frame.observed })) } : {}), framingScore: semantic.value ? (semantic.value.overlays.burnedText || semantic.value.overlays.watermark ? 0.5 : 1) : 0.5, flashFrameTimesMs: temporal.flashFrameTimesMs, continuity, diagnostics: [`quality_frames=${quality.frames}`, `mean_luma=${quality.meanLuma.toFixed(2)}`, `mean_diff=${quality.meanDiff.toFixed(2)}`, `temporal_samples=${temporalSamples.length}`, `flash_frames=${temporal.flashFrameTimesMs.length}`, `semantic_decision=${semanticDecision.reason}`, ...(continuity.valid ? [] : ['continuity_gap']), ...(semanticTechnicalBlocked ? ['semantic_technical_blocked'] : [])] },
              analysis: { version: deps.policy.version, band: classified.band, calibratedConfidence: classified.calibratedConfidence, limitations,
                attempts: capabilities.flatMap(([task, value]) => value?.attempts.map((attempt) => ({ task, provider: attempt.provider, outcome: attempt.outcome, ...(attempt.detail ? { detail: attempt.detail } : {}) })) ?? []),
              },
            };
            // Cache-vs-call is operational telemetry, not a change in segment content/identity evidence.
            if (analyzed.analysis) analyzed.analysis.attempts = analyzed.analysis.attempts.map((attempt) => ({ ...attempt, outcome: attempt.outcome === 'cached' ? 'ok' : attempt.outcome }));
            segments.push(analyzed);
            indexedSegments = [...segments];
            deps.repository.saveBrollIndex({ schemaVersion: 1, indexVersion: BROLL_INDEX_VERSION, assetId: result.assetId, sourceHash: asset.sha256, sourcePath: asset.path, durationMs: result.durationMs, cutsSeconds: windowCuts(cuts), contactSheetPath: null, segments: indexedSegments, status: 'indexing', diagnostics: [] });
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
          const keyframes = indexedSegments.flatMap((segment) => segment.broll?.keyframes ?? []).map((frame) => ({ path: join(root, frame.relativePath), label: `${frame.atMs}ms` }));
          let contactSheetPath: string | null = null;
          if (keyframes.length > 0) {
            await makeBrollContactSheet({ ffmpeg: analysisFfmpeg, framePaths: keyframes.map((frame) => frame.path), outputPath: join(root, contactSheetRelativePath), labels: keyframes.map((frame) => frame.label) });
            contactSheetPath = contactSheetRelativePath;
          }
          deps.repository.replaceSegments(result.assetId, segments);
          deps.repository.saveBrollIndex({ schemaVersion: 1, indexVersion: BROLL_INDEX_VERSION, assetId: result.assetId, sourceHash: asset.sha256, sourcePath: asset.path, durationMs: result.durationMs, cutsSeconds: windowCuts(cuts), contactSheetPath, segments: indexedSegments, status: indexedSegments.some((segment) => segment.broll?.technicalStatus === 'technical_valid') ? 'complete' : 'technical_blocked', diagnostics: [] });
          for (const identity of identities) {
            const previous = deps.repository.listIdentities(identity.subjectId).filter((item) => item.segmentId === identity.segmentId).at(-1);
            if (!previous || JSON.stringify({ ...previous, id: '' }) !== JSON.stringify({ ...identity, id: '' })) deps.repository.recordIdentity(identity);
          }
          return { status: 'done', result: { assetId: result.assetId, segments: segments.length, reusedBrollIndex: false } };
        });
      }, context.signal);
      context.writeArtifact({ kind: 'visual-index', relativePath: `producoes/${context.runId}/visual-index/${context.stageId}.json`, content: JSON.stringify({ schemaVersion: 1, policy: deps.policy, items: context.state['items'], limitations: ['Real B-1 benchmark pending. Unavailable providers are explicit in each segment.'] }), mime: 'application/json' });
      return { actualCostUsd: costUsd };
    },
  };
}
