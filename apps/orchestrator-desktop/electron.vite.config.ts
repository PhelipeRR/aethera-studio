import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const WORKSPACE_PACKAGES = [
  '@neuralbridge/shared',
  '@neuralbridge/integration-contracts',
  '@neuralbridge/database',
  '@neuralbridge/brain',
  '@neuralbridge/mcp-server',
  '@neuralbridge/workspace',
  '@neuralbridge/agents',
  '@neuralbridge/orchestrator',
  '@neuralbridge/core',
];

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@neuralbridge/integration-contracts': resolve('../../packages/integration-contracts/src/index.ts'),
      },
    },
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'history-sync-worker': resolve('../../packages/desktop-shared/src/main/history-sync-worker.ts'),
          'mcp-server': resolve('../../packages/mcp-server/src/cli.ts'),
          core: resolve('../../packages/desktop-shared/src/core-host/main.ts'),
        },
      },
    },
    plugins: [
      {
        name: 'orchestrator-migrations',
        writeBundle: () => cpSync(resolve('../../packages/database/migrations'), resolve('out/main/migrations'), { recursive: true }),
      },
    ],
  },
  preload: {
    build: { externalizeDeps: { exclude: WORKSPACE_PACKAGES } },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('../../packages/desktop-shared/src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
