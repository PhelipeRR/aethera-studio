import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEffectVegas, type VegasOptions } from '../../src/motionvelix/mogrt-effects-vegas.js';
import { createRgbaBuffer, type RgbaBuffer } from '../../src/motionvelix/mogrt-effects-pipeline.js';

const SIZE = 64;

/** A green square from 12 to 52, optionally with a hole from 26 to 38, stroked in red. */
const stroked = (overrides: Partial<VegasOptions> = {}, hole = false): RgbaBuffer => {
	const buffer = createRgbaBuffer(SIZE, SIZE);
	for (let y = 12; y < 52; y++) {
		for (let x = 12; x < 52; x++) {
			if (hole && x >= 26 && x < 38 && y >= 26 && y < 38) continue;
			buffer.data.set([0, 255, 0, 255], (y * SIZE + x) * 4);
		}
	}
	applyEffectVegas(buffer, {
		channel: 'alpha',
		invertInput: false,
		threshold: 127,
		segments: 1,
		length: 1,
		rotationDeg: 0,
		blend: 'transparent',
		color: [255, 0, 0],
		width: 4,
		hardness: 1,
		startOpacity: 1,
		midOpacity: 1,
		midPosition: 0.5,
		endOpacity: 1,
		...overrides,
	});
	return buffer;
};

const pixel = (buffer: RgbaBuffer, x: number, y: number): number[] => {
	const o = (y * SIZE + x) * 4;
	return [...buffer.data.slice(o, o + 4)];
};
const alpha = (buffer: RgbaBuffer, x: number, y: number): number => pixel(buffer, x, y)[3]!;
const ink = (buffer: RgbaBuffer): number => {
	let sum = 0;
	for (let o = 3; o < buffer.data.length; o += 4) sum += buffer.data[o]!;
	return sum;
};

test('Vegas strokes the contour and drops the rest', () => {
	const out = stroked();
	for (const [x, y] of [[32, 12], [51, 32], [32, 51], [12, 32]] as const) {
		assert.deepEqual(pixel(out, x, y), [255, 0, 0, 255], `no stroke at ${x},${y}`);
	}
	assert.equal(alpha(out, 32, 32), 0);
	assert.equal(alpha(out, 5, 32), 0);
});

test('Vegas also follows the contour of a hole', () => {
	assert.equal(alpha(stroked({}, true), 26, 32), 255);
});

test('Vegas contours close along the edge of the layer', () => {
	const buffer = createRgbaBuffer(16, 16);
	buffer.data.fill(255);
	applyEffectVegas(buffer, {
		channel: 'intensity',
		invertInput: false,
		threshold: 127,
		segments: 1,
		length: 1,
		rotationDeg: 0,
		blend: 'transparent',
		color: [255, 0, 0],
		width: 4,
		hardness: 1,
		startOpacity: 1,
		midOpacity: 1,
		midPosition: 0.5,
		endOpacity: 1,
	});
	assert.equal(buffer.data[(8 * 16 + 0) * 4 + 3], 255);
	assert.equal(buffer.data[(8 * 16 + 8) * 4 + 3], 0);
});

test('a segment covers its share of the contour and travels clockwise with Rotation', () => {
	const whole = ink(stroked());
	const first = stroked({ length: 0.25 });
	assert.ok(Math.abs(ink(first) / whole - 0.25) < 0.05, `share ${ink(first) / whole}`);
	assert.ok(alpha(first, 32, 12) > 0 && alpha(first, 32, 51) === 0, 'not on the top side at 0 degrees');
	const turned = stroked({ length: 0.25, rotationDeg: 90 });
	assert.ok(alpha(turned, 51, 32) > 0 && alpha(turned, 12, 32) === 0, 'not on the right side at 90 degrees');
	assert.deepEqual(stroked({ length: 0.25, rotationDeg: 720 }).data, first.data);
});

test('several segments are spread evenly', () => {
	const out = stroked({ segments: 2, length: 0.5 });
	assert.ok(alpha(out, 32, 12) > 0 && alpha(out, 32, 51) > 0);
	assert.ok(alpha(out, 51, 32) === 0 && alpha(out, 12, 32) === 0);
});

test('the opacity profile runs along the segment', () => {
	const out = stroked({ length: 0.25, startOpacity: 0, midOpacity: 1, endOpacity: 0 });
	assert.ok(alpha(out, 14, 12) < alpha(out, 22, 12) && alpha(out, 22, 12) < alpha(out, 31, 12));
	assert.ok(alpha(out, 31, 12) > alpha(out, 41, 12));
});

test('Vegas blend modes: stencil, over and under', () => {
	const stencil = stroked({ blend: 'stencil' });
	assert.deepEqual(pixel(stencil, 32, 12), [0, 255, 0, 255]);
	assert.equal(alpha(stencil, 32, 11), 0, 'stencil cannot add to the layer');
	assert.equal(alpha(stencil, 32, 32), 0);
	const over = stroked({ blend: 'over' });
	assert.deepEqual([pixel(over, 32, 12), pixel(over, 32, 32)], [[255, 0, 0, 255], [0, 255, 0, 255]]);
	const under = stroked({ blend: 'under' });
	assert.deepEqual([pixel(under, 32, 12), pixel(under, 32, 11)], [[0, 255, 0, 255], [255, 0, 0, 255]]);
});

test('a zero width leaves no stroke', () => {
	assert.equal(ink(stroked({ width: 0 })), 0);
});
