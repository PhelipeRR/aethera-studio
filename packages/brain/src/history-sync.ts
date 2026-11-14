import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { LEARNINGS_FENCE, type AgentId } from '@neuralbridge/shared';
import Database from 'better-sqlite3';
import { findSecrets, maskSecrets } from './secrets.js';

export type HistorySource = { agent: AgentId; kind: 'claude-history' | 'codex-index'; path: string };
export type HistoryCheckpoint = { size: number; mtimeMs: number; hash: string; processed: number; seenHashes?: string[] };
export type HistoryRecord = { id: string; agent: AgentId; projectId: string | null; updatedAt: string | null; text: string; hash: string };
export type TranscriptReadLimits = { maxBytes?: number; maxTextBytes?: number };

const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 100_000;
const MAX_RECORDS = 100;

/**
 * Reads a Claude/Codex JSONL transcript as inert text. Unknown event shapes are
 * ignored; no field is interpreted as a command, tool call, or instruction.
 */
export function readTranscriptJsonl(path: string, limits: TranscriptReadLimits = {}): string {
  const maxBytes = Math.min(limits.maxBytes ?? 10 * 1024 * 1024, 50 * 1024 * 1024);
  const maxText = Math.min(limits.maxTextBytes ?? 500_000, 2_000_000);
  const raw = readFileSync(path).subarray(0, maxBytes).toString('utf8');
  const output: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    try {
      const value: unknown = JSON.parse(line);
      collectTranscriptText(value, output, maxText);
      if (output.join('\n').length >= maxText) break;
    } catch { /* incomplete or non-JSON lines are ignored */ }
  }
  return output.join('\n').slice(0, maxText);
}

function collectTranscriptText(value: unknown, output: string[], maxText: number): void {
  if (typeof value === 'string') return;
  if (Array.isArray(value)) { for (const item of value) collectTranscriptText(item, output, maxText); return; }
  if (typeof value !== 'object' || value === null || output.join('\n').length >= maxText) return;
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'content', 'message']) {
    const item = record[key];
    if (typeof item === 'string' && item.trim()) output.push(item.slice(0, maxText));
    else if (item && typeof item === 'object') collectTranscriptText(item, output, maxText);
  }
}

export function discoverHistorySources(home: string): HistorySource[] {
  const candidates: HistorySource[] = [
    { agent: 'claude', kind: 'claude-history', path: join(home, '.claude', 'history.jsonl') },
    ...(existsSync(join(home, '.codex', 'thread_history_1.sqlite'))
      ? [{ agent: 'codex' as const, kind: 'codex-index' as const, path: join(home, '.codex', 'thread_history_1.sqlite') }]
      : [{ agent: 'codex' as const, kind: 'codex-index' as const, path: join(home, '.codex', 'session_index.jsonl') }]),
  ];
  return candidates.filter((source) => existsSync(source.path));
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_TEXT_BYTES);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join('\n').slice(0, MAX_TEXT_BYTES);
  return '';
}

function recordFrom(source: HistorySource, value: Record<string, unknown>): HistoryRecord | null {
  const id = typeof value['sessionId'] === 'string' ? value['sessionId'] : typeof value['id'] === 'string' ? value['id'] : null;
  if (!id) return null;
  const text = source.agent === 'claude' ? textOf(value['display'] ?? value['pastedContents']) : textOf(value['thread_name']);
  const updatedAt = typeof value['timestamp'] === 'string' ? value['timestamp'] : typeof value['updated_at'] === 'string' ? value['updated_at'] : null;
  const projectId = typeof value['project'] === 'string' && value['project'].trim() ? value['project'].trim() : null;
  return { id, agent: source.agent, projectId, updatedAt, text, hash: digest(JSON.stringify(value)) };
}

/** Reads JSONL as data only. It never interprets a line as a command or sends it externally. */
export async function readHistory(source: HistorySource, checkpoint?: HistoryCheckpoint): Promise<{ records: HistoryRecord[]; checkpoint: HistoryCheckpoint; reset: boolean }> {
  if (source.agent === 'codex' && source.path.toLowerCase().endsWith('.sqlite')) return readCodexSqlite(source, checkpoint);
  const info = statSync(source.path);
  const reset = !checkpoint || info.size < checkpoint.size || (info.size === checkpoint.size && info.mtimeMs !== checkpoint.mtimeMs);
  const records: HistoryRecord[] = [];
  const hash = createHash('sha256');
  let processed = 0;
  const input = createReadStream(source.path, { encoding: 'utf8', ...(reset ? {} : { start: checkpoint.size }) });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) continue;
    hash.update(line);
    processed++;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === 'object' && value !== null) {
        const record = recordFrom(source, value as Record<string, unknown>);
        if (record) records.push(record);
      }
    } catch {
      // A partially written last line is ignored and will be retried after the file changes.
    }
    if (records.length >= MAX_RECORDS) break;
  }
  return { records, checkpoint: { size: info.size, mtimeMs: info.mtimeMs, hash: hash.digest('hex'), processed, seenHashes: records.map((record) => record.hash).slice(-MAX_RECORDS) }, reset };
}

