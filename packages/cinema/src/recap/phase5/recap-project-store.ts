/**
 * Aethera Recap — Persistent Project Store (List, Load & Safe Delete)
 *
 * Solves the root causes of missing recent/current projects:
 * 1. Stores each production run in its own isolated folder:
 *    `<workspaceDir>/projects/<runId>/recap-orchestrator-state.json`
 *    instead of overwriting a single shared `state/recap-orchestrator-state.json`.
 * 2. Preserves backward compatibility by reading legacy `state/recap-orchestrator-state.json`
 *    and `<legacyCheckpointsRoot>/<chapterId>/recap-orchestrator-state.json`, deduplicating by `runId`.
 * 3. Persists companion artifacts (`recap-script.json`, `recap-audiovisual-plan.json`,
 *    `gate-g-report.json`, `gate-h-report.json`) so reopening any project restores
 *    the real Timeline, Humanized Script, Quality Scorecard, and MotionVelix telemetry.
 * 4. Safely deletes a project and its unshared workspace directories with strict path containment.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { GateGReport, RecapScript } from '../recap-types.js';
import type { GateHReport, RecapAudiovisualPlan } from '../phase3/recap-audiovisual-types.js';
import type { GateIReport, GateJReport } from '../phase3/recap-semantic-alignment.js';
import type { RecapOrchestratorRecord } from './recap-production-orchestrator.js';

const STATE_FILE = 'recap-orchestrator-state.json';
const SCRIPT_FILE = 'recap-script.json';
const PLAN_FILE = 'recap-audiovisual-plan.json';
const GATE_G_FILE = 'gate-g-report.json';
const GATE_H_FILE = 'gate-h-report.json';
const GATE_I_FILE = 'gate-i-report.json';
const GATE_J_FILE = 'gate-j-report.json';

export interface RecapProjectArtifacts {
	script?: RecapScript;
	plan?: RecapAudiovisualPlan;
	gateGReport?: GateGReport;
	gateHReport?: GateHReport;
	gateIReport?: GateIReport;
	gateJReport?: GateJReport;
}

export interface RecapProjectDetail {
	record: RecapOrchestratorRecord;
	script: RecapScript | null;
	plan: RecapAudiovisualPlan | null;
	gateGReport: GateGReport | null;
	gateHReport: GateHReport | null;
	gateIReport: GateIReport | null;
	gateJReport: GateJReport | null;
}

export interface DeleteRecapProjectResult {
	ok: boolean;
	deleted?: string;
	removedPaths?: string[];
	error?: string;
}

function isSafeSegment(value: string): boolean {
	return /^[a-zA-Z0-9._-]+$/.test(value) && value !== '.' && value !== '..' && !value.includes('..');
}

function isStrictlyInside(rootDir: string, targetPath: string): boolean {
	const rel = relative(resolve(rootDir), resolve(targetPath));
	return rel !== '' && !rel.startsWith('..') && !resolve(targetPath).startsWith(resolve(rootDir) + '..') && !rel.includes(':');
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
	const dir = resolve(filePath, '..');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
	renameSync(tmp, filePath);
}

function readJsonSafe<T>(filePath: string): T | null {
	if (!existsSync(filePath)) return null;
	try {
		return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return null;
	}
}

export function getRecapProjectDir(workspaceDir: string, runId: string): string {
	const safeId = isSafeSegment(runId)
		? runId
		: runId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'recap-run';
	return join(workspaceDir, 'projects', safeId);
}

/**
 * Persists a project's orchestrator record and optional companion artifacts into
 * `<workspaceDir>/projects/<runId>/` and mirrors the latest record into
 * `<workspaceDir>/state/recap-orchestrator-state.json` for legacy readers.
 */
export function saveRecapProjectRecord(
	workspaceDir: string,
	record: RecapOrchestratorRecord,
	artifacts?: RecapProjectArtifacts,
): string {
	const projectDir = getRecapProjectDir(workspaceDir, record.runId);
	mkdirSync(projectDir, { recursive: true });
	writeJsonAtomic(join(projectDir, STATE_FILE), record);

	if (artifacts?.script) {
		writeJsonAtomic(join(projectDir, SCRIPT_FILE), artifacts.script);
	}
	if (artifacts?.plan) {
		writeJsonAtomic(join(projectDir, PLAN_FILE), artifacts.plan);
	}
	if (artifacts?.gateGReport) {
		writeJsonAtomic(join(projectDir, GATE_G_FILE), artifacts.gateGReport);
	}
	if (artifacts?.gateHReport) {
		writeJsonAtomic(join(projectDir, GATE_H_FILE), artifacts.gateHReport);
	}
	if (artifacts?.gateIReport) {
		writeJsonAtomic(join(projectDir, GATE_I_FILE), artifacts.gateIReport);
	}
	if (artifacts?.gateJReport) {
		writeJsonAtomic(join(projectDir, GATE_J_FILE), artifacts.gateJReport);
	}

	// Backward-compatible mirror for callers reading `<workspaceDir>/state/recap-orchestrator-state.json`
	const legacyStateDir = join(workspaceDir, 'state');
	mkdirSync(legacyStateDir, { recursive: true });
	writeJsonAtomic(join(legacyStateDir, STATE_FILE), record);

	return projectDir;
}

