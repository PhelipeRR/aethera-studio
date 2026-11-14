import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AzureDevOpsCredentialCipher { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string; }
type StoredCredential = string | { username: string; password: string };

/** PATs are optional compatibility credentials for on-premises TFS; they never enter the renderer or database. */
export class AzureDevOpsCredentialStore {
  constructor(private readonly file: string, private readonly cipher: AzureDevOpsCredentialCipher) {}
  save(connectionId: string, token: string): void { const value = token.trim(); if (!connectionId || !value || !this.cipher.isEncryptionAvailable()) throw new Error('unavailable: armazenamento seguro indisponível para o token TFS.'); const next = this.loadAll(); next[connectionId] = value; this.writeAll(next); }
  load(connectionId: string): string | null { const value = this.loadAll()[connectionId]; return typeof value === 'string' ? value : null; }
  saveBasic(connectionId: string, username: string, password: string): void { const user = username.trim(); if (!connectionId || !user || !password || !this.cipher.isEncryptionAvailable()) throw new Error('unavailable: armazenamento seguro indisponível para as credenciais TFS.'); this.writeAll({ ...this.loadAll(), [connectionId]: { username: user, password } }); }
  loadBasic(connectionId: string): { username: string; password: string } | null { const value = this.loadAll()[connectionId]; return value && typeof value === 'object' ? value : null; }
  clear(connectionId: string): void { const next = this.loadAll(); const { [connectionId]: _removed, ...remaining } = next; void _removed; if (Object.keys(remaining).length === 0) { rmSync(this.file, { force: true }); return; } this.writeAll(remaining); }
  private writeAll(next: Record<string, StoredCredential>): void { mkdirSync(dirname(this.file), { recursive: true }); const temporary = `${this.file}.tmp`; writeFileSync(temporary, this.cipher.encryptString(JSON.stringify(next)), { mode: 0o600 }); renameSync(temporary, this.file); }
  private loadAll(): Record<string, StoredCredential> { if (!this.cipher.isEncryptionAvailable()) return {}; try { const parsed: unknown = JSON.parse(this.cipher.decryptString(readFileSync(this.file))); if (!parsed || typeof parsed !== 'object') return {}; return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key && ((typeof value === 'string' && value.trim()) || (value && typeof value === 'object' && typeof (value as { username?: unknown }).username === 'string' && typeof (value as { password?: unknown }).password === 'string'))).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])); } catch { return {}; } }
}
