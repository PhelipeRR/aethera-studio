import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PanelAnalysis, RecapCheckpoint } from './recap-types.js';
import { panelAnalysisSchema, recapCheckpointSchema } from './recap-types.js';

const CHECKPOINT_FILENAME = 'recap-checkpoint.json';
export const RECAP_ANALYZER_VERSION = '2.3.0';
export const RECAP_SCRIPT_GENERATOR_VERSION = '3.0.0';

/**
 * Builds a deterministic cache key binding imageHash, model, and analyzer version.
 */
export function computePanelCacheKey(input: {
	imageHash: string;
	model?: string;
	analyzerVersion?: string;
	cropCoordinates?: string;
	promptVersion?: string;
	preprocessingVersion?: string;
	schemaVersion?: string;
	locale?: string;
	contextFingerprint?: string;
}): string {
	const model = (input.model ?? 'default').trim() || 'default';
	const version = (input.analyzerVersion ?? RECAP_ANALYZER_VERSION).trim() || RECAP_ANALYZER_VERSION;
	if (
		input.cropCoordinates === undefined &&
		input.promptVersion === undefined &&
		input.preprocessingVersion === undefined &&
		input.schemaVersion === undefined &&
		input.locale === undefined &&
		input.contextFingerprint === undefined
	) {
		return `${input.imageHash}::${model}::${version}`;
	}
	const crop = (input.cropCoordinates ?? 'full').trim() || 'full';
	const prompt = (input.promptVersion ?? 'recap-v1').trim() || 'recap-v1';
	const preprocessing = (input.preprocessingVersion ?? 'recap-preprocess-v1').trim() || 'recap-preprocess-v1';
	const schema = (input.schemaVersion ?? 'recap-vision-v1').trim() || 'recap-vision-v1';
	const locale = (input.locale ?? 'pt-BR').trim() || 'pt-BR';
	const context = (input.contextFingerprint ?? 'context-none').trim() || 'context-none';
	return [input.imageHash, crop, prompt, model, preprocessing, schema, locale, context, version].join('::');
}

/** Stable hash for the parts of visual context that can change a panel interpretation. */
export function computeVisionContextFingerprint(context: unknown): string {
	const canonical = JSON.stringify(context ?? null);
	return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Builds a deterministic cache key for script generation binding chapter, style,
 * script generator version, and panel analyses signature.
 */
export function computeScriptCacheKey(input: {
	chapterId: string;
	scriptStyle: string;
	scriptGeneratorVersion?: string;
	analysesSignature?: string;
}): string {
	const version = (input.scriptGeneratorVersion ?? RECAP_SCRIPT_GENERATOR_VERSION).trim() || RECAP_SCRIPT_GENERATOR_VERSION;
	const sig = (input.analysesSignature ?? 'default').trim() || 'default';
	return `${input.chapterId}::${input.scriptStyle}::${version}::${sig}`;
}

/**
 * Strips any failed or zero-confidence analyses so failures are never stored
 * as successful cached results.
 */
function sanitizeCheckpointAnalyses(checkpoint: RecapCheckpoint): RecapCheckpoint {
	const clean: RecapCheckpoint = { ...checkpoint };

	if (Array.isArray(checkpoint.panelAnalyses)) {
		const valid: PanelAnalysis[] = [];
		for (const item of checkpoint.panelAnalyses) {
			const parsed = panelAnalysisSchema.safeParse(item);
			if (parsed.success && parsed.data.analysisConfidence > 0) {
				valid.push(parsed.data);
			}
		}
		clean.panelAnalyses = valid;
	}

	if (checkpoint.analysisCacheByHash && typeof checkpoint.analysisCacheByHash === 'object') {
		const validCache: Record<string, PanelAnalysis> = {};
		for (const [key, item] of Object.entries(checkpoint.analysisCacheByHash)) {
			const parsed = panelAnalysisSchema.safeParse(item);
			if (parsed.success && parsed.data.analysisConfidence > 0) {
				validCache[key] = parsed.data;
			}
		}
		clean.analysisCacheByHash = validCache;
	}

	if (checkpoint.panelAnalysisImageHashes && typeof checkpoint.panelAnalysisImageHashes === 'object') {
		clean.panelAnalysisImageHashes = Object.fromEntries(
			Object.entries(checkpoint.panelAnalysisImageHashes).filter(([, value]) => typeof value === 'string' && value.length > 0),
		);
	}

	return clean;
}

/**
 * Saves a checkpoint atomically to disk (write temp file → rename).
 * Creates the parent directory if it doesn't exist and never persists failed analyses.
 */
export function saveCheckpoint(checkpointDir: string, checkpoint: RecapCheckpoint): void {
	if (!existsSync(checkpointDir)) {
		mkdirSync(checkpointDir, { recursive: true });
	}
	const sanitized = sanitizeCheckpointAnalyses(checkpoint);
	const validated = recapCheckpointSchema.parse(sanitized);
	const filePath = join(checkpointDir, CHECKPOINT_FILENAME);
	const tmpPath = join(checkpointDir, `${CHECKPOINT_FILENAME}.tmp.${process.pid}.${Date.now()}`);
	writeFileSync(tmpPath, JSON.stringify(validated, null, 2), 'utf-8');
	renameSync(tmpPath, filePath);
}

/**
 * Loads a checkpoint from disk. Returns null if no checkpoint exists or validation fails.
 * Never throws — callers should treat missing/invalid checkpoints as "start fresh".
 */
export function loadCheckpoint(checkpointDir: string): RecapCheckpoint | null {
	const filePath = join(checkpointDir, CHECKPOINT_FILENAME);
	if (!existsSync(filePath)) return null;
	try {
		const raw = readFileSync(filePath, 'utf-8');
		const parsed = recapCheckpointSchema.parse(JSON.parse(raw));
		return sanitizeCheckpointAnalyses(parsed);
	} catch {
		return null;
	}
}

/**
 * Safely invalidates cached analyses in a checkpoint (e.g. when model/analyzer changes)
 * while preserving extracted panels and chapter metadata.
 */
export function invalidateCheckpointCache(checkpointDir: string): boolean {
	const existing = loadCheckpoint(checkpointDir);
	if (!existing) return false;
	saveCheckpoint(checkpointDir, {
		...existing,
		panelAnalyses: [],
		analysisCacheByHash: {},
		panelAnalysisImageHashes: {},
		lastUpdatedAtIso: new Date().toISOString(),
	});
	return true;
}

/**
 * Removes the checkpoint file entirely (for explicit full reset).
 */
export function clearCheckpoint(checkpointDir: string): void {
	const filePath = join(checkpointDir, CHECKPOINT_FILENAME);
	if (existsSync(filePath)) {
		rmSync(filePath, { force: true });
	}
}
