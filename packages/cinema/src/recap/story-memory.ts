/**
 * Aethera Recap — Story Memory (Memória Narrativa Persistente entre Capítulos)
 *
 * Implements Phases 1–6 & 9 of Story Memory:
 * - Persistent series-level project registry (`<workspaceDir>/series/<projectId>/story-memory.json`)
 * - Character Registry keyed by permanent `characterId` (never by name)
 * - Cross-chapter character matching with ambiguity detection
 * - Chapter factual event history with source traceability (chapter, scene, panels)
 * - Strict anti-spoiler windowing (`getMemoryContextForChapter` only exposes chapters < N)
 * - Proposed memory updates + human curation (rename, confirm, merge, split) preserved across runs
 * - Atomic writes, automatic `.bak` recovery, schema versioning, and strict work isolation
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
	SCRIPT_STYLE_VALUES,
	type PanelAnalysis,
	type RecapScript,
	type NarrativeSequence,
	type ScriptStyle,
} from './recap-types.js';

// ─── Schemas & Types ─────────────────────────────────────────────────────────

export const CHARACTER_NAME_STATUS_VALUES = ['unknown', 'probable', 'confirmed'] as const;
export type CharacterNameStatus = (typeof CHARACTER_NAME_STATUS_VALUES)[number];

export const characterPanelRefSchema = z.object({
	chapterNumber: z.number().int().min(1),
	panelId: z.string().min(1),
	imagePath: z.string().optional(),
});
export type CharacterPanelRef = z.infer<typeof characterPanelRefSchema>;

export const characterRelationshipSchema = z.object({
	targetCharacterId: z.string().min(1),
	relation: z.string().min(1),
	sinceChapter: z.number().int().min(1),
	evidencePanelId: z.string().optional(),
});
export type CharacterRelationship = z.infer<typeof characterRelationshipSchema>;

export const characterChangeEntrySchema = z.object({
	atIso: z.string().datetime(),
	source: z.enum(['ai', 'human']),
	field: z.string().min(1),
	from: z.string().optional(),
	to: z.string(),
	reason: z.string().optional(),
});
export type CharacterChangeEntry = z.infer<typeof characterChangeEntrySchema>;

export const characterEvidenceSchema = z.object({
	chapterNumber: z.number().int().min(1),
	panelId: z.string().min(1),
	note: z.string().min(1),
	confidence: z.number().min(0).max(1),
});
export type CharacterEvidence = z.infer<typeof characterEvidenceSchema>;

export const storyMemoryCharacterSchema = z.object({
	/** Permanent stable ID (e.g. char_001). Never use name as primary key. */
	characterId: z.string().min(1),
	primaryName: z.string().optional(),
	aliases: z.array(z.string()).default([]),
	nameStatus: z.enum(CHARACTER_NAME_STATUS_VALUES).default('unknown'),
	visualTraits: z.array(z.string()).default([]),
	panelReferences: z.array(characterPanelRefSchema).default([]),
	firstAppearance: z.object({
		chapterNumber: z.number().int().min(1),
		panelId: z.string().min(1),
	}),
	appearedInChapters: z.array(z.number().int().min(1)).default([]),
	relationships: z.array(characterRelationshipSchema).default([]),
	changeHistory: z.array(characterChangeEntrySchema).default([]),
	evidence: z.array(characterEvidenceSchema).default([]),
	confidence: z.number().min(0).max(1).default(0.5),
	/** When true, human corrections are prioritized and never overwritten by AI. */
	lockedByHuman: z.boolean().default(false),
});
export type StoryMemoryCharacter = z.infer<typeof storyMemoryCharacterSchema>;

export const storyMemoryEventSchema = z.object({
	eventId: z.string().min(1),
	chapterNumber: z.number().int().min(1),
	sceneId: z.string().optional(),
	panelIds: z.array(z.string()).default([]),
	summary: z.string().min(1),
	characterIds: z.array(z.string()).default([]),
	location: z.string().optional(),
});
export type StoryMemoryEvent = z.infer<typeof storyMemoryEventSchema>;

export const storyMemoryDialogueSchema = z.object({
	chapterNumber: z.number().int().min(1),
	sceneId: z.string().optional(),
	panelId: z.string().optional(),
	speakerCharacterId: z.string().optional(),
	speakerLabel: z.string().optional(),
	text: z.string().min(1),
});
export type StoryMemoryDialogue = z.infer<typeof storyMemoryDialogueSchema>;

