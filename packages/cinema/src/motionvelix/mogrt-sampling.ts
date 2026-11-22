/** Premultiplied sampling shared by the effects that resample a buffer. */

import type { RgbaBuffer } from './mogrt-effects-pipeline.js';

export function toPremultiplied({ data }: RgbaBuffer): Float32Array {
	const out = new Float32Array(data.length);
	for (let o = 0; o < data.length; o += 4) {
		const alpha = data[o + 3]! / 255;
		out[o] = data[o]! * alpha;
		out[o + 1] = data[o + 1]! * alpha;
		out[o + 2] = data[o + 2]! * alpha;
		out[o + 3] = data[o + 3]!;
	}
	return out;
}

export function writePremultiplied(buffer: RgbaBuffer, source: Float32Array): void {
	const { data } = buffer;
	for (let o = 0; o < data.length; o += 4) {
		const alpha = source[o + 3]!;
		data[o + 3] = Math.round(alpha);
		for (let k = o; k < o + 3; k++) data[k] = alpha > 0 ? Math.min(255, Math.round((source[k]! * 255) / alpha)) : 0;
	}
}

/**
 * Adds `weight` times the bilinear sample at (`x`, `y`), in pixel-centre coordinates, to `out` at `index`.
 * Outside the image is transparent.
 */
export function addSample(
	out: Float32Array,
	index: number,
	source: Float32Array,
	width: number,
	height: number,
	x: number,
	y: number,
	weight = 1,
): void {
	const u = x - 0.5;
	const v = y - 0.5;
	const left = Math.floor(u);
	const top = Math.floor(v);
	if (left < -1 || top < -1 || left >= width || top >= height) return;
	const fx = u - left;
	const fy = v - top;
	for (let j = 0; j < 2; j++) {
		const row = top + j;
		if (row < 0 || row >= height) continue;
		const rowWeight = (j ? fy : 1 - fy) * weight;
		if (rowWeight === 0) continue;
		for (let i = 0; i < 2; i++) {
			const column = left + i;
			if (column < 0 || column >= width) continue;
			const share = rowWeight * (i ? fx : 1 - fx);
			if (share === 0) continue;
			const from = (row * width + column) * 4;
			for (let k = 0; k < 4; k++) out[index + k] = out[index + k]! + source[from + k]! * share;
		}
	}
}
