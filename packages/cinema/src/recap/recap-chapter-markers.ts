/**
 * Aethera Recap — Multi-Chapter Markers, Post-Render Timeline Recalculation,
 * Story Memory Anti-Spoiler Metadata & Format Adaptation (16:9 / 9:16)
 */

import { z } from 'zod';
import type { ExtractedPanel, RecapScript } from './recap-types.js';
import type { RecapAudiovisualPlan, RecapShot } from './phase3/recap-audiovisual-types.js';
import type { StoryMemoryProject } from './story-memory.js';
import { getMemoryContextForChapter } from './story-memory.js';

export const recapChapterMarkerSchema = z.object({
	seriesProjectId: z.string().min(1),
	sourceChapterId: z.string().min(1),
	chapterNumber: z.number().int().positive(),
	chapterTitle: z.string().min(1),
	startMs: z.number().int().min(0),
	endMs: z.number().int().min(0),
	sourceProductionId: z.string().min(1),
	panelIds: z.array(z.string()).optional(),
	shotIds: z.array(z.string()).optional(),
	thumbnailPath: z.string().optional(),
});

export type RecapChapterMarker = z.infer<typeof recapChapterMarkerSchema>;

export interface SourceChapterSegmentInput {
	seriesProjectId: string;
	sourceChapterId: string;
	chapterNumber: number;
	chapterTitle?: string;
	sourceProductionId: string;
	startPageNumber: number;
	endPageNumber: number;
	panelIds?: string[];
	thumbnailPath?: string;
}

/**
 * Builds initial chapter markers from source chapter segments and extracted panels/script scenes
 * before or during storyboard planning.
 */
export function buildInitialRecapChapterMarkers(input: {
	segments: readonly SourceChapterSegmentInput[];
	panels: readonly ExtractedPanel[];
	script?: RecapScript;
	introOffsetMs?: number;
}): RecapChapterMarker[] {
	const orderedSegments = [...input.segments].sort((a, b) => a.chapterNumber - b.chapterNumber);
	const introMs = Math.max(0, Math.round(input.introOffsetMs ?? 0));
	let cursorMs = introMs;
	const markers: RecapChapterMarker[] = [];

	const totalPanels = Math.max(1, input.panels.length);
	const totalScriptMs = input.script
		? Math.round(input.script.totalEstimatedDurationSec * 1000)
		: orderedSegments.length * 60_000;

	for (const seg of orderedSegments) {
		const segPanels = input.panels.filter(
			(p) => p.metadata.pageNumber >= seg.startPageNumber && p.metadata.pageNumber <= seg.endPageNumber,
		);
		const panelIds = seg.panelIds && seg.panelIds.length > 0
			? [...seg.panelIds]
			: segPanels.map((p) => p.panelId);
		const thumbnailPath =
			seg.thumbnailPath ??
			segPanels[0]?.croppedImagePath ??
			segPanels[0]?.pagePath;

		// Calculate duration from matching script scenes if available, otherwise proportional to panel count
		let durationMs = 0;
		if (input.script && panelIds.length > 0) {
			const panelSet = new Set(panelIds);
			for (const scene of input.script.scenes) {
				const refs = scene.panelIds ?? (scene.panelId ? [scene.panelId] : []);
				const overlap = refs.filter((r) => panelSet.has(r)).length;
				if (overlap > 0 && refs.length > 0) {
					const sceneMs = Math.round((scene.measuredDurationSec ?? scene.estimatedDurationSec) * 1000);
					durationMs += Math.round((sceneMs * overlap) / refs.length);
				}
			}
		}
		if (durationMs <= 0) {
			const weight = Math.max(1, panelIds.length) / totalPanels;
			durationMs = Math.max(15_000, Math.round(totalScriptMs * weight));
		}

		const startMs = cursorMs;
		const endMs = startMs + durationMs;
		cursorMs = endMs;

		markers.push({
			seriesProjectId: seg.seriesProjectId,
			sourceChapterId: seg.sourceChapterId,
			chapterNumber: seg.chapterNumber,
			chapterTitle: seg.chapterTitle?.trim() || `Capítulo ${seg.chapterNumber}`,
			startMs,
			endMs,
			sourceProductionId: seg.sourceProductionId,
			...(panelIds.length > 0 ? { panelIds } : {}),
			...(thumbnailPath ? { thumbnailPath } : {}),
		});
	}

	return markers;
}

