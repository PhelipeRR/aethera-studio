/**
 * Aethera Social Publishing Hub — YouTubeChapterGenerator
 *
 * Generates, validates, edits, and injects YouTube video chapters from the final
 * rendered MP4 timeline (never from unrendered script estimates).
 *
 * Supports:
 * 1. Multi-Chapter Mangá Recap (from post-render RecapChapterMarker[])
 * 2. Single-Chapter Mangá Recap (Introdução, Eventos importantes, Mudanças de cenário, Conflitos, Desenvolvimento, Encerramento)
 * 3. Game / Cinema IA Long-Form Videos (Introdução, Apresentação, Gameplay, Análise, Conclusão)
 */

import type { RecapChapterMarker } from '../recap/recap-chapter-markers.js';

export type YouTubeChapterCategory =
	| 'intro'
	| 'important_events'
	| 'setting_change'
	| 'conflict'
	| 'story_development'
	| 'outro'
	| 'presentation'
	| 'gameplay'
	| 'analysis'
	| 'conclusion'
	| 'manga_chapter';

export interface YouTubeTimelineChapter {
	id: string;
	index: number;
	title: string;
	category: YouTubeChapterCategory;
	startMs: number;
	endMs: number;
	durationMs: number;
	timestampText: string;
	sourceChapterNumber?: number;
	sourceChapterId?: string;
	thumbnailUrl?: string;
}

export interface YouTubeChapterValidationResult {
	valid: boolean;
	errors: string[];
	chapterCount: number;
	startsAtZero: boolean;
	isChronological: boolean;
	allMinDurationMet: boolean;
	withinVideoDuration: boolean;
}

export interface RenderedTimelineSegmentInput {
	id: string;
	title?: string;
	narrationText?: string;
	categoryHint?: YouTubeChapterCategory;
	setting?: string;
	emotion?: string;
	startMs: number;
	durationMs: number;
	thumbnailUrl?: string;
}

const MIN_YOUTUBE_CHAPTERS = 3;
const MIN_CHAPTER_DURATION_MS = 10_000;

/**
 * Formats milliseconds into YouTube timestamp format (`MM:SS` or `HH:MM:SS`).
 */
export function formatYouTubeTimestamp(ms: number): string {
	const totalSec = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;
	const mm = String(minutes).padStart(2, '0');
	const ss = String(seconds).padStart(2, '0');
	if (hours > 0) {
		return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
	}
	return `${mm}:${ss}`;
}

/**
 * Parses `MM:SS` or `HH:MM:SS` into milliseconds. Returns null if invalid.
 */
export function parseYouTubeTimestampToMs(text: string): number | null {
	const trimmed = text.trim();
	const parts = trimmed.split(':');
	if (parts.length !== 2 && parts.length !== 3) return null;
	const nums = parts.map((p) => (/^\d+$/.test(p) ? Number.parseInt(p, 10) : Number.NaN));
	if (nums.some((n) => Number.isNaN(n) || n < 0)) return null;
	if (nums.length === 2) {
		const [m, s] = nums as [number, number];
		if (s >= 60) return null;
		return (m * 60 + s) * 1000;
	}
	const [h, m, s] = nums as [number, number, number];
	if (m >= 60 || s >= 60) return null;
	return (h * 3600 + m * 60 + s) * 1000;
}

/**
 * Validates a list of YouTube chapters against official YouTube Data API / Player requirements:
 * - First chapter starts at 00:00 (0 ms)
 * - At least 3 chapters
 * - Strictly chronological order
 * - Minimum duration of 10 seconds (10,000 ms) per chapter
 * - All timestamps within the rendered MP4 totalDurationMs
 */
