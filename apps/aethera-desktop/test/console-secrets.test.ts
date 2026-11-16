import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProductionConsoleService } from '../src/main/production-console.js';
import { runInstrumentedCommand } from '../src/main/production-agent-runner.js';

const tempDirs: string[] = [];
function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Values shaped like real credentials, used only to prove they never reach the console.
const SECRETS = {
  openai: 'sk-live-4f9c1b7d2a6e8f0a1b2c3d4e',
  github: 'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  aws: 'AKIAIOSFODNN7EXAMPLE',
  password: 'senha-do-usuario-42',
  bearer: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
};

const SECRET_MARKERS = [SECRETS.openai, SECRETS.github, SECRETS.aws, SECRETS.password, SECRETS.bearer, 'payload'];

function assertNoSecret(label: string, text: string): void {
  for (const marker of SECRET_MARKERS) {
    expect(text, `${label} vazou ${marker}`).not.toContain(marker);
  }
}

describe('Console de Produção — proteção de segredos', () => {
  it('redacts secrets coming from stdout, stderr, arguments and technical details in every surface', async () => {
    const logsDir = join(makeRoot('console-secrets-'), 'logs');
    const service = new ProductionConsoleService({ logsDir });
    const broadcasts: string[] = [];
    service.subscribe((entry) => broadcasts.push(JSON.stringify(entry)));

    const script = [
      `process.stdout.write('linha com token=${SECRETS.openai}\\n');`,
      `process.stderr.write('Authorization: Bearer ${SECRETS.bearer}\\n');`,
      `process.stderr.write('password=${SECRETS.password} github=${SECRETS.github} aws=${SECRETS.aws}\\n');`,
      "process.exit(0);",
    ].join('');

    await runInstrumentedCommand({
      console: service,
      projectId: 'job_secrets',
      jobId: 'job_secrets',
      runId: 'run_secrets',
      stage: 'pesquisa',
      origin: 'agent',
      source: 'claude-cli',
      label: 'Execução com segredos',
      command: process.execPath,
      // The secret also travels as an argument, exactly as a real --token flag would.
      args: ['-e', script, '--', '--api-key', SECRETS.openai, '--password', SECRETS.password],
    });

    const entries = service.list('job_secrets', { limit: 1000 }).entries;
    expect(entries.length).toBeGreaterThan(3);

    // 1. What the renderer sees (broadcast) and what the lists return.
    assertNoSecret('broadcast', broadcasts.join('\n'));
    assertNoSecret('list', JSON.stringify(entries));

    // 2. The command line recorded for the execution.
    const started = entries.find((entry) => entry.event === 'command_started');
    assertNoSecret('command_started', JSON.stringify(started));

    // 3. The stderr tail kept in the result details.
    const result = entries.find((entry) => entry.channel === 'result');
    expect(String(result?.details?.stderrTail)).toContain('[REDACTED]');
    assertNoSecret('result', JSON.stringify(result));

    // 4. Exports.
    assertNoSecret('export txt', service.export('job_secrets', 'txt'));
    assertNoSecret('export json', service.export('job_secrets', 'json'));

    // 5. The persisted history on disk.
    assertNoSecret('jsonl', readFileSync(join(logsDir, 'job_secrets.log.jsonl'), 'utf8'));

    // 6. A service restarted from that history.
    const reopened = new ProductionConsoleService({ logsDir });
    assertNoSecret('history reload', JSON.stringify(reopened.list('job_secrets', { limit: 1000 }).entries));
  });

  it('redacts secret-shaped keys passed directly in details, including nested arrays and objects', () => {
    const logsDir = join(makeRoot('console-secrets-details-'), 'logs');
    const service = new ProductionConsoleService({ logsDir });
    const entry = service.emit({
      projectId: 'job_details',
      stage: 'agent',
      severity: 'error',
      source: 'codex-cli',
      message: 'falha de autenticação',
      details: {
        apiKey: SECRETS.openai,
        authorization: `Bearer ${SECRETS.bearer}`,
        nested: { password: SECRETS.password, credential: SECRETS.aws },
        list: [SECRETS.github, `token=${SECRETS.openai}`],
      },
    });
    assertNoSecret('details', JSON.stringify(entry));
    assertNoSecret('export', service.export('job_details', 'json'));
    assertNoSecret('jsonl', readFileSync(join(logsDir, 'job_details.log.jsonl'), 'utf8'));
  });

  it('keeps ordinary diagnostic text readable while redacting only the secret part', () => {
    const logsDir = join(makeRoot('console-secrets-readable-'), 'logs');
    const service = new ProductionConsoleService({ logsDir });
    const entry = service.emit({
      projectId: 'job_readable',
      stage: 'pesquisa',
      severity: 'info',
      source: 'claude-cli',
      message: 'Pesquisa concluída em 3,2s com 12 entidades',
    });
    expect(entry.message).toBe('Pesquisa concluída em 3,2s com 12 entidades');
    expect(service.export('job_readable', 'txt')).toContain('12 entidades');
  });
});
