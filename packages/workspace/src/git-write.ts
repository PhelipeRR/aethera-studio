import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { GitSyncStatus } from '@neuralbridge/shared';
import { gitRun } from './git.js';

// The only place the app writes with Git, always on an explicit request: git.ts stays read-only.

export const PROJECT_TECHNOLOGIES = ['node', 'dotnet', 'python', 'java', 'rust', 'go', 'other'] as const;
export type ProjectTechnology = (typeof PROJECT_TECHNOLOGIES)[number];

const COMMON_IGNORE = ['.env', '.env.*', '!.env.example', '*.log', '.DS_Store', 'Thumbs.db', '.vs/', '.idea/'];
const IGNORE: Record<ProjectTechnology, string[]> = {
  node: ['node_modules/', 'dist/', 'build/', 'coverage/', '.next/', '.nuxt/'],
  dotnet: ['bin/', 'obj/', '*.user', 'TestResults/'],
  python: ['__pycache__/', '*.pyc', '.venv/', 'venv/', 'dist/', '*.egg-info/'],
  java: ['target/', 'build/', '.gradle/', '*.class'],
  rust: ['target/'],
  go: ['bin/', '*.exe'],
  other: [],
};

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const TIMEOUT_MS = 10 * 60_000;
// Repository-provided code must not run: no template hooks, no fsmonitor, no submodule fetch.
const SAFE_WRITE = ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=user'];

export type WorkingTreeStatus = 'staged' | 'unstaged' | 'untracked' | 'conflict';
export interface WorkingTreeFile { path: string; status: WorkingTreeStatus; staged: boolean; unstaged: boolean; }
export interface GitBranchInfo { name: string; current: boolean; remote: boolean; worktree: boolean; }
export interface GitStashInfo { ref: string; message: string; }

function safeWorkingTreePath(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !path.split(/[\\/]/).includes('..');
}

function assertWorkingTreePaths(paths: readonly string[]): void {
  if (!paths.length || paths.some((path) => !safeWorkingTreePath(path))) throw new Error('invalid: Caminho Git inválido.');
}

/** Read the index/worktree split without exposing raw porcelain records to the renderer. */
export async function gitWorkingTree(root: string): Promise<WorkingTreeFile[]> {
  const result = await gitRun(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.code !== 0) throw new Error('unavailable: Não foi possível ler o working tree.');
  return result.stdout.split('\0').filter(Boolean).flatMap((entry) => {
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (!safeWorkingTreePath(path)) return [];
    const staged = code[0] !== ' ' && code[0] !== '?';
    const unstaged = code[1] !== ' ' && code[1] !== '?';
    const status: WorkingTreeStatus = code === '??' ? 'untracked' : code.includes('U') ? 'conflict' : staged && !unstaged ? 'staged' : 'unstaged';
    return [{ path, status, staged, unstaged }];
  });
}

export async function gitStage(root: string, paths: readonly string[], options: { signal?: AbortSignal } = {}): Promise<void> {
  assertWorkingTreePaths(paths);
  await write(['add', '--', ...paths], { cwd: root, signal: options.signal });
}

export async function gitUnstage(root: string, paths: readonly string[], options: { signal?: AbortSignal } = {}): Promise<void> {
  assertWorkingTreePaths(paths);
  await write(['restore', '--staged', '--', ...paths], { cwd: root, signal: options.signal });
}

const MAX_PATCH_BYTES = 80_000;

function unsafePatchPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  return !normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..');
}

/** Validate an AI-produced unified diff before handing it to Git. The patch is still untrusted. */
export function validateGitPatch(patch: string): void {
  if (!patch || Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES || patch.includes('\0')) throw new Error('invalid: Patch inválido ou grande demais.');
  const headers = patch.split(/\r?\n/).filter((line) => line.startsWith('diff --git '));
  if (!headers.length) throw new Error('invalid: Patch unificado não encontrado.');
  for (const header of headers) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(header);
    if (!match || unsafePatchPath(match[1] ?? '') || unsafePatchPath(match[2] ?? '')) throw new Error('invalid: Patch contém um caminho inseguro.');
  }
}

/** Apply a validated patch after Git itself confirms it is still applicable. Never stages or commits. */
export async function gitApplyPatch(root: string, patch: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  const normalized = patch.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const input = normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  validateGitPatch(input);
  await write(['apply', '--check', '--whitespace=nowarn', '--recount', '-'], { cwd: root, input, signal: options.signal });
  await write(['apply', '--whitespace=nowarn', '--recount', '-'], { cwd: root, input, signal: options.signal });
}

