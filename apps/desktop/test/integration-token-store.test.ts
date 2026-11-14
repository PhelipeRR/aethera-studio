import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntegrationTokenStore, type IntegrationTokens } from '../src/main/security/integration-token-store.js';

const cipher = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(Buffer.from(value).toString('base64')), decryptString: (value: Buffer) => Buffer.from(value.toString(), 'base64').toString() };

describe('IntegrationTokenStore', () => {
  it('isolates accounts and never persists plaintext', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'integration-tokens-')), 'tokens.bin');
    const store = new IntegrationTokenStore(file, cipher);
    const tokens: IntegrationTokens = { accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: 1_800_000_000_000, scopes: ['gmail.readonly'] };
    store.save('acct-1', tokens);
    expect(store.load('acct-1')).toEqual(tokens);
    expect(store.load('acct-2')).toBeNull();
    expect(store.rawFile()).not.toContain('access-secret');
  });

  it('does not write when OS encryption is unavailable', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'integration-tokens-')), 'tokens.bin');
    const store = new IntegrationTokenStore(file, { ...cipher, isEncryptionAvailable: () => false });
    store.save('acct-1', { accessToken: 'x', refreshToken: 'y', expiresAt: 1, scopes: [] });
    expect(store.load('acct-1')).toBeNull();
  });
});
