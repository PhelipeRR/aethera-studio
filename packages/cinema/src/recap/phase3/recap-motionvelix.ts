/**
 * Aethera Recap — MotionVelix Kit Discovery, SFX Resolution & Editing Telemetry
 *
 * Resolves the locally installed MotionVelix kit across all known paths
 * (NB_VELIX_DIR, workspace `.agents/skills/motionvelix`, `~/.claude/skills/motionvelix`,
 * `~/.agents/skills/motionvelix`, `~/motionvelix`) and reports exact SFX/VFX readiness
 * so Mangá Recap never silently drops MotionVelix assets or fails Gate H due to path mismatch.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { RecapPanelShot, RecapSfxKind, RecapVfxSpec } from './recap-audiovisual-types.js';

export const MOTIONVELIX_SFX_MAP: Readonly<Record<RecapSfxKind, string>> = {
	whoosh: 'whoosh.wav',
	impact_hit: 'impacto.wav',
	tension_riser: 'riser.wav',
	page_turn: 'papel.wav',
	emotional_swell: 'brilho.wav',
};

export interface MotionVelixSfxAssetInfo {
	kind: RecapSfxKind;
	filename: string;
	path: string;
}

export interface MotionVelixKitStatus {
	installed: boolean;
	kitRoot: string | null;
	sfxDir: string | null;
	hasRemotionKit: boolean;
	editingEngine: 'ffmpeg_motionvelix_hybrid';
	availableSfx: MotionVelixSfxAssetInfo[];
	missingSfx: Array<{ kind: RecapSfxKind; filename: string }>;
	checkedPaths: string[];
	summary: string;
}

export interface MotionVelixRenderReport {
	engine: 'ffmpeg_motionvelix_hybrid';
	sfxDirUsed: string | null;
	sfxPlanned: number;
	sfxApplied: number;
	sfxKindsApplied: RecapSfxKind[];
	vfxAppliedShots: number;
	transitionsApplied: number;
	motionStylesUsed: string[];
	fallbackUsed: boolean;
}

function collectCandidateSfxDirs(options?: {
	envVelixDir?: string;
	cwd?: string;
	homeDir?: string;
}): string[] {
	const envDir = options?.envVelixDir ?? process.env['NB_VELIX_DIR'];
	const cwd = options?.cwd ?? process.cwd();
	const home = options?.homeDir ?? homedir();

	const rawCandidates: string[] = [];
	if (envDir && envDir.trim()) {
		const trimmed = envDir.trim();
		rawCandidates.push(trimmed);
		rawCandidates.push(join(trimmed, 'assets', 'sfx'));
	}
	rawCandidates.push(
		join(cwd, '.agents', 'skills', 'motionvelix', 'assets', 'sfx'),
		join(cwd, '.claude', 'skills', 'motionvelix', 'assets', 'sfx'),
		join(home, '.claude', 'skills', 'motionvelix', 'assets', 'sfx'),
		join(home, '.agents', 'skills', 'motionvelix', 'assets', 'sfx'),
		join(home, 'motionvelix', 'assets', 'sfx'),
	);

	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const candidate of rawCandidates) {
		const normalized = resolve(candidate);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			deduped.push(normalized);
		}
	}
	return deduped;
}

function inspectSfxDir(sfxDir: string): {
	availableSfx: MotionVelixSfxAssetInfo[];
	missingSfx: Array<{ kind: RecapSfxKind; filename: string }>;
} {
	const availableSfx: MotionVelixSfxAssetInfo[] = [];
	const missingSfx: Array<{ kind: RecapSfxKind; filename: string }> = [];

	for (const [kind, filename] of Object.entries(MOTIONVELIX_SFX_MAP) as Array<[RecapSfxKind, string]>) {
		const filePath = join(sfxDir, filename);
		if (existsSync(filePath)) {
			availableSfx.push({ kind, filename, path: filePath });
		} else {
			missingSfx.push({ kind, filename });
		}
	}

	return { availableSfx, missingSfx };
}

function inferKitRootFromSfxDir(sfxDir: string): string {
	// Typical structure: <kitRoot>/assets/sfx
	const parent = dirname(sfxDir);
	if (parent.endsWith('assets') || parent.endsWith('assets\\') || parent.endsWith('assets/')) {
		return dirname(parent);
	}
	return sfxDir;
}

/**
 * Inspects local paths to detect the installed MotionVelix kit and SFX WAV library.
 */
