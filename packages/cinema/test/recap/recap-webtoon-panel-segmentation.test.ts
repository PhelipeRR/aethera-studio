/**
 * Webtoon strip segmentation: balloons and SFX floating on the white background must not become
 * panels of their own (each one costs a vision call and a shot with no scene).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { extractPanels, segmentVerticalStrip } from '../../src/recap/index.js';

/** Builds row brightness: 255 = white background, 0 = artwork. */
function rows(spec: Array<[kind: 'w' | 'k', h: number]>): number[] {
	return spec.flatMap(([kind, h]) => Array<number>(h).fill(kind === 'w' ? 255 : 30));
}

describe('segmentVerticalStrip', () => {
	it('keeps real panels separated by real gutters', () => {
		const out = segmentVerticalStrip(rows([['w', 50], ['k', 900], ['w', 120], ['k', 700], ['w', 80]]), 800);
		expect(out).toEqual([{ start: 50, end: 950 }, { start: 1070, end: 1770 }]);
	});

	it('does not split a panel on a thin white line (inside a balloon)', () => {
		const out = segmentVerticalStrip(rows([['k', 400], ['w', 6], ['k', 500]]), 800);
		expect(out).toEqual([{ start: 0, end: 906 }]);
	});

	it('merges a floating SFX sliver or small balloon into the closest panel instead of dropping it', () => {
		// panel A, small gap, 54px SFX fragment, big gap, panel B
		const out = segmentVerticalStrip(rows([['k', 1000], ['w', 30], ['k', 54], ['w', 300], ['k', 900]]), 800);
		expect(out).toEqual([{ start: 0, end: 1084 }, { start: 1384, end: 2284 }]);
	});

	it('ignores specks and keeps a lone small strip as one panel', () => {
		expect(segmentVerticalStrip(rows([['w', 100], ['k', 2], ['w', 100]]), 800)).toEqual([]);
		expect(segmentVerticalStrip(rows([['w', 20], ['k', 120], ['w', 20]]), 800)).toEqual([{ start: 20, end: 140 }]);
	});
});

describe('extractPanels on a webtoon page', () => {
	it('returns real panels, not balloon fragments', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-webtoon-'));
		try {
			const W = 800;
			const H = 3000;
			const block = (top: number, h: number, w = W, left = 0) => ({
				input: { create: { width: w, height: h, channels: 3 as const, background: { r: 20, g: 20, b: 20 } } },
				top,
				left,
			});
			const page = join(dir, 'page_0000.png');
			await sharp({ create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
				.composite([
					block(100, 900), // panel 1
					block(1040, 60, 300, 400), // balloon fragment just below it
					block(1400, 80, 200, 300), // floating SFX
					block(1700, 1100), // panel 2
				])
				.png()
				.toFile(page);
			const result = await extractPanels({
				chapter: { chapterId: 'c', readingOrder: 'vertical', pages: [{ pageNumber: 1, filePath: page, width: W, height: H }] },
				outputDir: join(dir, 'panels'),
			} as unknown as Parameters<typeof extractPanels>[0]);
			const boxes = result.panels.map((p) => p.metadata.boundingBox);
			expect(boxes).toHaveLength(2);
			expect(boxes[0]).toMatchObject({ y: 100 });
			expect(boxes[0]!.y + boxes[0]!.h).toBeGreaterThanOrEqual(1100); // balloon kept with panel 1
			expect(boxes[1]!.y).toBeLessThanOrEqual(1400); // SFX kept with panel 2
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
