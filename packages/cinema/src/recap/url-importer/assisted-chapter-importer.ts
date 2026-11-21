/**
 * Aethera Recap — Assisted Browser & Local Media Chapter Importer
 *
 * Accepts legitimately accessed / user-provided chapter media without bypassing
 * Cloudflare, CAPTCHA, or site access controls:
 * - Individual images: .webp, .png, .jpg, .jpeg
 * - Folders of images (scanned flat or nested, ignoring OS junk files)
 * - Archives: .zip, .cbz, .pdf
 *
 * Guarantees:
 * - Natural numeric ordering (e.g. 1, 2, 10 — never lexicographic 1, 10, 2)
 * - Magic-bytes image integrity validation (rejects corrupted/HTML/empty files)
 * - SHA-256 deduplication of identical pages
 * - Standardized CBZ generation (0001.ext, 0002.ext, ... + aethera-source.json)
 * - Registration in Aethera Recap Library + project/series association
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { resolveSafeStoragePath, sanitizeStorageSlug, validateImageMagicBytes } from './url-security.js';
import { registerLibraryEntry, type RecapLibraryEntry } from './url-chapter-importer.js';

const IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.cbz']);
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export interface AssistedInlineFile {
	name: string;
	buffer: Buffer;
}

export interface AssistedChapterImportInput {
	/** Local file or folder paths selected by the user (WEBP, PNG, JPG, folder, ZIP, CBZ, PDF). */
	paths?: readonly string[];
	/** Optional in-memory uploaded files (used by Remote Host HTTP endpoint). */
	inlineFiles?: readonly AssistedInlineFile[];
	/** Destination Aethera Recap library directory. */
	libraryDir: string;
	/** Work/series title. */
	workTitle: string;
	/** Chapter number label (e.g. "1", "01", "12.5"). */
	chapterNumber?: string;
	/** Optional originating chapter URL (for provenance metadata only). */
	sourceUrl?: string;
	/** Optional Story Memory / Recap project ID to associate in metadata. */
	seriesProjectId?: string;
}

export interface AssistedChapterImportResult {
	archivePath: string;
	format: 'cbz' | 'pdf';
	pageCount: number;
	duplicatesRemoved: number;
	invalidSkipped: number;
	orderedFileNames: string[];
	warnings: string[];
	entry: RecapLibraryEntry;
}

interface CandidateImageAsset {
	logicalName: string;
	buffer: Buffer;
}

function isIgnoredSystemFile(name: string): boolean {
	const base = basename(name).toLowerCase();
	return (
		base.startsWith('.') ||
		base === 'thumbs.db' ||
		base === 'desktop.ini' ||
		name.includes('__MACOSX')
	);
}

function collectImagesFromDirectory(dirPath: string): CandidateImageAsset[] {
	const out: CandidateImageAsset[] = [];
	const entries = readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
		NATURAL_COLLATOR.compare(a.name, b.name),
	);
	for (const ent of entries) {
		if (isIgnoredSystemFile(ent.name)) continue;
		const full = join(dirPath, ent.name);
		if (ent.isDirectory()) {
			out.push(...collectImagesFromDirectory(full));
		} else if (ent.isFile() && IMAGE_EXTENSIONS.has(extname(ent.name).toLowerCase())) {
			out.push({ logicalName: ent.name, buffer: readFileSync(full) });
		}
	}
	return out;
}

function extractImagesFromArchiveBuffer(archiveBuffer: Buffer, archiveName: string): CandidateImageAsset[] {
	const zip = new AdmZip(archiveBuffer);
	const entries = zip
		.getEntries()
		.filter((e) => !e.isDirectory && !isIgnoredSystemFile(e.entryName))
		.filter((e) => IMAGE_EXTENSIONS.has(extname(e.entryName).toLowerCase()))
		.sort((a, b) => NATURAL_COLLATOR.compare(a.entryName, b.entryName));

	return entries.map((e) => ({
		logicalName: `${archiveName}/${e.entryName}`,
		buffer: e.getData(),
	}));
}

function registerAssistedLibraryEntry(libraryDir: string, entry: RecapLibraryEntry): void {
	registerLibraryEntry(libraryDir, entry);
}

