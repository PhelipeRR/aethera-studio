import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { DatabaseHandle } from '@neuralbridge/database';
import { maskSecrets } from './secrets.js';

const MAX_CONVERSATION_BYTES = 200_000;
const MAX_THREADS_PER_RUN = 50_000;

export type ImportedConversation = {
  id: string; agent: 'claude' | 'codex'; externalId: string; title: string; content: string;
  projectId: string | null; projectPath: string | null; association: 'associated' | 'unassociated';
  updatedAt: string | null; importedAt: string;
};

export type HistoryImportResult = { found: number; imported: number; updated: number; unchanged: number; associated: number; unassociated: number; redacted: number; errors: number };

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function safeText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return ['text', 'content', 'message', 'result', 'summary'].map((key) => safeText(record[key])).filter(Boolean).join('\n');
}
function redact(text: string): { text: string; redacted: boolean } {
  const masked = maskSecrets(text);
  return { text: masked, redacted: masked !== text };
}
function canonical(value: string): string { return normalize(resolve(value)).toLowerCase(); }
function cleanWindowsPath(value: string): string { return value.replace(/^\\\\\?\\/, ''); }

function projectForPath(handle: DatabaseHandle, path: string | null): { id: string | null; root: string | null } {
  if (!path) return { id: null, root: null };
  const target = canonical(path);
  const rows = handle.sqlite.prepare('select id, root_path from projects').all() as Array<{ id: string; root_path: string }>;
  const found = rows.find((row) => target === canonical(row.root_path) || target.startsWith(`${canonical(row.root_path)}\\`));
  return found ? { id: found.id, root: found.root_path } : { id: null, root: path };
}

function titleFromIndex(value: Record<string, unknown>): string {
  const title = typeof value.thread_name === 'string' && value.thread_name.trim() ? value.thread_name.trim() : 'Conversa Codex importada';
  return title.slice(0, 240);
}

