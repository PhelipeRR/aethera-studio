import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { type VelixClaimRepository, type VelixProductionRepository, type VelixStoryboardRepository } from '@neuralbridge/database';
import {
  avoidableFlatBackgroundSceneIds,
  type LocalMedia,
  type AetheraAudioPlan,
  type MotionBackgroundUse,
  gatePassedFromQualityChecks,
  gatesSatisfied,
  type QualityDirectorSignals,
  type ProductionQualityCheck,
  type ProductionRendersView,
  type RenderGates,
  qualityDirectorSignalsSchema,
  type RenderManifest,
  type RightsStatus,
  type TimedPhrase,
  type VideoFormat,
  type VideoProbe,
  VIDEO_FORMATS,
  captionStyle,
  compositionPlan,
  narrationManifestSchema,
  productionBriefSchema,
  qualityChecks,
  qualityExportable,
  renderManifestSchema,
  segmentKey,
  selectMotionBackgroundCandidates,
  subtitlesSrt,
  validateStoryboard,
  splitSentences,
  type StoryboardScene,
  type MotionProject,
  type MediaUse,
  type TimelineDocument,
  editorialGate,
  editorialReportMarkdown,
  captionCuesSrt,
  sceneCaptionCues,
  timelineCaptionCues,
  splitSceneIntoShots,
  type EditorialShot,
  type SceneWords,
  type NarrationPacing,
  NARRATION_PACING_STYLES,
} from '@neuralbridge/shared';
import { type ProductionStageAdapter, type ProductionStageContext } from './velix-production.js';

export interface RenderStageDeps {
  storyboards: VelixStoryboardRepository;
  claims: VelixClaimRepository;
  production: VelixProductionRepository;
  /** Local files of authorized media (Clip Hunter imports), with the current rights of each. */
  localMedia(projectId: string): LocalMedia[];
  /** Current rights of every media reference the project knows. */
  rights(projectId: string): Map<string, RightsStatus>;
  /** The existing Remotion engine: renders one segment project to an absolute MP4 path. */
  renderMotion(input: { project: MotionProject; output: string; signal: AbortSignal }): Promise<void>;
  /** `startMs`/`endMs` (AP-02) cut the matched range of the source; absent keeps the legacy whole-source behaviour. */
  renderAsset(input: { source: string; kind: 'image' | 'video'; frames: number; format: VideoFormat; output: string; startMs?: number; endMs?: number; signal: AbortSignal }): Promise<{ extendedMs: number } | undefined>;
  /** AP-02: extracts a frame from a local asset already used by the storyboard, without acquiring new media. */
  backgroundFrame?(input: { source: string; kind: 'image' | 'video'; atMs: number; signal: AbortSignal }): Promise<string>;
  /** AP-02: basis of use of acquired media (licence or authorized editorial use), by reference id; never a licence by itself. */
  mediaUse?(projectId: string): Map<string, MediaUse>;
  assemble(input: { segments: string[]; narration: string; narrationDurationMs: number; format: VideoFormat; output: string; subtitles: { path: string; style: string } | null; audioPlan?: AetheraAudioPlan; music?: string; signal: AbortSignal }): Promise<{ captionsBurned: boolean }>;
  probe(path: string): Promise<VideoProbe>;
  silences(path: string): Promise<Array<{ startMs: number; durationMs: number }> | null>;
  engineName(): string;
  /** Credits the Rights Manager requires for the media used. */
  credits(projectId: string, referenceIds: readonly string[]): string[];
  /** Joins scene clips into one narration when the scene order changed after sync (no new TTS or transcription). */
  concatAudio?(inputs: string[], output: string): Promise<void>;
  probeAudioMs?(path: string): Promise<number>;
  /** A derivative has no narration of its own: the parent's manifest is the base its clips are re-joined from. */
  inheritedNarration?(runId: string): RenderManifestNarration | null;
  /** The approved channel identity (colors and name) used on generated scenes. */
  identity?(projectId: string): { accent: string; background: string; name: string | null } | null;
  /** Where a derivative came from, written into its export manifest. */
  origin?(runId: string): Record<string, unknown> | null;
  /** FFmpeg/FFprobe Quality Director measurements; unavailable means the legacy checks remain in force. */
  inspect?(path: string): Promise<QualityDirectorSignals>;
  /** AP-04: the latest persisted Aethera timeline, when this run has one. */
  aetheraTimeline?(runId: string): TimelineDocument | null;
  /** AP-04: renders persisted timeline windows through the same composition used by the Player. */
  renderTimelineSegments?(input: { runId: string; timeline: TimelineDocument; signal: AbortSignal }): Promise<Array<{ index: number; key: string; relativePath: string; reused: boolean; fromMs: number; durationMs: number }>>;
  /** AP-05: builds a validated audio plan from the persisted timeline and local licensed/SFX assets. */
  audioPlan?(input: { runId: string; projectId: string; timeline: TimelineDocument | null; durationMs: number }): Promise<{ plan: AetheraAudioPlan; musicPath?: string; manifest?: Record<string, unknown> } | null>;
  /** Subject verification is read-only input to G2; no automatic promotion of conflicting subjects. */
  subjectVerification?(runId: string): Array<{ id: string; verification: 'confirmed' | 'unconfirmed' | 'conflicting' }>;
  /** Enables versioned G1–G4 records for Aethera runs; legacy Velix renders retain their prior behavior. */
  gates?: boolean | ((runId: string) => boolean);
}

