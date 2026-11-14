import { useCallback, useEffect, useState } from 'react';

// Like usePersistentFlag, for a choice among fixed options. Unknown stored values fall back to the default.

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export function usePersistentChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState(() => read(key, allowed, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Not persisted this time; the view still changes.
      }
    },
    [key],
  );
  return [value, update];
}

/** Follows the system's reduced-motion preference live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}
