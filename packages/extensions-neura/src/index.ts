import type { ExtensionManifest } from '@neuralbridge/shared';

export const neuraExtension: Pick<ExtensionManifest, 'id' | 'name' | 'version' | 'capabilities' | 'permissions' | 'entrypoints'> = {
  id: 'neura', name: 'Neura', version: '1.0.0', capabilities: ['navigation', 'commands', 'diagnostics'], permissions: ['tasks.read', 'tasks.write', 'navigation', 'diagnostics'], entrypoints: { main: 'src/index.ts' },
};
