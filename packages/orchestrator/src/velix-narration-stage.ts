import { existsSync } from 'node:fs';
import { type VelixStoryboardRepository } from '@neuralbridge/database';
import {
  type NarrationManifest,
  type ProductionQualityCheck,
  type SpokenWord,
  alignWords,
  measurePacingPauses,
  missingWordRuns,
  narrationBlocks,
  narrationManifestSchema,
  NARRATION_PACING_STYLES,
  pacingPauseThresholds,
  paceCorrectionSpeed,
  planSentencePauses,
  speechWpm,
  pacingDirections,
  planDirectedSegments,
  retimeFromAudio,
  type NarrationDirection,
  type VoicePreset,
  storyboardNarration,
  syncScenes,
  textKey,
} from '@neuralbridge/shared';
import { type ProductionStageAdapter } from './velix-production.js';

export interface NarrationLicense { provider: 'reviewed' | 'unknown'; model: 'reviewed' | 'unknown'; voice: 'reviewed' | 'unknown'; output: 'reviewed' | 'unknown'; userConfirmed: boolean }

export interface NarrationStageDeps {
  storyboards: VelixStoryboardRepository;
  /** Checks that the model is installed and the voice exists before any block is spoken. */
  checkVoice(input: { modelId: string; voiceId: string }): Promise<void>;
  /** One TTS request (WAV bytes). A library voice passes `voiceId`; a channel voice separates provider voice attributes from pronunciation instructions. */
  synthesize(input: { text: string; modelId: string; voiceId?: string; language?: string; speed?: number; instruct?: string; instructions?: string; seed?: number; numStep?: number }): Promise<Buffer>;
  probeDurationMs(path: string): Promise<number>;
  /** Joins WAV blocks in order into one WAV without gaps. */
  concat(inputs: string[], output: string): Promise<void>;
  /** The channel voice of the run's project and whether its persistent authorization is valid against the provider's licence now. */
  channelVoice?(input: { projectId: string; presetId: string }): Promise<{ preset: VoicePreset; authorization: { id: string; scope: 'noncommercial' | 'commercial' } | null; valid: boolean; reason: string }>;
  /** Per-scene direction (speed, pause after) set by the person for this run. */
  directions?(runId: string): readonly NarrationDirection[];
  /** Writes `durationMs` of silence in the narration's format, for the pauses asked by the direction. */
  silence?(input: { durationMs: number; output: string }): Promise<void>;
  /** E2: quiet gaps of a spoken block (ms), to find its sentence ends. */
  audioGaps?(path: string): Promise<Array<{ startMs: number; durationMs: number }>>;
  /** E2: copies a block adding silence at the given instants, without touching the spoken audio. */
  insertSilences?(input: { source: string; output: string; insertions: ReadonlyArray<{ atMs: number; durationMs: number }> }): Promise<void>;
}

const licenseReady = (license: unknown): boolean => {
  const value = license as Partial<NarrationLicense> | null;
  return !!value && value.userConfirmed === true && value.provider === 'reviewed' && value.model === 'reviewed' && value.voice === 'reviewed' && value.output === 'reviewed';
};

/** A slower take may read up to 8% faster than the speed change predicts; beyond that words were likely dropped. */
const PACE_TAKE_TOLERANCE = 1.08;

const VOICE_PRONUNCIATION_GUIDANCE = 'português brasileiro natural, preserve acentos e pronuncie números, siglas e nomes com clareza; use pausas indicadas pela pontuação.';

interface DoneBlock { index: number; sceneIds: string[]; key: string; relativePath: string; durationMs: number }

/**
 * The `narration` stage: speaks the latest storyboard in blocks with one model and voice, reuses a block whose text did
 * not change (so editing one scene re-speaks one block), joins the blocks and measures the result with FFprobe.
 */