export type RenderManifestNarration = ReturnType<typeof narrationManifestSchema.parse>;

/** Draft previews: a third of the size (even, at least 320 px on the short side), same frame rate and clock. */
export function draftFormat(format: VideoFormat): VideoFormat {
  const scale = Math.max(320 / Math.min(format.width, format.height), 1 / 3);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { ...format, width: even(format.width), height: even(format.height), safeArea: { top: Math.round(format.safeArea.top * scale), right: Math.round(format.safeArea.right * scale), bottom: Math.round(format.safeArea.bottom * scale), left: Math.round(format.safeArea.left * scale) } };
}

/** Timed phrases from each scene's clip words, on the storyboard's clock. */
function clipPhrases(scenes: readonly StoryboardScene[]): TimedPhrase[] {
  return scenes.flatMap((scene) => {
    const words = scene.audio?.words ?? [];
    let offset = 0;
    return splitSentences(scene.narration).map((text) => {
      const count = text.split(/\s+/u).filter(Boolean).length;
      const slice = words.slice(offset, offset + count);
      offset += count;
      const first = slice[0];
      const last = slice.at(-1);
      return { sceneId: scene.id, text, startMs: first ? scene.startMs + first.startMs : null, endMs: last ? scene.startMs + last.endMs : null };
    });
  });
}

/** Checks a person can accept knowingly; format, file, audio, rights and claims can never be waived. */
export const NON_APPROVABLE_CHECKS = new Set(['file', 'resolution', 'aspect', 'audio', 'rights', 'claims']);

const formatFor = (input: Record<string, unknown>, fallback: VideoFormat): VideoFormat => {
  const id = input['formatId'];
  if (typeof id !== 'string' || !(id in VIDEO_FORMATS)) return fallback;
  const { id: formatId, width, height, fps, aspectRatio, safeArea } = VIDEO_FORMATS[id as keyof typeof VIDEO_FORMATS];
  return { id: formatId, width, height, fps, aspectRatio, safeArea };
};

/** Quality control of one rendered MP4 against its format, narration, storyboard, rights, claims and budget. */
export async function renderQuality(deps: RenderStageDeps, input: { runId: string; projectId: string; manifest: RenderManifest; mp4: string; format: VideoFormat; captions: { cues: number; skipped: number; burned: boolean } }): Promise<ProductionQualityCheck[]> {
  const storyboard = deps.storyboards.get(input.runId, input.manifest.storyboardVersion);
  if (!storyboard) throw new Error('not_found: versão do storyboard do render não existe.');
  const rights = deps.rights(input.projectId);
  const probe = existsSync(input.mp4) ? await deps.probe(input.mp4).catch(() => null) : null;
  const unsupported = deps.claims.gate(input.runId).unsupported;
  const budget = deps.production.getBudget(input.runId);
  const sceneMismatches = storyboard.storyboard.scenes.flatMap((scene) => {
    if (!scene.subjectId || scene.visual.type !== 'asset' || !scene.visual.match?.subjectId || scene.visual.match.subjectId === scene.subjectId) return [];
    return [{ sceneId: scene.id, expectedSubjectId: scene.subjectId, observedSubjectId: scene.visual.match.subjectId }];
  });
  const identityUnverified = storyboard.storyboard.scenes.filter((scene) => scene.subjectId && scene.visual.type === 'asset' && !scene.visual.match).map((scene) => scene.id);
  const usedSubjects = new Set(storyboard.storyboard.scenes.flatMap((scene) => scene.subjectId ? [scene.subjectId] : []));
  const unconfirmed = (deps.subjectVerification?.(input.runId) ?? []).filter((subject) => usedSubjects.has(subject.id) && subject.verification !== 'confirmed').map((subject) => subject.id);
  const measured = deps.inspect ? await deps.inspect(input.mp4).catch(() => null) : null;
  const useBasis = deps.mediaUse?.(input.projectId);
  const timeline = deps.aetheraTimeline?.(input.runId) ?? null;
  const flatBackgrounds = timeline ? avoidableFlatBackgroundSceneIds(timeline) : [];
  const hasDirectorSignals = !!measured || sceneMismatches.length > 0 || identityUnverified.length > 0 || unconfirmed.length > 0 || flatBackgrounds.length > 0;
  return qualityChecks({
    format: input.format, probe, narrationDurationMs: input.manifest.narrationDurationMs,
    storyboardIssues: validateStoryboard(storyboard.storyboard, { format: input.format, rights, unsupportedClaimIds: new Set(unsupported.map((claim) => claim.id)), ...(useBasis?.size ? { basis: new Map([...useBasis].map(([id, use]) => [id, use.basis] as const)) } : {}) }),
    unsupportedFacts: unsupported.length, scenes: storyboard.storyboard.scenes, rights, captions: input.captions,
    silences: probe?.hasAudio ? await deps.silences(input.mp4).catch(() => null) : null,
    budget: { limitUsd: budget.limitUsd, consumedUsd: budget.consumedUsd },
    ...(useBasis?.size ? { useBasis } : {}),
    ...(hasDirectorSignals ? { qualityDirector: qualityDirectorSignalsSchema.parse({ ...(measured ?? {}), subjectMismatches: sceneMismatches, identityUnverifiedSceneIds: identityUnverified, unconfirmedSubjectIds: unconfirmed, flatBackgroundSceneIds: flatBackgrounds }) } : {}),
  });
}

