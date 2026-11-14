import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl, isAllowedPermission, isAllowedSystemAudio, isAppUrl } from '../src/main/security/navigation.js';

const prod = { devServerUrl: undefined, indexFile: 'C:\\app\\out\\renderer\\index.html' };

const appPage = 'file:///C:/app/out/renderer/index.html#/mcp';
describe('isAllowedSystemAudio', () => {
  const app = prod;
  const hud = 'file:///C:/app/out/renderer/index.html?companion=hud&mode=compact';
  const main = 'file:///C:/app/out/renderer/index.html#/settings?companion=hud';

  it('lets only the HUD capture, and only while a meeting asked for it', () => {
    expect(isAllowedSystemAudio('display-capture', hud, app, true)).toBe(true);
    expect(isAllowedSystemAudio('media', hud, app, true)).toBe(true);
    expect(isAllowedSystemAudio('media', hud, app, true, ['video'])).toBe(false);
    expect(isAllowedSystemAudio('media', hud, app, true, ['audio'])).toBe(false);
    expect(isAllowedSystemAudio('media', hud, app, true, ['audio', 'video'])).toBe(false);
    expect(isAllowedSystemAudio('display-capture', hud, app, false)).toBe(false);
    expect(isAllowedSystemAudio('display-capture', main, app, true)).toBe(false);
    expect(isAllowedSystemAudio('display-capture', 'https://evil.example/?companion=hud', app, true)).toBe(false);
    expect(isAllowedSystemAudio('geolocation', hud, app, true)).toBe(false);
  });
});

describe('isAllowedPermission', () => {

  it('allows only writing to the clipboard, and only for the app itself', () => {
    expect(isAllowedPermission('clipboard-sanitized-write', appPage, prod)).toBe(true);
    expect(isAllowedPermission('clipboard-sanitized-write', 'https://evil.example/', prod)).toBe(false);
    expect(isAllowedPermission('clipboard-sanitized-write', undefined, prod)).toBe(false);
    expect(isAllowedPermission('geolocation', appPage, prod)).toBe(true);
    for (const permission of ['clipboard-read', 'media', 'notifications', 'openExternal', 'fileSystem']) {
      expect(isAllowedPermission(permission, appPage, prod)).toBe(false);
    }
  });
});

describe('isAppUrl', () => {
  const dev = { devServerUrl: 'http://localhost:5173', indexFile: 'C:\\app\\out\\renderer\\index.html' };
  const prod = { devServerUrl: undefined, indexFile: 'C:\\Program Files\\NeuralBridge\\resources\\app.asar\\out\\renderer\\index.html' };

  it('accepts the dev server origin only in dev', () => {
    expect(isAppUrl('http://localhost:5173/#/chat', dev)).toBe(true);
    expect(isAppUrl('http://localhost:5173/#/chat', prod)).toBe(false);
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false);
  });

  it('accepts only the packaged index file in production', () => {
    expect(isAppUrl('file:///C:/Program%20Files/NeuralBridge/resources/app.asar/out/renderer/index.html#/memory', prod)).toBe(true);
    expect(isAppUrl('file:///C:/Windows/System32/drivers/etc/hosts', prod)).toBe(false);
  });

  it('rejects remote and malformed urls', () => {
    expect(isAppUrl('https://evil.example/', dev)).toBe(false);
    expect(isAppUrl('not a url', dev)).toBe(false);
  });
});

describe('isAllowedExternalUrl', () => {
  const allow = ['github.com', 'modelcontextprotocol.io'];

  it('allows https urls on allowlisted hosts and their subdomains', () => {
    expect(isAllowedExternalUrl('https://github.com/anthropics', allow)).toBe(true);
    expect(isAllowedExternalUrl('https://docs.github.com/x', allow)).toBe(true);
  });

  it('rejects other schemes, look-alike hosts and credentials in the url', () => {
    expect(isAllowedExternalUrl('http://github.com/', allow)).toBe(false);
    expect(isAllowedExternalUrl('https://github.com.evil.example/', allow)).toBe(false);
    expect(isAllowedExternalUrl('https://evilgithub.com/', allow)).toBe(false);
    expect(isAllowedExternalUrl('https://user:pass@github.com/', allow)).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)', allow)).toBe(false);
    expect(isAllowedExternalUrl('file:///C:/', allow)).toBe(false);
  });
});
