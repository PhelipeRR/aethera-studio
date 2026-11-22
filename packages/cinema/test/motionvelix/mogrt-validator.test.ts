/** The Phase 3A validator must never replace a missing `.mogrt` with synthetic content. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../../scripts/validate-mogrt-phase3a.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx/cli');

function validate(args: (dir: string) => string[]): { status: number | null; stderr: string; written: string[] } {
	const dir = mkdtempSync(join(tmpdir(), 'mogrt-validator-'));
	try {
		const run = spawnSync(process.execPath, [tsx, script, ...args(dir)], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
		return { status: run.status, stderr: run.stderr, written: readdirSync(dir) };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('validator: no --mogrt is a usage error, not a fixture run', () => {
	const { status, stderr, written } = validate(() => []);
	assert.equal(status, 2, stderr);
	assert.match(stderr, /--mogrt/);
	assert.deepEqual(written, []);
});

test('validator: a path that does not exist fails and names the path', () => {
	const { status, stderr, written } = validate((dir) => ['--mogrt', join(dir, 'missing.mogrt')]);
	assert.equal(status, 2, stderr);
	assert.match(stderr, /missing\.mogrt/);
	assert.deepEqual(written, []);
});

test('validator: a file that is not a MOGRT fails', () => {
	const { status, stderr } = validate((dir) => {
		const path = join(dir, 'broken.mogrt');
		writeFileSync(path, 'not a zip');
		return ['--mogrt', path, '--out', join(dir, 'out')];
	});
	assert.equal(status, 1, stderr);
	assert.match(stderr, /Validation failed/);
});
