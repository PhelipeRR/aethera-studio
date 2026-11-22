import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	evaluatePropertyAtTime,
	parseAepProjectGraph,
	type AepAnimatedProperty,
} from '../../src/motionvelix/aep-comp-graph.js';
import { buildModelo01FixtureMogrt } from '../../src/motionvelix/aep-fixture-builder.js';
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

test('Phase 3A: Nested composition graph parses hierarchy, duration, FPS, 90 real Bézier masks, keyframes & unsupported effects', () => {
	const dir = createTempDir('mvx-p3a-graph-');
	try {
		const mogrtPath = join(dir, 'Dynamic Anime Burst Logo 01.mogrt');
		buildModelo01FixtureMogrt(mogrtPath, join(dir, 'stage'));
		const inspection = inspectMogrtFile(mogrtPath, join(dir, 'inspect'));
		assert.ok(inspection.aepPath && existsSync(inspection.aepPath));

		const graph = parseAepProjectGraph(inspection.aepPath, {
			preferredRootCompName: inspection.name,
		});

		assert.equal(graph.compositions.length, 3);
		assert.equal(graph.rootCompName, 'Dynamic Anime Burst Logo 01');

		const rootComp = graph.compositionsById.get(graph.rootCompId);
		assert.ok(rootComp);
		assert.equal(rootComp.width, 1920);
		assert.equal(rootComp.height, 1080);
		assert.equal(rootComp.fps, 30);
		assert.ok(Math.abs(rootComp.durationSec - 7.267) < 0.02);

		const transitionComp = graph.compositionsByName.get('Transition 01');
		assert.ok(transitionComp);
		assert.equal(transitionComp.fps, 15, 'Transition 01 must preserve 15fps native cadence');
		assert.equal(transitionComp.totalMasks, 90, 'Transition 01 must preserve all 90 real Bézier masks');
		assert.equal(graph.totalMasksExtracted, 90);

		assert.ok(inspection.thumbnailPath && existsSync(inspection.thumbnailPath), 'thumb.png must be extracted for reference comparison');
		const logoComp = graph.compositionsByName.get('L01 LOGO');
		assert.ok(logoComp);
		const logoLayer = logoComp.layers.find((l) => l.kind === 'logo_placeholder');
		assert.ok(logoLayer, 'L01 LOGO must contain Logo Placeholder');
		assert.equal(logoLayer.solid?.width, 500, 'Logo Placeholder must preserve native 500px source width from .aep');
		assert.equal(logoLayer.solid?.height, 500, 'Logo Placeholder must preserve native 500px source height from .aep');
		assert.ok(logoLayer.transform.scale.keyframes.length >= 4, 'Logo Placeholder must have decoded scale keyframes');
		assert.ok(logoLayer.transform.position.keyframes.length >= 3, 'Logo Placeholder must have decoded position keyframes');
		assert.ok(logoLayer.transform.rotation.keyframes.length >= 2, 'Logo Placeholder must have decoded rotation keyframes');
		assert.ok(logoLayer.transform.opacity.keyframes.length >= 4, 'Logo Placeholder must have decoded opacity keyframes');

		// Unsupported Adobe proprietary effects MUST be surfaced explicitly
		const unsupportedNames = new Set(graph.unsupportedEffects.map((e) => e.matchName));
		assert.ok(unsupportedNames.has('ADBE Turbulent Displace'));
		assert.ok(unsupportedNames.has('ADBE Fractal Noise'));
		assert.ok(unsupportedNames.has('APC Vegas'));
		assert.ok(unsupportedNames.has('ADBE Scribble Fill'));
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

test('Phase 3A: Safe AE expression evaluator resolves control bindings, overrides & logs unsupported expressions', () => {
	const dir = createTempDir('mvx-p3a-expr-');
	try {
		const mogrtPath = join(dir, 'Dynamic Anime Burst Logo 01.mogrt');
		buildModelo01FixtureMogrt(mogrtPath, join(dir, 'stage'));
		const inspection = inspectMogrtFile(mogrtPath, join(dir, 'inspect'));
		const graph = parseAepProjectGraph(inspection.aepPath!);
		const rootComp = graph.compositionsById.get(graph.rootCompId)!;

		const audit = { supportedEvaluated: 0, unsupported: [] as Array<{ compName: string; layerName: string; expression: string; reason: string }> };

		// Color control binding with user hex override
		const colorRes = evaluateAeExpression(
			'comp("Dynamic Anime Burst Logo 01").layer("Controls").effect("Primary Color")("Color")',
			{
				tSec: 1,
				currentComp: rootComp,
				currentLayerName: 'Burst Rays',
				compositionsByName: graph.compositionsByName,
				controlOverrides: { 'Primary Color': '#fbbf24' },
				baseValue: [1, 0, 1, 1],
				audit,
			},
		);
		assert.equal(colorRes.supported, true);
		assert.ok(Array.isArray(colorRes.value));
		const expectedAmber = hexStringToRgba01('#fbbf24')!;
		assert.ok(Math.abs((colorRes.value as number[])[0]! - expectedAmber[0]) < 0.01);
		assert.ok(Math.abs((colorRes.value as number[])[1]! - expectedAmber[1]) < 0.01);

		// Multi-line var + vector construction expression
		const scaleRes = evaluateAeExpression(
			'var s = thisComp.layer("Controls").effect("Logo Scale")("Slider"); [s, s]',
			{
				tSec: 1,
				currentComp: rootComp,
				currentLayerName: 'L01 LOGO',
				compositionsByName: graph.compositionsByName,
				controlOverrides: { 'Logo Scale': 135 },
				baseValue: [100, 100],
				audit,
			},
		);
		assert.equal(scaleRes.supported, true);
		assert.deepEqual(scaleRes.value, [135, 135]);

		// Unsupported wiggle() must NOT throw and MUST be logged in audit.unsupported
		const unsupRes = evaluateAeExpression('wiggle(5, 30)', {
			tSec: 1,
			currentComp: rootComp,
			currentLayerName: 'Logo Placeholder',
			compositionsByName: graph.compositionsByName,
			controlOverrides: {},
			baseValue: [960, 540],
			audit,
		});
		assert.equal(unsupRes.supported, false);
		assert.deepEqual(unsupRes.value, [960, 540]);
		assert.equal(audit.unsupported.length, 1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('Phase 3A: Logo PNG/SVG swap, editable color palettes, zero original .mogrt mutation & honest partial verdict', async () => {
	const dir = createTempDir('mvx-p3a-e2e-');
	try {
		const mogrtPath = join(dir, 'Dynamic Anime Burst Logo 01.mogrt');
		buildModelo01FixtureMogrt(mogrtPath, join(dir, 'stage'));
		const shaOriginal = sha256File(mogrtPath);

		const logoSvgPath = join(dir, 'logo-a.svg');
		const logoPngPath = join(dir, 'logo-b.png');
		createSampleSvgLogo(logoSvgPath, '#6366f1');
		createSamplePngLogo(logoPngPath, '#ef4444');

		// Frame comparison at hero reveal (t=2.5s): Logo 1 SVG vs Logo 2 PNG
		const resLogo1 = renderMogrtFrameRgba({
			mogrtPath,
			workDir: join(dir, 'w1'),
			tSec: 2.5,
			width: 480,
			height: 270,
			overrides: {
				logoPath: logoSvgPath,
				textOverride: 'AETHERA STUDIO',
				controls: { 'Primary Color': '#ff5eff', 'Accent Color': '#ffffff', 'BG Color': '#0d081a' },
			},
		});
		const resLogo2 = renderMogrtFrameRgba({
			mogrtPath,
			workDir: join(dir, 'w2'),
			tSec: 2.5,
			width: 480,
			height: 270,
			overrides: {
				logoPath: logoPngPath,
				textOverride: 'AETHERA STUDIO',
				controls: { 'Primary Color': '#ff5eff', 'Accent Color': '#ffffff', 'BG Color': '#0d081a' },
			},
		});
		assert.equal(resLogo1.logoSubstituted, true);
		assert.equal(resLogo2.logoSubstituted, true);
		const diffLogos = meanAbsDiffRgba(resLogo1.frame.data, resLogo2.frame.data);
		assert.ok(diffLogos > 2.5, `Logo SVG vs PNG swap must visibly change frame (MAE=${diffLogos})`);

		// Frame comparison during 90-mask burst (t=0.67s): Palette A vs Palette B
		const resPalA = renderMogrtFrameRgba({
			mogrtPath,
			workDir: join(dir, 'w3'),
			tSec: 0.67,
			width: 480,
			height: 270,
			overrides: {
				logoPath: logoSvgPath,
				controls: { 'Primary Color': '#ff5eff', 'Accent Color': '#ffffff', 'BG Color': '#0d081a' },
			},
		});
		const resPalB = renderMogrtFrameRgba({
			mogrtPath,
			workDir: join(dir, 'w4'),
			tSec: 0.67,
			width: 480,
			height: 270,
			overrides: {
				logoPath: logoSvgPath,
				controls: { 'Primary Color': '#fbbf24', 'Accent Color': '#22d3ee', 'BG Color': '#061a24' },
			},
		});
		assert.ok(resPalA.masksRasterized > 40, `Expected real .aep masks rasterized during burst (got ${resPalA.masksRasterized})`);
		const diffPalettes = meanAbsDiffRgba(resPalA.frame.data, resPalB.frame.data);
		assert.ok(diffPalettes > 8, `Palette A vs Palette B must visibly change burst colors (MAE=${diffPalettes})`);

		// Short MP4 pipeline test verifying FFmpeg output, SHA-256 non-mutation, 90-mask provenance & honest verdict
		const outMp4 = join(dir, 'out.mp4');
		mkdirSync(join(dir, 'mp4work'), { recursive: true });
		const report = await renderMogrtPhase3AToMp4({
			mogrtPath,
			workDir: join(dir, 'mp4work'),
			outputMp4Path: outMp4,
			width: 320,
			height: 180,
			fps: 15,
			durationSec: 1.5,
			overrides: {
				logoPath: logoSvgPath,
				textOverride: 'PHASE 3A TEST',
				controls: { 'Primary Color': '#ff5eff', 'Accent Color': '#ffffff' },
			},
		});

		assert.equal(existsSync(outMp4), true);
		assert.equal(report.originalMogrtUntouched, true);
		assert.equal(report.originalMogrtSha256After, shaOriginal);
		assert.equal(report.logoSubstituted, true);
		assert.equal(report.masksProvenance.aepTotalMasksExtracted, 90);
		assert.equal(report.masksProvenance.verifiedFromAepBinary, true);
		assert.ok(report.masksProvenance.uniqueRealMasksRasterized >= 80, `Expected >=80 unique real masks rasterized, got ${report.masksProvenance.uniqueRealMasksRasterized}`);
		assert.ok(report.unsupportedEffectsEncountered.length >= 4, 'Unsupported Adobe effects must be explicitly logged');
		assert.equal(
			report.completenessVerdict,
			'partial_with_documented_gaps',
			'Must NEVER falsely claim complete reproduction when unsupported Adobe effects exist',
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
