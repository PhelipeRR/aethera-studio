/**
 * MotionVelix MOGRT Engine: Fractal Noise, Turbulent Displace and Displacement Map.
 *
 * Adobe does not publish the noise of the first two, so they use a gradient noise of their own: the
 * scale, direction and timing follow the parameters, the pattern does not match After Effects.
 */

import type { Vec2 } from './aep-binary.js';
import type { RgbaBuffer } from './mogrt-effects-pipeline.js';
import { addSample, toPremultiplied, writePremultiplied } from './mogrt-sampling.js';

/** Degrees of Evolution per lattice step. */
const EVOLUTION_STEP_DEG = 120;
/** Displacement at 100% Amount, as a share of Size. */
const DISPLACE_REACH = 0.5;
/** Pinning fades in over this many reaches. */
const PIN_REACHES = 3;
/** Sharpens the ridge that the noise's zero crossings form in the Strings fractal. */
const STRINGS_GAIN = 1.7;
const GRADIENT_STEP = 0.25;

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function gradient(ix: number, iy: number, iz: number, seed: number, x: number, y: number, z: number): number {
	let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1440662683) ^ Math.imul(seed, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1103515245);
	h = (h ^ (h >>> 16)) & 15;
	const u = h < 8 ? x : y;
	const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
	return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

/** Improved Perlin noise, roughly -1..1. */
function noise3(x: number, y: number, z: number, seed: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const iz = Math.floor(z);
	const fx = x - ix;
	const fy = y - iy;
	const fz = z - iz;
	const u = fade(fx);
	const v = fade(fy);
	const plane = (k: number): number => {
		const a = gradient(ix, iy, iz + k, seed, fx, fy, fz - k);
		const b = gradient(ix + 1, iy, iz + k, seed, fx - 1, fy, fz - k);
		const c = gradient(ix, iy + 1, iz + k, seed, fx, fy - 1, fz - k);
		const d = gradient(ix + 1, iy + 1, iz + k, seed, fx - 1, fy - 1, fz - k);
		const top = a + (b - a) * u;
		return top + (c + (d - c) * u - top) * v;
	};
	const near = plane(0);
	return near + (plane(1) - near) * fade(fz);
}

/** Octaves of noise. A fractional `complexity` fades the last one in. */
function fractalSum(x: number, y: number, z: number, seed: number, complexity: number, gain = 0.5, shrink = 0.5): number {
	let sum = 0;
	let total = 0;
	let weight = 1;
	let frequency = 1;
	for (let octave = 0; octave < complexity; octave++) {
		const share = weight * Math.min(1, complexity - octave);
		// The shift keeps the octaves' lattice zeros from lining up.
		const shift = octave * 5.31;
		sum += share * noise3(x * frequency + shift, y * frequency + shift, z + shift, seed);
		total += share;
		weight *= gain;
		frequency /= shrink;
	}
	return total > 0 ? sum / total : 0;
}

export interface FractalNoiseOptions {
	fractal: 'strings';
	invert: boolean;
	contrast: number;
	brightness: number;
	/** Buffer pixels. */
	cellWidth: number;
	cellHeight: number;
	rotationDeg: number;
	/** Buffer pixels. */
	offset: Vec2;
	complexity: number;
	/** 0..1 */
	subInfluence: number;
	/** 0..1 */
	subScaling: number;
	evolutionDeg: number;
	seed: number;
	/** 0..1 */
	opacity: number;
}

/** Replaces the colour and keeps the alpha, as the effect's Normal blending mode does. */
export function applyEffectFractalNoise(buffer: RgbaBuffer, options: FractalNoiseOptions): void {
	const { invert, offset, opacity } = options;
	const contrast = options.contrast / 100;
	const brightness = options.brightness / 100;
	const cellWidth = Math.max(0.5, options.cellWidth);
	const cellHeight = Math.max(0.5, options.cellHeight);
	const angle = (options.rotationDeg * Math.PI) / 180;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const complexity = Math.min(10, Math.max(1, options.complexity));
	const shrink = Math.max(0.1, options.subScaling);
	const z = options.evolutionDeg / EVOLUTION_STEP_DEG;
	const seed = Math.floor(options.seed);
	const { width, height, data } = buffer;

	for (let y = 0; y < height; y++) {
		const py = y + 0.5 - offset.y;
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			if (data[o + 3] === 0) continue;
			const px = x + 0.5 - offset.x;
			const u = (px * cos + py * sin) / cellWidth;
			const v = (py * cos - px * sin) / cellHeight;
			const sum = fractalSum(u, v, z, seed, complexity, options.subInfluence, shrink);
			let level = (1 - Math.min(1, Math.abs(sum * STRINGS_GAIN))) ** 2;
			if (invert) level = 1 - level;
			const value = Math.min(1, Math.max(0, (level - 0.5) * contrast + 0.5 + brightness)) * 255;
			for (let k = o; k < o + 3; k++) data[k] = Math.round(data[k]! + (value - data[k]!) * opacity);
		}
	}
}

export type TurbulentDisplaceKind = 'turbulent' | 'bulge' | 'twist' | 'vertical' | 'horizontal';