function normalizeRecord(raw: unknown, fallbackId: string): RecapOrchestratorRecord | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Partial<RecapOrchestratorRecord>;
	if (obj.schemaVersion !== 1) return null;
	const runId = typeof obj.runId === 'string' && obj.runId.trim() ? obj.runId : fallbackId;
	const chapterId = typeof obj.chapterId === 'string' && obj.chapterId.trim() ? obj.chapterId : fallbackId;
	const workTitle = typeof obj.workTitle === 'string' && obj.workTitle.trim() ? obj.workTitle : chapterId;
	return {
		...obj,
		schemaVersion: 1,
		runId,
		chapterId,
		workTitle,
		state: obj.state ?? 'idle',
		completedSteps: Array.isArray(obj.completedSteps) ? obj.completedSteps : [],
		previewMp4Path: obj.previewMp4Path ?? null,
		masterMp4Path: obj.masterMp4Path ?? null,
		updatedAtIso: typeof obj.updatedAtIso === 'string' ? obj.updatedAtIso : new Date(0).toISOString(),
	};
}

function compareIsoDesc(a: string, b: string): number {
	const ta = Date.parse(a);
	const tb = Date.parse(b);
	if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
		return tb - ta;
	}
	return b.localeCompare(a);
}

/**
 * Lists all recap projects across `<workspaceDir>/projects/<runId>`, legacy `<workspaceDir>/state`,
 * and optional `<legacyCheckpointsRoot>/<chapterId>`, deduplicated by `runId` and sorted newest-first.
 */
export function listRecapProjects(
	workspaceDir: string,
	legacyCheckpointsRoot?: string,
): RecapOrchestratorRecord[] {
	const byRunId = new Map<string, RecapOrchestratorRecord>();

	const upsert = (rec: RecapOrchestratorRecord | null) => {
		if (!rec) return;
		const existing = byRunId.get(rec.runId);
		if (!existing || compareIsoDesc(rec.updatedAtIso, existing.updatedAtIso) < 0) {
			byRunId.set(rec.runId, rec);
		}
	};

	// 1. Canonical per-project store: <workspaceDir>/projects/<runId>/recap-orchestrator-state.json
	const projectsRoot = join(workspaceDir, 'projects');
	if (existsSync(projectsRoot)) {
		for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const raw = readJsonSafe<unknown>(join(projectsRoot, entry.name, STATE_FILE));
			upsert(normalizeRecord(raw, entry.name));
		}
	}

	// 2. Legacy single state file: <workspaceDir>/state/recap-orchestrator-state.json
	const legacyStateFile = join(workspaceDir, 'state', STATE_FILE);
	if (existsSync(legacyStateFile)) {
		upsert(normalizeRecord(readJsonSafe<unknown>(legacyStateFile), 'latest'));
	}

	// 3. Legacy checkpoints directory: <legacyCheckpointsRoot>/<chapterId>/recap-orchestrator-state.json
	if (legacyCheckpointsRoot && existsSync(legacyCheckpointsRoot)) {
		for (const entry of readdirSync(legacyCheckpointsRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const raw = readJsonSafe<unknown>(join(legacyCheckpointsRoot, entry.name, STATE_FILE));
			upsert(normalizeRecord(raw, entry.name));
		}
	}

	return [...byRunId.values()].sort((a, b) => compareIsoDesc(a.updatedAtIso, b.updatedAtIso));
}

/**
 * Loads full project detail including saved script, audiovisual plan, and Gate G / Gate H reports.
 */
