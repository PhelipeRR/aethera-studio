/**
 * MotionVelix MOGRT Engine — Phase 3A Deterministic RGBA Effects & Compositing Pipeline
 *
 * Implements the 7 Phase 3A After Effects image effects cleanly on straight-alpha RGBA Uint8Array buffers:
 * 1. `ADBE Fill`          — Solid RGB fill preserving alpha (with opacity blend)
 * 2. `ADBE Tint`          — Dual-tone luminance mapping (mapBlackTo -> mapWhiteTo, amount 0..100%)
 * 3. `ADBE Box Blur2` / `ADBE Gaussian Blur 2` — Separable O(1)-per-pixel sliding-window box blur (1..3 iterations)
 * 4. `ADBE Glo2`          — Threshold extraction + separable multi-pass bloom + optional A/B tint + additive composite
 * 5. `ADBE Simple Choker` — Morphological alpha erosion (choke > 0) / dilation (choke < 0)
 * 6. `ADBE Noise2`        — Deterministic per-frame hashed film grain (mono or color)
 * 7. `ADBE Set Matte3`    — Transfers alpha/luma/channel matte from a target layer (with optional invert)
 *
 * Also implements 2D affine layer transformation (anchor, position, scale, rotation),
 * Track Mattes (`alpha`, `alpha_inverted`, `luma`, `luma_inverted`), and AE blend modes.
 */

import type { AepBlendMode, AepTrackMatteType } from './aep-comp-graph.js';

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
	const r = Math.min(64, Math.max(0, Math.round(radiusPx)));
	if (r < 1) return;
	const iters = Math.max(1, Math.min(4, Math.round(iterations)));
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
}

/**
 * 4. ADBE Glo2 (Glow) — Thresholds bright pixels, applies 3-pass Gaussian-like separable bloom,
 * optionally tints with custom glow color, and composites additively back onto source.
 */