export const storyMemoryChapterRecordSchema = z.object({
	chapterNumber: z.number().int().min(1),
	chapterId: z.string().min(1),
	summary: z.string().min(1),
	events: z.array(storyMemoryEventSchema).default([]),
	involvedCharacterIds: z.array(z.string()).default([]),
	importantDialogues: z.array(storyMemoryDialogueSchema).default([]),
	locations: z.array(z.string()).default([]),
	confirmedRevelations: z.array(z.string()).default([]),
	ongoingConflicts: z.array(z.string()).default([]),
	openQuestions: z.array(z.string()).default([]),
	processedAtIso: z.string().datetime(),
});
export type StoryMemoryChapterRecord = z.infer<typeof storyMemoryChapterRecordSchema>;

export const storyMemoryProposedUpdateSchema = z.object({
	updateId: z.string().min(1),
	chapterNumber: z.number().int().min(1),
	kind: z.enum(['new_character', 'name_revealed', 'relationship_added', 'new_event', 'ambiguous_character_match']),
	status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
	summary: z.string().min(1),
	confidence: z.number().min(0).max(1),
	targetCharacterId: z.string().optional(),
	proposedName: z.string().optional(),
	visualTraits: z.array(z.string()).optional(),
	sourcePanelIds: z.array(z.string()).default([]),
	createdAtIso: z.string().datetime(),
});
export type StoryMemoryProposedUpdate = z.infer<typeof storyMemoryProposedUpdateSchema>;

export const recapStoryMemoryProjectSchema = z.object({
	schemaVersion: z.literal(1),
	projectId: z.string().min(1),
	workTitle: z.string().min(1),
	originalLanguage: z.string().default('ko'),
	narrationLanguage: z.string().default('pt-BR'),
	defaultScriptStyle: z.enum(SCRIPT_STYLE_VALUES).default('natural_recap'),
	importedChapters: z.array(z.number().int().min(1)).default([]),
	producedChapters: z.array(z.number().int().min(1)).default([]),
	characters: z.array(storyMemoryCharacterSchema).default([]),
	chapters: z.array(storyMemoryChapterRecordSchema).default([]),
	narrativeState: z.object({
		currentLocation: z.string().optional(),
		ongoingConflicts: z.array(z.string()).default([]),
		openQuestions: z.array(z.string()).default([]),
		revealedFacts: z.array(z.string()).default([]),
	}).default({ ongoingConflicts: [], openQuestions: [], revealedFacts: [] }),
	pendingUpdates: z.array(storyMemoryProposedUpdateSchema).default([]),
	createdAtIso: z.string().datetime(),
	updatedAtIso: z.string().datetime(),
});
export type RecapStoryMemoryProject = z.infer<typeof recapStoryMemoryProjectSchema>;

export interface ChapterMemoryContext {
	projectId: string;
	workTitle: string;
	targetChapterNumber: number;
	/** Only characters whose firstAppearance.chapterNumber < targetChapterNumber. */
	knownCharacters: Array<{
		characterId: string;
		displayName: string;
		nameStatus: CharacterNameStatus;
		aliases: string[];
		visualTraits: string[];
	}>;
	/** Maps visual descriptors or aliases (lowercase) → confirmed character name. */
	nameResolutionMap: Record<string, string>;
	previousChapterSummaries: Array<{ chapterNumber: number; summary: string }>;
	immediatePreviousContext?: string;
	ongoingConflicts: string[];
	openQuestions: string[];
	revealedFacts: string[];
}

// ─── Storage Helpers (Atomic Write + Backup + Isolation) ─────────────────────

const MEMORY_FILENAME = 'story-memory.json';
const BACKUP_FILENAME = 'story-memory.json.bak';

export function sanitizeSeriesProjectId(raw: string): string {
	return (
		raw
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9_-]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'recap-series'
	);
}

export function getStoryMemoryDir(workspaceDir: string, projectId: string): string {
	const safeId = sanitizeSeriesProjectId(projectId);
	return join(workspaceDir, 'series', safeId);
}

function getStoryMemoryPath(workspaceDir: string, projectId: string): string {
	return join(getStoryMemoryDir(workspaceDir, projectId), MEMORY_FILENAME);
}

