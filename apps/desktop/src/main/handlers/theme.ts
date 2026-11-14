import { IpcChannel, type ThemeSource } from '@neuralbridge/shared';
import { readPreferences, writePreferences } from '../preferences.js';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export interface ThemeIpcDependencies {
  preferencesFile: string;
  setNativeTheme: (source: ThemeSource) => void;
}

export function registerThemeIpcHandlers(
  ipc: IpcMainLike,
  dependencies: ThemeIpcDependencies,
  isTrustedSender: (url: string) => boolean,
): void {
  registerIpcHandler(ipc, IpcChannel.themeGet, async () => readPreferences(dependencies.preferencesFile).theme, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.themeSet, async ({ source }) => {
    const current = readPreferences(dependencies.preferencesFile);
    writePreferences(dependencies.preferencesFile, { ...current, theme: source });
    dependencies.setNativeTheme(source);
    return source;
  }, isTrustedSender);
}
