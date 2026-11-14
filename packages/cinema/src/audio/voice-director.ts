import { createHash } from 'node:crypto';
import type { AetheraEvolutionCore } from '../evolution/evolution-core.js';

export type NarrationEmotionIntent =
  | 'hook_energetic'
  | 'analytical'
  | 'nostalgic'
  | 'tension'
  | 'comedy_dry'
  | 'closing_warm';

export type PronunciationCategory =
  | 'pt_br_common'
  | 'anime_character'
  | 'japanese_name'
  | 'game_term'
  | 'acronym'
  | 'foreign';

export type PronunciationScope = 'voice' | 'language' | 'channel' | 'project';

export interface PronunciationDictionaryEntry {
  id: string;
  term: string;
  expectedPronunciation: string;
  /** Safe orthography/accent hint sent ONLY to TTS input; editorial script stays untouched. */
  ttsForm: string;
  category: PronunciationCategory;
  scope: PronunciationScope;
  channelId?: string;
  projectId?: string;
  voiceId?: string;
  language: string;
  approvedByUser: boolean;
  sampleAudioPath?: string;
}

export interface DirectedNarrationSegment {
  segmentId: string;
  order: number;
  editorialText: string;
  ttsInputText: string;
  emotion: NarrationEmotionIntent;
  targetPauseAfterMs: number;
  targetSpeechRateWpm: number;
  emphasisTerms: string[];
  appliedDictionaryIds: string[];
  cacheKey: string;
}

export interface VoiceDirectorPlan {
  voiceId: string;
  language: string;
  expressiveness: number; // 0..1
  baseWpm: number;
  segments: DirectedNarrationSegment[];
}

export interface SynthesizedSegmentProbe {
  segmentId: string;
  editorialText: string;
  wavPath: string;
  durationSec: number;
  peakDb?: number;
  meanVolumeDb?: number;
  silenceBeforeSec?: number;
  silenceAfterSec?: number;
  asrTranscript?: string;
}

export interface AudioQualityFinding {
  segmentId: string;
  kind:
    | 'word_omitted_or_mismatch'
    | 'missing_pause'
    | 'excessive_pause'
    | 'speech_rate_anomaly'
    | 'word_boundary_cut'
    | 'clipping_distortion'
    | 'volume_discontinuity'
    | 'unwanted_repetition';
  severity: 'critical' | 'warning';
  detail: string;
}

export interface AudioQualityGateReport {
  passed: boolean;
  requiresHumanListeningCheck: boolean;
  overallScore: number;
  findings: AudioQualityFinding[];
  failingSegmentIds: string[];
  summary: string;
}

export const DEFAULT_PT_BR_PRONUNCIATION_ENTRIES: ReadonlyArray<PronunciationDictionaryEntry> = [
  {
    id: 'ptbr-cabeca',
    term: 'cabeça',
    expectedPronunciation: 'ca-bê-ça (pronúncia brasileira natural, sem infantilização)',
    ttsForm: 'cabeça',
    category: 'pt_br_common',
    scope: 'language',
    language: 'pt-BR',
    approvedByUser: true,
  },
  {
    id: 'acron-rpg',
    term: 'RPG',
    expectedPronunciation: 'érre-pê-gê',
    ttsForm: 'érre pê gê',
    category: 'acronym',
    scope: 'language',
    language: 'pt-BR',
    approvedByUser: false,
  },
  {
    id: 'acron-fps',
    term: 'FPS',
    expectedPronunciation: 'éfe-pê-ésse',
    ttsForm: 'éfe pê ésse',
    category: 'acronym',
    scope: 'language',
    language: 'pt-BR',
    approvedByUser: false,
  },
];

