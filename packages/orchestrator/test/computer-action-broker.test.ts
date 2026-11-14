import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type DatabaseHandle } from '@neuralbridge/database';
import type { ComputerActionRequest } from '@neuralbridge/shared';
import { ComputerActionBroker } from '../src/computer-action-broker.js';
import { NeuraRegistry } from '../src/neura-registry.js';

const migrationsFolder = join(process.cwd(), 'packages', 'database', 'migrations');
const actionId = '00000000-0000-4000-8000-000000000201';
const sessionId = '00000000-0000-4000-8000-000000000202';
const createdAt = '2026-11-02T12:00:00.000Z';
const expiresAt = '2026-11-02T12:05:00.000Z';

describe('ComputerActionBroker', () => {
  let handle: DatabaseHandle | undefined;
  afterEach(() => handle?.close());
  function broker(executor?: { execute: (request: ComputerActionRequest) => Promise<string> }): ComputerActionBroker {
    handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-action-')), 'brain.db'), { migrationsFolder });
    new NeuraRegistry(handle).startSession({ id: sessionId, kind: 'general', status: 'idle', consent: true, startedAt: createdAt, updatedAt: createdAt });
    return new ComputerActionBroker(handle, executor ? { now: () => '2026-11-02T12:01:00.000Z', executor } : { now: () => '2026-11-02T12:01:00.000Z' });
  }

  it('approves safe actions immediately and deduplicates fingerprints', () => {
    const actionBroker = broker();
    const value = actionBroker.request({ actionId, sessionId, actionType: 'spotify.next', risk: 'safe', summary: 'Avançar música', fingerprint: 'spotify-next-1', createdAt, expiresAt });
    expect(value).toMatchObject({ status: 'approved' });
    expect(actionBroker.request({ actionId: '00000000-0000-4000-8000-000000000203', sessionId, actionType: 'spotify.next', risk: 'safe', summary: 'Avançar música', fingerprint: 'spotify-next-1', createdAt, expiresAt })).toMatchObject({ status: 'approved', message: 'Ação já registrada para este fingerprint.' });
  });

  it('requires approval and executes only after allow', async () => {
    const execute = async () => 'Janela aberta';
    const actionBroker = broker({ execute });
    expect(actionBroker.request({ actionId, sessionId, actionType: 'computer.open_app', risk: 'confirm', summary: 'Abrir aplicativo', fingerprint: 'open-app-1', createdAt, expiresAt })).toMatchObject({ status: 'requested' });
    expect(await actionBroker.decide({ actionId, decision: 'allow', decidedAt: '2026-11-02T12:02:00.000Z' })).toMatchObject({ status: 'completed', message: 'Janela aberta' });
  });

  it('does not execute denied or cancelled actions', async () => {
    const execute = async () => 'não deveria executar';
    const actionBroker = broker({ execute });
    actionBroker.request({ actionId, sessionId, actionType: 'computer.type', risk: 'confirm', summary: 'Digitar resposta', fingerprint: 'type-1', createdAt, expiresAt });
    expect(await actionBroker.decide({ actionId, decision: 'deny', decidedAt: '2026-11-02T12:02:00.000Z' })).toMatchObject({ status: 'denied' });
    expect(await actionBroker.decide({ actionId, decision: 'allow', decidedAt: '2026-11-02T12:03:00.000Z' })).toMatchObject({ status: 'denied' });
  });
});
