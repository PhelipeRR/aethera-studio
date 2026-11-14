import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OAuthSecretStore } from '../src/main/oauth/secret-store.js';

const cipher = (available: boolean) => ({ isEncryptionAvailable: () => available, encryptString: (value: string) => Buffer.from(`enc:${Buffer.from(value).toString('base64')}`), decryptString: (value: Buffer) => Buffer.from(value.toString().slice(4), 'base64').toString() });
describe('OAuthSecretStore', () => {
  it('persists only encrypted payloads', () => { const file = join(mkdtempSync(join(tmpdir(), 'nb-oauth-')), 'oauth.bin'); const store = new OAuthSecretStore(file, cipher(true)); store.save({ client: { client_secret: 'secret' }, tokens: { access_token: 'token' } }); expect(readFileSync(file, 'utf8')).not.toContain('secret'); expect(store.load()).toEqual({ client: { client_secret: 'secret' }, tokens: { access_token: 'token' } }); });
  it('does not persist when OS encryption is unavailable', () => { const file = join(mkdtempSync(join(tmpdir(), 'nb-oauth-')), 'oauth.bin'); const store = new OAuthSecretStore(file, cipher(false)); store.save({ client: {}, tokens: null }); expect(store.load()).toBeNull(); });
});
