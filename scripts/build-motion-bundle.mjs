// Bundles the allow-listed Remotion templates ahead of time: the app never compiles code at run time.
import { resolve } from 'node:path';
import { bundle } from '@remotion/bundler';

const root = resolve(import.meta.dirname, '..');
const shared = resolve(root, 'packages/shared/src/motion.ts');
const aetheraTimelineComposition = resolve(root, 'packages/shared/src/aethera-timeline-composition.ts');
const outDir = resolve(root, 'apps/desktop/motion-bundle');
await bundle({
  entryPoint: resolve(root, 'apps/desktop/motion/index.tsx'),
  outDir,
  // extensionAlias: shared sources import siblings as './x.js' (ESM TypeScript); webpack must look for './x.ts'.
  webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, extensionAlias: { ...config.resolve?.extensionAlias, '.js': ['.ts', '.tsx', '.js'] }, alias: { ...config.resolve?.alias, '@neuralbridge/shared/motion': shared, '@neuralbridge/shared/aethera-timeline-composition': aetheraTimelineComposition } } }),
});
console.log(`motion bundle: ${outDir}`);
