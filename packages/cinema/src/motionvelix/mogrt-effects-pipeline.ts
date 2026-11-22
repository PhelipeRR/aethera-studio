/**
 * MotionVelix MOGRT Engine: deterministic effects and compositing on straight-alpha RGBA buffers.
 *
 * Fill, Tint, Box Blur, Glow, Drop Shadow, Simple Choker, Noise, Set Matte and Shift Channels
 * reimplement the documented behaviour of the After Effects effects. They are not pixel-identical
 * to Adobe's. Also provides affine compositing with track mattes and blend modes.
 */

import type { AepBlendMode, AepTrackMatteType } from './aep-binary.js';
import type { Affine } from './mogrt-mask-renderer.js';

export interface RgbaBuffer {
	width: number;
	height: number;
	data: Uint8Array;
}

export function createRgbaBuffer(width: number, height: number): RgbaBuffer {
	return { width, height, data: new Uint8Array(width * height * 4) };
}

export function cloneRgbaBuffer(src: RgbaBuffer): RgbaBuffer {
	return { width: src.width, height: src.height, data: new Uint8Array(src.data) };
}

export function fillRgbaSolid(
	buf: RgbaBuffer,
	r: number,
	g: number,
	b: number,
	a = 255,
): void {
	const d = buf.data;
	for (let i = 0; i < d.length; i += 4) {
		d[i] = r;
		d[i + 1] = g;
		d[i + 2] = b;
		d[i + 3] = a;
	}
}

