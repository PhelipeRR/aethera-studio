import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IPC_CAPABILITIES, IpcChannel, ipcCapabilityOf, type IpcChannelName } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';

const preload = readFileSync(resolve(import.meta.dirname, '../src/preload/index.ts'), 'utf8');

/** Which top-level `window.neuralbridge.<namespace>` each IpcChannel key is invoked from. */
function namespacesByChannelKey(): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  let namespace: string | null = null;
  for (const line of preload.split(/\r?\n/)) {
    const opened = /^ {2}(\w+): \{/.exec(line);
    if (opened) namespace = opened[1] ?? null;
    for (const [, key] of line.matchAll(/IpcChannel\.(\w+)/g)) {
      if (!key || !namespace) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)?.add(namespace);
    }
  }
  return owners;
}

describe('preload facade grouped by capability', () => {
  it('invokes every channel from a namespace of its own capability', () => {
    const owners = namespacesByChannelKey();
    const misplaced: string[] = [];
    for (const [key, channel] of Object.entries(IpcChannel) as Array<[string, IpcChannelName]>) {
      const capability = ipcCapabilityOf(channel);
      const allowed: readonly string[] = capability ? IPC_CAPABILITIES[capability].preload : [];
      const used = owners.get(key);
      if (!used) misplaced.push(`${channel}: not exposed`);
      else for (const namespace of used) if (!allowed.includes(namespace)) misplaced.push(`${channel}: in ${namespace}`);
    }
    expect(misplaced).toEqual([]);
  });
});
