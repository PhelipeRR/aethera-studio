import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type {
	ExtractedPanel,
	ImportedChapter,
	MangaPanelMetadata,
	OcrAdapter,
	OcrStatus,
	PanelClassification,
	PanelExtractionResult,
	ReadingOrder,
} from './recap-types.js';
import { extractedPanelSchema } from './recap-types.js';

/**
 * Detects panels in a page image using contrast-based segmentation.
 * For manga (RTL): scans for vertical gutters to split columns.
 * For manhwa (vertical): scans for horizontal gutters in long-strip layout.
 * Falls back to single-panel (full page) when no gaps are detected.
 */
async function detectPanelsInPage(
	pagePath: string,
	readingOrder: ReadingOrder,
	width: number,
	height: number,
): Promise<Array<{ boundingBox: { x: number; y: number; w: number; h: number }; classification: PanelClassification }>> {
	try {
		const buf = readFileSync(pagePath);
		const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });

		const rowAvg = new Float32Array(info.height);
		for (let y = 0; y < info.height; y++) {
			let sum = 0;
			for (let x = 0; x < info.width; x++) {
				sum += data[y * info.width + x] ?? 0;
			}
			rowAvg[y] = sum / info.width;
		}

		const colAvg = new Float32Array(info.width);
		for (let x = 0; x < info.width; x++) {
			let sum = 0;
			for (let y = 0; y < info.height; y++) {
				sum += data[y * info.width + x] ?? 0;
			}
			colAvg[x] = sum / info.height;
		}

		const GUTTER_THRESHOLD = 240;
		const MIN_PANEL_SIZE = Math.min(width, height) * 0.05;

		if (readingOrder === 'vertical') {
			const gaps: Array<{ start: number; end: number }> = [];
			let inGap = false;
			let gapStart = 0;
			for (let y = 0; y < info.height; y++) {
				if ((rowAvg[y] ?? 0) > GUTTER_THRESHOLD) {
					if (!inGap) { gapStart = y; inGap = true; }
				} else {
					if (inGap) { gaps.push({ start: gapStart, end: y }); inGap = false; }
				}
			}
			if (inGap) gaps.push({ start: gapStart, end: info.height });

			const panels: Array<{ boundingBox: { x: number; y: number; w: number; h: number }; classification: PanelClassification }> = [];
			let lastEnd = 0;
			for (const gap of gaps) {
				if (gap.start - lastEnd > MIN_PANEL_SIZE) {
					panels.push({
						boundingBox: { x: 0, y: lastEnd, w: width, h: gap.start - lastEnd },
						classification: panels.length === 0 ? 'establishing' : 'dialogue',
					});
				}
				lastEnd = gap.end;
			}
			if (info.height - lastEnd > MIN_PANEL_SIZE) {
				panels.push({
					boundingBox: { x: 0, y: lastEnd, w: width, h: info.height - lastEnd },
					classification: 'dialogue',
				});
			}
			if (panels.length > 0) return panels;
		} else {
			const vGaps: Array<{ start: number; end: number }> = [];
			let inGap = false;
			let gapStart = 0;
			for (let x = 0; x < info.width; x++) {
				if ((colAvg[x] ?? 0) > GUTTER_THRESHOLD) {
					if (!inGap) { gapStart = x; inGap = true; }
				} else {
					if (inGap) { vGaps.push({ start: gapStart, end: x }); inGap = false; }
				}
			}
			if (inGap) vGaps.push({ start: gapStart, end: info.width });

			const columns: Array<{ x: number; w: number }> = [];
			let lastEnd = 0;
			for (const gap of vGaps) {
				if (gap.start - lastEnd > MIN_PANEL_SIZE) {
					columns.push({ x: lastEnd, w: gap.start - lastEnd });
				}
				lastEnd = gap.end;
			}
			if (info.width - lastEnd > MIN_PANEL_SIZE) {
				columns.push({ x: lastEnd, w: info.width - lastEnd });
			}

			if (columns.length > 1) {
				const orderedCols = readingOrder === 'rtl' ? [...columns].reverse() : columns;
				return orderedCols.map((col, idx) => ({
					boundingBox: { x: col.x, y: 0, w: col.w, h: height },
					classification: idx === 0 ? 'establishing' : 'dialogue',
				}));
			}
		}

		return [{ boundingBox: { x: 0, y: 0, w: width, h: height }, classification: 'establishing' }];
	} catch {
		return [{ boundingBox: { x: 0, y: 0, w: width, h: height }, classification: 'establishing' }];
	}
}

/**
 * Extracts a panel region from the full page image as a PNG buffer.
 * Returns the cropped buffer and its dimensions.
 */
async function extractPanelImage(
	pagePath: string,
	boundingBox: { x: number; y: number; w: number; h: number },
): Promise<{ buffer: Buffer; width: number; height: number }> {
	const buf = readFileSync(pagePath);
	const cropped = await sharp(buf)
		.extract({
			left: Math.round(boundingBox.x),
			top: Math.round(boundingBox.y),
			width: Math.round(boundingBox.w),
			height: Math.round(boundingBox.h),
		})
		.png()
		.toBuffer({ resolveWithObject: true });

	return {
		buffer: cropped.data,
		width: cropped.info.width,
		height: cropped.info.height,
	};
}

