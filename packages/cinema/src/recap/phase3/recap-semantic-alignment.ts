/**
 * Aethera Recap — Semantic Beat Alignment, Real Audio Forced Alignment,
 * Gate I (Semantic Sync) & Gate J (Voice Consistency)
 *
 * Implements Phases 2, 3, 5, 6 & 8:
 * - Breaks natural narration into narrative clauses/events (`NarrativeBeatAlignment`)
 * - Maps each clause monotonically to the panel(s) that depict that event (never equal-split)
 * - Detects real speech envelopes and natural pauses directly from the synthesized PCM WAV
 * - Aligns every clause/panel to real audio timestamps `[speechStartMs, speechEndMs]`
 * - Audits semantic sync (Gate I) and voice/acoustic consistency (Gate J)
 */

import { existsSync, readFileSync } from 'node:fs';
import type { ExtractedPanel, PanelAnalysis, RecapScript } from '../recap-types.js';
import type { RecapAudiovisualPlan, SynthesizedSceneAudio } from './recap-audiovisual-types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NarrativeBeatAlignment {
	beatIndex: number;
	sceneId: string;
	clauseText: string;
	panelId: string;
	semanticScore: number;
	matchedTerms: string[];
}

export interface WordTimestamp {
	word: string;
	startMs: number;
	endMs: number;
}

export interface AlignedBeatInterval extends NarrativeBeatAlignment {
	speechStartMs: number;
	speechEndMs: number;
	displayStartMs: number;
	displayEndMs: number;
	alignmentMethod: 'whisper_word_aligned' | 'wav_pause_aligned' | 'speech_envelope_aligned';
}

export interface SpeechWindow {
	startMs: number;
	endMs: number;
	rmsDb: number;
}

export interface GateIReport {
	gate: 'I_semantic_sync';
	verdict: 'pass' | 'needs_review' | 'fail';
	checkedAtIso: string;
	reasons: string[];
	metrics: Record<string, number | string | boolean>;
	findings: Array<{
		code: 'panel_order_violation' | 'unjustified_freeze' | 'silent_tail_extension' | 'low_semantic_alignment' | 'missing_alignment';
		severity: 'critical' | 'warning';
		panelId?: string;
		detail: string;
	}>;
}

export interface GateJReport {
	gate: 'J_voice_consistency';
	verdict: 'pass' | 'needs_review' | 'fail';
	checkedAtIso: string;
	reasons: string[];
	metrics: Record<string, number | string | boolean>;
	findings: Array<{
		code: 'provider_switch' | 'voice_identity_mismatch' | 'timbre_shift' | 'volume_jump' | 'audio_clipping' | 'sample_rate_nonstandard';
		severity: 'critical' | 'warning';
		detail: string;
	}>;
}

// ─── Tokenization & Semantic Matching ────────────────────────────────────────

const STOPWORDS_PT = new Set([
	'que', 'para', 'com', 'uma', 'uns', 'umas', 'dos', 'das', 'nos', 'nas', 'por',
	'mais', 'mas', 'como', 'onde', 'pelo', 'pela', 'pelos', 'pelas', 'seu', 'sua',
	'seus', 'suas', 'ele', 'ela', 'eles', 'elas', 'isso', 'esse', 'essa', 'este',
	'esta', 'entre', 'sobre', 'depois', 'entao', 'então', 'logo', 'nesse', 'nesta',
	'momento', 'historia', 'história', 'comeca', 'começa', 'acaba', 'fica', 'ficando',
]);

function extractSemanticTokens(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 3 && !STOPWORDS_PT.has(t));
}

function scoreClauseAgainstPanel(
	clauseText: string,
	analysis: PanelAnalysis | undefined,
): { score: number; matchedTerms: string[] } {
	if (!analysis) return { score: 0.1, matchedTerms: [] };
	const clauseTokens = extractSemanticTokens(clauseText);
	if (clauseTokens.length === 0) return { score: 0.1, matchedTerms: [] };

	const panelText = [
		analysis.visualDescription ?? '',
		analysis.setting ?? '',
		...analysis.characters,
		...analysis.actions.map((a) => a.description),
		...analysis.dialogues.map((d) => d.translatedText ?? d.text),
		...(analysis.relevantObjects ?? []),
		...(analysis.expressions ?? []),
	].join(' ');
	const panelTokens = new Set(extractSemanticTokens(panelText));

	const matched: string[] = [];
	for (const tok of clauseTokens) {
		if (panelTokens.has(tok)) {
			if (!matched.includes(tok)) matched.push(tok);
		} else {
			// Prefix stem match (e.g. "corre"/"correndo", "queda"/"cai", "pedra"/"rochoso")
			for (const pt of panelTokens) {
				if (tok.length >= 4 && pt.length >= 4 && (pt.startsWith(tok.slice(0, 4)) || tok.startsWith(pt.slice(0, 4)))) {
					if (!matched.includes(tok)) matched.push(tok);
					break;
				}
			}
		}
	}

	const score = Math.min(1, matched.length / Math.max(2, Math.min(clauseTokens.length, 6)));
	return { score: Number(score.toFixed(3)), matchedTerms: matched };
}

