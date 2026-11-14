import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ChangeStatus, GitInfo } from '@neuralbridge/shared';
import { readProjectFile } from './project-files.js';
import { isSensitiveFile } from './project-paths.js';
import { createCliRunner } from './run.js';

export type { ChangeStatus, GitInfo };

/**
 * Read-only git. A repository's own config can make git run programs (core.fsmonitor on status,
 * diff.external and textconv on diff); projects are not trusted, so every call switches those off,
 * and --no-optional-locks keeps `status` from rewriting .git/index.
 */
const SAFE = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.quotepath=false', '-c', 'diff.external='];
const GIT = { command: 'git', args: [] };
const DIFF_LIMIT = 512 * 1024;

/** Runs git read-only with the repository's own programs (hooks, fsmonitor, external diff, textconv) switched off. */
export const gitRun = (root: string, args: string[]) => run(root, args);

const run = (root: string, args: string[]) =>
  createCliRunner({ env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, timeoutMs: 30_000 })(GIT, [...SAFE, '-C', root, ...args]);

function statusOf(code: string): ChangeStatus {
  if (code === '??') return 'untracked';
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflict';
  if (code.includes('R')) return 'renamed';
  if (code.includes('A')) return 'added';
  if (code.includes('D')) return 'deleted';
  return 'modified';
}

export async function gitInfo(root: string): Promise<GitInfo> {
  const status = await run(root, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all']);
  if (status.code !== 0) return { isRepo: false, branch: null, changes: [], lastCommit: null };

  const entries = status.stdout.split('\0').filter(Boolean);
  const header = entries[0]?.startsWith('## ') ? (entries.shift() ?? '') : '';
  const branch = /^## (?:No commits yet on |Initial commit on )?([^\s]+)$/.exec(header)?.[1] ?? null;
  const changes: GitInfo['changes'] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? '';
    const code = entry.slice(0, 2);
    changes.push({ path: entry.slice(3), status: statusOf(code) });
    if (code.includes('R') || code.includes('C')) i++; // -z puts the original path of a rename next
  }

  const log = await run(root, ['log', '-1', '--format=%h%x00%s%x00%cI']);
  const [hash, subject, date] = log.stdout.trim().split('\0');
  return {
    isRepo: true,
    branch,
    changes,
    lastCommit: log.code === 0 && hash ? { hash, subject: subject ?? '', date: date ?? '' } : null,
  };
}

/**
 * Added and removed lines per tracked file against HEAD (`git diff --numstat`), through the same safe
 * runner. Binary files count as 0/0; untracked files are not in a diff, and a repository without commits
 * has no HEAD to compare with: both yield nothing rather than a guess.
 */
export async function gitLineStats(root: string): Promise<{ path: string; added: number; removed: number }[]> {
  const result = await run(root, ['diff', '--numstat', '-z', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD', '--']);
  if (result.code !== 0) return [];
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      const match = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(entry);
      if (!match) return [];
      const count = (value: string | undefined) => (value === '-' || value === undefined ? 0 : Number(value));
      return [{ path: match[3] ?? '', added: count(match[1]), removed: count(match[2]) }];
    });
}

/** A "new file" diff for an untracked file, built without touching the index (no `git add -N`). */
function untrackedDiff(root: string, path: string, shown: string = path): string {
  if (isSensitiveFile(path)) return `diff --git a/${shown} b/${shown}\nnew file (conteúdo omitido: arquivo sensível)\n`;
  const preview = readProjectFile(root, path);
  if (!preview.ok) return `diff --git a/${shown} b/${shown}\nnew file (${preview.reason})\n`;
  const lines = preview.content.replace(/\n$/, '').split('\n');
  return `diff --git a/${shown} b/${shown}\nnew file\n--- /dev/null\n+++ b/${shown}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n`;
}

/**
 * Working-tree diff against HEAD (optionally of one path, which the caller has checked is inside the
 * project). With includeUntracked, new files are appended as "new file" diffs: git diff alone hides
 * them, and an agent's implementation usually creates files.
 */
