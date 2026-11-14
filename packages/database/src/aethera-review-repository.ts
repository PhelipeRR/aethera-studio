import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { aetheraReviewReportRecordSchema, type AetheraReviewReportRecord } from '@neuralbridge/shared';
import type { Db } from './open.js';
import { aetheraReviewReports } from './schema.js';

/** Immutable AP-10 findings bound to a timeline version and hash. */
export class AetheraReviewRepository {
  constructor(private readonly db: Db) {}

  save(input: Omit<AetheraReviewReportRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): AetheraReviewReportRecord {
    const record = aetheraReviewReportRecordSchema.parse({ id: input.id ?? randomUUID(), ...input, createdAt: input.createdAt ?? new Date().toISOString() });
    this.db.insert(aetheraReviewReports).values({ id: record.id, runId: record.runId, timelineVersion: record.timelineVersion, timelineHash: record.timelineHash, dataJson: JSON.stringify(record), createdAt: record.createdAt }).run();
    return record;
  }

  latest(runId: string): AetheraReviewReportRecord | null {
    const row = this.db.select().from(aetheraReviewReports).where(eq(aetheraReviewReports.runId, runId)).orderBy(desc(aetheraReviewReports.createdAt)).get();
    return row ? this.parse(row) : null;
  }

  history(runId: string): AetheraReviewReportRecord[] {
    return this.db.select().from(aetheraReviewReports).where(eq(aetheraReviewReports.runId, runId)).orderBy(desc(aetheraReviewReports.createdAt)).all().map((row) => this.parse(row));
  }

  private parse(row: typeof aetheraReviewReports.$inferSelect): AetheraReviewReportRecord {
    return aetheraReviewReportRecordSchema.parse(JSON.parse(row.dataJson));
  }
}
