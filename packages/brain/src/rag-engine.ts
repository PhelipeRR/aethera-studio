import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { DatabaseHandle } from '@neuralbridge/database';
import type { EmbeddingProvider } from './embeddings/provider.js';
import { dot, fromBlob, toBlob } from './embeddings/vectors.js';

export interface RagChunk { content: string; symbol: string | null; startLine: number; endLine: number; index: number; }
export interface RagHit extends RagChunk { id: string; projectId: string; path: string; score: number; reference: string; }
/** tooLarge: files over the size limit, left out; limited: the file limit was reached and some files were not looked at. */
export interface IndexReport { indexed: number; skipped: number; removed: number; chunks: number; tooLarge: number; limited: boolean; }
export interface IndexLimits { maxFiles?: number; maxFileBytes?: number; }
export interface RagEmbeddingReport { indexed: number; skipped: number; failed: number; }
interface FtsRow { id: string; projectId: string; path: string; content: string; symbol: string | null; startLine: number; endLine: number; idx: number; rank: number; }
interface SemanticRow { id: string; projectId: string; path: string; content: string; symbol: string | null; startLine: number; endLine: number; idx: number; vector: Buffer; }

const SENSITIVE = /(^|[\\/])(\.env(?:\.|$)|.*\.(pem|key|p12|pfx|secret)$|credentials?(?:\.|$)|secrets?(?:\.|$))/i;
const SUPPORTED = /\.(md|mdx|txt|rst|cs|ts|tsx|js|jsx)$/i;
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'test-results']);

