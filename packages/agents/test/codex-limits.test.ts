import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codexLimitWindows, readCodexLimits } from '../src/codex-limits.js';

// The shape Codex 0.166 records in its session file (token_count event), trimmed to the fields that matter.
const snapshot = { limit_id: 'codex', primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1794344251 }, secondary: { used_percent: 23, window_minutes: 10080, resets_at: 1794878987 }, credits: { has_credits: false } };

function codexHome(threadId: string, lines: string[]): string {
  const home = mkdtempSync(join(tmpdir(), 'nb-codex-home-'));
  const day = join(home, 'sessions', '2026', '11', '10');
  mkdirSync(day, { recursive: true });
  writeFileSync(join(day, `rollout-2026-11-10T12-57-28-${threadId}.jsonl`), lines.join('\n'));
  return home;
}

describe('Codex usage limits', () => {
  it('maps the five-hour and weekly windows like Claude’s, with the reset time', () => {
    expect(codexLimitWindows(snapshot)).toEqual([
      { id: 'five_hour', utilization: 0.125, resetsAt: new Date(1794344251 * 1000).toISOString(), status: 'allowed' },
      { id: 'seven_day', utilization: 0.23, resetsAt: new Date(1794878987 * 1000).toISOString(), status: 'allowed' },
    ]);
    expect(codexLimitWindows({ primary: { used_percent: 100, window_minutes: 300, resets_at: null } })[0]).toMatchObject({ status: 'rejected', resetsAt: null });
    expect(codexLimitWindows(null)).toEqual([]);
    expect(codexLimitWindows({ primary: { window_minutes: 300 } })).toEqual([]);
  });

  it('reads the latest snapshot recorded for the thread, skipping a half-written last line', () => {
    const thread = '01a1c62d-ba01-7212-896d-4a24ae3ac6a8';
    const older = { ...snapshot, primary: { ...snapshot.primary, used_percent: 1 } };
    const home = codexHome(thread, [
      JSON.stringify({ type: 'session_meta', payload: { id: thread } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: older } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: snapshot } }),
      '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary"',
    ]);
    expect(readCodexLimits(thread, { CODEX_HOME: home })?.[0]?.utilization).toBe(0.125);
  });

  it('returns null when the thread has no file or no snapshot, and refuses unsafe ids', () => {
    const home = codexHome('abc', [JSON.stringify({ type: 'session_meta' })]);
    expect(readCodexLimits('abc', { CODEX_HOME: home })).toBeNull();
    expect(readCodexLimits('missing', { CODEX_HOME: home })).toBeNull();
    expect(readCodexLimits('../escape', { CODEX_HOME: home })).toBeNull();
  });
});