export function validateYouTubeChapters(
	chapters: readonly Pick<YouTubeTimelineChapter, 'title' | 'startMs' | 'endMs'>[],
	totalVideoDurationMs: number,
): YouTubeChapterValidationResult {
	const errors: string[] = [];

	if (chapters.length < MIN_YOUTUBE_CHAPTERS) {
		errors.push(`O YouTube exige pelo menos ${MIN_YOUTUBE_CHAPTERS} capítulos (atual: ${chapters.length}).`);
	}

	const startsAtZero = chapters.length > 0 && Math.floor(chapters[0]!.startMs / 1000) === 0;
	if (!startsAtZero) {
		errors.push('O primeiro capítulo deve começar exatamente em 00:00.');
	}

	let isChronological = true;
	let allMinDurationMet = true;
	let withinVideoDuration = true;

	for (let i = 0; i < chapters.length; i++) {
		const ch = chapters[i]!;
		const next = chapters[i + 1];
		const effectiveEndMs = next ? next.startMs : Math.min(ch.endMs || totalVideoDurationMs, totalVideoDurationMs);
		const durationMs = effectiveEndMs - ch.startMs;

		if (!ch.title || !ch.title.trim()) {
			errors.push(`Capítulo ${i + 1} está sem título.`);
		}
		if (i > 0 && ch.startMs <= chapters[i - 1]!.startMs) {
			isChronological = false;
			errors.push(`Capítulo ${i + 1} ("${ch.title}") viola a ordem cronológica.`);
		}
		if (durationMs < MIN_CHAPTER_DURATION_MS) {
			allMinDurationMet = false;
			errors.push(
				`Capítulo ${i + 1} ("${ch.title}") tem duração inferior a 10 segundos (${Math.round(durationMs / 1000)}s).`,
			);
		}
		if (ch.startMs < 0 || ch.startMs >= totalVideoDurationMs || effectiveEndMs > totalVideoDurationMs + 500) {
			withinVideoDuration = false;
			errors.push(
				`Capítulo ${i + 1} ("${ch.title}") excede a duração real do MP4 (${formatYouTubeTimestamp(totalVideoDurationMs)}).`,
			);
		}
	}

	return {
		valid:
			chapters.length >= MIN_YOUTUBE_CHAPTERS &&
			startsAtZero &&
			isChronological &&
			allMinDurationMet &&
			withinVideoDuration &&
			errors.length === 0,
		errors,
		chapterCount: chapters.length,
		startsAtZero,
		isChronological,
		allMinDurationMet,
		withinVideoDuration,
	};
}

function normalizeChapterList(
	raw: Array<{
		id: string;
		title: string;
		category: YouTubeChapterCategory;
		startMs: number;
		endMs: number;
		sourceChapterNumber?: number;
		sourceChapterId?: string;
		thumbnailUrl?: string;
	}>,
	totalVideoDurationMs: number,
): YouTubeTimelineChapter[] {
	const sorted = [...raw].sort((a, b) => a.startMs - b.startMs);
	return sorted.map((item, idx) => {
		const next = sorted[idx + 1];
		const startMs = idx === 0 ? 0 : Math.max(0, Math.round(item.startMs));
		const endMs = next
			? Math.max(startMs, Math.round(next.startMs))
			: Math.max(startMs, Math.round(totalVideoDurationMs));
		return {
			id: item.id,
			index: idx + 1,
			title: item.title.trim(),
			category: item.category,
			startMs,
			endMs,
			durationMs: Math.max(0, endMs - startMs),
			timestampText: formatYouTubeTimestamp(startMs),
			...(item.sourceChapterNumber !== undefined ? { sourceChapterNumber: item.sourceChapterNumber } : {}),
			...(item.sourceChapterId ? { sourceChapterId: item.sourceChapterId } : {}),
			...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}),
		};
	});
}

