import { useSyncExternalStore } from 'react';

// Rollback switch of lote 50.06: which 3D view the Memory tabs show. Both routes keep working either way
// (#/memory/galaxy and #/memory/brain); this only picks the tab and the default. Stored locally, read live by
// every component, so changing it in Settings updates the tabs without a restart or a new build.

export const MEMORY_VISUALIZATIONS = ['galaxy', 'brain3d'] as const;
export type MemoryVisualization = (typeof MEMORY_VISUALIZATIONS)[number];
export const MEMORY_VISUALIZATION_KEY = 'nb.memory.visualization';
const EVENT = 'nb:memory-visualization';

function read(): MemoryVisualization {
  try {
    const value = window.localStorage.getItem(MEMORY_VISUALIZATION_KEY);
    return value === 'brain3d' ? 'brain3d' : 'galaxy';
  } catch {
    return 'galaxy';
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function setMemoryVisualization(next: MemoryVisualization): void {
  try {
    window.localStorage.setItem(MEMORY_VISUALIZATION_KEY, next);
  } catch {
    // Not persisted; the event still updates this session.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useMemoryVisualization(): MemoryVisualization {
  return useSyncExternalStore(subscribe, read, () => 'galaxy');
}