async function validBranchName(root: string, name: string): Promise<void> {
  if (!name || name.startsWith('-') || name.includes('..')) throw new Error('invalid: Nome de branch inválido.');
  const result = await gitRun(root, ['check-ref-format', `refs/heads/${name}`]);
  if (result.code !== 0) throw new Error('invalid: Nome de branch inválido.');
}

async function currentBranch(root: string): Promise<string | null> {
  const result = await gitRun(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return result.code === 0 ? result.stdout.trim() || null : null;
}

async function worktreeBranches(root: string): Promise<Set<string>> {
  const result = await gitRun(root, ['worktree', 'list', '--porcelain']);
  return new Set([...result.stdout.matchAll(/branch refs\/heads\/([^\n]+)/g)].map((match) => match[1] ?? '').filter(Boolean));
}

export async function gitBranches(root: string): Promise<GitBranchInfo[]> {
  const result = await gitRun(root, ['for-each-ref', '--format=%(refname:short)%00%(HEAD)%00%(symref)', 'refs/heads', 'refs/remotes']);
  if (result.code !== 0) throw new Error('unavailable: Não foi possível ler as branches.');
  const checkedOut = await worktreeBranches(root);
  return result.stdout.split('\n').filter(Boolean).map((line) => {
    const [name = '', head = ''] = line.split('\0');
    return { name, current: head === '*', remote: name.startsWith('origin/'), worktree: checkedOut.has(name) };
  });
}

export async function gitCreateBranch(root: string, name: string): Promise<void> {
  await validBranchName(root, name);
  await write(['branch', '--', name], { cwd: root });
}

export async function gitSwitchBranch(root: string, name: string): Promise<void> {
  await validBranchName(root, name);
  if ((await gitWorkingTree(root)).length) throw new Error('conflict: Working tree sujo; revise ou preserve as alterações antes de alternar.');
  await write(['switch', '--', name], { cwd: root });
}

export async function gitRenameBranch(root: string, oldName: string, newName: string): Promise<void> {
  await validBranchName(root, oldName); await validBranchName(root, newName);
  await write(['branch', '-m', '--', oldName, newName], { cwd: root });
}

export async function gitDeleteBranch(root: string, name: string): Promise<void> {
  await validBranchName(root, name);
  if (await currentBranch(root) === name) throw new Error('conflict: Não é possível excluir a branch atual.');
  if ((await worktreeBranches(root)).has(name)) throw new Error('conflict: A branch está em uso por outra worktree.');
  await write(['branch', '-d', '--', name], { cwd: root });
}

export async function gitStashes(root: string): Promise<GitStashInfo[]> {
  const result = await gitRun(root, ['stash', 'list', '--format=%gd%x00%s']);
  if (result.code !== 0) throw new Error('unavailable: Não foi possível ler os stashes.');
  return result.stdout.split('\n').filter(Boolean).map((line) => { const [ref = '', message = ''] = line.split('\0'); return { ref, message }; });
}

async function validateStash(root: string, ref: string): Promise<void> {
  if (!/^stash@\{[0-9]+\}$/.test(ref)) throw new Error('invalid: Identificador de stash inválido.');
  const result = await gitRun(root, ['rev-parse', '--verify', '--end-of-options', ref]);
  if (result.code !== 0) throw new Error('not_found: Stash não encontrado.');
}

export async function gitStashCreate(root: string, message: string, includeUntracked = false): Promise<void> {
  if (!message.trim() || message.length > 200) throw new Error('invalid: Descrição do stash inválida.');
  await write(['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), '-m', message.trim()], { cwd: root });
}

export async function gitStashApply(root: string, ref: string, pop = false): Promise<void> {
  await validateStash(root, ref);
  await write(['stash', pop ? 'pop' : 'apply', ref], { cwd: root });
}

export async function gitStashDrop(root: string, ref: string): Promise<void> {
  await validateStash(root, ref);
  await write(['stash', 'drop', ref], { cwd: root });
}

export async function gitCommit(root: string, message: string): Promise<void> {
  const clean = message.trim();
  if (!clean || clean.length > 500) throw new Error('invalid: Mensagem de commit inválida.');
  const staged = await gitRun(root, ['diff', '--cached', '--quiet']);
  if (staged.code === 0) throw new Error('conflict: Não há alterações staged para commit.');
  await write(['commit', '-m', clean], { cwd: root });
}

function remoteName(upstream: string | null): string | null {
  const slash = upstream?.indexOf('/') ?? -1;
  return slash > 0 ? upstream?.slice(0, slash) ?? null : null;
}

/** Shows commits that exist locally but are not in the configured upstream. It never fetches. */
export async function gitSyncStatus(root: string): Promise<GitSyncStatus> {
  const branchResult = await gitRun(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
  const upstreamResult = await gitRun(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() || null : null;
  const remoteResult = await gitRun(root, ['remote']);
  const remotes = remoteResult.code === 0 ? remoteResult.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean) : [];
  if (!branch || !upstream) return { branch, upstream: null, remote: null, remotes, ahead: 0, behind: 0, pending: [] };

  const counts = await gitRun(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
  const [aheadRaw = '0', behindRaw = '0'] = counts.stdout.trim().split(/\s+/);
  const log = await gitRun(root, ['log', '--format=%H%x00%s%x00%cI', `${upstream}..HEAD`]);
  const fields = log.stdout.trim() ? log.stdout.trim().split('\0') : [];
  const pending = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const hash = fields[index] ?? '';
    const subject = fields[index + 1] ?? '';
    const date = fields[index + 2] ?? '';
    if (hash) pending.push({ hash, subject, date });
  }
  return { branch, upstream, remote: remoteName(upstream), remotes, ahead: Number(aheadRaw) || 0, behind: Number(behindRaw) || 0, pending };
}

/** Pushes the current branch only, with no force/update-ref options. The action is authorization-gated by the main process. */
export async function gitPush(root: string, requestedRemote?: string): Promise<void> {
  const branch = await currentBranch(root);
  if (!branch) throw new Error('conflict: Não é possível subir commits sem uma branch atual.');
  const status = await gitSyncStatus(root);
  const remote = requestedRemote ?? status.remote ?? status.remotes[0] ?? null;
  if (!remote || !status.remotes.includes(remote)) throw new Error('not_found: Nenhum remoto Git disponível.');
  const upstreamBranch = status.upstream?.startsWith(`${remote}/`) ? status.upstream.slice(remote.length + 1) : branch;
  if (!upstreamBranch || upstreamBranch.includes('..')) throw new Error('invalid: Branch remota inválida.');
  const setUpstream = !status.upstream;
  await write(['push', ...(setUpstream ? ['-u'] : []), remote, `${branch}:${upstreamBranch}`], { cwd: root });
}

export type GitOperationKind = 'revert' | 'cherry-pick';
export interface GitOperationState { operation: GitOperationKind | null; conflicts: string[]; }

export async function gitOperationState(root: string): Promise<GitOperationState> {
  const gitDir = (await gitRun(root, ['rev-parse', '--git-dir'])).stdout.trim();
  if (!gitDir) return { operation: null, conflicts: [] };
  const status = await gitWorkingTree(root);
  const head = await gitRun(root, ['rev-parse', '--verify', 'REVERT_HEAD']);
  const cherry = await gitRun(root, ['rev-parse', '--verify', 'CHERRY_PICK_HEAD']);
  return { operation: head.code === 0 ? 'revert' : cherry.code === 0 ? 'cherry-pick' : null, conflicts: status.filter((file) => file.status === 'conflict').map((file) => file.path) };
}

async function validateCommitOperation(root: string, commit: string): Promise<number> {
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error('invalid: Commit inválido.');
  const state = await gitOperationState(root);
  if (state.operation) throw new Error(`conflict: Há uma operação ${state.operation} em andamento.`);
  if ((await gitWorkingTree(root)).length) throw new Error('conflict: O working tree precisa estar limpo antes da operação.');
  const parents = await gitRun(root, ['rev-list', '--parents', '-n', '1', '--end-of-options', commit]);
  if (parents.code !== 0) throw new Error('not_found: Commit não encontrado.');
  return Math.max(0, parents.stdout.trim().split(/\s+/).length - 1);
}

export async function gitRevert(root: string, commit: string, mainline?: number): Promise<void> {
  const parents = await validateCommitOperation(root, commit);
  if (parents > 1 && !mainline) throw new Error('invalid: Revert de merge exige mainline explícito.');
  if (mainline && (mainline < 1 || mainline > parents)) throw new Error('invalid: Mainline inválido para este merge.');
  await write(['revert', '--no-edit', ...(mainline ? ['--mainline', String(mainline)] : []), commit], { cwd: root });
}

export async function gitCherryPick(root: string, commit: string, mainline?: number): Promise<void> {
  const parents = await validateCommitOperation(root, commit);
  if (parents > 1 && !mainline) throw new Error('invalid: Cherry-pick de merge exige mainline explícito.');
  if (mainline && (mainline < 1 || mainline > parents)) throw new Error('invalid: Mainline inválido para este merge.');
  await write(['cherry-pick', ...(mainline ? ['--mainline', String(mainline)] : []), commit], { cwd: root });
}

export async function gitResolveOperation(root: string, operation: GitOperationKind, action: 'continue' | 'abort'): Promise<void> {
  const state = await gitOperationState(root);
  if (state.operation !== operation) throw new Error('conflict: Nenhuma operação compatível está em andamento.');
  await write([operation, `--${action}`], { cwd: root });
}

function write(args: string[], options: { cwd: string; env?: Record<string, string>; input?: string; signal?: AbortSignal | undefined }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('cancelled: Operação cancelada.'));
    const child = spawn('git', [...SAFE_WRITE, ...args], { cwd: options.cwd, shell: false, windowsHide: true, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'cmd.exe /c exit 0', ...options.env } });
    let stderr = '';
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    const abort = () => child.kill();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.input !== undefined) child.stdin?.end(options.input);
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2_000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) reject(new Error('cancelled: Operação cancelada.'));
      else if (code === 0) resolve();
      else reject(new Error(`O Git recusou a operação: ${stderr.trim()}`));
    });
  });
}