export function applyEffectGlow(buf: RgbaBuffer, opts: GlowOptions = {}): void {
	const radius = Math.min(64, Math.max(1, Math.round(opts.radiusPx ?? 14)));
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
		const gr = src[i]! * intensity;
		const gg = src[i + 1]! * intensity;
		const gb = src[i + 2]! * intensity;
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

/**
 * Composites `src` onto `dst` with exact 2D AE affine transformation (anchor, scale, rotation, position),
 * bilinear interpolation, optional Track Matte buffer, and AE blend mode.
 */
export function compositeLayerTransformed(
	dst: RgbaBuffer,
	src: RgbaBuffer,
	tx: Transform2DParams,
	blendMode: AepBlendMode = 'normal',
	trackMatte?: { buffer: RgbaBuffer; type: AepTrackMatteType },
): void {
	const op = Math.max(0, Math.min(1, tx.opacity));
	if (op <= 0.002 || Math.abs(tx.scaleX) < 1e-4 || Math.abs(tx.scaleY) < 1e-4) return;

	const rad = (tx.rotationDeg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);

	// Forward transform:
	//   dx = (sx - anchorX) * scaleX
	//   dy = (sy - anchorY) * scaleY
	//   px = dx * cos - dy * sin + posX
	//   py = dx * sin + dy * cos + posY
	// Compute tight destination bounding box from the 4 transformed corners of `src`
	const corners: Array<[number, number]> = [
		[0, 0],
		[src.width, 0],
		[src.width, src.height],
		[0, src.height],
	];
	let minX = dst.width;
	let maxX = -1;
	let minY = dst.height;
	let maxY = -1;
	for (const [cx, cy] of corners) {
		const dx = (cx - tx.anchorX) * tx.scaleX;
		const dy = (cy - tx.anchorY) * tx.scaleY;
		const px = dx * cos - dy * sin + tx.posX;
		const py = dx * sin + dy * cos + tx.posY;
		if (px < minX) minX = px;
		if (px > maxX) maxX = px;
		if (py < minY) minY = py;
		if (py > maxY) maxY = py;
	}

	const x0 = Math.max(0, Math.floor(minX));
	const x1 = Math.min(dst.width - 1, Math.ceil(maxX));
	const y0 = Math.max(0, Math.floor(minY));
	const y1 = Math.min(dst.height - 1, Math.ceil(maxY));
	if (x0 > x1 || y0 > y1) return;

	const invSx = 1 / tx.scaleX;
	const invSy = 1 / tx.scaleY;
	const sData = src.data;
	const dData = dst.data;
	const sW = src.width;
	const sH = src.height;
	const dW = dst.width;
	const mBuf = trackMatte && trackMatte.type !== 'none' ? trackMatte.buffer : null;
	const mType = trackMatte?.type ?? 'none';

	for (let py = y0; py <= y1; py++) {
		const ry = py + 0.5 - tx.posY;
		for (let px = x0; px <= x1; px++) {
			const rx = px + 0.5 - tx.posX;
			// Inverse rotate then inverse scale + anchor
			const sx = (rx * cos + ry * sin) * invSx + tx.anchorX - 0.5;
			const sy = (-rx * sin + ry * cos) * invSy + tx.anchorY - 0.5;
			if (sx < -0.5 || sy < -0.5 || sx > sW - 0.5 || sy > sH - 0.5) continue;

			// Bilinear sampling
			const ix = Math.max(0, Math.min(sW - 1, Math.floor(sx)));
			const iy = Math.max(0, Math.min(sH - 1, Math.floor(sy)));
			const ix1 = Math.min(sW - 1, ix + 1);
			const iy1 = Math.min(sH - 1, iy + 1);
			const fx = Math.max(0, Math.min(1, sx - ix));
			const fy = Math.max(0, Math.min(1, sy - iy));

			const o00 = (iy * sW + ix) * 4;
			const o10 = (iy * sW + ix1) * 4;
			const o01 = (iy1 * sW + ix) * 4;
			const o11 = (iy1 * sW + ix1) * 4;

			const w00 = (1 - fx) * (1 - fy);
			const w10 = fx * (1 - fy);
			const w01 = (1 - fx) * fy;
			const w11 = fx * fy;

			const saRaw =
				(sData[o00 + 3]! * w00 +
					sData[o10 + 3]! * w10 +
					sData[o01 + 3]! * w01 +
					sData[o11 + 3]! * w11) /
				255;
			if (saRaw <= 0.002) continue;

			let sa = saRaw * op;
			if (mBuf) {
				const mo = (py * dW + px) * 4;
				let mv = 1;
				if (mType === 'alpha' || mType === 'alpha_inverted') {
					mv = mBuf.data[mo + 3]! / 255;
				} else {
					const ma = mBuf.data[mo + 3]! / 255;
					mv =
						((0.2126 * mBuf.data[mo]! + 0.7152 * mBuf.data[mo + 1]! + 0.0722 * mBuf.data[mo + 2]!) / 255) * ma;
				}
				if (mType === 'alpha_inverted' || mType === 'luma_inverted') mv = 1 - mv;
				sa *= mv;
				if (sa <= 0.002) continue;
			}

			const sr =
				sData[o00]! * w00 + sData[o10]! * w10 + sData[o01]! * w01 + sData[o11]! * w11;
			const sg =
				sData[o00 + 1]! * w00 + sData[o10 + 1]! * w10 + sData[o01 + 1]! * w01 + sData[o11 + 1]! * w11;
			const sb =
				sData[o00 + 2]! * w00 + sData[o10 + 2]! * w10 + sData[o01 + 2]! * w01 + sData[o11 + 2]! * w11;

			const doff = (py * dW + px) * 4;
			const dr = dData[doff]!;
			const dg = dData[doff + 1]!;
			const db = dData[doff + 2]!;
			const da = dData[doff + 3]! / 255;

			let br = sr;
			let bg = sg;
			let bb = sb;
			if (blendMode === 'add') {
				br = Math.min(255, dr + sr);
				bg = Math.min(255, dg + sg);
				bb = Math.min(255, db + sb);
			} else if (blendMode === 'screen') {
				br = 255 - ((255 - dr) * (255 - sr)) / 255;
				bg = 255 - ((255 - dg) * (255 - sg)) / 255;
				bb = 255 - ((255 - db) * (255 - sb)) / 255;
			} else if (blendMode === 'multiply') {
				br = (dr * sr) / 255;
				bg = (dg * sg) / 255;
				bb = (db * sb) / 255;
			} else if (blendMode === 'lighten') {
				br = Math.max(dr, sr);
				bg = Math.max(dg, sg);
				bb = Math.max(db, sb);
			} else if (blendMode === 'darken') {
				br = Math.min(dr, sr);
				bg = Math.min(dg, sg);
				bb = Math.min(db, sb);
			} else if (blendMode === 'overlay') {
				const ov = (d: number, s: number) =>
					d < 128 ? (2 * d * s) / 255 : 255 - (2 * (255 - d) * (255 - s)) / 255;
				br = ov(dr, sr);
				bg = ov(dg, sg);
				bb = ov(db, sb);
			}

			const outA = sa + da * (1 - sa);
			if (outA > 0.004) {
				dData[doff] = clampByte((br * sa + dr * da * (1 - sa)) / outA);
				dData[doff + 1] = clampByte((bg * sa + dg * da * (1 - sa)) / outA);
				dData[doff + 2] = clampByte((bb * sa + db * da * (1 - sa)) / outA);
				dData[doff + 3] = clampByte(outA * 255);
			}
		}
	}
}
