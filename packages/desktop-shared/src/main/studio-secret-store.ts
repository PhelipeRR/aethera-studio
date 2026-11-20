import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { CollageSecretCipher } from './collage-secret-store.js';

/**
 * Credentials of the Aethera Studio game sources (IGDB through Twitch, optional RAWG), persisted only as OS-encrypted
 * bytes (safeStorage), written atomically, never logged and never sent to the renderer — only "configured" and a hint.
 */
export class StudioSecretStore<T> {
  constructor(private readonly file: string, private readonly cipher: CollageSecretCipher, private readonly schema: z.ZodType<T>, private readonly label: string) {}

  save(value: T): void {
    const parsed = this.schema.parse(value);
    if (!this.cipher.isEncryptionAvailable()) throw new Error(`unavailable: armazenamento seguro indisponível para ${this.label}.`);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, this.cipher.encryptString(JSON.stringify(parsed)), { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  load(): T | null {
    if (!this.cipher.isEncryptionAvailable()) return null;
    try {
      const parsed = this.schema.safeParse(JSON.parse(this.cipher.decryptString(readFileSync(this.file))));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  clear(): void { rmSync(this.file, { force: true }); }
}

export const igdbCredentialsSchema = z.strictObject({ clientId: z.string().trim().min(1).max(200), clientSecret: z.string().trim().min(1).max(500) });
export const rawgKeySchema = z.strictObject({ apiKey: z.string().trim().min(1).max(500) });

/**
 * Claude Gateway configuration: isolated API endpoint, auth token and model override.
 * Stored encrypted via safeStorage, never exposed to the renderer or logs.
 * The authToken is optional to support gateway proxies that use alternative auth mechanisms.
 */
export const claudeGatewayConfigSchema = z.strictObject({
	enabled: z.boolean(),
	baseUrl: z.string().trim().min(1).max(1000),
	authToken: z.string().trim().min(1).max(2000).optional(),
	model: z.string().trim().min(1).max(200),
});
export type ClaudeGatewayConfig = z.infer<typeof claudeGatewayConfigSchema>;

/** Enough to recognise which Twitch app is configured, never enough to use it. */
export function clientIdHint(clientId: string): string {
  return clientId.length <= 4 ? '••••' : `••••${clientId.slice(-4)}`;
}
