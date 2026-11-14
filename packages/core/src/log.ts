import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { redactSecrets } from '@neuralbridge/agents/redact';

/*
 * CORE-03: structured logs, one JSON object per line. Only flat primitive fields are written; every string goes
 * through the same secret redaction as task events and is capped. Fields whose name suggests a credential are dropped
 * whole, and absolute paths are reduced to their last segment (they carry the Windows user name).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

const MAX_STRING = 500;
const SENSITIVE_KEY = /(token|secret|password|passwd|pwd|authorization|cookie|api[_-]?key|credential|env)/i;
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\/)[^\s"']+/g;

export function sanitizeField(key: string, value: string | number | boolean | null | undefined): string | number | boolean | null | undefined {
  if (SENSITIVE_KEY.test(key)) return '[removido]';
  if (typeof value !== 'string') return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  const withoutPaths = value.replace(ABSOLUTE_PATH, (path) => `…/${basename(path.replace(/[\\/]+$/, ''))}`);
  const redacted = redactSecrets(withoutPaths);
  return redacted.length > MAX_STRING ? `${redacted.slice(0, MAX_STRING)}…` : redacted;
}

export function formatLogLine(level: LogLevel, event: string, fields: LogFields, at: Date): string {
  const clean: Record<string, unknown> = { ts: at.toISOString(), level, event: event.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 60) };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) || key in clean) continue;
    clean[key] = sanitizeField(key, value);
  }
  return JSON.stringify(clean);
}

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
}

/** Appends to a file (rotated once at maxBytes) and mirrors warnings and errors to stderr for the supervisor. */
export function createFileLogger(file: string, options: { maxBytes?: number; mirror?: (line: string) => void; now?: () => Date } = {}): Logger {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const now = options.now ?? (() => new Date());
  let ready = false;
  return {
    log(level, event, fields = {}) {
      const line = formatLogLine(level, event, fields, now());
      try {
        if (!ready) { mkdirSync(dirname(file), { recursive: true }); ready = true; }
        try { if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`); } catch { /* first write */ }
        appendFileSync(file, `${line}\n`);
      } catch { /* logging must never take the Core down */ }
      if (level === 'warn' || level === 'error') options.mirror?.(line);
    },
  };
}
