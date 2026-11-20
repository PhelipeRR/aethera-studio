import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve, relative } from 'node:path';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import type { ImportChapterOptions, ImportedChapter, ImportedPage, ReadingOrder } from './recap-types.js';
import { importedChapterSchema } from './recap-types.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function sha256Buffer(data: Buffer): string {
	return createHash('sha256').update(data).digest('hex');
}

function detectFormat(archivePath: string): 'pdf' | 'cbz' | 'zip' | 'images' {
	if (existsSync(archivePath) && statSync(archivePath).isDirectory()) return 'images';
	const ext = extname(archivePath).toLowerCase();
	if (ext === '.pdf') return 'pdf';
	if (ext === '.cbz') return 'cbz';
	if (ext === '.zip') return 'zip';
	if (IMAGE_EXTENSIONS.has(ext)) return 'images';
	throw new Error(`Unsupported archive format: ${ext}`);
}

function inferReadingOrder(format: 'pdf' | 'cbz' | 'zip' | 'images'): ReadingOrder {
	if (format === 'cbz') return 'rtl';
	return 'rtl';
}

function sortPageFiles(files: string[]): string[] {
	return [...files].sort((a, b) => {
		const numA = parseInt(a.replace(/\D/g, '') || '0', 10);
		const numB = parseInt(b.replace(/\D/g, '') || '0', 10);
		if (numA !== numB) return numA - numB;
		return a.localeCompare(b);
	});
}

/**
 * Validates that a resolved file path stays within the output directory.
 * Prevents zip-slip / path-traversal attacks from malicious archives.
 */
function assertSafeEntryPath(entryName: string, outputDir: string): string {
	const normalized = entryName.replace(/\\/g, '/');
	if (normalized.startsWith('/') || normalized.includes('../')) {
		throw new Error(`Unsafe archive entry rejected: "${entryName}"`);
	}
	const resolved = resolve(outputDir, normalized);
	const rel = relative(outputDir, resolved);
	if (rel.startsWith('..') || rel === '') {
		throw new Error(`Archive entry escapes output directory: "${entryName}"`);
	}
	return resolved;
}

async function getImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
	try {
		const meta = await sharp(buffer).metadata();
		return { width: meta.width ?? 1920, height: meta.height ?? 1080 };
	} catch {
		return { width: 1920, height: 1080 };
	}
}

/**
 * Extracts image entries from a CBZ or ZIP archive using adm-zip.
 * Security: validates raw entry names BEFORE extraction to reject path traversal.
 * Returns an array of { name, buffer } sorted in natural page order.
 */
function extractZipEntries(archivePath: string): Array<{ name: string; buffer: Buffer }> {
	const zip = new AdmZip(archivePath);
	const allEntries = zip.getEntries();

	// Security: scan ALL entries (not just images) for path traversal patterns.
	// adm-zip normalizes ../ from entryName, so we also check the raw header data.
	for (const entry of allEntries) {
		const rawName = entry.entryName.replace(/\\/g, '/');
		// Check normalized name for absolute paths
		if (rawName.startsWith('/')) {
			throw new Error(`Unsafe archive entry rejected (absolute path): "${entry.entryName}"`);
		}
		// Check raw buffer for ../ sequences that adm-zip may have stripped
		if (entry.rawEntryName) {
			const rawStr = Buffer.isBuffer(entry.rawEntryName)
				? entry.rawEntryName.toString('utf-8')
				: String(entry.rawEntryName);
			if (rawStr.includes('../') || rawStr.includes('..\\')) {
				throw new Error(`Unsafe archive entry rejected (path traversal): "${rawStr}"`);
			}
		}
	}

	const entries = allEntries
		.filter((e) => !e.isDirectory && IMAGE_EXTENSIONS.has(extname(e.entryName).toLowerCase()))
		.map((e) => ({ name: basename(e.entryName), buffer: e.getData() }));

	if (entries.length === 0) {
		throw new Error(`No image files found in archive: ${archivePath}`);
	}

	const sorted = sortPageFiles(entries.map((e) => e.name));
	return sorted.map((name) => entries.find((e) => e.name === name)!);
}

