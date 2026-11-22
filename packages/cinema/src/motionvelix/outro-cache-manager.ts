/**
 * MotionVelix Outro Studio 3.0 — Three-Level Intelligent Cache Manager
 *
 * Level A (assets): content hashes and versioned references for images, logos, fonts, SFX.
 * Level B (thumbnails): keyed by template + version + palette + aspectRatio + visualConfig + optional logoHash.
 * Level C (renders): keyed by template + version + normalizedConfig + logoHash/version + assetHashes
 *                    + resolution + fps + duration + audioConfig + rendererVersion.
 *
 * Guarantees:
 * - Atomic writes (.tmp -> rename).
 * - Integrity validation (file existence, non-zero size, content hash).
 * - LRU eviction by storage limit (`maxBytes`).
 * - Changing colors, text, logo, or template invalidates ONLY Outro-dependent artifacts, never the main video.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { OutroStudioConfigV3 } from './outro-template-registry.js';

export const OUTRO_RENDERER_VERSION = '3.3.0';

export type OutroCacheLevel = 'assets' | 'thumbnails' | 'renders';

export interface OutroCacheEntry {
	key: string;
	level: OutroCacheLevel;
	filePath: string;
	fileSizeBytes: number;
	fileSha256: string;
	templateId?: string;
	logoId?: string | null;
	logoVersion?: number | null;
	createdAtMs: number;
	lastAccessedAtMs: number;
}

interface CacheIndexDb {
	schemaVersion: 1;
	entries: Record<string, OutroCacheEntry>;
}

function stableStringify(obj: unknown): string {
	if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
	if (Array.isArray(obj)) return `[${obj.map((v) => stableStringify(v)).join(',')}]`;
	const keys = Object.keys(obj as Record<string, unknown>).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function sha256File(filePath: string): string | null {
	if (!filePath || !existsSync(filePath)) return null;
	try {
		return createHash('sha256').update(readFileSync(filePath)).digest('hex');
	} catch {
		return null;
	}
}

export function computeThumbnailCacheKey(input: {
	templateId: string;
	templateVersion: string;
	palette: OutroStudioConfigV3['palette'];
	aspectRatio: '16:9' | '9:16';
	intensity: number;
	logoHash?: string | null;
}): string {
	const payload = stableStringify({
		level: 'thumbnail',
		templateId: input.templateId,
		templateVersion: input.templateVersion,
		palette: input.palette,
		aspectRatio: input.aspectRatio,
		intensity: Math.round(input.intensity),
		...(input.logoHash ? { logoHash: input.logoHash } : {}),
	});
	return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

/**
 * Computes a deterministic render cache key containing ONLY render-relevant parameters
 * (excludes irrelevant metadata like lastRenderedAtIso, presetId, saveAsChannelDefault, etc.).
 */
