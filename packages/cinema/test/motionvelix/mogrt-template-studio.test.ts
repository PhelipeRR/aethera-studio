import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSyntheticMogrt, SYNTHETIC_MOGRT } from '../../src/motionvelix/aep-fixture-builder.js';
import { renderMogrtPhase3AToMp4 } from '../../src/motionvelix/mogrt-comp-renderer.js';
import { loadLogoImageRgba } from '../../src/motionvelix/mogrt-media-loader.js';
import {
	describeMogrtTemplate,
	mogrtOutputSize,
	renderMogrtPreviewPng,
} from '../../src/motionvelix/mogrt-template-studio.js';
import { assertSafeZip } from '../../src/motionvelix/mogrt-zip-guard.js';

const dir = mkdtempSync(join(tmpdir(), 'mogrt-studio-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const mogrtPath = join(dir, 'template.mogrt');
buildSyntheticMogrt(mogrtPath);

test('describes the template in the units the render overrides take', () => {
	const info = describeMogrtTemplate(mogrtPath, join(dir, 'inspect'));
	assert.equal(info.name, SYNTHETIC_MOGRT.name);
	assert.deepEqual([info.width, info.height, info.fps, info.durationSec], [640, 360, 30, 2]);
	assert.deepEqual(info.media, ['logo']);
	assert.deepEqual(info.controls, [{ name: 'Burst Color', kind: 'color', value: '#ff00ff' }]);
});

test('output sizes keep the aspect ratio, with even sides and no upscaling', () => {
	assert.deepEqual(mogrtOutputSize(4096, 2304, 1280), { width: 1280, height: 720 });
	assert.deepEqual(mogrtOutputSize(1080, 1920, 1280), { width: 720, height: 1280 });
	assert.deepEqual(mogrtOutputSize(640, 360, 1920), { width: 640, height: 360 });
	assert.deepEqual(mogrtOutputSize(1001, 333, 640), { width: 640, height: 212 });
});

test('a preview is an opaque picture that follows the edits', () => {
	const shot = (name: string, colour: string): Uint8Array => {
		const outputPngPath = join(dir, `${name}.png`);
		renderMogrtPreviewPng({
			mogrtPath,
			workDir: join(dir, name),
			outputPngPath,
			tSec: 0.8,
			width: 320,
			height: 180,
			overrides: { controls: { 'Burst Color': colour } },
		});
		return loadLogoImageRgba(outputPngPath, 320, 180).data;
	};
	const green = shot('green', '#00ff00');
	for (let o = 3; o < green.length; o += 4) assert.equal(green[o], 255);
	assert.notDeepEqual(green, shot('red', '#ff0000'));
});

test('a render reports every frame it finished', async () => {
	const seen: Array<[number, number]> = [];
	const outputMp4Path = join(dir, 'out.mp4');
	await renderMogrtPhase3AToMp4({
		mogrtPath,
		workDir: join(dir, 'render'),
		outputMp4Path,
		width: 160,
		height: 90,
		onProgress: (done, total) => seen.push([done, total]),
	});
	assert.ok(existsSync(outputMp4Path));
	assert.equal(seen.length, 60);
	assert.deepEqual([seen[0], seen.at(-1)], [[1, 60], [60, 60]]);
});

/** A ZIP central directory alone, which is all the guard reads. */
function archive(entries: Array<{ name: string; size?: number; mode?: number }>): Buffer {
	const parts = entries.map(({ name, size = 1, mode = 0o100644 }) => {
		const bytes = Buffer.from(name, 'utf8');
		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50, 0);
		header.writeUInt32LE(size, 24);
		header.writeUInt16LE(bytes.length, 28);
		header.writeUInt32LE((mode << 16) >>> 0, 38);
		return Buffer.concat([header, bytes]);
	});
	const directory = Buffer.concat(parts);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.length, 12);
	return Buffer.concat([directory, end]);
}

test('the archive guard accepts ordinary entries', () => {
	assert.doesNotThrow(() => assertSafeZip(archive([{ name: 'definition.json' }, { name: 'sub/project.aep' }])));
});

test('the archive guard rejects entries that leave the folder', () => {
	for (const name of ['../evil.js', 'a/../../evil.js', '..\\evil.js', '/evil.js', 'C:/evil.js', 'file.txt:stream']) {
		assert.throws(() => assertSafeZip(archive([{ name }])), /ZIP/, name);
	}
	assert.throws(() => assertSafeZip(archive([{ name: 'link', mode: 0o120777 }])), /ZIP/);
});

test('the archive guard rejects archives that expand too far, or cannot be read', () => {
	assert.throws(() => assertSafeZip(archive([{ name: 'bomb', size: 3 * 2 ** 30 }])), /ZIP/);
	assert.throws(() => assertSafeZip(archive([{ name: 'zip64', size: 0xffffffff }])), /ZIP/);
	assert.throws(() => assertSafeZip(Buffer.from('not an archive')), /ZIP/);
});