export function saveStoryMemoryProject(workspaceDir: string, project: RecapStoryMemoryProject): string {
	const validated = recapStoryMemoryProjectSchema.parse({
		...project,
		updatedAtIso: new Date().toISOString(),
	});
	const dir = getStoryMemoryDir(workspaceDir, validated.projectId);
	mkdirSync(dir, { recursive: true });
	const target = join(dir, MEMORY_FILENAME);
	const backup = join(dir, BACKUP_FILENAME);
	if (existsSync(target)) {
		try {
			copyFileSync(target, backup);
		} catch {
			// best effort backup
		}
	}
	const tmp = join(dir, `${MEMORY_FILENAME}.tmp.${process.pid}.${Date.now()}`);
	writeFileSync(tmp, JSON.stringify(validated, null, 2), 'utf-8');
	renameSync(tmp, target);
	return target;
}

export function loadStoryMemoryProject(workspaceDir: string, projectId: string): RecapStoryMemoryProject | null {
	const target = getStoryMemoryPath(workspaceDir, projectId);
	const backup = join(getStoryMemoryDir(workspaceDir, projectId), BACKUP_FILENAME);

	for (const candidate of [target, backup]) {
		if (!existsSync(candidate)) continue;
		try {
			const raw = JSON.parse(readFileSync(candidate, 'utf-8'));
			return recapStoryMemoryProjectSchema.parse(raw);
		} catch {
			// try backup if main file is corrupted
		}
	}
	return null;
}

export function listStoryMemoryProjects(workspaceDir: string): RecapStoryMemoryProject[] {
	const seriesRoot = join(workspaceDir, 'series');
	if (!existsSync(seriesRoot)) return [];
	const projects: RecapStoryMemoryProject[] = [];
	for (const entry of readdirSync(seriesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const loaded = loadStoryMemoryProject(workspaceDir, entry.name);
		if (loaded) projects.push(loaded);
	}
	return projects.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso));
}

export function createOrLoadStoryMemoryProject(input: {
	workspaceDir: string;
	workTitle: string;
	projectId?: string;
	originalLanguage?: string;
	narrationLanguage?: string;
	defaultScriptStyle?: ScriptStyle;
}): RecapStoryMemoryProject {
	const projectId = sanitizeSeriesProjectId(input.projectId ?? input.workTitle);
	const existing = loadStoryMemoryProject(input.workspaceDir, projectId);
	if (existing) return existing;

	const now = new Date().toISOString();
	const created = recapStoryMemoryProjectSchema.parse({
		schemaVersion: 1,
		projectId,
		workTitle: input.workTitle.trim() || projectId,
		originalLanguage: input.originalLanguage ?? 'ko',
		narrationLanguage: input.narrationLanguage ?? 'pt-BR',
		defaultScriptStyle: input.defaultScriptStyle ?? 'natural_recap',
		importedChapters: [],
		producedChapters: [],
		characters: [],
		chapters: [],
		narrativeState: {
			ongoingConflicts: [],
			openQuestions: [],
			revealedFacts: [],
		},
		pendingUpdates: [],
		createdAtIso: now,
		updatedAtIso: now,
	});
	saveStoryMemoryProject(input.workspaceDir, created);
	return created;
}

// ─── Character Matching & Anti-Spoiler Context ───────────────────────────────

function tokenizeNormalized(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 3);
}

function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
	if (a.length === 0 || b.length === 0) return 0;
	const setA = new Set(a);
	const setB = new Set(b);
	let inter = 0;
	for (const x of setA) {
		if (setB.has(x)) inter++;
	}
	const union = setA.size + setB.size - inter;
	return union === 0 ? 0 : inter / union;
}

function isVisualDescriptorName(label: string): boolean {
	return (
		label.trim().length > 26 ||
		/^(jovem|homem|mulher|garoto|garota|menino|menina|guerreiro|mestre|advers[áa]rio|personagem)\b/i.test(label.trim())
	);
}

function nextCharacterId(existing: readonly StoryMemoryCharacter[]): string {
	let maxNum = 0;
	for (const ch of existing) {
		const m = /^char_(\d+)$/.exec(ch.characterId);
		if (m && m[1]) {
			const n = parseInt(m[1], 10);
			if (n > maxNum) maxNum = n;
		}
	}
	return `char_${String(maxNum + 1).padStart(3, '0')}`;
}

export interface CharacterMatchResult {
	status: 'matched' | 'ambiguous' | 'new';
	character?: StoryMemoryCharacter;
	score: number;
	reason: string;
}

/**
 * Compares a detected character label + visual traits against existing registry entries.
 * Never merges distinct characters on weak similarity; flags intermediate matches as ambiguous.
 */
