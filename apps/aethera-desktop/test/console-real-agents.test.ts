import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProductionConsoleService } from '../src/main/production-console.js';
import { PRODUCTION_AGENT_PROVIDERS, runProductionAgentCommand } from '../src/main/production-agent-providers.js';

/**
 * Opt-in validation against the CLIs really installed on this machine. Run with:
 *   AETHERA_CONSOLE_REAL=1 npx vitest run apps/aethera-desktop/test/console-real-agents.test.ts
 * The evidence (JSONL + TXT + summary) lands under artifacts/aethera-console/<timestamp>/.
 */
const enabled = process.env['AETHERA_CONSOLE_REAL'] === '1';
const repoRoot = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(repoRoot, 'artifacts', 'aethera-console', stamp);

interface ProviderEvidence {
  provider: string;
  installed: boolean;
  ok: boolean;
  durationMs: number;
  failureReason?: string;
  entries: number;
  commandLines: string[];
  streamLines: number;
  finalTextPreview: string;
}

describe.runIf(enabled)('Console de Produção — execução real dos CLIs de agente', () => {
  it('records real command, stdout/stderr and result for every provider available', async () => {
    const service = new ProductionConsoleService({ logsDir: join(outDir, 'logs'), maxFileSizeBytes: 64 * 1024 * 1024 });
    const projectId = 'real_console_validation';
    const evidence: ProviderEvidence[] = [];

    for (const provider of PRODUCTION_AGENT_PROVIDERS) {
      if (!provider.locate()) {
        evidence.push({
          provider: provider.id,
          installed: false,
          ok: false,
          durationMs: 0,
          entries: 0,
          commandLines: [],
          streamLines: 0,
          finalTextPreview: '',
        });
        continue;
      }
      const before = service.list(projectId, { limit: 10_000 }).total;
      const outcome = await runProductionAgentCommand(provider, {
        console: service,
        projectId,
        jobId: projectId,
        runId: `real_${provider.id}_${Date.now().toString(36)}`,
        stage: 'pesquisa',
        label: 'Validação real do console',
        prompt: 'Responda somente com a palavra: ok',
        timeoutMs: 180_000,
      });
      const entries = service.list(projectId, { limit: 10_000 }).entries.slice(before);
      evidence.push({
        provider: provider.id,
        installed: true,
        ok: outcome.ok,
        durationMs: outcome.durationMs,
        ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
        entries: entries.length,
        commandLines: entries.filter((entry) => entry.channel === 'command').map((entry) => entry.message),
        streamLines: entries.filter((entry) => entry.channel === 'stdout' || entry.channel === 'stderr').length,
        finalTextPreview: outcome.text.slice(0, 400),
      });
    }

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'console.jsonl'), service.export(projectId, 'json'), 'utf8');
    writeFileSync(join(outDir, 'console.txt'), service.export(projectId, 'txt'), 'utf8');
    writeFileSync(
      join(outDir, 'summary.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          projectId,
          providers: evidence,
          totals: service.facets(projectId),
        },
        null,
        2,
      ),
      'utf8',
    );

    const ran = evidence.filter((item) => item.installed);
    expect(ran.length).toBeGreaterThan(0);
    for (const item of ran) {
      // Every executed CLI leaves a real command line and a result event, whatever its exit code.
      expect(item.commandLines.length).toBeGreaterThan(0);
      expect(item.entries).toBeGreaterThan(1);
    }
    expect(ran.some((item) => item.ok)).toBe(true);
  }, 600_000);

  it('falls back to the next available agent when a real provider fails (quota, auth or unavailability)', async () => {
    const service = new ProductionConsoleService({ logsDir: join(outDir, 'logs-fallback') });
    const projectId = 'real_console_fallback';
    const attempts: Array<{ provider: string; ok: boolean; failureReason?: string; durationMs: number }> = [];

    // Same order the studio uses: Antigravity → Claude Code → Codex.
    let succeededWith: string | null = null;
    for (const provider of PRODUCTION_AGENT_PROVIDERS) {
      if (!provider.locate()) continue;
      const outcome = await runProductionAgentCommand(provider, {
        console: service,
        projectId,
        jobId: projectId,
        runId: `fallback_${provider.id}_${Date.now().toString(36)}`,
        stage: 'pesquisa',
        label: 'Cascata real de agentes',
        prompt: 'Responda somente com a palavra: ok',
        timeoutMs: 180_000,
      });
      attempts.push({
        provider: provider.id,
        ok: outcome.ok,
        ...(outcome.failureReason ? { failureReason: outcome.failureReason } : {}),
        durationMs: outcome.durationMs,
      });
      if (outcome.ok) {
        succeededWith = provider.id;
        break;
      }
    }

    const entries = service.list(projectId, { limit: 1000 }).entries;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'fallback-console.txt'), service.export(projectId, 'txt'), 'utf8');
    writeFileSync(join(outDir, 'fallback-summary.json'), JSON.stringify({ attempts, succeededWith }, null, 2), 'utf8');

    expect(attempts.length).toBeGreaterThan(0);
    expect(succeededWith).not.toBeNull();

    // Every failed attempt must be recorded with its outcome, and the winner with a completion event under its source.
    for (const attempt of attempts.filter((item) => !item.ok)) {
      expect(
        entries.some((entry) => entry.source === attempt.provider && entry.event === 'command_failed' && entry.severity === 'error'),
        `${attempt.provider} falhou sem entrada command_failed`,
      ).toBe(true);
      expect(entries.some((entry) => entry.source === attempt.provider && entry.channel === 'result' && entry.durationMs !== undefined)).toBe(true);
    }
    expect(
      entries.some((entry) => entry.source === succeededWith && entry.event === 'command_completed' && entry.exitCode === 0),
    ).toBe(true);
  }, 900_000);
});
