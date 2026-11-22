import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCurvesData, decodeParamDefault } from '../../src/motionvelix/aep-binary.js';
import {
	applyEffectCurves,
	applyEffectExposure,
	applyEffectMosaic,
	applyEffectRadialZoom,
	applyEffectRamp,
} from '../../src/motionvelix/mogrt-effects-color.js';
import { createRgbaBuffer, fillRgbaSolid, type RgbaBuffer } from '../../src/motionvelix/mogrt-effects-pipeline.js';
import { rasterizePaths, strokeConvexPath } from '../../src/motionvelix/mogrt-mask-renderer.js';

const pixel = (buffer: RgbaBuffer, x: number, y = 0): number[] => {
	const o = (y * buffer.width + x) * 4;
	return [...buffer.data.subarray(o, o + 4)];
};

const identity = (): Uint8Array => Uint8Array.from({ length: 256 }, (_, i) => i);

test('a float slider default is the float at byte 120, not zero or the last used value', () => {
	const pard = Buffer.alloc(148);
	pard.writeUInt32BE(10, 12);
	pard.write('Gamma Correction', 16, 'latin1');
	pard.writeDoubleBE(7, 56); // last used
	pard.writeFloatBE(1, 120);
	assert.deepEqual(decodeParamDefault(pard), { name: 'Gamma Correction', value: [1] });
});

test('Curves data holds five 256-entry tables: RGB, red, green, blue, alpha', () => {
	const data = Buffer.alloc(1644);
	data.writeUInt32BE(0x00010001, 0);
	for (let table = 0; table < 5; table++) data.fill(table + 1, 4 + table * 256, 4 + (table + 1) * 256);
	const curves = decodeCurvesData(data);
	assert.deepEqual(
		curves?.map((table) => [table.length, table[0], table[255]]),
		[1, 2, 3, 4, 5].map((value) => [256, value, value]),
	);
	assert.equal(decodeCurvesData(Buffer.alloc(100)), undefined);
});

test('Curves maps colour through its channel and the RGB table, and alpha through its own', () => {
	const half = Uint8Array.from({ length: 256 }, (_, i) => i >> 1);
	const threshold = Uint8Array.from({ length: 256 }, (_, i) => (i < 128 ? 0 : 255));
	const buffer = createRgbaBuffer(2, 1);
	buffer.data.set([200, 100, 40, 200, 200, 100, 40, 90]);
	applyEffectCurves(buffer, [half, identity(), half, identity(), threshold]);
	assert.deepEqual(pixel(buffer, 0), [100, 25, 20, 255]);
	assert.equal(pixel(buffer, 1)[3], 0);
});

test('Exposure works in linear light unless that conversion is bypassed', () => {
	const channel = { exposure: 1, offset: 0, gamma: 1 };
	const linear = createRgbaBuffer(1, 1);
	fillRgbaSolid(linear, 64, 64, 64, 77);
	applyEffectExposure(linear, [channel, channel, channel], false);
	assert.deepEqual(pixel(linear, 0), [88, 88, 88, 77]);

	const bypassed = createRgbaBuffer(1, 1);
	fillRgbaSolid(bypassed, 64, 64, 64, 77);
	applyEffectExposure(bypassed, [channel, channel, channel], true);
	assert.deepEqual(pixel(bypassed, 0), [128, 128, 128, 77]);
});

test('Ramp interpolates between its points, keeps alpha and honours Blend With Original', () => {
	const ramp = {
		start: { x: 0.5, y: 0 },
		end: { x: 4.5, y: 0 },
		startColor: [0, 0, 0] as [number, number, number],
		endColor: [200, 100, 40] as [number, number, number],
		radial: false,
	};
	const buffer = createRgbaBuffer(5, 1);
	fillRgbaSolid(buffer, 9, 9, 9, 120);
	applyEffectRamp(buffer, { ...ramp, blendWithOriginal: 0 });
	assert.deepEqual(pixel(buffer, 0), [0, 0, 0, 120]);
	assert.deepEqual(pixel(buffer, 2), [100, 50, 20, 120]);
	assert.deepEqual(pixel(buffer, 4), [200, 100, 40, 120]);

	const kept = createRgbaBuffer(5, 1);
	fillRgbaSolid(kept, 9, 9, 9, 120);
	applyEffectRamp(kept, { ...ramp, blendWithOriginal: 1 });
	assert.deepEqual(pixel(kept, 3), [9, 9, 9, 120]);
});

test('Mosaic averages or samples its blocks, and blocks under a pixel change nothing', () => {
	const source = [0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 40, 40, 40, 255];
	const run = (blocks: number, sharp: boolean): number[] => {
		const buffer = createRgbaBuffer(4, 1);
		buffer.data.set(source);
		applyEffectMosaic(buffer, { columns: blocks, rows: 1, sharp, x: 0, y: 0, width: 4, height: 1 });
		return [0, 1, 2, 3].map((x) => pixel(buffer, x)[0]!);
	};
	assert.deepEqual(run(2, false), [50, 50, 120, 120]);
	assert.deepEqual(run(2, true), [100, 100, 40, 40]);
	assert.deepEqual(run(4000, true), [0, 100, 200, 40]);
});

test('a fading zoom smears outwards from the centre, never inwards', () => {
	const buffer = createRgbaBuffer(101, 11);
	for (let y = 4; y <= 6; y++) {
		for (let x = 70; x <= 74; x++) buffer.data.set([255, 255, 255, 255], (y * 101 + x) * 4);
	}
	applyEffectRadialZoom(buffer, { centre: { x: 50.5, y: 5.5 }, amount: 50, type: 'fading' });
	const alpha = (x: number): number => pixel(buffer, x, 5)[3]!;
	assert.equal(alpha(64), 0, 'nothing moves towards the centre');
	assert.ok(alpha(80) > 5, `no trail: ${alpha(80)}`);
	assert.ok(alpha(72) > alpha(82), 'the trail fades');
});

test('a stroke is centred on its path and has mitred corners', () => {
	const square = [
		{ x: 4, y: 4 },
		{ x: 12, y: 4 },
		{ x: 12, y: 12 },
		{ x: 4, y: 12 },
	];
	const coverage = new Float32Array(16 * 16);
	rasterizePaths(strokeConvexPath(square, 4), coverage, 16, 16);
	const at = (x: number, y: number): number => Math.round(coverage[y * 16 + x]! * 100) / 100;
	assert.equal(at(2, 2), 1, 'mitred corner');
	assert.equal(at(8, 5), 1, 'inner half');
	assert.equal(at(8, 8), 0, 'hole');
	assert.equal(at(1, 8), 0, 'outside');
});
