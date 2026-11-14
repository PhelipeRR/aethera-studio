import type { CaptionCue, NarrationRelevance, RelevanceDecision, SegmentAnalysis } from '@neuralbridge/shared';

/*
 * Aethera Smart Director SD-2 — first automatic audiovisual review of a rendered video. It looks at the real file:
 * frames extracted from each segment, the mix measured by FFmpeg, the captions as exported. Every check says what it
 * measured and what it cannot see. It proposes corrections; the caller applies them as a new version with a bounded number
 * of attempts. It never approves G3: passing these checks is not editorial approval.
 *
 * Known limits (stated in every report): a few frames per segment, not motion; the image–narration judgement comes from
 * a multimodal model and is a recommendation; audio is measured globally plus silences, not listened to.
 */

export type ReviewVerdict = 'pass' | 'warn' | 'fail' | 'not_run';

export interface ReviewSegment {
  segmentId: string; startMs: number; endMs: number;
  /** What the narration says in this segment and what the director wanted on screen. */
  narration: string; wants: string;
  composition: string;
  /** The composition the director chose when the executor fell back (a diagram shown as the continued image): the gap is
   * already known, so a weak image there is reported, not "fixed" by swapping footage. */
  fellBackFrom?: string;
  /** Text the production itself puts on screen in this segment (caption lines, card lines, labels); anything else is foreign. */
  expectedTexts: string[];
}

export interface ReviewCheck { id: string; segmentId: string | null; verdict: ReviewVerdict; evidence: string }
/**
 * `replace_footage` comes only from objective measurements (an empty frame, text of the media on screen) and may be
 * applied automatically. `human_review` comes from the model's judgement of image × narration: SD-2 measured that swapping
 * footage on it made the sample worse (abstract lines like "A pergunta é simples." have no footage that satisfies the
 * judge, and the swap took clean footage away from the cards), so it is shown to a person and never applied by the loop.
 */
export interface ReviewCorrection { segmentId: string; action: 'replace_footage' | 'human_review'; reason: string }
export interface PostRenderReport {
  schemaVersion: 1; checks: ReviewCheck[]; corrections: ReviewCorrection[];
  summary: { pass: number; warn: number; fail: number; notRun: number };
  limitations: string[];
}

export interface PostRenderDeps {
  /** A frame of the rendered video at `atMs`, as a file the analyser may read. */
  extractFrame(atMs: number): Promise<string>;
  /** Mean and spread of the frame's luma (0–1). */
  frameStats(path: string): Promise<{ mean: number; spread: number }>;
  /** Integrated loudness and true peak of the whole file. */
  loudness(): Promise<{ lufs: number; truePeakDb: number }>;
  /** Silences in the audio longer than `minMs`. */
  silences(minMs: number): Promise<Array<{ startMs: number; durationMs: number }>>;
  durationMs(): Promise<number>;
  /** Multimodal analysis of rendered frames (VisionRouter). Absent → the semantic checks are reported as not run. */
  analyze?(paths: readonly string[], atMs: readonly number[]): Promise<SegmentAnalysis | null>;
  /** Text judge of the analysis against the narration (judgeNarrationRelevance). */
  judge?(input: { narration: string; intent: string; analysis: SegmentAnalysis }): Promise<{ judgement: NarrationRelevance | null; decision: RelevanceDecision }>;
}