function clampByte(v: number): number {
	return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * 1. ADBE Fill — Replaces RGB channels with `color` while preserving source alpha, blended by `opacity` (0..1).
 */
export function applyEffectFill(
	buf: RgbaBuffer,
	color: [number, number, number],
	opacity = 1,
): void {
	const op = Math.max(0, Math.min(1, opacity));
	if (op <= 0.001) return;
	const inv = 1 - op;
	const d = buf.data;
	const [cr, cg, cb] = color;
	for (let i = 0; i < d.length; i += 4) {
		if (d[i + 3]! === 0) continue;
		d[i] = clampByte(d[i]! * inv + cr * op);
		d[i + 1] = clampByte(d[i + 1]! * inv + cg * op);
		d[i + 2] = clampByte(d[i + 2]! * inv + cb * op);
	}
}

/**
 * 2. ADBE Tint — Maps Rec.709 luminance onto `[mapBlackTo .. mapWhiteTo]` blended by `amount` (0..1).
 */
export function applyEffectTint(
	buf: RgbaBuffer,
	mapBlackTo: [number, number, number],
	mapWhiteTo: [number, number, number],
	amount = 1,
): void {
	const amt = Math.max(0, Math.min(1, amount));
	if (amt <= 0.001) return;
	const inv = 1 - amt;
	const d = buf.data;
	const [br, bg, bb] = mapBlackTo;
	const [wr, wg, wb] = mapWhiteTo;
	for (let i = 0; i < d.length; i += 4) {
		if (d[i + 3]! === 0) continue;
		const r = d[i]!;
		const g = d[i + 1]!;
		const b = d[i + 2]!;
		const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
		const tr = br + (wr - br) * lum;
		const tg = bg + (wg - bg) * lum;
		const tb = bb + (wb - bb) * lum;
		d[i] = clampByte(r * inv + tr * amt);
		d[i + 1] = clampByte(g * inv + tg * amt);
		d[i + 2] = clampByte(b * inv + tb * amt);
	}
}

/**
 * Fast O(1)-per-pixel separable horizontal + vertical box blur on premultiplied RGBA float buffers.
 */
function boxBlurPassFloat(
	src: Float32Array,
	tmp: Float32Array,
	dst: Float32Array,
	width: number,
	height: number,
	radius: number,
): void {
	const r = Math.max(1, Math.round(radius));
	const win = 2 * r + 1;
	const invWin = 1 / win;

	// Horizontal pass
	for (let y = 0; y < height; y++) {
		const rowOff = y * width * 4;
		let s0 = 0;
		let s1 = 0;
		let s2 = 0;
		let s3 = 0;
		for (let k = -r; k <= r; k++) {
			const cx = k < 0 ? 0 : k >= width ? width - 1 : k;
			const o = rowOff + cx * 4;
			s0 += src[o]!;
			s1 += src[o + 1]!;
			s2 += src[o + 2]!;
			s3 += src[o + 3]!;
		}
		for (let x = 0; x < width; x++) {
			const outO = rowOff + x * 4;
			tmp[outO] = s0 * invWin;
			tmp[outO + 1] = s1 * invWin;
			tmp[outO + 2] = s2 * invWin;
			tmp[outO + 3] = s3 * invWin;

			const remX = Math.max(0, x - r);
			const addX = Math.min(width - 1, x + r + 1);
			const ro = rowOff + remX * 4;
			const ao = rowOff + addX * 4;
			s0 += src[ao]! - src[ro]!;
			s1 += src[ao + 1]! - src[ro + 1]!;
			s2 += src[ao + 2]! - src[ro + 2]!;
			s3 += src[ao + 3]! - src[ro + 3]!;
		}
	}

	// Vertical pass
	for (let x = 0; x < width; x++) {
		let s0 = 0;
		let s1 = 0;
		let s2 = 0;
		let s3 = 0;
		for (let k = -r; k <= r; k++) {
			const cy = k < 0 ? 0 : k >= height ? height - 1 : k;
			const o = (cy * width + x) * 4;
			s0 += tmp[o]!;
			s1 += tmp[o + 1]!;
			s2 += tmp[o + 2]!;
			s3 += tmp[o + 3]!;
		}
		for (let y = 0; y < height; y++) {
			const outO = (y * width + x) * 4;
			dst[outO] = s0 * invWin;
			dst[outO + 1] = s1 * invWin;
			dst[outO + 2] = s2 * invWin;
			dst[outO + 3] = s3 * invWin;

			const remY = Math.max(0, y - r);
			const addY = Math.min(height - 1, y + r + 1);
			const ro = (remY * width + x) * 4;
			const ao = (addY * width + x) * 4;
			s0 += tmp[ao]! - tmp[ro]!;
			s1 += tmp[ao + 1]! - tmp[ro + 1]!;
			s2 += tmp[ao + 2]! - tmp[ro + 2]!;
			s3 += tmp[ao + 3]! - tmp[ro + 3]!;
		}
	}
}

/**
 * 3. ADBE Box Blur2 / Gaussian Blur — Separable multi-iteration premultiplied RGBA blur.
 */
export function applyEffectBoxBlur(
	buf: RgbaBuffer,
	radiusPx: number,
	iterations = 2,
): void {
	const r = Math.min(512, Math.max(0, Math.round(radiusPx)));
	if (r < 1) return;
	const iters = Math.max(1, Math.min(10, Math.round(iterations)));
	const { width, height, data } = buf;
	const n = width * height * 4;
	const fA = new Float32Array(n);
	const fTmp = new Float32Array(n);
	const fB = new Float32Array(n);

	// Premultiply alpha before blur to avoid dark fringe artifacts
	for (let i = 0; i < n; i += 4) {
		const a = data[i + 3]! / 255;
		fA[i] = data[i]! * a;
		fA[i + 1] = data[i + 1]! * a;
		fA[i + 2] = data[i + 2]! * a;
		fA[i + 3] = data[i + 3]!;
	}

	let src = fA;
	let dst = fB;
	for (let it = 0; it < iters; it++) {
		boxBlurPassFloat(src, fTmp, dst, width, height, r);
		const swap = src;
		src = dst;
		dst = swap;
	}

	// Unpremultiply back into Uint8Array
	for (let i = 0; i < n; i += 4) {
		const aByte = src[i + 3]!;
		const a = aByte / 255;
		if (a > 0.004) {
			data[i] = clampByte(src[i]! / a);
			data[i + 1] = clampByte(src[i + 1]! / a);
			data[i + 2] = clampByte(src[i + 2]! / a);
			data[i + 3] = clampByte(aByte);
		} else {
			data[i] = 0;
			data[i + 1] = 0;
			data[i + 2] = 0;
			data[i + 3] = 0;
		}
	}
}

export interface GlowOptions {
	/** Luminance threshold in 0..100 (AE Glow Threshold %, default 50). */
	thresholdPct?: number;
	/** Glow radius in pixels (default 14). */
	radiusPx?: number;
	/** Glow intensity multiplier (default 1.0). */
	intensity?: number;
	/** Optional custom glow tint RGB (when AE Glow Colors = A & B Colors). */
	tintColor?: [number, number, number];
	/** `add` brightens the layer; `behind` only shows where the layer is transparent. */
	composite?: 'add' | 'behind';
}

/**
 * 4. ADBE Glo2 (Glow) — Thresholds bright pixels, applies 3-pass Gaussian-like separable bloom,
 * optionally tints with custom glow color, and composites additively back onto source.
 */
export function applyEffectGlow(buf: RgbaBuffer, opts: GlowOptions = {}): void {
	const radius = Math.min(512, Math.max(1, Math.round(opts.radiusPx ?? 14)));
	const intensity = Math.max(0, opts.intensity ?? 1.0);
	if (intensity <= 0.001) return;
	const threshold = Math.max(0, Math.min(1, (opts.thresholdPct ?? 50) / 100));
	const { width, height, data } = buf;
	const n = width * height * 4;

	const glowA = new Float32Array(n);
	const glowTmp = new Float32Array(n);
	const glowB = new Float32Array(n);
	const tint = opts.tintColor;

	// Extract pixels exceeding luminance threshold (weighted by alpha)
	for (let i = 0; i < n; i += 4) {
		const a = data[i + 3]! / 255;
		if (a <= 0.004) continue;
		const r = data[i]!;
		const g = data[i + 1]!;
		const b = data[i + 2]!;
		const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
		if (lum >= threshold) {
			const excess = threshold < 0.999 ? (lum - threshold) / (1 - threshold) : 1;
			const boost = (0.35 + 0.65 * excess) * a;
			if (tint) {
				glowA[i] = tint[0] * boost;
				glowA[i + 1] = tint[1] * boost;
				glowA[i + 2] = tint[2] * boost;
			} else {
				glowA[i] = r * boost;
				glowA[i + 1] = g * boost;
				glowA[i + 2] = b * boost;
			}
			glowA[i + 3] = 255 * boost;
		}
	}

	// 3 box-blur passes approximate a smooth Gaussian halo
	let src = glowA;
	let dst = glowB;
	for (let it = 0; it < 3; it++) {
		boxBlurPassFloat(src, glowTmp, dst, width, height, Math.max(1, Math.round(radius * 0.65)));
		const swap = src;
		src = dst;
		dst = swap;
	}

	// Additive composite of bloom onto straight-alpha RGBA buffer
	for (let i = 0; i < n; i += 4) {
		const keep = opts.composite === 'behind' ? 1 - data[i + 3]! / 255 : 1;
		const gr = src[i]! * intensity * keep;
		const gg = src[i + 1]! * intensity * keep;
		const gb = src[i + 2]! * intensity * keep;
		const ga = src[i + 3]! * intensity;
		if (ga <= 0.5 && gr <= 0.5 && gg <= 0.5 && gb <= 0.5) continue;

		const srcA = data[i + 3]! / 255;
		const glowAOut = Math.min(1, ga / 255);
		const outA = Math.min(1, srcA + glowAOut * (1 - srcA));
		if (outA > 0.004) {
			const premulR = data[i]! * srcA + gr;
			const premulG = data[i + 1]! * srcA + gg;
			const premulB = data[i + 2]! * srcA + gb;
			data[i] = clampByte(premulR / outA);
			data[i + 1] = clampByte(premulG / outA);
			data[i + 2] = clampByte(premulB / outA);
			data[i + 3] = clampByte(outA * 255);
		}
	}
}

/**
 * 5. ADBE Simple Choker — Erodes alpha when `chokeMatte > 0`, dilates alpha when `chokeMatte < 0`.
 */
export function applyEffectSimpleChoker(buf: RgbaBuffer, chokeMattePx: number): void {
	const r = Math.min(24, Math.round(Math.abs(chokeMattePx)));
	if (r < 1) return;
	const erode = chokeMattePx > 0;
	const { width, height, data } = buf;
	const alphaIn = new Uint8Array(width * height);
	const alphaTmp = new Uint8Array(width * height);
	const alphaOut = new Uint8Array(width * height);

	for (let i = 0; i < width * height; i++) {
		alphaIn[i] = data[i * 4 + 3]!;
	}

	// Separable 1D min (erode) or max (dilate) horizontally then vertically
	for (let y = 0; y < height; y++) {
		const row = y * width;
		for (let x = 0; x < width; x++) {
			let acc = erode ? 255 : 0;
			const x0 = Math.max(0, x - r);
			const x1 = Math.min(width - 1, x + r);
			for (let k = x0; k <= x1; k++) {
				const v = alphaIn[row + k]!;
				if (erode ? v < acc : v > acc) acc = v;
			}
			alphaTmp[row + x] = acc;
		}
	}
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			let acc = erode ? 255 : 0;
			const y0 = Math.max(0, y - r);
			const y1 = Math.min(height - 1, y + r);
			for (let k = y0; k <= y1; k++) {
				const v = alphaTmp[k * width + x]!;
				if (erode ? v < acc : v > acc) acc = v;
			}
			alphaOut[y * width + x] = acc;
		}
	}

	// Light 1px smoothing on choked alpha edge for cleaner anime contours
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = y * width + x;
			const c = alphaOut[idx]!;
			const l = alphaOut[y * width + Math.max(0, x - 1)]!;
			const ri = alphaOut[y * width + Math.min(width - 1, x + 1)]!;
			const u = alphaOut[Math.max(0, y - 1) * width + x]!;
			const dn = alphaOut[Math.min(height - 1, y + 1) * width + x]!;
			data[idx * 4 + 3] = Math.round((c * 2 + l + ri + u + dn) / 6);
		}
	}
}