/** Records the automatic G1/G2 decisions separately from the human G3/G4 approvals, always for one storyboard version. */
export function recordAutomaticGates(deps: RenderStageDeps, input: { runId: string; stageId: string; version: number; checks: readonly ProductionQualityCheck[] }): void {
  const enabled = typeof deps.gates === 'function' ? deps.gates(input.runId) : deps.gates === true;
  if (!enabled) return;
  for (const gate of ['technical', 'factual'] as const) {
    const passed = gatePassedFromQualityChecks(gate, input.checks);
    deps.production.recordApproval({ runId: input.runId, stageId: input.stageId, gate, version: String(input.version), decision: passed ? 'approved' : 'rejected', note: passed ? 'Quality Director aprovado automaticamente.' : 'Quality Director encontrou bloqueios.' });
  }
}

/**
 * AP-04 E1: generates the editorial pre-check report from the storyboard's measured words and persists it as an
 * artifact. The editorial gate never approves on its own — it produces `ready_for_human` when every check is green,
 * and only a recorded human approval (G3) makes the render exportable. When the timeline is not yet available or
 * the storyboard has no measured words, the gate stays pending without blocking the technical flow.
 */
export function recordEditorialPreCheck(deps: RenderStageDeps, context: ProductionStageContext, input: { runId: string; stageId: string; version: number; pacingStyle?: string }): void {
  const enabled = typeof deps.gates === 'function' ? deps.gates(input.runId) : deps.gates === true;
  if (!enabled) return;
  const latest = deps.storyboards.get(input.runId, input.version);
  if (!latest || latest.storyboard.timing !== 'measured') return;
  const scenesWithWords = latest.storyboard.scenes.filter((scene): scene is typeof scene & { audio: NonNullable<typeof scene.audio> } => !!scene.audio?.words?.length);
  if (!scenesWithWords.length) return;
  const pacing: NarrationPacing = NARRATION_PACING_STYLES[(input.pacingStyle as keyof typeof NARRATION_PACING_STYLES) ?? 'documentary'] ?? NARRATION_PACING_STYLES.documentary;
  const sceneWords: SceneWords[] = scenesWithWords.map((scene) => ({
    id: scene.id,
    startMs: scene.startMs,
    endMs: scene.startMs + (scene.audio?.durationMs ?? 0),
    words: scene.audio?.words?.map((word) => ({ w: word.w, startMs: word.startMs, endMs: word.endMs })) ?? [],
  }));
  const shots = sceneWords.flatMap((scene) => splitSceneIntoShots(scene));
  // E3: the same cues the timeline draws, each scene cued on its own clock and placed on the run's clock.
  const captions = sceneCaptionCues(sceneWords.map((scene) => ({ startMs: scene.startMs, words: scene.words })));
  const editorialShots: EditorialShot[] = shots.map((shot) => ({
    shotId: shot.id, sceneId: shot.sceneId, startMs: shot.startMs, endMs: shot.endMs, narration: shot.text,
    intent: { kind: 'subject_footage', subjectIds: [], natures: [], wants: shot.text.slice(0, 200), onScreenText: null },
    visual: { type: 'none' }, relevance: null, evidence: [], captionPlacement: 'bottom', themeId: 'graphite', humanDecision: null,
  }));
  const gate = editorialGate({
    shots: editorialShots,
    scenes: scenesWithWords.map((scene) => ({ sceneId: scene.id, words: scene.audio?.words?.length ?? 0, speechMs: scene.audio?.durationMs ?? 0 })),
    captions,
    pacing: { minWpm: pacing.targetWpm.min, maxWpm: pacing.targetWpm.max, blockWpm: pacing.targetWpm.block },
    productionThemeId: 'graphite',
  });
  const report = editorialReportMarkdown(gate);
  context.writeArtifact({
    kind: 'editorial-report',
    relativePath: `producoes/${input.runId}/editorial/relatorio-v${String(input.version).padStart(3, '0')}.md`,
    content: `${report}
`,
    mime: 'text/markdown',
    metadata: { status: gate.status, shots: gate.shots.length, checks: gate.checks.length, storyboardVersion: input.version },
  });
}

const timelinePhrases = (context: ProductionStageContext): TimedPhrase[] => {
  const timeline = context.readArtifact('sync-timeline');
  if (!timeline) throw new Error('invalid: sincronize o storyboard com a narração antes de renderizar.');
  const parsed = JSON.parse(timeline.content) as { phrases?: TimedPhrase[] };
  return Array.isArray(parsed.phrases) ? parsed.phrases : [];
};