export async function gitDiff(root: string, path?: string, options: { includeUntracked?: boolean } = {}): Promise<{ text: string; truncated: boolean }> {
  const result = await run(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD', '--', ...(path ? [path] : [])]);
  let text = result.code === 0 ? result.stdout : '';
  if (options.includeUntracked) {
    const info = await gitInfo(root);
    for (const change of info.changes) {
      if (change.status === 'untracked' && (!path || change.path === path)) text += untrackedDiff(root, change.path);
    }
  }
  return text.length > DIFF_LIMIT ? { text: text.slice(0, DIFF_LIMIT), truncated: true } : { text, truncated: false };
}

/** Staged-only diff used by Smart Commit; unstaged and untracked content is intentionally excluded. */
export async function gitStagedDiff(root: string): Promise<{ text: string; truncated: boolean; files: string[] }> {
  const [diff, names] = await Promise.all([
    run(root, ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--']),
    run(root, ['diff', '--cached', '--name-only', '-z', '--']),
  ]);
  if (diff.code !== 0 || names.code !== 0) throw new Error('failed: Não foi possível ler o diff staged.');
  const files = names.stdout.split('\0').filter(Boolean);
  return diff.stdout.length > DIFF_LIMIT ? { text: diff.stdout.slice(0, DIFF_LIMIT), truncated: true, files } : { text: diff.stdout, truncated: false, files };
}

/** Read-only patch for one historical commit. The caller must validate the optional path. */
export async function gitCommitDiff(root: string, commit: string, path?: string): Promise<{ text: string; truncated: boolean }> {
  if (!safeRef(commit)) throw new Error('invalid: commit Git inválido.');
  const result = await run(root, ['show', '--format=', '--no-color', '--no-ext-diff', '--no-textconv', '--end-of-options', commit, '--', ...(path ? [path] : [])]);
  if (result.code !== 0) throw new Error('not_found: commit Git não encontrado.');
  return result.stdout.length > DIFF_LIMIT ? { text: result.stdout.slice(0, DIFF_LIMIT), truncated: true } : { text: result.stdout, truncated: false };
}

const MAX_REPOSITORIES = 50;
const PATHS_PER_DIFF = 100;

export interface GitRefComparisonFile {
  path: string;
  previousPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
  added: number;
  removed: number;
}

export interface GitRefComparison {
  left: string;
  right: string;
  mode: 'direct' | 'merge-base';
  mergeBase: string | null;
  files: GitRefComparisonFile[];
  added: number;
  removed: number;
}

function safeRef(ref: string): boolean { return !!ref && !ref.startsWith('-') && !ref.includes('..') && !ref.includes('@{') && /^[A-Za-z0-9_./-]+(?:~[0-9]*|\^[0-9]*)*$/.test(ref); }

export async function readGitRefs(root: string): Promise<Array<{ ref: string; hash: string }>> {
  const result = await run(root, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/remotes']);
  if (result.code !== 0) return [];
  return result.stdout.split('\0').reduce<Array<{ ref: string; hash: string }>>((items, value, index, values) => { if (index % 2 === 0 && value && values[index + 1]) items.push({ ref: value, hash: values[index + 1] ?? '' }); return items; }, []);
}

/** Files changed between two commits, by the same safe runner as the diff itself. */
export async function gitDiffRangeFiles(root: string, base: string, head: string): Promise<string[]> {
  if (!safeRef(base) || !safeRef(head)) throw new Error('invalid: ref Git inválida.');
  const result = await run(root, ['diff', '--name-only', '-z', '--no-renames', '--end-of-options', `${base}...${head}`, '--']);
  if (result.code !== 0) throw new Error('not_found: intervalo Git não encontrado.');
  return result.stdout.split('\0').filter(Boolean);
}

export async function gitDiffRange(root: string, base: string, head: string): Promise<string> {
  if (!safeRef(base) || !safeRef(head)) throw new Error('invalid: ref Git inválida.');
  const result = await run(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--end-of-options', `${base}...${head}`, '--']);
  if (result.code !== 0) throw new Error('not_found: intervalo Git não encontrado.');
  return result.stdout.length > DIFF_LIMIT ? result.stdout.slice(0, DIFF_LIMIT) : result.stdout;
}

export async function gitCompareRefs(root: string, left: string, right: string, mode: 'direct' | 'merge-base' = 'direct'): Promise<GitRefComparison> {
  if (!safeRef(left) || !safeRef(right)) throw new Error('invalid: ref Git inválida.');
  const [verifyLeft, verifyRight] = await Promise.all([run(root, ['rev-parse', '--verify', '--end-of-options', left]), run(root, ['rev-parse', '--verify', '--end-of-options', right])]);
  if (verifyLeft.code !== 0 || verifyRight.code !== 0) throw new Error('not_found: ref Git não encontrada.');
  let mergeBase: string | null = null;
  let compareLeft = left;
  if (mode === 'merge-base') {
    const base = await run(root, ['merge-base', '--', left, right]);
    if (base.code !== 0 || !base.stdout.trim()) throw new Error('conflict: As refs não possuem ancestral comum.');
    mergeBase = base.stdout.trim();
    compareLeft = mergeBase;
  }
  const names = await run(root, ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', '--end-of-options', compareLeft, right, '--']);
  if (names.code !== 0) throw new Error('not_found: comparação Git não encontrada.');
  const stats = await run(root, ['diff', '--numstat', '-z', '--find-renames', '--no-ext-diff', '--no-textconv', '--end-of-options', compareLeft, right, '--']);
  const statByPath = new Map<string, { added: number; removed: number }>();
  const statParts = stats.stdout.split('\0');
  for (let i = 0; i + 2 < statParts.length; i += 3) {
    const added = statParts[i] === '-' ? 0 : Number(statParts[i]);
    const removed = statParts[i + 1] === '-' ? 0 : Number(statParts[i + 1]);
    const path = statParts[i + 2];
    if (path) statByPath.set(path, { added: Number.isFinite(added) ? added : 0, removed: Number.isFinite(removed) ? removed : 0 });
  }
  const parts = names.stdout.split('\0');
  const files: GitRefComparisonFile[] = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++] ?? '';
    if (!status) continue;
    const original = parts[i++] ?? '';
    const renamed = status.startsWith('R') ? parts[i++] ?? '' : null;
    const path = renamed ?? original;
    const stat = statByPath.get(path) ?? { added: 0, removed: 0 };
    files.push({ path, previousPath: renamed ? original : null, status: status.startsWith('A') ? 'added' : status.startsWith('D') ? 'deleted' : status.startsWith('R') ? 'renamed' : stat.added === 0 && stat.removed === 0 ? 'binary' : 'modified', ...stat });
  }
  return { left, right, mode, mergeBase, files, added: files.reduce((total, file) => total + file.added, 0), removed: files.reduce((total, file) => total + file.removed, 0) };
}

/**
 * The repositories of a project folder, as prefixes relative to it: '' when the folder is one, or its
 * immediate subfolders when it only groups repositories. Empty when there is no Git at all.
 */
export async function gitRepositories(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  if ((await run(root, ['rev-parse', '--is-inside-work-tree'])).code === 0) return [''];
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(root, entry.name, '.git')))
    .map((entry) => entry.name)
    .slice(0, MAX_REPOSITORIES);
  const valid = await Promise.all(folders.map(async (name) => ((await run(join(root, name), ['rev-parse', '--is-inside-work-tree'])).code === 0 ? name : null)));
  return valid.filter((name) => name !== null);
}

/** Changed paths of every repository of the project folder, relative to the folder. */
export async function gitChangedPaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const repository of await gitRepositories(root)) {
    const info = await gitInfo(repository ? join(root, repository) : root);
    paths.push(...info.changes.map((change) => (repository ? `${repository}/${change.path}` : change.path)));
  }
  return paths;
}

