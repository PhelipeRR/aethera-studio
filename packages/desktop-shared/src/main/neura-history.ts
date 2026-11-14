import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const MAX_TURNS = 6;
const turnSchema = z.strictObject({ request: z.string().trim().min(1).max(4_000), reply: z.string().trim().min(1).max(4_000) });
const historySchema = z.array(turnSchema).max(MAX_TURNS);
export type NeuraConversationTurn = z.infer<typeof turnSchema>;

/** Small, local-only history for general chat. It is bounded and can be erased with Neura's clear-history action. */
export class JsonNeuraHistory {
  constructor(private readonly file: string) {}

  load(): NeuraConversationTurn[] {
    if (!existsSync(this.file)) return [];
    try {
      const parsed = historySchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  save(turns: readonly NeuraConversationTurn[]): void {
    const bounded = historySchema.parse(turns.slice(-MAX_TURNS));
    writeFileSync(this.file, JSON.stringify(bounded), { encoding: 'utf8', mode: 0o600 });
  }

  clear(): void {
    try { unlinkSync(this.file); } catch { /* already absent */ }
  }
}
