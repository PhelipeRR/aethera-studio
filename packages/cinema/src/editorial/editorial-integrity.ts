import type { NarrativeBeat } from '../director/cinematography-director.js';

export type EditorialScriptSource =
  | 'agent'
  | 'user_edited'
  | 'imported'
  | 'deterministic_draft';

export interface EditorialSegment {
  segmentId: string;
  beatId: string;
  stage: NarrativeBeat['stage'];
  title: string;
  spokenText: string;
  estimatedDurationSec: number;
  approved: boolean;
}

export interface EditorialNaturalnessIssue {
  segmentId: string;
  code:
    | 'empty_speech'
    | 'production_jargon'
    | 'bureaucratic_template'
    | 'briefing_leak'
    | 'repetitive_opening';
  detail: string;
}

export interface EditorialAuditReport {
  passed: boolean;
  score: number;
  naturalnessIssues: EditorialNaturalnessIssue[];
  academyRulesEvaluated: string[];
  academyRulesRespected: boolean;
  wordCount: number;
  estimatedNarrationSec: number;
}

export interface EditorialConsistencyReport {
  consistent: boolean;
  scriptSegmentCount: number;
  ttsTextMatchesScript: boolean;
  subtitlesMatchScript: boolean;
  timelineCoverageMatches: boolean;
  scriptWordCount: number;
  ttsWordCount: number;
  subtitleWordCount: number;
  discrepancies: string[];
}

export interface EditorialScript {
  scriptId: string;
  source: EditorialScriptSource;
  providerUsed?: string;
  treatment: string;
  segments: EditorialSegment[];
  fullSpokenText: string;
  academyRulesApplied: string[];
  editorialAudit: EditorialAuditReport;
  createdAt: string;
}

const PRODUCTION_JARGON_RE =
  /\b(decupagem|ducking\s+controlado|rec\.?\s*709|safe-?zone|lower-?third|color\s+grading|aethera\s+studio\s+apresenta(?:ndo)?|controle\s+de\s+qualidade)\b/i;