function isReactionCloseUpPanel(analysis: PanelAnalysis | undefined): boolean {
	if (!analysis) return false;
	const desc = `${analysis.visualDescription ?? ''} ${(analysis.expressions ?? []).join(' ')}`.toLowerCase();
	return /(plano\s+superfechado|close[-\s]?up|olho\s+(esquerdo|direito)|íris|expressão\s+de\s+choque|plano\s+fechado\s+no\s+rosto)/i.test(desc);
}

/**
 * Splits a scene's natural narration into atomic narrative clauses/events
 * so each clause can align to its exact visual panel.
 */
export function splitNarrationIntoNarrativeClauses(text: string, targetPanelCount: number): string[] {
	const cleaned = text.trim().replace(/\s+/g, ' ');
	if (!cleaned) return [];

	// 1. Split by sentence boundaries first
	const sentences = cleaned
		.split(/(?<=[.!?…])\s+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	// 2. Further split compound sentences on strong narrative connectors when a sentence spans multiple panels
	let clauses: string[] = [...sentences];
	if (clauses.length < targetPanelCount) {
		const expanded: string[] = [];
		for (let i = 0; i < clauses.length; i++) {
			const sent = clauses[i]!;
			const remainingAfter = clauses.length - 1 - i;
			if (expanded.length + 1 + remainingAfter >= targetPanelCount) {
				expanded.push(sent);
				continue;
			}
			const subParts = sent
				.split(/(?<=,)\s+(?=(?:onde|mas|enquanto|quando|então|entao|logo depois|e\s+(?:despenca|cai|tropeça|corre|acaba|sai|aterrissa|olha|percebe)))/i)
				.map((p) => p.trim())
				.filter((p) => p.length > 0);
			if (subParts.length > 1) {
				expanded.push(...subParts);
			} else {
				expanded.push(sent);
			}
		}
		clauses = expanded;
	}

	// 3. If still fewer clauses than panels, split the longest compound clause at a clean mid-action conjunction (" e ", " pelo ", " contra ")
	while (clauses.length < targetPanelCount) {
		let bestIdx = -1;
		let bestLen = 0;
		for (let i = 0; i < clauses.length; i++) {
			const c = clauses[i]!;
			if (c.length > bestLen && /\s+(?:e\s+(?:em|despenca|cai|sai|se\s+|bate|corre)|pelo\s+|contra\s+)/i.test(c)) {
				bestLen = c.length;
				bestIdx = i;
			}
		}
		if (bestIdx < 0) break;
		const target = clauses[bestIdx]!;
		const m = /\s+(?=(?:e\s+(?:em|despenca|cai|sai|se\s+|bate|corre)|pelo\s+|contra\s+))/i.exec(target);
		if (!m || m.index < 12 || target.length - m.index < 12) break;
		const left = target.slice(0, m.index).trim();
		const right = target.slice(m.index).trim();
		clauses.splice(bestIdx, 1, left, right);
	}

	return clauses.length > 0 ? clauses : [cleaned];
}

/**
 * Splits a reaction close-up sentence so the close-up holds ONLY during the shock/reaction beat
 * and cuts cleanly to the following action panel right as the action begins (e.g. "de um penhasco...").
 */
function splitReactionClauseForCloseUp(clause: string): [string, string] | null {
	// Match natural transition from shock/reaction into the main action ("da borda de um penhasco", "e despenca", "e cai", etc.)
	const match = /\s+(?=(?:de\s+um\s+penhasco|do\s+penhasco|e\s+despenca|e\s+cai|e\s+se\s+joga|quando\s+))/i.exec(clause);
	if (!match || match.index < 12 || clause.length - match.index < 14) return null;
	return [clause.slice(0, match.index).trim(), clause.slice(match.index).trim()];
}

/**
 * Phase 2: Builds monotonic `NarrativeBeatAlignment` mapping each narrative clause
 * to the panel that depicts that specific event, preserving reading order.
 */
export function buildNarrativeBeatAlignments(input: {
	script: RecapScript;
	analyses: readonly PanelAnalysis[];
}): NarrativeBeatAlignment[] {
	const analysisByPanel = new Map<string, PanelAnalysis>();
	for (const a of input.analyses) analysisByPanel.set(a.panelId, a);

	const alignments: NarrativeBeatAlignment[] = [];
	let globalBeatIdx = 0;

	for (const scene of input.script.scenes) {
		const panelIds = scene.panelIds.filter((pid, i) => i === 0 || pid !== scene.panelIds[i - 1]);
		if (panelIds.length === 0) continue;

		let clauses = splitNarrationIntoNarrativeClauses(scene.narrationText, panelIds.length);
		// Close-up pacing guard: if the first panel in this scene is a reaction close-up followed by an action panel,
		// split the opening reaction sentence so the close-up stays punchy (~2-3s) and cuts right when the action starts.
		if (
			panelIds.length >= 2 &&
			clauses.length >= 1 &&
			isReactionCloseUpPanel(analysisByPanel.get(panelIds[0]!))
		) {
			const splitReaction = splitReactionClauseForCloseUp(clauses[0]!);
			if (splitReaction) {
				clauses = [splitReaction[0], splitReaction[1], ...clauses.slice(1)];
			}
		}

		const numClauses = clauses.length;
		const numPanels = panelIds.length;

		if (numClauses === 1 && numPanels === 1) {
			const { score, matchedTerms } = scoreClauseAgainstPanel(clauses[0]!, analysisByPanel.get(panelIds[0]!));
			alignments.push({
				beatIndex: globalBeatIdx++,
				sceneId: scene.sceneId,
				clauseText: clauses[0]!,
				panelId: panelIds[0]!,
				semanticScore: score,
				matchedTerms,
			});
			continue;
		}

		// Monotonic assignment: every panel gets at least one clause if numClauses >= numPanels;
		// if numClauses < numPanels, split the best-matching clause proportionally across remaining panels in order.
		if (numClauses >= numPanels) {
			let panelCursor = 0;
			let beatsOnCurrentPanel = 0;
			for (let cIdx = 0; cIdx < numClauses; cIdx++) {
				const remainingClauses = numClauses - cIdx;
				const remainingPanels = numPanels - panelCursor;

				let chosenPanelIdx = panelCursor;
				if (remainingPanels > 1) {
					const curIsCloseUp = isReactionCloseUpPanel(analysisByPanel.get(panelIds[panelCursor]!));
					if (curIsCloseUp && beatsOnCurrentPanel >= 1) {
						// Never let a reaction close-up linger over subsequent action clauses
						panelCursor++;
						beatsOnCurrentPanel = 0;
						chosenPanelIdx = panelCursor;
					} else if (remainingClauses === remainingPanels) {
						chosenPanelIdx = panelCursor;
					} else {
						const curScore = scoreClauseAgainstPanel(clauses[cIdx]!, analysisByPanel.get(panelIds[panelCursor]!)).score;
						const nextScore = scoreClauseAgainstPanel(clauses[cIdx]!, analysisByPanel.get(panelIds[panelCursor + 1]!)).score;
						if (cIdx > 0 && nextScore > curScore + 0.05) {
							panelCursor++;
							beatsOnCurrentPanel = 0;
							chosenPanelIdx = panelCursor;
						}
					}
				}

				const pid = panelIds[chosenPanelIdx]!;
				const { score, matchedTerms } = scoreClauseAgainstPanel(clauses[cIdx]!, analysisByPanel.get(pid));
				alignments.push({
					beatIndex: globalBeatIdx++,
					sceneId: scene.sceneId,
					clauseText: clauses[cIdx]!,
					panelId: pid,
					semanticScore: score,
					matchedTerms,
				});
				beatsOnCurrentPanel++;

				// If this panel was just covered and we have more panels ahead, allow next clause to move forward
				if (remainingClauses === remainingPanels && panelCursor < numPanels - 1) {
					panelCursor++;
					beatsOnCurrentPanel = 0;
				}
			}
		} else {
			// Fewer clauses than panels: map each panel monotonically to its best matching clause
			let clauseCursor = 0;
			for (let pIdx = 0; pIdx < numPanels; pIdx++) {
				const pid = panelIds[pIdx]!;
				let bestC = clauseCursor;
				let bestScore = scoreClauseAgainstPanel(clauses[clauseCursor]!, analysisByPanel.get(pid)).score;
				if (clauseCursor + 1 < numClauses) {
					const nextScore = scoreClauseAgainstPanel(clauses[clauseCursor + 1]!, analysisByPanel.get(pid)).score;
					if (nextScore >= bestScore || pIdx >= Math.ceil(((clauseCursor + 1) * numPanels) / numClauses)) {
						clauseCursor++;
						bestC = clauseCursor;
						bestScore = nextScore;
					}
				}
				const { matchedTerms } = scoreClauseAgainstPanel(clauses[bestC]!, analysisByPanel.get(pid));
				alignments.push({
					beatIndex: globalBeatIdx++,
					sceneId: scene.sceneId,
					clauseText: clauses[bestC]!,
					panelId: pid,
					semanticScore: bestScore,
					matchedTerms,
				});
			}
		}
	}

	return alignments;
}

// ─── Real WAV Speech Envelope & Pause Detection (Phase 3) ────────────────────

export interface WavAcousticMetrics {
	sampleRate: number;
	channels: number;
	durationMs: number;
	rmsDb: number;
	peakDbfs: number;
	zeroCrossingRate: number;
	clippedSamples: number;
	totalSamples: number;
	speechWindows: SpeechWindow[];
	pauseMidpointsMs: number[];
}

/**
 * Parses a 16-bit PCM WAV file and computes real acoustic metrics + active speech windows
 * and natural inter-clause pause midpoints (20 ms frame analysis).
 */
export function analyzeWavAcoustics(wavPath: string): WavAcousticMetrics {
	if (!existsSync(wavPath)) {
		throw new Error(`WAV não encontrado para análise acústica: ${wavPath}`);
	}
	const buf = readFileSync(wavPath);
	if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
		throw new Error(`Formato WAV inválido: ${wavPath}`);
	}

	const channels = buf.readUInt16LE(22) || 1;
	const sampleRate = buf.readUInt32LE(24) || 24000;
	const bitsPerSample = buf.readUInt16LE(34) || 16;

	// Locate 'data' chunk robustly
	let dataOffset = 12;
	let dataSize = buf.length - 44;
	while (dataOffset + 8 <= buf.length) {
		const chunkId = buf.toString('ascii', dataOffset, dataOffset + 4);
		const chunkSize = buf.readUInt32LE(dataOffset + 4);
		if (chunkId === 'data') {
			dataOffset += 8;
			dataSize = Math.min(chunkSize, buf.length - dataOffset);
			break;
		}
		dataOffset += 8 + chunkSize + (chunkSize % 2);
	}

	const bytesPerSample = Math.max(1, bitsPerSample / 8);
	const totalFrames = Math.floor(dataSize / (bytesPerSample * channels));
	const durationMs = Math.round((totalFrames / sampleRate) * 1000);

	// 20 ms analysis windows
	const windowFrames = Math.max(1, Math.round(sampleRate * 0.02));
	const frameRms: Array<{ startMs: number; endMs: number; rms: number }> = [];

	let sumSqAll = 0;
	let peakAbs = 0;
	let clippedSamples = 0;
	let zeroCrossings = 0;
	let prevSign = 0;

	for (let f = 0; f < totalFrames; f += windowFrames) {
		const endF = Math.min(totalFrames, f + windowFrames);
		let winSq = 0;
		let count = 0;
		for (let i = f; i < endF; i++) {
			const off = dataOffset + i * channels * bytesPerSample;
			if (off + 1 >= buf.length) break;
			const sample = bitsPerSample === 16 ? buf.readInt16LE(off) / 32768 : 0;
			const abs = Math.abs(sample);
			winSq += sample * sample;
			sumSqAll += sample * sample;
			if (abs > peakAbs) peakAbs = abs;
			if (abs >= 0.998) clippedSamples++;
			const sign = sample >= 0 ? 1 : -1;
			if (prevSign !== 0 && sign !== prevSign) zeroCrossings++;
			prevSign = sign;
			count++;
		}
		const rms = count > 0 ? Math.sqrt(winSq / count) : 0;
		frameRms.push({
			startMs: Math.round((f / sampleRate) * 1000),
			endMs: Math.round((endF / sampleRate) * 1000),
			rms,
		});
	}

	const globalRms = totalFrames > 0 ? Math.sqrt(sumSqAll / totalFrames) : 0;
	const rmsDb = globalRms > 0 ? Number((20 * Math.log10(globalRms)).toFixed(2)) : -96;
	const peakDbfs = peakAbs > 0 ? Number((20 * Math.log10(peakAbs)).toFixed(2)) : -96;
	const zeroCrossingRate = totalFrames > 1 ? Number((zeroCrossings / totalFrames).toFixed(4)) : 0;

	// Adaptive speech threshold (~12% of global RMS, floor 0.008)
	const speechThreshold = Math.max(0.008, globalRms * 0.14);
	const speechWindows: SpeechWindow[] = [];
	let curStart: number | null = null;
	let curSqSum = 0;
	let curWinCount = 0;

	for (const win of frameRms) {
		if (win.rms >= speechThreshold) {
			if (curStart === null) curStart = win.startMs;
			curSqSum += win.rms * win.rms;
			curWinCount++;
		} else if (curStart !== null) {
			const winRms = Math.sqrt(curSqSum / Math.max(1, curWinCount));
			speechWindows.push({
				startMs: curStart,
				endMs: win.startMs,
				rmsDb: winRms > 0 ? Number((20 * Math.log10(winRms)).toFixed(2)) : -96,
			});
			curStart = null;
			curSqSum = 0;
			curWinCount = 0;
		}
	}
	if (curStart !== null) {
		const winRms = Math.sqrt(curSqSum / Math.max(1, curWinCount));
		speechWindows.push({
			startMs: curStart,
			endMs: durationMs,
			rmsDb: winRms > 0 ? Number((20 * Math.log10(winRms)).toFixed(2)) : -96,
		});
	}

	// Merge micro-gaps (< 120 ms) inside words so only genuine phrase/sentence pauses remain
	const mergedSpeech: SpeechWindow[] = [];
	for (const sw of speechWindows) {
		const prev = mergedSpeech[mergedSpeech.length - 1];
		if (prev && sw.startMs - prev.endMs < 120) {
			prev.endMs = sw.endMs;
		} else {
			mergedSpeech.push({ ...sw });
		}
	}

	// Collect midpoints of genuine pauses (>= 160 ms) between speech islands
	const pauseMidpointsMs: number[] = [];
	for (let i = 1; i < mergedSpeech.length; i++) {
		const gapStart = mergedSpeech[i - 1]!.endMs;
		const gapEnd = mergedSpeech[i]!.startMs;
		if (gapEnd - gapStart >= 160) {
			pauseMidpointsMs.push(Math.round((gapStart + gapEnd) / 2));
		}
	}

	return {
		sampleRate,
		channels,
		durationMs,
		rmsDb,
		peakDbfs,
		zeroCrossingRate,
		clippedSamples,
		totalSamples: totalFrames,
		speechWindows: mergedSpeech,
		pauseMidpointsMs,
	};
}