export interface PostRenderInput {
  segments: readonly ReviewSegment[];
  captions: readonly CaptionCue[];
  /** Word times of the narration (absolute ms), to check that captions start with their words. */
  words: readonly { w: string; startMs: number }[];
  narrationDurationMs: number;
  /** Mix targets of the production (the documentary default: −16 LUFS ± 2, true peak ≤ −1 dBTP). */
  targets?: { lufs: number; lufsTolerance: number; truePeakDb: number; maxSilenceMs: number };
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Text seen in the frame that the production did not put there (a trailer's subtitle, a logo): competes with ours. */
export function foreignTexts(analysis: SegmentAnalysis, expected: readonly string[]): Array<{ text: string; region: string }> {
  const ours = expected.map(fold).filter(Boolean);
  return analysis.frames.flatMap((frame) => frame.visibleText).filter((item) => {
    const seen = fold(item.text);
    if (seen.length < 3) return false;
    // A word of our own text read by the model (captions are often read partially) is ours.
    return !ours.some((text) => text.includes(seen) || seen.includes(text) || seen.split(' ').filter((word) => word.length > 2).every((word) => text.includes(word)));
  }).map((item) => ({ text: item.text, region: item.region }));
}

/** Captions that do not start with their first spoken word (± `toleranceMs`), or overlap the next one. */
export function captionSyncIssues(captions: readonly CaptionCue[], words: readonly { w: string; startMs: number }[], toleranceMs = 120): string[] {
  const issues: string[] = [];
  captions.forEach((cue, index) => {
    const first = fold(cue.lines[0]?.split(' ')[0] ?? '');
    const spoken = words.find((word) => Math.abs(word.startMs - cue.startMs) <= toleranceMs && fold(word.w) === first);
    if (!spoken) issues.push(`legenda ${index + 1} ("${cue.lines.join(' ').slice(0, 40)}") não começa com a fala da palavra "${first}"`);
    const next = captions[index + 1];
    if (next && next.startMs < cue.endMs) issues.push(`legenda ${index + 1} sobrepõe a seguinte`);
  });
  return issues;
}

export async function reviewRender(input: PostRenderInput, deps: PostRenderDeps): Promise<PostRenderReport> {
  const targets = input.targets ?? { lufs: -16, lufsTolerance: 2, truePeakDb: -1, maxSilenceMs: 1_600 };
  const checks: ReviewCheck[] = [];
  const corrections: ReviewCorrection[] = [];
  const add = (check: ReviewCheck) => checks.push(check);

  // Technical, whole file.
  const duration = await deps.durationMs();
  add({ id: 'duration', segmentId: null, verdict: Math.abs(duration - input.narrationDurationMs) <= 150 ? 'pass' : 'fail', evidence: `vídeo ${(duration / 1000).toFixed(2)} s, narração ${(input.narrationDurationMs / 1000).toFixed(2)} s` });
  const mix = await deps.loudness();
  add({ id: 'loudness', segmentId: null, verdict: Math.abs(mix.lufs - targets.lufs) <= targets.lufsTolerance ? 'pass' : 'warn', evidence: `${mix.lufs.toFixed(1)} LUFS (alvo ${targets.lufs} ± ${targets.lufsTolerance})` });
  add({ id: 'true-peak', segmentId: null, verdict: mix.truePeakDb <= targets.truePeakDb ? 'pass' : 'fail', evidence: `pico ${mix.truePeakDb.toFixed(1)} dBTP (máximo ${targets.truePeakDb})` });
  const gaps = (await deps.silences(targets.maxSilenceMs)).filter((silence) => silence.startMs > 300 && silence.startMs + silence.durationMs < duration - 300);
  add({ id: 'audio-continuity', segmentId: null, verdict: gaps.length ? 'warn' : 'pass', evidence: gaps.length ? `${gaps.length} silêncio(s) acima de ${targets.maxSilenceMs} ms no meio da narração: ${gaps.map((gap) => `${(gap.startMs / 1000).toFixed(1)} s`).join(', ')}` : 'sem silêncio longo no meio da narração' });
  const sync = captionSyncIssues(input.captions, input.words);
  add({ id: 'caption-sync', segmentId: null, verdict: sync.length ? 'warn' : 'pass', evidence: sync.length ? sync.slice(0, 4).join('; ') : `${input.captions.length} legendas começam com a palavra falada e não se sobrepõem` });

  // Per segment, on real frames.
  for (const segment of input.segments) {
    const length = segment.endMs - segment.startMs;
    const times = (length > 2_400 ? [0.3, 0.7] : [0.55]).map((share) => Math.round(segment.startMs + length * share));
    const frames = await Promise.all(times.map((atMs) => deps.extractFrame(atMs)));
    const stats = await Promise.all(frames.map((path) => deps.frameStats(path)));
    const empty = stats.some((item) => item.mean < 0.04 || item.spread < 0.02);
    add({ id: 'not-empty', segmentId: segment.segmentId, verdict: empty ? 'fail' : 'pass', evidence: stats.map((item) => `luma ${item.mean.toFixed(2)} ± ${item.spread.toFixed(2)}`).join('; ') });
    if (empty) corrections.push({ segmentId: segment.segmentId, action: 'replace_footage', reason: 'quadro preto ou chapado' });
    if (!deps.analyze) { add({ id: 'image-narration', segmentId: segment.segmentId, verdict: 'not_run', evidence: 'análise multimodal indisponível' }); continue; }
    const analysis = await deps.analyze(frames, times.map((atMs) => atMs - segment.startMs));
    if (!analysis) { add({ id: 'image-narration', segmentId: segment.segmentId, verdict: 'not_run', evidence: 'a análise dos quadros não respondeu' }); continue; }
    const foreign = foreignTexts(analysis, segment.expectedTexts);
    add({ id: 'text-conflict', segmentId: segment.segmentId, verdict: foreign.length ? 'fail' : 'pass', evidence: foreign.length ? `texto da mídia na tela: ${foreign.map((item) => `"${item.text}" (${item.region})`).join(', ')}` : 'só o texto da própria produção' });
    if (foreign.length) corrections.push({ segmentId: segment.segmentId, action: 'replace_footage', reason: `texto da mídia: ${foreign[0]?.text ?? ''}` });
    if (segment.composition === 'typographic_card' || !deps.judge) continue;
    const verdict = await deps.judge({ narration: segment.narration, intent: segment.wants, analysis });
    const decision = verdict.decision.decision;
    const known = decision === 'reject' && segment.fellBackFrom;
    add({ id: 'image-narration', segmentId: segment.segmentId, verdict: decision === 'accept' ? 'pass' : decision === 'review' || known ? 'warn' : 'fail', evidence: `${known ? `lacuna conhecida (${segment.fellBackFrom} não executável) — ` : ''}${verdict.judgement?.verdict ?? 'sem julgamento'}: ${verdict.decision.reason}` });
    if (decision === 'reject' && !known) corrections.push({ segmentId: segment.segmentId, action: 'human_review', reason: verdict.decision.reason });
  }

  const count = (verdict: ReviewVerdict) => checks.filter((check) => check.verdict === verdict).length;
  return {
    schemaVersion: 1, checks, corrections, summary: { pass: count('pass'), warn: count('warn'), fail: count('fail'), notRun: count('not_run') },
    limitations: [
      'Imagem: 1 a 2 quadros por trecho; não avalia movimento, ritmo de corte nem continuidade entre cortes.',
      'Coerência imagem × narração: julgamento de um modelo multimodal sobre esses quadros; é recomendação, não aprovação.',
      'Áudio: loudness integrado, pico e silêncios medidos; o som não é escutado (timbre, ruído, naturalidade da voz).',
      'Nada aqui aprova o G3: a revisão editorial humana assistindo ao vídeo inteiro continua obrigatória.',
    ],
  };
}

/**
 * Bounded correction loop: at most `maxAttempts` versions. Only objective corrections (`replace_footage`) are applied;
 * the loop stops when there is nothing new to apply or a version gets more failures than the best one so far, and the
 * best version (fewest failures, then fewest warnings) is the result — a correction never ships a worse cut.
 */
export async function reviewAndCorrect<T>(input: { maxAttempts: number; render: (attempt: number, exclude: ReadonlySet<string>) => Promise<T>; review: (rendered: T) => Promise<PostRenderReport> }): Promise<{ attempts: Array<{ attempt: number; report: PostRenderReport }>; final: T; finalAttempt: number }> {
  const exclude = new Set<string>();
  const attempts: Array<{ attempt: number; report: PostRenderReport }> = [];
  const score = (report: PostRenderReport) => report.summary.fail * 1_000 + report.summary.warn;
  let best: { attempt: number; rendered: T; score: number } | null = null;
  let rendered = await input.render(1, exclude);
  for (let attempt = 1; ; attempt++) {
    const report = await input.review(rendered);
    attempts.push({ attempt, report });
    const worse = best !== null && report.summary.fail > Math.floor(best.score / 1_000);
    if (!best || score(report) < best.score) best = { attempt, rendered, score: score(report) };
    const fresh = report.corrections.filter((correction) => correction.action === 'replace_footage' && !exclude.has(correction.segmentId));
    if (worse || !fresh.length || attempt >= input.maxAttempts) return { attempts, final: best.rendered, finalAttempt: best.attempt };
    for (const correction of fresh) exclude.add(correction.segmentId);
    rendered = await input.render(attempt + 1, exclude);
  }
}

export interface LocalCutPatch {
  segmentId: string;
  assetId: string;
  proxyPath: string;
  inMs?: number;
  outMs?: number;
}

/**
 * SD-4 local cut correction: patches only the clips belonging to `replace_footage` segments in the timeline,
 * leaving every other segment untouched without replanning the production.
 */
export function applyLocalCutCorrections<T extends { version: number; tracks: Array<{ kind: string; items: Array<{ id: string; sceneIds: string[]; source: Record<string, unknown> }> }> }>(
  timeline: T,
  report: PostRenderReport,
  resolvePatch: (correction: ReviewCorrection) => LocalCutPatch | null,
): { timeline: T; patchedSegmentIds: string[] } {
  const replaceTargets = report.corrections.filter((c) => c.action === 'replace_footage');
  const patches = new Map<string, LocalCutPatch>();
  for (const correction of replaceTargets) {
    const patch = resolvePatch(correction);
    if (patch) patches.set(patch.segmentId, patch);
  }
  if (!patches.size) return { timeline, patchedSegmentIds: [] };

  const patchedSegmentIds = new Set<string>();
  const nextTracks = timeline.tracks.map((track) => {
    if (track.kind !== 'video') return track;
    return {
      ...track,
      items: track.items.map((clip) => {
        const matchedSeg = clip.sceneIds.find((id) => patches.has(id));
        const patch = matchedSeg ? patches.get(matchedSeg) : undefined;
        if (!patch || !matchedSeg || clip.source['kind'] !== 'media') return clip;
        patchedSegmentIds.add(matchedSeg);
        return {
          ...clip,
          source: {
            ...clip.source,
            assetId: patch.assetId,
            proxyPath: patch.proxyPath,
            ...(patch.inMs !== undefined ? { inMs: patch.inMs } : {}),
            ...(patch.outMs !== undefined ? { outMs: patch.outMs } : {}),
          },
        };
      }),
    };
  });

  return {
    timeline: { ...timeline, version: timeline.version + 1, tracks: nextTracks },
    patchedSegmentIds: [...patchedSegmentIds],
  };
}