export function createNarrationStageAdapter(deps: NarrationStageDeps): ProductionStageAdapter {
  return {
    kind: 'narration',
    async run(context) {
      const presetId = typeof context.input['presetId'] === 'string' ? context.input['presetId'] : null;
      // The channel voice: a designed preset under a persistent authorization, checked against the provider's licence now.
      const channel = presetId ? await deps.channelVoice?.({ projectId: context.projectId, presetId }) : null;
      if (presetId && !channel) throw new Error('not_found: voz do canal não encontrada.');
      if (channel && (!channel.valid || !channel.authorization)) throw new Error(`license_required: ${channel.reason}`);
      const preset = channel?.preset ?? null;
      const { modelId: inputModel, voiceId: inputVoice } = context.input as { modelId?: unknown; voiceId?: unknown };
      const modelId = preset ? preset.modelId : typeof inputModel === 'string' ? inputModel : '';
      const voiceId = preset ? `preset:${preset.id}` : typeof inputVoice === 'string' ? inputVoice : '';
      if (!modelId || !voiceId) throw new Error('invalid: escolha o modelo e a voz da narração.');
      if (!preset && !licenseReady(context.input['license'])) throw new Error('license_required: confirme as licenças do aplicativo, modelo, voz e saída antes de narrar.');
      const language = preset ? preset.language : typeof context.input['language'] === 'string' ? context.input['language'] : undefined;
      const speed = typeof context.input['speed'] === 'number' ? context.input['speed'] : preset?.speed;
      const design = preset ? { instruct: preset.design.instruct, instructions: VOICE_PRONUNCIATION_GUIDANCE, seed: preset.design.seed, numStep: preset.design.numStep } : null;
      const latest = deps.storyboards.latest(context.runId);
      if (!latest) throw new Error('invalid: gere o storyboard antes da narração.');
      const blockChars = typeof context.input['blockChars'] === 'number' ? Math.max(500, Math.min(3_500, Math.round(context.input['blockChars']))) : undefined;
      const manualDirections = deps.directions?.(context.runId) ?? [];
      // E2: a pacing style chosen for this production adds the pauses between scenes; what the person set per scene wins.
      const pacingStyle = typeof context.input['pacingStyle'] === 'string' ? context.input['pacingStyle'] : null;
      if (pacingStyle && !(pacingStyle in NARRATION_PACING_STYLES)) throw new Error(`invalid: estilo de cadência desconhecido: ${pacingStyle}.`);
      const pacing = pacingStyle ? NARRATION_PACING_STYLES[pacingStyle as keyof typeof NARRATION_PACING_STYLES] : null;
      const directions = pacing ? pacingDirections(latest.storyboard.scenes, pacing, manualDirections) : manualDirections;
      // Segments end where the speed changes or a pause is asked; each is split in blocks as before.
      const segments = directions.length ? planDirectedSegments(latest.storyboard.scenes, directions, speed ?? 1) : [{ sceneIds: latest.storyboard.scenes.map((scene) => scene.id), speed: speed ?? 1, pauseAfterMs: 0 }];
      if (segments.some((segment) => segment.pauseAfterMs > 0) && !deps.silence) throw new Error('unavailable: pausas da direção exigem o gerador de silêncio.');
      // E2: a pacing style also widens the pauses after sentences inside each block. The block is still spoken whole:
      // speaking sentences apart broke the intonation and level of the voice, so only the quiet gaps grow.
      const sentencePauseMs = pacing?.sentencePauseMs ?? 0;
      if (sentencePauseMs > 0 && (!deps.audioGaps || !deps.insertSilences)) throw new Error('unavailable: o respiro entre frases exige a detecção de silêncio e a inserção de pausas.');
      const blocks = segments.flatMap((segment, segmentIndex) => narrationBlocks(latest.storyboard.scenes.filter((scene) => segment.sceneIds.includes(scene.id)), blockChars).map((block) => ({ ...block, speed: directions.length ? segment.speed : speed, pauseAfterMs: 0, segmentIndex })))
        .map((block, index, all) => ({ ...block, index, pauseAfterMs: all[index + 1]?.segmentIndex !== block.segmentIndex ? segments[block.segmentIndex]?.pauseAfterMs ?? 0 : 0 }));
      const breath = { boundaries: 0, matched: 0, widened: 0 };
      const paceAdjustments: Array<{ sceneIds: string[]; fromSpeed: number; toSpeed: number; wpmBefore: number; wpmAfter: number; kept?: 'original' }> = [];
      const folder = `producoes/${context.runId}/narracao`;
      if (!preset) await deps.checkVoice({ modelId, voiceId });
      const previous = Array.isArray(context.state['blocks']) ? (context.state['blocks'] as DoneBlock[]) : [];
      const done: DoneBlock[] = [];
      for (const block of blocks) {
        if (context.signal.aborted) return undefined;
        // Content-addressed by text and voice settings: the same block said by the same voice is never spoken twice,
        // across restarts and across narration stages of the run; a different voice or speed never reuses it.
        const speak = async (speed: number | undefined, take = 0) => {
          // `take` asks the voice again for the same settings (a new key), used when a take came out wrong.
          const key = textKey(`${modelId}\u0000${voiceId}\u0000${language ?? ''}\u0000${speed ?? ''}\u0000${design ? `${design.instruct}\u0000${design.instructions}\u0000${design.seed}\u0000${design.numStep}\u0000` : ''}${block.text}${take ? `\u0000take:${take}` : ''}`);
          const path = `${folder}/bloco-${key}.wav`;
          if (!existsSync(context.resolvePath(path))) {
            const bytes = await deps.synthesize({ text: block.text, modelId, ...(design ? design : { voiceId }), ...(language ? { language } : {}), ...(speed === undefined ? {} : { speed }) });
            if (!context.signal.aborted) context.writeArtifact({ kind: 'narration-block', relativePath: path, content: bytes, mime: 'audio/wav', metadata: { index: block.index, scenes: block.sceneIds.length, ...(speed === undefined ? {} : { speed }) } });
          }
          return { key, path };
        };
        let { key: audioKey, path: spokenPath } = await speak(block.speed);
        if (context.signal.aborted) return undefined;
        // E1 review: a block the style says is too fast is spoken once more at the speed that brings it to the middle of
        // the range (never below NARRATION_MIN_AUTO_SPEED). A speed the person directed for the scene is never overridden.
        if (pacing && deps.audioGaps && !block.sceneIds.some((id) => manualDirections.some((direction) => direction.sceneId === id && direction.speed !== undefined))) {
          const measure = async (path: string) => speechWpm(block.text, await deps.probeDurationMs(context.resolvePath(path)), await deps.audioGaps?.(context.resolvePath(path)) ?? []);
          const before = await measure(spokenPath);
          const corrected = paceCorrectionSpeed(before, block.speed ?? 1, pacing);
          if (corrected !== null) {
            // A slower take must actually read slower: the voice sometimes drops a sentence (measured on Voz C at 0.9),
            // which shows as a rate above the expected one. Such a take is asked again once, then the original is kept.
            const expected = (before * corrected) / (block.speed ?? 1);
            let accepted: { key: string; path: string; after: number } | null = null;
            let last = before;
            for (let take = 0; take < 2 && !accepted; take++) {
              const slower = await speak(corrected, take);
              if (context.signal.aborted) return undefined;
              last = await measure(slower.path);
              if (last <= expected * PACE_TAKE_TOLERANCE) accepted = { ...slower, after: last };
            }
            paceAdjustments.push({ sceneIds: block.sceneIds, fromSpeed: block.speed ?? 1, toSpeed: corrected, wpmBefore: Math.round(before), wpmAfter: Math.round(accepted?.after ?? last), ...(accepted ? {} : { kept: 'original' as const }) });
            if (accepted) ({ key: audioKey, path: spokenPath } = accepted);
          }
        }
        // The breath version is derived from the spoken block (same key plus the target), so it is reused the same way.
        let relativePath = spokenPath;
        if (sentencePauseMs > 0 && deps.audioGaps && deps.insertSilences) {
          const spokenMs = previous.find((item) => item.relativePath === spokenPath)?.durationMs ?? await deps.probeDurationMs(context.resolvePath(spokenPath));
          const plan = planSentencePauses(block.text, { durationMs: spokenMs, gaps: await deps.audioGaps(context.resolvePath(spokenPath)) }, sentencePauseMs);
          breath.boundaries += plan.boundaries; breath.matched += plan.matched; breath.widened += plan.insertions.length;
          if (plan.insertions.length) {
            // Named by the plan itself: a different plan (new detector or planner) never reuses an old file.
            relativePath = `${folder}/bloco-${audioKey}-respiro-${textKey(JSON.stringify(plan.insertions))}.wav`;
            if (!existsSync(context.resolvePath(relativePath))) await deps.insertSilences({ source: context.resolvePath(spokenPath), output: context.resolvePath(relativePath), insertions: plan.insertions });
          }
        }
        const known = previous.find((item) => item.relativePath === relativePath);
        const durationMs = known?.durationMs ?? await deps.probeDurationMs(context.resolvePath(relativePath));
        if (!known) context.recordFile({ kind: 'narration-block', relativePath, mime: 'audio/wav', metadata: { index: block.index, scenes: block.sceneIds.length } });
        done.push({ index: block.index, sceneIds: block.sceneIds, key: block.key, relativePath, durationMs });
        context.saveState({ blocks: [...previous.filter((item) => !done.some((saved) => saved.relativePath === item.relativePath)), ...done] });
        context.progress(done.length / (blocks.length + 1));
      }
      const narrationKey = textKey(storyboardNarration(latest.storyboard.scenes));
      const relativePath = `${folder}/narracao-${narrationKey}.wav`;
      // Real silence after the scenes the direction asked a pause for; the sync later measures the scenes on this clock.
      const pauses: Array<{ afterSceneId: string; durationMs: number }> = [];
      const inputs: string[] = [];
      for (const item of done) {
        inputs.push(context.resolvePath(item.relativePath));
        const pause = blocks[item.index]?.pauseAfterMs ?? 0;
        if (pause > 0 && deps.silence) {
          const silencePath = `${folder}/pausa-${pause}.wav`;
          if (!existsSync(context.resolvePath(silencePath))) await deps.silence({ durationMs: pause, output: context.resolvePath(silencePath) });
          inputs.push(context.resolvePath(silencePath));
          pauses.push({ afterSceneId: item.sceneIds.at(-1) ?? '', durationMs: pause });
        }
      }
      await deps.concat(inputs, context.resolvePath(relativePath));
      if (context.signal.aborted) return undefined;
      const durationMs = await deps.probeDurationMs(context.resolvePath(relativePath));
      context.recordFile({ kind: 'narration', relativePath, mime: 'audio/wav', metadata: { durationMs, blocks: done.length } });
      const manifest: NarrationManifest = narrationManifestSchema.parse({ schemaVersion: 1, provider: 'voicestudio', modelId, voiceId, language: language ?? null, speed: speed ?? null, format: 'wav', storyboardVersion: latest.version, narrationKey, blocks: done, relativePath, durationMs, ...(preset && channel?.authorization && design ? { channelVoice: { presetId: preset.id, authorizationId: channel.authorization.id, scope: channel.authorization.scope, instruct: design.instruct, seed: design.seed } } : {}), ...(pauses.length ? { pauses } : {}), ...(pacing ? { pacingStyle: pacing.style } : {}), ...(sentencePauseMs > 0 ? { sentencePauses: { ...breath, durationMs: sentencePauseMs } } : {}), ...(paceAdjustments.length ? { paceAdjustments } : {}) });
      context.writeArtifact({ kind: 'narration-manifest', relativePath: `${folder}/manifesto.json`, content: `${JSON.stringify(manifest, null, 2)}\n`, mime: 'application/json', metadata: { durationMs, blocks: done.length, storyboardVersion: latest.version } });
      context.saveState({ blocks: done });
      context.progress(1);
      return undefined;
    },
  };
}

