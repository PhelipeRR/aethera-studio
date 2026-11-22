import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
	AepAnimatedMask,
	AepCompositionMasks,
	BezierVertex,
	Vec2,
	AepMaskMode,
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

/** 2D affine matrix [a, b, c, d, e, f], mapping (x, y) to (a*x + c*y + e, b*x + d*y + f). */
export type Affine = readonly [number, number, number, number, number, number];

export interface PathBounds {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

const SUB_SCANLINES = 4;

/**
 * Nonzero-winding rasterizer with anti-aliased coverage. Writes 0..1 into `out`, which must be
 * zeroed by the caller, and returns the bounds it touched.
 */
export function rasterizePaths(paths: Vec2[][], out: Float32Array, width: number, height: number): PathBounds | null {
	const edges: Array<{ x0: number; y0: number; y1: number; slope: number; winding: number }> = [];
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const path of paths) {
		for (let i = 0; i < path.length; i++) {
			const p = path[i]!;
			const q = path[(i + 1) % path.length]!;
			left = Math.min(left, p.x);
			right = Math.max(right, p.x);
			top = Math.min(top, p.y);
			bottom = Math.max(bottom, p.y);
			if (p.y === q.y) continue;
			const [from, to] = p.y < q.y ? [p, q] : [q, p];
			edges.push({
				x0: from.x,
				y0: from.y,
				y1: to.y,
				slope: (to.x - from.x) / (to.y - from.y),
				winding: p.y < q.y ? 1 : -1,
			});
		}
	}
	const bounds = {
		x0: Math.max(0, Math.floor(left)),
		y0: Math.max(0, Math.floor(top)),
		x1: Math.min(width, Math.ceil(right)),
		y1: Math.min(height, Math.ceil(bottom)),
	};
	if (edges.length === 0 || bounds.x0 >= bounds.x1 || bounds.y0 >= bounds.y1) return null;

	edges.sort((a, b) => a.y0 - b.y0);
	let next = 0;
	let active: typeof edges = [];
	const weight = 1 / SUB_SCANLINES;
	for (let row = bounds.y0; row < bounds.y1; row++) {
		for (let sub = 0; sub < SUB_SCANLINES; sub++) {
			const y = row + (sub + 0.5) * weight;
			while (next < edges.length && edges[next]!.y0 <= y) active.push(edges[next++]!);
			active = active.filter((edge) => edge.y1 > y);
			const crossings = active
				.map((edge) => ({ x: edge.x0 + (y - edge.y0) * edge.slope, winding: edge.winding }))
				.sort((a, b) => a.x - b.x);
			let winding = 0;
			let start = 0;
			for (const crossing of crossings) {
				const wasInside = winding !== 0;
				winding += crossing.winding;
				if (!wasInside && winding !== 0) start = crossing.x;
				if (!wasInside || winding !== 0) continue;
				const from = Math.max(0, start);
				const to = Math.min(width, crossing.x);
				for (let x = Math.floor(from); x < to; x++) {
					const index = row * width + x;
					out[index] = Math.min(1, out[index]! + (Math.min(x + 1, to) - Math.max(x, from)) * weight);
				}
			}
		}
	}
	return bounds;
}

export interface MaskStackEntry {
	mode: AepMaskMode;
	inverted: boolean;
	opacity: number;
	vertices: BezierVertex[];
}

/** Combines masks top to bottom with their AE modes. `matrix` maps layer pixels to buffer pixels. */
export function rasterizeMaskStack(
	masks: readonly MaskStackEntry[],
	matrix: Affine,
	width: number,
	height: number,
): Float32Array {
	const active = masks.filter((mask) => mask.mode !== 'none');
	const result = new Float32Array(width * height);
	const first = active[0]?.mode;
	if (first === 'subtract' || first === 'intersect') result.fill(1);
	const shape = new Float32Array(width * height);
	const [a, b, c, d, e, f] = matrix;

	for (const mask of active) {
		const path = flattenBezierVertices(mask.vertices, 1, 1, 8).map(({ x, y }) => ({
			x: a * x + c * y + e,
			y: b * x + d * y + f,
		}));
		const touched = rasterizePaths([path], shape, width, height);
		const everywhere = mask.inverted || mask.mode === 'intersect' || mask.mode === 'darken';
		if (!touched && !everywhere) continue;
		const { x0, y0, x1, y1 } = everywhere ? { x0: 0, y0: 0, x1: width, y1: height } : touched!;
		for (let y = y0; y < y1; y++) {
			for (let i = y * width + x0; i < y * width + x1; i++) {
				const value = (mask.inverted ? 1 - shape[i]! : shape[i]!) * mask.opacity;
				const current = result[i]!;
				if (mask.mode === 'add') result[i] = current + value - current * value;
				else if (mask.mode === 'subtract') result[i] = current * (1 - value);
				else if (mask.mode === 'intersect') result[i] = current * value;
				else if (mask.mode === 'lighten') result[i] = Math.max(current, value);
				else if (mask.mode === 'darken') result[i] = Math.min(current, value);
				else result[i] = Math.abs(current - value);
				shape[i] = 0;
			}
		}
	}
	return result;
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

	let activeMasks = 0;
	let totalVertices = 0;

	for (const layerSpec of layers) {
		const states = layerSpec.masks
			.map((mask) => evaluateAnimatedMaskAtTime(mask, tSec))
			.filter((state) => state.visible && state.closed && state.vertices.length >= 2);
		if (states.length === 0) continue;
		activeMasks += states.length;
		totalVertices += states.reduce((sum, state) => sum + state.vertices.length, 0);
		const layerAlpha = rasterizeMaskStack(states, [scaleX, 0, 0, scaleY, 0, 0], width, height);

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
			...(opts.drawVertexHandles === undefined ? {} : { drawVertexHandles: opts.drawVertexHandles }),
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