/**
 * 6. ADBE Noise2 — Deterministic per-frame film grain (`amountPct` 0..100, monochrome or color).
 */
export function applyEffectNoise(
	buf: RgbaBuffer,
	amountPct: number,
	useColorNoise = false,
	frameSeed = 0,
): void {
	const amt = Math.max(0, Math.min(100, amountPct));
	if (amt <= 0.05) return;
	const amp = (amt / 100) * 128;
	const d = buf.data;
	const pixels = buf.width * buf.height;

	const hash01 = (n: number): number => {
		let x = (n ^ 0x9e3779b9) >>> 0;
		x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
		x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
		x = (x ^ (x >>> 16)) >>> 0;
		return (x / 4294967295) * 2 - 1;
	};

	const baseSeed = Math.imul(frameSeed + 1, 2654435761) >>> 0;
	for (let p = 0; p < pixels; p++) {
		const o = p * 4;
		if (d[o + 3]! === 0) continue;
		if (useColorNoise) {
			const n0 = hash01(baseSeed + p * 3);
			const n1 = hash01(baseSeed + p * 3 + 1);
			const n2 = hash01(baseSeed + p * 3 + 2);
			d[o] = clampByte(d[o]! + n0 * amp);
			d[o + 1] = clampByte(d[o + 1]! + n1 * amp);
			d[o + 2] = clampByte(d[o + 2]! + n2 * amp);
		} else {
			const n = hash01(baseSeed + p) * amp;
			d[o] = clampByte(d[o]! + n);
			d[o + 1] = clampByte(d[o + 1]! + n);
			d[o + 2] = clampByte(d[o + 2]! + n);
		}
	}
}

