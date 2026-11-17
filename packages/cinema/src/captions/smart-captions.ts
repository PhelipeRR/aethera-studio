import { createHash } from 'node:crypto';

export type SmartCaptionStyle = 'game' | 'anime' | 'geek';

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SmartCaptionInput {
  words: readonly CaptionWord[];
  durationMs: number;
  width: number;
  height: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  style: SmartCaptionStyle;
  keywords?: readonly string[];
  maxWordsPerCue?: number;
  pauseThresholdMs?: number;
  placement?: 'bottom' | 'top';
}

export interface SmartCaptionCue {
  text: string;
  startMs: number;
  endMs: number;
  words: CaptionWord[];
}

export interface SmartCaptionArtifact {
  schemaVersion: 1;
  cacheKey: string;
  style: SmartCaptionStyle;
  cues: SmartCaptionCue[];
  ass: string;
  coverage: { startMs: number; endMs: number; durationMs: number };
}

const styleConfig: Record<SmartCaptionStyle, { font: string; fontSize: number; primary: string; accent: string; outline: string }> = {
  game: { font: 'Aptos Display', fontSize: 56, primary: '&H00FFFFFF', accent: '&H0000D7FF', outline: '&H00100A18' },
  anime: { font: 'Aptos Display', fontSize: 58, primary: '&H00FFFFFF', accent: '&H00FF8AFF', outline: '&H00201038' },
  geek: { font: 'Aptos Display', fontSize: 54, primary: '&H00FFFFFF', accent: '&H00FFD15C', outline: '&H00100F0A' },
};

function assTime(ms: number): string {
  const centiseconds = Math.max(0, Math.round(ms / 10));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}').replaceAll('\r', '').replaceAll('\n', '\\N');
}

function assColor(text: string, keyword: string | undefined, keywords: readonly string[]): string {
  if (!keyword) return text;
  const normalized = keyword.toLocaleLowerCase('pt-BR');
  const isKeyword = keywords.some((candidate) => candidate.toLocaleLowerCase('pt-BR') === normalized);
  return isKeyword ? `{\\c&HACCFFF&}${text}{\\c}` : text;
}

function renderCueText(cue: SmartCaptionCue, keywords: readonly string[]): string {
  return cue.words.map((word) => assColor(escapeAssText(word.text), word.text, keywords)).join(' ');
}

function buildAss(input: SmartCaptionInput, cues: SmartCaptionCue[]): string {
  const config = styleConfig[input.style];
  const top = input.placement === 'top';
  const marginV = top ? input.safeArea.top : input.safeArea.bottom;
  const alignment = top ? 8 : 2;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${input.width}`,
    `PlayResY: ${input.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Aethera,${config.font},${config.fontSize},${config.primary},${config.primary},${config.outline},&H80000000&,1,0,0,0,100,100,0,0,1,3,1,${alignment},${input.safeArea.left},${input.safeArea.right},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text',
    ...cues.map((cue) => `Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Aethera,,0,0,,${renderCueText(cue, input.keywords ?? [])}`),
    '',
  ];
  return header.join('\n');
}

export function compileSmartCaptions(input: SmartCaptionInput): SmartCaptionArtifact {
  if (!Number.isInteger(input.durationMs) || input.durationMs <= 0) throw new Error('caption duration must be positive');
  if (input.width <= 0 || input.height <= 0) throw new Error('caption dimensions must be positive');
  const maxWords = Math.max(1, Math.floor(input.maxWordsPerCue ?? 3));
  const pauseThresholdMs = Math.max(0, Math.floor(input.pauseThresholdMs ?? 600));
  const words = input.words.map((word) => ({ ...word, text: word.text.trim() })).filter((word) => word.text.length > 0);
  let previousEnd = 0;
  for (const word of words) {
    if (!Number.isInteger(word.startMs) || !Number.isInteger(word.endMs) || word.startMs < 0 || word.endMs <= word.startMs || word.endMs > input.durationMs || word.startMs < previousEnd) {
      throw new Error(`caption timing is invalid for "${word.text}"`);
    }
    previousEnd = word.endMs;
  }
  const cues: SmartCaptionCue[] = [];
  for (const word of words) {
    const current = cues.at(-1);
    const pause = current ? word.startMs - current.endMs : Number.POSITIVE_INFINITY;
    if (!current || current.words.length >= maxWords || pause > pauseThresholdMs) {
      cues.push({ text: word.text, startMs: word.startMs, endMs: word.endMs, words: [word] });
    } else {
      current.words.push(word);
      current.text = current.words.map((item) => item.text).join(' ');
      current.endMs = word.endMs;
    }
  }
  const normalizedInput = { ...input, words, maxWordsPerCue: maxWords, pauseThresholdMs, keywords: [...(input.keywords ?? [])].sort() };
  const cacheKey = createHash('sha256').update(JSON.stringify(normalizedInput)).digest('hex');
  const coverage = { startMs: cues[0]?.startMs ?? 0, endMs: cues.at(-1)?.endMs ?? 0, durationMs: cues.at(-1)?.endMs ?? 0 };
  return { schemaVersion: 1, cacheKey, style: input.style, cues, ass: buildAss(input, cues), coverage };
}