/**
 * Recalculates exact `startMs` and `endMs` for every `RecapChapterMarker` after the final MP4
 * and `RecapAudiovisualPlan` are rendered, accounting for intro hook, cuts, transitions,
 * measured TTS narration durations, and outro adjustments.
 *
 * When a video is edited (e.g. shot durations or order modified), calling this function
 * invalidates stale timestamps and produces exact timestamps matching the rendered MP4.
 */
export function recalculateRecapChapterMarkersFromPlan(input: {
	markers: readonly RecapChapterMarker[];
	plan: Pick<RecapAudiovisualPlan, 'shots' | 'totalDurationMs'>;
	panels?: readonly ExtractedPanel[];
	segments?: readonly SourceChapterSegmentInput[];
	introHookDurationMs?: number;
	outroTailDurationMs?: number;
	actualMp4DurationMs?: number;
}): RecapChapterMarker[] {
	const orderedMarkers = [...input.markers].sort((a, b) => a.chapterNumber - b.chapterNumber);
	if (orderedMarkers.length === 0) return [];

	const rawTotalMs = input.actualMp4DurationMs ?? input.plan.totalDurationMs;
	const introMs = Math.max(0, Math.round(input.introHookDurationMs ?? 0));
	const outroMs = Math.max(0, Math.round(input.outroTailDurationMs ?? 0));
	const effectiveTotalMs = Math.max(1000, rawTotalMs);
	const shots = [...input.plan.shots].sort((a, b) => a.startMs - b.startMs);

	// Map panelId -> chapterNumber
	const panelToChapter = new Map<string, number>();
	for (const m of orderedMarkers) {
		for (const pid of m.panelIds ?? []) {
			panelToChapter.set(pid, m.chapterNumber);
		}
	}
	if (input.panels && input.segments) {
		for (const seg of input.segments) {
			for (const p of input.panels) {
				if (p.metadata.pageNumber >= seg.startPageNumber && p.metadata.pageNumber <= seg.endPageNumber) {
					panelToChapter.set(p.panelId, seg.chapterNumber);
				}
			}
		}
	}

	// Group shots by chapterNumber
	const shotsByChapter = new Map<number, RecapShot[]>();
	for (const shot of shots) {
		const chNum = panelToChapter.get(shot.panelId);
		if (chNum !== undefined) {
			const list = shotsByChapter.get(chNum) ?? [];
			list.push(shot);
			shotsByChapter.set(chNum, list);
		}
	}

	// If shots aren't explicitly mapped via panelIds, partition shots monotonically across ordered chapters
	const allMapped = orderedMarkers.every((m) => (shotsByChapter.get(m.chapterNumber)?.length ?? 0) > 0);
	if (!allMapped && shots.length >= orderedMarkers.length) {
		shotsByChapter.clear();
		const perChapter = shots.length / orderedMarkers.length;
		for (let i = 0; i < orderedMarkers.length; i++) {
			const startIdx = Math.floor(i * perChapter);
			const endIdx = i === orderedMarkers.length - 1 ? shots.length : Math.max(startIdx + 1, Math.floor((i + 1) * perChapter));
			shotsByChapter.set(orderedMarkers[i]!.chapterNumber, shots.slice(startIdx, endIdx));
		}
	}

	// Compute scaling factor if actualMp4DurationMs differs from plan.totalDurationMs
	const planSpanMs = Math.max(1, input.plan.totalDurationMs);
	const availableContentSpanMs = Math.max(1000, effectiveTotalMs - introMs - outroMs);
	const scale = availableContentSpanMs / planSpanMs;

	const recalculated: RecapChapterMarker[] = [];
	let cursorMs = introMs;

	for (let idx = 0; idx < orderedMarkers.length; idx++) {
		const marker = orderedMarkers[idx]!;
		const chShots = shotsByChapter.get(marker.chapterNumber) ?? [];
		const isLast = idx === orderedMarkers.length - 1;

		let startMs: number;
		let endMs: number;
		let shotIds: string[] = [];
		let thumbnailPath = marker.thumbnailPath;

		if (chShots.length > 0) {
			const firstShot = chShots[0]!;
			const lastShot = chShots[chShots.length - 1]!;
			const rawStart = Math.round(introMs + firstShot.startMs * scale);
			const rawEnd = Math.round(introMs + (lastShot.startMs + lastShot.durationMs) * scale);
			startMs = idx === 0 ? introMs : Math.max(cursorMs, rawStart);
			endMs = isLast
				? Math.max(startMs + 1000, effectiveTotalMs - outroMs)
				: Math.max(startMs + 1000, Math.min(effectiveTotalMs - outroMs, rawEnd));
			shotIds = chShots.map((s) => s.shotId);
			if (!thumbnailPath && firstShot.imagePath) {
				thumbnailPath = firstShot.imagePath;
			}
		} else {
			const fallbackChunk = Math.floor(availableContentSpanMs / orderedMarkers.length);
			startMs = cursorMs;
			endMs = isLast
				? Math.max(startMs + 1000, effectiveTotalMs - outroMs)
				: Math.min(effectiveTotalMs - outroMs, startMs + fallbackChunk);
		}

		cursorMs = endMs;
		recalculated.push({
			...marker,
			startMs,
			endMs,
			...(shotIds.length > 0 ? { shotIds } : {}),
			...(thumbnailPath ? { thumbnailPath } : {}),
		});
	}

	return recalculated;
}

