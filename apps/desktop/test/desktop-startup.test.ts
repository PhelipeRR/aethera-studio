import { describe, expect, it } from 'vitest';
import { AUTOSTART_ARG, isAutostartLaunch, loginItemSettings } from '../src/main/desktop-startup.js';

describe('desktop startup', () => {
  it('recognizes the hidden Windows login launch', () => {
    expect(isAutostartLaunch(['NeuralBridge.exe', AUTOSTART_ARG])).toBe(true);
    expect(isAutostartLaunch(['NeuralBridge.exe'])).toBe(false);
  });

  it('registers only packaged Windows builds for login startup', () => {
    expect(loginItemSettings('win32', true)).toEqual({ openAtLogin: true, args: [AUTOSTART_ARG] });
    expect(loginItemSettings('win32', false)).toBeNull();
    expect(loginItemSettings('darwin', true)).toBeNull();
  });
});