/**
 * The `render` stage: composes the measured storyboard for one format through the existing engine, reusing every
 * segment whose content did not change, then assembles, writes the captions and runs quality control on the MP4.
 */
export function createRenderStageAdapter(deps: RenderStageDeps): ProductionStageAdapter {
  return {
    kind: 'render',
    async run(context) {
      const draft = context.input['draft'] === true;
      const target = formatFor(context.input, context.brief.format);
      const format = draft ? draftFormat(target) : target;
      const latest = deps.storyboards.latest(context.runId);
      if (!latest) throw new Error('invalid: gere o storyboard antes de renderizar.');
      const narrationFile = context.readArtifact('narration-manifest');
      const inherited = narrationFile ? null : deps.inheritedNarration?.(context.runId) ?? null;
      if (!narrationFile && !inherited) throw new Error('invalid: gere a narração antes de renderizar.');
      let narration = narrationFile ? narrationManifestSchema.parse(JSON.parse(narrationFile.content)) : narrationManifestSchema.parse(inherited);
      let phrasesFromClips: TimedPhrase[] | null = null;
      const clipsReady = latest.storyboard.timing === 'measured' && latest.storyboard.scenes.every((scene) => scene.audio);
      if (latest.storyboard.narrationKey !== narration.narrationKey && clipsReady && latest.storyboard.narrationKey && deps.concatAudio && deps.probeAudioMs) {
        // The scenes were moved or split after sync: the same measured voice, re-joined in the new order.
        const key = latest.storyboard.narrationKey;
        const relativePath = `producoes/${context.runId}/narracao/montada-${key}.wav`;
        const output = context.resolvePath(relativePath);
        if (!existsSync(output)) await deps.concatAudio(latest.storyboard.scenes.map((scene) => context.resolvePath(scene.audio?.relativePath ?? '')), output);
        const durationMs = await deps.probeAudioMs(output);
        context.recordFile({ kind: 'narration', relativePath, mime: 'audio/wav', metadata: { durationMs, source: 'clips', storyboardVersion: latest.version } });
        narration = narrationManifestSchema.parse({ ...narration, storyboardVersion: latest.version, narrationKey: key, relativePath, durationMs, blocks: latest.storyboard.scenes.map((scene, index) => ({ index, sceneIds: [scene.id], key: scene.audio?.key ?? '', relativePath: scene.audio?.relativePath ?? '', durationMs: scene.audio?.durationMs ?? 1 })) });
        context.writeArtifact({ kind: 'narration-manifest', relativePath: `producoes/${context.runId}/narracao/manifesto-montada-${key}.json`, content: `${JSON.stringify(narration, null, 2)}\n`, mime: 'application/json', metadata: { durationMs, source: 'clips', storyboardVersion: latest.version } });
        phrasesFromClips = clipPhrases(latest.storyboard.scenes);
        context.writeArtifact({ kind: 'sync-timeline', relativePath: `producoes/${context.runId}/sincronizacao/timeline-v${String(latest.version).padStart(3, '0')}.json`, content: `${JSON.stringify({ schemaVersion: 1, storyboardVersion: latest.version, narration: relativePath, durationMs, source: 'clips', phrases: phrasesFromClips }, null, 2)}\n`, mime: 'application/json', metadata: { storyboardVersion: latest.version, source: 'clips' } });
      }
      if (latest.storyboard.narrationKey !== narration.narrationKey) throw new Error('stale: o storyboard não está sincronizado com a narração atual; sincronize antes de renderizar.');
      const media = new Map(deps.localMedia(context.projectId).map((item) => [item.referenceId, item]));
      const identity = deps.identity?.(context.projectId) ?? null;
      const motionBackgrounds = new Map<string, MotionBackgroundUse>();
      const persistedTimeline = !draft ? deps.aetheraTimeline?.(context.runId) ?? null : null;
      const timelineMatchesFormat = persistedTimeline ? persistedTimeline.format.width === format.width && persistedTimeline.format.height === format.height && Math.round(persistedTimeline.format.fps) === Math.round(format.fps) : false;
      const timelineSegments = persistedTimeline && timelineMatchesFormat && deps.renderTimelineSegments ? await deps.renderTimelineSegments({ runId: context.runId, timeline: persistedTimeline, signal: context.signal }) : null;
      if (!timelineSegments && deps.backgroundFrame) {
        const candidates = selectMotionBackgroundCandidates(latest.storyboard, media, draft ? 'draft' : 'final');
        const extracted = new Map<string, Promise<string>>();
        for (const [sceneId, candidate] of candidates) {
          const key = `${candidate.referenceId}|${candidate.source?.startMs ?? 0}|${candidate.source?.endMs ?? 0}`;
          let frame = extracted.get(key);
          if (!frame) {
            const atMs = candidate.source ? Math.round((candidate.source.startMs + candidate.source.endMs) / 2) : 0;
            frame = deps.backgroundFrame({ source: context.resolvePath(candidate.media.relativePath), kind: candidate.media.kind, atMs, signal: context.signal });
            extracted.set(key, frame);
          }
          try {
            motionBackgrounds.set(sceneId, { referenceId: candidate.referenceId, assetRef: await frame, ...(candidate.source ? { source: candidate.source } : {}), ...(candidate.basis ? { basis: candidate.basis } : {}) });
          } catch {
            // The non-black gradient in compositionPlan remains the safe visual fallback if frame extraction fails.
          }
        }
      }
      // A draft may show sources still under review (preview_only); the final render never does (AP-02).
      const plan = timelineSegments ? null : compositionPlan(latest.storyboard, format, media, identity, { mode: draft ? 'draft' : 'final', motionBackgrounds });
      if (plan?.issues.length) throw new Error(`invalid: ${plan.issues.map((issue) => issue.message).join(' ')}`);
      const folder = `producoes/${context.runId}/render`;
      const done: RenderManifest['segments'] = [];
      if (timelineSegments && persistedTimeline) {
        for (const segment of timelineSegments) {
          if (context.signal.aborted) return undefined;
          const sceneIds = [...new Set(persistedTimeline.tracks.flatMap((track) => track.items.filter((clip) => clip.startMs < segment.fromMs + segment.durationMs && clip.startMs + clip.durationMs > segment.fromMs).flatMap((clip) => clip.sceneIds)))];
          done.push({ index: segment.index, kind: 'motion', sceneIds, frames: Math.max(1, Math.round(segment.durationMs * format.fps / 1_000)), key: segment.key, relativePath: segment.relativePath, reused: segment.reused });
          context.saveState({ segments: done.map((item) => item.key), timelineVersion: persistedTimeline.version });
          context.progress(done.length / (timelineSegments.length + 2));
        }
      } else {
        for (const segment of plan?.segments ?? []) {
          if (context.signal.aborted) return undefined;
          const key = segmentKey(segment, format);
          const relativePath = `${folder}/segmentos/${key}.mp4`;
          const output = context.resolvePath(relativePath);
          const reused = existsSync(output);
          let extendedMs = 0;
          if (!reused) {
            mkdirSync(dirname(output), { recursive: true });
            if (segment.kind === 'motion') await deps.renderMotion({ project: segment.project, output, signal: context.signal });
            else extendedMs = (await deps.renderAsset({ source: context.resolvePath(segment.media.relativePath), kind: segment.media.kind, frames: segment.frames, format, output, ...(segment.source ? { startMs: segment.source.startMs, endMs: segment.source.endMs } : {}), signal: context.signal }))?.extendedMs ?? 0;
          }
          if (context.signal.aborted) return undefined;
          const backgrounds = segment.kind === 'motion' ? segment.backgrounds?.map((background) => ({ referenceId: background.referenceId, ...(background.source ? { source: background.source } : {}), ...(background.basis ? { basis: background.basis } : {}) })) : undefined;
          done.push({ index: segment.index, kind: segment.kind, sceneIds: segment.sceneIds, frames: segment.frames, key, relativePath, reused, ...(backgrounds?.length ? { backgrounds } : {}), ...(segment.kind === 'asset' && segment.source ? { source: segment.source } : {}), ...(segment.kind === 'asset' && segment.basis ? { basis: segment.basis } : {}), ...(extendedMs > 0 ? { extendedMs } : {}) });
          context.saveState({ segments: done.map((item) => item.key) });
          context.progress(done.length / ((plan?.segments.length ?? 0) + 2));
        }
      }
      const name = `${draft ? 'rascunho-' : ''}${format.id}-v${String(latest.version).padStart(3, '0')}`;
      // E3: a timeline render draws its captions in the composition; the SRT carries those same cues and is not burned
      // again by FFmpeg (one caption on screen, never two).
      // A timeline without measured words draws no captions; the phrases of the sync are then burned as before.
      const drawn = timelineSegments && persistedTimeline ? timelineCaptionCues(persistedTimeline) : [];
      const timelineCaptions = drawn.length ? drawn : null;
      const captions = timelineCaptions ? { srt: captionCuesSrt(timelineCaptions), cues: timelineCaptions.length, skipped: 0 } : subtitlesSrt(phrasesFromClips ?? (clipsReady ? clipPhrases(latest.storyboard.scenes) : timelinePhrases(context)), format);
      const subtitlesRelativePath = `${folder}/${name}.srt`;
      context.writeArtifact({ kind: 'subtitles', relativePath: subtitlesRelativePath, content: `${captions.srt}\n`, mime: 'application/x-subrip', metadata: { cues: captions.cues, skipped: captions.skipped, formatId: format.id } });
      const relativePath = `${folder}/${name}.mp4`;
      const mp4 = context.resolvePath(relativePath);
      const audio = !draft && deps.audioPlan ? await deps.audioPlan({ runId: context.runId, projectId: context.projectId, timeline: persistedTimeline, durationMs: narration.durationMs }) : null;
      if (audio) {
        context.writeArtifact({ kind: 'aethera-audio-plan', relativePath: `${folder}/${name}.audio-plan.json`, content: `${JSON.stringify(audio.plan, null, 2)}\n`, mime: 'application/json', metadata: { timelineId: audio.plan.timelineId, music: audio.plan.music?.kind ?? null, sfx: audio.plan.sfx.length, targetLufs: audio.plan.targetLufs, truePeakDb: audio.plan.truePeakDb } });
        if (audio.manifest) context.writeArtifact({ kind: 'aethera-sfx-manifest', relativePath: `${folder}/${name}.sfx-manifest.json`, content: `${JSON.stringify(audio.manifest, null, 2)}\n`, mime: 'application/json', metadata: { source: 'MotionVelix', assets: Array.isArray(audio.manifest['assets']) ? audio.manifest['assets'].length : 0 } });
      }
      // The timeline composition already drew the captions in the frames.
      const { captionsBurned: burnedByFfmpeg } = await deps.assemble({ segments: done.map((item) => context.resolvePath(item.relativePath)), narration: context.resolvePath(narration.relativePath), narrationDurationMs: narration.durationMs, format, output: mp4, subtitles: captions.cues && !timelineCaptions ? { path: context.resolvePath(subtitlesRelativePath), style: captionStyle(format) } : null, ...(audio ? { audioPlan: audio.plan, ...(audio.musicPath ? { music: audio.musicPath } : {}) } : {}), signal: context.signal });
      if (context.signal.aborted) return undefined;
      const captionsBurned = timelineCaptions ? timelineCaptions.length > 0 : burnedByFfmpeg;
      const mediaReferenceIds = [...new Set([
        ...latest.storyboard.scenes.flatMap((scene) => (scene.visual.type === 'asset' ? [scene.visual.referenceId] : [])),
        ...[...motionBackgrounds.values()].map((background) => background.referenceId),
      ])];
      const uses = deps.mediaUse?.(context.projectId);
      const mediaUse = mediaReferenceIds.flatMap((referenceId) => { const use = uses?.get(referenceId); return use ? [{ referenceId, basis: use.basis, legalClearance: use.legalClearance, publisher: use.publisher, url: use.url }] : []; });
      const manifest: RenderManifest = renderManifestSchema.parse({ schemaVersion: 1, formatId: format.id, width: format.width, height: format.height, fps: format.fps, storyboardVersion: latest.version, narrationKey: narration.narrationKey, narrationRelativePath: narration.relativePath, narrationDurationMs: narration.durationMs, relativePath, subtitlesRelativePath, captionsBurned, segments: done, engine: { remotionTemplate: timelineSegments ? 'aethera-timeline@1' : 'velix-base@1', ffmpeg: deps.engineName() }, mediaReferenceIds, ...(mediaUse.length ? { mediaUse } : {}) });
      if (draft) {
        // A draft is a preview: never quality-checked, never exportable.
        context.recordFile({ kind: 'render-draft', relativePath, mime: 'video/mp4', metadata: { formatId: format.id, storyboardVersion: latest.version, width: format.width, height: format.height, segments: done.length, reused: done.filter((item) => item.reused).length } });
        context.progress(1);
        return undefined;
      }
      context.writeArtifact({ kind: 'render-manifest', relativePath: `${folder}/${name}.json`, content: `${JSON.stringify(manifest, null, 2)}\n`, mime: 'application/json', metadata: { formatId: format.id, storyboardVersion: latest.version } });
      const probe = await deps.probe(mp4).catch(() => null);
      context.recordFile({ kind: 'render', relativePath, mime: 'video/mp4', metadata: { formatId: format.id, storyboardVersion: latest.version, width: probe?.width ?? 0, height: probe?.height ?? 0, durationMs: probe?.durationMs ?? 0, manifest: `${folder}/${name}.json`, cues: captions.cues, skipped: captions.skipped, captionsBurned } });
      const checks = await renderQuality(deps, { runId: context.runId, projectId: context.projectId, manifest, mp4, format, captions: { cues: captions.cues, skipped: captions.skipped, burned: captionsBurned } });
      deps.production.recordQualityReport({ runId: context.runId, stageId: context.stageId, checks });
      recordAutomaticGates(deps, { runId: context.runId, stageId: context.stageId, version: manifest.storyboardVersion, checks });
      recordEditorialPreCheck(deps, context, { runId: context.runId, stageId: context.stageId, version: manifest.storyboardVersion });
      context.progress(1);
      return undefined;
    },
  };
}

