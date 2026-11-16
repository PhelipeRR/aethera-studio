/**
 * Process-local GPU lease. ComfyUI has its own queue, but serialising Aethera requests prevents two large latent
 * allocations from being submitted together on 8 GB cards and makes VRAM measurements reproducible.
 */
export class GpuGenerationLease {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
