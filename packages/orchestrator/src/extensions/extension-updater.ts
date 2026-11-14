import type { ExtensionInstaller } from './extension-installer.js';
import type { ExtensionPackage } from '@neuralbridge/shared';
export function createExtensionUpdater(installer: ExtensionInstaller) { return { update: (pkg: ExtensionPackage) => installer.update(pkg), rollback: (id: string) => installer.rollback(id) }; }
