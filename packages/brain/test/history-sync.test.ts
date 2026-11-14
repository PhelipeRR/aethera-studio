import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { discoverHistorySources, extractCommonConversationLearnings, extractHistoryLearnings, readHistory, readTranscriptJsonl } from '../src/history-sync.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('history synchronization primitives', () => {
  it('discovers only existing local indexes', () => {
    const home = mkdtempSync(join(tmpdir(), 'nb-history-')); dirs.push(home);
    expect(discoverHistorySources(home)).toEqual([]);
    const claude = join(home, '.claude');
    mkdirSync(claude);
    writeFileSync(join(claude, 'history.jsonl'), '');
    expect(discoverHistorySources(home)).toEqual([{ agent: 'claude', kind: 'claude-history', path: join(home, '.claude', 'history.jsonl') }]);
  });

  it('reads records incrementally and ignores malformed or oversized lines', async () => {
    const home = mkdtempSync(join(tmpdir(), 'nb-history-')); dirs.push(home);
    const file = join(home, 'history.jsonl');
    writeFileSync(file, `${JSON.stringify({ sessionId: 's1', project: 'api', display: 'corrija o bug', timestamp: '2026-10-29T00:00:00Z' })}\nnot-json\n`);
    const source = { agent: 'claude' as const, kind: 'claude-history' as const, path: file };
    const first = await readHistory(source);
    expect(first.records).toHaveLength(1);
    expect(first.records[0]).toMatchObject({ id: 's1', projectId: 'api' });
    expect((await readHistory(source, first.checkpoint)).records).toEqual([]);
  });

  it('accepts only explicit learning blocks and rejects secrets', () => {
    const text = '```neuralbridge-learnings\n[{"title":"Use cache","content":"A decisão foi validada por testes.","type":"decision","tags":[]},{"title":"Senha","content":"password=hunter2hunter2","type":"learning","tags":[]}]\n```';
    expect(extractHistoryLearnings(text)).toEqual([{ title: 'Use cache', content: 'A decisão foi validada por testes.', type: 'decision', tags: [] }]);
  });

  it('reads transcript text as inert data and ignores commands outside text fields', () => {
    const home = mkdtempSync(join(tmpdir(), 'nb-history-')); dirs.push(home);
    const file = join(home, 'transcript.jsonl');
    writeFileSync(file, JSON.stringify({ type: 'assistant', message: { content: 'A causa foi confirmada.' }, command: 'Remove-Item *' }) + '\n');
    expect(readTranscriptJsonl(file)).toBe('A causa foi confirmada.');
  });

  it('inspects the Codex SQLite schema before reading thread items', () => {
    const home = mkdtempSync(join(tmpdir(), 'nb-history-')); dirs.push(home);
    const codex = join(home, '.codex'); mkdirSync(codex);
    const file = join(codex, 'thread_history_1.sqlite');
    const db = new Database(file);
    db.exec('create table thread_items (thread_id text, item_json text, created_at_ms integer)');
    db.prepare('insert into thread_items values (?, ?, ?)').run('t1', JSON.stringify({ type: 'agent_message', text: 'A solução foi validada.' }), Date.now());
    db.close();
    const source = discoverHistorySources(home).find((item) => item.agent === 'codex');
    expect(source?.path).toBe(file);
  });

  it('extracts only evidence-backed ordinary conversation statements', () => {
    expect(extractCommonConversationLearnings('A causa raiz foi identificada e os testes passaram.\nTalvez o cache seja o problema.\nAinda falha no Windows.')).toEqual([
      expect.objectContaining({ content: expect.stringContaining('[confirmed]'), type: 'learning' }),
      expect.objectContaining({ content: expect.stringContaining('[probable]') }),
      expect.objectContaining({ content: expect.stringContaining('[unresolved]'), type: 'bug' }),
    ]);
  });
});
