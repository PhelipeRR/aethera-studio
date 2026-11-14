import { describe, expect, it, vi } from 'vitest';
import { createDesktopLocationProvider } from '../src/main/location-service.js';

describe('createDesktopLocationProvider', () => {
  it('does not query the renderer without explicit consent', async () => {
    const executeJavaScript = vi.fn();
    const provider = createDesktopLocationProvider({ consent: () => false, window: () => ({ isDestroyed: () => false, webContents: { executeJavaScript } }) });
    await expect(provider()).resolves.toBeNull();
    expect(executeJavaScript).not.toHaveBeenCalled();
  });

  it('returns validated coordinates from the app renderer', async () => {
    const provider = createDesktopLocationProvider({ consent: () => true, window: () => ({ isDestroyed: () => false, webContents: { executeJavaScript: async () => ({ latitude: -23.5, longitude: -46.6 }) } }) });
    await expect(provider()).resolves.toEqual({ label: 'sua localização', latitude: -23.5, longitude: -46.6 });
  });

  it('ignores malformed renderer results', async () => {
    const provider = createDesktopLocationProvider({ consent: () => true, window: () => ({ isDestroyed: () => false, webContents: { executeJavaScript: async () => ({ latitude: 500, longitude: -46.6 }) } }) });
    await expect(provider()).resolves.toBeNull();
  });

  it('geocodes an explicit fallback city when the renderer has no location', async () => {
    const provider = createDesktopLocationProvider({ consent: () => true, fallbackPlace: () => 'São Paulo', window: () => undefined, fetcher: async () => ({ ok: true, json: async () => ({ results: [{ name: 'São Paulo', latitude: -23.5, longitude: -46.6 }] }) }) });
    await expect(provider()).resolves.toEqual({ label: 'São Paulo', latitude: -23.5, longitude: -46.6 });
  });
});
