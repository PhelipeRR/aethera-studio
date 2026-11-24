import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@neuralbridge\/shared\/(.+)$/, replacement: resolve('packages/shared/src/$1.ts') },
      { find: '@neuralbridge/shared', replacement: resolve('packages/shared/src/index.ts') },
      { find: '@neuralbridge/agents', replacement: resolve('packages/agents/src/index.ts') },
      { find: '@neuralbridge/workspace', replacement: resolve('packages/workspace/src/index.ts') },
      { find: '@neuralbridge/integration-contracts', replacement: resolve('packages/integration-contracts/src/index.ts') },
      { find: '@neuralbridge/cinema/browser', replacement: resolve('packages/cinema/src/browser.ts') },
      { find: '@neuralbridge/cinema', replacement: resolve('packages/cinema/src/index.ts') },
      { find: '@neuralbridge/creative-studio', replacement: resolve('packages/creative-studio/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'tests/integration/**', 'tests/benchmarks/**'],
    environment: 'node',
    setupFiles: ['tests/vitest.setup.ts'],
  },
});
