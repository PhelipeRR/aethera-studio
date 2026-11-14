import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['apps/desktop/motion-bundle/**', '**/node_modules/**', '**/out/**', '**/dist/**', 'spikes/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: 'Never spawn processes with shell: true (see docs/PLAN.md, security constraints).',
        },
      ],
    },
  },
  {
    // CORE-03 (ADR CORE-01 §2.1 rule 1): the Core runs without Electron, embedded today and standalone in CORE-08.
    files: ['packages/core/**/*.ts', 'apps/desktop/src/core-host/**/*.ts', 'apps/desktop/src/main/task-composition.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: 'The Singularity Core must not depend on Electron.' }] }],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['electron', 'node:*'], message: 'The renderer is sandboxed: use window.neuralbridge.' }] },
      ],
    },
  },
);
