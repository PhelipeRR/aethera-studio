/** Process-wide FIFO lease. Active work retains its lease until it actually stops, even on cancellation. */
export class VisualWorkScheduler {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error('cancelled: visual work interrupted.');
    const previous = this.tail;
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    this.tail = previous.then(() => turn);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error('cancelled: visual work interrupted.')); signal?.addEventListener('abort', abort, { once: true }); });
    try { await Promise.race([previous, cancelled]); if (signal?.aborted) throw new Error('cancelled: visual work interrupted.'); return await work(); }
    finally { signal?.removeEventListener('abort', abort); release(); }
  }
}
export const visualRenderScheduler = new VisualWorkScheduler();
export const visionGpuScheduler = new VisualWorkScheduler();

/** Same lease order as indexing: render waits for preprocessing and for timed-out providers still winding down. */
export function runExclusiveRender<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return visualRenderScheduler.run(() => visionGpuScheduler.run(work, signal), signal);
}
