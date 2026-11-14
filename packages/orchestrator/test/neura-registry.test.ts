import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '@neuralbridge/database';
import { NeuraRegistry } from '../src/neura-registry.js';

const migrationsFolder = join(process.cwd(), 'packages', 'database', 'migrations');
const sessionId = '00000000-0000-4000-8000-000000000101';
const at = '2026-11-02T12:00:00.000Z';

describe('NeuraRegistry', () => {
  let handle: DatabaseHandle | undefined;
  afterEach(() => handle?.close());

  it('persists consent and session lifecycle across reopening', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nb-neura-')), 'brain.db');
    handle = openDatabase(file, { migrationsFolder });
    const registry = new NeuraRegistry(handle);
    expect(registry.startSession({ id: sessionId, kind: 'meeting', status: 'listening', consent: true, meetingLanguage: 'en', userPreferredLanguage: 'pt-BR', startedAt: at, updatedAt: at })).toMatchObject({ id: sessionId, consent: true });
    expect(registry.setConsent(sessionId, false, at)).toMatchObject({ consent: false });
    expect(registry.updateStatus(sessionId, 'completed', at)).toMatchObject({ status: 'completed', endedAt: at });
    handle.close();
    handle = openDatabase(file, { migrationsFolder });
    expect(new NeuraRegistry(handle).session(sessionId)).toMatchObject({ status: 'completed', consent: false, meetingLanguage: 'en' });
  });

  it('records bounded suggestions and resolves them without storing audio', () => {
    handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-neura-')), 'brain.db'), { migrationsFolder });
    const registry = new NeuraRegistry(handle);
    registry.startSession({ id: sessionId, kind: 'meeting', status: 'processing', consent: true, startedAt: at, updatedAt: at });
    const suggestion = registry.recordSuggestion({ sessionId, text: 'I can answer that in the next section.', language: 'en', sourceExcerpt: 'Could you explain the next step?', confidence: 0.94, createdAt: at });
    expect(registry.resolveSuggestion(suggestion.id, 'accepted', at)).toMatchObject({ status: 'accepted', resolvedAt: at });
    expect(registry.listSuggestions(sessionId)).toHaveLength(1);
  });

  it('rejects duplicate action fingerprints before execution can be audited twice', () => {
    handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-neura-')), 'brain.db'), { migrationsFolder });
    const registry = new NeuraRegistry(handle);
    registry.startSession({ id: sessionId, kind: 'general', status: 'idle', consent: true, startedAt: at, updatedAt: at });
    registry.recordAction({ sessionId, actionType: 'spotify.play', risk: 'safe', status: 'requested', fingerprint: 'same-action', summary: 'Play a playlist', createdAt: at });
    expect(() => registry.recordAction({ sessionId, actionType: 'spotify.play', risk: 'safe', status: 'requested', fingerprint: 'same-action', summary: 'Play a playlist', createdAt: at })).toThrow('neura_action_duplicate');
  });
});
