import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPaddleOcrAdapter, createPaddleOcrTextAdapter } from '../src/index.js';

const fixtureWorker = resolve(process.cwd(), 'scripts', 'paddleocr-worker-fixture.py');
const pythonPath = process.env['AETHERA_TEST_PYTHON'] ?? 'python';

function fixtureInput(directory: string): string {
	const path = join(directory, 'p6_3.png');
	writeFileSync(path, 'stable fixture bytes');
	return path;
}

function adapter(directory: string, overrides: Record<string, unknown> = {}) {
	return createPaddleOcrAdapter({
		pythonPath,
		workerScriptPath: fixtureWorker,
		cacheDirectory: join(directory, 'cache'),
		timeoutMs: 1_000,
		...overrides,
	});
}

describe('PaddleOCR local adapter contract', () => {
	it('returns text, boxes, provenance and persists a cache reusable after adapter restart', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'aethera-paddleocr-'));
		try {
			const imagePath = fixtureInput(directory);
			const first = adapter(directory);
			const result = await first.recognizeDetailed({ panelId: 'p6_3', imagePath });
			assert.equal(result.status, 'success');
			assert.equal(result.text, 'KEUK...!');
			assert.equal(result.lines[0]?.boundingBox.x, 10);
			assert.equal(result.provenance.engine, 'paddleocr');
			assert.equal(result.inputTokens, null);
			await first.terminate();

			const second = adapter(directory);
			const cached = await second.recognizeDetailed({ panelId: 'p6_3', imagePath });
			assert.equal(cached.status, 'cache_hit');
			assert.equal(cached.cacheHit, true);
			assert.equal(cached.processingMs, 0);
			await second.terminate();
			assert.equal(readFileSync(join(directory, 'cache', 'paddleocr-ledger.jsonl'), 'utf8').trim().split(/\r?\n/).length, 2);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('returns a bounded failure when the OCR runtime is unavailable', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'aethera-paddleocr-'));
		try {
			const result = await adapter(directory, { pythonPath: join(directory, 'missing-python.exe'), timeoutMs: 100 }).recognizeDetailed({ panelId: 'p6_3', imagePath: fixtureInput(directory) });
			assert.ok(result.status === 'failed' || result.status === 'timeout');
			assert.ok(result.error);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('stops a worker that exceeds its timeout without retrying', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'aethera-paddleocr-'));
		try {
			const result = await adapter(directory, { timeoutMs: 50, workerEnv: { PADDLEOCR_FIXTURE_MODE: 'timeout' } }).recognizeDetailed({ panelId: 'p6_3', imagePath: fixtureInput(directory) });
			assert.equal(result.status, 'timeout');
			assert.match(result.error ?? '', /timeout/i);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('honors cancellation before the worker starts', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'aethera-paddleocr-'));
		try {
			const controller = new AbortController();
			controller.abort();
			const result = await adapter(directory).recognizeDetailed({ panelId: 'p6_3', imagePath: fixtureInput(directory), signal: controller.signal });
			assert.equal(result.status, 'cancelled');
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('bridges the persistent adapter to panel extraction without losing the OCR contract', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'aethera-paddleocr-'));
		try {
			const textAdapter = createPaddleOcrTextAdapter({
				pythonPath,
				workerScriptPath: fixtureWorker,
				cacheDirectory: join(directory, 'cache'),
				timeoutMs: 1_000,
			});
			const result = await textAdapter.recognize(fixtureInput(directory));
			assert.equal(result.text, 'KEUK...!');
			assert.equal(result.confidence, 0.99);
			await textAdapter.terminate();
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});
});
