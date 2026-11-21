import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import {
	asuraScansAdapter,
	createOrLoadStoryMemoryProject,
	importAssistedChapterSources,
	importChapter,
	listRecapLibrary,
	loadStoryMemoryProject,
	RecapImportJobManager,
	SiteAdapterRegistry,
	type PageDiscoveryPort,
} from '../../src/recap/index.js';

const tempDir = mkdtempSync(join(tmpdir(), 'aethera-assisted-import-'));

afterAll(() => {
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

function makePng(seed: number): Buffer {
	const buf = Buffer.alloc(256, seed);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
	return buf;
}

function makeJpg(seed: number): Buffer {
	const buf = Buffer.alloc(256, seed);
	Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(buf, 0);
	return buf;
}

function makeWebp(seed: number): Buffer {
	const buf = Buffer.alloc(256, seed);
	buf.write('RIFF', 0, 'ascii');
	buf.writeUInt32LE(248, 4);
	buf.write('WEBP', 8, 'ascii');
	return buf;
}

describe('Assisted Browser Import & Cloudflare Short-Circuit (Reqs 1–9)', () => {
	test('Req 1: immediately stops automated attempts for remaining links on the same Cloudflare-blocked domain', async () => {
		let discoveryCalls = 0;
		const cfDiscoveryPort: PageDiscoveryPort = {
			async discover() {
				discoveryCalls++;
				throw new Error('Bloqueio Cloudflare / desafio anti-bot detectado na resposta (HTTP 403).');
			},
		};

		const manager = new RecapImportJobManager({
			libraryDir: join(tempDir, 'lib-cf'),
			registry: new SiteAdapterRegistry([asuraScansAdapter]),
			discoveryPort: cfDiscoveryPort,
		});

		const urls = [1, 2, 3, 4, 5].map((n) => `https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/${n}`);
		const job = manager.createJob({ urls });
		const finalJob = await manager.waitForJob(job.id);

		// ONLY 1 discovery request made — items 2..5 short-circuited with ZERO extra HTTP requests!
		expect(discoveryCalls).toBe(1);
		expect(finalJob.status).toBe('failed');
		expect(finalJob.blockedByProtection).toBe(true);
		expect(finalJob.blockedUrl).toBe(urls[0]);
		expect(finalJob.items.every((it) => it.blockedByProtection === true)).toBe(true);
		expect(finalJob.items[1]!.error).toMatch(/interrompida/i);
	});

	test('Reqs 4, 6, 7, 8 & 9: validates WEBP/PNG/JPG order, integrity & deduplication, builds CBZ, integrates with importChapter and preserves Story Memory', async () => {
		const srcDir = join(tempDir, 'chapter-images');
		mkdirSync(srcDir, { recursive: true });

		// Out-of-order filenames + 1 exact duplicate + 1 corrupted HTML file disguised as .jpg
		const p1 = join(srcDir, 'page-1.webp');
		const p2 = join(srcDir, 'page-2.jpg');
		const p10 = join(srcDir, 'page-10.png');
		const pDup = join(srcDir, 'page-11-dup.jpg');
		const pCorrupt = join(srcDir, 'page-12-corrupt.jpg');

		const jpgBuf = makeJpg(22);
		writeFileSync(p1, makeWebp(11));
		writeFileSync(p2, jpgBuf);
		writeFileSync(p10, makePng(33));
		writeFileSync(pDup, jpgBuf); // identical SHA-256 to page-2.jpg
		writeFileSync(pCorrupt, Buffer.from('<html><body>Just a moment...</body></html>'));

		const workspaceDir = join(tempDir, 'workspace');
		const libraryDir = join(tempDir, 'lib-assisted');

		// Create Story Memory project first to verify preservation
		const series = createOrLoadStoryMemoryProject({
			workspaceDir,
			workTitle: 'Nano Machine',
			defaultScriptStyle: 'natural_recap',
		});

		const res = importAssistedChapterSources({
			paths: [srcDir],
			libraryDir,
			workTitle: 'Nano Machine',
			chapterNumber: '1',
			sourceUrl: 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1',
			seriesProjectId: series.projectId,
		});

		expect(res.format).toBe('cbz');
		expect(res.pageCount).toBe(3);
		expect(res.duplicatesRemoved).toBe(1);
		expect(res.invalidSkipped).toBe(1);
		// Natural numeric order: page-1.webp -> 0001.webp, page-2.jpg -> 0002.jpg, page-10.png -> 0003.png
		expect(res.orderedFileNames).toEqual(['0001.webp', '0002.jpg', '0003.png']);
		expect(existsSync(res.archivePath)).toBe(true);

		// Verify aethera-source.json provenance metadata inside CBZ
		const zip = new AdmZip(res.archivePath);
		const metaJson = JSON.parse(zip.readAsText('aethera-source.json')) as {
			importMode: string;
			seriesProjectId: string;
			pageCount: number;
		};
		expect(metaJson.importMode).toBe('assisted_browser');
		expect(metaJson.seriesProjectId).toBe(series.projectId);
		expect(metaJson.pageCount).toBe(3);

		// Verify CBZ integrates cleanly with existing importChapter() & library index
		const imported = await importChapter({
			chapterId: 'nano-machine-assisted-cap-1',
			archivePath: res.archivePath,
			outputDir: join(tempDir, 'extracted-cbz'),
		});
		expect(imported.format).toBe('cbz');
		expect(imported.pageCount).toBe(3);
		expect(listRecapLibrary(libraryDir).length).toBe(1);

		// Verify Story Memory project remained intact
		const reloadedSeries = loadStoryMemoryProject(workspaceDir, series.projectId);
		expect(reloadedSeries?.workTitle).toBe('Nano Machine');
	});

	test('Req 4: accepts ZIP archive and PDF cleanly via assisted import', () => {
		const libraryDir = join(tempDir, 'lib-archives');

		// 1. ZIP with images
		const zipPath = join(tempDir, 'cap-2.zip');
		const z = new AdmZip();
		z.addFile('img_10.png', makePng(10));
		z.addFile('img_2.png', makePng(2));
		z.writeZip(zipPath);

		const zipRes = importAssistedChapterSources({
			paths: [zipPath],
			libraryDir,
			workTitle: 'Nano Machine',
			chapterNumber: '2',
		});
		expect(zipRes.format).toBe('cbz');
		expect(zipRes.pageCount).toBe(2);
		expect(existsSync(zipRes.archivePath)).toBe(true);

		// 2. PDF
		const pdfPath = join(tempDir, 'cap-3.pdf');
		writeFileSync(pdfPath, Buffer.from('%PDF-1.4\n% minimal valid header for assisted import test\n'));
		const pdfRes = importAssistedChapterSources({
			paths: [pdfPath],
			libraryDir,
			workTitle: 'Nano Machine',
			chapterNumber: '3',
		});
		expect(pdfRes.format).toBe('pdf');
		expect(existsSync(pdfRes.archivePath)).toBe(true);
	});
});
