/**
 * Aethera Social Publishing Hub — Unified Multi-Platform Scheduler & YouTube Long-Form Studio
 *
 * Shares the exact same `EditorialCalendarEngine`, identifiers (`publicationId === event.id`),
 * and storage as the existing Aethera Calendar so Calendar and Publication operate as two
 * synchronized views of a single system.
 *
 * Shared across:
 * - Projeto Manual (`manual_project`)
 * - Produção com IA (`ai_cinema`)
 * - Mangá Recap (`manga_recap`, single-chapter & multi-chapter)
 * - Biblioteca (`media_library`)
 */

import {
	EditorialCalendarEngine,
	localDateTimeToUtcIso,
	type CalendarEventStatus,
	type CalendarFormat,
	type CalendarPlatform,
	type EditorialCalendarEvent,
	type PlatformDestinationState,
	type ProductionSourceMode,
	type PublicationAuditEntry,
	type QualityGatesReadinessState,
	type RecapPublicationBinding,
	type RightsVerificationState,
	type YouTubeLongFormStudioMeta,
} from './editorial-calendar-engine.js';
import {
	YouTubeChapterGenerator,
	validateYouTubeChapters,
	type YouTubeTimelineChapter,
} from './youtube-chapter-generator.js';

export interface PlatformPublishAdapterResult {
	ok: boolean;
	remoteId?: string;
	remoteUrl?: string;
	error?: string;
}

export interface PlatformPublishExecutor {
	publish(input: {
		publicationId: string;
		idempotencyKey: string;
		platform: CalendarPlatform;
		target: PlatformDestinationState;
		scheduledPublishAtIso?: string;
		youtubeStudio?: YouTubeLongFormStudioMeta;
		dryRun?: boolean;
	}): Promise<PlatformPublishAdapterResult>;
}

export interface ThumbnailValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export function validateYouTubeThumbnailSpec(input: {
	mimeType: string;
	sizeBytes: number;
	width?: number;
	height?: number;
	replacingApproved?: boolean;
	confirmReplaceApproved?: boolean;
}): ThumbnailValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (input.replacingApproved && !input.confirmReplaceApproved) {
		errors.push('confirmation_required: confirme explicitamente antes de substituir uma thumbnail já aprovada.');
	}

	const normalizedMime = input.mimeType.toLowerCase();
	if (normalizedMime !== 'image/jpeg' && normalizedMime !== 'image/jpg' && normalizedMime !== 'image/png') {
		errors.push('Formato de thumbnail inválido para YouTube thumbnails.set (use JPG ou PNG).');
	}

	const MAX_BYTES = 2 * 1024 * 1024; // 2 MB YouTube API limit
	if (input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) {
		errors.push(`Tamanho da thumbnail fora do limite do YouTube (máximo 2 MB; atual: ${(input.sizeBytes / (1024 * 1024)).toFixed(2)} MB).`);
	}

	if (input.width !== undefined && input.height !== undefined) {
		if (input.width < 640) {
			errors.push(`Largura mínima recomendada pelo YouTube é 640px (atual: ${input.width}px).`);
		}
		const ratio = input.width / Math.max(1, input.height);
		if (Math.abs(ratio - 16 / 9) > 0.12) {
			warnings.push(`Proporção recomendada é 16:9 (1280x720); atual: ${input.width}x${input.height}.`);
		}
	}

	return { valid: errors.length === 0, errors, warnings };
}

export const YOUTUBE_TAG_PRESETS: Record<string, string[]> = {
	manga_recap: ['manga recap', 'manhwa recap', 'resumo de manhwa', 'recap em português', 'webtoon recap'],
	game_analysis: ['análise de jogos', 'games', 'gameplay comentado', 'review de games', 'história dos games'],
	documentary: ['documentário', 'curiosidades', 'história completa', 'explicação detalhada'],
};

