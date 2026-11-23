/**
 * Aethera Recap — MotionVelix Kit Discovery, SFX Resolution & Editing Telemetry
 *
 * Resolves the locally installed MotionVelix kit across all known paths
 * (NB_VELIX_DIR, workspace `.agents/skills/motionvelix`, `~/.claude/skills/motionvelix`,
 * `~/.agents/skills/motionvelix`, `~/motionvelix`) and reports exact SFX/VFX readiness
 * so Mangá Recap never silently drops MotionVelix assets or fails Gate H due to path mismatch.
 */

import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Reads image dimensions (width × height) synchronously from PNG or JPEG headers
 * without spawning any external process.
 */
export function readImageDimensionsFast(imagePath: string): { width: number; height: number } | null {
	try {
		if (!existsSync(imagePath)) return null;
		const buf = readFileSync(imagePath);
		// PNG: signature 89 50 4E 47, IHDR width at offset 16, height at offset 20 (big-endian)
		if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
			return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
		}
		// JPEG: scan SOF0/SOF2 markers (FF C0 / FF C2)
		if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
			let off = 2;
			while (off + 9 < buf.length) {
				if (buf[off] !== 0xff) {
					off++;
					continue;
				}
				const marker = buf[off + 1]!;
				if (marker === 0xc0 || marker === 0xc2) {
					return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
				}
				const segLen = buf.readUInt16BE(off + 2);
				if (segLen < 2) break;
				off += 2 + segLen;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * MotionVelix Vertical Panel Compositor (Phase 5 / Audiovisual Refinement):
 * For tall vertical manhwa panels (`height / width > 1.35`) in a landscape 16:9 viewport,
 * replaces harsh black pillarbox bars and tiny static strips with:
 * - A blurred, darkened ambient backdrop of the same panel (full 16:9)
 * - The crisp vertical panel scaled to a comfortable ~56% viewport width (ZERO left/right crop,
 *   full speech-balloon readability, ZERO excessive zoom)
 * - Smooth top-to-bottom vertical camera scroll synced to the shot duration
 *
 * Returns `{ filterComplex, mapLabel }` when vertical mode applies, or `null` to use standard `-vf`.
 */
export function buildVerticalPanelFilterComplex(
	shot: RecapPanelShot,
	width: number,
	height: number,
	fps: number,
	vfx?: RecapVfxSpec,
): { filterComplex: string; mapLabel: string } | null {
	if (width <= height) return null; // Already vertical 9:16 viewport
	const dims = readImageDimensionsFast(shot.imagePath);
	if (!dims || dims.width <= 0 || dims.height <= 0) return null;
	const heightToWidth = dims.height / dims.width;
	if (heightToWidth <= 1.35) return null;

	// Scale foreground to ~56% of viewport width (even integer) so full artwork & balloons fit cleanly
	const fgW = Math.floor((width * 0.56) / 2) * 2;
	const scaledFgH = Math.floor(((dims.height / dims.width) * fgW) / 2) * 2;
	if (scaledFgH <= height + 40) return null;

	const durSec = Math.max(0.5, shot.durationMs / 1000).toFixed(3);
	const maxScrollY = Math.max(0, scaledFgH - height);
	// Smooth ease-in-out / linear top-to-bottom camera glide matching vertical manhwa reading order
	const yExpr = `${maxScrollY}*min(1\\,max(0\\,t/${durSec}))`;

	const postFx: string[] = [];
	if (vfx && vfx.contrastBoost > 1.01) {
		postFx.push(`eq=contrast=${Math.min(1.14, vfx.contrastBoost).toFixed(2)}`);
	}
	if (vfx && vfx.vignetteStrength > 0.05) {
		const angle = (Math.min(0.32, vfx.vignetteStrength) * 1.2).toFixed(3);
		postFx.push(`vignette=angle=${angle}`);
	}
	const fadeDur = Math.min(0.28, Math.max(0.12, (shot.durationMs / 1000) * 0.14)).toFixed(2);
	if (shot.transitionIn === 'dip_black' || shot.transitionIn === 'crossfade') {
		postFx.push(`fade=t=in:st=0:d=${fadeDur}:color=black`);
	} else if (shot.transitionIn === 'flash_white') {
		postFx.push(`fade=t=in:st=0:d=0.16:color=white`);
	}
	postFx.push(`fps=${fps}`, 'setsar=1', 'format=yuv420p');

	const filterComplex = [
		`[0:v]split=2[src_bg][src_fg]`,
		`[src_bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=28,eq=brightness=-0.16:saturation=0.85[bg]`,
		`[src_fg]scale=${fgW}:${scaledFgH},crop=${fgW}:${height}:0:'${yExpr}'[fg]`,
		`[bg][fg]overlay=(W-w)/2:0,${postFx.join(',')}[vout]`,
	].join(';');

	return { filterComplex, mapLabel: '[vout]' };
}

/**
 * MotionVelix multi-panel compositor: compact panels share the frame (side by side in landscape,
 * stacked in portrait) over a blurred backdrop of the first panel. Each panel fades in at its
 * `revealAtMs`, i.e. when the narration reaches it, and stays until the shot ends.
 *
 * Inputs are the layout's images in order (`-loop 1 -i <panel>` for each).
 */
export function buildMultiPanelFilterComplex(
	shot: RecapPanelShot,
	width: number,
	height: number,
	fps: number,
	vfx?: RecapVfxSpec,
): { filterComplex: string; mapLabel: string; inputs: string[] } | null {
	const layout = shot.layout;
	if (!layout || layout.panels.length < 2) return null;
	const n = layout.panels.length;
	const gap = Math.round(Math.max(width, height) * 0.02);
	const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
	const slotW = layout.kind === 'row' ? even((width - gap * (n + 1)) / n) : even(width - 2 * gap);
	const slotH = layout.kind === 'row' ? even(height - 2 * gap) : even((height - gap * (n + 1)) / n);

	const parts: string[] = [
		`[0:v]split=2[bgsrc][p0src]`,
		`[bgsrc]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=28,eq=brightness=-0.18:saturation=0.85,fps=${fps},setsar=1[bg0]`,
	];
	const fade = 0.25;
	let prev = 'bg0';
	for (let k = 0; k < n; k += 1) {
		const src = k === 0 ? 'p0src' : `${k}:v`;
		const revealSec = Math.max(0, layout.panels[k]!.revealAtMs / 1000);
		const slotX = layout.kind === 'row' ? gap + k * (slotW + gap) : gap;
		const slotY = layout.kind === 'row' ? gap : gap + k * (slotH + gap);
		parts.push(
			`[${src}]scale=${slotW}:${slotH}:force_original_aspect_ratio=decrease,format=rgba,fps=${fps},` +
				`fade=t=in:st=${revealSec.toFixed(3)}:d=${fade}:alpha=1[p${k}]`,
		);
		const x = `${slotX}+(${slotW}-w)/2`;
		const y = `${slotY}+(${slotH}-h)/2`;
		const enable = revealSec > 0 ? `:enable='gte(t,${revealSec.toFixed(3)})'` : '';
		parts.push(`[${prev}][p${k}]overlay=x='${x}':y='${y}'${enable}[bg${k + 1}]`);
		prev = `bg${k + 1}`;
	}

	const post: string[] = [];
	if (vfx && vfx.contrastBoost > 1.01) post.push(`eq=contrast=${Math.min(1.14, vfx.contrastBoost).toFixed(2)}`);
	if (vfx && vfx.vignetteStrength > 0.05) post.push(`vignette=angle=${(Math.min(0.32, vfx.vignetteStrength) * 1.2).toFixed(3)}`);
	const fadeDur = Math.min(0.28, Math.max(0.12, (shot.durationMs / 1000) * 0.14)).toFixed(2);
	if (shot.transitionIn === 'dip_black' || shot.transitionIn === 'crossfade') post.push(`fade=t=in:st=0:d=${fadeDur}:color=black`);
	else if (shot.transitionIn === 'flash_white') post.push('fade=t=in:st=0:d=0.16:color=white');
	post.push('setsar=1', 'format=yuv420p');
	parts.push(`[${prev}]${post.join(',')}[vout]`);

	return { filterComplex: parts.join(';'), mapLabel: '[vout]', inputs: layout.panels.map((p) => p.imagePath) };
}