type RenderRecord = { artifactId: string; stageId: string; relativePath: string; metadata: Record<string, unknown> };

/** Reads renders, re-checks quality, records approvals and decides exportability; export copies files only when allowed. */
export class RenderService {
  constructor(private readonly deps: RenderStageDeps) {}

  private renders(runId: string): RenderRecord[] {
    return this.deps.production.listArtifacts(runId).filter((item) => item.kind === 'render' && item.relativePath).map((item) => ({ artifactId: item.id, stageId: item.stageId, relativePath: item.relativePath ?? '', metadata: JSON.parse(item.metadata) as Record<string, unknown> }));
  }

  private report(runId: string, stageId: string) {
    const report = this.deps.production.listQualityReports(runId).filter((item) => item.stageId === stageId).at(-1);
    return report ? { ...report, checks: JSON.parse(report.checks) as ProductionQualityCheck[] } : null;
  }

  private gatesEnabled(runId: string): boolean {
    return typeof this.deps.gates === 'function' ? this.deps.gates(runId) : this.deps.gates === true;
  }

  private gateApprovals(runId: string, version: string) {
    return this.deps.production.listApprovals(runId).filter((approval): approval is typeof approval & { gate: 'technical' | 'factual' | 'editorial' | 'publication'; version: string } => approval.version === version && ['technical', 'factual', 'editorial', 'publication'].includes(approval.gate ?? '') && !!approval.gate).map((approval) => ({ gate: approval.gate, version: approval.version, decision: approval.decision as 'approved' | 'rejected' }));
  }

