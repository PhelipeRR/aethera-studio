import type { ProductionStageContext } from '../velix-production.js';

/** What one item of a Studio stage (a game, an asset, a segment) produced. A skipped item is final, not a failure. */
export type ItemOutcome<R> = { status: 'done'; result: R } | { status: 'skipped'; reason: string };

type CheckpointContext = Pick<ProductionStageContext, 'state' | 'saveState' | 'progress' | 'signal'>;

/**
 * Runs the items of a stage one by one and saves the stage state after each, so a failure, a pause or a restart
 * resumes at the first unfinished item: finished items are never run again and their artifacts are not duplicated.
 * A failing item throws (the stage fails and stays retryable); a cancelled stage stops at the next item boundary.
 */
export async function runCheckpointedItems<T extends { id: string }, R>(context: CheckpointContext, items: readonly T[], work: (item: T) => Promise<ItemOutcome<R>>): Promise<Record<string, ItemOutcome<R>>> {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error('invalid: itens duplicados na etapa.');
  const saved = (context.state['items'] ?? {}) as Record<string, ItemOutcome<R>>;
  const outcomes: Record<string, ItemOutcome<R>> = Object.fromEntries(Object.entries(saved).filter(([id]) => ids.includes(id)));
  const total = Math.max(1, items.length);
  for (const item of items) {
    if (outcomes[item.id]) continue;
    if (context.signal.aborted) throw new Error('cancelled: a etapa foi interrompida.');
    outcomes[item.id] = await work(item);
    context.state['items'] = outcomes;
    context.saveState({ ...context.state, items: outcomes });
    context.progress(Object.keys(outcomes).length / total);
  }
  return outcomes;
}