export function resolveMotionVelixKit(options?: {
	envVelixDir?: string;
	cwd?: string;
	homeDir?: string;
}): MotionVelixKitStatus {
	const checkedPaths = collectCandidateSfxDirs(options);
	let bestDir: string | null = null;
	let bestAvailable: MotionVelixSfxAssetInfo[] = [];
	let bestMissing: Array<{ kind: RecapSfxKind; filename: string }> = (
		Object.entries(MOTIONVELIX_SFX_MAP) as Array<[RecapSfxKind, string]>
	).map(([kind, filename]) => ({ kind, filename }));

	for (const dir of checkedPaths) {
		if (!existsSync(dir)) continue;
		const { availableSfx, missingSfx } = inspectSfxDir(dir);
		if (availableSfx.length > bestAvailable.length || (bestDir === null && existsSync(dir))) {
			bestDir = dir;
			bestAvailable = availableSfx;
			bestMissing = missingSfx;
		}
		if (availableSfx.length === Object.keys(MOTIONVELIX_SFX_MAP).length) {
			break;
		}
	}

	const kitRoot = bestDir ? inferKitRootFromSfxDir(bestDir) : null;
	const hasRemotionKit = Boolean(
		kitRoot &&
		(existsSync(join(kitRoot, 'SKILL.md')) ||
			existsSync(join(kitRoot, 'scripts', 'setup.py')) ||
			existsSync(join(kitRoot, 'package.json'))),
	);
	const installed = bestAvailable.length > 0;
	const totalExpected = Object.keys(MOTIONVELIX_SFX_MAP).length;

	const summary = installed
		? `MotionVelix ativo (${bestAvailable.length}/${totalExpected} SFX WAVs prontos) · Edição híbrida FFmpeg Motion + VFX/Transições + SFX MotionVelix.`
		: 'Kit MotionVelix SFX não encontrado nos diretórios padrão (NB_VELIX_DIR, .agents/skills/motionvelix ou ~/.claude/skills/motionvelix). Motion visual FFmpeg opera normalmente, mas os efeitos sonoros MotionVelix ficarão ausentes até instalar o kit.';

	return {
		installed,
		kitRoot,
		sfxDir: bestDir,
		hasRemotionKit,
		editingEngine: 'ffmpeg_motionvelix_hybrid',
		availableSfx: bestAvailable,
		missingSfx: bestMissing,
		checkedPaths,
		summary,
	};
}

/**
 * Builds the FFmpeg filtergraph for a single manga panel shot with MotionVelix motion,
 * X/Y focal interpolation, balloon-safe micro-shake, contrast/vignette VFX, and shot entry transitions.
 */
export function buildShotZoompanFilter(
	shot: RecapPanelShot,
	width: number,
	height: number,
	fps: number,
	vfx?: RecapVfxSpec,
): string {
	const frames = Math.max(1, Math.round((shot.durationMs / 1000) * fps));
	const denom = Math.max(1, frames - 1);
	const z0 = shot.focalStart.zoom;
	const z1 = shot.focalEnd.zoom;
	const zExpr = Math.abs(z1 - z0) < 0.001
		? z0.toFixed(4)
		: `${z0.toFixed(4)}+(${(z1 - z0).toFixed(4)})*(on/${denom})`;

	const x0 = shot.focalStart.x;
	const x1 = shot.focalEnd.x;
	const xBase = Math.abs(x1 - x0) < 0.001
		? `iw*${x0.toFixed(3)}-iw/zoom/2`
		: `iw*(${x0.toFixed(3)}+(${(x1 - x0).toFixed(3)})*(on/${denom}))-iw/zoom/2`;

	const y0 = shot.focalStart.y;
	const y1 = shot.focalEnd.y;
	const yBase = Math.abs(y1 - y0) < 0.001
		? `ih*${y0.toFixed(3)}-ih/zoom/2`
		: `ih*(${y0.toFixed(3)}+(${(y1 - y0).toFixed(3)})*(on/${denom}))-ih/zoom/2`;

	// Apply safe MotionVelix micro-shake only on non-dialogue climax/high-energy shots
	const allowShake = Boolean(vfx && vfx.shakeIntensity > 0 && !shot.balloonSafeZoneProtected);
	const shakeAmpPx = allowShake ? Math.min(8, Math.round((vfx?.shakeIntensity ?? 0) * 32)) : 0;
	const xExpr = shakeAmpPx > 0 ? `max(0,min(iw-iw/zoom,(${xBase})+sin(on*1.9)*${shakeAmpPx}))` : xBase;
	const yExpr = shakeAmpPx > 0 ? `max(0,min(ih-ih/zoom,(${yBase})+cos(on*2.3)*${shakeAmpPx}))` : yBase;

	const chain = [
		`scale=${width}:${height}:force_original_aspect_ratio=decrease`,
		`pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=#0b0b0f`,
		`zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps}`,
		'setsar=1',
	];

	// MotionVelix VFX: contrast & vignette (always respecting dialogue balloon-safe zones)
	if (vfx && vfx.contrastBoost > 1.01) {
		chain.push(`eq=contrast=${Math.min(1.2, vfx.contrastBoost).toFixed(2)}`);
	}
	if (vfx && vfx.vignetteStrength > 0.05) {
		const angle = (Math.min(0.45, vfx.vignetteStrength) * 1.4).toFixed(3);
		chain.push(`vignette=angle=${angle}`);
	}

	// MotionVelix transition cues on shot entry
	const fadeDur = Math.min(0.28, Math.max(0.12, (shot.durationMs / 1000) * 0.14)).toFixed(2);
	if (shot.transitionIn === 'dip_black' || shot.transitionIn === 'crossfade') {
		chain.push(`fade=t=in:st=0:d=${fadeDur}:color=black`);
	} else if (shot.transitionIn === 'flash_white') {
		chain.push(`fade=t=in:st=0:d=0.16:color=white`);
	}

	chain.push('format=yuv420p');
	return chain.join(',');
}
