import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segmentAnalysisSchema, type SegmentAnalysis } from '@neuralbridge/shared';
import { panelAnalysisSchema, type ExtractedPanel, type PanelAnalysis } from './recap-types.js';

export type HistoricalCheckpointStatus = 'compatible' | 'migratable' | 'incompatible' | 'corrupted' | 'missing';

export interface HistoricalCheckpointIdentity {
	provider?: string;
	model?: string;
	promptVersion?: string;
	schemaVersion?: number;
	preprocessingVersion?: string;
	cacheVersion?: string;
	contextFingerprint?: string;
}

export interface HistoricalCheckpointRecord {
	checkpointVersion?: string;
	cacheKey?: string;
	panel?: {
		panelId?: string;
		sha256?: string;
		pageNumber?: number;
		panelIndex?: number;
		readingOrder?: string;
		boundingBox?: { x?: number; y?: number; w?: number; h?: number };
		width?: number;
		height?: number;
	};
	identity?: HistoricalCheckpointIdentity;
	reportedModel?: string | null;
	analysis?: unknown;
}

export interface HistoricalCheckpointResolution {
	panelId: string;
	status: HistoricalCheckpointStatus;
	filePath: string | null;
	reason: string;
	panelSha256: string | null;
	analysis: PanelAnalysis | null;
	source: 'historical' | 'none';
}

export interface HistoricalCheckpointResolutionReport {
	rootDirectory: string;
	checkedAtIso: string;
	results: HistoricalCheckpointResolution[];
	counts: Record<HistoricalCheckpointStatus, number>;
}

/** Combines read-only checkpoint scans without allowing a later source to
 * overwrite an already indexed panel identity. */
export function mergeHistoricalRecapCheckpointReports(
	reports: readonly HistoricalCheckpointResolutionReport[],
): HistoricalCheckpointResolutionReport {
	const byPanelId = new Map<string, HistoricalCheckpointResolution>();
	const rank: Record<HistoricalCheckpointStatus, number> = { compatible: 4, migratable: 3, incompatible: 2, corrupted: 1, missing: 0 };
	for (const report of reports) {
		for (const result of report.results) {
			const existing = byPanelId.get(result.panelId);
			if (!existing || rank[result.status] > rank[existing.status]) byPanelId.set(result.panelId, result);
		}
	}
	const results = [...byPanelId.values()];
	const counts = { compatible: 0, migratable: 0, incompatible: 0, corrupted: 0, missing: 0 } satisfies Record<HistoricalCheckpointStatus, number>;
	for (const result of results) counts[result.status] += 1;
	return {
		rootDirectory: reports.map((report) => report.rootDirectory).join(';'),
		checkedAtIso: new Date().toISOString(),
		results,
		counts,
	};
}

