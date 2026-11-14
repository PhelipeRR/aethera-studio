import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { SecretCipher } from '../spotify/token-store.js';

const tokensSchema = z.strictObject({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number(), scopes: z.array(z.string().min(1)) });
const payloadSchema = z.record(z.string(), tokensSchema);
export type IntegrationTokens = z.infer<typeof tokensSchema>;

/** Account-scoped OAuth tokens. The file is ciphertext-only and is unusable without the OS key. */
export class IntegrationTokenStore {
  constructor(private readonly file: string, private readonly cipher: SecretCipher) {}
  get persistent(): boolean { return this.cipher.isEncryptionAvailable(); }

  load(accountId: string): IntegrationTokens | null {
    if (!this.persistent) return null;
    try { const parsed = payloadSchema.parse(JSON.parse(this.cipher.decryptString(readFileSync(this.file))) as unknown); return parsed[accountId] ?? null; } catch { return null; }
  }

  save(accountId: string, tokens: IntegrationTokens): void {
    if (!this.persistent) return;
    const existing = this.readAll(); existing[accountId] = tokens;
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, this.cipher.encryptString(JSON.stringify(existing)), { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  clear(accountId?: string): void {
    if (!accountId) { rmSync(this.file, { force: true }); return; }
    const existing = this.readAll(); const remaining = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== accountId));
    if (Object.keys(remaining).length === 0) { rmSync(this.file, { force: true }); return; }
    writeFileSync(this.file, this.cipher.encryptString(JSON.stringify(remaining)), { mode: 0o600 });
  }

  rawFile(): string { try { return readFileSync(this.file).toString('utf8'); } catch { return ''; } }
  private readAll(): Record<string, IntegrationTokens> { if (!this.persistent) return {}; try { return payloadSchema.parse(JSON.parse(this.cipher.decryptString(readFileSync(this.file))) as unknown); } catch { return {}; } }
}
