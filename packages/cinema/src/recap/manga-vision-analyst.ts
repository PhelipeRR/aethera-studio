import { z } from 'zod';
import {
	ACTION_TYPE_VALUES,
	DIALOGUE_KIND_VALUES,
	EMOTION_VALUES,
	type ActionType,
	type CharacterDetail,
	type DialogueEntry,
	type Emotion,
	type ExtractedPanel,
	type NarrativeEvidence,
	type PanelAnalysis,
	type ReadingOrder,
	type VisionAdapter,
	type VisionAnalysisContext,
	type VisionAnalysisResult,
} from './recap-types.js';
import type { RecapVisionRouterPort, RecapVisualAnalysisPort, StructuredVisionPayload } from './recap-vision-adapter.js';
import type { ChapterMemoryContext } from './story-memory.js';

export const MANGA_VISION_ANALYST_VERSION = '1.0.0';
export const MANGA_VISION_ANALYST_SCHEMA_VERSION = 1 as const;

// ─── Versioned Structured Contract ───────────────────────────────────────────

export const ATTRIBUTION_BASIS_VALUES = ['tail_pointing', 'proximity', 'context', 'uncertain'] as const;
export type AttributionBasis = (typeof ATTRIBUTION_BASIS_VALUES)[number];

export const mangaVisionBubbleSchema = z.object({
	kind: z.enum(DIALOGUE_KIND_VALUES).default('dialogue'),
	originalText: z.string().min(1),
	translatedText: z.string().nullish(),
	readingOrder: z.number().int().min(0).default(0),
	speaker: z.string().nullish(),
	speakerConfidence: z.number().min(0).max(1).default(0.5),
	attributionBasis: z.enum(ATTRIBUTION_BASIS_VALUES).default('uncertain'),
	uncertainty: z.string().nullish(),
});
export type MangaVisionBubble = z.infer<typeof mangaVisionBubbleSchema>;

export const mangaVisionEntitySchema = z.object({
	idOrLabel: z.string().min(1),
	storyMemoryId: z.string().nullish(),
	visualSignature: z.string().nullish(),
	expression: z.string().nullish(),
	poseOrAction: z.string().nullish(),
	basis: z.enum(['observed', 'inferred']).default('observed'),
	evidence: z.string().default('Observado no painel'),
	confidence: z.number().min(0).max(1).default(0.8),
});
export type MangaVisionEntity = z.infer<typeof mangaVisionEntitySchema>;

export const mangaVisionActionSchema = z.object({
	type: z.enum(ACTION_TYPE_VALUES).default('observation'),
	actor: z.string().nullish(),
	description: z.string().min(1),
	basis: z.enum(['observed', 'inferred']).default('observed'),
	confidence: z.number().min(0).max(1).default(0.8),
});
export type MangaVisionAction = z.infer<typeof mangaVisionActionSchema>;

export const mangaVisionEvidenceSchema = z.object({
	kind: z.enum(['ocr_text', 'visual_observation', 'inference']).default('visual_observation'),
	detail: z.string().min(1),
	confidence: z.number().min(0).max(1),
});
export type MangaVisionEvidenceItem = z.infer<typeof mangaVisionEvidenceSchema>;

export const mangaVisionPanelContractSchema = z.object({
	schemaVersion: z.literal(MANGA_VISION_ANALYST_SCHEMA_VERSION).default(1),
	narrativeSummary: z.string().min(1),
	characters: z.array(mangaVisionEntitySchema).default([]),
	actions: z.array(mangaVisionActionSchema).default([]),
	speechBubbles: z.array(mangaVisionBubbleSchema).default([]),
	expressions: z.array(z.string()).default([]),
	emotions: z.array(z.enum(EMOTION_VALUES)).default(['neutral']),
	environment: z.object({
		setting: z.string().min(1),
		basis: z.enum(['observed', 'inferred']).default('observed'),
		confidence: z.number().min(0).max(1),
	}).nullable().default(null),
	relevantObjects: z.array(z.string()).default([]),
	relationToPrevious: z.string().nullable().default(null),
	relationToNext: z.string().nullable().default(null),
	visualEvidence: z.array(mangaVisionEvidenceSchema).default([]),
	uncertainties: z.array(z.string()).default([]),
	confidence: z.number().min(0).max(1),
});
export type MangaPanelContract = z.infer<typeof mangaVisionPanelContractSchema>;

