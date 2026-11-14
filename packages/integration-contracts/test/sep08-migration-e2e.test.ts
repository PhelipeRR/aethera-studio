import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createIsolatedAppStub,
  executeEcosystemMigration,
  planEcosystemMigration,
  rollbackEcosystemMigration,
  verifyMigrationIntegrity,
  type IAgentProviderContract,
} from '../src/index.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SEP-08 — Migração de dados, backup, idempotência, rollback e matriz RF-07', () => {
  it('executa dry-run, migra com manifesto SHA-256, mantém idempotência e faz rollback íntegro', () => {
    const root = createTempDir('sep08-mig-');
    const sourceDir = join(root, 'NeuralBridge');
    const targets = {
      orchestrator: join(root, 'SingularityOrchestrator'),
      aethera: join(root, 'AetheraStudio'),
      void: join(root, 'Void'),
    };
    const backupDir = join(root, 'backup');

    // Popular origem simulando dados reais do monolito
    mkdirSync(join(sourceDir, 'aethera', 'renders'), { recursive: true });
    mkdirSync(join(sourceDir, 'void', 'memory'), { recursive: true });
    mkdirSync(join(sourceDir, 'brain'), { recursive: true });
    mkdirSync(join(sourceDir, 'credentials'), { recursive: true });

    writeFileSync(join(sourceDir, 'neuralbridge.db'), 'sqlite-orchestrator-data', 'utf8');
    writeFileSync(join(sourceDir, 'neuralbridge.db-wal'), 'sqlite-wal-frames', 'utf8');
    writeFileSync(join(sourceDir, 'neuralbridge.db-shm'), 'sqlite-shm-index', 'utf8');
    writeFileSync(join(sourceDir, 'brain', 'index.json'), '{"memories":42}', 'utf8');
    writeFileSync(join(sourceDir, 'aethera', 'renders', 'video1.mp4'), 'mp4-binary-sim', 'utf8');
    writeFileSync(join(sourceDir, 'void', 'memory', 'personal.json'), '{"notes":3}', 'utf8');
    writeFileSync(join(sourceDir, 'credentials', 'youtube-oauth-token.json'), '{"access_token":"secret"}', 'utf8');

    // Arquivo pré-existente no destino para validar backup + restore no rollback
    mkdirSync(join(targets.orchestrator, 'brain'), { recursive: true });
    writeFileSync(join(targets.orchestrator, 'brain', 'index.json'), '{"memories":1}', 'utf8');

    const plan = planEcosystemMigration({ sourceDir, targets });
    expect(plan.countsByApp).toEqual({ orchestrator: 4, aethera: 1, void: 1 });
    expect(plan.skippedCredentials).toHaveLength(1);
    expect(plan.skippedCredentials[0]?.reason).toBe('reauth_required_no_plaintext_secret_copy');

    // 1. Dry-run não cria arquivos novos
    const dryReport = executeEcosystemMigration({ sourceDir, targets, backupDir, dryRun: true });
    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.copied).toBe(0);
    expect(existsSync(join(targets.aethera, 'aethera', 'renders', 'video1.mp4'))).toBe(false);

    // 2. Migração real + verificação de integridade SHA-256 (incluindo -wal/-shm)
    const execReport = executeEcosystemMigration({ sourceDir, targets, backupDir, dryRun: false });
    expect(execReport.copied).toBe(6);
    expect(execReport.skippedCredentials).toBe(1);
    const integrity = verifyMigrationIntegrity(execReport);
    expect(integrity).toEqual({ ok: true, verified: 6, mismatches: [] });
    expect(existsSync(join(targets.orchestrator, 'neuralbridge.db-wal'))).toBe(true);
    expect(existsSync(join(targets.orchestrator, 'neuralbridge.db-shm'))).toBe(true);
    expect(existsSync(join(targets.aethera, 'aethera', 'renders', 'video1.mp4'))).toBe(true);
    expect(existsSync(join(targets.void, 'void', 'memory', 'personal.json'))).toBe(true);
    expect(existsSync(join(targets.aethera, 'credentials', 'youtube-oauth-token.json'))).toBe(false);
    expect(readFileSync(join(targets.orchestrator, 'brain', 'index.json'), 'utf8')).toBe('{"memories":42}');

    // 3. Idempotência na segunda execução
    const secondReport = executeEcosystemMigration({ sourceDir, targets, backupDir, dryRun: false });
    expect(secondReport.copied).toBe(0);
    expect(secondReport.skippedIdempotent).toBe(6);

    // 4. Rollback completo
    const rb = rollbackEcosystemMigration(backupDir);
    expect(rb.removed).toBe(5);
    expect(rb.restored).toBe(1);
    expect(existsSync(join(targets.aethera, 'aethera', 'renders', 'video1.mp4'))).toBe(false);
    expect(readFileSync(join(targets.orchestrator, 'brain', 'index.json'), 'utf8')).toBe('{"memories":1}');
    // Origem preservada intacta
    expect(existsSync(join(sourceDir, 'neuralbridge.db'))).toBe(true);
  });

  it('valida matriz RF-07: Claude-only, Codex-only e falha graciosa sem agentes disponíveis', async () => {
    const makeProvider = (id: 'claude' | 'codex', available: boolean): IAgentProviderContract => ({
      id,
      getCapabilities: () => ['produce', 'review'],
      isAvailable: async () => available,
      execute: async ({ capability }) => ({ ok: true, output: `${id}:${capability}` }),
    });

    const envelope = {
      requestId: 'req-rf07-1',
      correlationId: 'corr-rf07-1',
      idempotencyKey: 'idem-rf07-1',
      schemaVersion: '1.0.0',
      originApp: 'aethera' as const,
      scopes: ['tasks:delegate' as const],
      timeoutMs: 5000,
    };

    // Apenas Claude
    const claudeOnly = createIsolatedAppStub({
      appId: 'aethera',
      capabilities: ['produce'],
      agents: [makeProvider('claude', true), makeProvider('codex', false)],
    });
    const resClaude = await claudeOnly.submitTask({
      envelope: { ...envelope, idempotencyKey: 'idem-claude' },
      kind: 'video.produce',
      capability: 'produce',
      input: { prompt: 'Teste Claude' },
    });
    expect(resClaude.status).toBe('completed');
    expect(resClaude.executedByAgent).toBe('claude');

    // Apenas Codex
    const codexOnly = createIsolatedAppStub({
      appId: 'aethera',
      capabilities: ['produce'],
      agents: [makeProvider('claude', false), makeProvider('codex', true)],
    });
    const resCodex = await codexOnly.submitTask({
      envelope: { ...envelope, idempotencyKey: 'idem-codex' },
      kind: 'video.produce',
      capability: 'produce',
      input: { prompt: 'Teste Codex' },
    });
    expect(resCodex.status).toBe('completed');
    expect(resCodex.executedByAgent).toBe('codex');

    // Sem nenhum agente disponível: falha explícita sem travar
    const noAgents = createIsolatedAppStub({
      appId: 'aethera',
      capabilities: ['produce'],
      agents: [makeProvider('claude', false), makeProvider('codex', false)],
    });
    const resNone = await noAgents.submitTask({
      envelope: { ...envelope, idempotencyKey: 'idem-none' },
      kind: 'video.produce',
      capability: 'produce',
      input: { prompt: 'Sem agente' },
    });
    expect(resNone.status).toBe('failed');
    expect(resNone.error).toBe('no_capable_agent_available');
  });
});
