import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcChannel } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { registerThemeIpcHandlers } from '../src/main/handlers/theme.js';

type Listener = (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>;

class FakeIpc {
  readonly handlers = new Map<string, Listener>();

  handle(channel: string, listener: Listener): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, payload: unknown, url = 'file:///app/index.html'): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`missing_handler:${channel}`);
    return handler({ senderFrame: { url } }, payload);
  }
}

function setup() {
  const ipc = new FakeIpc();
  const preferencesFile = join(mkdtempSync(join(tmpdir(), 'nb-theme-ipc-')), 'preferences.json');
  const nativeThemes: string[] = [];
  registerThemeIpcHandlers(ipc, { preferencesFile, setNativeTheme: (source) => nativeThemes.push(source) }, (url) => url === 'file:///app/index.html');
  return { ipc, preferencesFile, nativeThemes };
}

describe('theme IPC handler group', () => {
  it('keeps theme reads, writes and native theme application compatible', async () => {
    const { ipc, preferencesFile, nativeThemes } = setup();

    await expect(ipc.invoke(IpcChannel.themeGet, undefined)).resolves.toBe('dark');
    await expect(ipc.invoke(IpcChannel.themeSet, { source: 'light' })).resolves.toBe('light');
    await expect(ipc.invoke(IpcChannel.themeGet, undefined)).resolves.toBe('light');
    expect(nativeThemes).toEqual(['light']);
    expect(JSON.parse(readFileSync(preferencesFile, 'utf8'))).toMatchObject({ theme: 'light' });
  });

  it('rejects invalid payloads and untrusted senders before dependencies run', async () => {
    const { ipc, nativeThemes } = setup();

    await expect(ipc.invoke(IpcChannel.themeSet, { source: 'neon' })).rejects.toThrow('Invalid payload');
    await expect(ipc.invoke(IpcChannel.themeGet, {}, 'https://evil.example')).rejects.toThrow('Untrusted sender');
    expect(nativeThemes).toEqual([]);
  });
});
