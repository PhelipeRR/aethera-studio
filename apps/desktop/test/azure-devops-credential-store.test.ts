import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AzureDevOpsCredentialStore } from '../src/main/azure-devops-credential-store.js';

const cipher = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value, 'utf8'), decryptString: (value: Buffer) => value.toString('utf8') };

describe('AzureDevOpsCredentialStore', () => {
  it('keeps credentials per connection and removes them without exposing the value', () => {
    const store = new AzureDevOpsCredentialStore(join(mkdtempSync(join(tmpdir(), 'nb-tfs-')), 'credentials.bin'), cipher);
    store.save('connection-a', 'pat-a');
    store.save('connection-b', 'pat-b');
    expect(store.load('connection-a')).toBe('pat-a');
    expect(store.load('connection-b')).toBe('pat-b');
    store.clear('connection-a');
    expect(store.load('connection-a')).toBeNull();
    expect(store.load('connection-b')).toBe('pat-b');
  });
});
