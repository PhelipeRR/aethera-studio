import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientIdHint, igdbCredentialsSchema, StudioSecretStore } from '../src/main/studio-secret-store.js';

/** A reversible test cipher standing in for safeStorage; the real app uses the OS keychain. */
const cipher = (available = true) => ({ isEncryptionAvailable: () => available, encryptString: (value: string) => Buffer.from(`enc:${Buffer.from(value).toString('base64')}`), decryptString: (value: Buffer) => Buffer.from(value.toString().slice(4), 'base64').toString() });
const synthetic = { clientId: 'synthetic-client-id-1234', clientSecret: 'synthetic-secret' };

describe('StudioSecretStore', () => {
  it('stores IGDB credentials encrypted and reads them back', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'studio-secret-')), 'igdb.bin');
    const store = new StudioSecretStore(file, cipher(), igdbCredentialsSchema, 'as credenciais do IGDB');
    store.save(synthetic);
    expect(readFileSync(file, 'utf8')).not.toContain('synthetic-secret');
    expect(store.load()).toEqual(synthetic);
    store.clear();
    expect(existsSync(file)).toBe(false);
    expect(store.load()).toBeNull();
  });

  it('refuses to store when the OS cannot encrypt, and reads nothing back', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'studio-secret-')), 'igdb.bin');
    expect(() => new StudioSecretStore(file, cipher(false), igdbCredentialsSchema, 'as credenciais do IGDB').save(synthetic)).toThrow(/seguro/);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects empty values and shows only the last characters of the client id', () => {
    const store = new StudioSecretStore(join(mkdtempSync(join(tmpdir(), 'studio-secret-')), 'igdb.bin'), cipher(), igdbCredentialsSchema, 'as credenciais do IGDB');
    expect(() => store.save({ clientId: ' ', clientSecret: 'x' })).toThrow();
    expect(clientIdHint(synthetic.clientId)).toBe('••••1234');
  });
});
