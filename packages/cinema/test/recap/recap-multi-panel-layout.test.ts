/**
 * Multi-panel layout: compact panels share the frame and appear when the narration reaches them.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildMultiPanelFilterComplex,
	compactPanelSlots,
	stackCompactPanelShots,
	type ExtractedPanel,
	type RecapPanelShot,
} from '../../src/recap/index.js';

function panel(id: string, w: number, h: number): ExtractedPanel {
	return {
		panelId: id,
		pagePath: `/p/${id}.png`,
		croppedImagePath: `/p/${id}.png`,
		imageHash: `h-${id}`,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'c',
			pageNumber: 1,
			panelIndex: 0,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: 0, w, h },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
	} as unknown as ExtractedPanel;
}

function shot(id: string, panelId: string, startMs: number, endMs: number, sceneIndex = 0, imagePath = `/p/${panelId}.png`): RecapPanelShot {
	return {
		shotId: id,
		sceneId: `scene-${sceneIndex}`,
		sceneIndex,
		panelId,
		pageNumber: 1,
		imagePath,
		startMs,
		endMs,
		durationMs: endMs - startMs,
		motionStyle: 'ken_burns_in',
		focalStart: { x: 0.5, y: 0.5, zoom: 1 },
		focalEnd: { x: 0.5, y: 0.5, zoom: 1.1 },
		transitionIn: 'cut',
		balloonSafeZoneProtected: false,
		framingCropRisk: { atRisk: false },
		emotion: 'neutral',
		narrativeIntent: 'exposition',
	} as RecapPanelShot;
}

describe('compactPanelSlots', () => {
	it('fits narrow panels side by side in landscape and keeps wide or very tall ones alone', () => {
		expect(compactPanelSlots(0.6, 1280, 720)).toBe(2); // portrait-ish manga panel
		expect(compactPanelSlots(0.55, 1920, 1080)).toBeGreaterThanOrEqual(2);
		expect(compactPanelSlots(1.6, 1280, 720)).toBe(1); // already fills a 16:9 frame
		expect(compactPanelSlots(0.3, 1280, 720)).toBe(1); // tall webtoon strip: scrolls instead
	});

	it('stacks wide panels in portrait frames', () => {
		expect(compactPanelSlots(2, 720, 1280)).toBe(3);
		expect(compactPanelSlots(1.3, 720, 1280)).toBe(2);
		expect(compactPanelSlots(0.6, 720, 1280)).toBe(1);
	});
});

describe('stackCompactPanelShots', () => {
	const panels = new Map([
		['a', panel('a', 600, 1000)],
		['b', panel('b', 600, 1000)],
		['c', panel('c', 600, 1000)],
		['wide', panel('wide', 1600, 900)],
	]);

	it('merges consecutive compact panels and reveals each at its narration start', () => {
		const out = stackCompactPanelShots([shot('s1', 'a', 0, 2000), shot('s2', 'b', 2000, 5000), shot('s3', 'wide', 5000, 7000)], panels, 1280, 720);
		expect(out).toHaveLength(2);
		const merged = out[0]!;
		expect(merged.layout?.kind).toBe('row');
		expect(merged.layout?.panels.map((p) => [p.panelId, p.revealAtMs])).toEqual([
			['a', 0],
			['b', 2000],
		]);
		expect([merged.startMs, merged.endMs, merged.durationMs]).toEqual([0, 5000, 5000]);
		expect(merged.balloonSafeZoneProtected).toBe(true);
		expect(out[1]!.panelId).toBe('wide');
		expect(out[1]!.layout).toBeUndefined();
		// Timeline stays contiguous.
		expect(out[1]!.startMs).toBe(merged.endMs);
	});

	it('never mixes scenes and respects the slot capacity', () => {
		const out = stackCompactPanelShots(
			[shot('s1', 'a', 0, 1000, 0), shot('s2', 'b', 1000, 2000, 1), shot('s3', 'c', 2000, 3000, 1)],
			panels,
			1280,
			720,
		);
		expect(out.map((s) => s.layout?.panels.length ?? 1)).toEqual([1, 2]);
	});

	it('leaves the plan untouched when nothing is compact', () => {
		const shots = [shot('s1', 'wide', 0, 1000)];
		expect(stackCompactPanelShots(shots, panels, 1280, 720)).toEqual(shots);
	});
});

describe('buildMultiPanelFilterComplex', () => {
	it('reveals later panels only from their narration time', () => {
		const s = { ...shot('m', 'a', 0, 4000), layout: { kind: 'row' as const, panels: [
			{ panelId: 'a', imagePath: '/a.png', revealAtMs: 0 },
			{ panelId: 'b', imagePath: '/b.png', revealAtMs: 1500 },
		] } };
		const fx = buildMultiPanelFilterComplex(s, 1280, 720, 24)!;
		expect(fx.inputs).toEqual(['/a.png', '/b.png']);
		expect(fx.filterComplex).toContain("enable='gte(t,1.500)'");
		expect(fx.filterComplex).toContain('fade=t=in:st=1.500');
		expect(fx.mapLabel).toBe('[vout]');
		expect(buildMultiPanelFilterComplex(shot('x', 'a', 0, 1000), 1280, 720, 24)).toBeNull();
	});

	const hasFfmpeg = (() => {
		try {
			execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
			return true;
		} catch {
			return false;
		}
	})();

	it.skipIf(!hasFfmpeg)('renders a real composite clip where panel 2 appears at its reveal time', () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-multipanel-'));
		try {
			const a = join(dir, 'a.png');
			const b = join(dir, 'b.png');
			execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=600x1000', '-frames:v', '1', a], { stdio: 'ignore' });
			execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=600x1000', '-frames:v', '1', b], { stdio: 'ignore' });
			const s = { ...shot('m', 'a', 0, 3000, 0, a), layout: { kind: 'row' as const, panels: [
				{ panelId: 'a', imagePath: a, revealAtMs: 0 },
				{ panelId: 'b', imagePath: b, revealAtMs: 1500 },
			] } };
			const fx = buildMultiPanelFilterComplex(s, 640, 360, 24)!;
			const clip = join(dir, 'clip.mp4');
			execFileSync('ffmpeg', ['-y', ...fx.inputs.flatMap((i) => ['-loop', '1', '-i', i]), '-filter_complex', fx.filterComplex, '-map', fx.mapLabel, '-t', '3', '-r', '24', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', clip], { stdio: 'ignore' });
			expect(existsSync(clip)).toBe(true);
			// Sample the centre of the right slot before and after the reveal (blue = panel b visible).
			const sample = (t: string) => {
				const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', t, '-i', clip, '-frames:v', '1', '-vf', 'crop=2:2:480:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
				return { r: buf[0]!, g: buf[1]!, b: buf[2]! };
			};
			const before = sample('0.5');
			const after = sample('2.5');
			expect(before.b).toBeLessThan(150);
			expect(after.b).toBeGreaterThan(180);
			expect(after.r).toBeLessThan(80);
			// Left slot shows panel a (red) from the start.
			const leftBuf = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', clip, '-frames:v', '1', '-vf', 'crop=2:2:160:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
			expect(leftBuf[0]!).toBeGreaterThan(180);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
