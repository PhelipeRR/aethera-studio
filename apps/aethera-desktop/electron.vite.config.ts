import { cpSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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

/**
 * Plugin que resolve subpaths @neuralbridge/* usando os exports do package.json.
 * O Rollup do Vite 6 não resolve exports automaticamente quando há alias de diretório.
 */
function neuralbridgeExportsResolver(): import('vite').Plugin {
  const pkgRoot = resolve(__dirname, '../../packages');
  const cache = new Map<string, Record<string, string> | null>();

  function getExports(pkgName: string): Record<string, string> | null {
    if (cache.has(pkgName)) return cache.get(pkgName)!;
    try {
      const shortName = pkgName.replace('@neuralbridge/', '');
      const pkgJsonPath = resolve(pkgRoot, shortName, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const exports = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports as Record<string, string> : null;
      cache.set(pkgName, exports);
      return exports;
    } catch {
      cache.set(pkgName, null);
      return null;
    }
  }

  return {
    name: 'neuralbridge-exports-resolver',
    enforce: 'pre',
    resolveId(id) {
      if (!id.startsWith('@neuralbridge/')) return null;
      // Extrai nome do pacote e subpath: @neuralbridge/shared/channels → pkg=@neuralbridge/shared, sub=./channels
      const parts = id.split('/');
      const pkgName = parts.slice(0, 2).join('/');
      if (!WORKSPACE_PACKAGES.includes(pkgName)) return null;
      const subpath = parts.length > 2 ? './' + parts.slice(2).join('/') : '.';
      const exports = getExports(pkgName);
      if (!exports) return null;
      const target = exports[subpath];
      if (!target) return null;
      const shortName = pkgName.replace('@neuralbridge/', '');
      return resolve(pkgRoot, shortName, target);
    },
  };
}

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@neuralbridge/shared': resolve('../../packages/shared/src'),
        '@neuralbridge/integration-contracts': resolve('../../packages/integration-contracts/src'),
        '@neuralbridge/cinema/browser': resolve('../../packages/cinema/src/browser.ts'),
        '@neuralbridge/cinema': resolve('../../packages/cinema/src'),
        '@neuralbridge/creative-studio': resolve('../../packages/creative-studio/src'),
        '@neuralbridge/database': resolve('../../packages/database/src'),
        '@neuralbridge/brain': resolve('../../packages/brain/src'),
        '@neuralbridge/mcp-server': resolve('../../packages/mcp-server/src'),
        '@neuralbridge/workspace': resolve('../../packages/workspace/src'),
        '@neuralbridge/agents': resolve('../../packages/agents/src'),
        '@neuralbridge/orchestrator': resolve('../../packages/orchestrator/src'),
        '@neuralbridge/core': resolve('../../packages/core/src'),
      },
    },
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      rollupOptions: {
        external: ['playwright', 'playwright-core', 'chromium-bidi', 'tesseract.js'],
        input: {
          index: resolve('src/main/index.ts'),
          'mcp-server': resolve('../../packages/mcp-server/src/cli.ts'),
          core: resolve('../../packages/desktop-shared/src/core-host/main.ts'),
          'history-sync-worker': resolve('../../packages/desktop-shared/src/main/history-sync-worker.ts'),
        },
      },
    },
    plugins: [
      neuralbridgeExportsResolver(),
      {
        name: 'aethera-migrations',
        writeBundle: () => cpSync(resolve('../../packages/database/migrations'), resolve('out/main/migrations'), { recursive: true }),
      },
    ],
  },
  preload: {
    build: { externalizeDeps: { exclude: WORKSPACE_PACKAGES } },
    plugins: [neuralbridgeExportsResolver()],
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
    plugins: [neuralbridgeExportsResolver(), react(), tailwindcss()],
  },
});