/** Imports local Codex conversations without modifying the source database or executing its content. */
export async function importCodexConversations(handle: DatabaseHandle, home: string): Promise<HistoryImportResult> {
  const result: HistoryImportResult = { found: 0, imported: 0, updated: 0, unchanged: 0, associated: 0, unassociated: 0, redacted: 0, errors: 0 };
  const source = join(home, '.codex', 'thread_history_1.sqlite');
  if (!existsSync(source)) return result;
  const index = new Map<string, { title: string; updatedAt: string | null }>();
  const indexPath = join(home, '.codex', 'session_index.jsonl');
  if (existsSync(indexPath)) {
    const raw = readFileSync(indexPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (typeof value.id !== 'string') continue;
        index.set(value.id, { title: titleFromIndex(value), updatedAt: typeof value.updated_at === 'string' ? value.updated_at : null });
      } catch { /* malformed index lines are ignored */ }
    }
  }
  const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
  const statePath = join(home, '.codex', 'state_5.sqlite');
  const stateDb = existsSync(statePath) ? new Database(statePath, { readonly: true, fileMustExist: true }) : null;
  try {
    const schema = sourceDb.prepare('pragma table_info(thread_items)').all() as Array<{ name: string }>;
    if (!schema.some((column) => column.name === 'thread_id') || !schema.some((column) => column.name === 'item_json')) return result;
    const projectPaths = new Map<string, { name: string; path: string }>();
    const threadLocations = new Map<string, string>();
    if (stateDb) {
      try {
        const stateTables = stateDb.prepare('select name from sqlite_master where type = ?').all('table') as Array<{ name: string }>;
        if (stateTables.some((table) => table.name === 'projects') && stateTables.some((table) => table.name === 'project_roots')) {
          const names = new Map((stateDb.prepare('select id, name from projects').all() as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
          for (const root of stateDb.prepare('select project_id, path from project_roots').all() as Array<{ project_id: string; path: string }>) {
            const path = cleanWindowsPath(root.path);
            if (path && !projectPaths.has(root.project_id)) projectPaths.set(root.project_id, { name: names.get(root.project_id) ?? 'Projeto Codex', path });
          }
        }
        if (stateTables.some((table) => table.name === 'threads')) {
          for (const thread of stateDb.prepare('select id, project_id, cwd from threads').all() as Array<{ id: string; project_id: string | null; cwd: string | null }>) {
            const root = thread.project_id ? projectPaths.get(thread.project_id)?.path : null;
            if (root) threadLocations.set(thread.id, root);
            else if (thread.cwd) threadLocations.set(thread.id, cleanWindowsPath(thread.cwd));
          }
        }
      } catch { /* state schema varies by Codex version; history import remains usable */ }
    }
    const projectByRoot = new Map<string, string>();
    for (const project of projectPaths.values()) {
      if (!existsSync(project.path)) continue;
      const existingProject = handle.sqlite.prepare('select id from projects where lower(root_path) = lower(?)').get(project.path) as { id: string } | undefined;
      if (existingProject) { projectByRoot.set(canonical(project.path), existingProject.id); continue; }
      const id = `codex-project:${digest(canonical(project.path)).slice(0, 24)}`;
      handle.sqlite.prepare("insert or ignore into projects (id, name, root_path, is_private, preferred_agent, permission_level, allowed_commands, rules) values (?, ?, ?, 0, 'auto', 'standard', '[]', '')").run(id, project.name, project.path);
      projectByRoot.set(canonical(project.path), id);
    }
    const threads = sourceDb.prepare('select distinct thread_id from thread_items order by thread_id limit ?').all(MAX_THREADS_PER_RUN) as Array<{ thread_id: string }>;
    result.found = threads.length;
    const existing = handle.sqlite.prepare('select id, source_hash from imported_conversations where agent = ? and external_id = ?');
    const upsert = handle.sqlite.prepare(`insert into imported_conversations (id, agent, external_id, title, content, source_path, source_hash, project_id, project_path, association, updated_at) values (?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(agent, external_id) do update set title=excluded.title, content=excluded.content, source_path=excluded.source_path, source_hash=excluded.source_hash, project_id=excluded.project_id, project_path=excluded.project_path, association=excluded.association, updated_at=excluded.updated_at`);
    const query = sourceDb.prepare('select item_json, created_at_ms from thread_items where thread_id = ? order by created_at_ms asc');
    const write = handle.sqlite.transaction((rows: Array<{ id: string; title: string; content: string; hash: string; updatedAt: string | null; projectId: string | null; projectPath: string | null; association: string }>) => {
      for (const row of rows) upsert.run(row.id, row.id, row.title, row.content, source, row.hash, row.projectId, row.projectPath, row.association, row.updatedAt);
    });
    let batch: Array<{ id: string; title: string; content: string; hash: string; updatedAt: string | null; projectId: string | null; projectPath: string | null; association: string }> = [];
    for (const thread of threads) {
      try {
        const items = query.all(thread.thread_id) as Array<{ item_json: string; created_at_ms: number }>;
        const content = items.map((item) => { try { return safeText(JSON.parse(item.item_json)); } catch { return ''; } }).filter(Boolean).join('\n').slice(0, MAX_CONVERSATION_BYTES);
        if (!content) continue;
        const safe = redact(content);
        if (safe.redacted) result.redacted++;
        const meta = index.get(thread.thread_id);
        const rawLocation = threadLocations.get(thread.thread_id) ?? null;
        const projectId = rawLocation ? projectByRoot.get(canonical(rawLocation)) ?? projectForPath(handle, rawLocation).id : null;
        const location = { id: projectId, root: rawLocation };
        const hash = digest(thread.thread_id + '\0' + safe.text);
        const old = existing.get('codex', `imported:codex:${thread.thread_id}`) as { id: string; source_hash: string } | undefined;
        if (old?.source_hash === hash) {
          if (location.id) handle.sqlite.prepare('update imported_conversations set project_id = ?, project_path = ?, association = ? where id = ?').run(location.id, location.root, 'associated', old.id);
          result.unchanged++;
          continue;
        }
        const lastItem = items.at(-1);
        batch.push({ id: `imported:codex:${thread.thread_id}`, title: meta?.title ?? 'Conversa Codex importada', content: safe.text, hash, updatedAt: meta?.updatedAt ?? (lastItem ? new Date(lastItem.created_at_ms).toISOString() : null), projectId: location.id, projectPath: location.root, association: location.id ? 'associated' : 'unassociated' });
        if (old) result.updated++;
        else result.imported++;
        if (batch.length >= 100) { write(batch); batch = []; }
      } catch { result.errors++; }
    }
    if (batch.length) write(batch);
    result.associated = Number((handle.sqlite.prepare("select count(*) as count from imported_conversations where agent='codex' and association='associated'").get() as { count: number }).count);
    result.unassociated = Number((handle.sqlite.prepare("select count(*) as count from imported_conversations where agent='codex' and association='unassociated'").get() as { count: number }).count);
  } finally { stateDb?.close(); sourceDb.close(); }
  return result;
}
