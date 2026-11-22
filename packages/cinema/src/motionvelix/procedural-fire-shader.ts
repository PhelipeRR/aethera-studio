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