export interface DropShadowOptions {
	color: [number, number, number];
	/** 0..1 */
	opacity: number;
	/** 0 is up, growing clockwise. */
	directionDeg: number;
	distancePx: number;
	softnessPx: number;
	shadowOnly?: boolean;
}

/** One box pass over a single channel, with transparency beyond the edges. */
function blurAlphaPass(
	src: Float32Array,
	dst: Float32Array,
	lines: number,
	length: number,
	stride: number,
	step: number,
	radius: number,
): void {
	const inverse = 1 / (2 * radius + 1);
	for (let line = 0; line < lines; line++) {
		const base = line * stride;
		let sum = 0;
		for (let k = 0; k < Math.min(radius, length); k++) sum += src[base + k * step]!;
		for (let k = 0; k < length; k++) {
			if (k + radius < length) sum += src[base + (k + radius) * step]!;
			if (k - radius - 1 >= 0) sum -= src[base + (k - radius - 1) * step]!;
			dst[base + k * step] = sum * inverse;
		}
	}
}

/** ADBE Drop Shadow: a blurred, offset copy of the alpha, composited behind the layer. */
export function applyEffectDropShadow(buf: RgbaBuffer, opts: DropShadowOptions): void {
	const opacity = Math.max(0, Math.min(1, opts.opacity));
	if (opacity === 0 && !opts.shadowOnly) return;
	const { width, height, data } = buf;
	const angle = (opts.directionDeg * Math.PI) / 180;
	const dx = Math.round(Math.sin(angle) * opts.distancePx);
	const dy = Math.round(-Math.cos(angle) * opts.distancePx);

	const alpha = new Float32Array(width * height);
	for (let y = Math.max(0, dy); y < Math.min(height, height + dy); y++) {
		for (let x = Math.max(0, dx); x < Math.min(width, width + dx); x++) {
			alpha[y * width + x] = data[((y - dy) * width + x - dx) * 4 + 3]! / 255;
		}
	}

	// Three box passes approximate a Gaussian whose standard deviation is about the box radius.
	const radius = Math.min(512, Math.round(opts.softnessPx / 2.5));
	if (radius >= 1) {
		const scratch = new Float32Array(width * height);
		for (let pass = 0; pass < 3; pass++) {
			blurAlphaPass(alpha, scratch, height, width, width, 1, radius);
			blurAlphaPass(scratch, alpha, width, height, 1, width, radius);
		}
	}

	const [r, g, b] = opts.color;
	for (let i = 0, o = 0; i < alpha.length; i++, o += 4) {
		const layerAlpha = opts.shadowOnly ? 0 : data[o + 3]! / 255;
		const shadow = alpha[i]! * opacity * (1 - layerAlpha);
		const out = layerAlpha + shadow;
		if (out <= 0) {
			data[o + 3] = 0;
			continue;
		}
		if (shadow === 0) continue;
		data[o] = clampByte((data[o]! * layerAlpha + r * shadow) / out);
		data[o + 1] = clampByte((data[o + 1]! * layerAlpha + g * shadow) / out);
		data[o + 2] = clampByte((data[o + 2]! * layerAlpha + b * shadow) / out);
		data[o + 3] = clampByte(out * 255);
	}
}

