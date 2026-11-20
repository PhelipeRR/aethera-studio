import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'apps/aethera-desktop/**',
      'apps/desktop/**',
      'apps/orchestrator-desktop/**',
      'apps/void-desktop/**',
      'apps/mobile/**',
      'apps/aethera-web/dist/**',
      'apps/aethera-web/data/**',
      'apps/aethera-remote-host/data/**',
      'packages/**',
      'docs/**',
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      'spikes/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/aethera-web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.es2022 } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: [
      'apps/aethera-web/server/**/*.{ts,tsx}',
      'apps/aethera-web/server.ts',
      'apps/aethera-web/test/**/*.{ts,tsx}',
      'apps/aethera-remote-host/src/**/*.{ts,tsx}',
      'apps/aethera-remote-host/test/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.es2022 } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