export class YouTubeChapterGenerator {
	/**
	 * Generates YouTube chapters from real post-render `RecapChapterMarker[]` (Multi-Chapter Mangá Recap).
	 * If `markers[0].startMs >= 10_000`, prepends `00:00 Introdução` automatically.
	 * Never fabricates chapters if the video cannot satisfy YouTube's minimum rules.
	 */
	static fromRecapChapterMarkers(input: {
		markers: readonly RecapChapterMarker[];
		totalVideoDurationMs: number;
		includeIntroWhenOffset?: boolean;
	}): { chapters: YouTubeTimelineChapter[]; validation: YouTubeChapterValidationResult } {
		const totalMs = Math.round(input.totalVideoDurationMs);
		if (totalMs < MIN_YOUTUBE_CHAPTERS * MIN_CHAPTER_DURATION_MS || input.markers.length === 0) {
			return {
				chapters: [],
				validation: {
					valid: false,
					errors: ['O vídeo renderizado não possui duração ou marcadores suficientes para capítulos válidos do YouTube.'],
					chapterCount: 0,
					startsAtZero: false,
					isChronological: true,
					allMinDurationMet: false,
					withinVideoDuration: true,
				},
			};
		}

		const ordered = [...input.markers].sort((a, b) => a.startMs - b.startMs || a.chapterNumber - b.chapterNumber);
		const rawList: Parameters<typeof normalizeChapterList>[0] = [];

		const firstStartMs = ordered[0]!.startMs;
		if ((input.includeIntroWhenOffset ?? true) && firstStartMs >= MIN_CHAPTER_DURATION_MS) {
			rawList.push({
				id: 'yt-ch-intro',
				title: 'Introdução',
				category: 'intro',
				startMs: 0,
				endMs: firstStartMs,
				...(ordered[0]!.thumbnailPath ? { thumbnailUrl: ordered[0]!.thumbnailPath } : {}),
			});
		}

		for (let i = 0; i < ordered.length; i++) {
			const m = ordered[i]!;
			const startMs = rawList.length === 0 && i === 0 ? 0 : m.startMs;
			const hasPrefix = /^cap[íi]tulo\s+\d+/i.test(m.chapterTitle.trim());
			const title = hasPrefix ? m.chapterTitle.trim() : `Capítulo ${m.chapterNumber} — ${m.chapterTitle.trim()}`;
			rawList.push({
				id: `yt-ch-${m.chapterNumber}`,
				title,
				category: 'manga_chapter',
				startMs,
				endMs: m.endMs,
				sourceChapterNumber: m.chapterNumber,
				sourceChapterId: m.sourceChapterId,
				...(m.thumbnailPath ? { thumbnailUrl: m.thumbnailPath } : {}),
			});
		}

		const chapters = normalizeChapterList(rawList, totalMs);
		const validation = validateYouTubeChapters(chapters, totalMs);
		if (!validation.valid) {
			return { chapters: [], validation };
		}
		return { chapters, validation };
	}

