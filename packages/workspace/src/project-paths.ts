import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { win32 } from 'node:path';

// Windows-only product: paths compare case-insensitively and use win32 semantics throughout.

const isUnc = (path: string) => /^[\\/]{2}/.test(path);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const within = (path: string, root: string) => same(path, root) || path.toLowerCase().startsWith(root.toLowerCase().replace(/\\?$/, '\\'));

function canonical(path: string): string {
  return realpathSync.native(path);
}

/** Folders a project must never be: whole drives, the profile root, and the system's own folders. */
function forbiddenRoots(): string[] {
  const env = process.env;
  return [env['SystemRoot'], env['ProgramFiles'], env['ProgramFiles(x86)'], env['ProgramData']].filter((value): value is string => Boolean(value));
}

export type RootCheck = { ok: true; path: string } | { ok: false; reason: string };

/** Validates a folder chosen as a project and returns its canonical path (junctions resolved). */
export function validateProjectRoot(input: string): RootCheck {
  if (isUnc(input)) return { ok: false, reason: 'Pastas de rede e caminhos de dispositivo não são aceitos.' };
  if (!win32.isAbsolute(input)) return { ok: false, reason: 'Informe o caminho completo da pasta.' };
  const resolved = win32.resolve(input);
  if (!existsSync(resolved)) return { ok: false, reason: 'A pasta não existe.' };
  const path = canonical(resolved);
  if (!statSync(path).isDirectory()) return { ok: false, reason: 'O caminho não é uma pasta.' };
  if (/^[A-Za-z]:\\?$/.test(path)) return { ok: false, reason: 'Escolha a pasta do projeto, não um disco inteiro.' };
  if (same(path, canonical(homedir()))) return { ok: false, reason: 'Escolha a pasta do projeto, não a pasta do usuário inteira.' };
  if (forbiddenRoots().some((root) => existsSync(root) && within(path, canonical(root)))) {
    return { ok: false, reason: 'Pastas do sistema não podem ser projetos.' };
  }
  return { ok: true, path };
}

/**
 * True when `candidate` (relative to the project or absolute) is inside the project after resolving
 * "..", case and junctions/symlinks — a link inside the project pointing elsewhere is outside.
 */
export function isInsideProject(root: string, candidate: string): boolean {
  if (isUnc(candidate)) return false;
  const absolute = win32.isAbsolute(candidate) ? win32.resolve(candidate) : win32.resolve(root, candidate);
  // Resolve the deepest part that exists, so not-yet-created files are judged by their real parent.
  let existing = absolute;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = win32.dirname(existing);
    if (parent === existing) return false;
    rest.unshift(win32.basename(existing));
    existing = parent;
  }
  const real = win32.join(canonical(existing), ...rest);
  return within(real, canonical(root));
}

const SENSITIVE_NAMES = [
  /^\.env(\..+)?$/,
  /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/,
  /\.(pem|key|pfx|p12|jks|keystore|kdbx|ppk)$/,
  /^appsettings(\..+)?\.json$/,
  /^(secrets?|credentials?)(\..+)?\.(json|ya?ml|toml|xml)$/,
  /^(\.npmrc|\.pypirc|\.git-credentials|\.netrc|_netrc|web\.config)$/,
];
const SAFE_TEMPLATES = /\.(example|sample|template|dist)$/;

/** Files that commonly hold credentials or connection strings: never read, listed or sent anywhere. */
export function isSensitiveFile(relativePath: string): boolean {
  const name = win32.basename(relativePath.replaceAll('/', '\\')).toLowerCase();
  if (SAFE_TEMPLATES.test(name)) return false;
  return SENSITIVE_NAMES.some((pattern) => pattern.test(name));
}
