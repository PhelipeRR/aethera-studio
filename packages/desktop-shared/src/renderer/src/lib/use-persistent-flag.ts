import { useCallback, useState } from 'react';

// Per-window layout preferences (collapsed panels). Browser storage survives restarts in Electron's
// userData; it can still be unavailable, so every access is guarded and the default always works.

function read(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

export function usePersistentFlag(key: string, fallback = false): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback));
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Not persisted this time; the layout still changes.
      }
    },
    [key],
  );
  return [value, update];
}
