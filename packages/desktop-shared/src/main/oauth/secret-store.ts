import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { SecretCipher } from '../spotify/token-store.js';

const payloadSchema = z.object({ client: z.unknown(), tokens: z.unknown().nullable() }).strict();
export class OAuthSecretStore {
  constructor(private readonly file: string, private readonly cipher: SecretCipher) {}
  get persistent(): boolean { return this.cipher.isEncryptionAvailable(); }
  load(): { client: unknown; tokens: unknown | null } | null { if (!this.persistent) return null; try { return payloadSchema.parse(JSON.parse(this.cipher.decryptString(readFileSync(this.file))) as unknown); } catch { return null; } }
  save(value: { client: unknown; tokens: unknown | null }): void { if (!this.persistent) return; mkdirSync(dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`; writeFileSync(temporary, this.cipher.encryptString(JSON.stringify(payloadSchema.parse(value))), { mode: 0o600 }); renameSync(temporary, this.file); }
  clear(): void { rmSync(this.file, { force: true }); }
}