  private gates(runId: string, version: string): RenderGates {
    if (!this.gatesEnabled(runId)) return null;
    const approvals = this.gateApprovals(runId, version);
    const status = (gate: 'technical' | 'factual' | 'editorial' | 'publication'): 'approved' | 'rejected' | 'pending' => {
      const decision = approvals.filter((approval) => approval.gate === gate).at(-1)?.decision;
      return decision === 'approved' || decision === 'rejected' ? decision : 'pending';
    };
    return { version, technical: status('technical'), factual: status('factual'), editorial: status('editorial'), publication: status('publication') };
  }

  view(runId: string): ProductionRendersView {
    const artifacts = this.deps.production.listArtifacts(runId);
    return {
      renders: this.renders(runId).map((render) => {
        const report = this.report(runId, render.stageId);
        const exported = artifacts.filter((item) => item.kind === 'export' && (JSON.parse(item.metadata) as { renderArtifactId?: string }).renderArtifactId === render.artifactId).at(-1)?.relativePath ?? null;
        const storyboardVersion = Number(render.metadata['storyboardVersion'] ?? 0);
        const version = String(storyboardVersion);
        const gates = this.gates(runId, version);
        const exportable = report ? qualityExportable(report.checks) && (!gates || gatesSatisfied('export', this.gateApprovals(runId, version), version).satisfied) : false;
        return { artifactId: render.artifactId, formatId: String(render.metadata['formatId'] ?? ''), relativePath: render.relativePath, storyboardVersion, width: Number(render.metadata['width'] ?? 0), height: Number(render.metadata['height'] ?? 0), durationMs: Number(render.metadata['durationMs'] ?? 0), reportId: report?.id ?? null, exportable, gates, checks: report?.checks ?? [], exported };
      }).reverse(),
    };
  }