/**
 * The diff of the given project-relative files, in whichever repository of the folder holds each one,
 * with paths relative to the project. `unreviewed` lists the files with no diff to read: outside every
 * repository, already committed, or the same as HEAD. A caller must not treat those as checked.
 */
export async function gitDiffFiles(root: string, files: readonly string[]): Promise<{ text: string; truncated: boolean; unreviewed: string[] }> {
  const repositories = await gitRepositories(root);
  const byRepository = new Map<string, string[]>();
  for (const file of files) {
    const repository = repositories.find((prefix) => prefix === '' || file.startsWith(`${prefix}/`));
    if (repository === undefined || file.split('/').includes('..') || isAbsolute(file)) continue;
    byRepository.set(repository, [...(byRepository.get(repository) ?? []), repository ? file.slice(repository.length + 1) : file]);
  }
  let text = '';
  for (const [repository, paths] of byRepository) {
    const cwd = repository ? join(root, repository) : root;
    const prefix = repository ? `${repository}/` : '';
    for (let i = 0; i < paths.length; i += PATHS_PER_DIFF) {
      const result = await run(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', `--src-prefix=a/${prefix}`, `--dst-prefix=b/${prefix}`, 'HEAD', '--', ...paths.slice(i, i + PATHS_PER_DIFF)]);
      if (result.code === 0) text += result.stdout;
    }
    const untracked = new Set((await gitInfo(cwd)).changes.filter((change) => change.status === 'untracked').map((change) => change.path));
    for (const path of paths) if (untracked.has(path)) text += untrackedDiff(cwd, path, `${prefix}${path}`);
  }
  const unreviewed = files.filter((file) => !text.includes(`b/${file}\n`));
  return text.length > DIFF_LIMIT ? { text: text.slice(0, DIFF_LIMIT), truncated: true, unreviewed } : { text, truncated: false, unreviewed };
}
