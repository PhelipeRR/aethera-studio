import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';

export interface SkillManifest {
  name: string;
  description: string;
  valid: boolean;
  raw: string;
}

export interface SkillSummary extends SkillManifest {
  id: string;
  root: string;
  path: string;
  source: 'claude' | 'codex' | 'agents' | 'plugin' | 'custom';
  conflict: boolean;
  scripts: string[];
}

/** What the app shows for a skill: everything but the SKILL.md text, which stays on disk and is read only when a task uses it. */
export type SkillListing = Omit<SkillSummary, 'raw'>;

export function toSkillListing(skill: SkillSummary): SkillListing {
  const { id, name, description, valid, root, path, source, conflict, scripts } = skill;
  return { id, name, description, valid, root, path, source, conflict, scripts };
}

export interface SkillPreference { skillId: string; taskTypes: string[]; agents: Array<'claude' | 'codex'>; enabled: boolean; }
export interface SkillSettings { allowlistedHosts: string[]; preferences: SkillPreference[]; }
export const DEFAULT_SKILL_SETTINGS: SkillSettings = { allowlistedHosts: [], preferences: [] };

export async function readSkillSettings(file: string): Promise<SkillSettings> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return DEFAULT_SKILL_SETTINGS;
    const value = parsed as Partial<SkillSettings>;
    return { allowlistedHosts: Array.isArray(value.allowlistedHosts) ? value.allowlistedHosts.filter((item): item is string => typeof item === 'string') : [], preferences: Array.isArray(value.preferences) ? value.preferences.filter((item): item is SkillPreference => Boolean(item && typeof item === 'object' && typeof (item as SkillPreference).skillId === 'string')) : [] };
  } catch { return DEFAULT_SKILL_SETTINGS; }
}

export async function writeSkillSettings(file: string, settings: SkillSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(settings, null, 2), 'utf8');
  await rename(temp, file);
}

const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;
const SCRIPT_NAMES = new Set(['install.sh', 'install.ps1', 'setup.sh', 'setup.ps1', 'postinstall.js', 'postinstall.mjs']);
const execFileAsync = promisify(execFile);

export function parseSkillManifest(raw: string, fallbackName: string): SkillManifest {
  const match = raw.match(FRONTMATTER);
  if (!match) return { name: fallbackName, description: '', valid: false, raw };
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const parsed = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (parsed) {
      const [, key, value] = parsed;
      if (key && value !== undefined) fields.set(key.toLowerCase(), value.trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  const name = fields.get('name') ?? fallbackName;
  const description = fields.get('description') ?? '';
  return { name, description, valid: Boolean(name && description), raw };
}

function sourceFor(root: string): SkillSummary['source'] {
  const lower = root.toLowerCase();
  if (lower.includes('.claude')) return lower.includes('plugins') ? 'plugin' : 'claude';
  if (lower.includes('.codex')) return 'codex';
  if (lower.includes('.agents')) return 'agents';
  return 'custom';
}

export async function scanSkills(roots: readonly string[]): Promise<SkillSummary[]> {
  const found: SkillSummary[] = [];
  for (const configured of roots) {
    let root: string;
    try { root = await resolve(configured); } catch { continue; }
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const manifestPath = join(dir, 'SKILL.md');
      try {
        const stat = await lstat(manifestPath);
        if (!stat.isFile()) continue;
        const raw = await readFile(manifestPath, 'utf8');
        const manifest = parseSkillManifest(raw, entry.name);
        const files = await readdir(dir, { withFileTypes: true });
        found.push({ ...manifest, id: `${sourceFor(root)}:${entry.name}:${relative(root, dir)}`, root, path: manifestPath, source: sourceFor(root), conflict: false, scripts: files.filter((file) => file.isFile() && SCRIPT_NAMES.has(file.name)).map((file) => file.name) });
      } catch { /* unreadable or malformed entries are omitted, never executed */ }
    }
  }
  const names = new Map<string, number>();
  for (const skill of found) names.set(skill.name.toLowerCase(), (names.get(skill.name.toLowerCase()) ?? 0) + 1);
  return found.map((skill) => ({ ...skill, conflict: (names.get(skill.name.toLowerCase()) ?? 0) > 1 })).sort((a, b) => a.name.localeCompare(b.name));
}

export function isAllowedSkillPath(path: string, allowlistedRoots: readonly string[]): boolean {
  const candidate = resolve(path);
  return allowlistedRoots.some((root) => { const base = resolve(root); const rel = relative(base, candidate); return rel === '' || (!rel.startsWith('..') && !rel.includes(':')); });
}

export function skillMayExecute(skill: SkillSummary): false {
  void skill;
  return false;
}

export function validateRemoteSkillSource(source: string, allowlistedHosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(source); } catch { throw new Error('invalid_skill_source: origem inválida'); }
  if (url.protocol !== 'https:' || !allowlistedHosts.includes(url.hostname.toLowerCase())) throw new Error('skill_source_not_allowlisted: origem não autorizada');
  if (url.username || url.password) throw new Error('invalid_skill_source: credenciais na URL não são permitidas');
  return url;
}

export function skillsForTask(taskType: string, agent: 'claude' | 'codex', preferences: readonly SkillPreference[]): string[] {
  return preferences.filter((item) => item.enabled && item.agents.includes(agent) && item.taskTypes.includes(taskType)).map((item) => item.skillId);
}

export interface RemoteSkillLimits { timeoutMs: number; maxBytes: number; maxFiles: number; caFile?: string; }

