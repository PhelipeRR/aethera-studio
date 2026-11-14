import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@neuralbridge/integration-contracts': resolve('packages/integration-contracts/src/index.ts'),
      '@neuralbridge/cinema': resolve('packages/cinema/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'tests/integration/**', 'tests/benchmarks/**'],
    environment: 'node',
    setupFiles: ['tests/vitest.setup.ts'],
  },
});
