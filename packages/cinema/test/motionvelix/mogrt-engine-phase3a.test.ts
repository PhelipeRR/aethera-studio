/**
 * Pipeline tests on a synthetic project, so they run without the commercial pack. They do not prove
 * compatibility with After Effects files: mogrt-real-file-acceptance.test.ts does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	evaluatePropertyAtTime,
	parseAepProjectGraph,
	type AepAnimatedProperty,
} from '../../src/motionvelix/aep-comp-graph.js';
import { buildSyntheticMogrt, SYNTHETIC_MOGRT } from '../../src/motionvelix/aep-fixture-builder.js';
import {
	applyEffectBoxBlur,
	applyEffectFill,
	applyEffectGlow,
	applyEffectNoise,
	applyEffectSetMatte,
	applyEffectSimpleChoker,
	applyEffectTint,
	compositeLayerTransformed,
	createRgbaBuffer,
	fillRgbaSolid,
} from '../../src/motionvelix/mogrt-effects-pipeline.js';
import {
	evaluateAeExpression,
	hexStringToRgba01,
} from '../../src/motionvelix/mogrt-expression-eval.js';
import { inspectMogrtFile } from '../../src/motionvelix/mogrt-importer.js';
import { rasterizeSvgToPngSync, sha256File } from '../../src/motionvelix/mogrt-media-loader.js';
import {
	renderMogrtFrameRgba,
	renderMogrtPhase3AToMp4,
	type MogrtRenderOverrides,
} from '../../src/motionvelix/mogrt-comp-renderer.js';

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function createSampleSvgLogo(outPath: string, primaryHex: string): void {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <polygon points="200,32 356,332 44,332" fill="${primaryHex}" stroke="#ffffff" stroke-width="14"/>
  <circle cx="200" cy="220" r="56" fill="#0f172a" stroke="#ffffff" stroke-width="10"/>
</svg>`;
	writeFileSync(outPath, svg, 'utf8');
}

function createSamplePngLogo(outPath: string, primaryHex: string): void {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect x="48" y="48" width="304" height="304" rx="56" fill="${primaryHex}" stroke="#ffffff" stroke-width="14"/>
  <path d="M125 275 L200 110 L275 275 M155 220 L245 220" fill="none" stroke="#ffffff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
	rasterizeSvgToPngSync(svg, outPath, 400, 400);
}

function meanAbsDiffRgba(a: Uint8Array, b: Uint8Array): number {
	assert.equal(a.length, b.length);
	let sum = 0;
	for (let i = 0; i < a.length; i += 4) {
		sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
	}
	return sum / ((a.length / 4) * 3);
}

test('Phase 3A: synthetic project decodes timing, nesting, masks, controls and unsupported effects', () => {
	const dir = createTempDir('mvx-p3a-graph-');
	try {
		const mogrtPath = join(dir, 'synthetic.mogrt');
		buildSyntheticMogrt(mogrtPath);
		const inspection = inspectMogrtFile(mogrtPath, join(dir, 'inspect'));
		assert.ok(inspection.aepPath && existsSync(inspection.aepPath));

		const graph = parseAepProjectGraph(inspection.aepPath, { preferredRootCompName: inspection.name });
		assert.deepEqual(graph.warnings, []);
		assert.equal(graph.compositions.length, 3);
		assert.equal(graph.rootCompName, SYNTHETIC_MOGRT.name);

		const root = graph.compositionsById.get(graph.rootCompId);
		assert.ok(root);
		assert.deepEqual([root.width, root.height, root.fps, root.durationSec], [640, 360, 30, 2]);
		assert.equal(inspection.durationSec, 2);

		const burst = graph.compositionsByName.get('Burst');
		assert.ok(burst);
		assert.equal(burst.fps, 15, 'a nested composition keeps its own frame rate');
		assert.equal(burst.totalMasks, 2);
		assert.equal(burst.totalShapeKeyframes, 4);
		const mask = burst.layers[0]!.masks[0]!;
		assert.equal(mask.mode, 'difference');
		assert.deepEqual(mask.shapeKeyframes[0]!.vertices[0]!.point, { x: 160, y: 90 });

		const logo = root.layers.find((layer) => layer.kind === 'logo_placeholder');
		assert.ok(logo, 'the media control marks the logo placeholder');
		assert.deepEqual(logo.sourceSize, { width: 100, height: 100 });
		assert.deepEqual(
			graph.controls.map((control) => [control.name, control.kind]),
			[
				['Burst Color', 'color'],
				['Logo Placeholder', 'media'],
			],
		);
		assert.deepEqual(graph.unsupportedEffects.map((effect) => effect.matchName), ['ADBE Wave Warp']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('Phase 3A: Keyframe evaluator handles linear, bezier smoothstep, and hold interpolation accurately', () => {
	const propLinear: AepAnimatedProperty = {
		matchName: 'ADBE Position',
		staticValue: [0, 0],
		keyframes: [
			{ timeTicks: 0, timeSec: 0, values: [100, 200], interpolation: 'linear' },
			{ timeTicks: 61440, timeSec: 2, values: [300, 600], interpolation: 'linear' },
		],
	};
	assert.deepEqual(evaluatePropertyAtTime(propLinear, 1), [200, 400]);
	assert.deepEqual(evaluatePropertyAtTime(propLinear, -1), [100, 200]);
	assert.deepEqual(evaluatePropertyAtTime(propLinear, 5), [300, 600]);

	const propHold: AepAnimatedProperty = {
		matchName: 'ADBE Opacity',
		staticValue: [0],
		keyframes: [
			{ timeTicks: 0, timeSec: 0, values: [0], interpolation: 'hold' },
			{ timeTicks: 30720, timeSec: 1, values: [100], interpolation: 'hold' },
		],
	};
	assert.deepEqual(evaluatePropertyAtTime(propHold, 0.99), [0]);
	assert.deepEqual(evaluatePropertyAtTime(propHold, 1.0), [100]);

	const propBezier: AepAnimatedProperty = {
		matchName: 'ADBE Rotate Z',
		staticValue: [0],
		keyframes: [
			{ timeTicks: 0, timeSec: 0, values: [0], interpolation: 'bezier' },
			{ timeTicks: 30720, timeSec: 1, values: [100], interpolation: 'bezier' },
		],
	};
	const quarter = evaluatePropertyAtTime(propBezier, 0.25)[0]!;
	assert.ok(quarter > 10 && quarter < 25, `Smoothstep at 0.25 should ease gently (got ${quarter})`);
	assert.equal(evaluatePropertyAtTime(propBezier, 0.5)[0], 50);
});

test('Phase 3A: All 7 RGBA effects (Fill, Tint, Box Blur, Glow, Simple Choker, Noise, Set Matte) mutate buffers deterministically', () => {
	// 1. Fill
	const bFill = createRgbaBuffer(24, 24);
	fillRgbaSolid(bFill, 20, 40, 60, 255);
	applyEffectFill(bFill, [255, 100, 0], 1);
	assert.deepEqual([bFill.data[0], bFill.data[1], bFill.data[2], bFill.data[3]], [255, 100, 0, 255]);

	// 2. Tint
	const bTint = createRgbaBuffer(16, 16);
	fillRgbaSolid(bTint, 255, 255, 255, 255);
	applyEffectTint(bTint, [0, 0, 0], [10, 200, 240], 1);
	assert.ok(Math.abs(bTint.data[0]! - 10) <= 1 && Math.abs(bTint.data[1]! - 200) <= 1 && Math.abs(bTint.data[2]! - 240) <= 1);

	// 3. Box Blur (blurs a bright square into neighboring transparent pixels)
	const bBlur = createRgbaBuffer(32, 32);
	for (let y = 12; y < 20; y++) {
		for (let x = 12; x < 20; x++) {
			const o = (y * 32 + x) * 4;
			bBlur.data[o] = 255;
			bBlur.data[o + 1] = 255;
			bBlur.data[o + 2] = 255;
			bBlur.data[o + 3] = 255;
		}
	}
	assert.equal(bBlur.data[(16 * 32 + 10) * 4 + 3], 0);
	applyEffectBoxBlur(bBlur, 3, 2);
	assert.ok(bBlur.data[(16 * 32 + 10) * 4 + 3]! > 0, 'Box blur must spread alpha outside the original box');

	// 4. Glow (adds colored halo around bright center square)
	const bGlow = createRgbaBuffer(40, 40);
	for (let y = 16; y < 24; y++) {
		for (let x = 16; x < 24; x++) {
			const o = (y * 40 + x) * 4;
			bGlow.data[o] = 255;
			bGlow.data[o + 1] = 255;
			bGlow.data[o + 2] = 255;
			bGlow.data[o + 3] = 255;
		}
	}
	applyEffectGlow(bGlow, { thresholdPct: 40, radiusPx: 8, intensity: 1.4, tintColor: [255, 0, 255] });
	const haloIdx = (20 * 40 + 13) * 4;
	assert.ok(bGlow.data[haloIdx + 3]! > 0 && bGlow.data[haloIdx]! > bGlow.data[haloIdx + 1]!, 'Glow must create tinted bloom halo');

	// 5. Simple Choker (positive choke erodes alpha boundary)
	const bChoke = createRgbaBuffer(32, 32);
	for (let y = 8; y < 24; y++) {
		for (let x = 8; x < 24; x++) {
			const o = (y * 32 + x) * 4;
			bChoke.data[o] = 255;
			bChoke.data[o + 3] = 255;
		}
	}
	applyEffectSimpleChoker(bChoke, 3);
	assert.ok(bChoke.data[(9 * 32 + 9) * 4 + 3]! < 64, 'Positive choke must erode edge pixels');
	assert.equal(bChoke.data[(16 * 32 + 16) * 4 + 3], 255, 'Interior pixel must remain opaque');

	// 6. Noise (deterministic per frame seed and distinct across frames)
	const bNoise1 = createRgbaBuffer(16, 16);
	const bNoise2 = createRgbaBuffer(16, 16);
	fillRgbaSolid(bNoise1, 128, 128, 128, 255);
	fillRgbaSolid(bNoise2, 128, 128, 128, 255);
	applyEffectNoise(bNoise1, 20, false, 1);
	applyEffectNoise(bNoise2, 20, false, 2);
	assert.ok(meanAbsDiffRgba(bNoise1.data, bNoise2.data) > 2, 'Different frame seeds must produce distinct film grain');

	// 7. Set Matte (alpha transfer & invert)
	const target = createRgbaBuffer(20, 20);
	fillRgbaSolid(target, 255, 0, 0, 255);
	const matte = createRgbaBuffer(20, 20);
	for (let y = 0; y < 20; y++) {
		for (let x = 0; x < 10; x++) {
			matte.data[(y * 20 + x) * 4 + 3] = 255;
		}
	}
	applyEffectSetMatte(target, matte, 'alpha', false);
	assert.equal(target.data[(10 * 20 + 5) * 4 + 3], 255);
	assert.equal(target.data[(10 * 20 + 15) * 4 + 3], 0);

	// Transformed composite sanity check
	const dst = createRgbaBuffer(40, 40);
	fillRgbaSolid(dst, 0, 0, 0, 255);
	const src = createRgbaBuffer(10, 10);
	fillRgbaSolid(src, 0, 255, 128, 255);
	compositeLayerTransformed(dst, src, {
		anchorX: 5,
		anchorY: 5,
		posX: 20,
		posY: 20,
		scaleX: 1,
		scaleY: 1,
		rotationDeg: 0,
		opacity: 1,
	});
	assert.equal(dst.data[(20 * 40 + 20) * 4 + 1], 255);
});

test('Phase 3A: expressions resolve control references and report what they cannot evaluate', () => {
	const amber = hexStringToRgba01('#fbbf24')!;
	const context = {
		tSec: 1,
		valueAt: () => [960, 540],
		resolveProperty: (ref: { effect: string | number }) =>
			ref.effect === 'Burst Color' ? [...amber] : ref.effect === 'Logo Scale' ? [135] : undefined,
	};

	const colour = evaluateAeExpression(
		'comp("Synthetic Burst").layer("Controls").effect("Burst Color")("Color")',
		context,
	);
	assert.equal(colour.supported, true);
	assert.deepEqual(colour.value, [...amber]);

	const scale = evaluateAeExpression('var s = thisComp.layer("Controls").effect("Logo Scale")("Slider"); [s, s]', context);
	assert.equal(scale.supported, true);
	assert.deepEqual(scale.value, [135, 135]);

	const unsupported = evaluateAeExpression('sourceRectAtTime().width', context);
	assert.equal(unsupported.supported, false);
	assert.ok(unsupported.reason, 'an unsupported expression says why');
});

test('Phase 3A: masks, colour, SVG/PNG logo swap, untouched .mogrt and partial verdict', async () => {
	const dir = createTempDir('mvx-p3a-e2e-');
	try {
		const mogrtPath = join(dir, 'synthetic.mogrt');
		buildSyntheticMogrt(mogrtPath);
		const shaOriginal = sha256File(mogrtPath);

		const svg = join(dir, 'logo-a.svg');
		const png = join(dir, 'logo-b.png');
		createSampleSvgLogo(svg, '#6366f1');
		createSamplePngLogo(png, '#ef4444');

		const frameAt = (tSec: number, overrides?: MogrtRenderOverrides) =>
			renderMogrtFrameRgba({
				mogrtPath,
				workDir: mkdtempSync(join(dir, 'w-')),
				tSec,
				width: 640,
				height: 360,
				...(overrides ? { overrides } : {}),
			});
		const pixel = (data: Uint8Array, x: number, y: number) => [...data.subarray((y * 640 + x) * 4, (y * 640 + x) * 4 + 4)];

		// The burst starts at 0.5 s. Two Difference squares leave a hole where they overlap.
		assert.equal(pixel(frameAt(0.2).frame.data, 170, 100)[3], 0);
		const burst = frameAt(1);
		assert.equal(burst.masksRasterized, 2);
		assert.deepEqual(pixel(burst.frame.data, 170, 100), [255, 0, 255, 255]);
		assert.equal(pixel(burst.frame.data, 320, 180)[3], 0);
		assert.equal(pixel(burst.frame.data, 20, 20)[3], 0);

		const recoloured = frameAt(1, { controls: { 'Burst Color': '#00ff00' } });
		assert.deepEqual(pixel(recoloured.frame.data, 170, 100), [0, 255, 0, 255]);

		const first = frameAt(1.8, { logoPath: svg });
		const second = frameAt(1.8, { logoPath: png });
		assert.equal(first.logoSubstituted, true);
		assert.equal(second.logoSubstituted, true);
		const diffLogos = meanAbsDiffRgba(first.frame.data, second.frame.data);
		assert.ok(diffLogos > 0.5, `Logo SVG vs PNG swap must visibly change frame (MAE=${diffLogos})`);

		assert.throws(() => frameAt(1, { textOverride: 'no text control here' }), /textOverride/);

		const outMp4 = join(dir, 'out.mp4');
		const report = await renderMogrtPhase3AToMp4({
			mogrtPath,
			workDir: join(dir, 'mp4work'),
			outputMp4Path: outMp4,
			width: 320,
			height: 180,
			overrides: { logoPath: svg },
		});
		assert.equal(existsSync(outMp4), true);
		assert.deepEqual([report.framesRendered, report.durationSec], [60, 2]);
		assert.equal(report.originalMogrtUntouched, true);
		assert.equal(report.originalMogrtSha256After, shaOriginal);
		assert.equal(report.logoSubstituted, true);
		assert.equal(report.masksProvenance.uniqueRealMasksRasterized, 2);
		assert.equal(report.unsupportedEffectsEncountered.length, 1, 'unsupported effects must be logged');
		assert.equal(
			report.completenessVerdict,
			'partial_with_documented_gaps',
			'Must NEVER falsely claim complete reproduction when unsupported Adobe effects exist',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('Phase 3A: a black render with no rasterized masks is reported as failed', async () => {
	const dir = createTempDir('mvx-p3a-black-');
	try {
		const mogrtPath = join(dir, 'black.mogrt');
		buildSyntheticMogrt(mogrtPath, { hideBurst: true });
		const report = await renderMogrtPhase3AToMp4({
			mogrtPath,
			workDir: join(dir, 'work'),
			outputMp4Path: join(dir, 'out.mp4'),
			width: 160,
			height: 90,
		});
		assert.equal(report.nonBlackFrames, 0);
		assert.equal(report.completenessVerdict, 'failed');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