/** Model-agnostic JSON Schema for structured multimodal providers. */
export const MANGA_VISION_PANEL_JSON_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		schemaVersion: { type: 'integer', const: 1 },
		narrativeSummary: { type: 'string', minLength: 1, maxLength: 500 },
		characters: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					idOrLabel: { type: 'string', minLength: 1 },
					storyMemoryId: { type: 'string' },
					visualSignature: { type: 'string' },
					expression: { type: 'string' },
					poseOrAction: { type: 'string' },
					basis: { type: 'string', enum: ['observed', 'inferred'] },
					evidence: { type: 'string', minLength: 1 },
					confidence: { type: 'number', minimum: 0, maximum: 1 },
				},
				required: ['idOrLabel', 'basis', 'evidence', 'confidence'],
			},
		},
		actions: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					type: { type: 'string', enum: [...ACTION_TYPE_VALUES] },
					actor: { type: 'string' },
					description: { type: 'string', minLength: 1 },
					basis: { type: 'string', enum: ['observed', 'inferred'] },
					confidence: { type: 'number', minimum: 0, maximum: 1 },
				},
				required: ['type', 'description', 'basis', 'confidence'],
			},
		},
		speechBubbles: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kind: { type: 'string', enum: [...DIALOGUE_KIND_VALUES] },
					originalText: { type: 'string', minLength: 1 },
					translatedText: { type: 'string' },
					readingOrder: { type: 'integer', minimum: 0 },
					speaker: { anyOf: [{ type: 'string' }, { type: 'null' }] },
					speakerConfidence: { type: 'number', minimum: 0, maximum: 1 },
					attributionBasis: { type: 'string', enum: [...ATTRIBUTION_BASIS_VALUES] },
					uncertainty: { type: 'string' },
				},
				required: ['kind', 'originalText', 'readingOrder', 'speakerConfidence', 'attributionBasis'],
			},
		},
		expressions: { type: 'array', items: { type: 'string' } },
		emotions: { type: 'array', items: { type: 'string', enum: [...EMOTION_VALUES] } },
		environment: {
			anyOf: [
				{
					type: 'object',
					additionalProperties: false,
					properties: {
						setting: { type: 'string', minLength: 1 },
						basis: { type: 'string', enum: ['observed', 'inferred'] },
						confidence: { type: 'number', minimum: 0, maximum: 1 },
					},
					required: ['setting', 'basis', 'confidence'],
				},
				{ type: 'null' },
			],
		},
		relevantObjects: { type: 'array', items: { type: 'string' } },
		relationToPrevious: { anyOf: [{ type: 'string' }, { type: 'null' }] },
		relationToNext: { anyOf: [{ type: 'string' }, { type: 'null' }] },
		visualEvidence: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kind: { type: 'string', enum: ['ocr_text', 'visual_observation', 'inference'] },
					detail: { type: 'string', minLength: 1 },
					confidence: { type: 'number', minimum: 0, maximum: 1 },
				},
				required: ['kind', 'detail', 'confidence'],
			},
		},
		uncertainties: { type: 'array', items: { type: 'string' } },
		confidence: { type: 'number', minimum: 0, maximum: 1 },
	},
	required: [
		'schemaVersion',
		'narrativeSummary',
		'characters',
		'actions',
		'speechBubbles',
		'expressions',
		'emotions',
		'environment',
		'relationToPrevious',
		'relationToNext',
		'visualEvidence',
		'uncertainties',
		'confidence',
	],
} as const;

// ─── Cinematographic Jargon & Repetitive Boilerplate Filter ──────────────────

const CAMERA_JARGON_PATTERNS: readonly RegExp[] = [
	/\b(em\s+)?plano\s+(geral|m[ée]dio|fechado|superfechado|detalhe|americano|aberto|de\s+estabelecimento)(\s+noturno|\s+diurno|\s+vertical|\s+horizontal|\s+frontal|\s+visto\s+de\s+cima)?(\s*\([^)]+\))?(\s+de\s+ambienta[çc][ãa]o\s+\w+)?(\s+mostrando|\s+em)?[,:]?\s*/gi,
	/\b(em\s+)?(plong[ée]e|contra-plong[ée]e|close-up|super\s*close|extreme\s*close-up|long\s*shot|medium\s*shot|establishing\s*shot)\b(\s*\([^)]+\))?[,:]?\s*/gi,
	/\bem\s+um\s+painel(\s+vertical|\s+horizontal)?(\s+longo)?(\s+de\s+sequ[êe]ncia\s+de\s+movimento)?[,:]?\s*/gi,
	/\b(o\s+painel\s+(apresenta|mostra|exibe)|a\s+imagem\s+(mostra|sugere|exibe)|[ée]\s+poss[íi]vel\s+observar|nota-se\s+que)\b[,:]?\s*/gi,
	/\b(no\s+canto\s+(superior|inferior)\s+(esquerdo|direito)|no\s+primeiro\s+plano(\s+inferior|\s+superior)?)\b[,:]?\s*/gi,
	/\b(linhas(\s+verticais)?\s+de\s+velocidade(\s+radiais)?|enquadramento\s+\w+)\b[,:]?\s*/gi,
	/n[ãa]o\s+h[áa]\s+personagens\s+nem\s+bal[õo]es\s+de\s+texto\s+vis[íi]veis\.?/gi,
];

/**
 * Removes cinematographic framing jargon while keeping concrete story facts intact.
 */
