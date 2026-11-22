/**
 * MotionVelix Fire Reveal — True 2D FBM Domain-Warped Fluid Fire Pixel Shader
 *
 * Replaces geometric SVG shapes with a real pixel-level multi-octave FBM + domain-warped
 * turbulent fluid fire shader:
 * - Organic rising & curling flames with volumetric smoke and incandescent hot core.
 * - Edge-to-center fire invasion (0–5s).
 * - Progressive burning noise-mask reveal of ANY user-selected logo RGBA buffer (5–7s)
 *   with a white-hot ignition contour along the burn front.
 * - Dynamic ambient lighting, sparse wind-drifted embers, and full user-palette recoloring.
 * - 100% deterministic by (x, y, tSec) — zero Math.random(), zero external clock.
 */

import type { OutroKeyframeSchedule, OutroPalette } from './outro-template-registry.js';

// Precomputed deterministic permutation table (classic Ken Perlin hash, zero Math.random)
const PERM = new Uint8Array(512);
(() => {
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	let seed = 133791;
	for (let i = 255; i > 0; i--) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		const j = seed % (i + 1);
		const tmp = p[i]!;
		p[i] = p[j]!;
		p[j] = tmp;
	}
	for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]!;
})();

function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
	return t * t * (3 - 2 * t);
}

function hash2(ix: number, iy: number): number {
	const h = PERM[(PERM[ix & 255]! + (iy & 255)) & 255]!;
	return h / 255;
}

