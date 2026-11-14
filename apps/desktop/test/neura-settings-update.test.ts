import { describe, expect, it } from 'vitest';
import { createSerializedNeuraSettingsUpdater } from '../src/renderer/src/features/neura/neura-settings-update';

describe('Neura settings update queue', () => {
  it('serializes rapid consent changes so every patch is applied to the latest state', async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const update = async (patch: Record<string, boolean>) => {
      calls.push(Object.keys(patch)[0] ?? '');
      if (calls.length === 1) await first;
      return { ...patch };
    };
    const queued = createSerializedNeuraSettingsUpdater(update);

    const firstResult = queued({ screenConsent: true });
    const secondResult = queued({ locationConsent: true });

    await Promise.resolve();
    expect(calls).toEqual(['screenConsent']);
    releaseFirst();
    await expect(firstResult).resolves.toEqual({ screenConsent: true });
    await expect(secondResult).resolves.toEqual({ locationConsent: true });
    expect(calls).toEqual(['screenConsent', 'locationConsent']);
  });
});
