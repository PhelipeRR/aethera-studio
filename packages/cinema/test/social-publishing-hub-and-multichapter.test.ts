import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	EditorialCalendarEngine,
	SocialPublishingHub,
	YouTubeChapterGenerator,
	adaptRecapPlanForPlatforms,
	buildInitialRecapChapterMarkers,
	consolidateChapterIntoStoryMemory,
	createOrLoadStoryMemoryProject,
	generateMultiChapterRecapMetadata,
	localDateTimeToUtcIso,
	normalizeAndValidateYouTubeTags,
	recalculateRecapChapterMarkersFromPlan,
	validateYouTubeChapters,
	validateYouTubeThumbnailSpec,
	type ExtractedPanel,
	type RecapAudiovisualPlan,
} from '../src/index.js';

function makePanel(chapterNum: number, pageNum: number): ExtractedPanel {
	return {
		panelId: `ch${chapterNum}-p${pageNum}`,
		pagePath: `/tmp/ch${chapterNum}-p${pageNum}.png`,
		croppedImagePath: `/tmp/ch${chapterNum}-p${pageNum}.png`,
		width: 800,
		height: 1200,
		imageHash: `hash-${chapterNum}-${pageNum}`,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: `nano-machine-ch-${chapterNum}`,
			pageNumber: pageNum,
			panelIndex: 0,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: 0, w: 800, h: 1200 },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
	};
}

