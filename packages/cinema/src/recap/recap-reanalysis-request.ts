import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { loadCheckpoint, saveCheckpoint } from './checkpoint-persistence.js';
import type { PanelAnalysis } from './recap-types.js';

/**
 * Explicit, per-panel re-analysis request for a chapter checkpoint.
 *
 * Only the listed panels lose their cached analysis, and only when that analysis is older than
 * `requestedAtIso`. Applying the request again after the panels were re-analysed is a no-op, so a
 * resumed or repeated run never loops into fresh inference for the same panels.
 */
export const RECAP_REANALYSIS_REQUEST_FILENAME = 'reanalysis-request.json';

export const recapReanalysisRequestSchema = z.object({
	schemaVersion: z.literal(1),
	chapterId: z.string().min(1),
	requestedAtIso: z.string().datetime(),
	reason: z.string().min(1),
	panelIds: z.array(z.string().min(1)).min(1).refine((ids) => new Set(ids).size === ids.length, 'panelIds repetidos.'),
});
export type RecapReanalysisRequest = z.infer<typeof recapReanalysisRequestSchema>;

export function loadRecapReanalysisRequest(checkpointDir: string): RecapReanalysisRequest | null {
	const path = join(checkpointDir, RECAP_REANALYSIS_REQUEST_FILENAME);
	if (!existsSync(path)) return null;
	return recapReanalysisRequestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

function isStale(analysis: unknown, panelIds: ReadonlySet<string>, requestedAtMs: number): boolean {
	if (!analysis || typeof analysis !== 'object') return false;
	const item = analysis as Partial<PanelAnalysis>;
	if (!item.panelId || !panelIds.has(item.panelId)) return false;
	const analyzedAtMs = Date.parse(item.analyzedAtIso ?? '');
	return !Number.isFinite(analyzedAtMs) || analyzedAtMs < requestedAtMs;
}

export interface RecapReanalysisApplyResult {
	/** Panels whose cached analysis was removed now (will be analysed again). */
	invalidatedPanelIds: string[];
	/** Requested panels already re-analysed after the request (kept). */
	alreadyReanalysedPanelIds: string[];
	/** Cache entries removed from analysisCacheByHash. */
	removedCacheEntries: number;
}

/** Removes stale cached analyses of the requested panels from the checkpoint. */
export function applyRecapReanalysisRequest(checkpointDir: string, request: RecapReanalysisRequest): RecapReanalysisApplyResult {
	const checkpoint = loadCheckpoint(checkpointDir);
	if (!checkpoint) return { invalidatedPanelIds: [], alreadyReanalysedPanelIds: [], removedCacheEntries: 0 };
	if (checkpoint.chapterId !== request.chapterId) {
		throw new Error(`RECAP_REANALYSIS_CHAPTER_MISMATCH: pedido para ${request.chapterId}, checkpoint de ${checkpoint.chapterId}`);
	}
	const requested = new Set(request.panelIds);
	const known = new Set<string>([
		...((checkpoint.extractedPanels ?? []) as Array<{ panelId?: string }>).map((panel) => panel.panelId ?? ''),
		...((checkpoint.panelAnalyses ?? []) as Array<{ panelId?: string }>).map((analysis) => analysis.panelId ?? ''),
	]);
	const unknown = request.panelIds.filter((id) => !known.has(id));
	if (known.size > 0 && unknown.length > 0) {
		throw new Error(`RECAP_REANALYSIS_UNKNOWN_PANEL: ${unknown.length} painel(is) fora do checkpoint (ex.: ${unknown.slice(0, 3).join(', ')}). Use o panelId completo.`);
	}
	const requestedAtMs = Date.parse(request.requestedAtIso);
	const analyses = (checkpoint.panelAnalyses ?? []) as unknown[];
	const invalidated = new Set<string>();
	const kept = analyses.filter((analysis) => {
		if (!isStale(analysis, requested, requestedAtMs)) return true;
		invalidated.add((analysis as PanelAnalysis).panelId);
		return false;
	});
	let removedCacheEntries = 0;
	const cache: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(checkpoint.analysisCacheByHash ?? {})) {
		if (isStale(value, requested, requestedAtMs)) {
			removedCacheEntries += 1;
			invalidated.add((value as PanelAnalysis).panelId);
		} else {
			cache[key] = value;
		}
	}
	const hashes = { ...(checkpoint.panelAnalysisImageHashes ?? {}) };
	for (const panelId of invalidated) delete hashes[panelId];
	const fresh = analyses
		.filter((analysis): analysis is PanelAnalysis => Boolean(analysis) && requested.has((analysis as PanelAnalysis).panelId) && !isStale(analysis, requested, requestedAtMs))
		.map((analysis) => analysis.panelId);
	if (invalidated.size > 0) {
		saveCheckpoint(checkpointDir, {
			...checkpoint,
			panelAnalyses: kept,
			analysisCacheByHash: cache,
			panelAnalysisImageHashes: hashes,
			lastUpdatedAtIso: new Date().toISOString(),
		});
	}
	return { invalidatedPanelIds: [...invalidated].sort(), alreadyReanalysedPanelIds: [...new Set(fresh)].sort(), removedCacheEntries };
}

/** Historical (read-only) analyses must not refill a panel that was explicitly sent back to analysis. */
export function excludeReanalysisPanels<T extends { panelId: string }>(analyses: readonly T[], request: RecapReanalysisRequest | null): T[] {
	if (!request) return [...analyses];
	const requested = new Set(request.panelIds);
	return analyses.filter((analysis) => !requested.has(analysis.panelId));
}
