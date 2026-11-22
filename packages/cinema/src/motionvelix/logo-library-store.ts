/**
 * MotionVelix Outro Studio 3.0 — Per-Channel Logo Library, Versioning & Deterministic Favorite Rotation
 *
 * - Supports PNG, WebP, and sanitized SVG (magic-byte & security checked).
 * - Never embeds or hardcodes any brand logo path.
 * - Generates optimized preview PNGs without replacing originals.
 * - Keeps previous asset versions intact on replace so old projects remain immutable.
 * - Soft-deletes referenced logos instead of deleting physical files in use.
 * - Implements `manual`, `default`, and deterministic `rotate_favorites` without consecutive repeats.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { LogoSelectionMode } from './outro-template-registry.js';

export const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/webp', 'image/svg+xml'] as const;
export type AllowedLogoMimeType = (typeof ALLOWED_LOGO_MIME_TYPES)[number];

export const MAX_LOGO_BYTES = 10 * 1024 * 1024; // 10 MB

export const logoAssetVersionSchema = z.object({
	assetVersion: z.number().int().positive(),
	contentHash: z.string().min(16),
	mimeType: z.enum(ALLOWED_LOGO_MIME_TYPES),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	originalPath: z.string().min(1),
	previewPath: z.string().min(1),
	fileSizeBytes: z.number().int().positive(),
	createdAt: z.string(),
});

export type LogoAssetVersion = z.infer<typeof logoAssetVersionSchema>;

export const channelLogoRecordSchema = z.object({
	logoId: z.string().min(1),
	channelId: z.string().min(1),
	name: z.string().trim().min(1).max(120),
	assetId: z.string().min(1),
	assetVersion: z.number().int().positive(),
	contentHash: z.string().min(16),
	mimeType: z.enum(ALLOWED_LOGO_MIME_TYPES),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	originalPath: z.string().min(1),
	previewPath: z.string().min(1),
	isDefault: z.boolean().default(false),
	isFavorite: z.boolean().default(false),
	deleted: z.boolean().default(false),
	referencedByProjectIds: z.array(z.string()).default([]),
	versions: z.array(logoAssetVersionSchema).default([]),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ChannelLogoRecord = z.infer<typeof channelLogoRecordSchema>;

interface RotationHistoryEntry {
	productionId: string;
	logoId: string;
	assetVersion: number;
	contentHash: string;
	selectedAt: string;
}

interface LogoLibraryDb {
	schemaVersion: 1;
	logos: ChannelLogoRecord[];
	rotationHistoryByChannel: Record<string, RotationHistoryEntry[]>;
}

// ─── Security: Magic Bytes & SVG Sanitization ────────────────────────────────

/**
 * Strips all executable scripts, event handlers, foreignObject, iframes, and remote URI references from SVG.
 */
