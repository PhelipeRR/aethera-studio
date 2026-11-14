import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentEvent } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { createClaudeParser } from '../src/claude-parser.js';
import { createCodexParser } from '../src/codex-parser.js';

// Fixtures are real CLI output (Claude Code 2.1.312, Codex 0.162.1), redacted by scripts/record-cli-fixtures.mjs.
const fixture = (name: string) => readFileSync(resolve(import.meta.dirname, 'fixtures', `${name}.jsonl`), 'utf8').trim().split('\n');
// Parsers keep state across lines (a Claude tool call only counts once its result arrives).
const parseAll = (name: string, create: () => (line: string) => AgentEvent[]) => {
  const parse = create();
  return fixture(name).flatMap((line) => parse(line));
};
const parseClaudeLine = (line: string) => createClaudeParser()(line);
const parseCodexLine = (line: string) => createCodexParser()(line);
const kinds = (events: AgentEvent[]) => events.map((event) => event.kind);

describe('Claude stream-json parser', () => {
  it('turns a text answer into session, text, result and usage', () => {
    const events = parseAll('claude-text', createClaudeParser);
    expect(kinds(events).filter((kind) => kind !== 'limits')).toEqual(['session', 'capabilities', 'text', 'usage', 'context', 'result']);
    expect(events[0]).toMatchObject({ kind: 'session', sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/), model: expect.any(String) });
    expect(events.find((event) => event.kind === 'result')).toEqual({ kind: 'result', text: 'fixture-ok', ok: true });
  });

  it('reports tool calls, file changes and token usage of an edit', () => {
    const events = parseAll('claude-edit', createClaudeParser);
    expect(events).toContainEqual({ kind: 'tool', name: 'Write', summary: 'C:\\work\\hello.txt' });
    expect(events).toContainEqual({ kind: 'file_change', path: 'C:\\work\\hello.txt', change: 'write' });
    const usage = events.find((event) => event.kind === 'usage');
    expect(usage).toMatchObject({ kind: 'usage', inputTokens: expect.any(Number), outputTokens: expect.any(Number), cachedTokens: expect.any(Number), costUsd: expect.any(Number) });
    if (usage?.kind === 'usage') expect(usage.inputTokens).toBeGreaterThan(usage.cachedTokens ?? Infinity);
  });

  it('surfaces a denied permission even though the run itself succeeds', () => {
    const events = parseAll('claude-denied', createClaudeParser);
    expect(events).toContainEqual({ kind: 'permission_denied', tool: 'Write', message: expect.stringContaining('blocked.txt') });
    expect(events).not.toContainEqual(expect.objectContaining({ kind: 'file_change' }));
  });

  it('keeps unknown or malformed lines as raw instead of dropping them', () => {
    expect(parseClaudeLine('{"type":"brand_new_event","x":1}')).toEqual([{ kind: 'raw', line: '{"type":"brand_new_event","x":1}' }]);
    expect(parseClaudeLine('not json at all')).toEqual([{ kind: 'raw', line: 'not json at all' }]);
    expect(parseClaudeLine('')).toEqual([]);
  });

  it('carries the structured output of --json-schema runs', () => {
    // Shape observed with Claude Code 2.1.312: result keeps the JSON as text and adds structured_output.
    const line = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{"colours":["azul"]}', structured_output: { colours: ['azul'] }, usage: {} });
    expect(parseClaudeLine(line)).toContainEqual({ kind: 'result', text: '{"colours":["azul"]}', ok: true, structured: { colours: ['azul'] } });
  });

  it('reports the MCP servers and skills the session was started with', () => {
    // Real init shape (Claude Code 2.1.312): mcp_servers is [{ name, status }], skills a list of names.
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', mcp_servers: [{ name: 'neuralbridge', status: 'connected' }, { name: 'x' }], skills: ['frontend-design', 7] });
    // A separate event: the session one stays internal (ids), this one is shown.
    expect(parseClaudeLine(line)).toEqual([
      { kind: 'session', sessionId: 's1', model: 'm' },
      { kind: 'capabilities', mcpServers: [{ name: 'neuralbridge', status: 'connected' }, { name: 'x', status: 'unknown' }], skills: ['frontend-design'] },
    ]);
  });

  it('reports the context window use of the last call, from the real result fields', () => {
    const context = parseAll('claude-text', createClaudeParser).find((event) => event.kind === 'context');
    // claude-text.jsonl: last iteration 2 + 26887 + 16709 tokens; modelUsage[claude-opus-5-5].contextWindow 1000000.
    expect(context).toEqual({ kind: 'context', usedTokens: 2 + 26887 + 16709, windowTokens: 1_000_000 });
  });

  it('reports no context use when the result has no per-call iterations', () => {
    const line = JSON.stringify({ type: 'result', is_error: false, result: 'ok', usage: { input_tokens: 5, output_tokens: 1 } });
    expect(parseClaudeLine(line).some((event) => event.kind === 'context')).toBe(false);
  });

  it('reports a skill as used only once its Skill tool call succeeds, and as failed on an error', () => {
    // Real shapes: tool_use name "Skill" with input { skill }, then a tool_result "Launching skill: <name>".
    const parse = createClaudeParser();
    const call = (id: string, skill: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] } });
    const result = (id: string, content: string, isError: boolean) =>
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
    expect(parse(call('a', 'frontend-design'))).toEqual([{ kind: 'tool', name: 'Skill', summary: 'frontend-design' }]);
    expect(parse(result('a', 'Launching skill: frontend-design', false))).toEqual([
      { kind: 'skill', name: 'frontend-design', status: 'used', evidence: 'Launching skill: frontend-design' },
    ]);
    parse(call('b', 'missing-skill'));
    expect(parse(result('b', 'Unknown skill: missing-skill', true))).toEqual([{ kind: 'skill', name: 'missing-skill', status: 'failed', evidence: 'Unknown skill: missing-skill' }]);
    // A result without a matching call says nothing about skills.
    expect(parse(result('zzz', 'Launching skill: ghost', false))).toEqual([]);
  });

  it('marks an error result as not ok', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Not logged in', usage: {}, total_cost_usd: 0 });
    expect(parseClaudeLine(line)).toContainEqual({ kind: 'result', text: 'Not logged in', ok: false });
  });
});