  /** Runs quality control again on an existing render (e.g. after rights or evidence changed). */
  async recheck(runId: string, renderArtifactId: string, root: string): Promise<ProductionRendersView> {
    const render = this.renders(runId).find((item) => item.artifactId === renderArtifactId);
    if (!render) throw new Error('not_found: render não encontrado.');
    const run = this.deps.production.getRun(runId);
    if (!run) throw new Error('not_found: produção não encontrada.');
    const manifestPath = String(render.metadata['manifest'] ?? '');
    const manifestArtifact = this.deps.production.listArtifacts(runId).find((item) => item.kind === 'render-manifest' && item.relativePath === manifestPath);
    if (!manifestArtifact) throw new Error('not_found: manifesto do render não encontrado.');
    const manifest = renderManifestSchema.parse(JSON.parse(readFileSync(join(root, manifestPath), 'utf8')));
    const brief = productionBriefSchema.parse(JSON.parse(run.brief));
    const format = formatFor({ formatId: manifest.formatId }, brief.format);
    const checks = await renderQuality(this.deps, { runId, projectId: run.projectId, manifest, mp4: join(root, render.relativePath), format, captions: { cues: Number(render.metadata['cues'] ?? 0), skipped: Number(render.metadata['skipped'] ?? 0), burned: render.metadata['captionsBurned'] === true } });
    this.deps.production.recordQualityReport({ runId, stageId: render.stageId, checks });
    recordAutomaticGates(this.deps, { runId, stageId: render.stageId, version: manifest.storyboardVersion, checks });
    return this.view(runId);
  }

  /** A person accepts one failing check knowingly; the approval is recorded and a new report is computed. */
  approveCheck(runId: string, renderArtifactId: string, checkId: string, note: string): ProductionRendersView {
    const render = this.renders(runId).find((item) => item.artifactId === renderArtifactId);
    if (!render) throw new Error('not_found: render não encontrado.');
    if (NON_APPROVABLE_CHECKS.has(checkId)) throw new Error('forbidden: este item não pode ser dispensado; corrija a causa e renderize de novo.');
    if (!note.trim()) throw new Error('invalid: explique por que aceita este item.');
    const report = this.report(runId, render.stageId);
    const check = report?.checks.find((item) => item.id === checkId);
    if (!report || !check) throw new Error('not_found: verificação não encontrada.');
    if (check.passed) throw new Error('invalid: esta verificação já passou.');
    this.deps.production.recordApproval({ runId, stageId: render.stageId, decision: 'approved', note: `${checkId}: ${note.trim()}` });
    this.deps.production.recordQualityReport({ runId, stageId: render.stageId, checks: report.checks.map((item) => (item.id === checkId ? { ...item, approved: true } : item)) });
    return this.view(runId);
  }