describe('Aethera Social Publishing Hub, Unified Calendar, YouTube Long-Form Studio & Multi-Chapter Recap', () => {
	let workDir: string;
	let calendarStorePath: string;

	beforeEach(() => {
		workDir = join(tmpdir(), `aethera-pub-hub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(workDir, { recursive: true });
		calendarStorePath = join(workDir, 'editorial-calendar-store.json');
	});

	afterEach(() => {
		if (existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it('1–5 & Reference Scenario: 25/11/2026 18:00 America/Sao_Paulo -> 2026-11-25T21:00:00.000Z, bidirectional sync & restart persistence', () => {
		const utcIso = localDateTimeToUtcIso('2026-11-25', '18:00', 'America/Sao_Paulo');
		expect(utcIso).toBe('2026-11-25T21:00:00.000Z');

		const calendar = new EditorialCalendarEngine(calendarStorePath, 'America/Sao_Paulo');
		const hub = new SocialPublishingHub(calendar);

		// 1. Create from Publication screen using reference scenario
		const refInput = SocialPublishingHub.createReferenceScheduleInput();
		const created = hub.schedulePublication(refInput);
		expect(created.scheduledPublishAtIso).toBe('2026-11-25T21:00:00.000Z');
		expect(created.platforms).toEqual(['youtube', 'instagram', 'tiktok']);
		expect(created.publicationId).toBe(created.id);

		// 2. Appears in Calendar with identical ID and zero duplicates
		const calSnap = calendar.getSnapshot();
		expect(calSnap.events).toHaveLength(1);
		expect(calSnap.events[0]?.id).toBe(created.id);
		expect(calSnap.events[0]?.scheduledPublishAtIso).toBe('2026-11-25T21:00:00.000Z');

		// 3 & 4. Reschedule from Calendar -> updates Publication view
		const newIso = localDateTimeToUtcIso('2026-11-26', '19:30', 'America/Sao_Paulo');
		const moved = calendar.moveEvent({
			id: created.id,
			targetDateIso: newIso,
			targetKind: 'scheduled',
			reason: 'Ajuste editorial pelo Calendário',
		});
		expect(moved.scheduledPublishAtIso).toBe('2026-11-26T22:30:00.000Z');
		expect(moved.rescheduleHistory).toHaveLength(1);

		// 5. Simulate restart by reloading EditorialCalendarEngine from disk
		const reloadedCalendar = new EditorialCalendarEngine(calendarStorePath, 'America/Sao_Paulo');
		const reloadedSnap = reloadedCalendar.getSnapshot();
		expect(reloadedSnap.events).toHaveLength(1);
		expect(reloadedSnap.events[0]?.publicationId).toBe(created.id);
		expect(reloadedSnap.events[0]?.scheduledPublishAtIso).toBe('2026-11-26T22:30:00.000Z');
		expect(reloadedSnap.events[0]?.rescheduleHistory).toHaveLength(1);
	});

	it('6–10. Multi-platform fault isolation (YouTube OK, TikTok FAIL, Instagram independent), idempotency, cancel without duplicates & audit log', async () => {
		const calendar = new EditorialCalendarEngine(calendarStorePath, 'America/Sao_Paulo');
		const hub = new SocialPublishingHub(calendar);

		const created = hub.schedulePublication(SocialPublishingHub.createReferenceScheduleInput());
		let executeCalls = 0;

		// Simulate cloud worker tick while Desktop & Remote Host are offline
		const tick = await hub.executeDuePublications({
			nowIso: '2026-11-25T21:05:00.000Z',
			dryRun: true,
			executor: {
				publish: async ({ platform }) => {
					executeCalls++;
					if (platform === 'youtube') return { ok: true, remoteId: 'yt_vid_001', remoteUrl: 'https://youtu.be/yt_vid_001' };
					if (platform === 'tiktok') return { ok: false, error: 'TikTok OAuth token expired (401)' };
					return { ok: true, remoteId: 'ig_reel_001', remoteUrl: 'https://instagram.com/reel/ig_reel_001' };
				},
			},
		});

		expect(tick.processedPublications).toEqual([created.id]);
		expect(executeCalls).toBe(3);

		const afterTick = calendar.getSnapshot().events[0]!;
		expect(afterTick.platformTargets?.youtube?.status).toBe('published');
		expect(afterTick.platformTargets?.tiktok?.status).toBe('failed');
		expect(afterTick.platformTargets?.tiktok?.lastError).toContain('TikTok OAuth');
		expect(afterTick.platformTargets?.instagram?.status).toBe('published');
		expect(afterTick.auditLog?.length).toBeGreaterThanOrEqual(4);

		// Re-running worker tick must NOT duplicate YouTube or Instagram due to idempotency
		const secondTick = await hub.executeDuePublications({
			nowIso: '2026-11-25T21:10:00.000Z',
			dryRun: true,
			executor: {
				publish: async ({ platform }) => {
					executeCalls++;
					return { ok: true, remoteId: `retry_${platform}` };
				},
			},
		});
		expect(secondTick.results.every((r) => r.platform === 'tiktok')).toBe(true);

		// Cancel another scheduled event without duplicating
		const secondEvent = hub.schedulePublication(
			SocialPublishingHub.createReferenceScheduleInput({
				publicationId: 'pub_to_cancel',
				title: 'Episódio para Cancelar',
			}),
		);
		const cancelled = hub.cancelPublication({
			publicationId: secondEvent.id,
			reason: 'Cancelado pelo usuário',
		});
		expect(cancelled.status).toBe('cancelled');
		expect(calendar.getSnapshot().events.filter((e) => e.id === secondEvent.id)).toHaveLength(1);
		expect(cancelled.auditLog?.some((a) => a.action === 'cancelled')).toBe(true);
	});

	it('Quality Gates & Rights Verification guard: blocks scheduling when mandatory gates or rights are unverified', () => {
		const calendar = new EditorialCalendarEngine(calendarStorePath, 'America/Sao_Paulo');
		const hub = new SocialPublishingHub(calendar);

		expect(() =>
			hub.schedulePublication(
				SocialPublishingHub.createReferenceScheduleInput({
					qualityGates: { gateF: 'pass', gateG: 'fail', gateH: 'pass', allMandatoryPassed: false },
				}),
			),
		).toThrow(/quality_gates_required/);

		expect(() =>
			hub.schedulePublication(
				SocialPublishingHub.createReferenceScheduleInput({
					rightsVerification: {
						verified: false,
						sourceAuthorized: false,
						musicAndSfxLicensed: true,
						noProhibitedWatermarks: true,
						transformativeEditorialUse: true,
					},
				}),
			),
		).toThrow(/rights_verification_required/);
	});

	it('YouTube Long-Form Studio: Thumbnail validation, approved thumbnail confirmation, tags deduplication & YouTubeChapterGenerator rules', () => {
		// Thumbnail validation
		expect(
			validateYouTubeThumbnailSpec({
				mimeType: 'image/png',
				sizeBytes: 500_000,
				width: 1280,
				height: 720,
			}).valid,
		).toBe(true);
		expect(
			validateYouTubeThumbnailSpec({
				mimeType: 'image/png',
				sizeBytes: 3 * 1024 * 1024,
				width: 1280,
				height: 720,
			}).valid,
		).toBe(false);
		expect(
			validateYouTubeThumbnailSpec({
				mimeType: 'image/png',
				sizeBytes: 400_000,
				replacingApproved: true,
				confirmReplaceApproved: false,
			}).errors[0],
		).toContain('confirmation_required');

		// Tags normalization (dedup + strip # + <=500 chars)
		const tagCheck = normalizeAndValidateYouTubeTags(['#NanoMachine', 'nano machine', 'NanoMachine', 'manhwa recap']);
		expect(tagCheck.valid).toBe(true);
		expect(tagCheck.tags).toEqual(['NanoMachine', 'nano machine', 'manhwa recap']);
		expect(tagCheck.removedDuplicates).toBe(1);
		expect(tagCheck.strippedHashPrefixes).toBe(1);

		// Short video (<30s) must NOT invent artificial timestamps
		const tooShort = YouTubeChapterGenerator.fromRenderedTimeline({
			mode: 'game_video',
			totalVideoDurationMs: 22_000,
			segments: [
				{ id: 's1', title: 'Intro', startMs: 0, durationMs: 8_000 },
				{ id: 's2', title: 'Gameplay', startMs: 8_000, durationMs: 8_000 },
				{ id: 's3', title: 'Fim', startMs: 16_000, durationMs: 6_000 },
			],
		});
		expect(tooShort.validation.valid).toBe(false);
		expect(tooShort.chapters).toHaveLength(0);

		// Valid game video chapters
		const gameCh = YouTubeChapterGenerator.fromRenderedTimeline({
			mode: 'game_video',
			totalVideoDurationMs: 180_000,
			segments: [
				{ id: 's1', title: 'Abertura', startMs: 0, durationMs: 30_000 },
				{ id: 's2', title: 'Apresentação do mundo', startMs: 30_000, durationMs: 35_000 },
				{ id: 's3', title: 'Combate chefe', startMs: 65_000, durationMs: 45_000 },
				{ id: 's4', title: 'Análise técnica', startMs: 110_000, durationMs: 40_000 },
				{ id: 's5', title: 'Veredito final', startMs: 150_000, durationMs: 30_000 },
			],
		});
		expect(gameCh.validation.valid).toBe(true);
		expect(gameCh.chapters[0]?.timestampText).toBe('00:00');
		expect(gameCh.chapters.length).toBeGreaterThanOrEqual(3);
	});

	it('Recap Multicapítulos (5 capítulos de Nano Machine): RecapChapterMarker, Story Memory anti-spoiler, pós-render recalculo, edição invalida timestamps, e agendamento em lote 1/dia', () => {
		// Create Story Memory with Chapters 1..5 AND Chapter 6 (future spoiler!)
		const mem = createOrLoadStoryMemoryProject({
			workspaceDir: workDir,
			projectId: 'nano-machine-series',
			workTitle: 'Nano Machine',
		});
		mem.characters.push({
			characterId: 'char-1',
			primaryName: 'Cheon Yeo-Woon',
			aliases: ['Sétimo Príncipe'],
			nameStatus: 'confirmed',
			visualTraits: ['cabelo preto'],
			firstAppearance: { chapterNumber: 1, panelId: 'ch1-p1' },
			appearedInChapters: [1, 2, 3, 4, 5],
			confidence: 0.98,
			lockedByHuman: true,
		});
		for (let c = 1; c <= 6; c++) {
			mem.chapters.push({
				chapterNumber: c,
				chapterId: `nano-machine-ch-${c}`,
				summary:
					c === 6
						? 'SPOILER_CAPITULO_6_SEGREDO_FUTURO_PROIBIDO'
						: `Resumo factual do Capítulo ${c} de Nano Machine.`,
				events: [],
				locations: [],
				ongoingConflicts: [],
				openQuestions: [],
				processedAtIso: new Date().toISOString(),
			});
		}

		// Build 5 chapters (pages 1..5) and single-video RecapAudiovisualPlan
		const panels = [1, 2, 3, 4, 5].map((c) => makePanel(c, c));
		const segments = [1, 2, 3, 4, 5].map((c) => ({
			seriesProjectId: 'nano-machine-series',
			sourceChapterId: `nano-machine-ch-${c}`,
			chapterNumber: c,
			chapterTitle: c === 1 ? 'O começo' : `Capítulo ${c}`,
			sourceProductionId: 'prod-nano-1-5',
			startPageNumber: c,
			endPageNumber: c,
			panelIds: [`ch${c}-p${c}`],
		}));

		const initialMarkers = buildInitialRecapChapterMarkers({
			segments,
			panels,
			introOffsetMs: 35_000,
		});
		expect(initialMarkers).toHaveLength(5);

		const renderedPlan: RecapAudiovisualPlan = {
			schemaVersion: 1,
			chapterId: 'nano-machine-1-5',
			scriptTitle: 'Nano Machine Capítulos 1–5',
			aspectRatio: '16:9',
			fps: 30,
			totalDurationMs: 2_065_000,
			shots: [
				{ shotId: 'sh-1', sceneId: 'sc-1', panelId: 'ch1-p1', imagePath: panels[0]!.croppedImagePath!, startMs: 0, durationMs: 465_000, captionText: 'Cap 1', motionStyle: 'ken_burns_in', transitionIn: 'fade', transitionOut: 'cut', renderHash: 'h1' },
				{ shotId: 'sh-2', sceneId: 'sc-2', panelId: 'ch2-p2', imagePath: panels[1]!.croppedImagePath!, startMs: 465_000, durationMs: 505_000, captionText: 'Cap 2', motionStyle: 'pan_down', transitionIn: 'cut', transitionOut: 'cut', renderHash: 'h2' },
				{ shotId: 'sh-3', sceneId: 'sc-3', panelId: 'ch3-p3', imagePath: panels[2]!.croppedImagePath!, startMs: 970_000, durationMs: 505_000, captionText: 'Cap 3', motionStyle: 'zoom_punch', transitionIn: 'cut', transitionOut: 'cut', renderHash: 'h3' },
				{ shotId: 'sh-4', sceneId: 'sc-4', panelId: 'ch4-p4', imagePath: panels[3]!.croppedImagePath!, startMs: 1_475_000, durationMs: 500_000, captionText: 'Cap 4', motionStyle: 'ken_burns_out', transitionIn: 'cut', transitionOut: 'cut', renderHash: 'h4' },
				{ shotId: 'sh-5', sceneId: 'sc-5', panelId: 'ch5-p5', imagePath: panels[4]!.croppedImagePath!, startMs: 1_975_000, durationMs: 90_000, captionText: 'Cap 5', motionStyle: 'static_hold', transitionIn: 'cut', transitionOut: 'fade', renderHash: 'h5' },
			],
			audioTracks: { narrationClips: [], sfxCues: [] },
			subtitles: [],
			approvalStatus: 'approved',
			createdAtIso: new Date().toISOString(),
		};

		// Recalculate markers after MP4 render (35s intro + 2065s content = 2100s total)
		const finalMarkers = recalculateRecapChapterMarkersFromPlan({
			markers: initialMarkers,
			plan: renderedPlan,
			panels,
			segments,
			introHookDurationMs: 35_000,
			actualMp4DurationMs: 2_100_000,
		});
		expect(finalMarkers.map((m) => m.chapterNumber)).toEqual([1, 2, 3, 4, 5]);
		expect(finalMarkers[0]?.startMs).toBe(35_000);
		expect(finalMarkers[4]?.endMs).toBe(2_100_000);

		// Generate YouTube chapters from post-render RecapChapterMarker[]
		const ytChapters = YouTubeChapterGenerator.fromRecapChapterMarkers({
			markers: finalMarkers,
			totalVideoDurationMs: 2_100_000,
		});
		expect(ytChapters.validation.valid).toBe(true);
		expect(ytChapters.chapters).toHaveLength(6); // 00:00 Introdução + Capítulos 1..5
		expect(ytChapters.chapters[0]?.timestampText).toBe('00:00');
		expect(ytChapters.chapters[0]?.title).toBe('Introdução');
		expect(ytChapters.chapters[1]?.timestampText).toBe('00:35');
		expect(ytChapters.chapters[1]?.title).toContain('Capítulo 1');

		// Story Memory metadata: includes confirmed character, NO Chapter 6 spoiler!
		const meta = generateMultiChapterRecapMetadata({
			workTitle: 'Nano Machine',
			markers: finalMarkers,
			storyMemory: mem,
		});
		expect(meta.suggestedTitle).toBe('Nano Machine — O Início de uma Lenda | Capítulos 1–5');
		expect(meta.confirmedCharacters).toContain('Cheon Yeo-Woon');
		expect(meta.description).not.toContain('SPOILER_CAPITULO_6_SEGREDO_FUTURO_PROIBIDO');

		const descWithChapters = YouTubeChapterGenerator.injectIntoDescription(
			meta.description,
			ytChapters.chapters,
			2_100_000,
		);
		expect(descWithChapters).toContain('00:00 Introdução');
		expect(descWithChapters).toContain('00:35 Capítulo 1 — O começo');

		// Editing the video (e.g. shortening Cap 1 by 60s) invalidates & recalculates timestamps!
		const editedPlan: RecapAudiovisualPlan = {
			...renderedPlan,
			totalDurationMs: 2_005_000,
			shots: renderedPlan.shots.map((s, idx) =>
				idx === 0
					? { ...s, durationMs: 405_000 }
					: { ...s, startMs: s.startMs - 60_000 },
			),
		};
		const recalculatedAfterEdit = recalculateRecapChapterMarkersFromPlan({
			markers: finalMarkers,
			plan: editedPlan,
			panels,
			segments,
			introHookDurationMs: 35_000,
			actualMp4DurationMs: 2_040_000,
		});
		expect(recalculatedAfterEdit[1]!.startMs).toBeLessThan(finalMarkers[1]!.startMs);

		// Platform adaptation (16:9 YouTube + 9:16 Shorts/Instagram/TikTok) preserves sync
		const adapted = adaptRecapPlanForPlatforms({ plan: renderedPlan });
		expect(adapted.youtube.aspectRatio).toBe('16:9');
		expect(adapted.instagram.aspectRatio).toBe('9:16');
		expect(adapted.tiktok.aspectRatio).toBe('9:16');
		expect(adapted.youtube_shorts.totalDurationMs).toBeLessThanOrEqual(60_000);
		expect(adapted.instagram.syncPreserved).toBe(true);

		// Batch scheduling: 5 chapters, 1 episode per day on YouTube, Instagram & TikTok
		const calendar = new EditorialCalendarEngine(calendarStorePath, 'America/Sao_Paulo');
		const hub = new SocialPublishingHub(calendar);
		const batch = hub.scheduleBatchRecapChapters({
			channelId: 'main_yt',
			channelName: 'Canal Principal',
			seriesProjectId: 'nano-machine-series',
			workTitle: 'Nano Machine',
			platforms: ['youtube', 'instagram', 'tiktok'],
			startDayKey: '2026-11-25',
			timeHHmm: '18:00',
			timezone: 'America/Sao_Paulo',
			frequency: 'daily',
			chapters: [1, 2, 3, 4, 5].map((c) => ({
				runId: `recap-nano-ch${c}`,
				chapterNumber: c,
				chapterTitle: `Capítulo ${c}`,
				workTitle: 'Nano Machine',
				title: `Nano Machine — Capítulo ${c}`,
				description: `Resumo do Capítulo ${c}`,
				reviewApproved: true,
				qualityGates: { gateF: 'pass', gateG: 'pass', gateH: 'pass', allMandatoryPassed: true },
				rightsVerification: {
					verified: true,
					sourceAuthorized: true,
					musicAndSfxLicensed: true,
					noProhibitedWatermarks: true,
					transformativeEditorialUse: true,
				},
			})),
		});

		expect(batch.events).toHaveLength(5);
		expect(batch.events[0]?.scheduledPublishAtIso).toBe('2026-11-25T21:00:00.000Z');
		expect(batch.events[4]?.scheduledPublishAtIso).toBe('2026-11-29T21:00:00.000Z');
		expect(calendar.getSnapshot().events).toHaveLength(5);
	});
});
