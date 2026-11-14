import { defaultPipePath, type IAgentProviderContract } from '@neuralbridge/integration-contracts';
import { startOrchestratorRuntime } from '../../apps/orchestrator-desktop/src/main/runtime.js';
import { startAetheraRuntime } from '../../apps/aethera-desktop/src/main/runtime.js';
import { startVoidRuntime } from '../../apps/void-desktop/src/main/runtime.js';

const [appId, dataDir, discoveryDir, migrationsFolder] = process.argv.slice(2) as [
  'orchestrator' | 'aethera' | 'void',
  string,
  string,
  string,
];

const singleAgentCodex: IAgentProviderContract[] = [
  {
    id: 'claude',
    getCapabilities: () => ['creative_direction', 'script', 'assistant'],
    isAvailable: async () => false,
    execute: async () => ({ ok: false, output: '' }),
  },
  {
    id: 'codex',
    getCapabilities: () => ['execution', 'remotion_composition', 'assistant'],
    isAvailable: async () => true,
    execute: async ({ prompt, capability }) => ({
      ok: true,
      output: `${appId}:codex:${capability}:${prompt}`,
    }),
  },
];

async function main() {
  const ipcPath = defaultPipePath(appId, `${process.pid}`);
  const common = {
    dataDir,
    migrationsFolder,
    discoveryDir,
    ipcPath,
    requireAuth: true,
    agents: singleAgentCodex,
  };

  const handle =
    appId === 'orchestrator'
      ? await startOrchestratorRuntime(common)
      : appId === 'aethera'
        ? await startAetheraRuntime(common)
        : await startVoidRuntime(common);

  const token = handle.issuePairingToken('orchestrator', [
    'health:read',
    'capabilities:read',
    'tasks:delegate',
    'tasks:read',
    'events:subscribe',
  ]);
  const readOnlyToken = handle.issuePairingToken('void', ['health:read']);

  const sendLine = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);

  sendLine({
    type: 'ready',
    appId,
    pid: process.pid,
    dbPath: handle.dbPath,
    ipcPath,
    token,
    readOnlyToken,
  });

  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', async (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const cmd = JSON.parse(line) as { id: string; action: string; tokenId?: string };
      if (cmd.action === 'revoke' && cmd.tokenId) {
        const ok = handle.revokePairingToken(cmd.tokenId);
        sendLine({ type: 'reply', id: cmd.id, ok });
      } else if (cmd.action === 'shutdown') {
        await handle.close();
        sendLine({ type: 'reply', id: cmd.id, ok: true });
        process.exit(0);
      }
    }
  });
}

void main();