export function matchCharacterAgainstRegistry(input: {
	label: string;
	visualTraits?: readonly string[];
	registry: readonly StoryMemoryCharacter[];
}): CharacterMatchResult {
	const normLabel = input.label.trim().toLowerCase();
	const candidateTokens = tokenizeNormalized([input.label, ...(input.visualTraits ?? [])].join(' '));

	// 1. Exact confirmed/probable name or alias match
	for (const ch of input.registry) {
		if (ch.primaryName && ch.primaryName.trim().toLowerCase() === normLabel) {
			return { status: 'matched', character: ch, score: 1, reason: `Nome exato: ${ch.primaryName}` };
		}
		if (ch.aliases.some((a) => a.trim().toLowerCase() === normLabel)) {
			return { status: 'matched', character: ch, score: 0.95, reason: `Apelido/descritor conhecido: ${input.label}` };
		}
	}

	// 2. Visual trait & descriptor similarity
	let bestChar: StoryMemoryCharacter | undefined;
	let bestScore = 0;

	for (const ch of input.registry) {
		const chTokens = tokenizeNormalized([
			ch.primaryName ?? '',
			...ch.aliases,
			...ch.visualTraits,
		].join(' '));
		const score = jaccardSimilarity(candidateTokens, chTokens);
		if (score > bestScore) {
			bestScore = score;
			bestChar = ch;
		}
	}

	if (bestChar && bestScore >= 0.5) {
		return {
			status: 'matched',
			character: bestChar,
			score: bestScore,
			reason: `Compatibilidade visual/contextual (${Math.round(bestScore * 100)}%)`,
		};
	}

	if (bestChar && bestScore >= 0.28) {
		return {
			status: 'ambiguous',
			character: bestChar,
			score: bestScore,
			reason: `Similaridade intermediária (${Math.round(bestScore * 100)}%) — requer confirmação humana`,
		};
	}

	return { status: 'new', score: bestScore, reason: 'Nenhuma correspondência confiável no registro' };
}

/**
 * Builds the strict anti-spoiler narrative context for producing `targetChapterNumber`.
 * NEVER includes characters, events, or revelations from chapters >= targetChapterNumber.
 */
export function getMemoryContextForChapter(
	project: RecapStoryMemoryProject,
	targetChapterNumber: number,
): ChapterMemoryContext {
	const priorChapters = project.chapters
		.filter((c) => c.chapterNumber < targetChapterNumber)
		.sort((a, b) => a.chapterNumber - b.chapterNumber);

	const priorCharacters = project.characters.filter(
		(c) => c.firstAppearance.chapterNumber < targetChapterNumber,
	);

	const nameResolutionMap: Record<string, string> = {};
	const knownCharacters = priorCharacters.map((ch) => {
		const displayName =
			ch.primaryName && ch.nameStatus !== 'unknown'
				? ch.primaryName
				: ch.aliases[0] ?? `Personagem #${ch.characterId.replace('char_', '')}`;

		if (ch.primaryName && ch.nameStatus === 'confirmed') {
			for (const alias of ch.aliases) {
				nameResolutionMap[alias.trim().toLowerCase()] = ch.primaryName;
			}
			for (const trait of ch.visualTraits) {
				if (trait.trim().length >= 8) {
					nameResolutionMap[trait.trim().toLowerCase()] = ch.primaryName;
				}
			}
		}

		return {
			characterId: ch.characterId,
			displayName,
			nameStatus: ch.nameStatus,
			aliases: ch.aliases,
			visualTraits: ch.visualTraits,
		};
	});

	const previousChapterSummaries = priorChapters.map((c) => ({
		chapterNumber: c.chapterNumber,
		summary: c.summary,
	}));
	const immediatePrev = priorChapters[priorChapters.length - 1];

	const ongoingConflicts = [...new Set(priorChapters.flatMap((c) => c.ongoingConflicts))].slice(-5);
	const openQuestions = [...new Set(priorChapters.flatMap((c) => c.openQuestions))].slice(-6);
	const revealedFacts = [...new Set(priorChapters.flatMap((c) => c.confirmedRevelations))].slice(-10);

	return {
		projectId: project.projectId,
		workTitle: project.workTitle,
		targetChapterNumber,
		knownCharacters,
		nameResolutionMap,
		previousChapterSummaries,
		...(immediatePrev ? { immediatePreviousContext: immediatePrev.summary } : {}),
		ongoingConflicts,
		openQuestions,
		revealedFacts,
	};
}

// ─── Consolidating Chapter Analysis into Story Memory ────────────────────────

export interface ConsolidateChapterInput {
	workspaceDir: string;
	projectId: string;
	chapterNumber: number;
	chapterId: string;
	analyses: readonly PanelAnalysis[];
	sequence: NarrativeSequence;
	script: RecapScript;
	/** Automatically apply high-confidence non-ambiguous updates (default: true). */
	autoConsolidate?: boolean;
}