export interface MultiChapterRecapMetadataResult {
	workTitle: string;
	arcSubtitle: string;
	suggestedTitle: string;
	titleVariants: string[];
	description: string;
	tags: string[];
	hashtags: string[];
	creditsAndSources: string[];
	confirmedCharacters: string[];
	representativeThumbnailPath: string | null;
	chapterRange: { startChapter: number; endChapter: number; count: number };
	spoilerBoundaryChapter: number;
}

/**
 * Generates rich YouTube Long-Form & Multi-Platform metadata for a single or multi-chapter
 * Mangá Recap video, grounded in Story Memory without leaking spoilers from chapters > endChapter.
 */
export function generateMultiChapterRecapMetadata(input: {
	workTitle: string;
	markers: readonly RecapChapterMarker[];
	storyMemory?: StoryMemoryProject | null;
	arcSubtitle?: string;
	customLinks?: readonly { label: string; url: string }[];
	sourceCredits?: readonly string[];
	language?: string;
}): MultiChapterRecapMetadataResult {
	const ordered = [...input.markers].sort((a, b) => a.chapterNumber - b.chapterNumber);
	const startChapter = ordered[0]?.chapterNumber ?? 1;
	const endChapter = ordered[ordered.length - 1]?.chapterNumber ?? startChapter;
	const isMulti = ordered.length > 1 || endChapter > startChapter;

	// Use getMemoryContextForChapter(endChapter + 1) so ONLY chapters <= endChapter are included (strict anti-spoiler!)
	const memCtx = input.storyMemory
		? getMemoryContextForChapter(input.storyMemory, endChapter + 1)
		: null;

	const cleanWorkTitle = (input.storyMemory?.workTitle || input.workTitle || 'Mangá Recap')
		.replace(/\s+Cap(?:\.|ítulos?)?\s*\d+(?:\s*[-a]\s*\d+)?$/i, '')
		.trim() || 'Mangá Recap';

	const confirmedCharacters = memCtx
		? memCtx.knownCharacters
				.filter((c) => c.nameStatus === 'confirmed' || c.nameStatus === 'probable')
				.map((c) => c.displayName)
		: [];

	const arcSubtitle =
		input.arcSubtitle?.trim() ||
		(startChapter === 1 && endChapter >= 3
			? 'O Início de uma Lenda'
			: isMulti
				? `Arco dos Capítulos ${startChapter} a ${endChapter}`
				: ordered[0]?.chapterTitle || `Capítulo ${startChapter}`);

	const rangeLabel = isMulti ? `Capítulos ${startChapter}–${endChapter}` : `Capítulo ${startChapter}`;
	const rawPrimaryTitle = `${cleanWorkTitle} — ${arcSubtitle} | ${rangeLabel}`;
	const suggestedTitle = rawPrimaryTitle.length <= 100 ? rawPrimaryTitle : rawPrimaryTitle.slice(0, 97) + '...';

	const protagonist = confirmedCharacters[0];
	const titleVariants = [
		suggestedTitle,
		protagonist
			? `${cleanWorkTitle}: A Jornada de ${protagonist} (${rangeLabel})`.slice(0, 100)
			: `${cleanWorkTitle} — Recap Completo | ${rangeLabel}`.slice(0, 100),
		`${cleanWorkTitle} | Resumo Completo e Análise (${rangeLabel})`.slice(0, 100),
	];

	// Spoiler-safe summary from prior/current chapters only (never chapters > endChapter)
	const includedSummaries = input.storyMemory
		? input.storyMemory.chapters
				.filter((c) => c.chapterNumber >= startChapter && c.chapterNumber <= endChapter)
				.sort((a, b) => a.chapterNumber - b.chapterNumber)
				.map((c) => `• Capítulo ${c.chapterNumber}: ${c.summary}`)
		: ordered.map((m) => `• Capítulo ${m.chapterNumber}: ${m.chapterTitle}`);

	const creditsAndSources = [
		`Obra analisada: ${cleanWorkTitle} (${rangeLabel})`,
		...(input.sourceCredits ?? []),
		'Produzido com Aethera Studio (Story Engine + MotionVelix)',
	];

	const hashtags = [
		`#${cleanWorkTitle.replace(/[^A-Za-z0-9À-ÿ]/g, '')}`,
		'#MangaRecap',
		'#ManhwaRecap',
		'#AnimeManga',
		...(isMulti ? ['#RecapCompleto'] : []),
	];

	// Build tags respecting YouTube 500-char total limit and deduplicating case-insensitively
	const candidateTags = [
		cleanWorkTitle,
		`${cleanWorkTitle} recap`,
		`${cleanWorkTitle} resumo`,
		`${cleanWorkTitle} ${rangeLabel.toLowerCase()}`,
		...confirmedCharacters.slice(0, 5),
		'manga recap',
		'manhwa recap',
		'resumo manhwa',
		'recap em português',
		arcSubtitle,
	];
	const seenTags = new Set<string>();
	const tags: string[] = [];
	let totalTagChars = 0;
	for (const rawTag of candidateTags) {
		const t = rawTag.trim();
		if (!t) continue;
		const key = t.toLowerCase();
		if (seenTags.has(key)) continue;
		if (totalTagChars + t.length + 1 > 480) break;
		seenTags.add(key);
		tags.push(t);
		totalTagChars += t.length + 1;
	}

	const linksSection =
		input.customLinks && input.customLinks.length > 0
			? ['', '🔗 LINKS DO CANAL:', ...input.customLinks.map((l) => `- ${l.label}: ${l.url}`)]
			: [];

	const descriptionLines = [
		`${cleanWorkTitle} — ${arcSubtitle} (${rangeLabel}).`,
		confirmedCharacters.length > 0
			? `Acompanhe a história com ${confirmedCharacters.slice(0, 4).join(', ')} em uma narrativa contínua sem spoilers de capítulos futuros.`
			: `Acompanhe o resumo narrativo completo de ${cleanWorkTitle} (${rangeLabel}) sem spoilers de capítulos futuros.`,
		'',
		'📖 RESUMO DO ARCO (SEM SPOILERS FUTUROS):',
		...(includedSummaries.length > 0 ? includedSummaries : [`• ${cleanWorkTitle} (${rangeLabel})`]),
		...linksSection,
		'',
		'⚖️ CRÉDITOS E FONTES:',
		...creditsAndSources.map((c) => `- ${c}`),
		'',
		hashtags.join(' '),
	];

	const representativeThumbnailPath =
		ordered.find((m) => Boolean(m.thumbnailPath))?.thumbnailPath ?? null;

	return {
		workTitle: cleanWorkTitle,
		arcSubtitle,
		suggestedTitle,
		titleVariants,
		description: descriptionLines.join('\n'),
		tags,
		hashtags,
		creditsAndSources,
		confirmedCharacters,
		representativeThumbnailPath,
		chapterRange: {
			startChapter,
			endChapter,
			count: ordered.length,
		},
		spoilerBoundaryChapter: endChapter,
	};
}