/**
 * Validates, sorts, deduplicates, packs (CBZ) or registers (PDF) user-provided chapter media
 * from the Assisted Browser Import flow.
 */
export function importAssistedChapterSources(input: AssistedChapterImportInput): AssistedChapterImportResult {
	const paths = input.paths ?? [];
	const inlineFiles = input.inlineFiles ?? [];
	if (paths.length === 0 && inlineFiles.length === 0) {
		throw new Error('Selecione pelo menos uma imagem (WEBP/PNG/JPG), pasta de imagens, ZIP, CBZ ou PDF.');
	}

	const workTitle = input.workTitle.trim() || 'Aethera Recap';
	const workSlug = sanitizeStorageSlug(workTitle);
	const chapterNumber = (input.chapterNumber ?? '1').trim() || '1';
	const chapterSlug = sanitizeStorageSlug(chapterNumber);
	const warnings: string[] = [];

	// Check if a single PDF was provided
	const pdfPaths = paths.filter((p) => existsSync(p) && statSync(p).isFile() && extname(p).toLowerCase() === '.pdf');
	const pdfInline = inlineFiles.filter((f) => extname(f.name).toLowerCase() === '.pdf');
	if (pdfPaths.length + pdfInline.length === 1 && paths.length + inlineFiles.length === 1) {
		const pdfBuf = pdfPaths[0] ? readFileSync(pdfPaths[0]) : pdfInline[0]!.buffer;
		if (pdfBuf.length < 5 || pdfBuf.subarray(0, 5).toString('ascii') !== '%PDF-') {
			throw new Error('Arquivo PDF inválido ou corrompido (cabeçalho %PDF- ausente).');
		}
		const targetPdfPath = resolveSafeStoragePath(input.libraryDir, workSlug, `cap-${chapterSlug}.pdf`);
		mkdirSync(join(input.libraryDir, workSlug), { recursive: true });
		if (pdfPaths[0]) {
			copyFileSync(pdfPaths[0], targetPdfPath);
		} else {
			writeFileSync(targetPdfPath, pdfBuf);
		}
		const sha256 = createHash('sha256').update(pdfBuf).digest('hex');
		const entry: RecapLibraryEntry = {
			id: `${workSlug}__cap-${chapterSlug}__pdf`,
			workSlug,
			workTitle,
			chapterNumber,
			sourceUrl: input.sourceUrl?.trim() || `assisted://pdf/${basename(pdfPaths[0] ?? pdfInline[0]!.name)}`,
			adapterId: 'assisted_browser_import',
			cbzPath: targetPdfPath,
			pageCount: 1,
			cbzSha256: sha256,
			importedAtIso: new Date().toISOString(),
		};
		registerAssistedLibraryEntry(input.libraryDir, entry);
		return {
			archivePath: targetPdfPath,
			format: 'pdf',
			pageCount: 1,
			duplicatesRemoved: 0,
			invalidSkipped: 0,
			orderedFileNames: [basename(targetPdfPath)],
			warnings,
			entry,
		};
	}

	// Collect all candidate images from files, folders, ZIP/CBZ archives, and inline uploads
	const candidates: CandidateImageAsset[] = [];

	const sortedPaths = [...paths].sort((a, b) => NATURAL_COLLATOR.compare(basename(a), basename(b)));
	for (const p of sortedPaths) {
		if (!existsSync(p)) {
			warnings.push(`Caminho não encontrado e ignorado: ${basename(p)}`);
			continue;
		}
		const st = statSync(p);
		if (st.isDirectory()) {
			candidates.push(...collectImagesFromDirectory(p));
			continue;
		}
		const ext = extname(p).toLowerCase();
		if (IMAGE_EXTENSIONS.has(ext)) {
			candidates.push({ logicalName: basename(p), buffer: readFileSync(p) });
		} else if (ARCHIVE_EXTENSIONS.has(ext)) {
			try {
				candidates.push(...extractImagesFromArchiveBuffer(readFileSync(p), basename(p)));
			} catch (err) {
				warnings.push(`Falha ao abrir arquivo ${basename(p)}: ${err instanceof Error ? err.message : String(err)}`);
			}
		} else if (ext === '.pdf') {
			warnings.push(`PDF "${basename(p)}" ignorado ao misturar com imagens (importe o PDF individualmente).`);
		} else {
			warnings.push(`Formato não suportado ignorado: ${basename(p)}`);
		}
	}

	const sortedInline = [...inlineFiles].sort((a, b) => NATURAL_COLLATOR.compare(a.name, b.name));
	for (const f of sortedInline) {
		const ext = extname(f.name).toLowerCase();
		if (IMAGE_EXTENSIONS.has(ext)) {
			candidates.push({ logicalName: f.name, buffer: f.buffer });
		} else if (ARCHIVE_EXTENSIONS.has(ext)) {
			try {
				candidates.push(...extractImagesFromArchiveBuffer(f.buffer, f.name));
			} catch (err) {
				warnings.push(`Falha ao extrair ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
			}
		} else {
			warnings.push(`Arquivo não suportado ignorado: ${f.name}`);
		}
	}

	// Natural numeric sort across all collected candidate images
	candidates.sort((a, b) => NATURAL_COLLATOR.compare(a.logicalName, b.logicalName));

	// Validate magic bytes & deduplicate by SHA-256
	const seenHashes = new Set<string>();
	const validPages: Array<{ ext: string; buffer: Buffer; originalName: string; sha256: string }> = [];
	let duplicatesRemoved = 0;
	let invalidSkipped = 0;

	for (const cand of candidates) {
		const magic = validateImageMagicBytes(cand.buffer);
		if (!magic.valid || !magic.ext) {
			invalidSkipped++;
			warnings.push(`Imagem inválida/corrompida ignorada: ${cand.logicalName}`);
			continue;
		}
		const hash = createHash('sha256').update(cand.buffer).digest('hex');
		if (seenHashes.has(hash)) {
			duplicatesRemoved++;
			continue;
		}
		seenHashes.add(hash);
		validPages.push({
			ext: magic.ext,
			buffer: cand.buffer,
			originalName: cand.logicalName,
			sha256: hash,
		});
	}

	if (validPages.length === 0) {
		throw new Error(
			'Nenhuma imagem válida (WEBP, PNG ou JPG) encontrada nos arquivos selecionados. Verifique se os arquivos não estão corrompidos.',
		);
	}

	// Pack standardized CBZ with deterministic 4-digit page numbering
	const zip = new AdmZip();
	const orderedFileNames: string[] = [];
	for (let i = 0; i < validPages.length; i++) {
		const page = validPages[i]!;
		const entryName = `${String(i + 1).padStart(4, '0')}${page.ext}`;
		zip.addFile(entryName, page.buffer);
		orderedFileNames.push(entryName);
	}

	const metadata = {
		schemaVersion: 1,
		importMode: 'assisted_browser',
		workTitle,
		workSlug,
		chapterNumber,
		sourceUrl: input.sourceUrl?.trim() || null,
		seriesProjectId: input.seriesProjectId?.trim() || null,
		pageCount: validPages.length,
		duplicatesRemoved,
		invalidSkipped,
		createdAtIso: new Date().toISOString(),
	};
	zip.addFile('aethera-source.json', Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'));

	const targetCbzPath = resolveSafeStoragePath(input.libraryDir, workSlug, `cap-${chapterSlug}.cbz`);
	mkdirSync(join(input.libraryDir, workSlug), { recursive: true });
	const cbzBuffer = zip.toBuffer();
	writeFileSync(targetCbzPath, cbzBuffer);

	const cbzSha256 = createHash('sha256').update(cbzBuffer).digest('hex');
	const entry: RecapLibraryEntry = {
		id: `${workSlug}__cap-${chapterSlug}`,
		workSlug,
		workTitle,
		chapterNumber,
		sourceUrl: input.sourceUrl?.trim() || `assisted://local/${workSlug}/cap-${chapterSlug}`,
		adapterId: 'assisted_browser_import',
		cbzPath: targetCbzPath,
		pageCount: validPages.length,
		cbzSha256,
		importedAtIso: new Date().toISOString(),
	};
	registerAssistedLibraryEntry(input.libraryDir, entry);

	return {
		archivePath: targetCbzPath,
		format: 'cbz',
		pageCount: validPages.length,
		duplicatesRemoved,
		invalidSkipped,
		orderedFileNames,
		warnings,
		entry,
	};
}