export interface ConsolidateChapterResult {
	project: RecapStoryMemoryProject;
	chapterRecord: StoryMemoryChapterRecord;
	proposedUpdates: StoryMemoryProposedUpdate[];
}

/**
 * Extracts characters, events, dialogues, locations and updates Story Memory for a chapter.
 * Idempotent: reprocessing the same chapterNumber updates that chapter without duplicating events
 * and ALWAYS preserves human-locked character identities (`lockedByHuman === true`).
 */
export function consolidateChapterIntoStoryMemory(input: ConsolidateChapterInput): ConsolidateChapterResult {
	const existing = loadStoryMemoryProject(input.workspaceDir, input.projectId);
	if (!existing) {
		throw new Error(`Story Memory project not found: ${input.projectId}`);
	}

	const now = new Date().toISOString();
	const project: RecapStoryMemoryProject = JSON.parse(JSON.stringify(existing)) as RecapStoryMemoryProject;
	const proposedUpdates: StoryMemoryProposedUpdate[] = [];
	const autoConsolidate = input.autoConsolidate ?? true;

	// Track characters observed in this chapter
	const charObservations = new Map<string, {
		label: string;
		visualTraits: Set<string>;
		panelIds: Set<string>;
		maxConfidence: number;
	}>();

	for (const analysis of input.analyses) {
		for (const rawChar of analysis.characters) {
			const label = rawChar.trim();
			if (!label) continue;
			const key = label.toLowerCase();
			const entry = charObservations.get(key) ?? {
				label,
				visualTraits: new Set<string>(),
				panelIds: new Set<string>(),
				maxConfidence: 0,
			};
			entry.panelIds.add(analysis.panelId);
			entry.maxConfidence = Math.max(entry.maxConfidence, analysis.analysisConfidence);
			const detail = (analysis.characterDetails ?? []).find((d) => d.id.toLowerCase() === key);
			if (detail?.appearance) entry.visualTraits.add(detail.appearance);
			if (isVisualDescriptorName(label)) entry.visualTraits.add(label);
			charObservations.set(key, entry);
		}
	}

	const labelToCharacterId = new Map<string, string>();
	const involvedCharIds = new Set<string>();

	for (const [key, obs] of charObservations) {
		const traits = [...obs.visualTraits];
		const panelIds = [...obs.panelIds];
		const firstPanelId = panelIds[0] ?? `${input.chapterId}_p0_0`;

		// Match against all existing characters in this project
		const match = matchCharacterAgainstRegistry({
			label: obs.label,
			visualTraits: traits,
			registry: project.characters,
		});

		if (match.status === 'matched' && match.character) {
			const target = project.characters.find((c) => c.characterId === match.character!.characterId)!;
			labelToCharacterId.set(key, target.characterId);
			involvedCharIds.add(target.characterId);

			if (!target.appearedInChapters.includes(input.chapterNumber)) {
				target.appearedInChapters.push(input.chapterNumber);
				target.appearedInChapters.sort((a, b) => a - b);
			}
			for (const t of traits) {
				if (!target.visualTraits.includes(t)) target.visualTraits.push(t);
			}
			if (
				obs.label.toLowerCase() !== (target.primaryName ?? '').toLowerCase() &&
				!target.aliases.some((a) => a.toLowerCase() === obs.label.toLowerCase())
			) {
				target.aliases.push(obs.label);
			}
			for (const pid of panelIds) {
				if (!target.panelReferences.some((r) => r.chapterNumber === input.chapterNumber && r.panelId === pid)) {
					target.panelReferences.push({ chapterNumber: input.chapterNumber, panelId: pid });
				}
			}

			// If character had unknown name and this label looks like a real proper name (and NOT locked by human)
			if (!target.lockedByHuman && target.nameStatus === 'unknown' && !isVisualDescriptorName(obs.label)) {
				const update: StoryMemoryProposedUpdate = {
					updateId: `upd_${input.chapterNumber}_${target.characterId}_name`,
					chapterNumber: input.chapterNumber,
					kind: 'name_revealed',
					status: autoConsolidate && obs.maxConfidence >= 0.7 ? 'approved' : 'pending',
					summary: `Nome "${obs.label}" associado a ${target.characterId} no Capítulo ${input.chapterNumber}.`,
					confidence: obs.maxConfidence,
					targetCharacterId: target.characterId,
					proposedName: obs.label,
					sourcePanelIds: panelIds,
					createdAtIso: now,
				};
				proposedUpdates.push(update);
				if (update.status === 'approved') {
					target.primaryName = obs.label;
					target.nameStatus = obs.maxConfidence >= 0.85 ? 'confirmed' : 'probable';
					target.changeHistory.push({
						atIso: now,
						source: 'ai',
						field: 'primaryName',
						to: obs.label,
						reason: `Nome identificado no Capítulo ${input.chapterNumber}`,
					});
				}
			}
		} else {
			// Either 'new' or 'ambiguous' — never silently merge ambiguous matches!
			const newId = nextCharacterId(project.characters);
			const looksLikeRealName = !isVisualDescriptorName(obs.label);
			const newChar: StoryMemoryCharacter = storyMemoryCharacterSchema.parse({
				characterId: newId,
				...(looksLikeRealName ? { primaryName: obs.label } : {}),
				aliases: [obs.label],
				nameStatus: looksLikeRealName ? (obs.maxConfidence >= 0.85 ? 'confirmed' : 'probable') : 'unknown',
				visualTraits: traits,
				panelReferences: panelIds.map((pid) => ({ chapterNumber: input.chapterNumber, panelId: pid })),
				firstAppearance: { chapterNumber: input.chapterNumber, panelId: firstPanelId },
				appearedInChapters: [input.chapterNumber],
				relationships: [],
				changeHistory: [
					{
						atIso: now,
						source: 'ai',
						field: 'created',
						to: obs.label,
						reason: `Primeira aparição no Capítulo ${input.chapterNumber}`,
					},
				],
				evidence: [
					{
						chapterNumber: input.chapterNumber,
						panelId: firstPanelId,
						note: `Observado em ${panelIds.length} painel(is) no Capítulo ${input.chapterNumber}.`,
						confidence: obs.maxConfidence,
					},
				],
				confidence: obs.maxConfidence,
				lockedByHuman: false,
			});

			labelToCharacterId.set(key, newId);
			involvedCharIds.add(newId);

			if (match.status === 'ambiguous' && match.character) {
				proposedUpdates.push({
					updateId: `upd_${input.chapterNumber}_${newId}_ambiguous`,
					chapterNumber: input.chapterNumber,
					kind: 'ambiguous_character_match',
					status: 'pending',
					summary: `"${obs.label}" pode ser o mesmo personagem que ${match.character.primaryName ?? match.character.characterId} (${match.reason}). Confirme ou mescle.`,
					confidence: match.score,
					targetCharacterId: match.character.characterId,
					proposedName: obs.label,
					visualTraits: traits,
					sourcePanelIds: panelIds,
					createdAtIso: now,
				});
			} else {
				proposedUpdates.push({
					updateId: `upd_${input.chapterNumber}_${newId}_new`,
					chapterNumber: input.chapterNumber,
					kind: 'new_character',
					status: autoConsolidate ? 'approved' : 'pending',
					summary: `Novo personagem ${newId} (${obs.label}) identificado no Capítulo ${input.chapterNumber}.`,
					confidence: obs.maxConfidence,
					targetCharacterId: newId,
					proposedName: looksLikeRealName ? obs.label : undefined,
					visualTraits: traits,
					sourcePanelIds: panelIds,
					createdAtIso: now,
				});
			}

			if (autoConsolidate || match.status === 'ambiguous') {
				project.characters.push(newChar);
			}
		}
	}

	// Build factual chapter record (replaces prior record for same chapterNumber idempotently)
	const events: StoryMemoryEvent[] = input.script.scenes.map((sc, idx) => ({
		eventId: `ch${input.chapterNumber}_evt_${String(idx + 1).padStart(3, '0')}`,
		chapterNumber: input.chapterNumber,
		sceneId: sc.sceneId,
		panelIds: sc.panelIds,
		summary: sc.narrationText.slice(0, 260),
		characterIds: sc.characters
			.map((c) => labelToCharacterId.get(c.trim().toLowerCase()))
			.filter((id): id is string => Boolean(id)),
		...(sc.setting ? { location: sc.setting } : {}),
	}));

	const importantDialogues: StoryMemoryDialogue[] = [];
	for (const sc of input.script.scenes) {
		for (const d of sc.extractedDialogues ?? []) {
			if ((d.kind ?? 'dialogue') === 'sfx') continue;
			const text = (d.translatedText ?? d.text).trim();
			if (text.length < 4) continue;
			const spkId = d.speaker ? labelToCharacterId.get(d.speaker.trim().toLowerCase()) : undefined;
			importantDialogues.push({
				chapterNumber: input.chapterNumber,
				sceneId: sc.sceneId,
				panelId: sc.panelIds[0],
				...(spkId ? { speakerCharacterId: spkId } : {}),
				...(d.speaker ? { speakerLabel: d.speaker } : {}),
				text,
			});
		}
	}

	const locations = [...new Set(input.script.scenes.map((s) => s.setting ?? '').filter(Boolean))];
	const chapterSummary = input.script.scenes
		.map((s) => s.narrationText.trim())
		.join(' ')
		.slice(0, 420);

	const chapterRecord: StoryMemoryChapterRecord = storyMemoryChapterRecordSchema.parse({
		chapterNumber: input.chapterNumber,
		chapterId: input.chapterId,
		summary: chapterSummary || `Capítulo ${input.chapterNumber} processado.`,
		events,
		involvedCharacterIds: [...involvedCharIds],
		importantDialogues: importantDialogues.slice(0, 20),
		locations,
		confirmedRevelations: input.sequence.continuityState?.revealedFacts ?? [],
		ongoingConflicts: input.sequence.continuityState?.ongoingConflict ? [input.sequence.continuityState.ongoingConflict] : [],
		openQuestions: input.sequence.continuityState?.openQuestions ?? [],
		processedAtIso: now,
	});

	// Replace existing chapter record for idempotent reprocessing (never duplicate events!)
	project.chapters = [
		...project.chapters.filter((c) => c.chapterNumber !== input.chapterNumber),
		chapterRecord,
	].sort((a, b) => a.chapterNumber - b.chapterNumber);

	if (!project.importedChapters.includes(input.chapterNumber)) {
		project.importedChapters.push(input.chapterNumber);
		project.importedChapters.sort((a, b) => a - b);
	}
	if (!project.producedChapters.includes(input.chapterNumber)) {
		project.producedChapters.push(input.chapterNumber);
		project.producedChapters.sort((a, b) => a - b);
	}

	// Update consolidated narrative state
	project.narrativeState = {
		...(locations[locations.length - 1]
			? { currentLocation: locations[locations.length - 1] }
			: project.narrativeState.currentLocation
				? { currentLocation: project.narrativeState.currentLocation }
				: {}),
		ongoingConflicts: [...new Set(project.chapters.flatMap((c) => c.ongoingConflicts))].slice(-6),
		openQuestions: [...new Set(project.chapters.flatMap((c) => c.openQuestions))].slice(-8),
		revealedFacts: [...new Set(project.chapters.flatMap((c) => c.confirmedRevelations))].slice(-12),
	};

	// Keep pending updates deduplicated by updateId
	const existingPending = project.pendingUpdates.filter((u) => u.chapterNumber !== input.chapterNumber);
	project.pendingUpdates = [...existingPending, ...proposedUpdates.filter((u) => u.status === 'pending')];
	project.updatedAtIso = now;

	saveStoryMemoryProject(input.workspaceDir, project);
	return { project, chapterRecord, proposedUpdates };
}

