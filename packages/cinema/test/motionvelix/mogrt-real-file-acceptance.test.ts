/**
 * Acceptance against real After Effects `.mogrt` files.
 *
 * The commercial pack is never committed. Point MOTIONVELIX_MOGRT_PACK_DIR at the extracted
 * "Dynamic Anime Burst Logo Pack" folder. Without it the suite is reported as skipped; with it,
 * a missing or different file is a failure, never a fallback to a synthetic fixture.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { parseAepProjectGraph } from '../../src/motionvelix/aep-comp-graph.js';
import {
	renderMogrtFrameRgba,
	renderMogrtPhase3AToMp4,
	type MogrtRenderOverrides,
} from '../../src/motionvelix/mogrt-comp-renderer.js';
import type { RgbaBuffer } from '../../src/motionvelix/mogrt-effects-pipeline.js';
import { inspectMogrtFile } from '../../src/motionvelix/mogrt-importer.js';

const packDir = process.env.MOTIONVELIX_MOGRT_PACK_DIR;
const skip = packDir ? false : 'set MOTIONVELIX_MOGRT_PACK_DIR to run against the real .mogrt files';

interface Model {
	file: string;
	sha256: string;
	durationSec: number;
}

const MODEL_01: Model = {
	file: 'Dynamic Anime Burst Logo 01.mogrt',
	sha256: '742d296d11a90b0b8b35b5394c7a9404790e128ec6246f92188b36df619d96cc',
	durationSec: 109 / 15,
};
const MODEL_02: Model = {
	file: 'Dynamic Anime Burst Logo 02.mogrt',
	sha256: 'e3420357df866c9aa0749d4a5baed41fee6b2ee63be3ffc84bdaf1c9b5745552',
	durationSec: 211 / 30,
};

/**
 * thumb.png of model 01 is the Transition 01 hold frame [10/15 s, 11/15 s).
 * It is not the saved playhead (49/30 s), where that silhouette is almost gone.
 */
const THUMB_TIME_SEC = 2 / 3;
/** thumb.png of model 02 is this frame. */
const THUMB_02_TIME_SEC = 16 / 30;
const WIDTH = 800;
const HEIGHT = 450;

type ColourMatch = (r: number, g: number, b: number) => boolean;

const tempDirs: string[] = [];
after(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'mogrt-real-'));
	tempDirs.push(dir);
	return dir;
}

function modelPath(model: Model): string {
	return join(packDir ?? '', model.file);
}

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function render(tSec: number, overrides?: MogrtRenderOverrides, model: Model = MODEL_01) {
	return renderMogrtFrameRgba({
		mogrtPath: modelPath(model),
		workDir: tempDir(),
		tSec,
		width: WIDTH,
		height: HEIGHT,
		...(overrides ? { overrides } : {}),
	});
}

/** Colour of pixel `i` composited over black. */
function overBlack(data: Uint8Array, i: number): [number, number, number] {
	const a = data[i + 3]! / 255;
	return [data[i]! * a, data[i + 1]! * a, data[i + 2]! * a];
}

function coverage(frame: RgbaBuffer, match: ColourMatch): number {
	let hits = 0;
	for (let i = 0; i < frame.data.length; i += 4) {
		if (match(...overBlack(frame.data, i))) hits++;
	}
	return hits / (frame.width * frame.height);
}

function meanAbsoluteDifference(a: RgbaBuffer, b: RgbaBuffer): number {
	let sum = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		const left = overBlack(a.data, i);
		const right = overBlack(b.data, i);
		for (let c = 0; c < 3; c++) sum += Math.abs(left[c]! - right[c]!);
	}
	return sum / ((a.data.length / 4) * 3);
}

function overlap(a: Uint8Array, b: Uint8Array, match: ColourMatch): number {
	let both = 0;
	let either = 0;
	for (let i = 0; i < a.length; i += 4) {
		const inA = match(...overBlack(a, i));
		const inB = match(...overBlack(b, i));
		if (inA && inB) both++;
		if (inA || inB) either++;
	}
	return either ? both / either : 0;
}

function writeLogo(dir: string, name: string, fill: string): string {
	const path = join(dir, name);
	writeFileSync(
		path,
		`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><circle cx="250" cy="250" r="230" fill="${fill}"/></svg>`,
	);
	return path;
}