function estimatePhoneticWeight(text: string): number {
	const cleaned = text.trim();
	if (!cleaned) return 1;
	const letters = cleaned.replace(/[^A-Za-zÀ-ú0-9]/g, '').length;
	const pauses = (cleaned.match(/[.!?…]/g) ?? []).length * 6 + (cleaned.match(/[,;:]/g) ?? []).length * 3;
	return Math.max(4, letters + pauses);
}

function normalizeWordToken(raw: string): string {
	return raw
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]/g, '');
}

/**
 * Phase 3 Forced Alignment: Queries local VoiceStudio WhisperX / OpenAI-compatible STT
 * (`/v1/audio/transcriptions`) for exact real word-level timestamps on the synthesized WAV.
 * Gracefully returns `null` when STT is unreachable so the pipeline falls back to WAV pause alignment.
 */
export async function transcribeWavWordTimestamps(
	wavPath: string,
	options?: { baseUrl?: string; language?: string; model?: string; timeoutMs?: number },
): Promise<WordTimestamp[] | null> {
	if (!existsSync(wavPath)) return null;
	const baseUrl = (options?.baseUrl ?? process.env['NB_VOICESTUDIO_URL'] ?? 'http://127.0.0.1:3900').replace(/\/+$/, '');
	const language = options?.language ?? 'pt';
	const model = options?.model ?? 'whisper-1';
	const timeoutMs = options?.timeoutMs ?? 45_000;

	try {
		const wavBuf = readFileSync(wavPath);
		const form = new FormData();
		form.append('file', new Blob([wavBuf], { type: 'audio/wav' }), 'narration.wav');
		form.append('model', model);
		form.append('language', language);
		form.append('response_format', 'verbose_json');
		form.append('timestamp_granularities[]', 'word');

		const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
			method: 'POST',
			body: form,
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as {
			words?: Array<{ word?: string; start?: number; end?: number }>;
		};
		if (!Array.isArray(data.words) || data.words.length === 0) return null;

		const timestamps: WordTimestamp[] = [];
		for (const w of data.words) {
			if (typeof w.word !== 'string' || typeof w.start !== 'number' || typeof w.end !== 'number') continue;
			const startMs = Math.max(0, Math.round(w.start * 1000));
			const endMs = Math.max(startMs + 20, Math.round(w.end * 1000));
			timestamps.push({ word: w.word.trim(), startMs, endMs });
		}
		return timestamps.length > 0 ? timestamps : null;
	} catch {
		return null;
	}
}