// ─── Human Curation Operations (Phase 6) ─────────────────────────────────────

/**
 * Applies a human correction to a character's name/aliases/status and locks it
 * so future AI analyses prioritize and never overwrite the human decision.
 */
export function correctCharacterIdentity(input: {
	workspaceDir: string;
	projectId: string;
	characterId: string;
	primaryName: string;
	nameStatus?: CharacterNameStatus;
	addAliases?: readonly string[];
	reason?: string;
}): RecapStoryMemoryProject {
	const project = loadStoryMemoryProject(input.workspaceDir, input.projectId);
	if (!project) throw new Error(`Story Memory project not found: ${input.projectId}`);

	const ch = project.characters.find((c) => c.characterId === input.characterId);
	if (!ch) throw new Error(`Character not found: ${input.characterId}`);

	const now = new Date().toISOString();
	const prevName = ch.primaryName;
	const cleanName = input.primaryName.trim();
	if (!cleanName) throw new Error('Nome do personagem não pode ser vazio.');

	if (prevName && prevName.toLowerCase() !== cleanName.toLowerCase() && !ch.aliases.includes(prevName)) {
		ch.aliases.push(prevName);
	}
	for (const alias of input.addAliases ?? []) {
		const a = alias.trim();
		if (a && !ch.aliases.some((x) => x.toLowerCase() === a.toLowerCase())) {
			ch.aliases.push(a);
		}
	}

	ch.primaryName = cleanName;
	ch.nameStatus = input.nameStatus ?? 'confirmed';
	ch.lockedByHuman = true;
	ch.confidence = 1;
	ch.changeHistory.push({
		atIso: now,
		source: 'human',
		field: 'primaryName',
		...(prevName ? { from: prevName } : {}),
		to: cleanName,
		reason: input.reason ?? 'Correção manual pelo usuário',
	});

	saveStoryMemoryProject(input.workspaceDir, project);
	return project;
}

