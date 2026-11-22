/**
 * MotionVelix MOGRT Engine: the Image Contours stroke of Vegas.
 *
 * Contours are traced by marching squares. After Effects' own tracing, and therefore the point where
 * a segment starts at 0 degrees, is not documented, so the stroke's phase is an approximation.
 */

import type { Vec2 } from './aep-binary.js';
import type { RgbaBuffer } from './mogrt-effects-pipeline.js';

export type VegasChannel = 'intensity' | 'red' | 'green' | 'blue' | 'alpha';
export type VegasBlend = 'transparent' | 'over' | 'under' | 'stencil';

export interface VegasOptions {
	channel: VegasChannel;
	invertInput: boolean;
	/** 0..255 */
	threshold: number;
	segments: number;
	/** Share of the space available to each segment, 0..1. */
	length: number;
	rotationDeg: number;
	blend: VegasBlend;
	color: [number, number, number];
	/** Buffer pixels. */
	width: number;
	/** 0..1, as are the opacities and the mid-point's position. */
	hardness: number;
	startOpacity: number;
	midOpacity: number;
	midPosition: number;
	endOpacity: number;
}

function channelLevels({ width, height, data }: RgbaBuffer, channel: VegasChannel, invert: boolean): Float32Array {
	const levels = new Float32Array(width * height);
	for (let i = 0; i < levels.length; i++) {
		const o = i * 4;
		let value: number;
		if (channel === 'alpha') value = data[o + 3]!;
		else {
			if (channel === 'red') value = data[o]!;
			else if (channel === 'green') value = data[o + 1]!;
			else if (channel === 'blue') value = data[o + 2]!;
			else value = 0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!;
			value *= data[o + 3]! / 255;
		}
		levels[i] = invert ? 255 - value : value;
	}
	return levels;
}

/** Closed loops around what is above `threshold`, clockwise around it. Beyond the buffer counts as below. */
function traceContours(levels: Float32Array, width: number, height: number, threshold: number): Vec2[][] {
	const at = (x: number, y: number): number =>
		x < 0 || y < 0 || x >= width || y >= height ? Math.min(0, threshold) : levels[y * width + x]!;
	const next = new Map<number, { point: Vec2; to: number }>();

	for (let y = -1; y < height; y++) {
		for (let x = -1; x < width; x++) {
			const corners = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
			const inside = corners.map((level) => level > threshold);
			if (inside.every((value) => value === inside[0])) continue;

			const key = (y + 1) * (width + 2) + x + 1;
			// Top, right, bottom and left, walked clockwise.
			const edges = [key * 2, (key + 1) * 2 + 1, (key + width + 2) * 2, key * 2 + 1];
			for (let k = 0; k < 4; k++) {
				// Only where the walk leaves the inside.
				if (!inside[k] || inside[(k + 1) % 4]) continue;
				let entry = (k + 1) % 4;
				while (inside[entry] || !inside[(entry + 1) % 4]) entry = (entry + 1) % 4;
				const t = (corners[k]! - threshold) / (corners[k]! - corners[(k + 1) % 4]!);
				const left = x + 0.5;
				const top = y + 0.5;
				const points: Vec2[] = [
					{ x: left + t, y: top },
					{ x: left + 1, y: top + t },
					{ x: left + 1 - t, y: top + 1 },
					{ x: left, y: top + 1 - t },
				];
				next.set(edges[k]!, { point: points[k]!, to: edges[entry]! });
			}
		}
	}

	const loops: Vec2[][] = [];
	for (const first of next.keys()) {
		const loop: Vec2[] = [];
		for (let edge = next.get(first), id = first; edge; edge = next.get(id)) {
			loop.push(edge.point);
			next.delete(id);
			id = edge.to;
		}
		if (loop.length > 2) loops.push(loop);
	}
	return loops;
}