/**
 * Aligns beats sequentially against exact WhisperX/STT word-level timestamps so each
 * visual panel transition lands cleanly at the exact moment the narrator starts the next action.
 */
function alignBeatsWithWordTimestamps(
	alignments: readonly NarrativeBeatAlignment[],
	words: readonly WordTimestamp[],
	totalDurationMs: number,
): AlignedBeatInterval[] | null {
	if (alignments.length === 0 || words.length === 0) return null;

	const normWords = words.map((w) => normalizeWordToken(w.word));
	const spans: Array<{ startMs: number; endMs: number }> = [];
	let wordCursor = 0;

	for (let bIdx = 0; bIdx < alignments.length; bIdx++) {
		const clauseTokens = alignments[bIdx]!.clauseText
			.split(/\s+/)
			.map(normalizeWordToken)
			.filter((t) => t.length > 0);
		if (clauseTokens.length === 0) return null;

		const firstTok = clauseTokens[0]!;
		const lastTok = clauseTokens[clauseTokens.length - 1]!;

		// Find first token near current cursor (within +6 words tolerance)
		let startIdx = wordCursor;
		const searchLimit = Math.min(words.length - 1, wordCursor + 6);
		for (let i = wordCursor; i <= searchLimit; i++) {
			if (normWords[i] === firstTok || (firstTok.length >= 4 && normWords[i]?.startsWith(firstTok.slice(0, 4)))) {
				startIdx = i;
				break;
			}
		}

		// Estimate end index by token count, then snap to matching last token within ±4 words
		const approxEnd = Math.min(words.length - 1, startIdx + clauseTokens.length - 1);
		let endIdx = approxEnd;
		let bestDist = 5;
		const lo = Math.max(startIdx, approxEnd - 4);
		const hi = Math.min(words.length - 1, approxEnd + 4);
		for (let i = lo; i <= hi; i++) {
			if (normWords[i] === lastTok || (lastTok.length >= 4 && normWords[i]?.startsWith(lastTok.slice(0, 4)))) {
				const d = Math.abs(i - approxEnd);
				if (d < bestDist) {
					bestDist = d;
					endIdx = i;
				}
			}
		}
		if (bIdx === alignments.length - 1) {
			endIdx = words.length - 1;
		}

		const startMs = words[startIdx]!.startMs;
		const endMs = Math.max(startMs + 100, words[endIdx]!.endMs);
		spans.push({ startMs, endMs });
		wordCursor = Math.min(words.length - 1, endIdx + 1);
	}

	// Build contiguous display windows with cuts placed at the exact natural midpoint between spoken clauses
	const result: AlignedBeatInterval[] = [];
	for (let i = 0; i < alignments.length; i++) {
		const cur = spans[i]!;
		const prev = i > 0 ? spans[i - 1]! : null;
		const next = i + 1 < spans.length ? spans[i + 1]! : null;

		const displayStartMs = i === 0 ? 0 : Math.round((prev!.endMs + cur.startMs) / 2);
		const displayEndMs =
			i === alignments.length - 1
				? totalDurationMs
				: Math.max(displayStartMs + 200, Math.round((cur.endMs + next!.startMs) / 2));

		result.push({
			...alignments[i]!,
			speechStartMs: cur.startMs,
			speechEndMs: cur.endMs,
			displayStartMs,
			displayEndMs,
			alignmentMethod: 'whisper_word_aligned',
		});
	}

	return result;
}

