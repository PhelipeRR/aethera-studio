import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentLimitWindow } from '@neuralbridge/shared';

/*
 * Codex's usage limits. `codex exec --json` reports tokens only, but the CLI records every session in
 * `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<thread>.jsonl`, and those records carry the rate-limit snapshot the
 * server returned: a five-hour window (`primary`) and a weekly one (`secondary`), each with the used percentage and the
 * reset time. Reading that file after a run gives the same numbers Codex itself shows, nothing estimated.
 */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Same ids as Claude's windows where the length matches, so the page labels them alike. */
function windowId(minutes: number): string {
  if (minutes === 300) return 'five_hour';
  if (minutes === 10_080) return 'seven_day';
  return `${minutes}_minutes`;
}

function findRateLimits(value: unknown): Json | null {
  if (!isObject(value)) return null;
  if (isObject(value['rate_limits'])) return value['rate_limits'];
  for (const child of Object.values(value)) {
    const found = findRateLimits(child);
    if (found) return found;
  }
  return null;
}

/** Converts Codex's snapshot (`{ primary, secondary }`) into the app's windows; unknown shapes give an empty list. */
export function codexLimitWindows(rateLimits: unknown): AgentLimitWindow[] {
  if (!isObject(rateLimits)) return [];
  const windows: AgentLimitWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const item = rateLimits[key];
    if (!isObject(item)) continue;
    const used = num(item['used_percent']);
    const minutes = num(item['window_minutes']);
    if (used === null || minutes === null) continue;
    const resetsAt = num(item['resets_at']);
    windows.push({ id: windowId(minutes), utilization: Math.min(1, Math.max(0, used / 100)), resetsAt: resetsAt === null ? null : new Date(resetsAt * 1000).toISOString(), status: used >= 100 ? 'rejected' : 'allowed' });
  }
  return windows;
}

/** The session file of a thread: Codex files it under its start date, so only the latest day folders are searched. */
function rolloutFile(home: string, threadId: string): string | null {
  const sessions = join(home, 'sessions');
  if (!existsSync(sessions)) return null;
  const desc = (dir: string) => readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  let searched = 0;
  for (const year of desc(sessions)) {
    for (const month of desc(join(sessions, year))) {
      for (const day of desc(join(sessions, year, month))) {
        const dir = join(sessions, year, month, day);
        const match = readdirSync(dir).find((name) => name.startsWith('rollout-') && name.endsWith(`${threadId}.jsonl`));
        if (match) return join(dir, match);
        if (++searched >= 3) return null;
      }
    }
  }
  return null;
}

/** The latest rate-limit snapshot recorded for a Codex thread, or null when Codex recorded none. */
export function readCodexLimits(threadId: string, env: Record<string, string | undefined> = process.env): AgentLimitWindow[] | null {
  if (!/^[A-Za-z0-9-]+$/u.test(threadId)) return null;
  const file = rolloutFile(env['CODEX_HOME'] || join(homedir(), '.codex'), threadId);
  if (!file) return null;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line?.includes('"rate_limits"')) continue;
    try {
      const windows = codexLimitWindows(findRateLimits(JSON.parse(line)));
      if (windows.length > 0) return windows;
    } catch {
      // A partially written last line: keep looking at earlier records.
    }
  }
  return null;
}