describe('real .mogrt acceptance', { skip }, () => {
	for (const model of [MODEL_01, MODEL_02]) {
		test(`${model.file}: is the expected commercial file`, () => {
			assert.equal(sha256(modelPath(model)), model.sha256);
		});

		test(`${model.file}: duration, frame size and fps match definition.json`, () => {
			const info = inspectMogrtFile(modelPath(model), tempDir());
			assert.ok(info.aepPath);
			const graph = parseAepProjectGraph(info.aepPath, { preferredRootCompName: info.name });
			const root = graph.compositionsById.get(graph.rootCompId);
			assert.ok(root);
			assert.ok(Math.abs(root.durationSec - model.durationSec) < 1e-3, `duration ${root.durationSec}`);
			assert.deepEqual([root.width, root.height, root.fps], [4096, 2304, 30]);
		});

		test(`${model.file}: renders visible, animated content`, () => {
			const frames = [0.5, 2 / 3, 1, 3].map((t) => render(t, undefined, model).frame);
			const lit = frames.map((frame) => coverage(frame, (r, g, b) => r + g + b > 60));
			assert.ok(Math.max(...lit) > 0.05, `frames are black: ${lit.join(', ')}`);
			assert.ok(meanAbsoluteDifference(frames[0]!, frames[1]!) > 1, 'frames do not animate');
		});
	}

	test('model 01: masks use Difference mode and are all decoded', () => {
		const info = inspectMogrtFile(modelPath(MODEL_01), tempDir());
		assert.ok(info.aepPath);
		const transition = parseAepProjectGraph(info.aepPath).compositionsByName.get('Transition 01');
		assert.ok(transition);
		assert.equal(transition.totalMasks, 90);
		assert.equal(transition.totalShapeKeyframes, 620);
		const modes = transition.layers.flatMap((layer) => layer.masks.map((mask) => mask.mode));
		assert.deepEqual([...new Set(modes)], ['difference']);
	});

	test('model 01: the thumb hold frame overlaps thumb.png', async () => {
		const result = render(THUMB_TIME_SEC);
		assert.ok(result.masksRasterized > 0, 'no mask was rasterized');
		assert.ok(result.inspection.thumbnailPath);
		// 800x600 thumbnail with the 16:9 picture letterboxed between y=75 and y=525.
		const thumb = await sharp(result.inspection.thumbnailPath)
			.extract({ left: 0, top: 75, width: WIDTH, height: HEIGHT })
			.ensureAlpha()
			.raw()
			.toBuffer();
		const silhouette = overlap(result.frame.data, thumb, (r, g, b) => Math.max(r, g, b) > 170);
		const white = overlap(result.frame.data, thumb, (r, g, b) => Math.min(r, g, b) > 200);
		assert.ok(silhouette >= 0.85, `silhouette IoU ${silhouette}`);
		assert.ok(white >= 0.7, `white IoU ${white}`);
	});

	test('model 02: the thumb frame matches thumb.png', async () => {
		const { frame, inspection } = render(THUMB_02_TIME_SEC, undefined, MODEL_02);
		assert.ok(inspection.thumbnailPath);
		const data = await sharp(inspection.thumbnailPath)
			.extract({ left: 0, top: 75, width: WIDTH, height: HEIGHT })
			.ensureAlpha()
			.raw()
			.toBuffer();
		const clouds = overlap(frame.data, data, (r, _g, b) => b > r + 25);
		assert.ok(clouds >= 0.85, `clouds IoU ${clouds}`);
		const difference = meanAbsoluteDifference(frame, { width: WIDTH, height: HEIGHT, data: new Uint8Array(data) });
		assert.ok(difference < 15, `thumb MAE ${difference}`);
	});

	test('model 02: the silhouette matte cuts instead of painting a solid rectangle', () => {
		const { frame } = render(1.5, undefined, MODEL_02);
		const yellow = coverage(frame, (r, g, b) => r > 150 && g > 130 && r > b + 35);
		assert.ok(yellow < 0.05, `solid yellow covers ${yellow} of the frame`);
	});

	test('model 02: masked shape layers draw a smoke ring, not their whole rectangle', () => {
		const { frame } = render(2 / 3, undefined, MODEL_02);
		const yellowShare = (x0: number, y0: number, x1: number, y1: number): number => {
			let hits = 0;
			for (let y = y0; y < y1; y++) {
				for (let x = x0; x < x1; x++) {
					const [r, g, b] = overBlack(frame.data, (y * WIDTH + x) * 4);
					if (r > 200 && g > 180 && r > b + 35) hits++;
				}
			}
			return hits / ((x1 - x0) * (y1 - y0));
		};
		const hole = yellowShare(370, 180, 410, 220);
		const ring = yellowShare(300, 120, 480, 290);
		assert.ok(hole < 0.02, `the middle of the ring is filled: ${hole}`);
		assert.ok(ring > 0.15, `the smoke ring is missing: ${ring}`);
	});

	test('model 01: long text is not clipped by its collapsed pre-composition', () => {
		const { frame } = render(5, { textOverride: 'W'.repeat(20) });
		let left = WIDTH;
		let right = -1;
		for (let i = 0; i < frame.data.length; i += 4) {
			const [r, g, b] = overBlack(frame.data, i);
			if (r + g + b <= 150) continue;
			left = Math.min(left, (i / 4) % WIDTH);
			right = Math.max(right, (i / 4) % WIDTH);
		}
		assert.ok(right - left > WIDTH * 0.3, `text spans only ${right - left}px`);
	});

	test('model 01: Transition Color 02 recolours the transition', () => {
		const { frame } = render(THUMB_TIME_SEC, { controls: { 'Transition Color 02': '#00ff00' } });
		assert.ok(coverage(frame, (r, g, b) => g > 150 && r < 120 && b < 120) > 0.1);
	});

	test('model 01: a logo replacement reaches the placeholder', () => {
		const dir = tempDir();
		const red = render(3, { logoPath: writeLogo(dir, 'red.svg', '#ff0000') });
		const blue = render(3, { logoPath: writeLogo(dir, 'blue.svg', '#0000ff') });
		assert.equal(red.logoSubstituted, true);
		assert.ok(coverage(red.frame, (r, g, b) => r > 150 && g < 90 && b < 90) > 0.005, 'red logo is not visible');
		assert.ok(coverage(blue.frame, (r, g, b) => b > 150 && r < 90 && g < 90) > 0.005, 'blue logo is not visible');
	});

	for (const model of [MODEL_01, MODEL_02]) {
		test(`${model.file}: the shine stays inside a replaced logo`, () => {
			const logoPath = writeLogo(tempDir(), 'cyan.svg', '#00ffff');
			let inside = 0;
			let outside = 0;
			for (const tSec of [3.25, 4, 4.25, 4.5, 4.75]) {
				const { frame } = render(tSec, { logoPath }, model);
				for (let y = 100; y < 310; y++) {
					for (let x = 320; x < 720; x++) {
						// Cyan has no red and a high luma, which the shine matte reads. Past x = 530 only faint glow may remain.
						const [red] = overBlack(frame.data, (y * WIDTH + x) * 4);
						if (x < 480) inside = Math.max(inside, red);
						else if (x >= 530) outside = Math.max(outside, red);
					}
				}
			}
			assert.ok(inside > 80, `the shine is missing from the logo: ${inside}`);
			assert.ok(outside < 70, `the shine spills out of the logo: ${outside}`);
		});
	}

	test('model 01: edited text changes the rendered tagline', () => {
		const narrow = render(4.5, { textOverride: 'IIII' }).frame;
		const wide = render(4.5, { textOverride: 'WWWWWWWW' }).frame;
		assert.ok(meanAbsoluteDifference(narrow, wide) > 0.05);
	});

	test('model 01: the BG checkbox and colour fill the background', () => {
		const { frame } = render(5, { controls: { BG: true, 'BG Color': '#0000ff' } });
		assert.ok(coverage(frame, (r, g, b) => b > 150 && r < 80 && g < 80) > 0.5);
	});

	test('model 01: an unknown control is rejected instead of ignored', () => {
		assert.throws(() => render(1, { controls: { 'Primary Color': '#ff0000' } }), /Primary Color/);
	});

	test('model 01: full export has the template duration and leaves the file untouched', async () => {
		const dir = tempDir();
		const output = join(dir, 'out.mp4');
		await renderMogrtPhase3AToMp4({
			mogrtPath: modelPath(MODEL_01),
			workDir: dir,
			outputMp4Path: output,
			width: 160,
			height: 90,
		});
		const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output], {
			encoding: 'utf8',
		});
		assert.equal(probe.status, 0, probe.stderr);
		assert.ok(Math.abs(Number(probe.stdout) - MODEL_01.durationSec) <= 1 / 30, `mp4 ${probe.stdout}`);
		assert.equal(sha256(modelPath(MODEL_01)), MODEL_01.sha256);
	});
});