/** The repository the folder belongs to, or null. A broken `.git` does not count. */
async function enclosingRepository(path: string): Promise<string | null> {
  const top = await gitRun(path, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return null;
  return realpathSync(top.stdout.trim());
}

async function assertCanInit(path: string, allowNested: boolean): Promise<void> {
  const repository = await enclosingRepository(path);
  if (!repository) return;
  if (repository.toLowerCase() === realpathSync(path).toLowerCase()) throw new Error('conflict: Esta pasta já é um repositório Git.');
  if (!allowNested) throw new Error(`confirm_nested: A pasta fica dentro do repositório ${repository}. Criar outro aqui deixa um repositório aninhado.`);
}

/** `git init`, never over an existing repository, and nested only after an explicit yes. */
export async function initRepository(path: string, options: { allowNested?: boolean } = {}): Promise<void> {
  await assertCanInit(path, options.allowNested === true);
  await write(['init', '-q', '-b', 'main', '--template='], { cwd: path });
}

/** A new folder with a README, an ignore file and its repository. Nothing that exists is overwritten. */
export async function createProjectFolder(input: { parent: string; name: string; technology: ProjectTechnology; allowNested?: boolean }): Promise<{ path: string }> {
  const name = input.name.trim();
  if (!name || name !== input.name || /[<>:"/\\|?*]/.test(name) || name === '.' || name === '..' || RESERVED.test(name) || /[. ]$/.test(name)) throw new Error('invalid: Nome de pasta inválido.');
  const path = join(input.parent, name);
  if (existsSync(path)) throw new Error('conflict: Esta pasta já existe.');
  await assertCanInit(input.parent, false).catch((error: unknown) => {
    const inParent = error instanceof Error && error.message.startsWith('conflict:');
    if (input.allowNested) return;
    if (inParent) throw new Error('confirm_nested: A pasta escolhida já é um repositório Git. Criar outro aqui deixa um repositório aninhado.');
    throw error;
  });
  mkdirSync(path);
  writeFileSync(join(path, 'README.md'), `# ${name}\n`, { flag: 'wx' });
  writeFileSync(join(path, '.gitignore'), `${[...IGNORE[input.technology], ...COMMON_IGNORE].join('\n')}\n`, { flag: 'wx' });
  await write(['init', '-q', '-b', 'main', '--template='], { cwd: path });
  return { path };
}

/** Only https and ssh. `ext::`, local paths and anything that could read as an option are refused. */
export function validateCloneUrl(url: string, allowedSchemes: readonly string[] = ['https', 'ssh']): boolean {
  if (/\s/.test(url) || url.startsWith('-')) return false;
  if (/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(url)) return allowedSchemes.includes('ssh');
  try {
    const parsed = new URL(url);
    return allowedSchemes.includes(parsed.protocol.replace(':', ''));
  } catch {
    return false;
  }
}

/** Clones with the credentials the user's Git already has; the app never sees them. */
export async function cloneRepository(url: string, target: string, options: { signal?: AbortSignal; allowedSchemes?: readonly string[] } = {}): Promise<void> {
  const schemes = options.allowedSchemes ?? ['https', 'ssh'];
  if (!validateCloneUrl(url, schemes)) throw new Error('invalid: Use um endereço https ou ssh.');
  if (existsSync(target) && readdirSync(target).length > 0) throw new Error('conflict: A pasta de destino precisa estar vazia.');
  if (options.signal?.aborted) throw new Error('cancelled: Operação cancelada.');
  await write(['clone', '--quiet', '--template=', '--no-recurse-submodules', '--', url, target], { cwd: process.cwd(), env: { GIT_ALLOW_PROTOCOL: schemes.join(':') }, signal: options.signal });
}