export function loadRecapProjectDetail(
	workspaceDir: string,
	runId: string,
	legacyCheckpointsRoot?: string,
): RecapProjectDetail | null {
	const projects = listRecapProjects(workspaceDir, legacyCheckpointsRoot);
	const record = projects.find((p) => p.runId === runId);
	if (!record) return null;

	const projectDir = getRecapProjectDir(workspaceDir, record.runId);
	const renderDir = join(workspaceDir, 'render', record.chapterId);
	const exportDir = record.exportBundleDir;

	const script =
		readJsonSafe<RecapScript>(join(projectDir, SCRIPT_FILE)) ??
		(exportDir ? readJsonSafe<RecapScript>(join(exportDir, SCRIPT_FILE)) : null);

	const plan =
		readJsonSafe<RecapAudiovisualPlan>(join(projectDir, PLAN_FILE)) ??
		readJsonSafe<RecapAudiovisualPlan>(join(renderDir, 'master', PLAN_FILE)) ??
		readJsonSafe<RecapAudiovisualPlan>(join(renderDir, PLAN_FILE)) ??
		(exportDir ? readJsonSafe<RecapAudiovisualPlan>(join(exportDir, PLAN_FILE)) : null);

	const gateGReport = readJsonSafe<GateGReport>(join(projectDir, GATE_G_FILE));

	const gateHReport =
		readJsonSafe<GateHReport>(join(projectDir, GATE_H_FILE)) ??
		readJsonSafe<GateHReport>(join(renderDir, 'master', GATE_H_FILE)) ??
		readJsonSafe<GateHReport>(join(renderDir, GATE_H_FILE)) ??
		(exportDir ? readJsonSafe<GateHReport>(join(exportDir, GATE_H_FILE)) : null);

	const gateIReport =
		readJsonSafe<GateIReport>(join(projectDir, GATE_I_FILE)) ??
		readJsonSafe<GateIReport>(join(renderDir, 'master', GATE_I_FILE)) ??
		readJsonSafe<GateIReport>(join(renderDir, GATE_I_FILE)) ??
		(exportDir ? readJsonSafe<GateIReport>(join(exportDir, GATE_I_FILE)) : null);

	const gateJReport =
		readJsonSafe<GateJReport>(join(projectDir, GATE_J_FILE)) ??
		readJsonSafe<GateJReport>(join(renderDir, 'master', GATE_J_FILE)) ??
		readJsonSafe<GateJReport>(join(renderDir, GATE_J_FILE)) ??
		(exportDir ? readJsonSafe<GateJReport>(join(exportDir, GATE_J_FILE)) : null);

	return {
		record,
		script,
		plan,
		gateGReport,
		gateHReport,
		gateIReport,
		gateJReport,
	};
}

/**
 * Deletes a recap project record and its owned directories across canonical and legacy roots.
 * Chapter-scoped caches (`checkpoints/<chapterId>`, `render/<chapterId>`, `import/<chapterId>`)
 * are only deleted when no other persisted project references the same `chapterId`.
 */
export function deleteRecapProject(
	workspaceDir: string,
	runId: string,
	legacyCheckpointsRoot?: string,
): DeleteRecapProjectResult {
	if (!runId || typeof runId !== 'string' || !isSafeSegment(runId)) {
		return { ok: false, error: 'Identificador de projeto inválido.' };
	}

	const allProjects = listRecapProjects(workspaceDir, legacyCheckpointsRoot);
	const target = allProjects.find((p) => p.runId === runId || p.chapterId === runId);
	if (!target) {
		return { ok: false, error: 'Projeto não encontrado.' };
	}

	const removedPaths: string[] = [];

	// 1. Delete canonical project folder
	const projectsRoot = join(workspaceDir, 'projects');
	const projectDir = getRecapProjectDir(workspaceDir, target.runId);
	if (existsSync(projectDir) && isStrictlyInside(projectsRoot, projectDir)) {
		rmSync(projectDir, { recursive: true, force: true });
		removedPaths.push(projectDir);
	}

	// 2. Clean legacy <workspaceDir>/state/recap-orchestrator-state.json if it points to this runId
	const legacyStateFile = join(workspaceDir, 'state', STATE_FILE);
	if (existsSync(legacyStateFile)) {
		const legacyRec = normalizeRecord(readJsonSafe<unknown>(legacyStateFile), 'latest');
		if (legacyRec && (legacyRec.runId === target.runId || legacyRec.runId === runId)) {
			rmSync(legacyStateFile, { force: true });
			removedPaths.push(legacyStateFile);
		}
	}

	// 3. Clean legacy checkpoints directory if matching
	if (legacyCheckpointsRoot && existsSync(legacyCheckpointsRoot)) {
		for (const entry of readdirSync(legacyCheckpointsRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const entryDir = join(legacyCheckpointsRoot, entry.name);
			const rec = normalizeRecord(readJsonSafe<unknown>(join(entryDir, STATE_FILE)), entry.name);
			if ((rec && rec.runId === target.runId) || entry.name === target.runId) {
				if (isStrictlyInside(legacyCheckpointsRoot, entryDir)) {
					rmSync(entryDir, { recursive: true, force: true });
					removedPaths.push(entryDir);
				}
			}
		}
	}

	// 4. Delete chapter-scoped workspace folders only if no remaining project shares this chapterId
	const remainingSameChapter = allProjects.some(
		(p) => p.runId !== target.runId && p.chapterId === target.chapterId,
	);
	if (!remainingSameChapter && isSafeSegment(target.chapterId)) {
		for (const sub of ['checkpoints', 'render', 'import']) {
			const root = join(workspaceDir, sub);
			const dir = join(root, target.chapterId);
			if (existsSync(dir) && isStrictlyInside(root, dir)) {
				rmSync(dir, { recursive: true, force: true });
				removedPaths.push(dir);
			}
		}
	}

	// 5. If legacy state mirror was deleted and other projects remain, repoint legacy mirror to newest remaining
	const remaining = listRecapProjects(workspaceDir, legacyCheckpointsRoot);
	if (!existsSync(legacyStateFile) && remaining.length > 0) {
		writeJsonAtomic(legacyStateFile, remaining[0]);
	}

	return {
		ok: true,
		deleted: target.runId,
		removedPaths,
	};
}