/**
 * Phase 3: Aligns `NarrativeBeatAlignment[]` to real WAV speech boundaries and natural pauses.
 * When WhisperX/STT `wordTimestamps` are provided, uses exact word-level forced alignment (< 80ms precision).
 * Otherwise snaps clause cut points to genuine pauses in the synthesized audio.
 */
export function alignBeatsToRealWavAudio(input: {
	alignments: readonly NarrativeBeatAlignment[];
	wavPath: string;
	tailPaddingMs?: number;
	wordTimestamps?: readonly WordTimestamp[] | null;
}): {
	alignedBeats: AlignedBeatInterval[];
	acoustics: WavAcousticMetrics;
	totalDurationMs: number;
} {
	const acoustics = analyzeWavAcoustics(input.wavPath);
	const tailPaddingMs = input.tailPaddingMs ?? 300;
	const totalDurationMs = acoustics.durationMs + tailPaddingMs;

	if (input.alignments.length === 0) {
		return { alignedBeats: [], acoustics, totalDurationMs };
	}

	// Prefer exact word-level forced alignment when real STT word timestamps are available
	if (input.wordTimestamps && input.wordTimestamps.length > 0) {
		const wordAligned = alignBeatsWithWordTimestamps(input.alignments, input.wordTimestamps, totalDurationMs);
		if (wordAligned && wordAligned.length === input.alignments.length) {
			return { alignedBeats: wordAligned, acoustics, totalDurationMs };
		}
	}

	const firstSpeechMs = acoustics.speechWindows[0]?.startMs ?? 0;
	const lastSpeechMs = acoustics.speechWindows[acoustics.speechWindows.length - 1]?.endMs ?? acoustics.durationMs;
	const activeSpanMs = Math.max(200, lastSpeechMs - firstSpeechMs);

	const weights = input.alignments.map((a) => estimatePhoneticWeight(a.clauseText));
	const totalWeight = weights.reduce((s, w) => s + w, 0);

	// Compute target cut points and snap to nearest real pause in WAV (within ±900 ms)
	const boundaries: Array<{ ms: number; snappedToPause: boolean }> = [{ ms: firstSpeechMs, snappedToPause: true }];
	let cumulativeWeight = 0;
	const usedPauses = new Set<number>();

	for (let i = 0; i < input.alignments.length - 1; i++) {
		cumulativeWeight += weights[i]!;
		const expectedMs = firstSpeechMs + Math.round((cumulativeWeight / totalWeight) * activeSpanMs);
		const prevBound = boundaries[boundaries.length - 1]!.ms;

		// Search for closest unused real pause in the WAV within ±900ms that preserves monotonic order
		let bestPause: number | null = null;
		let bestDist = 900;
		for (const pMs of acoustics.pauseMidpointsMs) {
			if (usedPauses.has(pMs)) continue;
			if (pMs <= prevBound + 350 || pMs >= lastSpeechMs - 350) continue;
			const dist = Math.abs(pMs - expectedMs);
			if (dist < bestDist) {
				bestDist = dist;
				bestPause = pMs;
			}
		}

		if (bestPause !== null) {
			usedPauses.add(bestPause);
			boundaries.push({ ms: bestPause, snappedToPause: true });
		} else {
			boundaries.push({ ms: Math.max(prevBound + 350, expectedMs), snappedToPause: false });
		}
	}
	boundaries.push({ ms: lastSpeechMs, snappedToPause: true });

	const alignedBeats: AlignedBeatInterval[] = input.alignments.map((a, idx) => {
		const speechStartMs = boundaries[idx]!.ms;
		const speechEndMs = boundaries[idx + 1]!.ms;
		const displayStartMs = idx === 0 ? 0 : speechStartMs;
		const displayEndMs = idx === input.alignments.length - 1 ? totalDurationMs : speechEndMs;
		const method = boundaries[idx + 1]!.snappedToPause ? 'wav_pause_aligned' : 'speech_envelope_aligned';
		return {
			...a,
			speechStartMs,
			speechEndMs,
			displayStartMs,
			displayEndMs,
			alignmentMethod: method,
		};
	});

	return { alignedBeats, acoustics, totalDurationMs };
}