/** Fetches a single remote SKILL.md as untrusted data and installs it atomically. */
export async function installRemoteSkill(source: string, destinationRoot: string, allowlistedHosts: readonly string[], approved: boolean, limits: RemoteSkillLimits = { timeoutMs: 10_000, maxBytes: 512_000, maxFiles: 32 }): Promise<string> {
  if (!approved) throw new Error('approval_required: instalação de skill exige aprovação explícita');
  const url = validateRemoteSkillSource(source, allowlistedHosts);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  let response: Response;
  try { response = await fetch(url, { redirect: 'manual', signal: controller.signal }); } catch (error) { throw new Error('skill_network_error: download failed', { cause: error }); } finally { clearTimeout(timeout); }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error('skill_redirect_invalid: redirecionamento sem destino');
    validateRemoteSkillSource(new URL(location, url).toString(), allowlistedHosts);
    throw new Error('skill_redirect_requires_revalidation: redirecionamento recusado');
  }
  if (!response.ok) throw new Error(`skill_network_error: HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > limits.maxBytes) throw new Error('skill_size_limit: conteúdo excede o limite');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > limits.maxBytes) throw new Error('skill_size_limit: conteúdo excede o limite');
  const parsed = parseSkillManifest(text, url.pathname.split('/').filter(Boolean).at(-2) ?? 'remote-skill');
  if (!parsed.valid) throw new Error('invalid_skill_manifest: frontmatter inválido');
  const staging = await mkdtemp(join(tmpdir(), 'nb-skill-'));
  const destination = resolve(destinationRoot, parsed.name);
  try {
    await writeFile(join(staging, 'SKILL.md'), text, 'utf8');
    await mkdir(destinationRoot, { recursive: true });
    if (await lstat(destination).then(() => true).catch(() => false)) throw new Error('skill_exists: atualização exige fluxo explícito de versão');
    await rename(staging, destination);
    return destination;
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

/** Clones an allowlisted Git repository without submodules/hooks, validates it, then swaps atomically. */
export async function installRemoteSkillRepository(source: string, destinationRoot: string, allowlistedHosts: readonly string[], approved: boolean, limits: RemoteSkillLimits = { timeoutMs: 30_000, maxBytes: 5_000_000, maxFiles: 200 }): Promise<string> {
  if (!approved) throw new Error('approval_required: instalação de skill exige aprovação explícita');
  const url = validateRemoteSkillSource(source, allowlistedHosts);
  const stagingParent = await mkdtemp(join(tmpdir(), 'nb-skill-repo-')); const checkout = join(stagingParent, 'repo');
  const destination = resolve(destinationRoot, basenameSafe(url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean).at(-1) ?? 'skill'));
  const timer = setTimeout(() => undefined, limits.timeoutMs);
  try {
    const gitArgs = ['-c', 'protocol.file.allow=never', ...(limits.caFile ? ['-c', 'http.sslBackend=openssl', '-c', `http.sslCAInfo=${limits.caFile}`] : []), 'clone', '--no-recurse-submodules', url.toString(), checkout];
    await execFileAsync('git', gitArgs, { timeout: limits.timeoutMs, windowsHide: true });
    const files = await validateSkillTree(checkout, limits);
    if (files > limits.maxFiles) throw new Error('skill_file_limit: quantidade de arquivos excede o limite');
    const manifest = await readFile(join(checkout, 'SKILL.md'), 'utf8');
    if (!parseSkillManifest(manifest, basenameSafe(checkout)).valid) throw new Error('invalid_skill_manifest: frontmatter inválido');
    await mkdir(destinationRoot, { recursive: true });
    const backup = `${destination}.previous`;
    const exists = await lstat(destination).then(() => true).catch(() => false);
    if (exists) await rename(destination, backup);
    try { await rename(checkout, destination); await rm(backup, { recursive: true, force: true }); } catch (error) {
      await rm(destination, { recursive: true, force: true }).catch(() => undefined); if (exists) await rename(backup, destination).catch(() => undefined); throw error;
    }
    return destination;
  } finally { clearTimeout(timer); await rm(stagingParent, { recursive: true, force: true }).catch(() => undefined); }
}

async function validateSkillTree(root: string, limits: RemoteSkillLimits): Promise<number> {
  let count = 0;
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const path = join(dir, entry.name); const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error('skill_symlink_rejected: conteúdo remoto contém symlink');
      if (stat.isDirectory()) await visit(path); else if (stat.isFile()) { count++; if (stat.size > limits.maxBytes) throw new Error('skill_size_limit: arquivo excede o limite'); }
    }
  };
  await visit(root); return count;
}

/** Installs only after explicit approval and allowlist validation; copied scripts remain inert files. */
export async function installSkill(sourceDir: string, destinationRoot: string, approved: boolean): Promise<string> {
  if (!approved) throw new Error('approval_required: instalação de skill exige aprovação explícita');
  const source = resolve(sourceDir); const destination = resolve(destinationRoot, basenameSafe(source));
  if (!isAllowedSkillPath(source, [source])) throw new Error('invalid_skill_path: origem inválida');
  const manifest = await readFile(join(source, 'SKILL.md'), 'utf8');
  const parsed = parseSkillManifest(manifest, basenameSafe(source));
  if (!parsed.valid) throw new Error('invalid_skill_manifest: frontmatter inválido');
  await mkdir(destinationRoot, { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: false, force: true });
  return destination;
}

function basenameSafe(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? '';
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*]/u.test(name)) throw new Error('invalid_skill_path: nome inválido');
  return name;
}