const BUREAUCRATIC_TEMPLATE_RE =
  /^(?:abertura\s+cinematogr[áa]fica\s+apresentando|contextualiza[çc][ãa]o\s+e\s+promessa\s+do\s+epis[óo]dio|cap[ií]tulo\s+\d+\s+de\s+\d+\s+sobre|ato\s+(?:i|ii|iii|iv|v|vi|1|2|3|4|5|6)\b|desenvolvimento\s+narrativo\s*\(bloco)/i;

const BRIEFING_LEAK_RE = /\b(?:t[ií]tulo|nicho|dura[çc][ãa]o\s+alvo|objetivo)\s*:/i;

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function auditEditorialScript(
  segments: EditorialSegment[],
  academyRulesApplied: string[] = [],
): EditorialAuditReport {
  const naturalnessIssues: EditorialNaturalnessIssue[] = [];
  const openingPrefixes = new Map<string, number>();

  for (const seg of segments) {
    const text = seg.spokenText.trim();
    if (!text) {
      naturalnessIssues.push({
        segmentId: seg.segmentId,
        code: 'empty_speech',
        detail: 'Segmento sem texto narrado.',
      });
      continue;
    }
    if (PRODUCTION_JARGON_RE.test(text)) {
      naturalnessIssues.push({
        segmentId: seg.segmentId,
        code: 'production_jargon',
        detail: 'Texto contém jargão técnico de produção ou assinatura artificial.',
      });
    }
    if (BUREAUCRATIC_TEMPLATE_RE.test(text)) {
      naturalnessIssues.push({
        segmentId: seg.segmentId,
        code: 'bureaucratic_template',
        detail: 'Texto inicia com fórmula burocrática ou estrutural de template.',
      });
    }
    if (BRIEFING_LEAK_RE.test(text)) {
      naturalnessIssues.push({
        segmentId: seg.segmentId,
        code: 'briefing_leak',
        detail: 'Texto repete metadados do briefing (Título:, Nicho:, Duração alvo:).',
      });
    }
    const prefix = normalizeForCompare(text).split(' ').slice(0, 3).join(' ');
    if (prefix.length > 12) {
      openingPrefixes.set(prefix, (openingPrefixes.get(prefix) ?? 0) + 1);
    }
  }

  for (const [prefix, count] of openingPrefixes.entries()) {
    if (count >= 2) {
      naturalnessIssues.push({
        segmentId: segments[0]?.segmentId ?? 'script',
        code: 'repetitive_opening',
        detail: `Abertura repetida ${count}x ("${prefix}...").`,
      });
    }
  }

  const fullText = segments.map((s) => s.spokenText.trim()).filter(Boolean).join(' ');
  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;
  const estimatedNarrationSec = Math.round(wordCount / 2.3);

  const academyRulesRespected = !naturalnessIssues.some(
    (i) => i.code === 'production_jargon' || i.code === 'bureaucratic_template',
  );
  const penalty = Math.min(80, naturalnessIssues.length * 15);
  const score = Math.max(0, 100 - penalty);

  return {
    passed: naturalnessIssues.length === 0 && wordCount > 0,
    score,
    naturalnessIssues,
    academyRulesEvaluated: academyRulesApplied,
    academyRulesRespected,
    wordCount,
    estimatedNarrationSec,
  };
}

export function buildEditorialScript(input: {
  scriptId: string;
  source: EditorialScriptSource;
  providerUsed?: string;
  treatment: string;
  segments: Array<{
    segmentId?: string;
    beatId: string;
    stage: NarrativeBeat['stage'];
    title?: string;
    spokenText: string;
    estimatedDurationSec: number;
    approved?: boolean;
  }>;
  academyRulesApplied?: string[];
}): EditorialScript {
  const academyRulesApplied = input.academyRulesApplied ?? [];
  const segments: EditorialSegment[] = input.segments.map((s, idx) => ({
    segmentId: s.segmentId ?? `seg_${idx + 1}`,
    beatId: s.beatId,
    stage: s.stage,
    title: s.title ?? `Cena ${idx + 1}`,
    spokenText: s.spokenText.trim(),
    estimatedDurationSec: s.estimatedDurationSec,
    approved: s.approved ?? true,
  }));
  const fullSpokenText = segments.map((s) => s.spokenText).filter(Boolean).join(' ');
  const editorialAudit = auditEditorialScript(segments, academyRulesApplied);

  return {
    scriptId: input.scriptId,
    source: input.source,
    ...(input.providerUsed ? { providerUsed: input.providerUsed } : {}),
    treatment: input.treatment,
    segments,
    fullSpokenText,
    academyRulesApplied,
    editorialAudit,
    createdAt: new Date().toISOString(),
  };
}

export function verifyEditorialConsistency(input: {
  editorialScript?: EditorialScript;
  ttsTextSent: string;
  subtitleTexts?: string[];
  timelineClipCount?: number;
}): EditorialConsistencyReport {
  const discrepancies: string[] = [];
  const scriptText = input.editorialScript?.fullSpokenText ?? '';
  const normScript = normalizeForCompare(scriptText);
  const normTts = normalizeForCompare(input.ttsTextSent);
  const scriptWordCount = normScript ? normScript.split(' ').length : 0;
  const ttsWordCount = normTts ? normTts.split(' ').length : 0;

  let ttsTextMatchesScript = false;
  if (!input.editorialScript) {
    discrepancies.push('Pacote sem EditorialScript canônico.');
  } else if (!normTts) {
    discrepancies.push('Texto enviado ao TTS está vazio.');
  } else if (normScript === normTts) {
    ttsTextMatchesScript = true;
  } else if (normScript.startsWith(normTts) && normTts.length >= Math.min(normScript.length, 3500)) {
    // Voice engine character-limit truncation of the canonical script
    ttsTextMatchesScript = true;
  } else {
    discrepancies.push(
      `Texto enviado ao TTS diverge do EditorialScript (${ttsWordCount} palavras vs ${scriptWordCount} palavras).`,
    );
  }

  const subJoined = normalizeForCompare((input.subtitleTexts ?? []).join(' '));
  const subtitleWordCount = subJoined ? subJoined.split(' ').length : 0;
  let subtitlesMatchScript = true;
  if (input.subtitleTexts && input.subtitleTexts.length > 0 && normScript) {
    const firstSubWords = subJoined.split(' ').slice(0, 6).join(' ');
    if (firstSubWords && !normScript.includes(firstSubWords)) {
      subtitlesMatchScript = false;
      discrepancies.push('Legendas geradas não correspondem ao texto do EditorialScript.');
    }
  }

  const scriptSegmentCount = input.editorialScript?.segments.length ?? 0;
  const timelineCoverageMatches =
    input.timelineClipCount === undefined || scriptSegmentCount === 0
      ? true
      : input.timelineClipCount >= Math.min(scriptSegmentCount, 1);
  if (!timelineCoverageMatches) {
    discrepancies.push('Timeline não cobre os segmentos do roteiro.');
  }

  return {
    consistent: discrepancies.length === 0,
    scriptSegmentCount,
    ttsTextMatchesScript,
    subtitlesMatchScript,
    timelineCoverageMatches,
    scriptWordCount,
    ttsWordCount,
    subtitleWordCount,
    discrepancies,
  };
}
