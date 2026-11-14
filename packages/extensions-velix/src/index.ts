import type { ExtensionManifest } from '@neuralbridge/shared';

export const velixExtension: Pick<ExtensionManifest, 'id' | 'name' | 'version' | 'capabilities' | 'permissions' | 'entrypoints'> = {
  id: 'velix', name: 'Aethera', version: '1.0.0', capabilities: ['navigation', 'artifacts', 'settings', 'diagnostics'], permissions: ['navigation', 'artifacts', 'settings', 'diagnostics'], entrypoints: { main: 'src/index.ts' },
};
