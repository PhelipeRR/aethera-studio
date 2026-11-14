import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { memories, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainService, GatedProvider, IndexScheduler, projectScope, readSemanticSettings, writeSemanticSettings } from '../src/index.js';
import { FakeProvider } from './fake-provider.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-sem-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values({ id: 'api', name: 'api', rootPath: 'C:\\src\\api' }).run();
});

afterEach(() => handle.close());

describe('semantic search settings', () => {
  it('are off until the user consents, and record when they did', () => {
    expect(readSemanticSettings(handle)).toEqual({ enabled: false, consentedAt: null });
    writeSemanticSettings(handle, { enabled: true, consentedAt: '2026-10-28T19:00:00.000Z' });
    expect(readSemanticSettings(handle)).toEqual({ enabled: true, consentedAt: '2026-10-28T19:00:00.000Z' });
  });

  it('ignore a malformed stored value', () => {
    handle.sqlite.prepare("INSERT INTO settings (key, value) VALUES ('semantic_search', '{oops')").run();
    expect(readSemanticSettings(handle)).toEqual({ enabled: false, consentedAt: null });
  });
});

describe('GatedProvider', () => {
  it('re-reads the setting on every call, so running processes follow the user switching it', async () => {
    const gated = new GatedProvider(new FakeProvider(), () => readSemanticSettings(handle).enabled);
    expect(await gated.availability()).toEqual({ ok: false, reason: 'disabled' });
    writeSemanticSettings(handle, { enabled: true, consentedAt: '2026-10-28T19:00:00.000Z' });
    expect(await gated.availability()).toEqual({ ok: true });
    expect(gated.model).toBe('fake-concepts');
  });
});

describe('IndexScheduler', () => {
  it('indexes in the background, coalescing repeated requests, and only when semantic search is usable', async () => {
    const brain = new BrainService(handle);
    const provider = new FakeProvider();
    let enabled = false;
    const scheduler = new IndexScheduler(handle, new GatedProvider(provider, () => enabled));
    brain.store({ title: 'Banco', content: 'postgres', type: 'decision' }, projectScope('api'), { kind: 'user', client: 'test' });

    await scheduler.runNow();
    expect(provider.calls).toBe(0);

    enabled = true;
    scheduler.schedule();
    scheduler.schedule();
    await scheduler.idle();
    expect(provider.calls).toBe(1);
    expect(handle.sqlite.prepare("SELECT embedding_status AS s FROM memories").get()).toEqual({ s: 'ready' });
  });

  it('does not lose a request that arrives while a finished run is still cleaning up', async () => {
    // The race window is a few microtasks wide; try every delay that could land in it.
    const brain = new BrainService(handle);
    const outcomes: string[] = [];
    for (let ticks = 0; ticks <= 8; ticks++) {
      let enabled = false;
      const scheduler = new IndexScheduler(handle, new GatedProvider(new FakeProvider(), () => enabled));
      const { memory } = brain.store({ title: `Banco ${ticks}`, content: 'postgres', type: 'decision' }, projectScope('api'), { kind: 'user', client: 'test' });

      scheduler.schedule(); // runs while disabled and finds nothing to do
      for (let i = 0; i < ticks; i++) await Promise.resolve();
      enabled = true;
      scheduler.schedule();
      await scheduler.idle();
      outcomes.push(handle.db.select({ s: memories.embeddingStatus }).from(memories).where(eq(memories.id, memory.id)).get()?.s ?? 'missing');
    }
    expect(outcomes).toEqual(Array(9).fill('ready'));
  });
});