export interface SyncStageDeps {
  storyboards: VelixStoryboardRepository;
  /** Timed words of the narration file (seconds), from the local transcriber; the audio never leaves the project. */
  transcribe(path: string): Promise<SpokenWord[]>;
  recordQuality(runId: string, stageId: string, checks: ProductionQualityCheck[]): void;
  /** Cuts [fromMs, toMs) of an audio file into a WAV clip; with it, every scene gets its own measured clip. */
  cutAudio?(input: { source: string; fromMs: number; toMs: number; output: string }): Promise<void>;
  probeDurationMs?(path: string): Promise<number>;
}

/** E1 review: a stretch of a scene the voice did not say blocks the render, even when the overall ratio looks fine. */
export function missingSpeechCheck(aligned: ReturnType<typeof alignWords>): ProductionQualityCheck {
  const runs = missingWordRuns(aligned);
  return { id: 'narration-missing-speech', label: 'Nenhum trecho do roteiro ficou sem ser falado', severity: 'blocking', passed: runs.length === 0,
    evidence: runs.length ? runs.map((run) => `cena ${run.sceneId.slice(0, 8)}: "${run.words.join(' ').slice(0, 80)}"`).join('; ') : 'Todas as frases foram reconhecidas na narração.' };
}

/**
 * E2: the pauses the pacing style asked for, measured on the recognized words of the real audio. A warning, not a block:
 * the editorial gate (E1) is what holds the production, and recognizers stretch word ends a little.
 */
