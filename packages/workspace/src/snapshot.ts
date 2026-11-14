import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { win32 } from 'node:path';
import { gitInfo, gitRun } from './git.js';
import { isInsideProject } from './project-paths.js';

// Phase 26: what the working tree looked like before an automatic fix, so it can be put back. Nothing is
// written to the repository (no stash, no commit, no branch): the content of every file that already
// differed from HEAD is kept in memory, and restoring touches only the files the fix changed.

export interface WorkingTreeSnapshot {
  head: string | null;
  /** Files that already differed from HEAD: their content then, or null if they did not exist. */
  changed: Record<string, string | null>;
}

export async function takeSnapshot(root: string): Promise<WorkingTreeSnapshot> {
  const info = await gitInfo(root);
  if (!info.isRepo) throw new Error('invalid: A correção automática precisa de um repositório Git para poder restaurar os arquivos.');
  const head = await gitRun(root, ['rev-parse', '--verify', 'HEAD']);
  const changed: Record<string, string | null> = {};
  for (const change of info.changes) {
    const path = win32.resolve(root, change.path);
    changed[change.path] = existsSync(path) ? readFileSync(path, 'utf8') : null;
  }
  return { head: head.code === 0 ? head.stdout.trim() : null, changed };
}

/**
 * Puts the given files back as they were in the snapshot: the user's unsaved version, the HEAD version,
 * or removed when they did not exist. Paths outside the project are ignored. Returns what was restored.
 */
export async function restoreSnapshot(root: string, snapshot: WorkingTreeSnapshot, files: readonly string[]): Promise<string[]> {
  const restored: string[] = [];
  for (const file of files) {
    if (win32.isAbsolute(file) || !isInsideProject(root, file)) continue;
    const path = win32.resolve(root, file);
    const relative = file.replaceAll('\\', '/');
    if (relative in snapshot.changed) {
      const content = snapshot.changed[relative];
      if (content === null || content === undefined) rmSync(path, { force: true });
      else writeFileSync(path, content);
    } else {
      const atHead = snapshot.head ? await gitRun(root, ['show', `${snapshot.head}:${relative}`]) : null;
      if (atHead && atHead.code === 0) writeFileSync(path, atHead.stdout);
      else rmSync(path, { force: true });
    }
    restored.push(relative);
  }
  return restored;
}

/**
 * Files whose content differs from the snapshot: changed since, including ones the user had already
 * edited before it (which a plain before/after list of changed files would miss).
 */
export async function changedSince(root: string, snapshot: WorkingTreeSnapshot): Promise<string[]> {
  const now = await gitInfo(root);
  const paths = new Set([...now.changes.map((change) => change.path), ...Object.keys(snapshot.changed)]);
  const moved: string[] = [];
  for (const path of paths) {
    const absolute = win32.resolve(root, path);
    const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    if (path in snapshot.changed) {
      if (current !== snapshot.changed[path]) moved.push(path);
    } else {
      moved.push(path);
    }
  }
  return moved;
}