export function stripCinematographicJargon(text: string | null | undefined): string {
	if (!text || typeof text !== 'string') return '';
	let cleaned = text.trim();
	for (const pattern of CAMERA_JARGON_PATTERNS) {
		cleaned = cleaned.replace(pattern, ' ');
	}
	cleaned = cleaned
		.replace(/\s+/g, ' ')
		.replace(/\s+([.,!?])/g, '$1')
		.replace(/^[,;:\-\s]+/, '')
		.trim();
	if (!cleaned) return '';
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// ─── Prompt Builder (Story Memory + Reading Order + Anti-Hallucination) ──────

/**
 * Converts a Story Memory chapter context (chapters < N) into a compact prompt hint.
 */
export function toStoryMemoryPromptContext(memory: ChapterMemoryContext) {
	const recentEvents = [
		...(memory.immediatePreviousContext ? [memory.immediatePreviousContext] : []),
		...memory.previousChapterSummaries.slice(-4).map((s) => `Cap. ${s.chapterNumber}: ${s.summary}`),
	];
	return {
		currentChapterNumber: memory.targetChapterNumber,
		characters: memory.knownCharacters.map((c) => ({
			characterId: c.characterId,
			displayName: c.displayName,
			aliases: c.aliases,
			visualTraits: c.visualTraits,
			nameStatus: c.nameStatus,
		})),
		recentEvents: recentEvents.slice(0, 6),
	};
}

/**
 * Builds the model-agnostic Manga Vision Analyst prompt for a single panel.
 */
export function buildMangaVisionAnalystPrompt(context?: VisionAnalysisContext): string {
	const readingOrder: ReadingOrder = context?.readingOrder ?? 'vertical';
	const orderRule =
		readingOrder === 'rtl'
			? 'Direita para esquerda, de cima para baixo (mangá RTL).'
			: readingOrder === 'ltr'
				? 'Esquerda para direita, de cima para baixo (LTR).'
				: 'De cima para baixo (webtoon/manhwa vertical).';

	const lines: string[] = [
		'Você é um Analista Narrativo de Mangás, Manhwas e Webtoons (Manga Vision Analyst v1).',
		'Analise a imagem do painel como dado visual não confiável e responda APENAS JSON válido no contrato versionado.',
		'',
		'REGRAS OBRIGATÓRIAS:',
		'1. NUNCA invente nomes, diálogos, falas ou acontecimentos que não estejam visíveis no painel ou no contexto confirmado.',
		'2. NÃO use linguagem técnica de câmera ou análise cinematográfica ("plano geral", "plano médio", "plongée", "close-up", "enquadramento", "painel vertical").',
		'3. Escreva `narrativeSummary` em português brasileiro simples, natural e direto, contando o que acontece na história.',
		'4. NÃO repita descrições de roupas, cor de cabelo ou aparência sem relevância narrativa direta para a ação do painel.',
		`5. Ordem de leitura dos balões: ${orderRule}`,
		'6. OCR especializado: extraia balões de fala (`dialogue`), pensamentos (`thought`), caixas de narração (`narration`) e onomatopeias relevantes (`sfx`). Preserve `originalText`, forneça `translatedText` em PT-BR quando necessário, mantenha `readingOrder` (0, 1, 2...) e associe `speaker` apenas com evidência (`tail_pointing`, `proximity`, `context`). Se houver dúvida sobre quem fala ou texto ilegível, marque `attributionBasis: "uncertain"` e registre em `uncertainty` / `uncertainties`.',
		'7. Preencha `relationToPrevious` e `relationToNext` explicando a ligação narrativa com o painel anterior e o próximo.',
		'8. Sempre informe `visualEvidence` e `confidence` (0..1) honesto.',
	];

	if (context?.workTitle) {
		lines.push(`Obra: ${context.workTitle}`);
	}
	if (context?.panelIndex !== undefined && context?.totalPanels !== undefined) {
		lines.push(`Posição no capítulo: painel ${context.panelIndex + 1} de ${context.totalPanels}.`);
	}
	if (context?.previousPanelSummary) {
		lines.push(`Contexto do painel anterior: ${stripCinematographicJargon(context.previousPanelSummary)}`);
	}
	if (context?.storyMemoryContext) {
		const mem = context.storyMemoryContext;
		lines.push(`Memória da história (somente capítulos anteriores ao cap. ${mem.currentChapterNumber} — proibido usar spoilers futuros):`);
		if (mem.characters.length > 0) {
			const charLines = mem.characters.slice(0, 12).map((c) => {
				const parts = [`${c.characterId}: ${c.displayName} (${c.nameStatus})`];
				if (c.aliases.length > 0) parts.push(`apelidos: ${c.aliases.join(', ')}`);
				if (c.visualTraits.length > 0) parts.push(`traços: ${c.visualTraits.slice(0, 3).join(', ')}`);
				return `- ${parts.join(' | ')}`;
			});
			lines.push(...charLines);
		}
		if (mem.recentEvents.length > 0) {
			lines.push(`Acontecimentos recentes: ${mem.recentEvents.slice(0, 4).join(' | ')}`);
		}
	} else if (context?.knownCharacters && context.knownCharacters.length > 0) {
		lines.push(`Personagens conhecidos até este ponto: ${context.knownCharacters.join(', ')}`);
	}
	if (context?.ocrHint) {
		lines.push(`Pista de OCR prévio (verifique visualmente): ${context.ocrHint}`);
	}

	return lines.join('\n');
}

// ─── Payload Parsing & Conversion ────────────────────────────────────────────

function parseJsonObjectLoose(raw: string): Record<string, unknown> | null {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function normalizeActionType(raw: string): ActionType {
	const lower = raw.trim().toLowerCase();
	if ((ACTION_TYPE_VALUES as readonly string[]).includes(lower)) {
		return lower as ActionType;
	}
	if (/fight|combat|attack|strike|clash|luta|golpe/.test(lower)) return 'combat';
	if (/run|walk|jump|fall|chase|move|corre|cai|trope|salta/.test(lower)) return 'movement';
	if (/talk|speak|shout|ask|fala|diz|grita|pergunta/.test(lower)) return 'dialogue';
	if (/shock|surprise|gasp|react|surpresa|choque|espanto/.test(lower)) return 'reaction';
	if (/transform|awaken|desperta|transforma/.test(lower)) return 'transformation';
	return 'observation';
}

/**
 * Parses a raw string, MangaPanelContract, or VisionRouter StructuredVisionPayload
 * into a validated MangaPanelContract.
 */
export function parseMangaVisionContractPayload(raw: unknown): MangaPanelContract | null {
	const obj = typeof raw === 'string' ? parseJsonObjectLoose(raw) : raw;
	if (!obj || typeof obj !== 'object') return null;

	const direct = mangaVisionPanelContractSchema.safeParse(obj);
	if (direct.success) {
		return {
			...direct.data,
			narrativeSummary: stripCinematographicJargon(direct.data.narrativeSummary) || direct.data.narrativeSummary,
		};
	}

	// Fallback adaptation from generic VisionRouter StructuredVisionPayload
	const payload = obj as Partial<StructuredVisionPayload> & Record<string, unknown>;
	const rawSummary =
		typeof payload['narrativeSummary'] === 'string'
			? payload['narrativeSummary']
			: typeof payload.description === 'string'
				? payload.description
				: '';
	const cleanSummary = stripCinematographicJargon(rawSummary);
	if (!cleanSummary) return null;

	const characters: MangaVisionEntity[] = Array.isArray(payload.entities)
		? payload.entities.map((e) => ({
				idOrLabel: e.name,
				basis: e.basis === 'inferred' ? 'inferred' : 'observed',
				evidence: e.evidence || 'Observado no painel',
				confidence: typeof e.confidence === 'number' ? Math.max(0, Math.min(1, e.confidence)) : 0.7,
			}))
		: Array.isArray(payload['characters'])
			? (payload['characters'] as unknown[]).flatMap((c): MangaVisionEntity[] => {
					if (typeof c === 'string' && c.trim()) {
						return [{ idOrLabel: c.trim(), basis: 'observed', evidence: 'Observado no painel', confidence: 0.8 }];
					}
					if (c && typeof c === 'object') {
						const obj = c as Record<string, unknown>;
						const label = typeof obj['idOrLabel'] === 'string' ? obj['idOrLabel'] : typeof obj['name'] === 'string' ? obj['name'] : '';
						if (label.trim()) {
							return [{
								idOrLabel: label.trim(),
								basis: obj['basis'] === 'inferred' ? 'inferred' : 'observed',
								evidence: typeof obj['evidence'] === 'string' && obj['evidence'] ? obj['evidence'] : 'Observado no painel',
								confidence: typeof obj['confidence'] === 'number' ? Math.max(0, Math.min(1, obj['confidence'])) : 0.8,
							}];
						}
					}
					return [];
				})
			: [];

	const actions: MangaVisionAction[] = Array.isArray(payload.actions)
		? payload.actions.map((a) => ({
				type: normalizeActionType(a.description),
				description: stripCinematographicJargon(a.description) || a.description,
				basis: a.basis === 'inferred' ? 'inferred' : 'observed',
				confidence: typeof a.confidence === 'number' ? Math.max(0, Math.min(1, a.confidence)) : 0.7,
			}))
		: [];

	const bubbles: MangaVisionBubble[] = [];
	if (Array.isArray(payload.speechBubbles)) {
		payload.speechBubbles.forEach((b, idx) => {
			const text = (b.originalText || b.translatedText || b.text || '').trim();
			if (!text) return;
			bubbles.push({
				kind: b.kind ?? (b.isNarration ? 'narration' : 'dialogue'),
				originalText: b.originalText?.trim() || text,
				...(b.translatedText?.trim() ? { translatedText: b.translatedText.trim() } : {}),
				readingOrder: b.readingOrder ?? idx,
				...(b.speaker ? { speaker: b.speaker } : {}),
				speakerConfidence: b.speaker ? 0.75 : 0.3,
				attributionBasis: b.speaker ? 'context' : 'uncertain',
				...(b.uncertainty ? { uncertainty: b.uncertainty } : {}),
			});
		});
	} else if (Array.isArray(payload.frames)) {
		let idx = 0;
		for (const f of payload.frames) {
			for (const vt of f.visibleText ?? []) {
				if (!vt.text?.trim()) continue;
				bubbles.push({
					kind: 'dialogue',
					originalText: vt.text.trim(),
					readingOrder: idx++,
					speakerConfidence: 0.3,
					attributionBasis: 'uncertain',
					uncertainty: 'Texto extraído sem associação garantida ao falante.',
				});
			}
		}
	}

	return {
		schemaVersion: 1,
		narrativeSummary: cleanSummary,
		characters,
		actions,
		speechBubbles: bubbles,
		expressions: Array.isArray(payload.expressions) ? payload.expressions.filter((x): x is string => typeof x === 'string') : [],
		emotions: ['neutral'],
		environment: payload.environment
			? {
					setting: stripCinematographicJargon(payload.environment.description) || payload.environment.description,
					basis: payload.environment.basis === 'inferred' ? 'inferred' : 'observed',
					confidence: payload.environment.confidence,
				}
			: null,
		relevantObjects: Array.isArray(payload.relevantObjects) ? payload.relevantObjects : [],
		relationToPrevious: typeof payload.relationToPrevious === 'string' ? payload.relationToPrevious : null,
		relationToNext: typeof payload.relationToNext === 'string' ? payload.relationToNext : null,
		visualEvidence: [
			{
				kind: 'visual_observation',
				detail: cleanSummary,
				confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.7,
			},
		],
		uncertainties: Array.isArray(payload.limitations) ? payload.limitations : [],
		confidence: typeof payload.confidence === 'number' ? Math.max(0, Math.min(1, payload.confidence)) : 0.7,
	};
}

/**
 * Converts a validated MangaPanelContract into StoryEngine's VisionAnalysisResult.
 */
export function contractToVisionAnalysisResult(contract: MangaPanelContract): VisionAnalysisResult {
	const characters = contract.characters.map((c) => c.idOrLabel);
	const characterDetails: CharacterDetail[] = contract.characters.map((c) => ({
		id: c.storyMemoryId || c.idOrLabel,
		...(c.visualSignature ? { appearance: c.visualSignature } : {}),
		...(c.expression ? { expression: c.expression } : {}),
		...(c.poseOrAction ? { poseOrAction: c.poseOrAction } : {}),
	}));

	const speechBubbles: DialogueEntry[] = [...contract.speechBubbles]
		.sort((a, b) => a.readingOrder - b.readingOrder)
		.map((b) => {
			const uncertainty =
				b.uncertainty ??
				(b.attributionBasis === 'uncertain' && !b.speaker
					? 'Falante não identificado com certeza visual.'
					: undefined);
			return {
				text: b.translatedText?.trim() || b.originalText,
				originalText: b.originalText,
				...(b.translatedText?.trim() ? { translatedText: b.translatedText.trim() } : {}),
				kind: b.kind,
				isNarration: b.kind === 'narration',
				readingOrder: b.readingOrder,
				...(b.speaker && b.speakerConfidence >= 0.4 ? { speaker: b.speaker } : {}),
				...(uncertainty ? { uncertainty } : {}),
			};
		});

	const actions = contract.actions.map((a) => ({
		type: a.type,
		description: stripCinematographicJargon(a.description) || a.description,
	}));

	return {
		visualDescription: stripCinematographicJargon(contract.narrativeSummary) || contract.narrativeSummary,
		characters,
		...(characterDetails.length > 0 ? { characterDetails } : {}),
		actions: actions.length > 0 ? actions : [{ type: 'observation', description: contract.narrativeSummary }],
		emotions: contract.emotions.length > 0 ? contract.emotions : ['neutral'],
		...(contract.expressions.length > 0 ? { expressions: contract.expressions } : {}),
		...(contract.relevantObjects.length > 0 ? { relevantObjects: contract.relevantObjects } : {}),
		...(speechBubbles.length > 0 ? { speechBubbles } : {}),
		setting: contract.environment?.setting,
		...(contract.relationToPrevious ? { relationToPrevious: contract.relationToPrevious } : {}),
		...(contract.relationToNext ? { relationToNext: contract.relationToNext } : {}),
		...(contract.uncertainties.length > 0 ? { uncertainties: contract.uncertainties } : {}),
		confidence: contract.confidence,
	};
}

// ─── VisionRouter / Provider Adapter ─────────────────────────────────────────

export interface MangaVisionAdapterOptions {
	/** Existing VisionRouter port (RecapVisionRouterPort) or single provider port. */
	router?: RecapVisionRouterPort;
	provider?: RecapVisualAnalysisPort;
	/** Fallback VisionAdapter when using a custom/CLI vision implementation. */
	visionAdapter?: VisionAdapter;
	/** Optional Story Memory context (strictly chapters < currentChapterNumber). */
	storyMemoryContext?: ReturnType<typeof toStoryMemoryPromptContext>;
	policyChain?: readonly string[];
	budgetUsd?: number;
	maxLatencyMs?: number;
}

/**
 * Creates a model-agnostic VisionAdapter powered by the Manga Vision Analyst contract.
 * Preserves VisionRouter fallback/quota behavior without modifying router internals.
 */
export function createMangaVisionVisionAdapter(options: MangaVisionAdapterOptions): VisionAdapter {
	const {
		router,
		provider,
		visionAdapter,
		storyMemoryContext,
		policyChain = ['claude', 'codex', 'antigravity'],
		budgetUsd = 0.5,
		maxLatencyMs = 45_000,
	} = options;

	if (!router && !provider && !visionAdapter) {
		throw new Error('createMangaVisionVisionAdapter requires a router, provider, or visionAdapter.');
	}

	const adapterName = router
		? `manga-vision-analyst@${MANGA_VISION_ANALYST_VERSION}(router)`
		: provider
			? `manga-vision-analyst@${MANGA_VISION_ANALYST_VERSION}(${provider.id})`
			: `manga-vision-analyst@${MANGA_VISION_ANALYST_VERSION}(${visionAdapter!.name})`;

	return {
		name: adapterName,
		async analyze(imagePathOrBuffer: string | Buffer, context?: VisionAnalysisContext): Promise<VisionAnalysisResult> {
			const enrichedContext: VisionAnalysisContext = {
				...context,
				...(storyMemoryContext && !context?.storyMemoryContext ? { storyMemoryContext } : {}),
			};
			const prompt = buildMangaVisionAnalystPrompt(enrichedContext);

			if (visionAdapter) {
				const res = await visionAdapter.analyze(imagePathOrBuffer, enrichedContext);
				return {
					...res,
					...(res.visualDescription
						? { visualDescription: stripCinematographicJargon(res.visualDescription) || res.visualDescription }
						: {}),
					actions: res.actions.map((a) => ({
						...a,
						description: stripCinematographicJargon(a.description) || a.description,
					})),
				};
			}

			if (typeof imagePathOrBuffer !== 'string') {
				return {
					characters: [],
					actions: [],
					emotions: ['unknown'],
					setting: undefined,
					uncertainties: ['MangaVisionAnalyst requer caminho de arquivo para VisionRouter/Provider.'],
					confidence: 0,
				};
			}

			const frames = [{ hash: `manga-v${MANGA_VISION_ANALYST_SCHEMA_VERSION}`, path: imagePathOrBuffer }];

			if (router) {
				const policy = {
					chain: [...policyChain],
					scope: 'manga-vision-analyst',
					version: MANGA_VISION_ANALYST_VERSION,
					budgetUsd,
					maxLatencyMs,
					thresholds: null,
				};
				const res = await router.analyze({ frames, context: prompt, policy });
				if (res.value) {
					const contract = parseMangaVisionContractPayload(res.value);
					if (contract) return contractToVisionAnalysisResult(contract);
				}
				return {
					characters: [],
					actions: [],
					emotions: ['unknown'],
					setting: undefined,
					uncertainties: ['Nenhum provedor do VisionRouter retornou análise válida para o painel.'],
					confidence: 0,
				};
			}

			if (provider?.analyze) {
				const raw = await provider.analyze({ frames, context: prompt });
				const contract = parseMangaVisionContractPayload(raw);
				if (contract) return contractToVisionAnalysisResult(contract);
			}

			return {
				characters: [],
				actions: [],
				emotions: ['unknown'],
				setting: undefined,
				uncertainties: ['Provedor multimodal não suporta análise estruturada.'],
				confidence: 0,
			};
		},
	};
}

// ─── Sequence Consolidation (Panel Group -> Natural Narrative) ────────────────

export interface MangaSequenceGroup {
	groupId: string;
	panelIds: string[];
	consolidatedNarrative: string;
	characters: string[];
	dialogues: DialogueEntry[];
	setting?: string;
	confidence: number;
	uncertainties: string[];
}

export interface SequenceConsolidationResult {
	groups: MangaSequenceGroup[];
	enrichedAnalyses: PanelAnalysis[];
}

const REPETITIVE_TRAIT_PHRASE_PATTERNS: readonly RegExp[] = [
	/\bde\s+cabelos\s+escuros(\s+desalinhados)?\b/gi,
	/\bem\s+t[úu]nica\s+clara(\s+com\s+faixa\s+\w+)?\b/gi,
	/\bcom\s+faixa\s+\w+\s+na\s+cintura\b/gi,
	/\bvestindo\s+[^,.]+/gi,
];

function stripRepetitiveAppearance(text: string): string {
	let out = stripCinematographicJargon(text);
	for (const re of REPETITIVE_TRAIT_PHRASE_PATTERNS) {
		out = out.replace(re, '');
	}
	return out.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

function shouldGroupPanels(prev: PanelAnalysis, curr: PanelAnalysis, groupSize: number, maxPanelsPerSequence: number): boolean {
	if (groupSize >= maxPanelsPerSequence) return false;
	if (curr.actions.some((a) => a.type === 'transformation')) return false;

	const prevChars = new Set(prev.characters.map((c) => c.toLowerCase()));
	const currChars = new Set(curr.characters.map((c) => c.toLowerCase()));
	const charOverlap = prevChars.size === 0 || currChars.size === 0 || [...prevChars].some((c) => currChars.has(c));
	if (!charOverlap) return false;

	if (prev.setting && curr.setting && prev.setting.toLowerCase() !== curr.setting.toLowerCase()) {
		const prevWords = new Set(prev.setting.toLowerCase().split(/\s+/).filter((w) => w.length >= 4));
		const sharesWord = curr.setting.toLowerCase().split(/\s+/).some((w) => prevWords.has(w));
		if (!sharesWord && prev.relationToNext === undefined && curr.relationToPrevious === undefined) {
			return false;
		}
	}

	return true;
}

function synthesizeGroupNarrative(panels: readonly PanelAnalysis[]): string {
	const clauses: string[] = [];
	const seenNormalized = new Set<string>();

	for (let i = 0; i < panels.length; i++) {
		const p = panels[i]!;
		const raw = p.visualDescription || p.actions.map((a) => a.description).join('; ');
		if (!raw) continue;

		// Keep full character/setting intro on first clause, strip repetitive appearance on subsequent clauses
		const cleaned = i === 0 ? stripCinematographicJargon(raw) : stripRepetitiveAppearance(raw);
		const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() ?? '';
		if (!firstSentence) continue;

		const norm = firstSentence.toLowerCase().replace(/[^a-z0-9]/g, '');
		if (seenNormalized.has(norm)) continue;
		seenNormalized.add(norm);

		clauses.push(firstSentence.replace(/[.]+$/, ''));
	}

	if (clauses.length === 0) return 'A cena avança sem descrição visual detalhada.';
	if (clauses.length === 1) return `${clauses[0]}.`;
	if (clauses.length === 2) return `${clauses[0]}. Em seguida, ${clauses[1].charAt(0).toLowerCase() + clauses[1].slice(1)}.`;

	const first = clauses[0]!;
	const middle = clauses.slice(1, -1).map((c) => c.charAt(0).toLowerCase() + c.slice(1)).join(', ');
	const last = clauses[clauses.length - 1]!;
	const lastLower = last.charAt(0).toLowerCase() + last.slice(1);
	return `${first}, ${middle} e ${lastLower}.`;
}

/**
 * Consolidates consecutive panel analyses into narrative sequence groups,
 * removing camera jargon and repetitive appearance descriptions.
 */
export function consolidateMangaPanelSequence(
	analyses: readonly PanelAnalysis[],
	options?: { maxPanelsPerSequence?: number },
): SequenceConsolidationResult {
	const maxPanelsPerSequence = Math.max(1, Math.min(6, options?.maxPanelsPerSequence ?? 4));
	if (analyses.length === 0) {
		return { groups: [], enrichedAnalyses: [] };
	}

	const rawGroups: PanelAnalysis[][] = [];
	let currentGroup: PanelAnalysis[] = [analyses[0]!];

	for (let i = 1; i < analyses.length; i++) {
		const prev = analyses[i - 1]!;
		const curr = analyses[i]!;
		if (shouldGroupPanels(prev, curr, currentGroup.length, maxPanelsPerSequence)) {
			currentGroup.push(curr);
		} else {
			rawGroups.push(currentGroup);
			currentGroup = [curr];
		}
	}
	rawGroups.push(currentGroup);

	const groups: MangaSequenceGroup[] = [];
	const enrichedAnalyses: PanelAnalysis[] = [];

	rawGroups.forEach((groupPanels, idx) => {
		const consolidatedNarrative = synthesizeGroupNarrative(groupPanels);
		const characters = [...new Set(groupPanels.flatMap((p) => p.characters))];
		const dialogues = groupPanels.flatMap((p) => p.dialogues);
		const setting = groupPanels.find((p) => p.setting)?.setting;
		const avgConfidence =
			groupPanels.reduce((sum, p) => sum + p.analysisConfidence, 0) / groupPanels.length;
		const uncertainties = [...new Set(groupPanels.flatMap((p) => p.uncertainties ?? []))];

		groups.push({
			groupId: `seq_${String(idx + 1).padStart(3, '0')}`,
			panelIds: groupPanels.map((p) => p.panelId),
			consolidatedNarrative,
			characters,
			dialogues,
			...(setting ? { setting } : {}),
			confidence: Number(avgConfidence.toFixed(3)),
			uncertainties,
		});

		for (const panel of groupPanels) {
			const cleanDesc = stripCinematographicJargon(panel.visualDescription ?? '') || panel.visualDescription;
			enrichedAnalyses.push({
				...panel,
				...(cleanDesc ? { visualDescription: cleanDesc } : {}),
				actions: panel.actions.map((a) => ({
					...a,
					description: stripCinematographicJargon(a.description) || a.description,
				})),
			});
		}
	});

	return { groups, enrichedAnalyses };
}

// ─── Analysis Quality Gate ───────────────────────────────────────────────────

export interface MangaVisionReviewItem {
	panelId: string;
	dimension: 'coverage' | 'dialogue' | 'continuity' | 'character' | 'hallucination' | 'confidence';
	severity: 'minor' | 'major';
	reason: string;
	suggestedAction: string;
}

export interface MangaVisionQualityGateReport {
	verdict: 'pass' | 'needs_review' | 'fail';
	shouldBlockProduction: boolean;
	reviewItems: MangaVisionReviewItem[];
	metrics: {
		totalPanels: number;
		coveredPanels: number;
		coverageRatio: number;
		substantiveDialoguesTotal: number;
		dialoguesWithUncertainSpeaker: number;
		averageConfidence: number;
		minConfidence: number;
		jargonOccurrencesRemaining: number;
	};
	summary: string;
}

const SPOILER_OR_META_PATTERNS: readonly RegExp[] = [
	/\bno pr[óo]ximo cap[íi]tulo\b/i,
	/\bcap[íi]tulos? futuros?\b/i,
	/\bmais tarde na hist[óo]ria\b/i,
];

/**
 * Evaluates panel analyses across 6 dimensions and requests punctual review
 * when doubts exist, without blocking production over minor details.
 */
export function runMangaVisionQualityGate(input: {
	panels: readonly ExtractedPanel[];
	analyses: readonly PanelAnalysis[];
	minConfidence?: number;
}): MangaVisionQualityGateReport {
	const { panels, analyses, minConfidence = 0.5 } = input;
	const reviewItems: MangaVisionReviewItem[] = [];
	const analysisByPanel = new Map(analyses.map((a) => [a.panelId, a]));

	let coveredPanels = 0;
	let substantiveDialoguesTotal = 0;
	let dialoguesWithUncertainSpeaker = 0;
	let jargonOccurrencesRemaining = 0;
	let confSum = 0;
	let minConf = 1;

	for (const panel of panels) {
		const analysis = analysisByPanel.get(panel.panelId);
		if (!analysis || analysis.analysisConfidence <= 0) {
			reviewItems.push({
				panelId: panel.panelId,
				dimension: 'coverage',
				severity: 'major',
				reason: 'Painel sem análise visual válida.',
				suggestedAction: 'Reanalisar painel via VisionRouter.',
			});
			minConf = 0;
			continue;
		}

		coveredPanels++;
		confSum += analysis.analysisConfidence;
		if (analysis.analysisConfidence < minConf) minConf = analysis.analysisConfidence;

		if (analysis.analysisConfidence < minConfidence) {
			reviewItems.push({
				panelId: panel.panelId,
				dimension: 'confidence',
				severity: analysis.analysisConfidence < 0.3 ? 'major' : 'minor',
				reason: `Confiança baixa (${analysis.analysisConfidence.toFixed(2)} < ${minConfidence}).`,
				suggestedAction: 'Revisar interpretação deste painel pontualmente.',
			});
		}

		const desc = analysis.visualDescription ?? '';
		if (CAMERA_JARGON_PATTERNS.some((re) => re.test(desc))) {
			jargonOccurrencesRemaining++;
			reviewItems.push({
				panelId: panel.panelId,
				dimension: 'continuity',
				severity: 'minor',
				reason: 'Descrição ainda contém jargão de enquadramento/câmera.',
				suggestedAction: 'Aplicar simplificação narrativa antes do roteiro.',
			});
		}

		if (SPOILER_OR_META_PATTERNS.some((re) => re.test(desc))) {
			reviewItems.push({
				panelId: panel.panelId,
				dimension: 'hallucination',
				severity: 'major',
				reason: 'Possível referência a capítulos futuros ou meta-comentário.',
				suggestedAction: 'Remover referência externa não observada no painel.',
			});
		}

		if (analysis.evidence.length === 0 && desc.length > 0) {
			reviewItems.push({
				panelId: panel.panelId,
				dimension: 'hallucination',
				severity: 'minor',
				reason: 'Análise sem evidência visual/OCR explícita.',
				suggestedAction: 'Confirmar afirmação no painel original.',
			});
		}

		for (const d of analysis.dialogues) {
			if ((d.kind ?? 'dialogue') === 'sfx') continue;
			substantiveDialoguesTotal++;
			if (!d.speaker && d.kind === 'dialogue') {
				dialoguesWithUncertainSpeaker++;
				reviewItems.push({
					panelId: panel.panelId,
					dimension: 'dialogue',
					severity: 'minor',
					reason: `Fala "${d.text.slice(0, 40)}" sem atribuição certa de personagem.`,
					suggestedAction: 'Confirmar falante se houver mais de um personagem em cena.',
				});
			}
		}
	}

	const totalPanels = panels.length;
	const coverageRatio = totalPanels > 0 ? coveredPanels / totalPanels : 0;
	const averageConfidence = coveredPanels > 0 ? confSum / coveredPanels : 0;
	const hasMajorHallucination = reviewItems.some((r) => r.dimension === 'hallucination' && r.severity === 'major');
	const shouldBlockProduction = totalPanels === 0 || coverageRatio < 0.5 || hasMajorHallucination;

	const verdict: MangaVisionQualityGateReport['verdict'] = shouldBlockProduction
		? 'fail'
		: reviewItems.length > 0
			? 'needs_review'
			: 'pass';

	const summary =
		verdict === 'pass'
			? `Análise aprovada: ${coveredPanels}/${totalPanels} painéis cobertos (confiança média ${averageConfidence.toFixed(2)}).`
			: verdict === 'needs_review'
				? `Revisão pontual sugerida em ${reviewItems.length} item(ns) sem bloquear produção (${coveredPanels}/${totalPanels} painéis cobertos).`
				: `Qualidade insuficiente: ${coveredPanels}/${totalPanels} painéis cobertos ou violação crítica detectada.`;

	return {
		verdict,
		shouldBlockProduction,
		reviewItems,
		metrics: {
			totalPanels,
			coveredPanels,
			coverageRatio: Number(coverageRatio.toFixed(3)),
			substantiveDialoguesTotal,
			dialoguesWithUncertainSpeaker,
			averageConfidence: Number(averageConfidence.toFixed(3)),
			minConfidence: Number(minConf.toFixed(3)),
			jargonOccurrencesRemaining,
		},
		summary,
	};
}
