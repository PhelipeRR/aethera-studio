import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, taskEvents, tasks } from '@neuralbridge/database';
import { afterEach, describe, expect, it } from 'vitest';
import { skillUsageAnalytics } from '../src/analytics.js';

const migrationsFolder = join(import.meta.dirname, '../../database/migrations');
const handles: Array<ReturnType<typeof openDatabase>> = [];
afterEach(() => { while (handles.length) handles.pop()?.close(); });

describe('skill usage', () => {
  it('counts recorded activity by kind and ignores damaged payloads', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-skill-usage-')), 'db.sqlite'), { migrationsFolder });
    handles.push(handle);
    handle.db.insert(tasks).values({ id: 't', prompt: 'x', projectId: null, mode: 'claude', status: 'completed' }).run();
    const event = (kind: string, payload: string, at: string) => handle.db.insert(taskEvents).values({ taskId: 't', kind, data: payload, at }).run();
    event('skill', JSON.stringify({ name: 'a', status: 'used' }), '2026-11-01T01:00:00.000Z');
    event('skill', JSON.stringify({ name: 'a', status: 'failed' }), '2026-11-01T02:00:00.000Z');
    event('skill', JSON.stringify({ name: 'b', status: 'loaded' }), '2026-11-01T00:00:00.000Z');
    event('skills_context', JSON.stringify({ skills: ['a'] }), '2026-11-01T03:00:00.000Z');
    event('skill', '{quebrado', '2026-11-01T04:00:00.000Z');
    event('text', JSON.stringify({ name: 'c' }), '2026-11-01T04:00:00.000Z');
    expect(skillUsageAnalytics(handle)).toEqual([{ skillId: 'a', used: 1, loaded: 0, failed: 1, injected: 1, lastAt: '2026-11-01T03:00:00.000Z' }, { skillId: 'b', used: 0, loaded: 1, failed: 0, injected: 0, lastAt: '2026-11-01T00:00:00.000Z' }]);
  });
});