export function pacingPauseChecks(pacingStyle: string | undefined, aligned: ReturnType<typeof alignWords>): ProductionQualityCheck[] {
  const pacing = pacingStyle && pacingStyle in NARRATION_PACING_STYLES ? NARRATION_PACING_STYLES[pacingStyle as keyof typeof NARRATION_PACING_STYLES] : null;
  if (!pacing) return [];
  const thresholds = pacingPauseThresholds(pacing);
  const measured = measurePacingPauses(aligned, thresholds);
  const ms = (value: number | null) => (value === null ? 'sem medida' : `${Math.round(value)} ms`);
  return [
    { id: 'narration-sentence-pauses', label: 'Respiro entre frases', severity: 'warning', passed: measured.shortSentenceGaps === 0, evidence: `${measured.shortSentenceGaps} de ${measured.sentenceGaps} pausa(s) entre frases abaixo de ${thresholds.sentenceMs} ms (menor: ${ms(measured.minSentenceMs)}).` },
    { id: 'narration-scene-pauses', label: 'Pausa entre cenas', severity: 'warning', passed: measured.shortSceneGaps === 0, evidence: `${measured.shortSceneGaps} de ${measured.sceneGaps} pausa(s) entre cenas abaixo de ${thresholds.sceneMs} ms (menor: ${ms(measured.minSceneMs)}).` },
  ];
}

