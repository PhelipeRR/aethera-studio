import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Renders a multi-page PDF to PNG images using pdfjs-dist + node-canvas.
 * Each page is rendered at the specified DPI (default 200) and saved as PNG.
 * Returns an array of output file paths in page order.
 *
 * Throws explicit errors when dependencies are missing or the PDF is invalid.
 */
export async function renderPdfToImages(
	pdfPath: string,
	outputDir: string,
	options: { dpi?: number } = {},
): Promise<string[]> {
	const dpi = options.dpi ?? 200;
	const scale = dpi / 72;

	// Load pdfjs-dist legacy build for Node.js compatibility
	let pdfjsLib: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
	try {
		pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
	} catch (err) {
		throw new Error(
			`PDF import requires pdfjs-dist. Install with: npm install pdfjs-dist. ` +
			`Original error: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Load node-canvas for server-side rendering
	let canvasLib: typeof import('canvas');
	try {
		canvasLib = await import('canvas');
	} catch (err) {
		throw new Error(
			`PDF rendering requires node-canvas. Install with: npm install canvas. ` +
			`Original error: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Read PDF file as Uint8Array (required by pdfjs-dist)
	const { readFileSync } = await import('node:fs');
	let pdfData: Uint8Array;
	try {
		const buf = readFileSync(pdfPath);
		pdfData = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	} catch (err) {
		throw new Error(
			`Failed to read PDF file "${pdfPath}": ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Open PDF document
	let doc: Awaited<ReturnType<typeof pdfjsLib.getDocument>>['promise'] extends Promise<infer T> ? T : never;
	try {
		doc = await pdfjsLib.getDocument({ data: pdfData }).promise;
	} catch (err) {
		throw new Error(
			`Failed to parse PDF "${pdfPath}": ${err instanceof Error ? err.message : String(err)}. ` +
			`Ensure the file is a valid, non-corrupted PDF.`,
		);
	}

	const pageCount = doc.numPages;
	if (pageCount === 0) {
		throw new Error(`PDF has no pages: ${pdfPath}`);
	}

	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}

	const { writeFileSync } = await import('node:fs');
	const pagePaths: string[] = [];

	for (let i = 1; i <= pageCount; i++) {
		const page = await doc.getPage(i);
		const viewport = page.getViewport({ scale });

		const width = Math.floor(viewport.width);
		const height = Math.floor(viewport.height);

		// Create node-canvas surface and render PDF page onto it
		const pdfCanvas = canvasLib.createCanvas(width, height);
		const pdfCtx = pdfCanvas.getContext('2d');

		// node-canvas provides a Canvas API compatible with what pdfjs-dist expects at runtime,
		// but pdfjs-dist v6 types are strict about DOM CanvasRenderingContext2D which doesn't
		// exist in Node.js. Runtime compatibility was verified: rendering produces valid PNGs.
		// @ts-expect-error -- node-canvas context is runtime-compatible but not typed as DOM CanvasRenderingContext2D
		await page.render({ canvasContext: pdfCtx, viewport }).promise;

		// Export rendered page to PNG buffer and write to disk
		const pngBuffer = pdfCanvas.toBuffer('image/png');
		const destPath = join(outputDir, `page_${String(i - 1).padStart(4, '0')}.png`);
		writeFileSync(destPath, pngBuffer);
		pagePaths.push(destPath);
	}

	return pagePaths;
}