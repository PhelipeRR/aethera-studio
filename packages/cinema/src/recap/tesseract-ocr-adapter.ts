import { createWorker, type Worker } from 'tesseract.js';
import type { OcrAdapter, OcrResult } from './recap-types.js';

export interface TesseractOcrOptions {
	/** Language(s) for OCR. Default: 'por+eng'. Use 'jpn' for Japanese, 'kor' for Korean. */
	languages?: string;
}

/**
 * Creates an OCR adapter backed by Tesseract.js.
 * Accepts both file paths (string) and raw image buffers (cropped panel pixels).
 * The worker is lazily initialized on first recognize() call and reused.
 */
export function createTesseractOcrAdapter(options: TesseractOcrOptions = {}): OcrAdapter & { terminate(): Promise<void> } {
	const languages = options.languages ?? 'por+eng';
	let worker: Worker | null = null;

	async function getWorker(): Promise<Worker> {
		if (!worker) {
			worker = await createWorker(languages);
		}
		return worker;
	}

	return {
		name: `tesseract-${languages}`,

		async recognize(imageOrPath: string | Buffer): Promise<OcrResult> {
			try {
				const w = await getWorker();
				const result = await w.recognize(imageOrPath);
				const text = result.data.text?.trim() ?? '';
				// Tesseract confidence is 0–100; normalize to 0–1
				const confidence = Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100));
				return { text, confidence };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(`Tesseract OCR failed: ${msg}`);
			}
		},

		async terminate(): Promise<void> {
			if (worker) {
				await worker.terminate();
				worker = null;
			}
		},
	};
}