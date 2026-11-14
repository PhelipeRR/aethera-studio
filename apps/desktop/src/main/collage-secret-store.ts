import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CollageSecretCipher { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; }

/** Gemini credentials are persisted only as OS-encrypted bytes and are never exposed to the renderer. */
export class CollageSecretStore {
  constructor(private readonly file: string, private readonly cipher: CollageSecretCipher) {}
  save(apiKey: string): void {
    if (!apiKey.trim() || !this.cipher.isEncryptionAvailable()) throw new Error('unavailable: armazenamento seguro indisponível para a chave Gemini.');
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, this.cipher.encryptString(apiKey.trim()), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  load(): string | null { if (!this.cipher.isEncryptionAvailable()) return null; try { const value = this.cipher.decryptString(readFileSync(this.file)); return value.trim() || null; } catch { return null; } }
  clear(): void { rmSync(this.file, { force: true }); }
}