function readCodexSqlite(source: HistorySource, checkpoint?: HistoryCheckpoint): { records: HistoryRecord[]; checkpoint: HistoryCheckpoint; reset: boolean } {
  const info = statSync(source.path);
  const reset = !checkpoint || info.size < checkpoint.size || (info.size === checkpoint.size && info.mtimeMs !== checkpoint.mtimeMs);
  const records: HistoryRecord[] = [];
  const db = new Database(source.path, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare("select name from sqlite_master where type='table'").all() as Array<{ name: string }>;
    if (!tables.some((table) => table.name === 'thread_items')) return { records, checkpoint: { size: info.size, mtimeMs: info.mtimeMs, hash: '', processed: 0 }, reset };
    const columns = db.prepare('pragma table_info(thread_items)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'thread_id' && columns.some((item) => item.name === 'item_json'))) return { records, checkpoint: { size: info.size, mtimeMs: info.mtimeMs, hash: '', processed: 0 }, reset };
    const offset = reset ? 0 : checkpoint?.processed ?? 0;
    const rows = db.prepare('select thread_id, item_json, created_at_ms from thread_items order by created_at_ms asc limit ? offset ?').all(MAX_RECORDS, offset) as Array<{ thread_id: string; item_json: string; created_at_ms: number }>;
    for (const row of rows) {
      const hash = digest(row.thread_id + '\0' + row.item_json);
      if (checkpoint?.seenHashes?.includes(hash)) continue;
      records.push({ id: row.thread_id, agent: 'codex', projectId: null, updatedAt: new Date(row.created_at_ms).toISOString(), text: row.item_json.slice(0, MAX_TEXT_BYTES), hash });
    }
    return { records, checkpoint: { size: info.size, mtimeMs: info.mtimeMs, hash: digest(String(info.size) + String(info.mtimeMs)), processed: offset + rows.length, seenHashes: records.map((record) => record.hash).slice(-MAX_RECORDS) }, reset };
  } finally { db.close(); }
}

/** Extracts only the explicit NeuralBridge learning contract from trusted parser output. */
export function extractHistoryLearnings(text: string): unknown[] {
  const fence = '```';
  const pattern = new RegExp('(?:^|\\n)' + fence + LEARNINGS_FENCE + '[^\\n]*\\n([\\s\\S]*?)(?:' + fence + '|$)', 'g');
  /*
  const fence = '```';
  const pattern = new RegExp(`\\n?\\`\\`\\`${LEARNINGS_FENCE}[^\\n]*\\n([\\s\\S]*?)(?:\\`\\`\\`|$)`, 'g');
  */
  const result: unknown[] = [];
  for (const match of text.matchAll(pattern)) {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? '');
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        const raw = JSON.stringify(item);
        if (findSecrets(raw).length) continue;
        result.push(JSON.parse(maskSecrets(raw)));
      }
    } catch {
      // Invalid or incomplete history content is not a learning proposal.
    }
  }
  return result.slice(0, 5);
}

/** Conservative local extraction for ordinary conversations. Evidence words are required. */
export function extractCommonConversationLearnings(text: string): unknown[] {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^\s*[-*#>]+\s*/, '').trim()).filter(Boolean);
  const out: unknown[] = [];
  const confirmed = /\b(validat(?:ed|ed)|confirmed|verified|passed|tests? passed|testes? passaram|foi corrigid[oa]|corrigido com sucesso|causa raiz|root cause)\b/i;
  const probable = /\b(maybe|possibly|probably|provavelmente|talvez|pode ser|likely|provável)\b/i;
  const unresolved = /\b(still fails?|not resolved|unresolved|ainda falha|não resolvido|sem solução|blocked|bloquead[oa])\b/i;
  for (const line of lines) {
    if (line.length < 20 || line.length > 1200 || findSecrets(line).length) continue;
    const status = confirmed.test(line) ? 'confirmed' : probable.test(line) ? 'probable' : unresolved.test(line) ? 'unresolved' : null;
    if (!status) continue;
    const type = unresolved.test(line) ? 'bug' : /decision|decisão|architecture|arquitetura|pattern|padrão/i.test(line) ? 'decision' : 'learning';
    const prefix = status === 'confirmed' ? 'Confirmado' : status === 'probable' ? 'Provável' : 'Não resolvido';
    out.push({ title: `${prefix}: ${line.slice(0, 100)}`, content: `[${status}] ${line}`, type, tags: ['history-sync', status] });
    if (out.length >= 5) break;
  }
  return out;
}