/**
 * Merges a duplicate character (`secondaryCharacterId`) into `primaryCharacterId`,
 * preserving all aliases, visual traits, panel references, chapter appearances and history.
 */
export function mergeStoryMemoryCharacters(input: {
	workspaceDir: string;
	projectId: string;
	primaryCharacterId: string;
	secondaryCharacterId: string;
}): RecapStoryMemoryProject {
	const project = loadStoryMemoryProject(input.workspaceDir, input.projectId);
	if (!project) throw new Error(`Story Memory project not found: ${input.projectId}`);
	if (input.primaryCharacterId === input.secondaryCharacterId) return project;

	const primary = project.characters.find((c) => c.characterId === input.primaryCharacterId);
	const secondary = project.characters.find((c) => c.characterId === input.secondaryCharacterId);
	if (!primary || !secondary) throw new Error('Personagens para mesclagem não encontrados.');

	const now = new Date().toISOString();
	if (secondary.primaryName && secondary.primaryName !== primary.primaryName && !primary.aliases.includes(secondary.primaryName)) {
		primary.aliases.push(secondary.primaryName);
	}
	for (const a of secondary.aliases) {
		if (!primary.aliases.some((x) => x.toLowerCase() === a.toLowerCase())) primary.aliases.push(a);
	}
	for (const t of secondary.visualTraits) {
		if (!primary.visualTraits.includes(t)) primary.visualTraits.push(t);
	}
	for (const ref of secondary.panelReferences) {
		if (!primary.panelReferences.some((r) => r.chapterNumber === ref.chapterNumber && r.panelId === ref.panelId)) {
			primary.panelReferences.push(ref);
		}
	}
	for (const chNum of secondary.appearedInChapters) {
		if (!primary.appearedInChapters.includes(chNum)) primary.appearedInChapters.push(chNum);
	}
	primary.appearedInChapters.sort((a, b) => a - b);
	if (secondary.firstAppearance.chapterNumber < primary.firstAppearance.chapterNumber) {
		primary.firstAppearance = secondary.firstAppearance;
	}
	primary.changeHistory.push({
		atIso: now,
		source: 'human',
		field: 'merged',
		from: secondary.characterId,
		to: primary.characterId,
		reason: `Mesclado com ${secondary.primaryName ?? secondary.characterId}`,
	});

	// Rewrite references in chapters
	for (const ch of project.chapters) {
		ch.involvedCharacterIds = [...new Set(ch.involvedCharacterIds.map((id) => (id === secondary.characterId ? primary.characterId : id)))];
		for (const evt of ch.events) {
			evt.characterIds = [...new Set(evt.characterIds.map((id) => (id === secondary.characterId ? primary.characterId : id)))];
		}
	}

	project.characters = project.characters.filter((c) => c.characterId !== secondary.characterId);
	project.pendingUpdates = project.pendingUpdates.filter((u) => u.targetCharacterId !== secondary.characterId);

	saveStoryMemoryProject(input.workspaceDir, project);
	return project;
}

export function resolveStoryMemoryPendingUpdate(input: {
	workspaceDir: string;
	projectId: string;
	updateId: string;
	decision: 'approved' | 'rejected';
}): RecapStoryMemoryProject {
	const project = loadStoryMemoryProject(input.workspaceDir, input.projectId);
	if (!project) throw new Error(`Story Memory project not found: ${input.projectId}`);

	const update = project.pendingUpdates.find((u) => u.updateId === input.updateId);
	if (!update) return project;

	update.status = input.decision;
	if (input.decision === 'approved' && update.kind === 'name_revealed' && update.targetCharacterId && update.proposedName) {
		const ch = project.characters.find((c) => c.characterId === update.targetCharacterId);
		if (ch && !ch.lockedByHuman) {
			ch.primaryName = update.proposedName;
			ch.nameStatus = 'confirmed';
			ch.lockedByHuman = true;
		}
	}

	project.pendingUpdates = project.pendingUpdates.filter((u) => u.updateId !== input.updateId);
	saveStoryMemoryProject(input.workspaceDir, project);
	return project;
}
