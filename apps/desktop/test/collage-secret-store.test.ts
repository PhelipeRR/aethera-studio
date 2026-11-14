import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollageSecretStore } from '../src/main/collage-secret-store.js';

const cipher = (available: boolean) => ({ isEncryptionAvailable: () => available, encryptString: (value: string) => Buffer.from(value).toString('base64').split('').reverse().join('').length ? Buffer.from(Buffer.from(value).toString('base64').split('').reverse().join('')) : Buffer.alloc(0), decryptString: (value: Buffer) => Buffer.from(value.toString().split('').reverse().join(''), 'base64').toString() });

describe('CollageSecretStore', () => {
  it('stores only encrypted bytes and reloads the key', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nb-secret-')), 'gemini.bin');
    const store = new CollageSecretStore(file, cipher(true));
    store.save('secret-key');
    expect(readFileSync(file).toString()).not.toContain('secret-key');
    expect(store.load()).toBe('secret-key');
  });
  it('refuses to save when OS encryption is unavailable', () => { expect(() => new CollageSecretStore('x', cipher(false)).save('key')).toThrow(/armazenamento seguro/i); });
});