export function sanitizeSvgContent(rawSvg: string): string {
	let svg = rawSvg.trim();
	// Remove XML doctypes/entity declarations (XXE prevention)
	svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
	svg = svg.replace(/<!ENTITY[\s\S]*?>/gi, '');
	// Remove dangerous elements completely
	svg = svg.replace(/<(script|foreignObject|iframe|object|embed|audio|video|link|meta)[^>]*>[\s\S]*?<\/\1>/gi, '');
	svg = svg.replace(/<(script|foreignObject|iframe|object|embed|link|meta)[^>]*\/?>/gi, '');
	// Remove inline event handlers (onload, onclick, onerror, etc.)
	svg = svg.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
	// Remove javascript: or remote http(s):// references in href/xlink:href/src/style
	svg = svg.replace(/\s+(?:xlink:)?href\s*=\s*("(?:\s*(?:javascript:|https?:|\/\/)[^"]*)"|'(?:\s*(?:javascript:|https?:|\/\/)[^']*)')/gi, '');
	svg = svg.replace(/url\(\s*['"]?\s*(?:https?:|\/\/|javascript:)[^)]*\)/gi, 'none');
	svg = svg.replace(/@import\s+[^;]+;/gi, '');
	return svg.trim();
}

export function detectLogoMimeFromMagicBytes(buf: Buffer): AllowedLogoMimeType | null {
	if (buf.length >= 8) {
		// PNG: 89 50 4E 47 0D 0A 1A 0A
		if (
			buf[0] === 0x89 &&
			buf[1] === 0x50 &&
			buf[2] === 0x4e &&
			buf[3] === 0x47 &&
			buf[4] === 0x0d &&
			buf[5] === 0x0a &&
			buf[6] === 0x1a &&
			buf[7] === 0x0a
		) {
			return 'image/png';
		}
	}
	if (buf.length >= 12) {
		// WebP: RIFF....WEBP
		if (
			buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
			buf.subarray(8, 12).toString('ascii') === 'WEBP'
		) {
			return 'image/webp';
		}
	}
	const headText = buf.subarray(0, Math.min(buf.length, 512)).toString('utf-8').trim();
	if (/^(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(headText)) {
		return 'image/svg+xml';
	}
	return null;
}

export interface ValidatedLogoPayload {
	mimeType: AllowedLogoMimeType;
	sanitizedBuffer: Buffer;
	contentHash: string;
	width: number;
	height: number;
	previewPngBuffer: Buffer;
}

/**
 * Validates magic bytes, size, security (SVG sanitization), dimensions, and generates
 * an optimized preview PNG preserving exact aspect ratio and alpha transparency.
 */
export async function validateAndPrepareLogoBuffer(rawBuffer: Buffer): Promise<ValidatedLogoPayload> {
	if (!rawBuffer || rawBuffer.length === 0) {
		throw new Error('Arquivo de logotipo vazio.');
	}
	if (rawBuffer.length > MAX_LOGO_BYTES) {
		throw new Error(`Logotipo excede o limite máximo de ${Math.round(MAX_LOGO_BYTES / (1024 * 1024))} MB.`);
	}
	const mimeType = detectLogoMimeFromMagicBytes(rawBuffer);
	if (!mimeType) {
		throw new Error('Formato de logotipo não suportado ou assinatura (magic bytes) inválida. Use PNG, WebP ou SVG.');
	}

	let sanitizedBuffer = rawBuffer;
	if (mimeType === 'image/svg+xml') {
		const cleaned = sanitizeSvgContent(rawBuffer.toString('utf-8'));
		if (!/<svg[\s>]/i.test(cleaned)) {
			throw new Error('SVG inválido após sanitização de segurança.');
		}
		sanitizedBuffer = Buffer.from(cleaned, 'utf-8');
	}

	const sharpMod = await import('sharp');
	const sharp = sharpMod.default;
	const meta = await sharp(sanitizedBuffer).metadata();
	const width = meta.width ?? 0;
	const height = meta.height ?? 0;
	if (width < 16 || height < 16) {
		throw new Error(`Dimensões do logotipo muito pequenas (${width}x${height}). Mínimo 16x16px.`);
	}
	if (width > 8192 || height > 8192) {
		throw new Error(`Dimensões do logotipo excedem 8192px (${width}x${height}).`);
	}

	const previewPngBuffer = await sharp(sanitizedBuffer)
		.resize(512, 512, { fit: 'inside', withoutEnlargement: true })
		.png({ compressionLevel: 9 })
		.toBuffer();

	const contentHash = createHash('sha256').update(sanitizedBuffer).digest('hex');

	return {
		mimeType,
		sanitizedBuffer,
		contentHash,
		width,
		height,
		previewPngBuffer,
	};
}

// ─── Persistent Store ────────────────────────────────────────────────────────

function writeJsonAtomic(filePath: string, data: unknown): void {
	const dir = resolve(filePath, '..');
	mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
	renameSync(tmp, filePath);
}

function extForMime(mime: AllowedLogoMimeType): string {
	if (mime === 'image/webp') return '.webp';
	if (mime === 'image/svg+xml') return '.svg';
	return '.png';
}

export class LogoLibraryStore {
	private readonly rootDir: string;
	private readonly assetsDir: string;
	private readonly previewsDir: string;
	private readonly dbPath: string;

	constructor(workspaceDir: string) {
		this.rootDir = join(workspaceDir, 'logo-library');
		this.assetsDir = join(this.rootDir, 'assets');
		this.previewsDir = join(this.rootDir, 'previews');
		this.dbPath = join(this.rootDir, 'logos-db.json');
		mkdirSync(this.assetsDir, { recursive: true });
		mkdirSync(this.previewsDir, { recursive: true });
	}

	private loadDb(): LogoLibraryDb {
		if (!existsSync(this.dbPath)) {
			return { schemaVersion: 1, logos: [], rotationHistoryByChannel: {} };
		}
		try {
			const parsed = JSON.parse(readFileSync(this.dbPath, 'utf-8')) as LogoLibraryDb;
			return {
				schemaVersion: 1,
				logos: Array.isArray(parsed.logos) ? parsed.logos : [],
				rotationHistoryByChannel: parsed.rotationHistoryByChannel ?? {},
			};
		} catch {
			return { schemaVersion: 1, logos: [], rotationHistoryByChannel: {} };
		}
	}

	private saveDb(db: LogoLibraryDb): void {
		writeJsonAtomic(this.dbPath, db);
	}

	listLogos(channelId?: string, includeDeleted = false): ChannelLogoRecord[] {
		const db = this.loadDb();
		return db.logos.filter((l) => {
			if (!includeDeleted && l.deleted) return false;
			if (channelId && l.channelId !== channelId) return false;
			return true;
		});
	}

	getLogo(logoId: string, requestedVersion?: number | null): {
		record: ChannelLogoRecord;
		version: LogoAssetVersion;
	} | null {
		const db = this.loadDb();
		const record = db.logos.find((l) => l.logoId === logoId);
		if (!record) return null;
		const version =
			(requestedVersion
				? record.versions.find((v) => v.assetVersion === requestedVersion)
				: undefined) ??
			record.versions.find((v) => v.assetVersion === record.assetVersion) ?? {
				assetVersion: record.assetVersion,
				contentHash: record.contentHash,
				mimeType: record.mimeType,
				width: record.width,
				height: record.height,
				originalPath: record.originalPath,
				previewPath: record.previewPath,
				fileSizeBytes: 0,
				createdAt: record.createdAt,
			};
		return { record, version };
	}

	async addLogo(input: {
		channelId: string;
		name: string;
		fileBuffer?: Buffer;
		sourceFilePath?: string;
		isDefault?: boolean;
		isFavorite?: boolean;
	}): Promise<ChannelLogoRecord> {
		const rawBuffer =
			input.fileBuffer ??
			(input.sourceFilePath && existsSync(input.sourceFilePath)
				? readFileSync(input.sourceFilePath)
				: null);
		if (!rawBuffer) {
			throw new Error('Forneça fileBuffer ou sourceFilePath válido para cadastrar o logotipo.');
		}
		const prepared = await validateAndPrepareLogoBuffer(rawBuffer);
		const db = this.loadDb();
		const now = new Date().toISOString();
		const logoId = `logo_${randomUUID().slice(0, 10)}`;
		const assetId = `asset_${randomUUID().slice(0, 10)}`;
		const ext = extForMime(prepared.mimeType);
		const originalPath = join(this.assetsDir, `${assetId}_v1_${prepared.contentHash.slice(0, 12)}${ext}`);
		const previewPath = join(this.previewsDir, `${assetId}_v1_${prepared.contentHash.slice(0, 12)}.png`);
		writeFileSync(originalPath, prepared.sanitizedBuffer);
		writeFileSync(previewPath, prepared.previewPngBuffer);

		const existingForChannel = db.logos.filter((l) => l.channelId === input.channelId && !l.deleted);
		const shouldBeDefault = input.isDefault ?? existingForChannel.length === 0;
		if (shouldBeDefault) {
			for (const l of db.logos) {
				if (l.channelId === input.channelId) l.isDefault = false;
			}
		}

		const v1: LogoAssetVersion = {
			assetVersion: 1,
			contentHash: prepared.contentHash,
			mimeType: prepared.mimeType,
			width: prepared.width,
			height: prepared.height,
			originalPath,
			previewPath,
			fileSizeBytes: prepared.sanitizedBuffer.length,
			createdAt: now,
		};

		const record: ChannelLogoRecord = channelLogoRecordSchema.parse({
			logoId,
			channelId: input.channelId,
			name: input.name.trim() || 'Logotipo',
			assetId,
			assetVersion: 1,
			contentHash: prepared.contentHash,
			mimeType: prepared.mimeType,
			width: prepared.width,
			height: prepared.height,
			originalPath,
			previewPath,
			isDefault: shouldBeDefault,
			isFavorite: Boolean(input.isFavorite),
			deleted: false,
			referencedByProjectIds: [],
			versions: [v1],
			createdAt: now,
			updatedAt: now,
		});

		db.logos.push(record);
		this.saveDb(db);
		return record;
	}

	/**
	 * Replaces the file of an existing logo by creating assetVersion + 1.
	 * Preserves all previous version files on disk so older projects remain intact.
	 */
	async replaceLogoFile(input: {
		logoId: string;
		fileBuffer?: Buffer;
		sourceFilePath?: string;
	}): Promise<ChannelLogoRecord> {
		const rawBuffer =
			input.fileBuffer ??
			(input.sourceFilePath && existsSync(input.sourceFilePath)
				? readFileSync(input.sourceFilePath)
				: null);
		if (!rawBuffer) {
			throw new Error('Arquivo inválido para substituição de logotipo.');
		}
		const prepared = await validateAndPrepareLogoBuffer(rawBuffer);
		const db = this.loadDb();
		const record = db.logos.find((l) => l.logoId === input.logoId && !l.deleted);
		if (!record) throw new Error(`Logotipo não encontrado: ${input.logoId}`);

		const nextVersion = record.assetVersion + 1;
		const now = new Date().toISOString();
		const ext = extForMime(prepared.mimeType);
		const originalPath = join(this.assetsDir, `${record.assetId}_v${nextVersion}_${prepared.contentHash.slice(0, 12)}${ext}`);
		const previewPath = join(this.previewsDir, `${record.assetId}_v${nextVersion}_${prepared.contentHash.slice(0, 12)}.png`);
		writeFileSync(originalPath, prepared.sanitizedBuffer);
		writeFileSync(previewPath, prepared.previewPngBuffer);

		const nextVerObj: LogoAssetVersion = {
			assetVersion: nextVersion,
			contentHash: prepared.contentHash,
			mimeType: prepared.mimeType,
			width: prepared.width,
			height: prepared.height,
			originalPath,
			previewPath,
			fileSizeBytes: prepared.sanitizedBuffer.length,
			createdAt: now,
		};

		record.assetVersion = nextVersion;
		record.contentHash = prepared.contentHash;
		record.mimeType = prepared.mimeType;
		record.width = prepared.width;
		record.height = prepared.height;
		record.originalPath = originalPath;
		record.previewPath = previewPath;
		record.versions.push(nextVerObj);
		record.updatedAt = now;

		this.saveDb(db);
		return record;
	}

	renameLogo(logoId: string, newName: string): ChannelLogoRecord {
		const db = this.loadDb();
		const record = db.logos.find((l) => l.logoId === logoId && !l.deleted);
		if (!record) throw new Error(`Logotipo não encontrado: ${logoId}`);
		record.name = newName.trim() || record.name;
		record.updatedAt = new Date().toISOString();
		this.saveDb(db);
		return record;
	}

	toggleFavorite(logoId: string, isFavorite?: boolean): ChannelLogoRecord {
		const db = this.loadDb();
		const record = db.logos.find((l) => l.logoId === logoId && !l.deleted);
		if (!record) throw new Error(`Logotipo não encontrado: ${logoId}`);
		record.isFavorite = isFavorite ?? !record.isFavorite;
		record.updatedAt = new Date().toISOString();
		this.saveDb(db);
		return record;
	}

	setDefaultLogo(logoId: string): ChannelLogoRecord {
		const db = this.loadDb();
		const record = db.logos.find((l) => l.logoId === logoId && !l.deleted);
		if (!record) throw new Error(`Logotipo não encontrado: ${logoId}`);
		for (const l of db.logos) {
			if (l.channelId === record.channelId) {
				l.isDefault = l.logoId === record.logoId;
			}
		}
		record.updatedAt = new Date().toISOString();
		this.saveDb(db);
		return record;
	}

	registerProjectReference(logoId: string, projectId: string): void {
		const db = this.loadDb();
		const record = db.logos.find((l) => l.logoId === logoId);
		if (!record) return;
		if (!record.referencedByProjectIds.includes(projectId)) {
			record.referencedByProjectIds.push(projectId);
			this.saveDb(db);
		}
	}

	/**
	 * Deletes a logo from the library.
	 * If referenced by any existing project, soft-deletes and preserves physical assets on disk.
	 */
	deleteLogo(logoId: string): { deleted: boolean; softDeleted: boolean } {
		const db = this.loadDb();
		const idx = db.logos.findIndex((l) => l.logoId === logoId);
		if (idx < 0) return { deleted: false, softDeleted: false };
		const record = db.logos[idx]!;
		const hasReferences = record.referencedByProjectIds.length > 0;
		if (hasReferences) {
			record.deleted = true;
			record.isDefault = false;
			record.isFavorite = false;
			record.updatedAt = new Date().toISOString();
			this.saveDb(db);
			return { deleted: true, softDeleted: true };
		}
		// Unreferenced: remove physical files and DB record
		for (const v of record.versions) {
			if (existsSync(v.originalPath)) rmSync(v.originalPath, { force: true });
			if (existsSync(v.previewPath)) rmSync(v.previewPath, { force: true });
		}
		db.logos.splice(idx, 1);
		this.saveDb(db);
		return { deleted: true, softDeleted: false };
	}

	/**
	 * Resolves which logo a video should use according to `mode`:
	 * - `manual`: returns explicitly selected logo (preserving pinned version if provided).
	 * - `default`: returns channel's default logo.
	 * - `rotate_favorites`: deterministically picks a favorite logo avoiding consecutive repetition
	 *   and persists the choice for `productionId` so re-opening/re-processing never changes it.
	 */
	resolveLogoForVideo(input: {
		channelId: string;
		productionId: string;
		mode: LogoSelectionMode;
		manualLogoId?: string | null;
		manualLogoVersion?: number | null;
		logoDisabled?: boolean;
	}): {
		logo: ChannelLogoRecord | null;
		version: LogoAssetVersion | null;
		reason: string;
	} {
		if (input.logoDisabled) {
			return { logo: null, version: null, reason: 'logo_disabled' };
		}
		const db = this.loadDb();

		if (input.mode === 'manual') {
			if (!input.manualLogoId) {
				return { logo: null, version: null, reason: 'manual_none_selected' };
			}
			const found = this.getLogo(input.manualLogoId, input.manualLogoVersion);
			if (!found) return { logo: null, version: null, reason: 'manual_not_found' };
			this.registerProjectReference(found.record.logoId, input.productionId);
			return { logo: found.record, version: found.version, reason: 'manual_selected' };
		}

		const activeChannelLogos = db.logos.filter((l) => l.channelId === input.channelId && !l.deleted);

		if (input.mode === 'default') {
			const def = activeChannelLogos.find((l) => l.isDefault) ?? activeChannelLogos[0] ?? null;
			if (!def) return { logo: null, version: null, reason: 'default_none_available' };
			const found = this.getLogo(def.logoId, def.assetVersion)!;
			this.registerProjectReference(found.record.logoId, input.productionId);
			return { logo: found.record, version: found.version, reason: 'channel_default' };
		}

		// mode === 'rotate_favorites'
		const history = db.rotationHistoryByChannel[input.channelId] ?? [];
		// 1. If this productionId was ALREADY assigned a logo earlier, return the exact persisted choice!
		const priorForProduction = history.find((h) => h.productionId === input.productionId);
		if (priorForProduction) {
			const pinned = this.getLogo(priorForProduction.logoId, priorForProduction.assetVersion);
			if (pinned) {
				return { logo: pinned.record, version: pinned.version, reason: 'rotation_persisted_for_production' };
			}
		}

		const favorites = activeChannelLogos.filter((l) => l.isFavorite && existsSync(l.originalPath));
		if (favorites.length === 0) {
			const def = activeChannelLogos.find((l) => l.isDefault) ?? null;
			if (!def) return { logo: null, version: null, reason: 'rotation_no_favorites_or_default' };
			const found = this.getLogo(def.logoId, def.assetVersion)!;
			this.registerProjectReference(found.record.logoId, input.productionId);
			return { logo: found.record, version: found.version, reason: 'rotation_fallback_default' };
		}

		let candidates = favorites;
		const lastEntry = history.length > 0 ? history[history.length - 1] : null;
		if (favorites.length > 1 && lastEntry) {
			const nonRepeating = favorites.filter((f) => f.logoId !== lastEntry.logoId);
			if (nonRepeating.length > 0) candidates = nonRepeating;
		}

		// Deterministic index derived from SHA-256(channelId + productionId)
		const digest = createHash('sha256')
			.update(`${input.channelId}::${input.productionId}`)
			.digest();
		const pickIndex = digest.readUInt32BE(0) % candidates.length;
		const chosen = candidates[pickIndex]!;
		const chosenVersion = this.getLogo(chosen.logoId, chosen.assetVersion)!.version;

		// Persist rotation choice so reopening/reprocessing stays identical
		db.rotationHistoryByChannel[input.channelId] = [
			...history,
			{
				productionId: input.productionId,
				logoId: chosen.logoId,
				assetVersion: chosenVersion.assetVersion,
				contentHash: chosenVersion.contentHash,
				selectedAt: new Date().toISOString(),
			},
		];
		if (!chosen.referencedByProjectIds.includes(input.productionId)) {
			chosen.referencedByProjectIds.push(input.productionId);
		}
		this.saveDb(db);

		return { logo: chosen, version: chosenVersion, reason: 'rotation_favorites_selected' };
	}
}
