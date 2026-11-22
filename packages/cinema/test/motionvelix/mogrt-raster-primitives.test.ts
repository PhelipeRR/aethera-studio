import test from 'node:test';
import assert from 'node:assert/strict';
import type { BezierVertex } from '../../src/motionvelix/aep-binary.js';
import {
	applyEffectDropShadow,
	applyEffectShiftChannels,
	compositeLayerAffine,
	createRgbaBuffer,
	fillRgbaSolid,
	type RgbaBuffer,
} from '../../src/motionvelix/mogrt-effects-pipeline.js';
import { rasterizeMaskStack } from '../../src/motionvelix/mogrt-mask-renderer.js';

const IDENTITY = [1, 0, 0, 1, 0, 0] as const;

function square(x0: number, y0: number, x1: number, y1: number): BezierVertex[] {
	return [
		{ x: x0, y: y0 },
		{ x: x1, y: y0 },
		{ x: x1, y: y1 },
		{ x: x0, y: y1 },
	].map((point) => ({ point, outHandle: point, inHandle: point }));
}

function pixel(buf: RgbaBuffer, x: number, y: number): number[] {
	const o = (y * buf.width + x) * 4;
	return [...buf.data.subarray(o, o + 4)];
}

test('Difference masks cancel where they overlap', () => {
	const mask = (vertices: BezierVertex[]) => ({ mode: 'difference' as const, inverted: false, opacity: 1, vertices });
	const coverage = rasterizeMaskStack([mask(square(0, 0, 20, 20)), mask(square(10, 0, 30, 20))], IDENTITY, 32, 24);
	assert.deepEqual([5, 15, 25, 31].map((x) => coverage[10 * 32 + x]), [1, 0, 1, 0]);
});

test('mask coverage follows the layer transform', () => {
	const mask = { mode: 'add' as const, inverted: false, opacity: 1, vertices: square(0, 0, 10, 10) };
	const coverage = rasterizeMaskStack([mask], [2, 0, 0, 2, 4, 0], 32, 24);
	assert.deepEqual([2, 5, 23, 25].map((x) => coverage[10 * 32 + x]), [0, 1, 1, 0]);
});

test('drop shadow is offset along the AE direction and stays behind the layer', () => {
	const buf = createRgbaBuffer(40, 20);
	for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) buf.data.set([255, 255, 255, 255], (y * 40 + x) * 4);
	applyEffectDropShadow(buf, { color: [255, 0, 0], opacity: 1, directionDeg: 90, distancePx: 10, softnessPx: 0 });
	assert.deepEqual(pixel(buf, 10, 10), [255, 255, 255, 255]);
	assert.deepEqual(pixel(buf, 20, 10), [255, 0, 0, 255]);
	assert.deepEqual(pixel(buf, 30, 10), [0, 0, 0, 0]);
});

test('Shift Channels can take alpha from luminance', () => {
	const buf = createRgbaBuffer(1, 1);
	fillRgbaSolid(buf, 0, 0, 0, 255);
	applyEffectShiftChannels(buf, { alpha: 5, red: 2, green: 3, blue: 4 });
	assert.deepEqual(pixel(buf, 0, 0), [0, 0, 0, 0]);
});

test('Silhouette Alpha cuts what is below and Stencil Alpha keeps only that area', () => {
	const alphaAfter = (mode: 'silhouette_alpha' | 'stencil_alpha') => {
		const dst = createRgbaBuffer(20, 10);
		fillRgbaSolid(dst, 200, 100, 50, 255);
		const src = createRgbaBuffer(10, 10);
		fillRgbaSolid(src, 255, 255, 0, 255);
		compositeLayerAffine(dst, src, IDENTITY, 1, mode);
		return [pixel(dst, 5, 5)[3], pixel(dst, 15, 5)[3]];
	};
	assert.deepEqual(alphaAfter('silhouette_alpha'), [0, 255]);
	assert.deepEqual(alphaAfter('stencil_alpha'), [255, 0]);
});

test('Color blend takes hue and saturation from the layer and luminosity from below', () => {
	const dst = createRgbaBuffer(3, 3);
	fillRgbaSolid(dst, 128, 128, 128, 255);
	const src = createRgbaBuffer(3, 3);
	fillRgbaSolid(src, 200, 100, 100, 255);
	compositeLayerAffine(dst, src, IDENTITY, 1, 'color');
	assert.deepEqual(pixel(dst, 1, 1), [198, 98, 98, 255]);
});

test('affine composite places the source and keeps its colour over transparency', () => {
	const dst = createRgbaBuffer(40, 20);
	const src = createRgbaBuffer(5, 5);
	fillRgbaSolid(src, 40, 80, 120, 255);
	compositeLayerAffine(dst, src, [2, 0, 0, 2, 20, 4], 1, 'multiply');
	assert.deepEqual(pixel(dst, 25, 9), [40, 80, 120, 255]);
	assert.deepEqual(pixel(dst, 10, 9), [0, 0, 0, 0]);
});