function sha256(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeText(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function mapSegmentAnalysis(raw: SegmentAnalysis, panel: ExtractedPanel, reportedModel: string | null): PanelAnalysis {
	const dialogues = raw.frames.flatMap((frame, frameIndex) => frame.visibleText.map((line, lineIndex) => ({
		text: line.text,
		originalText: line.text,
		kind: 'dialogue' as const,
		isNarration: false,
		readingOrder: frameIndex * 100 + lineIndex,
		contentKind: 'unknown' as const,
		contentEvidence: [{ source: 'checkpoint' as const, detail: 'Texto visível preservado do checkpoint histórico; classificação textual requer revisão independente.' }],
		contentProvenance: { source: 'checkpoint' as const, panelId: panel.panelId, lineIndex, ref: `historical:${frameIndex}:${lineIndex}` },
	})));
	const characters = raw.entities
		.filter((entity) => (entity.type === 'character' || entity.type === 'person') && entity.basis === 'observed')
		.map((entity) => entity.name);
	const actions = raw.actions.map((action) => ({ type: raw.nature === 'dialogue' || raw.nature === 'speech' ? 'dialogue' as const : 'observation' as const, description: action.description }));
	const evidence = [
		{ kind: 'visual_observation' as const, content: raw.description, confidence: raw.confidence, sourcePanelId: panel.panelId },
		...raw.entities.filter((entity) => entity.basis === 'observed').map((entity) => ({ kind: 'visual_observation' as const, content: `${entity.name}: ${entity.evidence}`, confidence: entity.confidence, sourcePanelId: panel.panelId })),
	];
	return panelAnalysisSchema.parse({
		panelId: panel.panelId,
		visualDescription: raw.description,
		characters,
		dialogues,
		actions: actions.length > 0 ? actions : [{ type: 'none', description: raw.nature === 'unknown' ? 'Função narrativa desconhecida; preservar para revisão.' : 'Nenhuma ação determinística registrada.' }],
		emotions: ['unknown'],
		relevantObjects: raw.entities.filter((entity) => entity.type === 'object' && entity.basis === 'observed').map((entity) => entity.name),
		setting: raw.environment?.basis === 'observed' ? raw.environment.description : undefined,
		uncertainties: [...raw.limitations, 'Resultado migrado de observação histórica; fidelidade independente ainda não verificada.'],
		evidence,
		analysisConfidence: raw.confidence,
		motionMetadata: { actions: raw.actions.map((action) => action.description), impacts: [], movements: [], soundEffects: [], expressions: [], transitions: [], intensity: null },
		analyzedBy: `historical:${reportedModel ?? 'unknown'}`,
		analyzedAtIso: new Date().toISOString(),
	});
}

function compatibleMetadata(record: HistoricalCheckpointRecord, expected: HistoricalCheckpointIdentity | undefined): boolean {
	if (!expected || !record.identity) return false;
	return Object.entries(expected).every(([key, value]) => value === undefined || record.identity?.[key as keyof HistoricalCheckpointIdentity] === value);
}

function panelLocationKey(panel: { sha256?: string; pageNumber?: number; panelIndex?: number; boundingBox?: { x?: number; y?: number; w?: number; h?: number } }): string {
	const box = panel.boundingBox;
	return [panel.sha256 ?? '', panel.pageNumber ?? '', panel.panelIndex ?? '', box?.x ?? '', box?.y ?? '', box?.w ?? '', box?.h ?? ''].join(':');
}

function inspectFile(filePath: string, panel: ExtractedPanel, expected: HistoricalCheckpointIdentity | undefined, remappedPanelId = false): HistoricalCheckpointResolution {
	try {
		const record = JSON.parse(readFileSync(filePath, 'utf8')) as HistoricalCheckpointRecord;
		const metadata = record.panel;
		if (!metadata || (!remappedPanelId && metadata.panelId !== panel.panelId)) return { panelId: panel.panelId, status: 'incompatible', filePath, reason: 'panelId não corresponde ao painel atual.', panelSha256: metadata?.sha256 ?? null, analysis: null, source: 'historical' };
		if (metadata.sha256 !== panel.imageHash) return { panelId: panel.panelId, status: 'incompatible', filePath, reason: 'SHA-256 da imagem não corresponde.', panelSha256: metadata.sha256 ?? null, analysis: null, source: 'historical' };
		if (remappedPanelId && panelLocationKey(metadata) !== panelLocationKey({ sha256: panel.imageHash, pageNumber: panel.metadata.pageNumber, panelIndex: panel.metadata.panelIndex, boundingBox: panel.metadata.boundingBox })) return { panelId: panel.panelId, status: 'incompatible', filePath, reason: 'SHA-256 coincide, mas página/posição/coordenadas não correspondem.', panelSha256: metadata.sha256 ?? null, analysis: null, source: 'historical' };
		const parsed = segmentAnalysisSchema.safeParse(record.analysis);
		if (!parsed.success) return { panelId: panel.panelId, status: 'corrupted', filePath, reason: 'analysis não satisfaz o schema SegmentAnalysis.', panelSha256: metadata.sha256, analysis: null, source: 'historical' };
		const analysis = mapSegmentAnalysis(parsed.data, panel, record.reportedModel ?? record.identity?.model ?? null);
		const exact = compatibleMetadata(record, expected);
		return { panelId: panel.panelId, status: exact && !remappedPanelId ? 'compatible' : 'migratable', filePath, reason: exact && !remappedPanelId ? 'identidade do checkpoint corresponde à política esperada.' : 'conteúdo válido; ID histórico remapeado por SHA-256 e posição determinística.', panelSha256: metadata.sha256, analysis, source: 'historical' };
	} catch (error) {
		return { panelId: panel.panelId, status: 'corrupted', filePath, reason: error instanceof Error ? error.message.slice(0, 200) : 'JSON inválido.', panelSha256: null, analysis: null, source: 'historical' };
	}
}

export function resolveHistoricalRecapCheckpoints(input: {
	rootDirectory: string;
	panels: readonly ExtractedPanel[];
	identity?: HistoricalCheckpointIdentity;
}): HistoricalCheckpointResolutionReport {
	const files = existsSync(input.rootDirectory)
		? readdirSync(input.rootDirectory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => join(input.rootDirectory, entry.name))
		: [];
	const byPanelId = new Map<string, string>();
	const byLocation = new Map<string, string>();
	for (const file of files) {
		try {
			const raw = JSON.parse(readFileSync(file, 'utf8')) as HistoricalCheckpointRecord;
			if (raw.panel?.panelId && !byPanelId.has(raw.panel.panelId)) byPanelId.set(raw.panel.panelId, file);
			if (raw.panel?.sha256 && !byLocation.has(panelLocationKey(raw.panel))) byLocation.set(panelLocationKey(raw.panel), file);
		} catch { /* classified as corrupted only when a matching panel file is found */ }
	}
	const results = input.panels.map((panel) => {
		const file = byPanelId.get(panel.panelId);
		if (file) return inspectFile(file, panel, input.identity);
		const remappedFile = panel.metadata
			? byLocation.get(panelLocationKey({ sha256: panel.imageHash, pageNumber: panel.metadata.pageNumber, panelIndex: panel.metadata.panelIndex, boundingBox: panel.metadata.boundingBox }))
			: undefined;
		return remappedFile ? inspectFile(remappedFile, panel, input.identity, true) : { panelId: panel.panelId, status: 'missing' as const, filePath: null, reason: 'Nenhum checkpoint histórico para este painel.', panelSha256: null, analysis: null, source: 'none' as const };
	});
	const counts = { compatible: 0, migratable: 0, incompatible: 0, corrupted: 0, missing: 0 } satisfies Record<HistoricalCheckpointStatus, number>;
	for (const result of results) counts[result.status] += 1;
	return { rootDirectory: input.rootDirectory, checkedAtIso: new Date().toISOString(), results, counts };
}

export function historicalAnalysesForProductiveCache(report: HistoricalCheckpointResolutionReport): {
	analyses: PanelAnalysis[];
	imageHashes: Record<string, string>;
	} {
	const analyses: PanelAnalysis[] = [];
	const imageHashes: Record<string, string> = {};
	for (const result of report.results) {
		if ((result.status === 'compatible' || result.status === 'migratable') && result.analysis && result.panelSha256) {
			analyses.push(result.analysis);
			imageHashes[result.panelId] = result.panelSha256;
		}
	}
	return { analyses, imageHashes };
}

