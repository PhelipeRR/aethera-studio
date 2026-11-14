import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { buildCsp } from './src/main/security/csp';

// Workspace packages ship TypeScript source, so they must be bundled rather than required at runtime.
const WORKSPACE_PACKAGES = ['@neuralbridge/shared', '@neuralbridge/database', '@neuralbridge/brain', '@neuralbridge/mcp-server', '@neuralbridge/workspace', '@neuralbridge/agents', '@neuralbridge/orchestrator', '@neuralbridge/core'];

export default defineConfig(({ command }) => ({
  main: {
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'history-sync-worker': resolve('src/main/history-sync-worker.ts'),
          // Standalone MCP server: runs without the window (ELECTRON_RUN_AS_NODE=1 or node).
          'mcp-server': resolve('../../packages/mcp-server/src/cli.ts'),
          // Singularity Core (CORE-03): supervised child on loopback, no Electron imports (ELECTRON_RUN_AS_NODE=1 or node).
          core: resolve('src/core-host/main.ts'),
        },
      },
    },
    plugins: [
      {
        name: 'neuralbridge-migrations',
        // The migrator reads SQL files at runtime; ship them next to out/main/index.js.
        writeBundle: () => cpSync(resolve('../../packages/database/migrations'), resolve('out/main/migrations'), { recursive: true }),
      },
    ],
  },
  preload: {
    build: { externalizeDeps: { exclude: WORKSPACE_PACKAGES } },
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'neuralbridge-csp',
        transformIndexHtml: (html: string) => html.replace('%NB_CSP%', buildCsp({ dev: command === 'serve' })),
      },
    ],
  },
}));
