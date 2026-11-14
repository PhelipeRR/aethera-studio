import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  // Live readings (CPU, memory, disk meters) differ on every run; screenshots hide them, never the layout.
  expect: { toHaveScreenshot: { stylePath: './tests/e2e/screenshot.css' } },
});
