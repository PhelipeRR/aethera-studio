import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedValidation, runValidation } from '../src/validation.js';

function project(test: string) {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-valid-')), 'loja');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test } }));
  return root;
}

describe('validation commands', () => {
  it('accept only the usual test, build and lint commands, nothing chained or arbitrary', () => {
    for (const command of ['npm test', 'npm run test', 'npm run test:unit', 'pnpm test', 'yarn test', 'npm run build', 'npm run lint', 'npm run typecheck', 'dotnet test', 'dotnet build']) expect(isAllowedValidation(command), command).toBe(true);
    for (const command of ['npm test && rm -rf /', 'node -e "x"', 'npm install', 'npx something', 'npm run deploy', 'dotnet run', 'powershell -c x', 'npm test; calc', '']) expect(isAllowedValidation(command), command).toBe(false);
  });

  it('runs the command in the project and reports its real outcome', async () => {
    expect(await runValidation(project('node -e "console.log(\'ok\')"'), 'npm test')).toMatchObject({ ok: true, exitCode: 0, output: expect.stringContaining('ok') });
    expect(await runValidation(project('node -e "console.error(\'quebrou\'); process.exit(3)"'), 'npm test')).toMatchObject({ ok: false, output: expect.stringContaining('quebrou') });
  }, 60_000);

  it('refuses a command off the list, and stops one that runs too long', async () => {
    await expect(runValidation(project('node -e "1"'), 'node -e "1"')).rejects.toThrow(/forbidden/);
    expect(await runValidation(project('node -e "setTimeout(() => {}, 60000)"'), 'npm test', { timeoutMs: 1500 })).toMatchObject({ ok: false, timedOut: true });
  }, 60_000);
});
