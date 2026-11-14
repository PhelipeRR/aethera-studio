import { createHash } from 'node:crypto';
import type { GitHistory, GitHistoryCommit, GitHistoryFile, GitHistoryRef } from '@neuralbridge/shared';
import { gitRun } from './git.js';

// Phase 25: a project's Git history, read-only and bounded. Same safe runner as the rest of the Git
// support (no hooks, fsmonitor, external diff or textconv). Only the author's name is kept, never the
// e-mail; patches are cut at a byte limit; commits already known are skipped.

const FIELD = '\u001f';
const RECORD = '\u001e';
const CURSOR_PREFIX = 'git-history:v1:';

function encodeCursor(fingerprint: string, lastHash: string): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify({ fingerprint, lastHash }), 'utf8').toString('base64url')}`;
}

function decodeCursor(cursor: string): { fingerprint: string; lastHash: string } {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error('invalid: Cursor Git inválido.');
  try {
    const value = JSON.parse(Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8')) as { fingerprint?: unknown; lastHash?: unknown };
    if (typeof value.fingerprint !== 'string' || typeof value.lastHash !== 'string' || !/^[0-9a-f]{40}$/.test(value.lastHash)) throw new Error('invalid');
    return { fingerprint: value.fingerprint, lastHash: value.lastHash };
  } catch {
    throw new Error('invalid: Cursor Git inválido.');
  }
}

function parseFile(block: string, maxPatchBytes: number): GitHistoryFile | null {
  const lines = block.split('\n');
  const field = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? null;
  const renamedTo = field('rename to ');
  const added = field('+++ b/');
  const removed = field('--- a/');
  const header = /^a\/(.+?) b\/(.+)$/.exec(lines[0] ?? '');
  const path = renamedTo ?? added ?? (field('deleted file mode') !== null ? removed : null) ?? header?.[2] ?? null;
  if (!path) return null;
  const status: GitHistoryFile['status'] = field('new file mode') !== null ? 'added' : field('deleted file mode') !== null ? 'deleted' : renamedTo !== null ? 'renamed' : 'modified';
  const binary = lines.some((line) => line.startsWith('Binary files'));
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  const hunks = firstHunk >= 0 ? lines.slice(firstHunk).join('\n').trimEnd() : '';
  const start = firstHunk >= 0 ? /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(lines[firstHunk] ?? '')?.[1] : undefined;
  return {
    path,
    previousPath: renamedTo !== null ? field('rename from ') : null,
    status,
    line: status === 'deleted' || !start ? null : Number(start),
    binary,
    patch: hunks.slice(0, maxPatchBytes),
    truncated: hunks.length > maxPatchBytes,
  };
}

async function readCommit(root: string, hash: string, maxPatchBytes: number): Promise<GitHistoryCommit | null> {
  const format = ['%H', '%an', '%aI', '%P', '%s', '%b'].join('%x1f') + '%x1e';
  const result = await gitRun(root, ['show', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '--diff-merges=first-parent', `--format=${format}`, '--patch', hash]);
  if (result.code !== 0) return null;
  const [header = '', patch = ''] = result.stdout.split(RECORD);
  const [fullHash = '', author = '', date = '', parents = '', subject = '', body = ''] = header.split(FIELD);
  const files = patch
    .split(/^diff --git /m)
    .slice(1)
    .map((block) => parseFile(block, maxPatchBytes))
    .filter((file): file is GitHistoryFile => file !== null);
  return { hash: fullHash.trim(), author, date, parents: parents.split(' ').filter(Boolean), subject, body: body.trim(), files };
}

export async function readGitHistory(root: string, options: { known: ReadonlySet<string>; maxCommits?: number; maxPatchBytes?: number; cursor?: string }): Promise<GitHistory> {
  const maxCommits = options.maxCommits ?? 200;
  const maxPatchBytes = options.maxPatchBytes ?? 16_000;
  const refs = await gitRun(root, ['for-each-ref', `--format=%(refname)${FIELD}%(refname:short)${FIELD}%(objectname)`, 'refs/heads', 'refs/remotes', 'refs/tags']);
  if (refs.code !== 0) return { isRepo: false, branches: [], commits: [], limited: false };
  const allRefs = refs.stdout
    .split('\n')
    .filter(Boolean)
    .map((line): GitHistoryRef | null => {
      const [fullName = '', name = '', hash = ''] = line.split(FIELD);
      const kind = fullName.startsWith('refs/remotes/') ? 'remote' : fullName.startsWith('refs/tags/') ? 'tag' : 'local';
      return fullName && name && hash ? { name, kind, hash } : null;
    })
    .filter((ref): ref is GitHistoryRef => ref !== null);
  const branches = allRefs
    .filter((ref) => ref.kind === 'local')
    .map((ref) => {
      return { name: ref.name, head: ref.hash };
    });
  const headResult = await gitRun(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const fingerprint = createHash('sha256').update(allRefs.map((ref) => `${ref.kind}:${ref.name}:${ref.hash}`).join('\n')).digest('hex').slice(0, 40);
  // An unborn repository has no commits (and rev-list fails): that is an empty history, not an error.
  const list = await gitRun(root, ['rev-list', '--topo-order', '--branches']);
  const hashes = list.code === 0 ? list.stdout.split('\n').filter(Boolean) : [];
  let start = 0;
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    if (cursor.fingerprint !== fingerprint) throw new Error('invalid: O histórico Git mudou; recarregue o grafo.');
    const cursorIndex = hashes.indexOf(cursor.lastHash);
    if (cursorIndex < 0) throw new Error('invalid: O cursor Git não pertence mais ao histórico.');
    start = cursorIndex + 1;
  }
  const fresh = hashes.slice(start).filter((hash) => !options.known.has(hash));
  const commits: GitHistoryCommit[] = [];
  const page = fresh.slice(0, maxCommits);
  // Keep Git access bounded while avoiding hundreds of sequential process startups on large histories.
  // The result is restored to rev-list order so DAG rows and cursors remain deterministic.
  const concurrency = 8;
  for (let offset = 0; offset < page.length; offset += concurrency) {
    const batch = await Promise.all(page.slice(offset, offset + concurrency).map((hash) => readCommit(root, hash, maxPatchBytes)));
    commits.push(...batch.filter((commit): commit is GitHistoryCommit => commit !== null));
  }
  const limited = fresh.length > maxCommits;
  const lastCommit = commits.at(-1);
  return { isRepo: true, branches, refs: allRefs, head: headResult.code === 0 ? headResult.stdout.trim() || null : null, commits, limited, nextCursor: limited && lastCommit ? encodeCursor(fingerprint, lastCommit.hash) : null };
}
