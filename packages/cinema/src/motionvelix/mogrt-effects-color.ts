/**
 * MotionVelix MOGRT Engine: Curves, Exposure, Gradient Ramp, Mosaic and the zooms of CC Radial Blur.
 *
 * Curves uses the tables After Effects stored in the project. The others follow the documented
 * behaviour of the effects; the zoom's falloff and the transfer curve of Exposure are approximations.
 */

import type { Vec2 } from './aep-binary.js';
import type { RgbaBuffer } from './mogrt-effects-pipeline.js';
import { addSample, toPremultiplied, writePremultiplied } from './mogrt-sampling.js';

/** After Effects converts with this gamma when the project has no working space. */
const DISPLAY_GAMMA = 2.2;
/** 2^7 samples along each zoom trail. */
const ZOOM_PASSES = 7;
/** Weight left at the far end of a fading trail. */
const FADE_END_WEIGHT = 0.08;

/** `tables` are RGB, red, green, blue and alpha. */
export function applyEffectCurves(buffer: RgbaBuffer, tables: readonly Uint8Array[]): void {
	const [master, red, green, blue, alpha] = tables;
	if (!master || !red || !green || !blue || !alpha) throw new Error('Curves needs five tables');
	const { data } = buffer;
	for (let o = 0; o < data.length; o += 4) {
		data[o] = master[red[data[o]!]!]!;
		data[o + 1] = master[green[data[o + 1]!]!]!;
		data[o + 2] = master[blue[data[o + 2]!]!]!;
		data[o + 3] = alpha[data[o + 3]!]!;
	}
}

export interface ExposureChannel {
	/** In stops. */
	exposure: number;
	offset: number;
	gamma: number;
}

export function applyEffectExposure(
	buffer: RgbaBuffer,
	channels: readonly [ExposureChannel, ExposureChannel, ExposureChannel],
	bypassLinearLight: boolean,
): void {
	const transfer = bypassLinearLight ? 1 : DISPLAY_GAMMA;
	const tables = channels.map(({ exposure, offset, gamma }) => {
		const gain = 2 ** exposure;
		return Uint8Array.from({ length: 256 }, (_, i) => {
			const value = Math.max(0, (i / 255) ** transfer * gain + offset) ** (1 / Math.max(0.01, gamma));
			return Math.round(255 * Math.min(1, value ** (1 / transfer)));
		});
	});
	const { data } = buffer;
	for (let o = 0; o < data.length; o += 4) {
		for (let k = 0; k < 3; k++) data[o + k] = tables[k]![data[o + k]!]!;
	}
}

export interface RampOptions {
	start: Vec2;
	end: Vec2;
	startColor: [number, number, number];
	endColor: [number, number, number];
	radial: boolean;
	/** 0..1 */
	blendWithOriginal: number;
}

export function applyEffectRamp(buffer: RgbaBuffer, options: RampOptions): void {
	const { start, end, startColor, endColor, radial, blendWithOriginal } = options;
	if (blendWithOriginal >= 1) return;
	const keep = Math.max(0, blendWithOriginal);
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const lengthSquared = dx * dx + dy * dy || 1;
	const { width, height, data } = buffer;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const px = x + 0.5 - start.x;
			const py = y + 0.5 - start.y;
			const raw = radial ? Math.sqrt((px * px + py * py) / lengthSquared) : (px * dx + py * dy) / lengthSquared;
			const t = Math.min(1, Math.max(0, raw));
			const o = (y * width + x) * 4;
			for (let k = 0; k < 3; k++) {
				const ramp = startColor[k]! + (endColor[k]! - startColor[k]!) * t;
				data[o + k] = Math.round(ramp + (data[o + k]! - ramp) * keep);
			}
		}
	}
}

export interface MosaicOptions {
	columns: number;
	rows: number;
	sharp: boolean;
	/** The layer's rectangle inside the buffer. */
	x: number;
	y: number;
	width: number;
	height: number;
}

export function applyEffectMosaic(buffer: RgbaBuffer, options: MosaicOptions): void {
	const { sharp, x: left, y: top, width, height } = options;
	// A block cannot be smaller than a pixel.
	const columns = Math.max(1, Math.min(width, Math.round(options.columns)));
	const rows = Math.max(1, Math.min(height, Math.round(options.rows)));
	if (columns === width && rows === height) return;
	const source = toPremultiplied(buffer);
	const out = source.slice();
	for (let row = 0; row < rows; row++) {
		const y0 = top + Math.floor((row * height) / rows);
		const y1 = top + Math.floor(((row + 1) * height) / rows);
		for (let column = 0; column < columns; column++) {
			const x0 = left + Math.floor((column * width) / columns);
			const x1 = left + Math.floor(((column + 1) * width) / columns);
			const block = [0, 0, 0, 0];
			if (sharp) {
				const from = (Math.floor((y0 + y1) / 2) * buffer.width + Math.floor((x0 + x1) / 2)) * 4;
				for (let k = 0; k < 4; k++) block[k] = source[from + k]!;
			} else {
				for (let y = y0; y < y1; y++) {
					for (let x = x0; x < x1; x++) {
						for (let k = 0; k < 4; k++) block[k] = block[k]! + source[(y * buffer.width + x) * 4 + k]!;
					}
				}
				for (let k = 0; k < 4; k++) block[k] = block[k]! / ((y1 - y0) * (x1 - x0));
			}
			for (let y = y0; y < y1; y++) {
				for (let x = x0; x < x1; x++) out.set(block, (y * buffer.width + x) * 4);
			}
		}
	}
	writePremultiplied(buffer, out);
}

export type RadialZoomType = 'straight' | 'fading' | 'centred';

export interface RadialZoomOptions {
	centre: Vec2;
	/** Trail length as a percentage of the distance to the centre; negative trails point inwards. */
	amount: number;
	type: RadialZoomType;
}

export function applyEffectRadialZoom(buffer: RgbaBuffer, { centre, amount, type }: RadialZoomOptions): void {
	if (amount === 0) return;
	const { width, height } = buffer;
	const source = toPremultiplied(buffer);
	const samples = 2 ** ZOOM_PASSES;
	const fade = type === 'fading' ? FADE_END_WEIGHT ** (1 / samples) : 1;

	// Each pass adds the image so far, rescaled, which doubles the samples along every trail.
	const trail = (percent: number): Float32Array => {
		const reach = 1 + Math.abs(percent) / 100;
		const ratio = (percent > 0 ? 1 / reach : reach) ** (1 / samples);
		let image = source;
		for (let pass = 0; pass < ZOOM_PASSES; pass++) {
			const span = 2 ** pass;
			const scale = ratio ** span;
			const weight = fade ** span;
			const share = weight / (1 + weight);
			const out = new Float32Array(image.length);
			for (let i = 0; i < out.length; i++) out[i] = image[i]! * (1 - share);
			for (let y = 0; y < height; y++) {
				const v = centre.y + (y + 0.5 - centre.y) * scale;
				for (let x = 0; x < width; x++) {
					const u = centre.x + (x + 0.5 - centre.x) * scale;
					addSample(out, (y * width + x) * 4, image, width, height, u, v, share);
				}
			}
			image = out;
		}
		return image;
	};

	let result = trail(type === 'centred' ? amount / 2 : amount);
	if (type === 'centred') {
		const opposite = trail(-amount / 2);
		result = result.map((value, i) => (value + opposite[i]!) / 2);
	}
	writePremultiplied(buffer, result);
}
