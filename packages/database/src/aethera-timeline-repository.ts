import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { timelineChangeSchema, timelineDocumentSchema, timelineHash, type TimelineChange, type TimelineDocument } from '@neuralbridge/shared';
import type { Db } from './open.js';
import { aetheraTimelines } from './schema.js';

export type TimelineVersionSource = 'assembled' | 'edit' | 'review' | 'restore';
export type TimelineVersionAuthor = 'user' | 'agent' | 'review' | 'assembler';

export interface TimelineVersion {
  id: string;
  runId: string;
  version: number;
  document: TimelineDocument;
  hash: string;
  source: TimelineVersionSource;
  author: TimelineVersionAuthor;
  change: TimelineChange | null;
  createdAt: string;
}

/** Immutable AP-03 timeline history; a new document version is the only write operation. */
export class AetheraTimelineRepository {
  constructor(private readonly db: Db) {}

  save(input: { runId: string; document: TimelineDocument; source: TimelineVersionSource; author: TimelineVersionAuthor; change?: TimelineChange | null }): TimelineVersion {
    const document = timelineDocumentSchema.parse(input.document);
    const change = input.change === undefined || input.change === null ? null : timelineChangeSchema.parse(input.change);
    const current = this.db.select({ version: aetheraTimelines.version }).from(aetheraTimelines).where(eq(aetheraTimelines.runId, input.runId)).orderBy(desc(aetheraTimelines.version)).get()?.version ?? 0;
    if (document.version !== current + 1) throw new Error(`conflict: a timeline esperava a versão ${current + 1}, recebeu ${document.version}.`);
    if (change && (change.fromVersion !== current || change.toVersion !== document.version)) throw new Error('invalid: a mudança da timeline não corresponde à versão anterior e à nova versão.');
    const record: TimelineVersion = { id: randomUUID(), runId: input.runId, version: document.version, document, hash: timelineHash(document), source: input.source, author: input.author, change, createdAt: new Date().toISOString() };
    this.db.insert(aetheraTimelines).values({ id: record.id, runId: record.runId, version: record.version, documentJson: JSON.stringify(record.document), hash: record.hash, source: record.source, author: record.author, changeJson: record.change ? JSON.stringify(record.change) : null, createdAt: record.createdAt }).run();
    return record;
  }

  latest(runId: string): TimelineVersion | null {
    const row = this.db.select().from(aetheraTimelines).where(eq(aetheraTimelines.runId, runId)).orderBy(desc(aetheraTimelines.version)).get();
    return row ? this.parse(row) : null;
  }

  get(runId: string, version: number): TimelineVersion | null {
    const row = this.db.select().from(aetheraTimelines).where(eq(aetheraTimelines.runId, runId)).all().find((candidate) => candidate.version === version);
    return row ? this.parse(row) : null;
  }

  history(runId: string): TimelineVersion[] {
    return this.db.select().from(aetheraTimelines).where(eq(aetheraTimelines.runId, runId)).orderBy(desc(aetheraTimelines.version)).all().map((row) => this.parse(row));
  }

  private parse(row: typeof aetheraTimelines.$inferSelect): TimelineVersion {
    return {
      id: row.id, runId: row.runId, version: row.version, document: timelineDocumentSchema.parse(JSON.parse(row.documentJson)), hash: row.hash,
      source: row.source === 'edit' || row.source === 'review' || row.source === 'restore' ? row.source : 'assembled',
      author: row.author === 'user' || row.author === 'agent' || row.author === 'review' ? row.author : 'assembler',
      change: row.changeJson ? timelineChangeSchema.parse(JSON.parse(row.changeJson)) : null, createdAt: row.createdAt,
    };
  }
}