/**
 * ADBE Shift Channels. Sources use AE's popup order: 1 alpha, 2 red, 3 green, 4 blue, 5 luminance,
 * 9 full on, 10 full off. Returns false, leaving the buffer untouched, for hue, lightness and saturation.
 */
export function applyEffectShiftChannels(
	buf: RgbaBuffer,
	from: { alpha: number; red: number; green: number; blue: number },
): boolean {
	const sources = [from.red, from.green, from.blue, from.alpha];
	if (sources.some((code) => ![1, 2, 3, 4, 5, 9, 10].includes(code))) return false;
	const d = buf.data;
	for (let i = 0; i < d.length; i += 4) {
		const r = d[i]!;
		const g = d[i + 1]!;
		const b = d[i + 2]!;
		const a = d[i + 3]!;
		for (let channel = 0; channel < 4; channel++) {
			const code = sources[channel]!;
			let value = 0;
			if (code === 1) value = a;
			else if (code === 2) value = r;
			else if (code === 3) value = g;
			else if (code === 4) value = b;
			else if (code === 5) value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			else if (code === 9) value = 255;
			d[i + channel] = clampByte(value);
		}
	}
	return true;
}

export type SetMatteChannel = 'alpha' | 'luma' | 'red' | 'green' | 'blue';

/**
 * 7. ADBE Set Matte3 — Modulates target buffer alpha using a matte layer's channel (with optional invert).
 */
export function applyEffectSetMatte(
	target: RgbaBuffer,
	matte: RgbaBuffer,
	channel: SetMatteChannel = 'alpha',
	invert = false,
): void {
	const { width, height, data } = target;
	const mData = matte.data;
	const scaleX = matte.width / Math.max(1, width);
	const scaleY = matte.height / Math.max(1, height);

	for (let y = 0; y < height; y++) {
		const my = Math.min(matte.height - 1, Math.floor(y * scaleY));
		for (let x = 0; x < width; x++) {
			const mx = Math.min(matte.width - 1, Math.floor(x * scaleX));
			const mo = (my * matte.width + mx) * 4;
			let mv = 0;
			if (channel === 'alpha') {
				mv = mData[mo + 3]! / 255;
			} else if (channel === 'luma') {
				const ma = mData[mo + 3]! / 255;
				mv = ((0.2126 * mData[mo]! + 0.7152 * mData[mo + 1]! + 0.0722 * mData[mo + 2]!) / 255) * ma;
			} else if (channel === 'red') {
				mv = mData[mo]! / 255;
			} else if (channel === 'green') {
				mv = mData[mo + 1]! / 255;
			} else {
				mv = mData[mo + 2]! / 255;
			}
			if (invert) mv = 1 - mv;
			const o = (y * width + x) * 4;
			data[o + 3] = clampByte(data[o + 3]! * mv);
		}
	}
}

