import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
	AepAnimatedMask,
	AepCompositionMasks,
	BezierVertex,
	Vec2,
} from './aep-mask-extractor.js';
import { evaluateAnimatedMaskAtTime } from './aep-mask-extractor.js';

export interface RgbColor {
	r: number;
	g: number;
	b: number;
}

export function hexToRgbColor(hex: string, fallback: RgbColor = { r: 255, g: 255, b: 255 }): RgbColor {
	const cleaned = hex.trim().replace(/^#/, '');
	if (cleaned.length !== 6) return fallback;
	const n = Number.parseInt(cleaned, 16);
	if (Number.isNaN(n)) return fallback;
	return {
		r: (n >> 16) & 255,
		g: (n >> 8) & 255,
		b: n & 255,
	};
}

/**
 * Flattens a closed (or open) cubic Bézier vertex ring into a dense polyline in target pixel space.
 */
export function flattenBezierVertices(
	vertices: BezierVertex[],
	scaleX: number,
	scaleY: number,
	stepsPerSegment = 10,
): Vec2[] {
	const n = vertices.length;
	if (n < 2) return [];
	const pts: Vec2[] = [];

	for (let i = 0; i < n; i++) {
		const a = vertices[i]!;
		const b = vertices[(i + 1) % n]!;
		const p0x = a.point.x * scaleX;
		const p0y = a.point.y * scaleY;
		const p1x = a.outHandle.x * scaleX;
		const p1y = a.outHandle.y * scaleY;
		const p2x = b.inHandle.x * scaleX;
		const p2y = b.inHandle.y * scaleY;
		const p3x = b.point.x * scaleX;
		const p3y = b.point.y * scaleY;

		for (let s = 0; s < stepsPerSegment; s++) {
			const t = s / stepsPerSegment;
			const u = 1 - t;
			const u2 = u * u;
			const u3 = u2 * u;
			const t2 = t * t;
			const t3 = t2 * t;
			pts.push({
				x: u3 * p0x + 3 * u2 * t * p1x + 3 * u * t2 * p2x + t3 * p3x,
				y: u3 * p0y + 3 * u2 * t * p1y + 3 * u * t2 * p2y + t3 * p3y,
			});
		}
	}
	return pts;
}

/**
 * Fast scanline even-odd polygon rasterizer into a single-channel Float32Array alpha buffer (`width * height`).
 * Supports `add` (union/max) and `subtract` (punch-out) AE mask modes.
 */
export function rasterizePolygonIntoMask(
	poly: Vec2[],
	alphaBuf: Float32Array,
	width: number,
	height: number,
	opacity: number,
	mode: 'add' | 'subtract',
): void {
	const n = poly.length;
	if (n < 3 || opacity <= 0.005) return;

	let minY = height;
	let maxY = -1;
	for (let i = 0; i < n; i++) {
		const y = poly[i]!.y;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const y0 = Math.max(0, Math.floor(minY));
	const y1 = Math.min(height - 1, Math.ceil(maxY));
	if (y0 > y1) return;

	const nodes: number[] = [];
	for (let y = y0; y <= y1; y++) {
		const sy = y + 0.5;
		nodes.length = 0;

		let j = n - 1;
		for (let i = 0; i < n; i++) {
			const pi = poly[i]!;
			const pj = poly[j]!;
			if ((pi.y < sy && pj.y >= sy) || (pj.y < sy && pi.y >= sy)) {
				const x = pi.x + ((sy - pi.y) / (pj.y - pi.y)) * (pj.x - pi.x);
				nodes.push(x);
			}
			j = i;
		}
		if (nodes.length < 2) continue;
		nodes.sort((a, b) => a - b);

		const rowOff = y * width;
		for (let k = 0; k + 1 < nodes.length; k += 2) {
			const xStart = Math.max(0, Math.ceil(nodes[k]!));
			const xEnd = Math.min(width - 1, Math.floor(nodes[k + 1]!));
			if (xStart > xEnd) continue;
			if (mode === 'add') {
				for (let x = xStart; x <= xEnd; x++) {
					const idx = rowOff + x;
					if (opacity > alphaBuf[idx]!) alphaBuf[idx] = opacity;
				}
			} else {
				const keep = 1 - opacity;
				for (let x = xStart; x <= xEnd; x++) {
					const idx = rowOff + x;
					alphaBuf[idx] = alphaBuf[idx]! * keep;
				}
			}
		}
	}
}

export interface RenderMaskLayerSpec {
	masks: AepAnimatedMask[];
	color: RgbColor;
	/** Optional soft glow radius in pixels (purely visual finishing; 0 = raw exact masks). */
	glowStrength?: number;
}

export interface RenderCompMasksFrameOptions {
	comp: AepCompositionMasks;
	tSec: number;
	width: number;
	height: number;
	bgColor: RgbColor;
	/** Ordered bottom-to-top layers to render. */
	layers: RenderMaskLayerSpec[];
	outRgba: Uint8Array;
	/** If true, also draws vertex anchor dots for single-mask inspection. */
	drawVertexHandles?: boolean;
}

/**
 * Renders one deterministic RGBA frame from real extracted AE animated Bézier masks.
 */
export function renderAepMasksFrameRgba(opts: RenderCompMasksFrameOptions): {
	activeMasks: number;
	totalVertices: number;
} {
	const { comp, tSec, width, height, bgColor, layers, outRgba, drawVertexHandles } = opts;
	const scaleX = width / Math.max(1, comp.width);
	const scaleY = height / Math.max(1, comp.height);

	// Fill background
	for (let i = 0; i < width * height; i++) {
		const o = i * 4;
		outRgba[o] = bgColor.r;
		outRgba[o + 1] = bgColor.g;
		outRgba[o + 2] = bgColor.b;
		outRgba[o + 3] = 255;
	}

	const layerAlpha = new Float32Array(width * height);
	let activeMasks = 0;
	let totalVertices = 0;

	for (const layerSpec of layers) {
		layerAlpha.fill(0);
		let layerHasAny = false;

		for (const mask of layerSpec.masks) {
			const state = evaluateAnimatedMaskAtTime(mask, tSec);
			if (!state.visible || state.vertices.length < 3) continue;
			layerHasAny = true;
			activeMasks++;
			totalVertices += state.vertices.length;

			const poly = flattenBezierVertices(state.vertices, scaleX, scaleY, 10);
			const op: 'add' | 'subtract' = state.mode === 'subtract' ? 'subtract' : 'add';
			rasterizePolygonIntoMask(poly, layerAlpha, width, height, state.opacity, op);
		}

		if (!layerHasAny) continue;

		const { r: cr, g: cg, b: cb } = layerSpec.color;
		for (let i = 0; i < width * height; i++) {
			const a = layerAlpha[i]!;
			if (a <= 0.005) continue;
			const o = i * 4;
			outRgba[o] = Math.round(outRgba[o]! * (1 - a) + cr * a);
			outRgba[o + 1] = Math.round(outRgba[o + 1]! * (1 - a) + cg * a);
			outRgba[o + 2] = Math.round(outRgba[o + 2]! * (1 - a) + cb * a);
		}

		if (drawVertexHandles) {
			for (const mask of layerSpec.masks) {
				const state = evaluateAnimatedMaskAtTime(mask, tSec);
				if (!state.visible) continue;
				for (const v of state.vertices) {
					const vx = Math.round(v.point.x * scaleX);
					const vy = Math.round(v.point.y * scaleY);
					for (let dy = -3; dy <= 3; dy++) {
						const py = vy + dy;
						if (py < 0 || py >= height) continue;
						for (let dx = -3; dx <= 3; dx++) {
							const px = vx + dx;
							if (px < 0 || px >= width || dx * dx + dy * dy > 10) continue;
							const o = (py * width + px) * 4;
							outRgba[o] = 255;
							outRgba[o + 1] = 235;
							outRgba[o + 2] = 60;
						}
					}
				}
			}
		}
	}

	return { activeMasks, totalVertices };
}

export interface RenderAepMasksMp4Options {
	comp: AepCompositionMasks;
	layers: RenderMaskLayerSpec[];
	bgColor: RgbColor;
	outputMp4Path: string;
	width?: number;
	height?: number;
	fps?: number;
	durationSec?: number;
	drawVertexHandles?: boolean;
}

/**
 * Pipes deterministic RGBA frames of real extracted AE Bézier masks into FFmpeg to encode an MP4.
 */
export async function renderAepMasksToMp4(opts: RenderAepMasksMp4Options): Promise<{
	outputMp4Path: string;
	framesRendered: number;
	durationSec: number;
	renderMs: number;
}> {
	const t0 = Date.now();
	const width = opts.width ?? 1280;
	const height = opts.height ?? 720;
	const fps = opts.fps ?? 30;
	const durationSec = opts.durationSec ?? Math.max(0.5, opts.comp.durationSec);
	const totalFrames = Math.max(1, Math.round(durationSec * fps));

	mkdirSync(dirname(opts.outputMp4Path), { recursive: true });

	const ff = spawn(
		'ffmpeg',
		[
			'-y',
			'-f',
			'rawvideo',
			'-pix_fmt',
			'rgba',
			'-s',
			`${width}x${height}`,
			'-r',
			String(fps),
			'-i',
			'pipe:0',
			'-c:v',
			'libx264',
			'-pix_fmt',
			'yuv420p',
			'-preset',
			'fast',
			'-crf',
			'18',
			'-movflags',
			'+faststart',
			opts.outputMp4Path,
		],
		{ stdio: ['pipe', 'ignore', 'pipe'] },
	);

	let stderr = '';
	ff.stderr.on('data', (chunk) => {
		stderr += chunk.toString();
	});

	const frameBuf = Buffer.alloc(width * height * 4);
	for (let f = 0; f < totalFrames; f++) {
		const tSec = f / fps;
		renderAepMasksFrameRgba({
			comp: opts.comp,
			tSec,
			width,
			height,
			bgColor: opts.bgColor,
			layers: opts.layers,
			outRgba: frameBuf,
			drawVertexHandles: opts.drawVertexHandles,
		});
		const canContinue = ff.stdin.write(frameBuf);
		if (!canContinue) {
			await new Promise<void>((resolve) => ff.stdin.once('drain', resolve));
		}
	}
	ff.stdin.end();

	const exitCode = await new Promise<number>((resolve, reject) => {
		ff.on('error', reject);
		ff.on('close', (code) => resolve(code ?? 1));
	});
	if (exitCode !== 0) {
		throw new Error(`ffmpeg failed (code ${exitCode}): ${stderr.slice(-400)}`);
	}

	return {
		outputMp4Path: opts.outputMp4Path,
		framesRendered: totalFrames,
		durationSec,
		renderMs: Date.now() - t0,
	};
}
