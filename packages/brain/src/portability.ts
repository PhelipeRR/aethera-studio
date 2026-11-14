import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { accessLog, learningCandidates, links, memories, memoryTags, memoryVersions, projects, tags, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { FINAL_TASK_STATUSES, MEMORY_TYPES, SOURCE_KINDS, TRUST_STATES, type ImportResult, type RetentionResult } from '@neuralbridge/shared';
import { z } from 'zod';
import { BrainService } from './brain-service.js';

const FORMAT = 'neuralbridge-brain';
const VERSION = 1;

const exportedMemorySchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  content: z.string().max(100_000),
  type: z.enum(MEMORY_TYPES),
  projectId: z.string().nullable(),
  trust: z.enum(TRUST_STATES),
  source: z.object({ kind: z.enum(SOURCE_KINDS), ref: z.string().nullable() }),
  tags: z.array(z.string().min(1).max(40)).max(20),
  /** Explicit links only: [[wiki links]] are rebuilt from the content. */
  links: z.array(z.object({ target: z.string().min(1).max(200), relation: z.string().min(1).max(40) })).max(50),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExportedMemory = z.infer<typeof exportedMemorySchema>;

const dumpSchema = z.object({
  format: z.literal(FORMAT),
  version: z.number().int(),
  exportedAt: z.string(),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  memories: z.array(exportedMemorySchema),
});
export type BrainExport = z.infer<typeof dumpSchema>;

/** Every live memory, with what is needed to rebuild it elsewhere (spec: export in JSON). */
export function exportBrain(handle: DatabaseHandle): BrainExport {
  const db = handle.db;
  const rows = db.select().from(memories).where(isNull(memories.deletedAt)).orderBy(asc(memories.seq)).all();
  const ids = rows.map((row) => row.id);
  const tagRows = ids.length
    ? db.select({ memoryId: memoryTags.memoryId, name: tags.name }).from(memoryTags).innerJoin(tags, eq(tags.id, memoryTags.tagId)).where(inArray(memoryTags.memoryId, ids)).all()
    : [];
  const linkRows = ids.length
    ? db.select().from(links).where(and(inArray(links.sourceId, ids), eq(links.origin, 'explicit'))).orderBy(asc(links.id)).all()
    : [];
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    projects: db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.id)).all(),
    memories: rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      projectId: row.projectId,
      trust: row.trust,
      source: { kind: row.sourceKind, ref: row.sourceRef },
      tags: tagRows.filter((tag) => tag.memoryId === row.id).map((tag) => tag.name).sort(),
      links: linkRows.filter((link) => link.sourceId === row.id).map((link) => ({ target: link.targetTitle, relation: link.relation })),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  };
}

/**
 * Adds the memories of an export, keeping their ids, dates, origin and trust. Never overwrites: a memory
 * whose id or title already exists here, or whose project is not registered here, is skipped and reported.
 */
export function importBrain(handle: DatabaseHandle, data: unknown): ImportResult {
  const header = z.object({ format: z.literal(FORMAT), version: z.number() }).safeParse(data);
  if (!header.success) throw new Error('O arquivo não é uma exportação do Singularity.');
  if (header.data.version !== VERSION) throw new Error(`Exportação na versão ${header.data.version}; esta versão do Singularity lê a versão ${VERSION}.`);
  const parsed = dumpSchema.safeParse(data);
  if (!parsed.success) throw new Error(`A exportação do Singularity está incompleta ou danificada (${parsed.error.issues[0]?.path.join('.') ?? ''}).`);

  const db = handle.db;
  const brain = new BrainService(handle);
  const skipped: ImportResult['skipped'] = [];
  return handle.sqlite
    .transaction((): ImportResult => {
      const imported: ExportedMemory[] = [];
      for (const memory of parsed.data.memories) {
        const reason = skipReason(handle, memory);
        if (reason) {
          skipped.push({ title: memory.title, reason });
          continue;
        }
        db.insert(memories)
          .values({
            id: memory.id,
            title: memory.title,
            content: memory.content,
            type: memory.type,
            projectId: memory.projectId,
            trust: memory.trust,
            sourceKind: memory.source.kind,
            sourceRef: memory.source.ref,
            version: memory.version,
            embeddingStatus: 'pending',
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
          })
          .run();
        for (const name of new Set(memory.tags)) {
          db.insert(tags).values({ name }).onConflictDoNothing().run();
          const tag = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
          if (tag) db.insert(memoryTags).values({ memoryId: memory.id, tagId: tag.id }).run();
        }
        db.insert(memoryVersions)
          .values({ memoryId: memory.id, version: memory.version, title: memory.title, content: memory.content, type: memory.type, tags: JSON.stringify([...memory.tags].sort()), changedBy: memory.source.kind, createdAt: memory.updatedAt })
          .run();
        imported.push(memory);
      }
      // Links last, once every imported title exists.
      for (const memory of imported) brain.rebuildLinks(memory.id, memory.links);
      return { imported: imported.length, skipped };
    })
    .immediate();
}