/** Coverage, 0..1, of every segment of every contour. */
function strokeCoverage(loops: Vec2[][], width: number, height: number, options: VegasOptions): Float32Array {
	const coverage = new Float32Array(width * height);
	const radius = options.width / 2;
	if (radius <= 0) return coverage;
	const segments = Math.max(1, Math.round(options.segments));
	const share = Math.min(1, Math.max(0, options.length));
	const mid = Math.min(1 - 1e-6, Math.max(1e-6, options.midPosition));
	const { startOpacity, midOpacity, endOpacity } = options;
	const soft = Math.max(1, (1 - options.hardness) * radius);
	const thin = Math.min(1, options.width);
	const phase = ((options.rotationDeg / 360) % 1 + 1) % 1;

	for (const loop of loops) {
		const edges: Array<{ a: Vec2; dx: number; dy: number; from: number; length: number }> = [];
		let total = 0;
		for (let i = 0; i < loop.length; i++) {
			const a = loop[i]!;
			const b = loop[(i + 1) % loop.length]!;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const length = Math.hypot(dx, dy);
			if (length < 1e-6) continue;
			edges.push({ a, dx, dy, from: total, length });
			total += length;
		}
		const span = (total / segments) * share;
		if (span <= 0) continue;

		for (let segment = 0; segment < segments; segment++) {
			const start = ((phase + segment / segments) % 1) * total;
			for (const edge of edges) {
				// A segment can run past the loop's first point.
				for (const from of [edge.from - start, edge.from - start + total]) {
					const t0 = Math.max(0, -from) / edge.length;
					const t1 = Math.min(edge.length, span - from) / edge.length;
					if (t1 <= t0) continue;
					const ax = edge.a.x + edge.dx * t0;
					const ay = edge.a.y + edge.dy * t0;
					const dx = edge.dx * (t1 - t0);
					const dy = edge.dy * (t1 - t0);
					const squared = dx * dx + dy * dy;
					const room = radius + 1;
					const x0 = Math.max(0, Math.floor(Math.min(ax, ax + dx) - room));
					const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, ax + dx) + room));
					const y0 = Math.max(0, Math.floor(Math.min(ay, ay + dy) - room));
					const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, ay + dy) + room));
					for (let y = y0; y <= y1; y++) {
						for (let x = x0; x <= x1; x++) {
							const px = x + 0.5 - ax;
							const py = y + 0.5 - ay;
							const t = squared > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / squared)) : 0;
							const distance = Math.hypot(px - dx * t, py - dy * t);
							const edgeCover = Math.min(1, (radius + 0.5 - distance) / soft) * thin;
							if (edgeCover <= 0) continue;
							const along = (from + edge.length * (t0 + (t1 - t0) * t)) / span;
							const opacity =
								along < mid
									? startOpacity + (midOpacity - startOpacity) * (along / mid)
									: midOpacity + (endOpacity - midOpacity) * ((along - mid) / (1 - mid));
							const i = y * width + x;
							coverage[i] = Math.max(coverage[i]!, edgeCover * opacity);
						}
					}
				}
			}
		}
	}
	return coverage;
}

export function applyEffectVegas(buffer: RgbaBuffer, options: VegasOptions): void {
	const { width, height, data } = buffer;
	const levels = channelLevels(buffer, options.channel, options.invertInput);
	const coverage = strokeCoverage(traceContours(levels, width, height, options.threshold), width, height, options);
	const { blend, color } = options;

	for (let i = 0; i < coverage.length; i++) {
		const o = i * 4;
		const ink = Math.min(1, Math.max(0, coverage[i]!));
		const original = data[o + 3]! / 255;
		if (blend === 'stencil') {
			data[o + 3] = Math.round(data[o + 3]! * ink);
			continue;
		}
		const strokeWeight = blend === 'under' ? ink * (1 - original) : ink;
		const originalWeight = blend === 'transparent' ? 0 : blend === 'under' ? original : original * (1 - ink);
		const alpha = strokeWeight + originalWeight;
		data[o + 3] = Math.round(alpha * 255);
		if (alpha === 0) continue;
		for (let k = 0; k < 3; k++) {
			data[o + k] = Math.round((color[k]! * strokeWeight + data[o + k]! * originalWeight) / alpha);
		}
	}
}