export function computeRenderCacheKey(input: {
	config: OutroStudioConfigV3;
	logoHash: string | null;
	logoVersion: number | null;
	backgroundHash: string | null;
	musicHash: string | null;
	width: number;
	height: number;
	fps: number;
	rendererVersion?: string;
}): string {
	const { config } = input;
	const payload = stableStringify({
		level: 'render',
		rendererVersion: input.rendererVersion ?? OUTRO_RENDERER_VERSION,
		templateId: config.templateId,
		templateVersion: config.templateVersion,
		aspectRatio: config.aspectRatio,
		width: input.width,
		height: input.height,
		fps: input.fps,
		durationMs: config.durationMs,
		paletteSource: config.paletteSource,
		palette: config.palette,
		intensity: config.intensity,
		parallaxEnabled: config.parallaxEnabled,
		showSubscribeCta: config.showSubscribeCta,
		showNextVideoCard: config.showNextVideoCard,
		texts: config.texts,
		logoDisabled: config.logoDisabled,
		logoHash: config.logoDisabled ? null : input.logoHash,
		logoVersion: config.logoDisabled ? null : input.logoVersion,
		logoTransform: config.logoDisabled ? null : config.logoTransform,
		backgroundHash: input.backgroundHash,
		audio: {
			enabled: config.audio.enabled,
			musicHash: input.musicHash,
			musicVolume: config.audio.musicVolume,
			introSfxVolume: config.audio.introSfxVolume,
			whooshVolume: config.audio.whooshVolume,
			impactVolume: config.audio.impactVolume,
			subscribeSfxVolume: config.audio.subscribeSfxVolume,
			fadeInSec: config.audio.fadeInSec,
			fadeOutSec: config.audio.fadeOutSec,
		},
	});
	return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export class OutroCacheManager {
	private readonly rootDir: string;
	private readonly indexPath: string;
	private readonly maxBytes: number;

	constructor(workspaceDir: string, options?: { maxBytes?: number }) {
		this.rootDir = join(workspaceDir, 'outro-cache');
		this.indexPath = join(this.rootDir, 'cache-index.json');
		this.maxBytes = options?.maxBytes ?? 512 * 1024 * 1024; // 512 MB default LRU cap
		mkdirSync(join(this.rootDir, 'assets'), { recursive: true });
		mkdirSync(join(this.rootDir, 'thumbnails'), { recursive: true });
		mkdirSync(join(this.rootDir, 'renders'), { recursive: true });
	}

	private loadIndex(): CacheIndexDb {
		if (!existsSync(this.indexPath)) return { schemaVersion: 1, entries: {} };
		try {
			const parsed = JSON.parse(readFileSync(this.indexPath, 'utf-8')) as CacheIndexDb;
			return { schemaVersion: 1, entries: parsed.entries ?? {} };
		} catch {
			return { schemaVersion: 1, entries: {} };
		}
	}

	private saveIndex(db: CacheIndexDb): void {
		const tmp = `${this.indexPath}.tmp.${process.pid}.${Date.now()}`;
		writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
		renameSync(tmp, this.indexPath);
	}

	getTargetPath(level: OutroCacheLevel, key: string, extension: string): string {
		const ext = extension.startsWith('.') ? extension : `.${extension}`;
		return join(this.rootDir, level, `${key}${ext}`);
	}

	/**
	 * Looks up a cached artifact and validates integrity (existence, non-zero size, SHA-256).
	 */
	getValid(level: OutroCacheLevel, key: string): OutroCacheEntry | null {
		const db = this.loadIndex();
		const fullKey = `${level}:${key}`;
		const entry = db.entries[fullKey];
		if (!entry) return null;
		if (!existsSync(entry.filePath)) {
			delete db.entries[fullKey];
			this.saveIndex(db);
			return null;
		}
		const size = statSync(entry.filePath).size;
		if (size <= 0 || size !== entry.fileSizeBytes) {
			delete db.entries[fullKey];
			this.saveIndex(db);
			return null;
		}
		const actualHash = sha256File(entry.filePath);
		if (!actualHash || actualHash !== entry.fileSha256) {
			delete db.entries[fullKey];
			this.saveIndex(db);
			return null;
		}
		entry.lastAccessedAtMs = Date.now();
		this.saveIndex(db);
		return entry;
	}

	/**
	 * Atomically stores a file into the cache and enforces LRU storage limits.
	 */
	putFile(input: {
		level: OutroCacheLevel;
		key: string;
		sourceFilePath: string;
		extension: string;
		templateId?: string;
		logoId?: string | null;
		logoVersion?: number | null;
	}): OutroCacheEntry {
		const targetPath = this.getTargetPath(input.level, input.key, input.extension);
		const dir = resolve(targetPath, '..');
		mkdirSync(dir, { recursive: true });
		if (resolve(input.sourceFilePath) !== resolve(targetPath)) {
			const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
			writeFileSync(tmp, readFileSync(input.sourceFilePath));
			renameSync(tmp, targetPath);
		}
		const fileSizeBytes = statSync(targetPath).size;
		const fileSha256 = sha256File(targetPath) ?? '';
		const now = Date.now();
		const entry: OutroCacheEntry = {
			key: input.key,
			level: input.level,
			filePath: targetPath,
			fileSizeBytes,
			fileSha256,
			...(input.templateId ? { templateId: input.templateId } : {}),
			...(input.logoId !== undefined ? { logoId: input.logoId } : {}),
			...(input.logoVersion !== undefined ? { logoVersion: input.logoVersion } : {}),
			createdAtMs: now,
			lastAccessedAtMs: now,
		};
		const db = this.loadIndex();
		db.entries[`${input.level}:${input.key}`] = entry;
		this.evictLruIfNeeded(db);
		this.saveIndex(db);
		return entry;
	}

	/**
	 * Invalidates ONLY Outro-dependent cached entries matching the filter (never touches main video).
	 */
	invalidateOutroEntries(filter?: {
		level?: OutroCacheLevel;
		templateId?: string;
		logoId?: string;
	}): number {
		const db = this.loadIndex();
		let removed = 0;
		for (const [fullKey, entry] of Object.entries(db.entries)) {
			if (filter?.level && entry.level !== filter.level) continue;
			if (filter?.templateId && entry.templateId !== filter.templateId) continue;
			if (filter?.logoId && entry.logoId !== filter.logoId) continue;
			if (existsSync(entry.filePath)) rmSync(entry.filePath, { force: true });
			delete db.entries[fullKey];
			removed++;
		}
		if (removed > 0) this.saveIndex(db);
		return removed;
	}

	getStats(): {
		totalEntries: number;
		totalBytes: number;
		byLevel: Record<OutroCacheLevel, { entries: number; bytes: number }>;
	} {
		const db = this.loadIndex();
		const byLevel: Record<OutroCacheLevel, { entries: number; bytes: number }> = {
			assets: { entries: 0, bytes: 0 },
			thumbnails: { entries: 0, bytes: 0 },
			renders: { entries: 0, bytes: 0 },
		};
		let totalEntries = 0;
		let totalBytes = 0;
		for (const entry of Object.values(db.entries)) {
			totalEntries++;
			totalBytes += entry.fileSizeBytes;
			byLevel[entry.level].entries++;
			byLevel[entry.level].bytes += entry.fileSizeBytes;
		}
		return { totalEntries, totalBytes, byLevel };
	}

	private evictLruIfNeeded(db: CacheIndexDb): void {
		const all = Object.entries(db.entries);
		let totalBytes = all.reduce((sum, [, e]) => sum + e.fileSizeBytes, 0);
		if (totalBytes <= this.maxBytes) return;
		// Sort oldest-accessed first
		all.sort((a, b) => a[1].lastAccessedAtMs - b[1].lastAccessedAtMs);
		for (const [fullKey, entry] of all) {
			if (totalBytes <= this.maxBytes) break;
			if (existsSync(entry.filePath)) rmSync(entry.filePath, { force: true });
			totalBytes -= entry.fileSizeBytes;
			delete db.entries[fullKey];
		}
	}
}
