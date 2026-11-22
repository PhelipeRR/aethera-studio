/**
 * MotionVelix Outro Studio 3.0 — Complete Preset Store
 *
 * Persists reusable Outro presets combining template, logo reference/version,
 * palette, background image, texts, duration, intensity, parallax, music, SFX, and CTA.
 * Deleting a preset never modifies projects that previously applied it.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { outroStudioConfigV3Schema, type OutroStudioConfigV3 } from './outro-template-registry.js';

export const outroPresetSchema = z.object({
	presetId: z.string().min(1),
	channelId: z.string().min(1).default('default'),
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(240).optional(),
	config: outroStudioConfigV3Schema,
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type OutroPresetRecord = z.infer<typeof outroPresetSchema>;

interface PresetDb {
	schemaVersion: 1;
	presets: OutroPresetRecord[];
}

function writeJsonAtomic(filePath: string, data: unknown): void {
	const dir = resolve(filePath, '..');
	mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
	renameSync(tmp, filePath);
}

export class OutroPresetStore {
	private readonly dbPath: string;

	constructor(workspaceDir: string) {
		this.dbPath = join(workspaceDir, 'outro-presets', 'presets-db.json');
	}

	private loadDb(): PresetDb {
		if (!existsSync(this.dbPath)) return { schemaVersion: 1, presets: [] };
		try {
			const parsed = JSON.parse(readFileSync(this.dbPath, 'utf-8')) as PresetDb;
			return { schemaVersion: 1, presets: Array.isArray(parsed.presets) ? parsed.presets : [] };
		} catch {
			return { schemaVersion: 1, presets: [] };
		}
	}

	private saveDb(db: PresetDb): void {
		writeJsonAtomic(this.dbPath, db);
	}

	listPresets(channelId?: string): OutroPresetRecord[] {
		const db = this.loadDb();
		if (!channelId) return db.presets;
		return db.presets.filter((p) => p.channelId === channelId || p.channelId === 'default');
	}

	getPreset(presetId: string): OutroPresetRecord | null {
		return this.loadDb().presets.find((p) => p.presetId === presetId) ?? null;
	}

	savePreset(input: {
		presetId?: string;
		channelId?: string;
		name: string;
		description?: string;
		config: OutroStudioConfigV3;
	}): OutroPresetRecord {
		const db = this.loadDb();
		const now = new Date().toISOString();
		const normalizedConfig = outroStudioConfigV3Schema.parse(input.config);
		if (input.presetId) {
			const existing = db.presets.find((p) => p.presetId === input.presetId);
			if (existing) {
				existing.name = input.name.trim() || existing.name;
				if (input.description !== undefined) existing.description = input.description;
				existing.config = normalizedConfig;
				existing.updatedAt = now;
				this.saveDb(db);
				return existing;
			}
		}
		const created: OutroPresetRecord = outroPresetSchema.parse({
			presetId: `preset_${randomUUID().slice(0, 10)}`,
			channelId: input.channelId || normalizedConfig.channelId || 'default',
			name: input.name.trim() || 'Meu Modelo',
			...(input.description ? { description: input.description } : {}),
			config: normalizedConfig,
			createdAt: now,
			updatedAt: now,
		});
		db.presets.push(created);
		this.saveDb(db);
		return created;
	}

	duplicatePreset(presetId: string, newName?: string): OutroPresetRecord {
		const src = this.getPreset(presetId);
		if (!src) throw new Error(`Preset não encontrado: ${presetId}`);
		return this.savePreset({
			channelId: src.channelId,
			name: newName?.trim() || `${src.name} (Cópia)`,
			...(src.description ? { description: src.description } : {}),
			config: { ...src.config },
		});
	}

	renamePreset(presetId: string, newName: string): OutroPresetRecord {
		const db = this.loadDb();
		const found = db.presets.find((p) => p.presetId === presetId);
		if (!found) throw new Error(`Preset não encontrado: ${presetId}`);
		found.name = newName.trim() || found.name;
		found.updatedAt = new Date().toISOString();
		this.saveDb(db);
		return found;
	}

	deletePreset(presetId: string): boolean {
		const db = this.loadDb();
		const idx = db.presets.findIndex((p) => p.presetId === presetId);
		if (idx < 0) return false;
		db.presets.splice(idx, 1);
		this.saveDb(db);
		return true;
	}
}