	/**
	 * Generates YouTube chapters from rendered timeline segments/shots for Single-Chapter Mangá Recap
	 * or Game / Cinema IA videos.
	 *
	 * Never fabricates timestamps: merges short segments (<10s) into neighboring narrative blocks
	 * and returns empty chapters if the rendered MP4 cannot host at least 3 valid chapters of >=10s.
	 */
	static fromRenderedTimeline(input: {
		mode: 'manga_recap' | 'game_video';
		segments: readonly RenderedTimelineSegmentInput[];
		totalVideoDurationMs: number;
	}): { chapters: YouTubeTimelineChapter[]; validation: YouTubeChapterValidationResult } {
		const totalMs = Math.round(input.totalVideoDurationMs);
		if (totalMs < MIN_YOUTUBE_CHAPTERS * MIN_CHAPTER_DURATION_MS || input.segments.length === 0) {
			return {
				chapters: [],
				validation: {
					valid: false,
					errors: ['A duração real do MP4 não comporta ao menos 3 capítulos de 10 segundos sem timestamps artificiais.'],
					chapterCount: 0,
					startsAtZero: false,
					isChronological: true,
					allMinDurationMet: false,
					withinVideoDuration: true,
				},
			};
		}

		const ordered = [...input.segments]
			.filter((s) => s.durationMs > 0 && s.startMs < totalMs)
			.sort((a, b) => a.startMs - b.startMs);

		if (ordered.length === 0) {
			return {
				chapters: [],
				validation: validateYouTubeChapters([], totalMs),
			};
		}

		const mangaLabels: Array<{ category: YouTubeChapterCategory; defaultTitle: string }> = [
			{ category: 'intro', defaultTitle: 'Introdução' },
			{ category: 'important_events', defaultTitle: 'Eventos importantes' },
			{ category: 'setting_change', defaultTitle: 'Mudanças relevantes de cenário' },
			{ category: 'conflict', defaultTitle: 'Conflitos' },
			{ category: 'story_development', defaultTitle: 'Desenvolvimento da história' },
			{ category: 'outro', defaultTitle: 'Encerramento' },
		];

		const gameLabels: Array<{ category: YouTubeChapterCategory; defaultTitle: string }> = [
			{ category: 'intro', defaultTitle: 'Introdução' },
			{ category: 'presentation', defaultTitle: 'Apresentação' },
			{ category: 'gameplay', defaultTitle: 'Gameplay' },
			{ category: 'analysis', defaultTitle: 'Análise' },
			{ category: 'conclusion', defaultTitle: 'Conclusão' },
		];

		const template = input.mode === 'manga_recap' ? mangaLabels : gameLabels;
		const maxPossibleBuckets = Math.min(
			template.length,
			ordered.length,
			Math.floor(totalMs / MIN_CHAPTER_DURATION_MS),
		);

		if (maxPossibleBuckets < MIN_YOUTUBE_CHAPTERS) {
			return {
				chapters: [],
				validation: {
					valid: false,
					errors: ['Segmentos renderizados insuficientes para formar 3 capítulos reais de pelo menos 10s.'],
					chapterCount: 0,
					startsAtZero: false,
					isChronological: true,
					allMinDurationMet: false,
					withinVideoDuration: true,
				},
			};
		}

		// Group ordered rendered segments into narrative buckets while guaranteeing each bucket >= 10,000 ms
		const rawBuckets: Parameters<typeof normalizeChapterList>[0] = [];
		let currentStartMs = 0;
		let currentThumb = ordered[0]?.thumbnailUrl;
		let bucketIndex = 0;

		for (let i = 0; i < ordered.length; i++) {
			const seg = ordered[i]!;
			const nextSeg = ordered[i + 1];
			const segEndMs = nextSeg ? nextSeg.startMs : totalMs;
			const accumulatedMs = segEndMs - currentStartMs;
			const remainingMs = totalMs - segEndMs;
			const remainingBucketsNeeded = maxPossibleBuckets - (bucketIndex + 1);

			const canCloseBucket =
				accumulatedMs >= MIN_CHAPTER_DURATION_MS &&
				(remainingBucketsNeeded <= 0 || remainingMs >= remainingBucketsNeeded * MIN_CHAPTER_DURATION_MS);

			const isLastSeg = i === ordered.length - 1;
			if ((canCloseBucket && bucketIndex < maxPossibleBuckets - 1) || isLastSeg) {
				const slot = isLastSeg
					? template[template.length - 1]!
					: template[Math.min(bucketIndex, template.length - 2)]!;
				const customTitle = seg.title?.trim();
				const title = customTitle && !customTitle.startsWith('Cena ')
					? `${slot.defaultTitle}: ${customTitle}`
					: slot.defaultTitle;

				rawBuckets.push({
					id: `yt-ch-${bucketIndex + 1}`,
					title,
					category: slot.category,
					startMs: currentStartMs,
					endMs: isLastSeg ? totalMs : segEndMs,
					...(currentThumb ? { thumbnailUrl: currentThumb } : {}),
				});
				bucketIndex++;
				currentStartMs = segEndMs;
				currentThumb = nextSeg?.thumbnailUrl;
			}
		}

		const chapters = normalizeChapterList(rawBuckets, totalMs);
		const validation = validateYouTubeChapters(chapters, totalMs);
		if (!validation.valid) {
			return { chapters: [], validation };
		}
		return { chapters, validation };
	}