// ─── Phase 8: Gate I (Semantic Sync) & Gate J (Voice Consistency) ────────────

export function runGateISemanticSync(input: {
	plan: RecapAudiovisualPlan;
	panels: readonly ExtractedPanel[];
	alignedBeats?: readonly AlignedBeatInterval[];
}): GateIReport {
	const findings: GateIReport['findings'] = [];
	const reasons: string[] = [];

	const panelOrderIndex = new Map<string, number>();
	input.panels.forEach((p, idx) => panelOrderIndex.set(p.panelId, idx));

	// 1. Check panel reading order across shots
	let orderViolations = 0;
	let prevOrder = -1;
	for (const shot of input.plan.shots) {
		const curOrder = panelOrderIndex.get(shot.panelId);
		if (curOrder !== undefined && curOrder < prevOrder) {
			orderViolations++;
			findings.push({
				code: 'panel_order_violation',
				severity: 'critical',
				panelId: shot.panelId,
				detail: `Painel ${shot.panelId} exibido fora da ordem narrativa (índice ${curOrder} após ${prevOrder}).`,
			});
		}
		if (curOrder !== undefined) prevOrder = curOrder;
	}

	// 2. Check unjustified freezes (> 11s on static/standard panel, > 15s on animated vertical-scroll sequence panel)
	let freezeCount = 0;
	for (const shot of input.plan.shots) {
		const maxAllowedMs = shot.motionStyle === 'pan_vertical' ? 15_000 : 11_000;
		if (shot.durationMs > maxAllowedMs) {
			freezeCount++;
			findings.push({
				code: 'unjustified_freeze',
				severity: 'warning',
				panelId: shot.panelId,
				detail: `Painel ${shot.panelId} permanece ${(shot.durationMs / 1000).toFixed(1)}s na tela (> ${(maxAllowedMs / 1000).toFixed(0)}s).`,
			});
		}
	}

	// 3. Check artificial silent tail extension (> 1.5s after measured speech ends)
	const tailExcessMs = input.plan.totalDurationMs - input.plan.durationAudit.measuredNarrationDurationMs;
	let silentTailExcess = false;
	if (tailExcessMs > 1500) {
		silentTailExcess = true;
		findings.push({
			code: 'silent_tail_extension',
			severity: 'critical',
			detail: `Timeline excede a narração real em ${(tailExcessMs / 1000).toFixed(1)}s de silêncio artificial.`,
		});
	}

	// 4. Verify semantic alignment presence and quality
	const alignments = input.alignedBeats ?? [];
	const avgSemanticScore =
		alignments.length > 0
			? Number((alignments.reduce((s, a) => s + a.semanticScore, 0) / alignments.length).toFixed(3))
			: 0;
	const wavSnappedCount = alignments.filter(
		(a) => a.alignmentMethod === 'whisper_word_aligned' || a.alignmentMethod === 'wav_pause_aligned',
	).length;
	const whisperAlignedCount = alignments.filter((a) => a.alignmentMethod === 'whisper_word_aligned').length;

	if (alignments.length === 0) {
		findings.push({
			code: 'missing_alignment',
			severity: 'warning',
			detail: 'Nenhum alinhamento semântico por acontecimento (NarrativeBeatAlignment) registrado.',
		});
	} else if (avgSemanticScore < 0.2) {
		findings.push({
			code: 'low_semantic_alignment',
			severity: 'warning',
			detail: `Score semântico médio baixo (${avgSemanticScore}) entre texto narrado e painéis.`,
		});
	}

	for (const f of findings) reasons.push(f.detail);

	const hasCritical = findings.some((f) => f.severity === 'critical');
	const hasWarning = findings.some((f) => f.severity === 'warning');
	const verdict = hasCritical ? 'fail' : hasWarning ? 'needs_review' : 'pass';

	return {
		gate: 'I_semantic_sync',
		verdict,
		checkedAtIso: new Date().toISOString(),
		reasons,
		metrics: {
			shotCount: input.plan.shots.length,
			alignedBeatCount: alignments.length,
			wavSnappedCount,
			whisperAlignedCount,
			avgSemanticScore,
			orderViolations,
			freezeCount,
			tailExcessMs,
			silentTailExcess,
		},
		findings,
	};
}

