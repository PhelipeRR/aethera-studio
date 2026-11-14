import type { DatabaseHandle } from '@neuralbridge/database';
import type { CommitRelations, GitHistory, GitIndexReport, GitSearchHit, ProfileMemoryRef } from '@neuralbridge/shared';
import { isSensitivePath, RagEngine, type RagChunk } from './rag-engine.js';
import { findSecrets } from './secrets.js';

// Phase 25: Git history as RAG documents, so the existing search and embeddings find past solutions.
// One document per commit (git://<hash>: subject, body, author, date, files) and one per changed file
// (git://<hash>/<path>: the hunks, with the line they start at). Lines that look like credentials are
// replaced, sensitive files are never stored, and a commit already indexed is never read again.

const COMMIT_PREFIX = 'git://';
const REDACTED = '[linha removida: possível segredo]';

/** Commits of the project already in the index (their message document). */
export function knownCommits(handle: DatabaseHandle, projectId: string): Set<string> {
  const rows = handle.sqlite.prepare("SELECT path FROM rag_documents WHERE project_id = ? AND path LIKE 'git://%' AND path NOT LIKE 'git://%/%'").all(projectId) as { path: string }[];
  return new Set(rows.map((row) => row.path.slice(COMMIT_PREFIX.length)));
}

function redact(text: string): string {
  return text
    .split('\n')
    .map((line) => (findSecrets(line).length ? REDACTED : line))
    .join('\n');
}

export function indexGitHistory(handle: DatabaseHandle, projectId: string, history: GitHistory): GitIndexReport {
  const rag = new RagEngine(handle);
  const known = knownCommits(handle, projectId);
  let commits = 0;
  let files = 0;
  let alreadyKnown = 0;
  for (const commit of history.commits) {
    if (known.has(commit.hash)) {
      alreadyKnown += 1;
      continue;
    }
    const paths = commit.files.map((file) => (file.previousPath ? `${file.previousPath} → ${file.path}` : file.path));
    const message: RagChunk = {
      content: redact([`commit ${commit.hash.slice(0, 12)}`, `Autor: ${commit.author}`, `Data: ${commit.date}`, commit.subject, commit.body, `Arquivos: ${paths.join(', ')}`].filter(Boolean).join('\n')),
      symbol: commit.subject.slice(0, 200),
      startLine: 1,
      endLine: 1,
      index: 0,
    };
    rag.upsertDocument(projectId, `${COMMIT_PREFIX}${commit.hash}`, [message]);
    for (const file of commit.files) {
      if (file.binary || !file.patch) continue;
      const content = isSensitivePath(file.path) ? '(conteúdo omitido: arquivo sensível)' : redact(file.patch);
      const line = file.line ?? 1;
      rag.upsertDocument(projectId, `${COMMIT_PREFIX}${commit.hash}/${file.path}`, [
        { content: `${commit.subject}\n${file.path}${file.truncated ? ' (diff cortado)' : ''}\n${content}`, symbol: file.path, startLine: line, endLine: line, index: 0 },
      ]);
      files += 1;
    }
    commits += 1;
  }
  return { commits, files, alreadyKnown, limited: history.limited, branches: history.branches.length };
}

/** Searches the project's indexed commits with the RAG keyword search; never another project's. */
export function searchGitHistory(handle: DatabaseHandle, projectId: string, query: string, limit = 10): GitSearchHit[] {
  const hits = new RagEngine(handle).search(projectId, query, limit * 4).filter((hit) => hit.path.startsWith(COMMIT_PREFIX));
  const meta = (hash: string) => {
    const row = handle.sqlite.prepare("SELECT c.content FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE d.project_id = ? AND d.path = ?").get(projectId, `${COMMIT_PREFIX}${hash}`) as { content: string } | undefined;
    const lines = row?.content.split('\n') ?? [];
    return { author: lines[1]?.replace(/^Autor: /, '') ?? '', date: lines[2]?.replace(/^Data: /, '') ?? '', subject: lines[3] ?? '' };
  };
  return hits.slice(0, limit).map((hit) => {
    const rest = hit.path.slice(COMMIT_PREFIX.length);
    const slash = rest.indexOf('/');
    const hash = slash < 0 ? rest : rest.slice(0, slash);
    return { hash, file: slash < 0 ? null : rest.slice(slash + 1), ...meta(hash), reference: hit.reference, excerpt: hit.content.slice(0, 400) };
  });
}

/** What else NeuralBridge knows about a commit's files: memories citing them, and tasks that changed them within 3 days. */
export function commitRelations(handle: DatabaseHandle, projectId: string, hash: string): CommitRelations {
  const prefix = `${COMMIT_PREFIX}${hash}/`;
  const files = (handle.sqlite.prepare('SELECT path FROM rag_documents WHERE project_id = ? AND path LIKE ?').all(projectId, `${prefix}%`) as { path: string }[]).map((row) => row.path.slice(prefix.length)).sort();
  if (!files.length) return { files, memories: [], tasks: [] };
  const date = (handle.sqlite.prepare("SELECT c.content FROM rag_chunks c JOIN rag_documents d ON d.id = c.document_id WHERE d.project_id = ? AND d.path = ?").get(projectId, `${COMMIT_PREFIX}${hash}`) as { content: string } | undefined)?.content.split('\n')[2]?.replace(/^Data: /, '');
  const sources = handle.sqlite
    .prepare("SELECT m.id, m.title, m.confidence, s.ref FROM memory_sources s JOIN memories m ON m.id = s.memory_id WHERE m.project_id = ? AND m.deleted_at IS NULL AND s.kind = 'file'")
    .all(projectId) as { id: string; title: string; confidence: ProfileMemoryRef['confidence']; ref: string }[];
  const memories = new Map<string, ProfileMemoryRef>();
  for (const source of sources) if (files.includes(source.ref.replace(/:\d+(?:-\d+)?$/, ''))) memories.set(source.id, { id: source.id, title: source.title, confidence: source.confidence });
  const when = date ? new Date(date).getTime() : NaN;
  const steps = handle.sqlite
    .prepare("SELECT t.id, t.prompt, t.created_at AS createdAt, s.files_changed AS files FROM task_steps s JOIN tasks t ON t.id = s.task_id WHERE t.project_id = ?")
    .all(projectId) as { id: string; prompt: string; createdAt: string; files: string | null }[];
  const tasks = new Map<string, { id: string; prompt: string }>();
  for (const step of steps) {
    let changed: string[];
    try {
      changed = JSON.parse(step.files ?? '[]') as string[];
    } catch {
      changed = [];
    }
    const near = Number.isNaN(when) || Math.abs(new Date(step.createdAt).getTime() - when) <= 3 * 86_400_000;
    if (near && changed.some((file) => files.includes(file))) tasks.set(step.id, { id: step.id, prompt: step.prompt });
  }
  return { files, memories: [...memories.values()].sort((a, b) => a.title.localeCompare(b.title)), tasks: [...tasks.values()] };
}