export interface TurbulentDisplaceOptions {
	kind: TurbulentDisplaceKind;
	amount: number;
	/** Layer pixels. */
	size: number;
	complexity: number;
	evolutionDeg: number;
	seed: number;
	/** Buffer pixels. */
	offset: Vec2;
	/** Buffer pixels per layer pixel. */
	scale: number;
	padding: number;
	/** Hold the layer's border. */
	pinned: boolean;
}

/** The farthest a pixel can move, in layer pixels. */
export function turbulentDisplaceReach(amount: number, size: number): number {
	return (Math.abs(amount) / 100) * size * DISPLACE_REACH;
}

export function applyEffectTurbulentDisplace(buffer: RgbaBuffer, options: TurbulentDisplaceOptions): void {
	const { kind, amount, offset, scale, padding, pinned } = options;
	const reach = turbulentDisplaceReach(amount, options.size) * scale;
	if (reach === 0) return;
	const strength = Math.sign(amount) * reach;
	const cell = Math.max(0.5, options.size * scale);
	const complexity = Math.min(10, Math.max(1, options.complexity));
	const z = options.evolutionDeg / EVOLUTION_STEP_DEG;
	const seed = Math.floor(options.seed);
	const { width, height, data } = buffer;

	// Pixels farther than the reach from anything visible stay transparent.
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (data[(y * width + x) * 4 + 3] === 0) continue;
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = y;
		}
	}
	if (x1 < 0) return;
	const room = Math.ceil(reach) + 1;
	x0 = Math.max(0, x0 - room);
	y0 = Math.max(0, y0 - room);
	x1 = Math.min(width - 1, x1 + room);
	y1 = Math.min(height - 1, y1 + room);

	const source = toPremultiplied(buffer);
	const out = new Float32Array(source.length);
	const clamp = (value: number): number => Math.min(1, Math.max(-1, value));
	for (let y = y0; y <= y1; y++) {
		const v = (y + 0.5 - offset.y) / cell;
		for (let x = x0; x <= x1; x++) {
			const u = (x + 0.5 - offset.x) / cell;
			let dx = 0;
			let dy = 0;
			if (kind === 'bulge' || kind === 'twist') {
				const here = fractalSum(u, v, z, seed, complexity);
				const alongX = (fractalSum(u + GRADIENT_STEP, v, z, seed, complexity) - here) / GRADIENT_STEP / 2;
				const alongY = (fractalSum(u, v + GRADIENT_STEP, z, seed, complexity) - here) / GRADIENT_STEP / 2;
				dx = clamp(kind === 'bulge' ? alongX : -alongY);
				dy = clamp(kind === 'bulge' ? alongY : alongX);
			} else {
				if (kind !== 'vertical') dx = clamp(fractalSum(u, v, z, seed, complexity));
				if (kind !== 'horizontal') dy = clamp(fractalSum(u + 31.7, v + 17.3, z, seed, complexity));
			}
			let move = strength;
			if (pinned) {
				const inside = Math.min(x - padding, width - 1 - padding - x, y - padding, height - 1 - padding - y);
				move *= Math.min(1, Math.max(0, inside / (reach * PIN_REACHES)));
			}
			addSample(out, (y * width + x) * 4, source, width, height, x + 0.5 - dx * move, y + 0.5 - dy * move);
		}
	}
	writePremultiplied(buffer, out);
}

export type DisplacementChannel = 'red' | 'green' | 'blue' | 'alpha' | 'luma' | 'full' | 'half' | 'off';

export interface DisplacementMapOptions {
	/** `max` is in buffer pixels. */
	horizontal: { channel: DisplacementChannel; max: number };
	vertical: { channel: DisplacementChannel; max: number };
	wrap: boolean;
	/** Where the map lies in the buffer; outside it nothing moves. */
	mapBounds: { x0: number; y0: number; x1: number; y1: number };
}

/** `map` has the buffer's size. Middle grey moves nothing. */
export function applyEffectDisplacementMap(buffer: RgbaBuffer, map: RgbaBuffer, options: DisplacementMapOptions): void {
	const { horizontal, vertical, wrap, mapBounds } = options;
	const { width, height } = buffer;
	const source = toPremultiplied(buffer);
	const out = new Float32Array(source.length);
	const m = map.data;

	const shift = ({ channel, max }: DisplacementMapOptions['horizontal'], o: number): number => {
		if (channel === 'off' || channel === 'half') return 0;
		let value = 255;
		if (channel === 'alpha') value = m[o + 3]!;
		else if (channel !== 'full') {
			if (channel === 'red') value = m[o]!;
			else if (channel === 'green') value = m[o + 1]!;
			else if (channel === 'blue') value = m[o + 2]!;
			else value = 0.2126 * m[o]! + 0.7152 * m[o + 1]! + 0.0722 * m[o + 2]!;
			// A transparent map reads as black.
			value *= m[o + 3]! / 255;
		}
		return ((value - 128) / 128) * max;
	};

	for (let y = 0; y < height; y++) {
		const insideY = y + 0.5 >= mapBounds.y0 && y + 0.5 <= mapBounds.y1;
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			let u = x + 0.5;
			let v = y + 0.5;
			if (insideY && u >= mapBounds.x0 && u <= mapBounds.x1) {
				u -= shift(horizontal, o);
				v -= shift(vertical, o);
				if (wrap) {
					u = ((u % width) + width) % width;
					v = ((v % height) + height) % height;
				}
			}
			addSample(out, o, source, width, height, u, v);
		}
	}
	writePremultiplied(buffer, out);
}