describe('Codex --json parser', () => {
  it('turns a text answer into session, text and usage', () => {
    const events = parseAll('codex-text', createCodexParser);
    expect(kinds(events)).toEqual(['session', 'text', 'usage']);
    expect(events).toContainEqual({ kind: 'text', text: 'fixture-ok' });
    expect(events.at(-1)).toMatchObject({ kind: 'usage', costUsd: null, cachedTokens: expect.any(Number) });
  });

  it('reports a completed file change once', () => {
    const changes = parseAll('codex-edit', createCodexParser).filter((event) => event.kind === 'file_change');
    expect(changes).toEqual([{ kind: 'file_change', path: 'C:\\work\\hello.txt', change: 'add' }]);
  });

  it('reports commands, MCP calls and failures', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', exit_code: 1, aggregated_output: '...' } }))).toEqual([
      { kind: 'tool', name: 'shell', summary: 'npm test (exit 1)' },
    ]);
    expect(parseCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'neuralbridge', tool: 'brain_search', status: 'completed' } }))).toEqual([
      { kind: 'tool', name: 'neuralbridge.brain_search', summary: 'completed' },
    ]);
    expect(parseCodexLine(JSON.stringify({ type: 'turn.failed', error: { message: 'usage limit reached' } }))).toEqual([{ kind: 'error', message: 'usage limit reached' }]);
    expect(parseCodexLine(JSON.stringify({ type: 'error', message: 'stream disconnected' }))).toEqual([{ kind: 'error', message: 'stream disconnected' }]);
    expect(parseCodexLine(JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } }))).toEqual([]);
    expect(parseCodexLine('{"type":"item.completed","item":{"type":"hologram"}}')).toEqual([{ kind: 'raw', line: '{"type":"item.completed","item":{"type":"hologram"}}' }]);
  });

  it('reports a skill as loaded when a command reads its SKILL.md, never as used', () => {
    const read = (command: string, exit: number) => JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command, exit_code: exit, status: 'completed' } });
    expect(parseCodexLine(read('Get-Content C:\\Users\\me\\.codex\\skills\\playwright\\SKILL.md', 0))).toEqual([
      { kind: 'tool', name: 'shell', summary: 'Get-Content C:\\Users\\me\\.codex\\skills\\playwright\\SKILL.md (exit 0)' },
      { kind: 'skill', name: 'playwright', status: 'loaded', evidence: 'Get-Content C:\\Users\\me\\.codex\\skills\\playwright\\SKILL.md' },
    ]);
    expect(parseCodexLine(read("sed -n '1,80p' /home/me/.agents/skills/web-design/SKILL.md", 0))).toContainEqual(expect.objectContaining({ kind: 'skill', name: 'web-design', status: 'loaded' }));
    // A failed read loaded nothing; a mention of SKILL.md without a skill folder names no skill.
    expect(parseCodexLine(read('cat ~/.codex/skills/playwright/SKILL.md', 1)).some((event) => event.kind === 'skill')).toBe(false);
    expect(parseCodexLine(read('echo SKILL.md', 0)).some((event) => event.kind === 'skill')).toBe(false);
  });

  it('reports no context window: exec --json does not expose it', () => {
    expect(parseAll('codex-text', createCodexParser).some((event) => event.kind === 'context')).toBe(false);
  });
});

describe('Claude usage limits', () => {
  it('reads the windows of a rate_limit_event', () => {
    const parse = createClaudeParser();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.9, resetsAt: 1793418000, status: 'allowed' }, seven_day: { utilization: 0.92, status: 'allowed' } } } });
    expect(parse(line)).toEqual([{ kind: 'limits', windows: [{ id: 'five_hour', utilization: 0.9, resetsAt: new Date(1793418000 * 1000).toISOString(), status: 'allowed' }, { id: 'seven_day', utilization: 0.92, resetsAt: null, status: 'allowed' }] }]);
  });

  it('stays silent on the older event without windows', () => {
    expect(createClaudeParser()(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))).toEqual([]);
  });
});