function sha256Buffer(data: Buffer): string {
	return createHash('sha256').update(data).digest('hex');
}

export interface ExtractPanelsOptions {
	chapter: ImportedChapter;
	/** Directory where cropped panel images will be persisted. */
	outputDir: string;
	ocrAdapter?: OcrAdapter;
	/** Minimum OCR confidence to accept text. Below this, textContent is omitted but status remains 'success'. */
	minOcrConfidence?: number;
}

/**
 * Extracts panels from an imported chapter with real panel detection and explicit OCR status.
 *
 * KEY BEHAVIORS (validated against risk review):
 * - Each panel is CROPPED from the page before OCR and hashing.
 * - imageHash represents the pixels of the CROPPED panel, not the full page.
 * - OCR runs on the CROPPED panel buffer, not the full page file.
 * - Each panel's ocrStatus is one of: 'not_run' | 'success' | 'failed'.
 * - All returned panels are validated against the Zod schema.
 */
export async function extractPanels(options: ExtractPanelsOptions): Promise<PanelExtractionResult> {
	const { chapter, ocrAdapter, minOcrConfidence = 0.3 } = options;
	const warnings: string[] = [];
	const panels: ExtractedPanel[] = [];

	for (const page of chapter.pages) {
		const detected = await detectPanelsInPage(
			page.filePath,
			chapter.readingOrder,
			page.width,
			page.height,
		);

		for (let idx = 0; idx < detected.length; idx++) {
			const region = detected[idx]!;
			const panelId = `${chapter.chapterId}_p${page.pageNumber}_${idx}`;

			// Crop the panel region from the full page image
			let panelBuffer: Buffer;
			let panelWidth: number;
			let panelHeight: number;
			let cropFailed = false;
			let croppedImagePath: string | undefined;
			try {
				const cropped = await extractPanelImage(page.filePath, region.boundingBox);
				panelBuffer = cropped.buffer;
				panelWidth = cropped.width;
				panelHeight = cropped.height;
			} catch (err) {
				cropFailed = true;
				const msg = err instanceof Error ? err.message : String(err);
				warnings.push(`Panel ${panelId}: CROP_FAILED — ${msg}. Panel marked for review; using full page as fallback.`);
				panelBuffer = readFileSync(page.filePath);
				panelWidth = page.width;
				panelHeight = page.height;
			}

			// Persist cropped panel to disk when crop succeeds
			if (!cropFailed) {
				const cropDir = join(options.outputDir, chapter.chapterId, 'panels');
				if (!existsSync(cropDir)) mkdirSync(cropDir, { recursive: true });
				croppedImagePath = join(cropDir, `${panelId}.png`);
				writeFileSync(croppedImagePath, panelBuffer);
			}

			// Hash the CROPPED panel pixels, not the full page file
			const imageHash = sha256Buffer(panelBuffer);

			// Run OCR on the CROPPED panel buffer, not the full page
			let ocrText: string | undefined;
			let ocrConfidence = 0;
			let ocrStatus: OcrStatus = 'not_run';
			let ocrError: string | undefined;

			if (ocrAdapter) {
				try {
					const result = await ocrAdapter.recognize(panelBuffer);
					ocrStatus = 'success';
					ocrConfidence = result.confidence;
					if (result.confidence >= minOcrConfidence && result.text.trim().length > 0) {
						ocrText = result.text.trim();
					} else if (result.confidence < minOcrConfidence) {
						warnings.push(
							`Panel ${panelId}: OCR confidence ${result.confidence.toFixed(2)} below threshold ${minOcrConfidence}`,
						);
					}
				} catch (err) {
					ocrStatus = 'failed';
					ocrError = err instanceof Error ? err.message : String(err);
					warnings.push(`Panel ${panelId}: OCR failed — ${ocrError}`);
				}
			}

			const metadata: MangaPanelMetadata = {
				sourceKind: cropFailed ? 'manga_page' : (detected.length > 1 ? 'panel_crop' : 'manga_page'),
				origin: chapter.format === 'cbz' || chapter.format === 'zip' ? 'manga_scan' : 'webtoon_extract',
				chapterId: chapter.chapterId,
				pageNumber: page.pageNumber,
				panelIndex: idx,
				readingOrder: chapter.readingOrder,
				boundingBox: region.boundingBox,
				classification: region.classification,
				ocrStatus,
				ocrConfidence,
				textContent: ocrText,
				ocrError,
			};

			const panel: ExtractedPanel = extractedPanelSchema.parse({
				panelId,
				pagePath: page.filePath,
				croppedImagePath,
				cropFailed,
				metadata,
				imageHash,
				width: panelWidth,
				height: panelHeight,
			});

			panels.push(panel);
		}
	}

	return { panels, warnings };
}