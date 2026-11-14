import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { accessLog, links, memories, openDatabase, projects } from '@neuralbridge/database';
import { findClientCli, type CommandSpec } from '@neuralbridge/workspace';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

// The Neural Brain acceptance flow with the real, logged-in CLIs (uses a little of the user's plan quota):
// Claude records a decision -> Codex recalls it and records its result -> Claude recalls Codex's result.
// The server is injected per invocation (--mcp-config / -c mcp_servers.*): no client config is changed.
const enabled = process.env['NB_REAL_CLI'] === '1';

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electron = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const serverScript = join(desktopDir, 'out/main/mcp-server.js');

function run(cli: CommandSpec, args: string[], cwd: string, timeoutMs = 240_000): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(cli.command, [...cli.args, ...args], { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

describe.skipIf(!enabled)('Claude Code and Codex share the Neural Brain', () => {
  it('a decision made in Claude reaches Codex, and Codex results reach Claude', { timeout: 900_000 }, async () => {
    const claude = findClientCli('claude');
    const codex = findClientCli('codex');
    expect(claude && codex, 'both CLIs must be installed').toBeTruthy();
    if (!claude || !codex) return;

    const root = mkdtempSync(join(tmpdir(), 'nb-real-'));
    const dataDir = join(root, 'data');
    const project = join(root, 'shop api');
    mkdirSync(project, { recursive: true });
    const tag = randomBytes(4).toString('hex');
    const decisionTitle = `ADR ${tag}: data access through repositories`;
    const decisionMarker = `marker-${randomBytes(6).toString('hex')}`;
    const resultTitle = `Repositories implemented ${tag}`;
    const resultMarker = `result-${randomBytes(6).toString('hex')}`;

    const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: join(desktopDir, 'out/main/migrations') });
    handle.db.insert(projects).values({ id: 'shop-api', name: 'shop api', rootPath: project }).run();
    handle.close();

    const env = { ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: dataDir };
    const mcpConfig = join(root, 'claude-mcp.json');
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { neuralbridge: { command: electron, args: [serverScript], env } } }));
    const claudeArgs = (prompt: string, tools: string[]) => [
      '-p',
      prompt,
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--permission-mode',
      'default',
      '--allowedTools',
      ...tools.map((tool) => `mcp__neuralbridge__${tool}`),
      '--output-format',
      'json',
    ];
    const toml = (value: unknown) => JSON.stringify(value);
    const codexArgs = (prompt: string, tools: string[]) => [
      'exec',
      '--skip-git-repo-check',
      '-s',
      'read-only',
      '-c',
      `mcp_servers.neuralbridge.command=${toml(electron)}`,
      '-c',
      `mcp_servers.neuralbridge.args=${toml([serverScript])}`,
      '-c',
      `mcp_servers.neuralbridge.env={ELECTRON_RUN_AS_NODE="1",NB_DATA_DIR=${toml(dataDir)}}`,
      '-c',
      'mcp_servers.neuralbridge.default_tools_approval_mode="approve"',
      '-c',
      `mcp_servers.neuralbridge.enabled_tools=${toml(tools)}`,
      prompt,
    ];

    // 1. Claude records an architectural decision.
    const step1 = await run(
      claude,
      claudeArgs(
        `Use the brain_store tool once to save a memory with title "${decisionTitle}", type "decision", ` +
          `content "All data access goes through repository classes; controllers never use the ORM directly. Verification code: ${decisionMarker}." ` +
          'Then reply with only the word: stored',
        ['brain_store'],
      ),
      project,
    );
    expect(step1.code, step1.stderr).toBe(0);

    // 2. Codex recalls it and records its implementation result, linking back to the decision.
    const step2 = await run(
      codex,
      codexArgs(
        `First call the MCP tool brain_recall with id_or_title "${decisionTitle}". ` +
          `Then call brain_store with title "${resultTitle}", type "learning", content ` +
          `"Implemented following [[${decisionTitle}]]. Tests green. Verification code: ${resultMarker}." ` +
          'Finally reply with only the verification code you read from the recalled decision.',
        ['brain_recall', 'brain_store'],
      ),
      project,
    );
    expect(step2.code, step2.stderr.slice(-2000)).toBe(0);
    expect(step2.stdout).toContain(decisionMarker);

    // 3. Claude, later, finds what Codex recorded.
    const step3 = await run(
      claude,
      claudeArgs(`Call brain_recall with id_or_title "${resultTitle}" and reply with only the verification code in its content.`, ['brain_recall']),
      project,
    );
    expect(step3.code, step3.stderr).toBe(0);
    expect((JSON.parse(step3.stdout) as { result: string }).result).toContain(resultMarker);

    // The database shows who wrote what, in which project, and the resolved link.
    const check = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: join(desktopDir, 'out/main/migrations') });
    const decision = check.db.select().from(memories).where(eq(memories.title, decisionTitle)).get();
    const result = check.db.select().from(memories).where(eq(memories.title, resultTitle)).get();
    expect(decision).toMatchObject({ projectId: 'shop-api', sourceKind: 'claude', type: 'decision' });
    expect(result).toMatchObject({ projectId: 'shop-api', sourceKind: 'codex', type: 'learning' });
    expect(check.db.select().from(links).where(eq(links.sourceId, result?.id ?? '')).all()).toEqual([
      expect.objectContaining({ targetId: decision?.id, origin: 'wikilink' }),
    ]);
    const clients = [...new Set(check.db.select({ client: accessLog.client }).from(accessLog).all().map((row) => row.client))];
    check.close();

    console.log(
      JSON.stringify(
        { claudeStoreMs: step1.ms, codexRecallAndStoreMs: step2.ms, claudeRecallMs: step3.ms, accessLogClients: clients, decisionId: decision?.id, resultId: result?.id },
        null,
        2,
      ),
    );
  });
});
