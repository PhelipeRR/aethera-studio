import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import argon2 from 'argon2';

export interface CredentialVaultOptions {
  /** Explicit 32-byte key (hex or base64) or passphrase; overrides env var (useful for tests). */
  rawKey?: string;
  /** Directory outside the SQLite database where a dev-only local key file may be stored if env is unset. */
  devSecretDir?: string;
  isProduction?: boolean;
}

const KEY_DERIVATION_SALT = Buffer.from('aethera-web-credential-vault-v1', 'utf8');

function decodeKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const b64 = Buffer.from(trimmed, 'base64');
    if (b64.length === 32 && b64.toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')) {
      return b64;
    }
  } catch {
    // Fallback to scrypt derivation below
  }
  return crypto.scryptSync(trimmed, KEY_DERIVATION_SALT, 32);
}

export class CredentialVault {
  private readonly key: Buffer;
  public readonly keySource: 'env' | 'explicit' | 'dev_secret_file';

  constructor(opts: CredentialVaultOptions = {}) {
    const isProd = opts.isProduction ?? process.env.NODE_ENV === 'production';

    if (opts.rawKey && opts.rawKey.trim().length > 0) {
      this.key = decodeKeyMaterial(opts.rawKey);
      this.keySource = 'explicit';
      return;
    }

    const envKey = process.env.AETHERA_CREDENTIAL_KEY?.trim();
    if (envKey) {
      this.key = decodeKeyMaterial(envKey);
      this.keySource = 'env';
      return;
    }

    if (isProd) {
      // Never store encryption keys in SQLite or hardcode a static fallback in production.
      const secretDir = opts.devSecretDir ?? path.resolve(process.cwd(), '.aethera-secrets');
      const keyFile = path.join(secretDir, 'credential.key');
      if (fs.existsSync(keyFile)) {
        this.key = decodeKeyMaterial(fs.readFileSync(keyFile, 'utf8'));
        this.keySource = 'dev_secret_file';
        return;
      }
      throw new Error(
        'AETHERA_CREDENTIAL_KEY não configurada em produção. Defina uma chave de 32 bytes (64 hex) fora do banco de dados.',
      );
    }

    // Dev / Preview fallback: store external key file strictly outside SQLite and gitignored (.aethera-secrets/)
    const secretDir = opts.devSecretDir ?? path.resolve(process.cwd(), '.aethera-secrets');
    const keyFile = path.join(secretDir, 'credential.key');
    fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
    if (fs.existsSync(keyFile)) {
      this.key = decodeKeyMaterial(fs.readFileSync(keyFile, 'utf8'));
    } else {
      const generatedHex = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(keyFile, `${generatedHex}\n`, { encoding: 'utf8', mode: 0o600 });
      this.key = Buffer.from(generatedHex, 'hex');
    }
    this.keySource = 'dev_secret_file';
  }

  /**
   * Authenticated AES-256-GCM encryption bound to an AAD context (e.g. `userId:hostId`).
   */
  public encrypt(plaintext: string, aad: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  public decrypt(encoded: string, aad: string): string {
    const parts = encoded.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Formato de credencial criptografada inválido.');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }
}

export async function hashPasswordArgon2id(password: string): Promise<string> {
  const isTest = process.env.NODE_ENV === 'test';
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: isTest ? 16384 : 65536, // 64 MiB in runtime, 16 MiB in test
    timeCost: isTest ? 2 : 3,
    parallelism: 1,
  });
}

export async function verifyPasswordArgon2id(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function fingerprintSecret(secret: string): string {
  const digest = sha256Hex(secret);
  const tail = secret.length >= 4 ? secret.slice(-4) : '****';
  return `sha256:${digest.slice(0, 10)}…${tail}`;
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|ticket|sig|password|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(password|token|secret)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[REDACTED]');
}