function skipReason(handle: DatabaseHandle, memory: ExportedMemory): string | null {
  const db = handle.db;
  if (db.select({ id: memories.id }).from(memories).where(eq(memories.id, memory.id)).get()) return 'Já importada.';
  if (memory.projectId && !db.select({ id: projects.id }).from(projects).where(eq(projects.id, memory.projectId)).get()) {
    return `O projeto "${memory.projectId}" não está registrado aqui.`;
  }
  const sameTitle = db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        isNull(memories.deletedAt),
        memory.projectId ? eq(memories.projectId, memory.projectId) : isNull(memories.projectId),
        eq(sql`lower(${memories.title})`, memory.title.toLowerCase()),
      ),
    )
    .get();
  return sameTitle ? 'Já existe uma memória com este título.' : null;
}

function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'memoria'
  );
}

/** One Markdown file per memory, in a folder per project, with the metadata as front matter (spec: export in Markdown). */
export function toMarkdownFiles(dump: BrainExport): { path: string; content: string }[] {
  const used = new Set<string>();
  return dump.memories.map((memory) => {
    const folder = memory.projectId ? slug(memory.projectId) : 'global';
    let path = `${folder}/${slug(memory.title)}.md`;
    if (used.has(path)) path = `${folder}/${slug(memory.title)}-${memory.id.toLowerCase()}.md`;
    used.add(path);
    // JSON strings are valid YAML scalars, so any title or tag is quoted safely.
    const front = [
      ['id', memory.id],
      ['title', memory.title],
      ['type', memory.type],
      ['project', memory.projectId],
      ['tags', memory.tags],
      ['trust', memory.trust],
      ['source', memory.source.kind],
      ['links', memory.links],
      ['created', memory.createdAt],
      ['updated', memory.updatedAt],
    ]
      .map(([key, value]) => `${String(key)}: ${JSON.stringify(value)}`)
      .join('\n');
    return { path, content: `---\n${front}\n---\n\n${memory.content.trimEnd()}\n` };
  });
}

const DAY = 86_400_000;

/**
 * Retention policy from Brain Settings: memories deleted more than `trashDays` ago are erased for good,
 * finished tasks older than `taskDays` go with their steps and logs, and old access records go too.
 * Decided learning proposals follow the trash. A limit of 0 keeps everything of that kind.
 */
export function applyRetention(handle: DatabaseHandle, limits: { trashDays: number; taskDays: number }, now: Date = new Date()): RetentionResult {
  const db = handle.db;
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  return handle.sqlite
    .transaction((): RetentionResult => {
      let memoriesErased = 0;
      let tasksErased = 0;
      if (limits.trashDays > 0) {
        memoriesErased = db.delete(memories).where(lt(memories.deletedAt, cutoff(limits.trashDays))).run().changes;
        db.delete(learningCandidates)
          .where(and(notInArray(learningCandidates.status, ['pending']), lt(learningCandidates.decidedAt, cutoff(limits.trashDays))))
          .run();
      }
      if (limits.taskDays > 0) {
        const before = cutoff(limits.taskDays);
        tasksErased = db
          .delete(tasks)
          .where(and(inArray(tasks.status, [...FINAL_TASK_STATUSES]), or(lt(tasks.finishedAt, before), and(isNull(tasks.finishedAt), lt(tasks.createdAt, before)))))
          .run().changes;
        db.delete(accessLog).where(lt(accessLog.at, before)).run();
      }
      return { memoriesErased, tasksErased };
    })
    .immediate();
}
