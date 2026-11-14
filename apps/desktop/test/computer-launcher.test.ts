import { describe, expect, it, vi } from 'vitest';
import { createDesktopApplicationLauncher, sendCtrlV } from '../src/main/computer-launcher.js';

describe('createDesktopApplicationLauncher', () => {
  it('opens only fixed native application schemes', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const launcher = createDesktopApplicationLauncher({ openExternal });
    await launcher.launch('spotify');
    await launcher.launch('teams');
    expect(openExternal.mock.calls).toEqual([['spotify:'], ['msteams:']]);
  });

  it('opens fixed Windows utilities without accepting an executable path', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const launcher = createDesktopApplicationLauncher({ openExternal });

    await launcher.launch('notepad');
    await launcher.launch('calculator');

    expect(openExternal.mock.calls).toEqual([['notepad:'], ['calculator:']]);
  });

  it('refuses a window target that is not a plain handle, before any shell runs', async () => {
    await expect(sendCtrlV({ targetWindow: '1; Remove-Item C:/x' })).rejects.toThrow('blocked');
  });
});