/**
 * Each scene's words relative to its own clip. A run of words the recognizer missed shares the time between the words
 * heard around it, in proportion to their length (E3: a caption then appears when its words are said); with nothing heard
 * after it in the scene, a missed word takes the previous word's end.
 */
export function sceneWords(sceneId: string, sceneStartMs: number, aligned: ReturnType<typeof alignWords>): Array<{ w: string; startMs: number; endMs: number }> {
  const words = aligned.filter((word) => word.sceneId === sceneId).map((word) => ({ w: word.word, startMs: word.startMs === null ? null : Math.max(0, word.startMs - sceneStartMs), endMs: word.endMs === null ? null : Math.max(0, word.endMs - sceneStartMs) }));
  const out: Array<{ w: string; startMs: number; endMs: number }> = [];
  let last = 0;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (!word) continue;
    if (word.startMs !== null) {
      const startMs = Math.max(last, word.startMs);
      const endMs = Math.max(startMs, word.endMs ?? startMs);
      out.push({ w: word.w, startMs, endMs });
      last = endMs;
      continue;
    }
    // A run of missed words up to the next heard one shares the time in between.
    let end = index;
    while (end < words.length && words[end]?.startMs === null) end++;
    const run = words.slice(index, end);
    const until = words[end]?.startMs ?? null;
    const span = until === null ? 0 : Math.max(0, until - last);
    const total = run.reduce((sum, item) => sum + item.w.length, 0) || 1;
    let at = last;
    for (const item of run) {
      const share = Math.round((span * item.w.length) / total);
      out.push({ w: item.w, startMs: at, endMs: at + share });
      at += share;
    }
    last = at;
    index = end - 1;
  }
  return out;
}

/**
 * The `sync` stage: transcribes the joined narration, aligns its words to the storyboard and saves a new storyboard
 * version on the real clock, with the timed words and phrases and a report of missing words, long pauses and drift.
 */
