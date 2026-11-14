import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCliAdapter, CodexCliAdapter, type AgentAdapter } from '@neuralbridge/agents';
import type { AgentEvent } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';

// Real runs through the adapters with the logged-in CLIs (a few short requests on the user's plan).
const enabled = process.env['NB_REAL_CLI'] === '1';

function project(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'nb-agents-')), 'meu projeto ação');
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

/** PIDs of agent-related processes, to prove a cancelled run leaves nothing behind (the user's own sessions are excluded by diffing). */
function agentPids(): Set<string> {
  const csv = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return new Set(
    csv
      .split(/\r?\n/)
      .map((line) => line.split('","'))
      .filter((cols) => /^"?(claude|codex|node)\.exe$/i.test(cols[0] ?? ''))
      .map((cols) => cols[1] ?? ''),
  );
}

const adapters: [string, () => AgentAdapter][] = [
  ['Claude Code', () => new ClaudeCliAdapter()],
  ['Codex', () => new CodexCliAdapter()],
];

describe.skipIf(!enabled)('agent adapters with the real CLIs', () => {
  for (const [name, create] of adapters) {
    it(`${name}: detects itself as ready`, async () => {
      const status = await create().detect({ refresh: true });
      expect(status).toMatchObject({ installed: true, authenticated: true, problems: [] });
    });

    it(`${name}: an edit task changes the project and reports what it did`, { timeout: 240_000 }, async () => {
      const cwd = project();
      const events = await collect(create().run({ prompt: 'Create a file named hello.txt containing exactly: oi', cwd, mode: 'edit', timeoutMs: 180_000 }));
      expect(readFileSync(join(cwd, 'hello.txt'), 'utf8').trim()).toBe('oi');
      expect(events[0]).toMatchObject({ kind: 'session', sessionId: expect.any(String) });
      expect(events).toContainEqual(expect.objectContaining({ kind: 'file_change', path: expect.stringContaining('hello.txt') }));
      expect(events).toContainEqual(expect.objectContaining({ kind: 'usage', inputTokens: expect.any(Number), outputTokens: expect.any(Number) }));
      expect(events.at(-1)).toMatchObject({ kind: 'done', ok: true, exitCode: 0, sessionId: expect.any(String) });
    });

    it(`${name}: a read-only task cannot write files`, { timeout: 240_000 }, async () => {
      const cwd = project();
      const events = await collect(create().run({ prompt: 'Create a file named blocked.txt containing: x', cwd, mode: 'read-only', timeoutMs: 180_000 }));
      expect(existsSync(join(cwd, 'blocked.txt'))).toBe(false);
      expect(events).not.toContainEqual(expect.objectContaining({ kind: 'file_change' }));
      expect(events.at(-1)).toMatchObject({ kind: 'done' });
    });

    it(`${name}: cancelling stops the run and leaves no process behind`, { timeout: 120_000 }, async () => {
      const before = agentPids();
      const controller = new AbortController();
      const cwd = project();
      const events: AgentEvent[] = [];
      const timer = setTimeout(() => controller.abort(), 4000);
      for await (const event of create().run({ prompt: 'Count from 1 to 2000, one number per line, explaining each.', cwd, mode: 'read-only' }, controller.signal)) {
        events.push(event);
        if (event.kind === 'session') controller.abort();
      }
      clearTimeout(timer);
      expect(events.at(-1)).toMatchObject({ kind: 'done', ok: false, cancelled: true });
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
      const leftover = [...agentPids()].filter((pid) => !before.has(pid));
      expect(leftover).toEqual([]);
    });
  }
});