export function normalizeAndValidateYouTubeTags(rawTags: readonly string[]): {
	tags: string[];
	totalChars: number;
	valid: boolean;
	errors: string[];
	removedDuplicates: number;
	strippedHashPrefixes: number;
} {
	const seen = new Set<string>();
	const tags: string[] = [];
	let removedDuplicates = 0;
	let strippedHashPrefixes = 0;
	let totalChars = 0;
	const errors: string[] = [];

	for (const raw of rawTags) {
		let cleaned = raw.trim();
		if (!cleaned) continue;
		if (cleaned.startsWith('#')) {
			cleaned = cleaned.replace(/^#+/, '').trim();
			strippedHashPrefixes++;
		}
		if (!cleaned) continue;
		const key = cleaned.toLowerCase();
		if (seen.has(key)) {
			removedDuplicates++;
			continue;
		}
		seen.add(key);
		tags.push(cleaned);
		totalChars += cleaned.length + (tags.length > 1 ? 1 : 0);
	}

	if (totalChars > 500) {
		errors.push(`Limite total de tags da API do YouTube excedido (${totalChars}/500 caracteres).`);
	}

	return {
		tags,
		totalChars,
		valid: errors.length === 0,
		errors,
		removedDuplicates,
		strippedHashPrefixes,
	};
}

export interface ScheduleMultiPlatformInput {
	publicationId?: string;
	title: string;
	description: string;
	channelId: string;
	channelName: string;
	productionMode: ProductionSourceMode;
	format?: CalendarFormat;
	projectId?: string;
	thumbnailUrl?: string;
	videoPath?: string;
	videoDurationMs?: number;
	cloudMediaKey?: string;
	platforms: readonly CalendarPlatform[];
	platformOverrides?: Partial<Record<CalendarPlatform, Partial<PlatformDestinationState>>>;
	/** Local dayKey (YYYY-MM-DD) + timeHHmm (HH:mm) OR direct scheduledPublishAtIso */
	localDayKey?: string;
	localTimeHHmm?: string;
	timezone?: string;
	scheduledPublishAtIso?: string;
	status?: CalendarEventStatus;
	reviewApproved: boolean;
	qualityGates?: QualityGatesReadinessState;
	rightsVerification?: RightsVerificationState;
	recapBinding?: RecapPublicationBinding;
	youtubeStudio?: Partial<YouTubeLongFormStudioMeta>;
	batchSeriesId?: string;
	requireExplicitApproval?: boolean;
}

export interface BatchRecapChapterScheduleItem {
	runId: string;
	chapterNumber: number;
	chapterTitle: string;
	workTitle: string;
	seriesProjectId?: string;
	title: string;
	description: string;
	hashtags?: string[];
	tags?: string[];
	thumbnailUrl?: string;
	videoPath?: string;
	videoDurationMs?: number;
	reviewApproved: boolean;
	qualityGates: QualityGatesReadinessState;
	rightsVerification: RightsVerificationState;
}

export interface BatchRecapScheduleInput {
	channelId: string;
	channelName: string;
	seriesProjectId?: string;
	workTitle: string;
	chapters: readonly BatchRecapChapterScheduleItem[];
	platforms: readonly CalendarPlatform[];
	startDayKey: string; // YYYY-MM-DD
	timeHHmm: string; // HH:mm
	timezone: string;
	frequency: 'daily' | 'weekly' | 'custom';
	customIntervalDays?: number;
}

export class SocialPublishingHub {
	private readonly executedIdempotencyKeys = new Set<string>();

	constructor(private readonly calendar: EditorialCalendarEngine) {}

	/**
	 * Schedules (or saves as draft) a unified multi-platform publication directly in
	 * the existing `EditorialCalendarEngine` using a single shared identifier.
	 */
	schedulePublication(input: ScheduleMultiPlatformInput): EditorialCalendarEvent {
		const tz = input.timezone || 'America/Sao_Paulo';
		const platforms: CalendarPlatform[] =
			input.platforms.length > 0 ? [...new Set(input.platforms)] : ['youtube'];
		const primaryPlatform = platforms[0]!;

		const scheduledPublishAtIso =
			input.scheduledPublishAtIso ??
			(input.localDayKey && input.localTimeHHmm
				? localDateTimeToUtcIso(input.localDayKey, input.localTimeHHmm, tz)
				: undefined);

		const targetStatus: CalendarEventStatus =
			input.status ?? (scheduledPublishAtIso ? 'scheduled' : 'draft');

		// Enforce mandatory quality gates & rights verification before scheduling/publishing
		if (targetStatus === 'scheduled' || targetStatus === 'publishing') {
			if (!input.reviewApproved) {
				throw new Error('review_approval_required: aprovação final obrigatória antes de agendar ou publicar.');
			}
			if (input.qualityGates && !input.qualityGates.allMandatoryPassed) {
				throw new Error('quality_gates_required: não é permitido publicar ou agendar sem aprovação dos Gates obrigatórios.');
			}
			if (input.rightsVerification && !input.rightsVerification.verified) {
				throw new Error('rights_verification_required: conclua a verificação de direitos de uso do material antes de autorizar a publicação.');
			}
		}

		// Inject approved YouTube chapters into YouTube description when valid
		const ytChapters: YouTubeTimelineChapter[] = input.youtubeStudio?.chapters ?? [];
		const effectiveDurationMs = input.videoDurationMs ?? 0;
		const validatedChapters =
			ytChapters.length > 0 && effectiveDurationMs > 0
				? validateYouTubeChapters(ytChapters, effectiveDurationMs)
				: null;

		const ytDescription =
			validatedChapters?.valid && ytChapters.length >= 3
				? YouTubeChapterGenerator.injectIntoDescription(input.description, ytChapters, effectiveDurationMs)
				: input.description;

		const normalizedTags = normalizeAndValidateYouTubeTags(input.youtubeStudio?.tags ?? []);
		if (!normalizedTags.valid) {
			throw new Error(`invalid_tags: ${normalizedTags.errors.join(' ')}`);
		}

		const nowIso = new Date().toISOString();
		const platformTargets: Partial<Record<CalendarPlatform, PlatformDestinationState>> = {};
		for (const p of platforms) {
			const override = input.platformOverrides?.[p];
			const aspectRatio: '16:9' | '9:16' = p === 'youtube' ? '16:9' : '9:16';
			platformTargets[p] = {
				platform: p,
				status: override?.status ?? targetStatus,
				title: (override?.title ?? input.title).slice(0, p === 'youtube' ? 100 : 150),
				description: override?.description ?? (p === 'youtube' ? ytDescription : input.description),
				hashtags: override?.hashtags ?? [],
				...(p === 'youtube' ? { tags: override?.tags ?? normalizedTags.tags } : {}),
				...(override?.thumbnailUrl ?? input.thumbnailUrl ? { thumbnailUrl: override?.thumbnailUrl ?? input.thumbnailUrl } : {}),
				...(override?.videoPath ?? input.videoPath ? { videoPath: override?.videoPath ?? input.videoPath } : {}),
				aspectRatio: override?.aspectRatio ?? aspectRatio,
				attempts: override?.attempts ?? 0,
				updatedAtIso: nowIso,
			};
		}

		const canonicalId =
			input.publicationId ??
			`pub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

		const youtubeStudio: YouTubeLongFormStudioMeta | undefined =
			platforms.includes('youtube') || input.youtubeStudio
				? {
						tags: normalizedTags.tags,
						savedTitleVersions: input.youtubeStudio?.savedTitleVersions?.length
							? [...new Set([...input.youtubeStudio.savedTitleVersions, input.title])]
							: [input.title],
						chapters: ytChapters,
						thumbnailApproved: input.youtubeStudio?.thumbnailApproved ?? false,
						...(input.youtubeStudio?.thumbnailPath ? { thumbnailPath: input.youtubeStudio.thumbnailPath } : {}),
						privacyStatus: input.youtubeStudio?.privacyStatus ?? 'private',
						...(input.youtubeStudio?.categoryId ? { categoryId: input.youtubeStudio.categoryId } : {}),
						...(input.youtubeStudio?.defaultLanguage ? { defaultLanguage: input.youtubeStudio.defaultLanguage } : {}),
					}
				: undefined;

		return this.calendar.upsertEvent({
			id: canonicalId,
			publicationId: canonicalId,
			title: input.title,
			description: ytDescription,
			channelId: input.channelId,
			channelName: input.channelName,
			platform: primaryPlatform,
			platforms,
			platformTargets,
			format: input.format ?? (primaryPlatform === 'youtube' ? 'long' : 'short'),
			productionMode: input.productionMode,
			...(input.projectId ? { projectId: input.projectId } : {}),
			...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
			...(input.videoPath ? { videoPath: input.videoPath } : {}),
			...(input.videoDurationMs ? { videoDurationMs: input.videoDurationMs } : {}),
			...(input.cloudMediaKey ? { cloudMediaKey: input.cloudMediaKey } : {}),
			plannedDateIso: scheduledPublishAtIso ?? nowIso,
			...(scheduledPublishAtIso ? { scheduledPublishAtIso } : {}),
			timezone: tz,
			status: targetStatus,
			reviewApproved: input.reviewApproved,
			...(input.reviewApproved ? { reviewApprovedAt: nowIso } : {}),
			...(input.qualityGates ? { qualityGates: input.qualityGates } : {}),
			...(input.rightsVerification ? { rightsVerification: input.rightsVerification } : {}),
			...(input.recapBinding ? { recapBinding: input.recapBinding } : {}),
			...(youtubeStudio ? { youtubeStudio } : {}),
			...(input.batchSeriesId ? { batchSeriesId: input.batchSeriesId } : {}),
		});
	}

	/**
	 * Schedules a batch of approved Mangá Recap chapters (e.g., 5 chapters, 1 per day)
	 * across YouTube, Instagram, and TikTok in the unified Calendar.
	 */
	scheduleBatchRecapChapters(input: BatchRecapScheduleInput): {
		batchSeriesId: string;
		events: EditorialCalendarEvent[];
	} {
		const batchSeriesId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const stepDays =
			input.frequency === 'daily'
				? 1
				: input.frequency === 'weekly'
					? 7
					: Math.max(1, Math.round(input.customIntervalDays ?? 1));

		const baseUtcMs = Date.parse(`${input.startDayKey}T12:00:00Z`);
		const ordered = [...input.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
		const events: EditorialCalendarEvent[] = [];

		for (let i = 0; i < ordered.length; i++) {
			const ch = ordered[i]!;
			const dayDate = new Date(baseUtcMs + i * stepDays * 86_400_000);
			const dayKey = dayDate.toISOString().slice(0, 10);
			const scheduledPublishAtIso = localDateTimeToUtcIso(dayKey, input.timeHHmm, input.timezone);

			const ev = this.schedulePublication({
				publicationId: `recap_${ch.runId}_ch${ch.chapterNumber}`,
				title: ch.title,
				description: ch.description,
				channelId: input.channelId,
				channelName: input.channelName,
				productionMode: 'manga_recap',
				format: 'long',
				projectId: ch.runId,
				...(ch.thumbnailUrl ? { thumbnailUrl: ch.thumbnailUrl } : {}),
				...(ch.videoPath ? { videoPath: ch.videoPath } : {}),
				...(ch.videoDurationMs ? { videoDurationMs: ch.videoDurationMs } : {}),
				platforms: input.platforms,
				scheduledPublishAtIso,
				timezone: input.timezone,
				status: 'scheduled',
				reviewApproved: ch.reviewApproved,
				qualityGates: ch.qualityGates,
				rightsVerification: ch.rightsVerification,
				recapBinding: {
					runId: ch.runId,
					...(ch.seriesProjectId ?? input.seriesProjectId
						? { seriesProjectId: ch.seriesProjectId ?? input.seriesProjectId }
						: {}),
					workTitle: ch.workTitle || input.workTitle,
					chapterNumbers: [ch.chapterNumber],
					singleVideoMode: false,
				},
				youtubeStudio: {
					tags: ch.tags ?? YOUTUBE_TAG_PRESETS.manga_recap,
					privacyStatus: 'private',
				},
				batchSeriesId,
			});
			events.push(ev);
		}

		return { batchSeriesId, events };
	}

	/**
	 * Reschedules an existing publication from either the Calendar or the Publication view.
	 */
	reschedulePublication(input: {
		publicationId: string;
		targetDateIso: string;
		reason?: string;
	}): EditorialCalendarEvent {
		return this.calendar.moveEvent({
			id: input.publicationId,
			targetDateIso: input.targetDateIso,
			targetKind: 'scheduled',
			...(input.reason ? { reason: input.reason } : {}),
		});
	}

	/**
	 * Cancels a single platform target or the entire publication without creating duplicate events.
	 */
	cancelPublication(input: {
		publicationId: string;
		platform?: CalendarPlatform;
		reason?: string;
		confirmIrreversible?: boolean;
	}): EditorialCalendarEvent {
		return this.calendar.cancelSchedule({
			id: input.publicationId,
			...(input.platform ? { platform: input.platform } : {}),
			...(input.reason ? { reason: input.reason } : {}),
			...(input.confirmIrreversible !== undefined ? { confirmIrreversible: input.confirmIrreversible } : {}),
		});
	}

	/**
	 * Cancels all scheduled events in a batch series.
	 */
	cancelBatchSeries(batchSeriesId: string, reason = 'Série cancelada pelo usuário.'): EditorialCalendarEvent[] {
		const snap = this.calendar.getSnapshot();
		const matching = snap.events.filter((e) => e.batchSeriesId === batchSeriesId);
		return matching.map((ev) =>
			this.calendar.cancelSchedule({
				id: ev.id,
				reason,
			}),
		);
	}

	/**
	 * Coordinated cloud/local worker tick that executes due scheduled publications
	 * with per-platform fault isolation and idempotency keys.
	 *
	 * If one platform fails (e.g. TikTok), the remaining platforms (YouTube, Instagram)
	 * continue executing independently without being blocked!
	 */
	async executeDuePublications(input: {
		nowIso?: string;
		executor: PlatformPublishExecutor;
		dryRun?: boolean;
	}): Promise<{
		processedPublications: string[];
		results: Array<{ publicationId: string; platform: CalendarPlatform; ok: boolean; remoteId?: string; error?: string }>;
	}> {
		const nowMs = Date.parse(input.nowIso ?? new Date().toISOString());
		const snap = this.calendar.getSnapshot();
		const dueEvents = snap.events.filter((ev) => {
			if (ev.status !== 'scheduled' && ev.status !== 'publishing') return false;
			const publishIso = ev.scheduledPublishAtIso ?? ev.plannedDateIso;
			return !Number.isNaN(Date.parse(publishIso)) && Date.parse(publishIso) <= nowMs;
		});

		const processedPublications: string[] = [];
		const results: Array<{ publicationId: string; platform: CalendarPlatform; ok: boolean; remoteId?: string; error?: string }> = [];

		for (const ev of dueEvents) {
			const pubId = ev.publicationId ?? ev.id;
			const platforms = ev.platforms && ev.platforms.length > 0 ? ev.platforms : [ev.platform];
			const targets: Partial<Record<CalendarPlatform, PlatformDestinationState>> = { ...(ev.platformTargets ?? {}) };
			const auditLog: PublicationAuditEntry[] = [...(ev.auditLog ?? [])];
			let anyFailed = false;
			let anyPublished = false;
			let anyPending = false;

			for (const platform of platforms) {
				const target: PlatformDestinationState = targets[platform] ?? {
					platform,
					status: 'scheduled',
					title: ev.title,
					description: ev.description,
					hashtags: [],
					attempts: 0,
				};

				if (target.status === 'published' || target.status === 'cancelled') {
					if (target.status === 'published') anyPublished = true;
					continue;
				}

				const idempotencyKey = `${pubId}:${platform}:${ev.scheduledPublishAtIso ?? ev.plannedDateIso}`;
				if (this.executedIdempotencyKeys.has(idempotencyKey)) {
					anyPublished = true;
					continue;
				}

				const attemptNow = new Date().toISOString();
				targets[platform] = {
					...target,
					status: 'publishing',
					attempts: (target.attempts ?? 0) + 1,
					updatedAtIso: attemptNow,
				};

				try {
					const outcome = await input.executor.publish({
						publicationId: pubId,
						idempotencyKey,
						platform,
						target: targets[platform]!,
						...(ev.scheduledPublishAtIso ? { scheduledPublishAtIso: ev.scheduledPublishAtIso } : {}),
						...(ev.youtubeStudio ? { youtubeStudio: ev.youtubeStudio } : {}),
						...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
					});

					const doneNow = new Date().toISOString();
					if (outcome.ok) {
						this.executedIdempotencyKeys.add(idempotencyKey);
						anyPublished = true;
						targets[platform] = {
							...targets[platform]!,
							status: 'published',
							...(outcome.remoteId ? { remoteId: outcome.remoteId } : {}),
							...(outcome.remoteUrl ? { remoteUrl: outcome.remoteUrl } : {}),
							publishedAtIso: doneNow,
							updatedAtIso: doneNow,
						};
						auditLog.push({
							id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
							timestampIso: doneNow,
							action: 'platform_published',
							actor: 'cloud_worker',
							platform,
							detail: `Publicado em ${platform}${outcome.remoteId ? ` (ID: ${outcome.remoteId})` : ''}.`,
						});
						results.push({
							publicationId: pubId,
							platform,
							ok: true,
							...(outcome.remoteId ? { remoteId: outcome.remoteId } : {}),
						});
					} else {
						anyFailed = true;
						targets[platform] = {
							...targets[platform]!,
							status: 'failed',
							lastError: outcome.error ?? `Falha ao publicar em ${platform}.`,
							updatedAtIso: doneNow,
						};
						auditLog.push({
							id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
							timestampIso: doneNow,
							action: 'platform_failed',
							actor: 'cloud_worker',
							platform,
							detail: outcome.error ?? `Falha ao publicar em ${platform}.`,
						});
						results.push({
							publicationId: pubId,
							platform,
							ok: false,
							error: outcome.error ?? `Falha ao publicar em ${platform}.`,
						});
					}
				} catch (err) {
					anyFailed = true;
					const msg = err instanceof Error ? err.message : String(err);
					const failNow = new Date().toISOString();
					targets[platform] = {
						...targets[platform]!,
						status: 'failed',
						lastError: msg,
						updatedAtIso: failNow,
					};
					auditLog.push({
						id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
						timestampIso: failNow,
						action: 'platform_failed',
						actor: 'cloud_worker',
						platform,
						detail: msg,
					});
					results.push({ publicationId: pubId, platform, ok: false, error: msg });
				}
			}

			// Aggregate event status while keeping per-platform statuses completely independent
			const finalStatus: CalendarEventStatus =
				anyPublished && !anyFailed && !anyPending
					? 'published'
					: anyFailed && !anyPublished
						? 'failed'
						: anyPublished && anyFailed
							? 'failed' // surfaces partial failure alert while preserving published platforms!
							: 'scheduled';

			this.calendar.upsertEvent({
				...ev,
				id: ev.id,
				publicationId: pubId,
				platformTargets: targets,
				status: finalStatus,
				...(anyFailed
					? {
							integrationError: Object.values(targets)
								.filter((t) => t?.status === 'failed')
								.map((t) => `${t!.platform}: ${t!.lastError}`)
								.join(' | '),
						}
					: {}),
				auditLog,
			});
			processedPublications.push(pubId);
		}

		return { processedPublications, results };
	}

	/**
	 * Builds the Reference Schedule Scenario (Section 6):
	 * Date: 25/11/2026 | Time: 18:00 | Timezone: America/Sao_Paulo | UTC: 2026-11-25T21:00:00.000Z
	 * Destinations: YouTube, Instagram, TikTok.
	 */
	static createReferenceScheduleInput(overrides?: Partial<ScheduleMultiPlatformInput>): ScheduleMultiPlatformInput {
		const scheduledPublishAtIso = localDateTimeToUtcIso('2026-11-25', '18:00', 'America/Sao_Paulo');
		return {
			publicationId: 'ref_2026_11_25_1800_sp',
			title: 'Nano Machine — O Início de uma Lenda | Capítulos 1–5',
			description: 'Resumo narrativo contínuo dos Capítulos 1 a 5 de Nano Machine sem spoilers futuros.',
			channelId: 'main_yt',
			channelName: 'Canal Principal',
			productionMode: 'manga_recap',
			format: 'long',
			platforms: ['youtube', 'instagram', 'tiktok'],
			localDayKey: '2026-11-25',
			localTimeHHmm: '18:00',
			timezone: 'America/Sao_Paulo',
			scheduledPublishAtIso,
			status: 'scheduled',
			reviewApproved: true,
			qualityGates: { gateF: 'pass', gateG: 'pass', gateH: 'pass', allMandatoryPassed: true },
			rightsVerification: {
				verified: true,
				verifiedAtIso: new Date().toISOString(),
				sourceAuthorized: true,
				musicAndSfxLicensed: true,
				noProhibitedWatermarks: true,
				transformativeEditorialUse: true,
			},
			...overrides,
		};
	}
}
