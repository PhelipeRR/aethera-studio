import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
	classifyAfterEffectsMatchName,
	inspectMogrtFile,
} from '../../src/motionvelix/mogrt-importer.js';
import {
	evaluateAnimatedMaskAtTime,
	extractAepMasks,
} from '../../src/motionvelix/aep-mask-extractor.js';
import { flattenBezierVertices } from '../../src/motionvelix/mogrt-mask-renderer.js';

describe('MotionVelix MOGRT Engine — Phase 2 Experimental', () => {
	test('classifies AE match names honestly into native, webgl_approximable, and proprietary_gap', () => {
		expect(classifyAfterEffectsMatchName('ADBE Color Control').support).toBe('native_exact');
		expect(classifyAfterEffectsMatchName('ADBE Fill').support).toBe('native_exact');
		expect(classifyAfterEffectsMatchName('ADBE Glo2').support).toBe('webgl_approximable');
		expect(classifyAfterEffectsMatchName('ADBE Box Blur2').support).toBe('webgl_approximable');
		expect(classifyAfterEffectsMatchName('ADBE Turbulent Displace').support).toBe('adobe_proprietary_gap');
		expect(classifyAfterEffectsMatchName('APC Vegas').support).toBe('adobe_proprietary_gap');
	});

	test('flattens cubic Bezier vertices deterministically', () => {
		const poly = flattenBezierVertices(
			[
				{ point: { x: 0, y: 0 }, outHandle: { x: 10, y: 0 }, inHandle: { x: 0, y: 10 } },
				{ point: { x: 100, y: 0 }, outHandle: { x: 100, y: 10 }, inHandle: { x: 90, y: 0 } },
				{ point: { x: 100, y: 100 }, outHandle: { x: 90, y: 100 }, inHandle: { x: 100, y: 90 } },
			],
			1,
			1,
			4,
		);
		expect(poly.length).toBe(12);
		expect(poly[0]).toEqual({ x: 0, y: 0 });
	});

	const sampleMogrt =
		'C:/Users/Pheli/.gemini/antigravity/brain/01318809-de6a-47e0-9094-8803e9ca85ee/scratch/mogrt_audit/pack/Dynamic Anime Burst Logo Pack/Dynamic Anime Burst Logo 01.mogrt';

	test('inspects Dynamic Anime Burst Logo 01.mogrt and extracts all 90 animated Bezier masks from Transition 01', () => {
		if (!existsSync(sampleMogrt)) return;
		const workRoot =
			'C:/Users/Pheli/.gemini/antigravity/brain/01318809-de6a-47e0-9094-8803e9ca85ee/scratch/mogrt_phase2_test_work';
		const info = inspectMogrtFile(sampleMogrt, workRoot);
		expect(info.name).toBe('Dynamic Anime Burst Logo 01');
		expect(info.controls.length).toBe(28);
		expect(info.placeholders.length).toBe(2);
		expect(info.compatibilitySummary.proprietaryGapEffects).toBe(4);
		expect(info.compatibilitySummary.canRenderFaithfullyWithoutAdobe).toBe(false);
		expect(info.aepPath).toBeTruthy();

		const comps = extractAepMasks(info.aepPath!);
		const trans = comps.find((c) => c.name === 'Transition 01');
		expect(trans).toBeDefined();
		expect(trans!.width).toBe(1920);
		expect(trans!.height).toBe(1080);
		expect(trans!.fps).toBe(15);
		expect(trans!.totalMasks).toBe(90);
		expect(trans!.totalShapeKeyframes).toBe(620);

		const mask1 = trans!.layers[0]!.masks[0]!;
		expect(mask1.shapeKeyframes.length).toBe(18);
		expect(mask1.shapeKeyframes[6]!.vertices.length).toBe(228);

		const evalMid = evaluateAnimatedMaskAtTime(mask1, 0.73);
		expect(evalMid.visible).toBe(true);
		expect(evalMid.vertices.length).toBeGreaterThan(3);
	});
});