export function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
/** Files that may hold credentials (.env, keys, credentials files): never indexed, their Git diffs omitted. */
export function isSensitivePath(path: string): boolean { return SENSITIVE.test(path); }
export function isIndexablePath(path: string): boolean { return SUPPORTED.test(path) && !SENSITIVE.test(path); }
export function safeProjectPath(root: string, requested: string): string {
  const base = resolve(root); const candidate = resolve(base, requested); const rel = relative(base, candidate);
  if (rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..' + '\\') || candidate === base) throw new Error('path is outside the project root');
  return candidate;
}

function chunksByHeading(lines: string[]): RagChunk[] {
  const result: RagChunk[] = []; let start = 0; let buffer: string[] = [];
  const flush = (end: number) => { const content = buffer.join('\n').trim(); if (content) result.push({ content, symbol: null, startLine: start + 1, endLine: end + 1, index: result.length }); buffer = []; };
  lines.forEach((line, i) => { if (/^#{1,6}\s/.test(line) && buffer.length) flush(i - 1); if (!buffer.length) start = i; buffer.push(line); });
  if (buffer.length) flush(lines.length - 1); return result;
}

function chunksBySymbol(lines: string[], pattern: RegExp): RagChunk[] {
  const starts = lines.map((line, i) => ({ i, match: line.match(pattern) })).filter((x) => x.match);
  if (!starts.length) return chunksByHeading(lines);
  return starts.map((entry, index) => { const end = (starts[index + 1]?.i ?? lines.length) - 1; return { content: lines.slice(entry.i, end + 1).join('\n').trim(), symbol: entry.match?.[1] ?? null, startLine: entry.i + 1, endLine: end + 1, index }; }).filter((x) => x.content);
}

export function chunkSource(path: string, content: string): RagChunk[] {
  const lines = content.split(/\r?\n/);
  if (/\.(md|mdx|txt|rst)$/i.test(path)) return chunksByHeading(lines);
  const pattern = /\.cs$/i.test(path)
    ? /^\s*(?:(?:public|private|internal|protected|static|async|abstract|sealed)\s+)*(?:class|interface|record|struct|enum|void|[\w<>[\],?]+)\s+([\w<>,?]+)\s*[({]/
    : /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([\w$]+)/;
  return chunksBySymbol(lines, pattern);
}

const REMOVAL_BATCH = 25;

export class RagEngine {
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;

  constructor(private readonly handle: DatabaseHandle, limits: IndexLimits = {}) {
    this.maxFiles = limits.maxFiles ?? 5000;
    this.maxFileBytes = limits.maxFileBytes ?? 512 * 1024;
  }

  /** `exclude` lists folders (relative, forward slashes) that belong to another project: each file has one owner. */
  async indexProject(projectId: string, root: string, options: { exclude?: readonly string[] } = {}): Promise<IndexReport> {
    const canonicalRoot = await realpath(root); const ignores = await this.ignoreRules(canonicalRoot);
    const owned = (file: string) => { const rel = relative(canonicalRoot, file).replaceAll('\\', '/'); return !(options.exclude ?? []).some((folder) => rel === folder || rel.startsWith(`${folder}/`)); };
    const report: IndexReport = { indexed: 0, skipped: 0, removed: 0, chunks: 0, tooLarge: 0, limited: false }; const seen = new Set<string>();
    // Bounded: big files (generated, minified, data) are left out, and a huge tree stops at the file limit.
    const sized: string[] = [];
    for (const file of (await this.files(canonicalRoot, ignores)).filter(owned)) {
      if ((await stat(file)).size > this.maxFileBytes) report.tooLarge++;
      else sized.push(file);
    }
    report.limited = sized.length > this.maxFiles;
    const files = sized.slice(0, this.maxFiles);
    for (const file of files) {
      const rel = relative(canonicalRoot, file).replaceAll('\\', '/'); seen.add(rel);
      const content = await readFile(file, 'utf8'); const hash = sha256(content);
      const existing = this.handle.sqlite.prepare('SELECT id, content_hash FROM rag_documents WHERE project_id = ? AND path = ?').get(projectId, rel) as { id: string; content_hash: string } | undefined;
      if (existing?.content_hash === hash) { report.skipped++; continue; }
      const chunks = chunkSource(rel, content);
      this.handle.sqlite.transaction(() => {
        const id = existing?.id ?? randomUUID();
        this.handle.sqlite.prepare("INSERT INTO rag_documents (id, project_id, path, content_hash) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, path) DO UPDATE SET content_hash=excluded.content_hash, version=rag_documents.version+1, indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), status='indexed'").run(id, projectId, rel, hash);
        const current = this.handle.sqlite.prepare('SELECT id FROM rag_documents WHERE project_id = ? AND path = ?').get(projectId, rel) as { id: string };
        this.handle.sqlite.prepare('DELETE FROM rag_chunks WHERE document_id = ?').run(current.id);
        const insert = this.handle.sqlite.prepare('INSERT INTO rag_chunks (id, document_id, project_id, content, symbol, start_line, end_line, chunk_index, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const chunk of chunks) insert.run(randomUUID(), current.id, projectId, chunk.content, chunk.symbol, chunk.startLine, chunk.endLine, chunk.index, sha256(chunk.content));
      })();
      report.indexed++; report.chunks += chunks.length;
    }
    // Only file documents: other sources (git://) are kept by their own indexers.
    const stale = this.handle.sqlite.prepare("SELECT id, path FROM rag_documents WHERE project_id = ? AND path NOT LIKE 'git://%'").all(projectId) as { id: string; path: string }[];
    // With the limit reached, files not looked at are unknown, not gone: keep them.
    const gone = report.limited ? [] : stale.filter((row) => !seen.has(row.path));
    const remove = this.handle.sqlite.prepare('DELETE FROM rag_documents WHERE id = ?');
    // This runs in the app's main process: a large removal in one go would freeze the window.
    for (let start = 0; start < gone.length; start += REMOVAL_BATCH) {
      const batch = gone.slice(start, start + REMOVAL_BATCH);
      this.handle.sqlite.transaction(() => { for (const row of batch) remove.run(row.id); })();
      report.removed += batch.length;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return report;
  }

  /** Stores a document that is not a project file (a commit, a diff), replacing its chunks; same search and embeddings. */
  upsertDocument(projectId: string, path: string, chunks: RagChunk[]): void {
    const hash = sha256(chunks.map((chunk) => chunk.content).join('\n'));
    this.handle.sqlite.transaction(() => {
      this.handle.sqlite.prepare("INSERT INTO rag_documents (id, project_id, path, content_hash) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, path) DO UPDATE SET content_hash=excluded.content_hash, version=rag_documents.version+1, indexed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), status='indexed'").run(randomUUID(), projectId, path, hash);
      const current = this.handle.sqlite.prepare('SELECT id FROM rag_documents WHERE project_id = ? AND path = ?').get(projectId, path) as { id: string };
      this.handle.sqlite.prepare('DELETE FROM rag_chunks WHERE document_id = ?').run(current.id);
      const insert = this.handle.sqlite.prepare('INSERT INTO rag_chunks (id, document_id, project_id, content, symbol, start_line, end_line, chunk_index, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const chunk of chunks) insert.run(randomUUID(), current.id, projectId, chunk.content, chunk.symbol, chunk.startLine, chunk.endLine, chunk.index, sha256(chunk.content));
    })();
  }

  search(projectId: string, query: string, limit = 8): RagHit[] {
    const safe = query.trim().replace(/[^\p{L}\p{N}_ ]/gu, ' ').trim(); if (!safe) return [];
    const match = safe.split(/\s+/).map((term) => '"' + term + '"*').join(' OR ');
    return (this.handle.sqlite.prepare('SELECT c.id, c.project_id AS projectId, d.path, c.content, c.symbol, c.start_line AS startLine, c.end_line AS endLine, c.chunk_index AS idx, bm25(rag_chunks_fts) AS rank FROM rag_chunks_fts JOIN rag_chunks c ON c.rowid = rag_chunks_fts.rowid JOIN rag_documents d ON d.id = c.document_id WHERE c.project_id = ? AND rag_chunks_fts MATCH ? ORDER BY rank LIMIT ?').all(projectId, match, limit) as FtsRow[]).map((row) => ({ id: row.id, projectId: row.projectId, path: row.path, content: row.content, symbol: row.symbol, startLine: row.startLine, endLine: row.endLine, index: row.idx, score: -row.rank, reference: row.path + ':' + row.startLine + '-' + row.endLine }));
  }

  async indexEmbeddings(provider: EmbeddingProvider, projectId?: string): Promise<RagEmbeddingReport> {
    const rows = (this.handle.sqlite.prepare("SELECT c.id, c.content, c.content_hash FROM rag_chunks c LEFT JOIN rag_embeddings e ON e.chunk_id = c.id AND e.model = ? WHERE e.chunk_id IS NULL AND (? IS NULL OR c.project_id = ?)").all(provider.model, projectId ?? null, projectId ?? null) as { id: string; content: string; content_hash: string }[]);
    const result: RagEmbeddingReport = { indexed: 0, skipped: 0, failed: 0 };
    for (const row of rows) {
      try {
        const vector = (await provider.embedPassages([row.content]))[0];
        if (!vector || vector.length !== provider.dim) throw new Error('invalid vector');
        this.handle.sqlite.prepare("INSERT INTO rag_embeddings (chunk_id, model, dim, vector, content_hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chunk_id) DO UPDATE SET model=excluded.model, dim=excluded.dim, vector=excluded.vector, content_hash=excluded.content_hash, created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(row.id, provider.model, vector.length, toBlob(vector), row.content_hash);
        result.indexed++;
      } catch { result.failed++; }
    }
    return result;
  }

  async semanticSearch(provider: EmbeddingProvider, projectId: string, query: string, limit = 8): Promise<RagHit[]> {
    const availability = await provider.availability(); if (!availability.ok) return [];
    const vector = await provider.embedQuery(query);
    const rows = this.handle.sqlite.prepare("SELECT c.id, c.project_id AS projectId, d.path, c.content, c.symbol, c.start_line AS startLine, c.end_line AS endLine, c.chunk_index AS idx, e.vector FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id JOIN rag_embeddings e ON e.chunk_id = c.id WHERE c.project_id = ? AND e.model = ?").all(projectId, provider.model) as SemanticRow[];
    return rows.map((row) => ({ ...row, index: row.idx, score: dot(vector, fromBlob(row.vector)), reference: row.path + ':' + row.startLine + '-' + row.endLine })).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private async files(root: string, ignores: string[]): Promise<string[]> {
    const result: string[] = [];
    const ignored = (rel: string) => ignores.some((rule) => rule.endsWith('/') ? rel.startsWith(rule) : rel === rule || rel.startsWith(rule + '/'));
    const visit = async (dir: string): Promise<void> => { for (const entry of await readdir(dir, { withFileTypes: true })) { const path = resolve(dir, entry.name); const rel = relative(root, path).replaceAll('\\', '/'); if (ignored(rel)) continue; if (entry.isDirectory() && !IGNORED.has(entry.name)) await visit(path); else if (entry.isFile() && isIndexablePath(path)) result.push(path); } };
    await visit(root); return result.sort();
  }

  private async ignoreRules(root: string): Promise<string[]> {
    try { return (await readFile(resolve(root, '.gitignore'), 'utf8')).split(/\r?\n/).map((line) => line.trim().replace(/^\//, '')).filter((line) => line && !line.startsWith('#') && !line.includes('*') && !line.startsWith('!')); } catch { return []; }
  }
}
