import { describe, expect, it } from 'vitest';
import { GpuGenerationLease } from '../src/gpu-generation-lease.js';

describe('GpuGenerationLease', () => {
  it('serializes GPU jobs and releases the slot after success or failure', async () => {
    const lease = new GpuGenerationLease();
    const events: string[] = [];
    const first = lease.run(async () => {
      events.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push('first-end');
      return 'first';
    });
    const second = lease.run(async () => {
      events.push('second-start');
      events.push('second-end');
      return 'second';
    });
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);

    await expect(lease.run(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(lease.run(async () => 'after-failure')).resolves.toBe('after-failure');
  });
});