export interface Transform2DParams {
	anchorX: number;
	anchorY: number;
	posX: number;
	posY: number;
	/** Scale factors (1.0 = 100%). */
	scaleX: number;
	scaleY: number;
	/** Rotation in degrees (clockwise in screen space, matching AE). */
	rotationDeg: number;
	/** Layer opacity in 0..1. */
	opacity: number;
}

/** Composites `src` with an anchor, scale, rotation and position transform. */
export function compositeLayerTransformed(
	dst: RgbaBuffer,
	src: RgbaBuffer,
	tx: Transform2DParams,
	blendMode: AepBlendMode = 'normal',
	trackMatte?: { buffer: RgbaBuffer; type: AepTrackMatteType },
): void {
	const angle = (tx.rotationDeg * Math.PI) / 180;
	const a = Math.cos(angle) * tx.scaleX;
	const b = Math.sin(angle) * tx.scaleX;
	const c = -Math.sin(angle) * tx.scaleY;
	const d = Math.cos(angle) * tx.scaleY;
	const e = tx.posX - a * tx.anchorX - c * tx.anchorY;
	const f = tx.posY - b * tx.anchorX - d * tx.anchorY;
	compositeLayerAffine(dst, src, [a, b, c, d, e, f], tx.opacity, blendMode, trackMatte);
}

function blendChannel(mode: AepBlendMode, under: number, over: number): number {
	switch (mode) {
		case 'add':
			return Math.min(255, under + over);
		case 'screen':
			return 255 - ((255 - under) * (255 - over)) / 255;
		case 'multiply':
			return (under * over) / 255;
		case 'lighten':
			return Math.max(under, over);
		case 'darken':
			return Math.min(under, over);
		case 'overlay':
			return under < 128 ? (2 * under * over) / 255 : 255 - (2 * (255 - under) * (255 - over)) / 255;
		default:
			return over;
	}
}

const luminosity = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;

/** Color blend: hue and saturation of `over`, luminosity of `under`. */
function blendColor(under: number[], over: number[]): number[] {
	const target = luminosity(under[0]!, under[1]!, under[2]!);
	const shift = target - luminosity(over[0]!, over[1]!, over[2]!);
	let out = over.map((value) => value + shift);
	const low = Math.min(...out);
	const high = Math.max(...out);
	if (low < 0) out = out.map((value) => target + ((value - target) * target) / (target - low));
	if (high > 255) out = out.map((value) => target + ((value - target) * (255 - target)) / (high - target));
	return out;
}

/** Stencil modes keep what is below only inside the layer; Silhouette modes cut the layer out of it. */
function compositeKnockout(dst: RgbaBuffer, coverage: RgbaBuffer, mode: AepBlendMode): void {
	const silhouette = mode === 'silhouette_alpha' || mode === 'silhouette_luma';
	const luma = mode === 'stencil_luma' || mode === 'silhouette_luma';
	const c = coverage.data;
	for (let o = 0; o < c.length; o += 4) {
		let value = c[o + 3]! / 255;
		if (luma) value *= luminosity(c[o]!, c[o + 1]!, c[o + 2]!) / 255;
		dst.data[o + 3] = clampByte(dst.data[o + 3]! * (silhouette ? 1 - value : value));
	}
}

/**
 * Composites `src` onto `dst` through `matrix` (source pixels to destination pixels) with bilinear,
 * alpha-weighted sampling, an optional destination-sized track matte and an AE blend mode.
 */