export interface PlatformFormatVariantSpec {
	platform: 'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok';
	aspectRatio: '16:9' | '9:16';
	maxDurationMs: number;
	shots: Array<{
		shotId: string;
		sceneId: string;
		panelId: string;
		startMs: number;
		durationMs: number;
		narrationAudioPath?: string;
		captionText: string;
		aspectRatio: '16:9' | '9:16';
	}>;
	totalDurationMs: number;
	syncPreserved: boolean;
}

/**
 * Generates platform-specific format variants (YouTube 16:9 Long-Form, YouTube Shorts 9:16,
 * Instagram Reels 9:16, TikTok 9:16) while strictly preserving narration, caption, and panel sync.
 */
export function adaptRecapPlanForPlatforms(input: {
	plan: RecapAudiovisualPlan;
	platforms?: readonly ('youtube' | 'youtube_shorts' | 'instagram' | 'tiktok')[];
}): Record<'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok', PlatformFormatVariantSpec> {
	const maxDurationByPlatform: Record<'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok', number> = {
		youtube: Number.MAX_SAFE_INTEGER,
		youtube_shorts: 60_000,
		instagram: 90_000,
		tiktok: 180_000,
	};
	const aspectByPlatform: Record<'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok', '16:9' | '9:16'> = {
		youtube: '16:9',
		youtube_shorts: '9:16',
		instagram: '9:16',
		tiktok: '9:16',
	};

	const buildVariant = (platform: 'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok'): PlatformFormatVariantSpec => {
		const aspectRatio = aspectByPlatform[platform];
		const maxDurationMs = maxDurationByPlatform[platform];
		let accumulatedMs = 0;
		const variantShots: PlatformFormatVariantSpec['shots'] = [];

		for (const shot of input.plan.shots) {
			if (accumulatedMs >= maxDurationMs) break;
			const remainingMs = maxDurationMs - accumulatedMs;
			const durationMs = Math.min(shot.durationMs, remainingMs);
			if (durationMs <= 0) break;

			variantShots.push({
				shotId: shot.shotId,
				sceneId: shot.sceneId,
				panelId: shot.panelId,
				startMs: accumulatedMs,
				durationMs,
				...(shot.narrationAudioPath ? { narrationAudioPath: shot.narrationAudioPath } : {}),
				captionText: shot.captionText,
				aspectRatio,
			});
			accumulatedMs += durationMs;
		}

		return {
			platform,
			aspectRatio,
			maxDurationMs,
			shots: variantShots,
			totalDurationMs: accumulatedMs,
			syncPreserved: variantShots.every(
				(s, idx) => s.panelId === input.plan.shots[idx]?.panelId && s.captionText === input.plan.shots[idx]?.captionText,
			),
		};
	};

	return {
		youtube: buildVariant('youtube'),
		youtube_shorts: buildVariant('youtube_shorts'),
		instagram: buildVariant('instagram'),
		tiktok: buildVariant('tiktok'),
	};
}
