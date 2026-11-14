import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const tokensSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number(), scopes: z.array(z.string()) });
export type SpotifyTokens = z.infer<typeof tokensSchema>;

/** The part of Electron's safeStorage used here, so the store can be tested without Electron. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Tokens reach the disk only encrypted by the OS. Without that they stay in memory, and never in plain text. */
export class SpotifyTokenStore {
  constructor(private readonly file: string, private readonly cipher: SecretCipher) {}

  get persistent(): boolean { return this.cipher.isEncryptionAvailable(); }

  load(): SpotifyTokens | null {
    if (!this.persistent) return null;
    try {
      return tokensSchema.parse(JSON.parse(this.cipher.decryptString(readFileSync(this.file))) as unknown);
    } catch {
      return null;
    }
  }

  save(tokens: SpotifyTokens): void {
    if (!this.persistent) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, this.cipher.encryptString(JSON.stringify(tokens)), { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  clear(): void { rmSync(this.file, { force: true }); }
}