export function compositeLayerAffine(
	dst: RgbaBuffer,
	src: RgbaBuffer,
	matrix: Affine,
	opacity = 1,
	blendMode: AepBlendMode = 'normal',
	trackMatte?: { buffer: RgbaBuffer; type: AepTrackMatteType },
): void {
	if (blendMode.startsWith('stencil_') || blendMode.startsWith('silhouette_')) {
		const coverage = createRgbaBuffer(dst.width, dst.height);
		compositeLayerAffine(coverage, src, matrix, opacity, 'normal', trackMatte);
		compositeKnockout(dst, coverage, blendMode);
		return;
	}
	const op = Math.max(0, Math.min(1, opacity));
	const [a, b, c, d, e, f] = matrix;
	const det = a * d - b * c;
	if (op <= 0.002 || !(Math.abs(det) > 1e-9)) return;
	const { width: sW, height: sH, data: sData } = src;
	const { width: dW, height: dH, data: dData } = dst;
	const xs = [e, a * sW + e, c * sH + e, a * sW + c * sH + e];
	const ys = [f, b * sW + f, d * sH + f, b * sW + d * sH + f];
	const x0 = Math.max(0, Math.floor(Math.min(...xs)));
	const x1 = Math.min(dW, Math.ceil(Math.max(...xs)));
	const y0 = Math.max(0, Math.floor(Math.min(...ys)));
	const y1 = Math.min(dH, Math.ceil(Math.max(...ys)));
	if (x0 >= x1 || y0 >= y1) return;

	const ia = d / det;
	const ib = -b / det;
	const ic = -c / det;
	const id = a / det;
	const matte = trackMatte && trackMatte.type !== 'none' ? trackMatte.buffer.data : null;
	const matteType = trackMatte?.type;
	const matteLuma = matteType === 'luma' || matteType === 'luma_inverted';
	const matteInverted = matteType === 'alpha_inverted' || matteType === 'luma_inverted';

	for (let py = y0; py < y1; py++) {
		for (let px = x0; px < x1; px++) {
			const rx = px + 0.5 - e;
			const ry = py + 0.5 - f;
			const u = ia * rx + ic * ry;
			const v = ib * rx + id * ry;
			if (u < 0 || v < 0 || u > sW || v > sH) continue;

			const sx = Math.max(0, Math.min(sW - 1, u - 0.5));
			const sy = Math.max(0, Math.min(sH - 1, v - 0.5));
			const ix = sx | 0;
			const iy = sy | 0;
			const fx = sx - ix;
			const fy = sy - iy;
			const right = ix + 1 < sW ? 4 : 0;
			const down = iy + 1 < sH ? sW * 4 : 0;
			const o = (iy * sW + ix) * 4;
			const w00 = (1 - fx) * (1 - fy) * sData[o + 3]!;
			const w10 = fx * (1 - fy) * sData[o + right + 3]!;
			const w01 = (1 - fx) * fy * sData[o + down + 3]!;
			const w11 = fx * fy * sData[o + down + right + 3]!;
			const weight = w00 + w10 + w01 + w11;
			if (weight <= 0.25) continue;

			const doff = (py * dW + px) * 4;
			let sa = (weight / 255) * op;
			if (matte) {
				let value = matte[doff + 3]! / 255;
				if (matteLuma) {
					value *= (0.2126 * matte[doff]! + 0.7152 * matte[doff + 1]! + 0.0722 * matte[doff + 2]!) / 255;
				}
				sa *= matteInverted ? 1 - value : value;
			}
			if (sa <= 0.002) continue;

			const da = dData[doff + 3]! / 255;
			const outA = sa + da * (1 - sa);
			const sample = (k: number): number =>
				(sData[o + k]! * w00 +
					sData[o + right + k]! * w10 +
					sData[o + down + k]! * w01 +
					sData[o + down + right + k]! * w11) /
				weight;
			const recoloured =
				blendMode === 'color' && da > 0
					? blendColor([dData[doff]!, dData[doff + 1]!, dData[doff + 2]!], [sample(0), sample(1), sample(2)])
					: null;
			for (let k = 0; k < 3; k++) {
				const colour = sample(k);
				const under = dData[doff + k]!;
				// Over transparency the source keeps its colour: blending only applies over content.
				const blended =
					blendMode === 'normal'
						? colour
						: colour * (1 - da) + (recoloured ? recoloured[k]! : blendChannel(blendMode, under, colour)) * da;
				dData[doff + k] = clampByte((blended * sa + under * da * (1 - sa)) / outA);
			}
			dData[doff + 3] = clampByte(outA * 255);
		}
	}
}
