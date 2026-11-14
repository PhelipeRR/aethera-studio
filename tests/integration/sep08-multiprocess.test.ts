import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_SCHEMA_VERSION,
  createSocketIntegrationTransport,
  discoverPeers,
  IntegrationClient,
  type IntegrationEvent,
} from '@neuralbridge/integration-contracts';

const MIGRATIONS_FOLDER = join(process.cwd(), 'packages', 'database', 'migrations');
const WORKER_SCRIPT = join(process.cwd(), 'tests', 'integration', 'sep08-peer-worker.ts');
const TSX_CLI = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface SpawnedPeer {
  child: ChildProcessWithoutNullStreams;
  ready: {
    appId: 'orchestrator' | 'aethera' | 'void';
    pid: number;
    dbPath: string;
    ipcPath: string;
    token: { tokenId: string; secret: string };
    readOnlyToken: { tokenId: string; secret: string };
  };
  sendCommand(cmd: { action: string; tokenId?: string }): Promise<unknown>;
  kill(): void;
}

function spawnPeer(appId: 'orchestrator' | 'aethera' | 'void', dataDir: string, discoveryDir: string): Promise<SpawnedPeer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, '--tsconfig', join(process.cwd(), 'tsconfig.base.json'), WORKER_SCRIPT, appId, dataDir, discoveryDir, MIGRATIONS_FOLDER],
      {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const pending = new Map<string, (val: unknown) => void>();
    let buf = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Timeout waiting for ${appId} worker startup`));
      }
    }, 15_000);

    child.stderr.on('data', (d) => {
      if (!settled) {
        // Keep stderr visible if startup fails
        const text = d.toString();
        if (text.includes('Error')) {
          clearTimeout(timer);
          settled = true;
          child.kill();
          reject(new Error(`${appId} worker stderr: ${text}`));
        }
      }
    });

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { type: string; id?: string } & SpawnedPeer['ready'];
        if (msg.type === 'ready' && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            child,
            ready: msg,
            sendCommand: (cmd) =>
              new Promise((res) => {
                const id = randomUUID();
                pending.set(id, res);
                child.stdin.write(`${JSON.stringify({ id, ...cmd })}\n`);
              }),
            kill: () => child.kill('SIGKILL'),
          });
        } else if (msg.type === 'reply' && msg.id) {
          const fn = pending.get(msg.id);
          if (fn) {
            pending.delete(msg.id);
            fn(msg);
          }
        }
      }
    });
  });
}

describe('SEP-08 Real Multi-Process Ecosystem Integration', () => {
  it('runs Orchestrator, Aethera, and Void as 3 independent OS processes with discovery, auth, SSE events, revocation, offline fallback, and reconnection', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sep08-e2e-'));
    const discoveryDir = join(rootDir, 'discovery');
    const orchDir = join(rootDir, 'orchestrator');
    const aetheraDir = join(rootDir, 'aethera');
    const voidDir = join(rootDir, 'void');

    let orch: SpawnedPeer | null = null;
    let aethera: SpawnedPeer | null = null;
    let aetheraReconnected: SpawnedPeer | null = null;
    let voidApp: SpawnedPeer | null = null;

    try {
      [orch, aethera, voidApp] = await Promise.all([
        spawnPeer('orchestrator', orchDir, discoveryDir),
        spawnPeer('aethera', aetheraDir, discoveryDir),
        spawnPeer('void', voidDir, discoveryDir),
      ]);

      // 1. Distinct OS PIDs and distinct private SQLite DBs
      expect(new Set([orch.ready.pid, aethera.ready.pid, voidApp.ready.pid]).size).toBe(3);
      expect(orch.ready.dbPath).not.toBe(aethera.ready.dbPath);
      expect(aethera.ready.dbPath).not.toBe(voidApp.ready.dbPath);

      // 2. Real discovery across all 3 live OS processes
      const peers = discoverPeers(discoveryDir);
      expect(peers.map((p) => p.appId).sort()).toEqual(['aethera', 'orchestrator', 'void']);

      // 3. Auth & scope enforcement over real Named Pipe / Unix Socket
      const unauthTransport = createSocketIntegrationTransport({ socketPath: aethera.ready.ipcPath });
      await expect(unauthTransport.health()).rejects.toThrow(/http_401/);

      const readOnlyTransport = createSocketIntegrationTransport({
        socketPath: aethera.ready.ipcPath,
        token: aethera.ready.readOnlyToken.secret,
      });
      const health = await readOnlyTransport.health();
      expect(health.appId).toBe('aethera');
      await expect(
        readOnlyTransport.submitTask({
          envelope: {
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
            originApp: 'void',
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            scopes: ['tasks:delegate'],
            timeoutMs: 30_000,
          },
          kind: 'video.produce',
          capability: 'remotion_composition',
          input: { prompt: 'Teste escopo' },
        }),
      ).rejects.toThrow(/http_403:forbidden_scope/);

      // 4. Real SSE event subscription + delegated task + RF-07 single-agent fallback
      const authorizedTransport = createSocketIntegrationTransport({
        socketPath: aethera.ready.ipcPath,
        token: aethera.ready.token.secret,
      });
      const receivedEvents: IntegrationEvent[] = [];
      const sseSub = authorizedTransport.subscribeEvents((ev) => receivedEvents.push(ev));

      // Small delay for SSE stream subscription to attach on server
      await new Promise((r) => setTimeout(r, 100));

      const taskId = randomUUID();
      const taskResult = await authorizedTransport.submitTask({
        envelope: {
          requestId: taskId,
          idempotencyKey: randomUUID(),
          correlationId: randomUUID(),
          originApp: 'orchestrator',
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          scopes: ['tasks:delegate'],
          timeoutMs: 30_000,
        },
        kind: 'video.produce',
        capability: 'remotion_composition',
        input: { prompt: 'Top 5 jogos indie' },
      });

      expect(taskResult.status).toBe('completed');
      expect(taskResult.executedByAgent).toBe('codex'); // RF-07 single-agent fallback!
      const queried = await authorizedTransport.getTaskStatus(taskId);
      expect(queried.taskId).toBe(taskId);
      expect(queried.status).toBe('completed');

      await new Promise((r) => setTimeout(r, 100));
      sseSub.close();
      expect(receivedEvents.some((e) => e.type === 'task.completed')).toBe(true);

      // 5. Token revocation
      await aethera.sendCommand({ action: 'revoke', tokenId: aethera.ready.token.tokenId });
      await expect(authorizedTransport.health()).rejects.toThrow(/http_401:revoked/);

      // 6. Crash / offline tolerance: kill Aethera process; Orchestrator & Void keep operating
      aethera.kill();
      await new Promise((r) => setTimeout(r, 150));

      const offlineClient = new IntegrationClient(authorizedTransport);
      const offlineCheck = await offlineClient.checkPeer();
      expect(offlineCheck.connected).toBe(false);
      const voidHealthViaPipe = await createSocketIntegrationTransport({
        socketPath: voidApp.ready.ipcPath,
        token: voidApp.ready.token.secret,
      }).health();
      expect(voidHealthViaPipe.appId).toBe('void');

      // 7. Reconnection when Aethera restarts
      aetheraReconnected = await spawnPeer('aethera', aetheraDir, discoveryDir);
      expect(aetheraReconnected.ready.pid).not.toBe(aethera.ready.pid);
      const reconnectedTransport = createSocketIntegrationTransport({
        socketPath: aetheraReconnected.ready.ipcPath,
        token: aetheraReconnected.ready.token.secret,
      });
      const reconnectedHealth = await reconnectedTransport.health();
      expect(reconnectedHealth.appId).toBe('aethera');
    } finally {
      for (const peer of [orch, aethera, aetheraReconnected, voidApp]) {
        try {
          peer?.kill();
        } catch {
          // Ignore already exited
        }
      }
      try {
        rmSync(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Ignore Windows SQLite WAL lock during temp cleanup
      }
    }
  }, 30_000);
});
