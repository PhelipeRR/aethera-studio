import { statSync } from 'node:fs';
import { win32 } from 'node:path';
import type { EvidenceCheck, Memory } from '@neuralbridge/shared';
import { isInsideProject } from '@neuralbridge/workspace';

/** "src/a.ts:12" or "src/a.ts:3-9" → "src/a.ts": a line reference still names the file. */
const withoutLines = (ref: string) => ref.replace(/:\d+(?:-\d+)?$/, '');

/**
 * Checks a memory's file evidence against its project folder: missing, or changed after `since` (the
 * memory's last update), makes the memory stale. Only paths inside the project are looked at; other kinds
 * of evidence (tasks, conversations, links) cannot be checked from here and say so.
 */
export function checkEvidence(evidence: Memory['evidence'], root: string | null, since: string): EvidenceCheck[] {
  const sinceMs = new Date(since).getTime();
  return evidence.map(({ kind, ref }): EvidenceCheck => {
    if (kind !== 'file' || !root) return { kind, ref, status: 'unchecked' };
    const path = withoutLines(ref);
    if (!isInsideProject(root, path)) return { kind, ref, status: 'unchecked' };
    const absolute = win32.isAbsolute(path) ? win32.resolve(path) : win32.resolve(root, path);
    try {
      const stat = statSync(absolute);
      if (!stat.isFile()) return { kind, ref, status: 'missing' };
      return { kind, ref, status: stat.mtimeMs > sinceMs ? 'changed' : 'ok' };
    } catch {
      return { kind, ref, status: 'missing' };
    }
  });
}