export function runGateJVoiceConsistency(input: {
	segments: readonly SynthesizedSceneAudio[];
	outputSampleRateHz?: number;
}): GateJReport {
	const findings: GateJReport['findings'] = [];
	const reasons: string[] = [];

	const providers = new Set(input.segments.map((s) => s.provider));
	if (providers.size > 1) {
		findings.push({
			code: 'provider_switch',
			severity: 'critical',
			detail: `Alternância indevida de provedor TTS no mesmo vídeo: [${[...providers].join(', ')}].`,
		});
	}

	const voiceIds = new Set(input.segments.map((s) => s.voiceId).filter(Boolean));
	if (voiceIds.size > 1) {
		findings.push({
			code: 'voice_identity_mismatch',
			severity: 'critical',
			detail: `Múltiplas identidades vocais no mesmo vídeo: [${[...voiceIds].join(', ')}].`,
		});
	}

	// Acoustic continuity across WAV segments
	const acousticsList: WavAcousticMetrics[] = [];
	for (const seg of input.segments) {
		if (existsSync(seg.audioPath)) {
			try {
				acousticsList.push(analyzeWavAcoustics(seg.audioPath));
			} catch {
				// ignore non-wav
			}
		}
	}

	let maxRmsJumpDb = 0;
	let maxZcrDelta = 0;
	let totalClipped = 0;

	for (let i = 0; i < acousticsList.length; i++) {
		const cur = acousticsList[i]!;
		totalClipped += cur.clippedSamples;
		if (cur.totalSamples > 0 && cur.clippedSamples / cur.totalSamples > 0.005) {
			findings.push({
				code: 'audio_clipping',
				severity: 'critical',
				detail: `Clipping detectado no segmento ${i + 1} (${cur.clippedSamples} amostras saturadas, pico ${cur.peakDbfs} dBFS).`,
			});
		}
		if (i > 0) {
			const prev = acousticsList[i - 1]!;
			const rmsJump = Math.abs(cur.rmsDb - prev.rmsDb);
			const zcrDelta = Math.abs(cur.zeroCrossingRate - prev.zeroCrossingRate);
			if (rmsJump > maxRmsJumpDb) maxRmsJumpDb = rmsJump;
			if (zcrDelta > maxZcrDelta) maxZcrDelta = zcrDelta;
		}
	}

	// Intra-clip sliding-window (4s) acoustic stability check — verifies volume/timbre consistency
	// even inside a single continuous TTS session (not just across separate segments).
	let intraClipMaxRmsDeltaDb = 0;
	let intraClipMaxZcrDelta = 0;
	for (const seg of input.segments) {
		if (!existsSync(seg.audioPath)) continue;
		try {
			const buf = readFileSync(seg.audioPath);
			if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') continue;
			const sr = buf.readUInt32LE(24);
			const ch = buf.readUInt16LE(22);
			const bps = buf.readUInt16LE(34) / 8;
			let off = 12;
			while (off + 8 <= buf.length && buf.toString('ascii', off, off + 4) !== 'data') {
				off += 8 + buf.readUInt32LE(off + 4);
			}
			if (off + 8 > buf.length) continue;
			const dataOff = off + 8;
			const dataSize = buf.readUInt32LE(off + 4);
			const totalFrames = Math.floor(dataSize / (ch * bps));
			const winFrames = sr * 4;
			const winMetrics: Array<{ rmsDb: number; zcr: number }> = [];
			for (let f = 0; f + sr * 2 <= totalFrames; f += winFrames) {
				const end = Math.min(totalFrames, f + winFrames);
				let sumSq = 0;
				let active = 0;
				let zc = 0;
				let prev = 0;
				for (let i = f; i < end; i++) {
					const pos = dataOff + i * ch * bps;
					if (pos + 1 >= buf.length) break;
					const s = buf.readInt16LE(pos) / 32768;
					if (Math.abs(s) > 0.01) {
						sumSq += s * s;
						active++;
					}
					const sign = s >= 0 ? 1 : -1;
					if (prev !== 0 && sign !== prev) zc++;
					prev = sign;
				}
				if (active > sr * 0.4) {
					winMetrics.push({
						rmsDb: 20 * Math.log10(Math.sqrt(sumSq / active)),
						zcr: zc / Math.max(1, end - f),
					});
				}
			}
			for (let i = 1; i < winMetrics.length; i++) {
				const dRms = Math.abs(winMetrics[i]!.rmsDb - winMetrics[i - 1]!.rmsDb);
				const dZcr = Math.abs(winMetrics[i]!.zcr - winMetrics[i - 1]!.zcr);
				if (dRms > intraClipMaxRmsDeltaDb) intraClipMaxRmsDeltaDb = dRms;
				if (dZcr > intraClipMaxZcrDelta) intraClipMaxZcrDelta = dZcr;
			}
		} catch {
			// ignore non-wav
		}
	}

	const effectiveMaxRmsJumpDb = Math.max(maxRmsJumpDb, intraClipMaxRmsDeltaDb);
	const effectiveMaxZcrDelta = Math.max(maxZcrDelta, intraClipMaxZcrDelta);

	if (effectiveMaxRmsJumpDb > 4.5) {
		findings.push({
			code: 'volume_jump',
			severity: 'warning',
			detail: `Salto de volume entre blocos/frases de narração (${effectiveMaxRmsJumpDb.toFixed(1)} dB > 4.5 dB).`,
		});
	}
	if (effectiveMaxZcrDelta > 0.045) {
		findings.push({
			code: 'timbre_shift',
			severity: 'warning',
			detail: `Variação perceptível de timbre/entonação entre blocos/frases (ΔZCR=${effectiveMaxZcrDelta.toFixed(4)}).`,
		});
	}

	if (input.outputSampleRateHz !== undefined && input.outputSampleRateHz !== 48000) {
		findings.push({
			code: 'sample_rate_nonstandard',
			severity: 'warning',
			detail: `Taxa de amostragem final (${input.outputSampleRateHz} Hz) difere do padrão profissional de 48000 Hz.`,
		});
	}

	for (const f of findings) reasons.push(f.detail);

	const hasCritical = findings.some((f) => f.severity === 'critical');
	const hasWarning = findings.some((f) => f.severity === 'warning');
	const verdict = hasCritical ? 'fail' : hasWarning ? 'needs_review' : 'pass';

	return {
		gate: 'J_voice_consistency',
		verdict,
		checkedAtIso: new Date().toISOString(),
		reasons,
		metrics: {
			segmentCount: input.segments.length,
			singleContinuousSession: input.segments.length === 1,
			providerCount: providers.size,
			provider: [...providers][0] ?? 'unknown',
			voiceId: [...voiceIds][0] ?? 'default',
			maxRmsJumpDb: Number(effectiveMaxRmsJumpDb.toFixed(2)),
			maxZcrDelta: Number(effectiveMaxZcrDelta.toFixed(4)),
			intraClipMaxRmsDeltaDb: Number(intraClipMaxRmsDeltaDb.toFixed(2)),
			intraClipMaxZcrDelta: Number(intraClipMaxZcrDelta.toFixed(4)),
			totalClippedSamples: totalClipped,
			outputSampleRateHz: input.outputSampleRateHz ?? 48000,
		},
		findings,
	};
}
