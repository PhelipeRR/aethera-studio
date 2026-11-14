import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { synchronizeHistories, type HistorySyncCheckpointStore } from '../src/history-sync-service.js';
import type { HistoryCheckpoint, HistorySource } from '../src/history-sync.js';

class Store implements HistorySyncCheckpointStore {
  private readonly values = new Map<string, HistoryCheckpoint>();
  get(source: HistorySource): HistoryCheckpoint | undefined { return this.values.get(source.path); }
  set(source: HistorySource, checkpoint: HistoryCheckpoint): void { this.values.set(source.path, checkpoint); }
}

describe('history synchronization service', () => {
  it('proposes only explicit learning blocks and preserves project/agent context', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-history-service-'));
    try {
      const path = join(dir, 'history.jsonl');
      writeFileSync(path, JSON.stringify({ sessionId: 's1', project: 'project-a', display: 'prompt' }) + '\n');
      const source: HistorySource = { agent: 'claude', kind: 'claude-history', path };
      const proposed: Array<{ projectId: string | null; agent: string; sourceId: string }> = [];
      const result = await synchronizeHistories({
        sources: [source], checkpoints: new Store(),
        readTranscript: async () => '```neuralbridge-learnings\n[{"title":"T","content":"confirmed","type":"learning","tags":[]}]\n```',
        propose: async (items, context) => { expect(items).toHaveLength(1); proposed.push(context); },
      });
      expect(result).toMatchObject({ sources: 1, records: 1, changed: 1, proposals: 1, errors: 0 });
      expect(proposed).toEqual([{ projectId: 'project-a', agent: 'claude', sourceId: 's1' }]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not create proposals from metadata-only history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-history-service-'));
    try {
      const path = join(dir, 'history.jsonl');
      writeFileSync(path, JSON.stringify({ sessionId: 's1', display: 'user prompt only' }) + '\n');
      let called = false;
      const result = await synchronizeHistories({
        sources: [{ agent: 'claude', kind: 'claude-history', path }], checkpoints: new Store(),
        propose: async () => { called = true; },
      });
      expect(result.proposals).toBe(0); expect(called).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('stops between records when cancellation is requested', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-history-service-'));
    try {
      const path = join(dir, 'history.jsonl');
      writeFileSync(path, `${JSON.stringify({ sessionId: 's1', display: 'prompt one' })}\n${JSON.stringify({ sessionId: 's2', display: 'prompt two' })}\n`);
      const controller = new AbortController();
      let seen = 0;
      const result = await synchronizeHistories({
        sources: [{ agent: 'claude', kind: 'claude-history', path }], checkpoints: new Store(), signal: controller.signal,
        readTranscript: async () => { seen++; controller.abort(); return '```neuralbridge-learnings\n[{"title":"T","content":"confirmed","type":"learning","tags":[]}]\n```'; },
        propose: async () => undefined,
      });
      expect(seen).toBe(1); expect(result.records).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