/**
 * Converts a PDF file to PNG pages using pdfjs-dist (primary) or sharp/libvips (fallback).
 * Throws an explicit error when no PDF backend is available.
 */
async function extractPdfPages(pdfPath: string, outputDir: string): Promise<string[]> {
	// Primary: try pdfjs-dist adapter
	try {
		const { renderPdfToImages } = await import('./pdf-import-adapter.js');
		const pagePaths = await renderPdfToImages(pdfPath, outputDir, { dpi: 200 });
		if (pagePaths.length > 0) return pagePaths;
	} catch (err) {
		// pdfjs-dist unavailable or failed — fall through to sharp
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('Failed to open PDF') || msg.includes('PDF has no pages')) {
			throw err; // Real PDF error, not a missing-library error
		}
	}

	// Fallback: try sharp/libvips PDF support
	try {
		const metadata = await sharp(pdfPath, { density: 200 }).metadata();
		const pageCount = metadata.pages ?? 1;
		const pagePaths: string[] = [];
		for (let i = 0; i < pageCount; i++) {
			const destPath = join(outputDir, `page_${String(i).padStart(4, '0')}.png`);
			await sharp(pdfPath, { page: i, density: 200 }).png().toFile(destPath);
			pagePaths.push(destPath);
		}
		if (pagePaths.length > 0) return pagePaths;
	} catch {
		// sharp also doesn't support PDF
	}

	throw new Error(
		`PDF import failed: no PDF rendering backend available. ` +
		`Install pdfjs-dist (npm install pdfjs-dist) or sharp with libvips PDF support (poppler/mupdf). ` +
		`Alternatively, convert the PDF to images externally and pass the directory path.`,
	);
}

export async function importChapter(options: ImportChapterOptions): Promise<ImportedChapter> {
	const { chapterId, archivePath, outputDir, readingOrder: explicitReadingOrder } = options;

	if (!existsSync(archivePath)) {
		throw new Error(`Archive not found: ${archivePath}`);
	}

	const format = detectFormat(archivePath);
	const readingOrder = explicitReadingOrder ?? inferReadingOrder(format);

	const chapterOutputDir = join(outputDir, chapterId);
	if (!existsSync(chapterOutputDir)) {
		mkdirSync(chapterOutputDir, { recursive: true });
	}

	let imageFiles: string[];

	if (format === 'images') {
		const stat = statSync(archivePath);
		if (stat.isDirectory()) {
			imageFiles = readdirSync(archivePath)
				.filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
				.map((f) => join(archivePath, f));
		} else {
			imageFiles = [archivePath];
		}
	} else if (format === 'cbz' || format === 'zip') {
		const entries = extractZipEntries(archivePath);
		imageFiles = [];
		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i]!;
			const destFileName = `page_${String(i).padStart(4, '0')}${extname(entry.name).toLowerCase()}`;
			// Post-extraction safety: verify resolved path stays within output dir
			assertSafeEntryPath(destFileName, chapterOutputDir);
			const destPath = join(chapterOutputDir, destFileName);
			writeFileSync(destPath, entry.buffer);
			imageFiles.push(destPath);
		}
	} else if (format === 'pdf') {
		imageFiles = await extractPdfPages(archivePath, chapterOutputDir);
	} else {
		throw new Error(`Unsupported format: ${format}`);
	}

	if (imageFiles.length === 0) {
		throw new Error(`No image files found in: ${archivePath}`);
	}

	const pages: ImportedPage[] = [];
	for (let i = 0; i < imageFiles.length; i++) {
		const filePath = imageFiles[i]!;
		const buf = readFileSync(filePath);
		const hash = sha256Buffer(buf);
		const dims = await getImageDimensions(buf);

		pages.push({
			pageNumber: i,
			filePath,
			sha256: hash,
			width: dims.width,
			height: dims.height,
		});
	}

	const chapter: ImportedChapter = {
		chapterId,
		sourceArchivePath: archivePath,
		format: statSync(archivePath).isDirectory() ? 'images' : format,
		readingOrder,
		pageCount: pages.length,
		pages,
		importedAtIso: new Date().toISOString(),
	};

	return importedChapterSchema.parse(chapter);
}