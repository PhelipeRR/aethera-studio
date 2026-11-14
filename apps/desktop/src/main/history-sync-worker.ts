import { parentPort } from 'node:worker_threads';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractCommonConversationLearnings, extractHistoryLearnings, readHistory, readTranscriptJsonl, type HistoryCheckpoint, type HistorySource } from '@neuralbridge/brain';

type Input = { home: string; sources: HistorySource[]; checkpoints: Record<string, HistoryCheckpoint | undefined>; maxRecords: number };
function findClaude(home: string, id: string): string | null {
  const root = join(home, '.claude', 'projects'); if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length) { const current = stack.pop(); if (!current) continue; for (const entry of readdirSync(current, { withFileTypes: true })) { const path = join(current, entry.name); if (entry.isDirectory()) stack.push(path); else if (entry.isFile() && entry.name === `${id}.jsonl`) return path; } }
  return null;
}
parentPort?.on('message', async (input: Input) => {
  const output: Array<{ source: HistorySource; checkpoint: HistoryCheckpoint; records: Array<{ id: string; agent: 'claude' | 'codex'; projectId: string | null; proposals: unknown[] }> }> = [];
  for (const source of input.sources) {
    try {
      const batch = await readHistory(source, input.checkpoints[source.path]);
      const records = [];
      for (const record of batch.records.slice(0, input.maxRecords)) {
        const path = record.agent === 'claude' ? findClaude(input.home, record.id) : null;
        const transcript = path ? readTranscriptJsonl(path) : record.agent === 'codex' ? record.text : null;
        if (!transcript) continue;
        const explicit = extractHistoryLearnings(transcript);
        const ordinary = extractCommonConversationLearnings(transcript.replace(/```neuralbridge-learnings[\s\S]*?```/g, ''));
        const proposals = [...explicit, ...ordinary].slice(0, 5);
        records.push({ id: record.id, agent: record.agent, projectId: record.projectId, proposals });
      }
      output.push({ source, checkpoint: batch.checkpoint, records });
    } catch { output.push({ source, checkpoint: input.checkpoints[source.path] ?? { size: 0, mtimeMs: 0, hash: '', processed: 0 }, records: [] }); }
  }
  parentPort?.postMessage(output);
});
