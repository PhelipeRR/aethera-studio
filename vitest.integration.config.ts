import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Process-level tests against the built app (run `npm run build` first; `npm run test:integration` does).
export default defineConfig({
  resolve: {
    alias: {
      '@neuralbridge/integration-contracts': resolve(__dirname, 'packages/integration-contracts/src/index.ts'),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts', 'tests/benchmarks/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/vitest.setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
