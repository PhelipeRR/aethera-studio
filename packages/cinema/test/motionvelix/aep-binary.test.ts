/**
 * Byte-layout tests. The record layouts were measured on an After Effects-authored project;
 * only structural numbers are reproduced here, no artwork.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	anchorToPixels,
	decodeCompHeader,
	decodeKeyframeRecord,
	decodeLayerHeader,
	decodeMaskHeader,
	decodeShapePath,
} from '../../src/motionvelix/aep-binary.js';

const TIME_SCALE = 30720;

function record(size: number, head: string, doubles: Array<[offset: number, value: number]>): Buffer {
	const buf = Buffer.alloc(size);
	Buffer.from(head, 'hex').copy(buf);
	for (const [offset, value] of doubles) buf.writeDoubleBE(value, offset);
	return buf;
}

test('comp header: duration is at 44/48, not at the playhead (20/24)', () => {
	const buf = Buffer.alloc(160);
	buf.writeUInt32BE(1024, 4);
	buf.writeUInt32BE(TIME_SCALE, 8);
	buf.writeUInt32BE(50176, 20);
	buf.writeUInt32BE(TIME_SCALE, 24);
	buf.writeUInt32BE(223232, 44);
	buf.writeUInt32BE(TIME_SCALE, 48);
	buf.writeUInt16BE(4096, 140);
	buf.writeUInt16BE(2304, 142);
	buf.writeUInt16BE(30, 156);
	const header = decodeCompHeader(buf);
	assert.ok(Math.abs(header.durationSec - 109 / 15) < 1e-9);
	assert.deepEqual([header.width, header.height, header.fps], [4096, 2304, 30]);
});

test('layer header: in and out are relative to startTime; flags, source and parent', () => {
	const buf = Buffer.alloc(160);
	buf.writeInt32BE(1, 8);
	buf.writeUInt32BE(1, 108);
	buf.writeInt32BE(12288, 12);
	buf.writeUInt32BE(TIME_SCALE, 16);
	buf.writeInt32BE(0, 20);
	buf.writeUInt32BE(TIME_SCALE, 24);
	buf.writeInt32BE(210944, 28);
	buf.writeUInt32BE(TIME_SCALE, 32);
	Buffer.from('00008007', 'hex').copy(buf, 36);
	buf.writeUInt32BE(701, 40);
	buf.writeUInt32BE(4, 96);
	buf.writeUInt32BE(2, 104);
	buf.writeUInt32BE(766, 132);
	const layer = decodeLayerHeader(buf);
	assert.ok(Math.abs(layer.inPointSec - 0.4) < 1e-9);
	assert.ok(Math.abs(layer.outPointSec - (0.4 + 210944 / TIME_SCALE)) < 1e-9);
	assert.deepEqual(
		[layer.visible, layer.isNull, layer.adjustment, layer.sourceId, layer.parentLayerId],
		[true, true, false, 701, 766],
	);
	assert.deepEqual([layer.blendMode, layer.trackMatte], ['add', 'alpha_inverted']);
});

test('layer header: Color, stencil and silhouette blend ids', () => {
	const modes = [15, 17, 18, 19, 20].map((id) => {
		const buf = Buffer.alloc(160);
		buf.writeUInt32BE(id, 96);
		const { blendMode, unsupportedBlendId } = decodeLayerHeader(buf);
		return unsupportedBlendId ?? blendMode;
	});
	assert.deepEqual(modes, ['color', 'stencil_alpha', 'stencil_luma', 'silhouette_alpha', 'silhouette_luma']);
});

test('layer header: hidden matte layer', () => {
	const buf = Buffer.alloc(160);
	Buffer.from('00000086', 'hex').copy(buf, 36);
	assert.equal(decodeLayerHeader(buf).visible, false);
});

test('scalar keyframe: signed time and bezier interpolation', () => {
	const key = decodeKeyframeRecord(
		record(48, 'ffffec0002020000', [
			[8, 270],
			[24, 0.8],
			[40, 1 / 3],
		]),
		{ dimensions: 1, spatial: false, timeScale: TIME_SCALE },
	);
	assert.ok(Math.abs(key.timeSec + 5120 / TIME_SCALE) < 1e-9);
	assert.deepEqual(key.values, [270]);
	assert.equal(key.interpolation, 'bezier');
});

test('3D non-spatial keyframe: values start at byte 8', () => {
	const key = decodeKeyframeRecord(
		record(128, '0000b40002020000', [
			[8, 1.35],
			[16, 1.25],
			[24, 1],
		]),
		{ dimensions: 3, spatial: false, timeScale: TIME_SCALE },
	);
	assert.deepEqual(key.values, [1.35, 1.25, 1]);
});

test('3D spatial keyframe: values start at byte 56', () => {
	const key = decodeKeyframeRecord(
		record(128, '0000fc0002020007', [
			[16, 2763],
			[56, 2048],
			[64, 1153],
			[112, -460.5],
		]),
		{ dimensions: 3, spatial: true, timeScale: TIME_SCALE },
	);
	assert.deepEqual(key.values, [2048, 1153, 0]);
});

test('hold keyframe', () => {
	const key = decodeKeyframeRecord(record(48, '0000080003030000', [[8, 1]]), {
		dimensions: 1,
		spatial: false,
		timeScale: TIME_SCALE,
	});
	assert.equal(key.interpolation, 'hold');
});

test('mask header: mode is u16 at byte 6, not the mask index at byte 8', () => {
	const header = decodeMaskHeader(Buffer.from('00000000000000060000003e', 'hex'));
	assert.equal(header.mode, 'difference');
	assert.equal(header.inverted, false);
});

test('shape path: bounds and points are (x, y)', () => {
	const shph = Buffer.alloc(24);
	[0.25, 0.5, 0.75, 1].forEach((value, i) => shph.writeFloatBE(value, 4 + i * 4));
	const points = Buffer.alloc(24);
	[0, 1, 0.5, 1, 1, 0].forEach((value, i) => points.writeFloatBE(value, i * 4));
	const path = decodeShapePath(shph, points, 3, { width: 1920, height: 1080 });
	assert.equal(path.closed, true);
	assert.deepEqual(path.vertices[0]?.point, { x: 480, y: 1080 });
	assert.deepEqual(path.vertices[0]?.outHandle, { x: 960, y: 1080 });
	assert.deepEqual(path.vertices[0]?.inHandle, { x: 1440, y: 540 });
});

test('shape path: text and shape layers store mask points in pixels', () => {
	const shph = Buffer.alloc(24);
	[-216.5, -194.5, 276.5, 306.5].forEach((value, i) => shph.writeFloatBE(value, 4 + i * 4));
	const points = Buffer.alloc(24);
	[0, 0, 1, 0, 1, 1].forEach((value, i) => points.writeFloatBE(value, i * 4));
	const path = decodeShapePath(shph, points, 3, undefined);
	assert.deepEqual(path.vertices[0]?.point, { x: -216.5, y: -194.5 });
	assert.deepEqual(path.bounds, { top: -194.5, left: -216.5, bottom: 306.5, right: 276.5 });
});

test('anchor: normalized for sourced layers, pixels for text and shape layers', () => {
	assert.deepEqual(anchorToPixels([0.5, 0.5, 0], { width: 100, height: 100 }), [50, 50, 0]);
	assert.deepEqual(anchorToPixels([-3.06, -55.77, 0], undefined), [-3.06, -55.77, 0]);
});