  /** Records the human-only G3/G4 decisions for the exact rendered storyboard version. */
  approveGate(runId: string, renderArtifactId: string, gate: 'editorial' | 'publication', note: string): ProductionRendersView {
    if (!this.gatesEnabled(runId)) throw new Error('unavailable: os gates G1–G4 não estão habilitados para este render.');
    const render = this.renders(runId).find((item) => item.artifactId === renderArtifactId);
    if (!render) throw new Error('not_found: render não encontrado.');
    if (!note.trim()) throw new Error('invalid: explique a decisão do gate.');
    const version = String(render.metadata['storyboardVersion'] ?? '');
    this.deps.production.recordApproval({ runId, stageId: render.stageId, gate, version, decision: 'approved', note: note.trim() });
    return this.view(runId);
  }

  exportable(runId: string, renderArtifactId: string): boolean {
    return this.view(runId).renders.find((item) => item.artifactId === renderArtifactId)?.exportable ?? false;
  }

  publishable(runId: string, renderArtifactId: string): boolean {
    if (!this.gatesEnabled(runId)) return false;
    const render = this.renders(runId).find((item) => item.artifactId === renderArtifactId);
    if (!render) return false;
    const version = String(render.metadata['storyboardVersion'] ?? '');
    const report = this.report(runId, render.stageId);
    return !!report && qualityExportable(report.checks) && gatesSatisfied('publish', this.gateApprovals(runId, version), version).satisfied;
  }
}

/** The `export` stage: copies an exportable render with its captions, credits and a manifest of sources and licenses. */
export function createExportStageAdapter(deps: RenderStageDeps, service: RenderService): ProductionStageAdapter {
  return {
    kind: 'export',
    async run(context) {
      const renderArtifactId = context.input['renderArtifactId'];
      if (typeof renderArtifactId !== 'string') throw new Error('invalid: escolha o render a exportar.');
      if (!service.exportable(context.runId, renderArtifactId)) throw new Error('forbidden: o render tem verificações bloqueantes pendentes; corrija ou aprove antes de exportar.');
      const render = deps.production.getArtifact(renderArtifactId);
      if (!render?.relativePath || render.runId !== context.runId) throw new Error('not_found: render não encontrado.');
      const metadata = JSON.parse(render.metadata) as { formatId?: string; manifest?: string };
      const manifestRelative = metadata.manifest ?? '';
      const manifest = renderManifestSchema.parse(JSON.parse(readFileSync(context.resolvePath(manifestRelative), 'utf8')));
      const folder = `producoes/${context.runId}/exportacao/${manifest.formatId}-v${String(manifest.storyboardVersion).padStart(3, '0')}`;
      const video = `${folder}/${basename(render.relativePath)}`;
      const subtitles = `${folder}/${basename(manifest.subtitlesRelativePath)}`;
      mkdirSync(context.resolvePath(folder), { recursive: true });
      copyFileSync(context.resolvePath(render.relativePath), context.resolvePath(video));
      copyFileSync(context.resolvePath(manifest.subtitlesRelativePath), context.resolvePath(subtitles));
      const rights = deps.rights(context.projectId);
      const credits = deps.credits(context.projectId, manifest.mediaReferenceIds);
      const claims = deps.claims.list(context.runId).map((claim) => ({ text: claim.text, kind: claim.kind, sources: claim.evidence.filter((item) => item.status === 'approved').map((item) => ({ url: item.url, title: item.title, publisher: item.publisher, publishedAt: item.publishedAt })) }));
      const origin = deps.origin?.(context.runId) ?? null;
      const sources = { schemaVersion: 1, ...(origin ? { origin } : {}), renderArtifactId, formatId: manifest.formatId, storyboardVersion: manifest.storyboardVersion, narration: { relativePath: manifest.narrationRelativePath, durationMs: manifest.narrationDurationMs }, media: manifest.mediaReferenceIds.map((id) => ({ referenceId: id, rightsStatus: rights.get(id) ?? 'unverified' })), credits, claims, engine: manifest.engine };
      context.writeArtifact({ kind: 'export', relativePath: `${folder}/fontes-e-licencas.json`, content: `${JSON.stringify(sources, null, 2)}\n`, mime: 'application/json', metadata: { renderArtifactId, formatId: manifest.formatId } });
      if (credits.length) context.writeArtifact({ kind: 'export-credits', relativePath: `${folder}/creditos.txt`, content: `${credits.join('\n')}\n`, mime: 'text/plain', metadata: { renderArtifactId } });
      context.recordFile({ kind: 'export-video', relativePath: video, mime: 'video/mp4', metadata: { renderArtifactId } });
      context.recordFile({ kind: 'export-subtitles', relativePath: subtitles, mime: 'application/x-subrip', metadata: { renderArtifactId } });
      context.progress(1);
      return undefined;
    },
  };
}
