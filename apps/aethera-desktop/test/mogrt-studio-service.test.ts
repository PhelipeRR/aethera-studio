import { afterAll, test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMogrtStudioService } from '../src/main/mogrt-studio-service.js';

const dir = mkdtempSync(join(tmpdir(), 'mogrt-service-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Stands in for the engine, to test what the main process promises around it.
const workerPath = join(dir, 'worker.cjs');
writeFileSync(
	workerPath,
	`const { parentPort, workerData: job } = require('node:worker_threads');
const fs = require('node:fs');
if (job.type === 'inspect') {
	fs.writeFileSync(job.workDir + '.env', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE + '|' + (process.env.Path || process.env.PATH)));
	parentPort.postMessage({ type: 'result', value: { name: 'Fake', width: 4096, height: 2304, fps: 30, durationSec: 2,
		thumbnailPath: null, media: ['logo'], controls: [{ name: 'Tagline', kind: 'text', value: 'A' }, { name: 'Slow', kind: 'boolean', value: false }] } });
} else if (job.type === 'preview') {
	if (job.overrides.controls.Tagline === 'crash') throw new Error('engine exploded');
	if (job.overrides.controls.Tagline === 'no ffmpeg') throw new Error('spawnSync ffmpeg ENOENT');
	fs.writeFileSync(job.outputPath, JSON.stringify(job));
	parentPort.postMessage({ type: 'result', value: null });
} else {
	fs.writeFileSync(job.outputPath, JSON.stringify(job));
	parentPort.postMessage({ type: 'progress', done: 1, total: 60 });
	if (job.overrides.controls.Slow) setInterval(() => {}, 1000);
	else parentPort.postMessage({ type: 'result', value: { verdict: 'partial_with_documented_gaps', reason: 'r', effects: [], gaps: [], approximations: [] } });
}
`,
);

const source = join(dir, 'My Template.mogrt');
writeFileSync(source, 'mogrt bytes');

const open = (name: string) =>
	createMogrtStudioService({
		workerPath,
		tempDir: join(dir, name, 'temp'),
		rendersDir: join(dir, name, 'renders'),
		ffmpegPath: join(dir, 'tools', 'ffmpeg.exe'),
	});

test('importing works on a copy, in a worker that can run Node and find FFmpeg', async () => {
	const studio = open('import');
	const template = await studio.importTemplate(source);
	assert.equal(template.fileName, 'My Template.mogrt');
	assert.equal(readFileSync(source, 'utf8'), 'mogrt bytes');
	const folder = join(dir, 'import', 'temp', template.id);
	assert.equal(readFileSync(join(folder, 'template.mogrt'), 'utf8'), 'mogrt bytes');
	const env = JSON.parse(readFileSync(join(folder, 'inspect.env'), 'utf8')) as string;
	assert.ok(env.startsWith('1|') && env.endsWith(join(dir, 'tools')), env.slice(-120));
	await assert.rejects(studio.importTemplate(join(dir, 'worker.cjs')), /\.mogrt/);
});

test('only ids and known controls are accepted from the page', async () => {
	const studio = open('untrusted');
	const { id } = await studio.importTemplate(source);
	const base = { id, values: {}, tSec: 1 };
	await assert.rejects(studio.preview({ ...base, id: '../../etc' }), /não encontrado/);
	await assert.rejects(studio.preview({ ...base, values: { Unknown: 'x' } }), /Controle/);
	await assert.rejects(studio.preview({ ...base, values: { Tagline: 'x'.repeat(5000) } }), /Controle/);
	await assert.rejects(studio.render({ id, values: {}, longEdge: 99999 }, () => undefined), /Resolução/);
	assert.throws(() => studio.renderPath('../../secret'), /não encontrado/);
});

test('media is copied, and reaches the engine as that copy', async () => {
	const studio = open('media');
	const { id } = await studio.importTemplate(source);
	const logo = join(dir, 'logo.svg');
	writeFileSync(logo, '<svg/>');
	assert.equal(studio.setMedia(id, 'logo', logo), 'logo.svg');
	assert.throws(() => studio.setMedia(id, 'background', logo), /não tem/);
	assert.throws(() => studio.setMedia(id, 'logo', source), /formato/i);
	const { path } = await studio.preview({ id, values: { Tagline: 'B' }, tSec: 99 });
	const job = JSON.parse(readFileSync(path, 'utf8'));
	assert.ok(job.overrides.logoPath.startsWith(join(dir, 'media', 'temp', id)));
	assert.deepEqual(job.overrides.controls, { Tagline: 'B' });
	assert.ok(job.tSec < 2, 'the time is clamped to the template');
	studio.setMedia(id, 'logo', null);
	const cleared = JSON.parse(readFileSync((await studio.preview({ id, values: {}, tSec: 1 })).path, 'utf8'));
	assert.equal(cleared.overrides.logoPath, undefined);
});

test('a render reports progress and can be found by its id', async () => {
	const studio = open('render');
	const { id } = await studio.importTemplate(source);
	const seen: number[] = [];
	const result = await studio.render({ id, values: {}, longEdge: 1280 }, (progress) => seen.push(progress.done));
	assert.deepEqual(seen, [1]);
	assert.deepEqual([result.width, result.height], [1280, 720]);
	assert.equal(studio.renderPath(result.renderId), result.path);
	assert.ok(existsSync(result.path));
});

test('one job at a time, and cancelling leaves no partial video', async () => {
	const studio = open('cancel');
	const { id } = await studio.importTemplate(source);
	let started!: () => void;
	const running = new Promise<void>((resolve) => (started = resolve));
	const render = studio.render({ id, values: { Slow: true }, longEdge: 640 }, () => started());
	const outcome = assert.rejects(render, /cancelad/);
	await running;
	await assert.rejects(studio.preview({ id, values: {}, tSec: 1 }), /em andamento/);
	await studio.cancel();
	await outcome;
	assert.deepEqual(readdirSync(join(dir, 'cancel', 'renders')), []);
	await studio.preview({ id, values: {}, tSec: 1 });
});

test('an engine crash is an error, and the studio recovers', async () => {
	const studio = open('crash');
	const { id } = await studio.importTemplate(source);
	await assert.rejects(studio.preview({ id, values: { Tagline: 'crash' }, tSec: 1 }), /engine exploded/);
	await studio.preview({ id, values: {}, tSec: 1 });
});

test('a missing FFmpeg is named, with what to do', async () => {
	const studio = open('no-ffmpeg');
	const { id } = await studio.importTemplate(source);
	await assert.rejects(studio.preview({ id, values: { Tagline: 'no ffmpeg' }, tSec: 1 }), /FFmpeg não encontrado.*PATH/);
});