function detectEmotionIntent(text: string, index: number, total: number): NarrationEmotionIntent {
  if (index === 0) return 'hook_energetic';
  if (index === total - 1) return 'closing_warm';
  if (/\?$/.test(text.trim()) || /\b(segredo|mist[eé]rio|reviravolta|perigo|crise)\b/i.test(text)) {
    return 'tension';
  }
  if (/\b(nostalgia|lembra|inf[aâ]ncia|cl[aá]ssico|anos\s+\d{2,4})\b/i.test(text)) {
    return 'nostalgic';
  }
  if (/\b(ironia|curioso|engra[cç]ado|bizarro)\b/i.test(text)) {
    return 'comedy_dry';
  }
  return 'analytical';
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyPronunciationDictionary(
  editorialText: string,
  entries: readonly PronunciationDictionaryEntry[],
  context: { channelId?: string; projectId?: string; voiceId?: string; language?: string },
): { ttsInputText: string; appliedIds: string[] } {
  let out = editorialText;
  const appliedIds: string[] = [];

  for (const entry of entries) {
    if (!entry.approvedByUser) continue;
    if (entry.scope === 'channel' && entry.channelId && entry.channelId !== context.channelId) continue;
    if (entry.scope === 'project' && entry.projectId && entry.projectId !== context.projectId) continue;
    if (entry.scope === 'voice' && entry.voiceId && entry.voiceId !== context.voiceId) continue;
    if (entry.language && context.language && !context.language.toLowerCase().startsWith(entry.language.slice(0, 2).toLowerCase())) {
      continue;
    }
    const regex = new RegExp(`\\b${escapeRegExp(entry.term)}\\b`, 'gi');
    if (regex.test(out)) {
      if (entry.ttsForm && entry.ttsForm !== entry.term) {
        out = out.replace(regex, entry.ttsForm);
      }
      appliedIds.push(entry.id);
    }
  }

  return { ttsInputText: out, appliedIds };
}

/**
 * Normalizes punctuation and natural pauses for Voice Studio without stripping commas, periods, ?, or !.
 */
export function normalizePunctuationPauses(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1 ')
    .replace(/\s*([.!?])\s*/g, '$1 ')
    .replace(/\.{3}/g, '...')
    .replace(/\s*—\s*/g, ', ')
    .trim();
}

export function preprocessTextForVoiceStudio(
  editorialText: string,
  entries: readonly PronunciationDictionaryEntry[],
  context: { channelId?: string; projectId?: string; voiceId?: string; language?: string },
): { ttsInputText: string; appliedDictionaryIds: string[] } {
  const paused = normalizePunctuationPauses(editorialText);
  const { ttsInputText, appliedIds } = applyPronunciationDictionary(paused, entries, context);
  return { ttsInputText, appliedDictionaryIds: appliedIds };
}

export function buildSegmentCacheKey(input: {
  voiceId: string;
  language: string;
  ttsInputText: string;
  emotion: NarrationEmotionIntent;
  targetSpeechRateWpm: number;
}): string {
  return createHash('sha256')
    .update(`${input.voiceId}|${input.language}|${input.emotion}|${input.targetSpeechRateWpm}|${input.ttsInputText}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * AI Voice Director: segments an EditorialScript into naturally paced, punctuated, emotionally directed blocks
 * ready for Voice Studio synthesis & segment-level incremental caching.
 */
export function directNarrationSegments(input: {
  segments: ReadonlyArray<{ segmentId: string; text: string }>;
  voiceId: string;
  language?: string;
  expressiveness?: number;
  baseWpm?: number;
  dictionary?: readonly PronunciationDictionaryEntry[];
  channelId?: string;
  projectId?: string;
}): VoiceDirectorPlan {
  const language = input.language ?? 'pt-BR';
  const expressiveness = Math.max(0, Math.min(1, input.expressiveness ?? 0.65));
  const baseWpm = Math.max(115, Math.min(185, input.baseWpm ?? 148));
  const dict = input.dictionary ?? DEFAULT_PT_BR_PRONUNCIATION_ENTRIES;

  const directed: DirectedNarrationSegment[] = input.segments.map((seg, idx) => {
    const emotion = detectEmotionIntent(seg.text, idx, input.segments.length);
    const rateDelta =
      emotion === 'hook_energetic' ? 6 : emotion === 'tension' ? -5 : emotion === 'nostalgic' ? -8 : 0;
    const targetSpeechRateWpm = Math.round(baseWpm + rateDelta * expressiveness);
    const endsWithQuestion = /\?\s*$/.test(seg.text);
    const targetPauseAfterMs = endsWithQuestion ? 420 : emotion === 'tension' ? 380 : 280;

    const { ttsInputText, appliedDictionaryIds } = preprocessTextForVoiceStudio(seg.text, dict, {
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      voiceId: input.voiceId,
      language,
    });

    const emphasisTerms = (seg.text.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕ][a-záéíóúâêôãõç]{3,}\b/g) ?? []).slice(0, 5);
    const cacheKey = buildSegmentCacheKey({
      voiceId: input.voiceId,
      language,
      ttsInputText,
      emotion,
      targetSpeechRateWpm,
    });

    return {
      segmentId: seg.segmentId,
      order: idx,
      editorialText: seg.text,
      ttsInputText,
      emotion,
      targetPauseAfterMs,
      targetSpeechRateWpm,
      emphasisTerms,
      appliedDictionaryIds,
      cacheKey,
    };
  });

  return {
    voiceId: input.voiceId,
    language,
    expressiveness,
    baseWpm,
    segments: directed,
  };
}

function normalizeWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

/**
 * Audio Quality Gate: checks script correspondence, speech rate, clipping, boundary cuts,
 * silence pauses, and loudness continuity. Always flags human listening verification for subjective diction.
 */
export function evaluateNarrationAudioQuality(
  probes: readonly SynthesizedSegmentProbe[],
): AudioQualityGateReport {
  const findings: AudioQualityFinding[] = [];
  const failingSet = new Set<string>();

  const volumes = probes.map((p) => p.meanVolumeDb).filter((v): v is number => typeof v === 'number');
  const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : null;

  for (const probe of probes) {
    const expectedWords = normalizeWords(probe.editorialText);
    const wordCount = Math.max(1, expectedWords.length);
    const wpm = probe.durationSec > 0 ? (wordCount / probe.durationSec) * 60 : 0;

    if (probe.durationSec <= 0.15 || (wordCount >= 4 && wpm > 260)) {
      findings.push({
        segmentId: probe.segmentId,
        kind: 'word_boundary_cut',
        severity: 'critical',
        detail: `Duração (${probe.durationSec.toFixed(2)}s) incompatível com ${wordCount} palavras (possível corte de sílabas/palavras).`,
      });
      failingSet.add(probe.segmentId);
    } else if (wpm < 85 && wordCount >= 5) {
      findings.push({
        segmentId: probe.segmentId,
        kind: 'speech_rate_anomaly',
        severity: 'warning',
        detail: `Ritmo muito lento (${Math.round(wpm)} ppm) no segmento ${probe.segmentId}.`,
      });
    }

    if (typeof probe.peakDb === 'number' && probe.peakDb > -0.3) {
      findings.push({
        segmentId: probe.segmentId,
        kind: 'clipping_distortion',
        severity: 'critical',
        detail: `Clipping/distorção detectada (${probe.peakDb.toFixed(1)} dBFS).`,
      });
      failingSet.add(probe.segmentId);
    }

    if (avgVol !== null && typeof probe.meanVolumeDb === 'number' && Math.abs(probe.meanVolumeDb - avgVol) > 6) {
      findings.push({
        segmentId: probe.segmentId,
        kind: 'volume_discontinuity',
        severity: 'warning',
        detail: `Descontinuidade de volume (${probe.meanVolumeDb.toFixed(1)} dB vs média ${avgVol.toFixed(1)} dB).`,
      });
    }

    if (typeof probe.silenceAfterSec === 'number' && probe.silenceAfterSec < 0.05 && expectedWords.length >= 6) {
      findings.push({
        segmentId: probe.segmentId,
        kind: 'missing_pause',
        severity: 'warning',
        detail: `Pausa final ausente (${probe.silenceAfterSec.toFixed(2)}s) após pontuação.`,
      });
    } else if (typeof probe.silenceAfterSec === 'number' && probe.silenceAfterSec > 2.0) {
      findings.push({
        segmentId: probe.segmentId,
        kind: 'excessive_pause',
        severity: 'warning',
        detail: `Pausa excessiva (${probe.silenceAfterSec.toFixed(2)}s) no segmento ${probe.segmentId}.`,
      });
    }

    if (probe.asrTranscript !== undefined) {
      const asrWords = normalizeWords(probe.asrTranscript);
      const matched = expectedWords.filter((w) => asrWords.includes(w));
      const overlap = matched.length / wordCount;
      if (overlap < 0.72) {
        findings.push({
          segmentId: probe.segmentId,
          kind: 'word_omitted_or_mismatch',
          severity: 'critical',
          detail: `Correspondência ASR (${Math.round(overlap * 100)}%) abaixo do mínimo (72%).`,
        });
        failingSet.add(probe.segmentId);
      }
      if (asrWords.length > expectedWords.length * 1.45 && expectedWords.length >= 4) {
        findings.push({
          segmentId: probe.segmentId,
          kind: 'unwanted_repetition',
          severity: 'warning',
          detail: 'Possível repetição indesejada detectada na transcrição ASR.',
        });
      }
    }
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const overallScore = Math.max(0, 100 - criticalCount * 28 - warningCount * 8);

  return {
    passed: criticalCount === 0,
    requiresHumanListeningCheck: true,
    overallScore,
    findings,
    failingSegmentIds: [...failingSet],
    summary:
      criticalCount === 0
        ? `Audio Quality Gate aprovado objetivamente (${overallScore}/100). Recomenda-se audição humana final para naturalidade e dicção.`
        : `Audio Quality Gate bloqueou ${failingSet.size} segmento(s) com falhas críticas (${criticalCount} crítica(s), ${warningCount} alerta(s)).`,
  };
}

export function planTargetedSegmentRegeneration(
  plan: VoiceDirectorPlan,
  failingSegmentIds: readonly string[],
): {
  regenerateSegments: DirectedNarrationSegment[];
  preservedSegments: DirectedNarrationSegment[];
} {
  const failing = new Set(failingSegmentIds);
  return {
    regenerateSegments: plan.segments.filter((s) => failing.has(s.segmentId)),
    preservedSegments: plan.segments.filter((s) => !failing.has(s.segmentId)),
  };
}

export function recordApprovedPronunciationRule(
  evolution: AetheraEvolutionCore,
  input: {
    term: string;
    feedbackNote: string;
    expectedPronunciation: string;
    scope: PronunciationScope;
    voiceId?: string;
    language?: string;
    channelId?: string;
    projectId?: string;
  },
) {
  return evolution.recordMemory({
    techniqueKey: `voice.pronunciation.${input.scope}.${input.term.toLowerCase().replace(/[^a-z0-9]+/gi, '_')}`,
    directorId: 'narration_director',
    kind: 'procedural',
    epistemicLevel: 'validated_rule',
    state: 'validated',
    title: `Pronúncia aprovada (${input.scope}): ${input.term}`,
    content: `${input.feedbackNote} Pronúncia esperada: ${input.expectedPronunciation}.`,
    confidence: 0.92,
    scope: {
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      directorId: 'narration_director',
    },
    evidence: {
      sourceType: 'human_feedback',
      sourceId: input.voiceId ?? input.channelId ?? input.projectId ?? 'voice-director',
      summary: input.feedbackNote,
      recordedAt: new Date().toISOString(),
    },
    tags: [
      'voice_director',
      'audio_rule',
      'pronunciation',
      `scope:${input.scope}`,
      ...(input.language ? [`lang:${input.language}`] : []),
      ...(input.voiceId ? [`voice:${input.voiceId}`] : []),
      ...(input.channelId ? [`channel:${input.channelId}`] : []),
      ...(input.projectId ? [`project:${input.projectId}`] : []),
    ],
  });
}