export function createSyncStageAdapter(deps: SyncStageDeps): ProductionStageAdapter {
  return {
    kind: 'sync',
    async run(context) {
      const artifact = context.readArtifact('narration-manifest');
      if (!artifact) throw new Error('invalid: gere a narração antes de sincronizar.');
      const manifest = narrationManifestSchema.parse(JSON.parse(artifact.content));
      const latest = deps.storyboards.latest(context.runId);
      if (!latest) throw new Error('invalid: gere o storyboard antes de sincronizar.');
      if (latest.storyboard.timing === 'measured' && latest.storyboard.narrationKey === manifest.narrationKey && context.state['syncedVersion'] === latest.version) { context.progress(1); return undefined; }
      if (textKey(storyboardNarration(latest.storyboard.scenes)) !== manifest.narrationKey) throw new Error('stale: o storyboard mudou o que é falado depois da narração; gere a narração de novo antes de sincronizar.');
      const spoken = await deps.transcribe(context.resolvePath(manifest.relativePath));
      if (context.signal.aborted) return undefined;
      if (!spoken.length) throw new Error('A transcrição não encontrou fala na narração.');
      const aligned = alignWords(latest.storyboard.scenes, spoken);
      const synced = syncScenes(latest.storyboard.scenes, aligned, spoken, manifest.durationMs);
      const { phrases, report } = synced;
      let scenes = synced.scenes;
      // One measured clip per scene: moving or splitting a scene later keeps the real clock without speaking again.
      if (deps.cutAudio && deps.probeDurationMs) {
        const source = context.resolvePath(manifest.relativePath);
        const clipped = [];
        for (const scene of scenes) {
          if (context.signal.aborted) return undefined;
          const key = textKey(`${manifest.narrationKey}|${scene.startMs}|${scene.endMs}`);
          const relativePath = `producoes/${context.runId}/narracao/cenas/${key}.wav`;
          const output = context.resolvePath(relativePath);
          if (!existsSync(output)) await deps.cutAudio({ source, fromMs: scene.startMs, toMs: scene.endMs, output });
          const durationMs = await deps.probeDurationMs(output);
          context.recordFile({ kind: 'narration-clip', relativePath, mime: 'audio/wav', metadata: { sceneId: scene.id, durationMs } });
          clipped.push({ ...scene, audio: { relativePath, durationMs, key, words: sceneWords(scene.id, scene.startMs, aligned) } });
        }
        scenes = retimeFromAudio(clipped) ?? clipped;
      }
      const saved = deps.storyboards.save({ runId: context.runId, storyboard: { ...latest.storyboard, scenes, timing: 'measured', narrationKey: manifest.narrationKey }, source: 'sync', baseVersion: latest.version });
      context.saveState({ syncedVersion: saved.version });
      context.writeArtifact({ kind: 'sync-timeline', relativePath: `producoes/${context.runId}/sincronizacao/timeline-v${String(saved.version).padStart(3, '0')}.json`, content: `${JSON.stringify({ schemaVersion: 1, storyboardVersion: saved.version, narration: manifest.relativePath, durationMs: manifest.durationMs, words: aligned, phrases, report }, null, 2)}\n`, mime: 'application/json', metadata: { storyboardVersion: saved.version, ratio: report.ratio, issues: report.issues.length } });
      deps.recordQuality(context.runId, context.stageId, [
        { id: 'narration-sync', label: 'Narração reconhecida e cenas no tempo real', severity: 'blocking', passed: !report.blocking, evidence: `${report.matched} de ${report.expected} palavras reconhecidas (${Math.round(report.ratio * 100)}%).` },
        { id: 'narration-pauses', label: 'Pausas longas na narração', severity: 'warning', passed: report.pauses.length === 0, evidence: `${report.pauses.length} pausa(s) acima do limite.` },
        { id: 'scene-deviation', label: 'Cenas muito diferentes da estimativa', severity: 'info', passed: report.deviations.length === 0, evidence: `${report.deviations.length} cena(s) com desvio.` },
        ...pacingPauseChecks(manifest.pacingStyle, aligned),
        missingSpeechCheck(aligned),
      ]);
      context.progress(1);
      return undefined;
    },
  };
}
