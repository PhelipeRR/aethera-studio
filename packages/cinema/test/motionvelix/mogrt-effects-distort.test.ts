import test from 'node:test';
import assert from 'node:assert/strict';
import {
	applyEffectDisplacementMap,
	applyEffectFractalNoise,
	applyEffectTurbulentDisplace,
	type FractalNoiseOptions,
	type TurbulentDisplaceOptions,
} from '../../src/motionvelix/mogrt-effects-distort.js';
import { createRgbaBuffer, fillRgbaSolid, type RgbaBuffer } from '../../src/motionvelix/mogrt-effects-pipeline.js';

const WIDTH = 160;
const HEIGHT = 96;

const noise = (overrides: Partial<FractalNoiseOptions> = {}): RgbaBuffer => {
	const buffer = createRgbaBuffer(WIDTH, HEIGHT);
	fillRgbaSolid(buffer, 255, 255, 255, 255);
	applyEffectFractalNoise(buffer, {
		fractal: 'strings',
		invert: false,
		contrast: 250,
		brightness: 0,
		cellWidth: 400,
		cellHeight: 12,
		rotationDeg: 0,
		offset: { x: 0, y: 0 },
		complexity: 2,
		subInfluence: 0.7,
		subScaling: 0.56,
		evolutionDeg: 0,
		seed: 0,
		opacity: 1,
		...overrides,
	});
	return buffer;
};

const mean = (buffer: RgbaBuffer): number => {
	let sum = 0;
	for (let o = 0; o < buffer.data.length; o += 4) sum += buffer.data[o]!;
	return sum / (buffer.data.length / 4);
};

const red = (buffer: RgbaBuffer, x: number, y: number): number => buffer.data[(y * buffer.width + x) * 4]!;

test('Fractal Noise is deterministic and follows evolution and seed', () => {
	assert.deepEqual(noise().data, noise().data);
	assert.notDeepEqual(noise().data, noise({ evolutionDeg: 140 }).data);
	assert.notDeepEqual(noise().data, noise({ seed: 3 }).data);
});

test('Fractal Noise brightness wipes from nearly black to white', () => {
	const levels = [-100, 0, 100, 270].map((brightness) => mean(noise({ brightness })));
	assert.ok(levels[0]! < 64, `not dark: ${levels[0]}`);
	assert.ok(levels[0]! < levels[1]! && levels[1]! < levels[2]! && levels[2]! <= levels[3]!, `not a wipe: ${levels}`);
	assert.ok(levels[3]! > 250, `not white: ${levels[3]}`);
});

test('a stretched Fractal Noise makes horizontal streaks', () => {
	const buffer = noise();
	let across = 0;
	let down = 0;
	for (let y = 0; y < HEIGHT - 1; y++) {
		for (let x = 0; x < WIDTH - 1; x++) {
			across += Math.abs(red(buffer, x + 1, y) - red(buffer, x, y));
			down += Math.abs(red(buffer, x, y + 1) - red(buffer, x, y));
		}
	}
	assert.ok(down > across * 3, `across ${across}, down ${down}`);
});

const displace = (band: 'row' | 'column', overrides: Partial<TurbulentDisplaceOptions>) => {
	const before = createRgbaBuffer(64, 64);
	for (let y = 0; y < 64; y++) {
		for (let x = 0; x < 64; x++) {
			const along = band === 'row' ? y : x;
			if (along >= 28 && along < 36) before.data.set([255, 255, 255, 255], (y * 64 + x) * 4);
		}
	}
	const after = { ...before, data: new Uint8Array(before.data) };
	applyEffectTurbulentDisplace(after, {
		kind: 'turbulent',
		amount: 100,
		size: 16,
		complexity: 1,
		evolutionDeg: 30,
		seed: 1,
		offset: { x: 32, y: 32 },
		scale: 1,
		padding: 0,
		pinned: false,
		...overrides,
	});
	return { before, after };
};

test('Turbulent Displace with no amount changes nothing', () => {
	const { before, after } = displace('row', { amount: 0 });
	assert.deepEqual(after.data, before.data);
});

test('Horizontal Displacement only moves pixels sideways', () => {
	const row = displace('row', { kind: 'horizontal' });
	// The band's middle stays put; only its ends could pick up the transparent outside.
	for (let y = 0; y < 64; y++) assert.equal(red(row.after, 32, y), red(row.before, 32, y), `row ${y} moved`);
	const column = displace('column', { kind: 'horizontal' });
	assert.notDeepEqual(column.after.data, column.before.data);
});

test('Pin All holds the border', () => {
	const { before, after } = displace('row', { pinned: true, amount: 200 });
	for (let y = 0; y < 64; y++) {
		assert.ok(Math.abs(red(after, 0, y) - red(before, 0, y)) <= 40, `left border moved at ${y}`);
	}
	assert.notDeepEqual(after.data, before.data);
});

test('Displacement Map moves by the map value around middle grey', () => {
	const shifted = (level: number): number => {
		const buffer = createRgbaBuffer(21, 1);
		buffer.data.set([255, 255, 255, 255], 10 * 4);
		const map = createRgbaBuffer(21, 1);
		fillRgbaSolid(map, level, level, level, 255);
		applyEffectDisplacementMap(buffer, map, {
			horizontal: { channel: 'luma', max: 4 },
			vertical: { channel: 'off', max: 9 },
			wrap: false,
			mapBounds: { x0: 0, y0: 0, x1: 21, y1: 1 },
		});
		let best = 0;
		for (let x = 0; x < 21; x++) if (buffer.data[x * 4 + 3]! > buffer.data[best * 4 + 3]!) best = x;
		return best;
	};
	assert.deepEqual([shifted(255), shifted(128), shifted(0)], [14, 10, 6]);
});