function valueNoise2D(x: number, y: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const ux = fade(fx);
	const uy = fade(fy);
	const a = hash2(ix, iy);
	const b = hash2(ix + 1, iy);
	const c = hash2(ix, iy + 1);
	const d = hash2(ix + 1, iy + 1);
	return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

/**
 * 4-octave Fractional Brownian Motion (FBM) for organic turbulent fire tendrils.
 */
function fbm4(x: number, y: number): number {
	let value = 0;
	let amp = 0.52;
	let freq = 1.0;
	for (let i = 0; i < 4; i++) {
		value += amp * valueNoise2D(x * freq, y * freq);
		// Slight rotation between octaves eliminates grid artifacts
		const nx = x * 0.8 - y * 0.6;
		const ny = x * 0.6 + y * 0.8;
		x = nx;
		y = ny;
		freq *= 2.04;
		amp *= 0.5;
	}
	return value;
}

function hexToRgbTuple(hex: string): [number, number, number] {
	const clean = hex.replace('#', '');
	const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
	const n = parseInt(full, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface FireShaderPaletteRgb {
	primary: [number, number, number];
	secondary: [number, number, number];
	energy: [number, number, number];
	glow: [number, number, number];
	particles: [number, number, number];
}

export function parseFirePaletteRgb(palette: OutroPalette): FireShaderPaletteRgb {
	return {
		primary: hexToRgbTuple(palette.primary),
		secondary: hexToRgbTuple(palette.secondary),
		energy: hexToRgbTuple(palette.energy),
		glow: hexToRgbTuple(palette.glow),
		particles: hexToRgbTuple(palette.particles),
	};
}

/**
 * Evaluates a rich 4-stop fire color ramp (smoke -> primary -> energy -> glow -> incandescent white)
 * driven entirely by the user's selected palette.
 */
function sampleFireRamp(
	temp: number,
	pal: FireShaderPaletteRgb,
	out: [number, number, number, number],
): void {
	if (temp <= 0.14) {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
		out[3] = 0;
		return;
	}
	const alpha = smoothstep(0.14, 0.42, temp);
	let r: number;
	let g: number;
	let b: number;
	if (temp < 0.36) {
		const t = (temp - 0.14) / 0.22;
		r = lerp(pal.primary[0] * 0.25, pal.primary[0], t);
		g = lerp(pal.primary[1] * 0.25, pal.primary[1], t);
		b = lerp(pal.primary[2] * 0.25, pal.primary[2], t);
	} else if (temp < 0.64) {
		const t = (temp - 0.36) / 0.28;
		r = lerp(pal.primary[0], pal.energy[0], t);
		g = lerp(pal.primary[1], pal.energy[1], t);
		b = lerp(pal.primary[2], pal.energy[2], t);
	} else if (temp < 0.86) {
		const t = (temp - 0.64) / 0.22;
		r = lerp(pal.energy[0], pal.glow[0], t);
		g = lerp(pal.energy[1], pal.glow[1], t);
		b = lerp(pal.energy[2], pal.glow[2], t);
	} else {
		const t = clamp01((temp - 0.86) / 0.14);
		r = lerp(pal.glow[0], 255, t);
		g = lerp(pal.glow[1], 255, t);
		b = lerp(pal.glow[2], 255, t);
	}
	out[0] = r;
	out[1] = g;
	out[2] = b;
	out[3] = alpha;
}

export interface RenderFireFrameInput {
	width: number;
	height: number;
	tSec: number;
	keyframes: OutroKeyframeSchedule;
	intensity: number; // 0..100
	palette: FireShaderPaletteRgb;
	/** Optional pre-resized RGBA background buffer (`width * height * 4`). */
	bgRgba?: Uint8Array | null;
	/** Optional pre-positioned RGBA logo buffer (`width * height * 4`). */
	logoRgba?: Uint8Array | null;
	/** Reusable output RGBA buffer (`width * height * 4`). */
	outRgba: Uint8Array;
	parallaxEnabled: boolean;
}

/**
 * Renders a single deterministic frame of the Fire Reveal composition directly into `outRgba`:
 * 1. Parallax dark-lit background + dynamic fire illumination + subtle heat shimmer.
 * 2. Edge-to-center advancing 2D FBM domain-warped organic fire waves (2–5s).
 * 3. Burning noise-threshold mask progressively revealing the user's real logo (5–7s)
 *    with a white-hot flame ignition edge.
 * 4. Organic licking bottom fire wall + fiery corona framing the emblem + sparse glowing embers.
 */
export function renderFireRevealFrameRgba(input: RenderFireFrameInput): void {
	const {
		width,
		height,
		tSec,
		keyframes,
		intensity,
		palette,
		bgRgba,
		logoRgba,
		outRgba,
		parallaxEnabled,
	} = input;

	const normInt = clamp01(intensity / 100);
	const power = 0.55 + 0.75 * normInt;
	const totalSec = keyframes.totalDurationSec;

	// Master fade-in (0..0.6s) & exit fade-out (last 1.0s)
	const masterFade =
		smoothstep(0, 0.55, tSec) * (1 - smoothstep(totalSec - 1.05, totalSec, tSec));

	// Phase weights synced to proportional keyframes
	// 0–2s: subtle ambient embers & smoke
	// 2–5s: fire surges from edges inward toward center
	const edgeSurge = smoothstep(keyframes.energyInStartSec * 0.55, keyframes.energyInEndSec, tSec);
	const centerInvasion =
		smoothstep(keyframes.energyInStartSec, keyframes.logoRevealStartSec + 0.35, tSec) *
		(1 - smoothstep(keyframes.logoRevealStartSec + 0.5, keyframes.channelRevealStartSec + 0.8, tSec) * 0.72);

	// 5–7s: progressive burning mask reveal of the logo
	const logoReveal = smoothstep(keyframes.logoRevealStartSec, keyframes.logoRevealEndSec, tSec);
	// Impact flash right at 5.0s synced with impacto.wav
	const impactFlash =
		Math.exp(-Math.pow((tSec - (keyframes.logoRevealStartSec + 0.18)) / 0.42, 2)) * 0.58 * power;

	const aspect = width / height;
	const isVertical = height > width;
	const centerX = 0.5;
	const centerY = isVertical ? 0.34 : 0.34;

	const fireColor: [number, number, number, number] = [0, 0, 0, 0];
	const riseT = tSec * (1.85 + 0.65 * normInt);

	// Parallax offset for background
	const bgZoom = parallaxEnabled ? 1.0 + 0.08 * (tSec / Math.max(1, totalSec)) : 1.0;
	const bgShiftX = parallaxEnabled ? Math.sin((tSec / totalSec) * Math.PI * 2) * 0.015 : 0;
	const bgShiftY = parallaxEnabled ? Math.cos((tSec / totalSec) * Math.PI * 2) * 0.01 : 0;

	// Precompute 14 sparse, organic wind-drifted embers (not geometric circles — soft glowing sparks)
	const emberCount = Math.max(8, Math.round(8 + 10 * normInt));
	const embersX = new Float32Array(emberCount);
	const embersY = new Float32Array(emberCount);
	const embersR = new Float32Array(emberCount);
	const embersA = new Float32Array(emberCount);
	for (let e = 0; e < emberCount; e++) {
		const sp = 0.11 + (e % 5) * 0.035;
		const life = (tSec * sp + e * 0.193) % 1;
		embersX[e] = ((e * 0.371 + 0.08) % 0.86 + 0.07) + Math.sin(tSec * 2.1 + e * 2.3) * 0.035;
		embersY[e] = 1.02 - life * 0.96;
		embersR[e] = 0.004 + (e % 3) * 0.0022;
		embersA[e] = (1 - life) * smoothstep(0, 0.12, life) * (0.55 + 0.45 * edgeSurge);
	}

	let idx = 0;
	for (let y = 0; y < height; y++) {
		const v = y / height;
		const invV = 1.0 - v; // 0 at bottom, 1 at top
		for (let x = 0; x < width; x++) {
			const u = x / width;

			// Aspect-corrected vector from emblem center
			const dx = (u - centerX) * aspect;
			const dy = v - centerY;
			const dist = Math.sqrt(dx * dx + dy * dy);

			// 2D Domain-Warped FBM fluid turbulence
			const nx = u * (isVertical ? 4.2 : 5.6);
			const ny = v * (isVertical ? 6.2 : 4.2);
			const warpX = fbm4(nx * 0.85, ny * 0.85 + riseT * 0.65) - 0.5;
			const warpY = fbm4(nx * 0.85 + 5.2, ny * 0.85 + 1.3 + riseT * 0.8) - 0.5;
			const turb = fbm4(nx + warpX * 2.15, ny + riseT + warpY * 1.65);

			// 1. Background pixel with subtle heat distortion near hot flames + dynamic fire lighting
			let br = 6;
			let bg = 8;
			let bb = 15;
			if (bgRgba) {
				const shimmer = (turb - 0.5) * 0.012 * edgeSurge * (1 - invV * 0.65);
				const su = clamp01((u - 0.5) / bgZoom + 0.5 + bgShiftX + shimmer);
				const sv = clamp01((v - 0.5) / bgZoom + 0.5 + bgShiftY + shimmer * 0.7);
				const bx = Math.min(width - 1, Math.floor(su * width));
				const by = Math.min(height - 1, Math.floor(sv * height));
				const bIdx = (by * width + bx) * 4;
				// Dark vignette so flames & logo pop
				const vig = 0.28 + 0.34 * (1 - smoothstep(0.15, 0.95, dist));
				br = bgRgba[bIdx]! * vig;
				bg = bgRgba[bIdx + 1]! * vig;
				bb = bgRgba[bIdx + 2]! * vig;
			}

			// Dynamic warm/colored fire illumination cast onto the background
			const ambientGlow =
				(Math.exp(-dist * dist * 3.8) * (0.28 * edgeSurge + impactFlash) +
					Math.pow(clamp01(1 - invV * 1.45), 2) * 0.25 * edgeSurge) *
				power;
			br += palette.energy[0] * ambientGlow * 0.45 + palette.primary[0] * ambientGlow * 0.35;
			bg += palette.energy[1] * ambientGlow * 0.45 + palette.primary[1] * ambientGlow * 0.35;
			bb += palette.energy[2] * ambientGlow * 0.45 + palette.primary[2] * ambientGlow * 0.35;

			// 2. Organic Fire Temperature Field:
			// (A) Bottom roaring wall of turbulent flames rising from bottom edge
			const wallHeight = 0.22 + 0.26 * edgeSurge * power;
			const bottomFlame = clamp01((1.0 - invV / Math.max(0.08, wallHeight)) * 1.15 + (turb - 0.46) * 1.15);

			// (B) Edge-to-center advancing fire invasion (2–5s) sweeping from left/right/bottom toward center
			const edgeDist = Math.min(u, 1 - u, 1 - v);
			const invasionReach = 0.04 + 0.52 * centerInvasion;
			const edgeWave =
				centerInvasion > 0.01
					? clamp01((1 - edgeDist / Math.max(0.05, invasionReach)) * 0.95 + (turb - 0.44) * 1.25) * centerInvasion
					: 0;

			// (C) Wispy turbulent fiery corona tightly framing ONLY the emblem (never obscuring text below)
			const ringRadius = isVertical ? 0.145 : 0.175;
			const turbDist = dist + (turb - 0.5) * 0.085;
			const ringBand = Math.exp(-Math.pow((turbDist - ringRadius) / 0.044, 2));
			const angle = Math.atan2(dy, dx);
			// Open at the very top & soften bottom so twin flames rise organically around the emblem
			const topNotch = 1 - 0.65 * Math.exp(-Math.pow(angle + Math.PI / 2, 2) * 3.5);
			const bottomClear = 1 - 0.45 * Math.exp(-Math.pow(angle - Math.PI / 2, 2) * 4.0);
			const coronaFlame = clamp01(
				ringBand * topNotch * bottomClear * (0.28 + turb * 1.15) * (0.2 + 0.8 * edgeSurge) * power * 0.88,
			);

			const fireTemp = clamp01(Math.max(bottomFlame, edgeWave, coronaFlame) * power);
			sampleFireRamp(fireTemp, palette, fireColor);

			// Composite fire over lit background (additive-tinted alpha blend for luminous flames)
			const fa = fireColor[3];
			let r = br * (1 - fa * 0.72) + fireColor[0] * fa;
			let g = bg * (1 - fa * 0.72) + fireColor[1] * fa;
			let b = bb * (1 - fa * 0.72) + fireColor[2] * fa;

			// 3. Progressive Burning Noise-Mask Reveal of the User's REAL Logo (5–7s)
			if (logoRgba && logoReveal > 0.005) {
				const la = logoRgba[idx + 3]! / 255;
				if (la > 0.02) {
					// Organic burning threshold field: center ignites outward with FBM fire contour
					const burnField = clamp01(dist * 1.7 + (turb - 0.48) * 0.65);
					const revealEdge = logoReveal * 1.32;
					const logoVis = smoothstep(burnField - 0.09, burnField + 0.05, revealEdge);

					// Blazing white-hot ignition contour right along the reveal front!
					const burnContour =
						logoReveal < 0.98
							? Math.exp(-Math.pow((burnField - revealEdge) / 0.075, 2)) * la
							: 0;

					if (logoVis > 0.01) {
						const effAlpha = la * logoVis;
						const lr = logoRgba[idx]!;
						const lg = logoRgba[idx + 1]!;
						const lb = logoRgba[idx + 2]!;
						r = r * (1 - effAlpha) + lr * effAlpha;
						g = g * (1 - effAlpha) + lg * effAlpha;
						b = b * (1 - effAlpha) + lb * effAlpha;
					}
					if (burnContour > 0.02) {
						r += lerp(palette.glow[0], 255, 0.7) * burnContour * 1.15;
						g += lerp(palette.glow[1], 255, 0.7) * burnContour * 1.15;
						b += lerp(palette.glow[2], 255, 0.7) * burnContour * 1.15;
					}
				}
			}

			// 4. Sparse glowing wind-drifted embers (soft radial spark falloff, never flat hard circles)
			for (let e = 0; e < emberCount; e++) {
				const edx = (u - embersX[e]!) * aspect;
				const edy = v - embersY[e]!;
				const er = embersR[e]!;
				const d2 = edx * edx + edy * edy;
				if (d2 < er * er * 9) {
					const spark = Math.exp(-d2 / (er * er * 1.6)) * embersA[e]!;
					r += lerp(palette.particles[0], 255, spark) * spark;
					g += lerp(palette.particles[1], 255, spark) * spark;
					b += lerp(palette.particles[2], 255, spark) * spark;
				}
			}

			// Impact flash bloom at reveal moment
			if (impactFlash > 0.02) {
				const flashFalloff = Math.exp(-dist * dist * 5.2) * impactFlash;
				r += lerp(palette.glow[0], 255, 0.65) * flashFalloff;
				g += lerp(palette.glow[1], 255, 0.65) * flashFalloff;
				b += lerp(palette.glow[2], 255, 0.65) * flashFalloff;
			}

			outRgba[idx] = Math.max(0, Math.min(255, Math.round(r * masterFade)));
			outRgba[idx + 1] = Math.max(0, Math.min(255, Math.round(g * masterFade)));
			outRgba[idx + 2] = Math.max(0, Math.min(255, Math.round(b * masterFade)));
			outRgba[idx + 3] = 255;
			idx += 4;
		}
	}
}

// ─── Flame Logo Pack (4 Exact Options: Wide, Banner, Squircle, Circle) ───────

export type FlamePackVariant = 'flame_wide' | 'flame_banner' | 'flame_squircle' | 'flame_circle';

function sdRoundedBox(px: number, py: number, bx: number, by: number, r: number): number {
	const qx = Math.abs(px) - bx + r;
	const qy = Math.abs(py) - by + r;
	const outside = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2);
	const inside = Math.min(Math.max(qx, qy), 0);
	return outside + inside - r;
}

// ─── 2D Anime Sakuga Flame Sprite Engine (Curved Sickles + Forks + Concave Bites) ─

interface AnimeFlameInstance {
	/** World-space position in aspect-corrected coords centered at (cx, cy). */
	x: number;
	y: number;
	/** Orientation angle in radians. */
	angle: number;
	/** Flame spine length in normalized height units. */
	length: number;
	/** Base thickness ratio relative to length (e.g. 0.24..0.46). */
	thickness: number;
	/** Spine curvature (+ or - bends into an anime C-sickle). */
	curvature: number;
	/** Whether this flame has a secondary forked branch. */
	hasFork: boolean;
	forkDir: number;
	/** Concave anime bite-cutout 1 & 2 in local coords. */
	bite1X: number;
	bite1Y: number;
	bite1R: number;
	bite2X: number;
	bite2Y: number;
	bite2R: number;
	/** Opacity / presence 0..1. */
	alpha: number;
	/** Deterministic seed for organic wobble. */
	seed: number;
}

function seededRand(seed: number): number {
	const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
	return s - Math.floor(s);
}

/**
 * Evaluates a single curved, forked, concave-cutout 2D anime flame tongue SDF.
 * Returns signed distance (< 0 inside flame, > 0 outside) in normalized flame-local units.
 */
function evalAnimeFlameSdf(
	lx: number,
	ly: number,
	f: AnimeFlameInstance,
	tSec: number,
): number {
	// u in [0, 1] along spine from base (-0.5) to sharp curved tip (+0.5)
	const u = lx + 0.5;
	if (u < -0.18 || u > 1.18) return 1.0;

	// Curved S-wave anime flame spine + organic domain-warped flicker (juicy fire, never stiff wings!)
	const wobble =
		Math.sin(u * 5.2 - tSec * 7.2 + f.seed * 6.28) * 0.068 * u +
		Math.sin(u * Math.PI * 1.65 + f.seed * 3.1) * 0.095 * (f.curvature >= 0 ? 1 : -1);
	const warpN = (valueNoise2D(lx * 3.6 + f.seed * 7.3, ly * 3.6 - tSec * 3.2) - 0.5) * 0.11;
	const spineY = f.curvature * u * u + wobble + warpN;
	const cy = ly - spineY;

	// Tapered organic flame profile: plump curved base -> razor-sharp curved tip
	const uc = clamp01(u);
	const profile =
		f.thickness *
		Math.pow(Math.sin(uc * Math.PI), 0.68) *
		(1.05 - 0.52 * uc);

	// Distance to main curved tongue (with smooth end caps)
	const endDist = u < 0 ? -u : u > 1 ? u - 1 : 0;
	let dBody = Math.sqrt(Math.max(0, Math.abs(cy) - profile) ** 2 + endDist * endDist);
	if (endDist === 0 && Math.abs(cy) < profile) {
		dBody = Math.abs(cy) - profile;
	}

	// Optional secondary forked branch (organic branching anime flame!)
	if (f.hasFork) {
		const fx = (lx + 0.14) * 0.88 + cy * f.forkDir * 0.48;
		const fy = -((lx + 0.14) * f.forkDir * 0.48) + cy * 0.88 - f.forkDir * 0.05;
		const fu = fx + 0.35;
		if (fu > -0.1 && fu < 0.78) {
			const fuc = clamp01(fu / 0.68);
			const fSpineY = f.forkDir * 0.22 * fuc * fuc;
			const fProf = f.thickness * 0.52 * Math.pow(Math.sin(fuc * Math.PI), 0.7) * (1.0 - 0.5 * fuc);
			const fEnd = fu < 0 ? -fu : fu > 0.68 ? fu - 0.68 : 0;
			let dFork = Math.sqrt(Math.max(0, Math.abs(fy - fSpineY) - fProf) ** 2 + fEnd * fEnd);
			if (fEnd === 0 && Math.abs(fy - fSpineY) < fProf) {
				dFork = Math.abs(fy - fSpineY) - fProf;
			}
			// Smooth union of main tongue and fork
			const h = clamp01(0.5 + (0.5 * (dFork - dBody)) / 0.055);
			dBody = lerp(dFork, dBody, h) - 0.055 * h * (1 - h);
		}
	}

	// Carve 1–2 concave crescent notches STRICTLY from the outer edge (NEVER closed eyeball holes!)
	let dFinal = dBody;
	if (f.bite1R > 0.01) {
		const db1 = Math.hypot(lx - f.bite1X, cy - f.bite1Y) - f.bite1R;
		dFinal = Math.max(dFinal, -db1);
	}
	if (f.bite2R > 0.01) {
		const db2 = Math.hypot(lx - f.bite2X, cy - f.bite2Y) - f.bite2R;
		dFinal = Math.max(dFinal, -db2);
	}

	// Subtle organic edge roughness so every flame feels hand-drawn & asymmetric
	const rough = (valueNoise2D(lx * 7.0 + f.seed * 13.7, cy * 7.0 - tSec * 4.2) - 0.5) * 0.028;
	return dFinal + rough;
}

/**
 * Generates deterministic multi-scale 2D anime flame sprites for the current timestamp:
 * - Central turbulent eruption cluster around the frame (0.45–4.0s)
 * - Full-screen multi-scale radially-exploding branching flames (0.7–5.2s)
 * - Fast detached small flame fragments & droplets (0.8–5.4s)
 * - Clean outer-edge licking flames during the hold (2.8–15.0s, never boxing the frame)
 */
function buildAnimeFlameField(
	tSec: number,
	totalSec: number,
	aspect: number,
	normInt: number,
): AnimeFlameInstance[] {
	const s = totalSec / 15;
	const instances: AnimeFlameInstance[] = [];

	// 1. CENTRAL TURBULENT ERUPTION CLUSTER (9 asymmetric overlapping flames churning across the frame — ZERO hollow ring!)
	const centerLife = smoothstep(0.35 * s, 1.3 * s, tSec) * (1 - smoothstep(2.9 * s, 4.3 * s, tSec));
	if (centerLife > 0.05) {
		const eruptP = smoothstep(0.4 * s, 4.2 * s, tSec);
		for (let i = 0; i < 9; i++) {
			const r0 = seededRand(i * 11.3 + 1.1);
			const r1 = seededRand(i * 17.7 + 2.3);
			const r2 = seededRand(i * 23.1 + 3.7);
			const r3 = seededRand(i * 29.9 + 5.1);
			// Asymmetric clumped offsets (3 flames right across center-right, 6 bursting irregularly)
			const isCoreMass = i < 4;
			const baseAng = (r0 * Math.PI * 2) + (i * 0.9);
			const radialDist = isCoreMass
				? (0.01 + r1 * 0.07) + eruptP * (0.06 + r2 * 0.14)
				: (0.07 + r1 * 0.14) + eruptP * (0.18 + r2 * 0.34);
			const driftAng = baseAng + (r3 - 0.5) * 1.1 * eruptP;
			// Slight right bias on core mass so left side of glowing frame peeks out first (matching ref f_04!)
			const x = Math.cos(driftAng) * radialDist * 1.15 + (isCoreMass ? 0.045 : (r0 - 0.5) * 0.10);
			const y = Math.sin(driftAng) * radialDist * 0.86 + (r1 - 0.5) * 0.08;
			const lifeScale = Math.pow(centerLife, 0.55);
			const len = (isCoreMass ? 0.24 + r2 * 0.14 : 0.18 + r2 * 0.16) * (0.76 + 0.38 * Math.sin(eruptP * Math.PI)) * lifeScale * (0.86 + 0.25 * normInt);
			const thick = (isCoreMass ? 0.18 + r1 * 0.09 : 0.13 + r1 * 0.07) * lifeScale;
			const side = r0 > 0.5 ? 1 : -1;
			const b1r = 0.11 + r1 * 0.05;
			const b2r = 0.08 + r0 * 0.04;
			instances.push({
				x,
				y,
				angle: (r3 * Math.PI * 2) - 0.4,
				length: len,
				thickness: thick,
				curvature: side * (0.34 + r2 * 0.36),
				hasFork: i % 2 === 0,
				forkDir: r1 > 0.5 ? 1 : -1,
				bite1X: -0.06 + r2 * 0.18,
				bite1Y: side * (thick * 0.85 + b1r * 0.78),
				bite1R: b1r,
				bite2X: 0.16 + r3 * 0.12,
				bite2Y: -side * (thick * 0.75 + b2r * 0.78),
				bite2R: b2r,
				alpha: 1.0,
				seed: i * 1.37 + 0.5,
			});
		}
	}

	// 2. FULL-SCREEN MULTI-SCALE TURBULENT EXPLOSION FLAMES (22 sleek large & medium hooked tongues across ALL quadrants)
	const burstLife = smoothstep(0.65 * s, 1.75 * s, tSec) * (1 - smoothstep(3.15 * s, 5.0 * s, tSec));
	if (burstLife > 0.05) {
		const bp = smoothstep(0.65 * s, 5.0 * s, tSec);
		for (let i = 0; i < 22; i++) {
			const r0 = seededRand(i * 13.7 + 41.2);
			const r1 = seededRand(i * 19.3 + 53.8);
			const r2 = seededRand(i * 31.1 + 67.4);
			const r3 = seededRand(i * 37.9 + 79.1);
			const ang = (i / 22) * Math.PI * 2 + (r0 - 0.5) * 0.42;
			const startR = 0.14 + r1 * 0.28;
			const speed = 0.45 + r2 * 0.65;
			const rad = startR + bp * speed;
			const x = Math.cos(ang) * rad * (0.96 + aspect * 0.18) + (r3 - 0.5) * 0.12;
			const y = Math.sin(ang) * rad * 0.84 + (r0 - 0.5) * 0.09;

			const indivLife =
				smoothstep(0.0, 0.20, bp + r1 * 0.12) *
				(1 - smoothstep(0.60 + r2 * 0.28, 1.0, bp));
			const effLife = burstLife * indivLife;
			if (effLife <= 0.06) continue;

			const lifeScale = Math.pow(effLife, 0.55);
			const isLarge = i % 3 === 0;
			const len = (isLarge ? 0.28 + r2 * 0.18 : 0.14 + r2 * 0.12) * lifeScale * (0.85 + 0.28 * normInt);
			const thick = (isLarge ? 0.13 + r1 * 0.07 : 0.12 + r1 * 0.07) * lifeScale;
			const side = r3 > 0.5 ? 1 : -1;
			const b1r = 0.10 + r2 * 0.05;
			const b2r = isLarge ? 0.08 + r3 * 0.04 : 0;
			const flameAng = ang + (r3 - 0.5) * 1.45 - 0.25;
			instances.push({
				x,
				y,
				angle: flameAng,
				length: len,
				thickness: thick,
				curvature: (r0 > 0.5 ? 1 : -1) * (0.28 + r3 * 0.36),
				hasFork: isLarge || i % 3 === 1,
				forkDir: r2 > 0.5 ? 1 : -1,
				bite1X: -0.05 + r1 * 0.18,
				bite1Y: side * (thick * 0.85 + b1r * 0.78),
				bite1R: b1r,
				bite2X: 0.16 + r0 * 0.12,
				bite2Y: -side * (thick * 0.75 + b2r * 0.78),
				bite2R: b2r,
				alpha: 1.0,
				seed: 100 + i * 2.13,
			});
		}
	}

	// 3. SMALL DETACHED FLYING FLAME FRAGMENTS & DROPLETS (22 clean, solid curved teardrops — ZERO eyeball holes!)
	const fragLife = smoothstep(0.8 * s, 1.8 * s, tSec) * (1 - smoothstep(3.4 * s, 5.4 * s, tSec));
	if (fragLife > 0.05) {
		const fp = smoothstep(0.8 * s, 5.4 * s, tSec);
		for (let i = 0; i < 22; i++) {
			const r0 = seededRand(i * 43.1 + 101.5);
			const r1 = seededRand(i * 59.7 + 127.3);
			const r2 = seededRand(i * 67.3 + 149.9);
			const ang = (i / 22) * Math.PI * 2 + (r0 - 0.5) * 0.55;
			const rad = 0.16 + r1 * 0.36 + fp * (0.52 + r2 * 0.58);
			const x = Math.cos(ang) * rad * (0.92 + aspect * 0.18);
			const y = Math.sin(ang) * rad * 0.86;
			const effLife = fragLife * (1 - smoothstep(0.68, 1.0, fp));
			if (effLife <= 0.06) continue;
			const lifeScale = Math.pow(effLife, 0.55);
			instances.push({
				x,
				y,
				angle: ang + (r2 - 0.5) * 1.6,
				length: (0.065 + r1 * 0.065) * lifeScale * (0.85 + 0.25 * normInt),
				thickness: (0.16 + r0 * 0.08) * lifeScale,
				curvature: (r1 > 0.5 ? 1 : -1) * (0.22 + r2 * 0.28),
				hasFork: false,
				forkDir: 1,
				bite1X: 0,
				bite1Y: 0,
				bite1R: 0,
				bite2X: 0,
				bite2Y: 0,
				bite2R: 0,
				alpha: 1.0,
				seed: 200 + i * 3.17,
			});
		}
	}

	// 4. OUTER-EDGE ANIME HOLD FLAMES (16 sleek separated flames licking along screen perimeter & corners!)
	const holdLife = smoothstep(2.8 * s, 4.5 * s, tSec);
	if (holdLife > 0.05) {
		const halfWWorld = aspect * 0.5;
		const halfHWorld = 0.5;
		for (let i = 0; i < 16; i++) {
			const r0 = seededRand(i * 71.3 + 211.7);
			const r1 = seededRand(i * 83.9 + 233.1);
			const r2 = seededRand(i * 97.1 + 257.9);
			const edge = i % 4;
			const cycle = ((tSec * (0.16 + r0 * 0.12) + r1) % 1);
			const fade = Math.sin(cycle * Math.PI);
			const effLife = holdLife * fade;
			if (effLife <= 0.06) continue;

			let x = 0;
			let y = 0;
			let ang = 0;
			const slide = (r2 * 1.6 - 0.8) + (cycle - 0.5) * 0.28;
			if (edge === 0) {
				x = slide * halfWWorld * 0.96;
				y = -halfHWorld + 0.02 + cycle * 0.05;
				ang = Math.PI * 0.35 + (r0 - 0.5) * 0.9;
			} else if (edge === 1) {
				x = slide * halfWWorld * 0.96;
				y = halfHWorld - 0.01 - cycle * 0.05;
				ang = -Math.PI * 0.42 + (r0 - 0.5) * 0.9;
			} else if (edge === 2) {
				x = -halfWWorld + 0.02 + cycle * 0.06;
				y = slide * halfHWorld * 0.92;
				ang = -0.35 + (r0 - 0.5) * 0.85;
			} else {
				x = halfWWorld - 0.02 - cycle * 0.06;
				y = slide * halfHWorld * 0.92;
				ang = Math.PI + 0.35 + (r0 - 0.5) * 0.85;
			}

			const lifeScale = Math.pow(effLife, 0.55);
			const isSmallDrop = i >= 10;
			const thick = (isSmallDrop ? 0.18 + r0 * 0.07 : 0.13 + r1 * 0.07) * lifeScale;
			const side = r1 > 0.5 ? 1 : -1;
			const b1r = isSmallDrop ? 0 : 0.10 + r2 * 0.05;
			instances.push({
				x,
				y,
				angle: ang,
				length: (isSmallDrop ? 0.065 + r1 * 0.055 : 0.20 + r2 * 0.15) * lifeScale * (0.85 + 0.25 * normInt),
				thickness: thick,
				curvature: side * (0.28 + r0 * 0.30),
				hasFork: !isSmallDrop && i % 2 === 0,
				forkDir: r2 > 0.5 ? 1 : -1,
				bite1X: -0.04 + r0 * 0.16,
				bite1Y: side * (thick * 0.85 + b1r * 0.78),
				bite1R: b1r,
				bite2X: 0,
				bite2Y: 0,
				bite2R: 0,
				alpha: 1.0,
				seed: 300 + i * 4.19,
			});
		}
	}

	return instances;
}

export interface RenderFlamePackFrameInput {
	variant: FlamePackVariant;
	width: number;
	height: number;
	tSec: number;
	keyframes: OutroKeyframeSchedule;
	intensity: number; // 0..100
	palette: FireShaderPaletteRgb;
	/** Optional pre-positioned RGBA logo buffer (`width * height * 4`) centered on the frame. */
	logoRgba?: Uint8Array | null;
	outRgba: Uint8Array;
}

/**
 * Renders one deterministic frame of the 4-option Flame Logo Pack:
 * - Deep pitch-black void with subtle twinkling micro-sparks.
 * - Crisp glowing thin-bordered frame (`flame_wide`, `flame_banner`, `flame_squircle`, `flame_circle`).
 * - Volumetric 2D FBM fluid fire burning INSIDE the glowing frame behind the user's logo.
 * - Sharp 2-tone cel-shaded flying anime flame wisps bursting outward on reveal & drifting at the edges.
 */
export function renderFlamePackFrameRgba(input: RenderFlamePackFrameInput): void {
	const { variant, width, height, tSec, keyframes, intensity, palette, logoRgba, outRgba } = input;
	const normInt = clamp01(intensity / 100);
	const power = 0.65 + 0.65 * normInt;
	const totalSec = keyframes.totalDurationSec;
	const aspect = width / height;
	const isVertical = height > width;

	const masterFade =
		smoothstep(0, 0.45, tSec) * (1 - smoothstep(totalSec - 0.95, totalSec, tSec));

	// Frame center (slightly above vertical midpoint to leave clean room for channel title & subtitle)
	const cx = 0.5;
	const cy = isVertical ? 0.42 : 0.45;

	// Aspect-normalized SDF half-extents for each of the 4 exact options
	let halfW = 0.38;
	let halfH = 0.13;
	let cornerR = 0.032;
	let isCircle = false;
	let circleR = 0.17;

	if (variant === 'flame_wide') {
		halfW = isVertical ? 0.24 : 0.41;
		halfH = isVertical ? 0.085 : 0.115;
		cornerR = 0.036;
	} else if (variant === 'flame_banner') {
		halfW = isVertical ? 0.24 : 0.42;
		halfH = isVertical ? 0.08 : 0.105;
		cornerR = 0.030;
	} else if (variant === 'flame_squircle') {
		halfW = isVertical ? 0.155 : 0.165;
		halfH = isVertical ? 0.155 : 0.165;
		cornerR = 0.042;
	} else {
		isCircle = true;
		circleR = isVertical ? 0.155 : 0.175;
	}

	// Timeline choreography (scaled proportionally to duration):
	// 0.0–0.8s: dark starry void (nothing revealed yet)
	// 0.8–2.8s: swirling 2D cel-shaded fire vortex ERUPTS RIGHT AT THE CENTER, engulfing the logo area
	// 2.6–4.8s: central fire parts & explodes outward, LITERALLY UNCOVERING the glowing frame + logo behind it!
	// 4.8–15s:  hero hold with interior volumetric fire + sleek cel-shaded wisps drifting at edges
	const s = totalSec / 15;
	const vortexIgnition = smoothstep(0.5 * s, 1.8 * s, tSec);
	const vortexDissipate = 1 - smoothstep(2.6 * s, 4.4 * s, tSec);
	const centralVortexWeight = vortexIgnition * vortexDissipate;

	// Outward expanding reveal front: parts the fire from center (r=0) outward (r=0.95)
	const revealFrontRadius = smoothstep(1.75 * s, 4.2 * s, tSec) * 0.95;
	const burstRingWeight =
		smoothstep(1.8 * s, 2.8 * s, tSec) * (1 - smoothstep(3.4 * s, 5.2 * s, tSec));

	const logoSlideOffsetPx =
		variant === 'flame_banner'
			? Math.round((1 - smoothstep(2.6 * s, 4.6 * s, tSec)) * height * 0.14)
			: 0;

	const riseT = tSec * (1.8 + 0.55 * normInt);
	const swirlT = tSec * 1.45;

	// Precompute 28 subtle background micro-sparks/stars in the black void
	const starCount = 28;
	const starX = new Float32Array(starCount);
	const starY = new Float32Array(starCount);
	const starA = new Float32Array(starCount);
	for (let i = 0; i < starCount; i++) {
		starX[i] = ((i * 0.6180339 + 0.07) % 0.94) + 0.03;
		starY[i] = (((i * 0.381966 + 0.13) - tSec * (0.012 + (i % 4) * 0.004)) % 1 + 1) % 1;
		starA[i] = (0.28 + 0.55 * (0.5 + 0.5 * Math.sin(tSec * (2.5 + (i % 5)) + i * 1.9)));
	}

	let idx = 0;
	for (let y = 0; y < height; y++) {
		const v = y / height;
		for (let x = 0; x < width; x++) {
			const u = x / width;
			const dx = (u - cx) * aspect;
			const dy = v - cy;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const angle = Math.atan2(dy, dx);

			// SDF of the glowing container
			const d = isCircle
				? dist - circleR
				: sdRoundedBox(dx, dy, halfW, halfH, cornerR);

			// Pitch-black clean background void (#050608)
			let r = 5;
			let g = 6;
			let b = 8;

			// Domain-warped FBM for organic flame wisps & interior fire
			const nx = u * (isVertical ? 4.2 : 5.2);
			const ny = v * (isVertical ? 6.0 : 4.0);
			const wx = fbm4(nx * 0.85, ny * 0.85 + riseT * 0.7) - 0.5;
			const wy = fbm4(nx * 0.85 + 4.7, ny * 0.85 + 1.9 + riseT * 0.85) - 0.5;
			const turb = fbm4(nx + wx * 2.25, ny + riseT + wy * 1.75);

			// Organic fire-parting reveal mask: frame & logo ONLY become visible AFTER the central fire parts!
			const revealMask = smoothstep(dist - 0.12, dist + 0.08, revealFrontRadius + (turb - 0.5) * 0.22);

			// 1. INTERIOR VOLUMETRIC FIRE + USER LOGO (uncovered behind the parting flames!)
			if (d < 0 && revealMask > 0.01) {
				const innerNormY = clamp01((dy + (isCircle ? circleR : halfH)) / Math.max(0.05, 2 * (isCircle ? circleR : halfH)));
				const bottomBias = variant === 'flame_circle'
					? 0.38 + 0.42 * Math.sin(angle + swirlT)
					: Math.pow(innerNormY, 1.95) * 0.82;
				const innerTemp = clamp01((bottomBias + (turb - 0.48) * 0.88) * power) * revealMask;
				if (innerTemp > 0.18) {
					const ia = smoothstep(0.18, 0.62, innerTemp);
					const hot = smoothstep(0.62, 0.96, innerTemp);
					const fr = lerp(palette.primary[0] * 0.45, lerp(palette.energy[0], 255, hot * 0.28), ia);
					const fg = lerp(palette.primary[1] * 0.45, lerp(palette.energy[1], 255, hot * 0.28), ia);
					const fb = lerp(palette.primary[2] * 0.45, lerp(palette.energy[2], 255, hot * 0.28), ia);
					r = lerp(r, fr, ia * 0.82);
					g = lerp(g, fg, ia * 0.82);
					b = lerp(b, fb, ia * 0.82);
				}

				// Clipped User Logo inside the frame (revealed strictly by the parting fire!)
				if (logoRgba) {
					const sy = y + logoSlideOffsetPx;
					if (sy >= 0 && sy < height) {
						const lIdx = (sy * width + x) * 4;
						const la = (logoRgba[lIdx + 3]! / 255) * revealMask;
						if (la > 0.02) {
							r = r * (1 - la) + logoRgba[lIdx]! * la;
							g = g * (1 - la) + logoRgba[lIdx + 1]! * la;
							b = b * (1 - la) + logoRgba[lIdx + 2]! * la;
						}
					}
				}
			}

			// 2. CRISP GLOWING THIN NEON BORDER + SOFT OUTER HALO (uncovered by parting fire)
			if (revealMask > 0.01) {
				const absD = Math.abs(d);
				const borderLine = Math.exp(-Math.pow(absD / 0.0036, 2)) * revealMask;
				const outerHalo = Math.exp(-absD / 0.032) * 0.36 * revealMask * power;
				r += lerp(palette.glow[0], 255, 0.82) * borderLine + palette.energy[0] * outerHalo;
				g += lerp(palette.glow[1], 255, 0.82) * borderLine + palette.energy[1] * outerHalo;
				b += lerp(palette.glow[2], 255, 0.82) * borderLine + palette.energy[2] * outerHalo;
			}

			// 3. Subtle twinkling micro-stars in the black void (outside frame)
			if (d > 0.02) {
				for (let sIdx = 0; sIdx < starCount; sIdx++) {
					const sdx = (u - starX[sIdx]!) * aspect;
					const sdy = v - starY[sIdx]!;
					const sd2 = sdx * sdx + sdy * sdy;
					if (sd2 < 0.000018) {
						const sp = Math.exp(-sd2 / 0.0000045) * starA[sIdx]!;
						r += lerp(palette.glow[0], 255, 0.7) * sp;
						g += lerp(palette.glow[1], 255, 0.7) * sp;
						b += lerp(palette.glow[2], 255, 0.7) * sp;
					}
				}
			}

			outRgba[idx] = Math.max(0, Math.min(255, Math.round(r * masterFade)));
			outRgba[idx + 1] = Math.max(0, Math.min(255, Math.round(g * masterFade)));
			outRgba[idx + 2] = Math.max(0, Math.min(255, Math.round(b * masterFade)));
			outRgba[idx + 3] = 255;
			idx += 4;
		}
	}

	// 4. FOREGROUND 2D ANIME SAKUGA FLAME LAYER (AABB-accelerated curved sickles + forks + concave bites)
	// Drawn ON TOP of the base frame so turbulent multi-scale anime flames erupt, scatter, and uncover the logo!
	const flames = buildAnimeFlameField(tSec, totalSec, aspect, normInt);
	if (flames.length > 0 && masterFade > 0.01) {
		const flameBuf = new Float32Array(width * height);
		let minDirtyX = width;
		let maxDirtyX = -1;
		let minDirtyY = height;
		let maxDirtyY = -1;

		for (let fi = 0; fi < flames.length; fi++) {
			const f = flames[fi]!;
			const cosA = Math.cos(-f.angle);
			const sinA = Math.sin(-f.angle);
			const invLen = 1 / Math.max(0.02, f.length);
			// Generous AABB around the curved/forked flame in world units
			const boundR = f.length * 0.92;
			const x0 = Math.max(0, Math.floor(((f.x - boundR) / aspect + cx) * width));
			const x1 = Math.min(width - 1, Math.ceil(((f.x + boundR) / aspect + cx) * width));
			const y0 = Math.max(0, Math.floor((f.y - boundR + cy) * height));
			const y1 = Math.min(height - 1, Math.ceil((f.y + boundR + cy) * height));
			if (x0 > x1 || y0 > y1) continue;

			if (x0 < minDirtyX) minDirtyX = x0;
			if (x1 > maxDirtyX) maxDirtyX = x1;
			if (y0 < minDirtyY) minDirtyY = y0;
			if (y1 > maxDirtyY) maxDirtyY = y1;

			for (let py = y0; py <= y1; py++) {
				const wy = py / height - cy - f.y;
				const rowOff = py * width;
				for (let px = x0; px <= x1; px++) {
					const wx = (px / width - cx) * aspect - f.x;
					const lx = (wx * cosA - wy * sinA) * invLen;
					const ly = (wx * sinA + wy * cosA) * invLen;
					const dF = evalAnimeFlameSdf(lx, ly, f, tSec);
					if (dF < 0.14) {
						// Map SDF (< 0 inside, > 0 outside) into smooth field for cel-shading + subtle glow
						const val = clamp01((0.14 - dF) / 0.28) * f.alpha;
						const pIdx = rowOff + px;
						if (val > flameBuf[pIdx]!) {
							flameBuf[pIdx] = val;
						}
					}
				}
			}
		}

		// Composite merged 2D anime cel-shaded flames with 3 crisp color bands + subtle tight glow
		if (maxDirtyX >= minDirtyX && maxDirtyY >= minDirtyY) {
			const bodyR = lerp(palette.glow[0], 255, 0.48);
			const bodyG = lerp(palette.glow[1], 255, 0.48);
			const bodyB = lerp(palette.glow[2], 255, 0.48);

			for (let py = minDirtyY; py <= maxDirtyY; py++) {
				const rowOff = py * width;
				for (let px = minDirtyX; px <= maxDirtyX; px++) {
					const val = flameBuf[rowOff + px]!;
					if (val <= 0.08) continue;

					// 0.50 = exact SDF zero-crossing (dF = 0)
					const celAura = smoothstep(0.16, 0.48, val) * 0.11;
					const celOuter = smoothstep(0.47, 0.505, val);
					const celBody = smoothstep(0.515, 0.555, val);
					const celHot = smoothstep(0.74, 0.90, val);

					const oIdx = (rowOff + px) * 4;
					let r = outRgba[oIdx]!;
					let g = outRgba[oIdx + 1]!;
					let b = outRgba[oIdx + 2]!;

					if (celAura > 0.01) {
						r += palette.energy[0] * celAura * masterFade;
						g += palette.energy[1] * celAura * masterFade;
						b += palette.energy[2] * celAura * masterFade;
					}
					if (celOuter > 0.01) {
						const rimToBodyR = lerp(palette.energy[0], bodyR, celBody);
						const rimToBodyG = lerp(palette.energy[1], bodyG, celBody);
						const rimToBodyB = lerp(palette.energy[2], bodyB, celBody);
						const wr = lerp(rimToBodyR, 255, celHot * 0.65) * masterFade;
						const wg = lerp(rimToBodyG, 255, celHot * 0.65) * masterFade;
						const wb = lerp(rimToBodyB, 255, celHot * 0.65) * masterFade;
						r = lerp(r, wr, celOuter * 0.98);
						g = lerp(g, wg, celOuter * 0.98);
						b = lerp(b, wb, celOuter * 0.98);
					}

					outRgba[oIdx] = Math.max(0, Math.min(255, Math.round(r)));
					outRgba[oIdx + 1] = Math.max(0, Math.min(255, Math.round(g)));
					outRgba[oIdx + 2] = Math.max(0, Math.min(255, Math.round(b)));
				}
			}
		}
	}
}
