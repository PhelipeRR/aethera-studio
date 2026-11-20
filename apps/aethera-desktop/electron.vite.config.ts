import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const WORKSPACE_PACKAGES = [
  '@neuralbridge/shared',
  '@neuralbridge/integration-contracts',
  '@neuralbridge/cinema',
  '@neuralbridge/creative-studio',
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
        '@neuralbridge/cinema/browser': resolve('../../packages/cinema/src/browser.ts'),
        '@neuralbridge/cinema': resolve('../../packages/cinema/src/index.ts'),
        '@neuralbridge/creative-studio': resolve('../../packages/creative-studio/src/index.ts'),
      },
    },
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      rollupOptions: {
        external: ['playwright', 'playwright-core', 'chromium-bidi'],
        input: {
          index: resolve('src/main/index.ts'),
          'mcp-server': resolve('../../packages/mcp-server/src/cli.ts'),
          core: resolve('../../packages/desktop-shared/src/core-host/main.ts'),
        },
      },
    },
    plugins: [
      {
        name: 'aethera-migrations',
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
        '@neuralbridge/cinema/browser': resolve('../../packages/cinema/src/browser.ts'),
        // The renderer must never pull the Node/FFmpeg barrel into the browser bundle.
        '@neuralbridge/cinema': resolve('../../packages/cinema/src/browser.ts'),
        '@neuralbridge/creative-studio': resolve('../../packages/creative-studio/src/index.ts'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
