import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BrainService, GatedProvider, HybridSearch, IndexScheduler, LocalEmbeddingProvider, RagEngine, readSemanticSettings } from '@neuralbridge/brain';
import { openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { resolveDataDir } from '@neuralbridge/shared';
import { resolveScope } from './scope-resolution.js';
import { createMcpServer } from './server.js';

// Standalone stdio entry, bundled to out/main/mcp-server.js and run with ELECTRON_RUN_AS_NODE=1
// (or plain node). stdout carries the MCP protocol only: every log line goes to stderr.

const log = (message: string): void => {
  process.stderr.write(`[neuralbridge-mcp] ${message}\n`);
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      cwd: { type: 'string' },
      'no-global': { type: 'boolean', default: false },
      migrations: { type: 'string' },
    },
    strict: true,
  });

  const file = join(resolveDataDir(), 'db', 'brain.db');
  const handle: DatabaseHandle = openDatabase(file, { migrationsFolder: values.migrations ?? join(__dirname, 'migrations') });
  const { scope, matchedBy } = resolveScope(
    { projectArg: values.project, cwd: values.cwd ?? process.cwd(), includeGlobal: !values['no-global'] },
    handle.db.select({ id: projects.id, rootPath: projects.rootPath }).from(projects).all(),
  );
  log(`database ${file}; scope ${scope.kind === 'project' ? `project ${scope.projectId} (${matchedBy})` : scope.kind}`);

  // Semantic search only with a model the user already downloaded in the app: this process never downloads.
  const dataDir = resolveDataDir();
  const provider = new GatedProvider(
    new LocalEmbeddingProvider({ cacheDir: join(dataDir, 'models'), allowDownload: false }),
    () => readSemanticSettings(handle).enabled,
  );
  const indexing = new IndexScheduler(handle, provider, log);
  const brain = new BrainService(handle);
  const rag = new RagEngine(handle);
  const server = createMcpServer({ handle, brain, search: new HybridSearch(brain, provider, {}, rag), rag, scope, onStored: () => indexing.schedule() });
  let closed = false;
  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    void server.close().finally(() => {
      handle.close();
      process.exit(0);
    });
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  log(`failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