	/**
	 * Manual CRUD operations on YouTube chapters (edit title/timestamp, add, delete)
	 * with immediate re-normalization and validation against the rendered MP4 duration.
	 */
	static updateChapters(input: {
		chapters: readonly YouTubeTimelineChapter[];
		action:
			| { type: 'edit'; id: string; title?: string; startMs?: number }
			| { type: 'delete'; id: string }
			| { type: 'add'; title: string; startMs: number; category?: YouTubeChapterCategory; thumbnailUrl?: string };
		totalVideoDurationMs: number;
	}): { chapters: YouTubeTimelineChapter[]; validation: YouTubeChapterValidationResult } {
		const totalMs = Math.round(input.totalVideoDurationMs);
		let working = input.chapters.map((c) => ({ ...c }));

		if (input.action.type === 'delete') {
			working = working.filter((c) => c.id !== input.action.id);
		} else if (input.action.type === 'edit') {
			const act = input.action;
			working = working.map((c) =>
				c.id === act.id
					? {
							...c,
							...(act.title !== undefined ? { title: act.title } : {}),
							...(act.startMs !== undefined ? { startMs: act.startMs } : {}),
						}
					: c,
			);
		} else if (input.action.type === 'add') {
			working.push({
				id: `yt-ch-custom-${Date.now()}-${working.length + 1}`,
				index: working.length + 1,
				title: input.action.title,
				category: input.action.category ?? 'important_events',
				startMs: input.action.startMs,
				endMs: totalMs,
				durationMs: Math.max(0, totalMs - input.action.startMs),
				timestampText: formatYouTubeTimestamp(input.action.startMs),
				...(input.action.thumbnailUrl ? { thumbnailUrl: input.action.thumbnailUrl } : {}),
			});
		}

		const sorted = [...working].sort((a, b) => a.startMs - b.startMs);
		const recalculated: YouTubeTimelineChapter[] = sorted.map((item, idx) => {
			const next = sorted[idx + 1];
			const startMs = Math.round(item.startMs);
			const endMs = next ? Math.round(next.startMs) : totalMs;
			return {
				...item,
				index: idx + 1,
				startMs,
				endMs,
				durationMs: Math.max(0, endMs - startMs),
				timestampText: formatYouTubeTimestamp(startMs),
			};
		});

		const validation = validateYouTubeChapters(recalculated, totalMs);
		return { chapters: recalculated, validation };
	}

	/**
	 * Formats approved chapters and injects (or replaces) the chapters block inside
	 * the YouTube video description.
	 */
	static injectIntoDescription(
		baseDescription: string,
		chapters: readonly YouTubeTimelineChapter[],
		totalVideoDurationMs: number,
	): string {
		const validation = validateYouTubeChapters(chapters, totalVideoDurationMs);
		const stripped = baseDescription
			.replace(/\n*⏱️ CAPÍTULOS DO VÍDEO:\n(?:\d{2}:\d{2}(?::\d{2})?\s+[^\n]+\n?)+/g, '')
			.trim();

		if (!validation.valid || chapters.length < MIN_YOUTUBE_CHAPTERS) {
			return stripped;
		}

		const chapterLines = [
			'⏱️ CAPÍTULOS DO VÍDEO:',
			...chapters.map((ch) => `${formatYouTubeTimestamp(ch.startMs)} ${ch.title}`),
		].join('\n');

		// Place right before Credits/Hashtags if present, or at the end
		const creditsIdx = stripped.indexOf('⚖️ CRÉDITOS E FONTES:');
		if (creditsIdx >= 0) {
			const before = stripped.slice(0, creditsIdx).trim();
			const after = stripped.slice(creditsIdx).trim();
			return `${before}\n\n${chapterLines}\n\n${after}`;
		}
		return stripped ? `${stripped}\n\n${chapterLines}` : chapterLines;
	}
}
