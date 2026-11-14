import type { AgentId } from '@neuralbridge/shared';
import { extractCommonConversationLearnings, extractHistoryLearnings, readHistory, type HistoryCheckpoint, type HistoryRecord, type HistorySource } from './history-sync.js';

export interface HistorySyncCheckpointStore {
  get(source: HistorySource): HistoryCheckpoint | undefined;
  set(source: HistorySource, checkpoint: HistoryCheckpoint): void;
}

export interface HistorySyncOptions {
  sources: HistorySource[];
  checkpoints: HistorySyncCheckpointStore;
  /** Reads an authorized transcript without interpreting or executing its content. */
  readTranscript?: (record: HistoryRecord) => Promise<string | null>;
  propose: (proposals: unknown[], context: { projectId: string | null; agent: AgentId; sourceId: string }) => Promise<void>;
  maxRecords?: number;
  signal?: AbortSignal;
}

export interface HistorySyncResult {
  sources: number;
  records: number;
  changed: number;
  proposals: number;
  errors: number;
}

/** Incremental, bounded synchronization. It treats every transcript as untrusted data. */
export async function synchronizeHistories(options: HistorySyncOptions): Promise<HistorySyncResult> {
  const result: HistorySyncResult = { sources: options.sources.length, records: 0, changed: 0, proposals: 0, errors: 0 };
  const limit = Math.max(1, Math.min(options.maxRecords ?? 500, 10_000));
  for (const source of options.sources) {
    try {
      if (options.signal?.aborted) break;
      const previous = options.checkpoints.get(source);
      const batch = await readHistory(source, previous);
      for (const record of batch.records.slice(0, limit)) {
        if (options.signal?.aborted) break;
        if (previous?.seenHashes?.includes(record.hash)) continue;
        result.records++;
        const transcript = options.readTranscript ? await options.readTranscript(record) : null;
        if (!transcript) continue;
        const explicit = extractHistoryLearnings(transcript);
        const withoutExplicit = transcript.replace(/```neuralbridge-learnings[\s\S]*?```/g, '');
        const proposals = [...explicit, ...extractCommonConversationLearnings(withoutExplicit)].slice(0, 5);
        if (!proposals.length) continue;
        await options.propose(proposals, { projectId: record.projectId, agent: record.agent, sourceId: record.id });
        result.changed++;
        result.proposals += proposals.length;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (!options.signal?.aborted) options.checkpoints.set(source, batch.checkpoint);
    } catch {
      result.errors++;
    }
  }
  return result;
}

