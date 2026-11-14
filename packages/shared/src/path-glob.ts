/** Small, non-regex glob matcher for trusted workflow path policies. */
export function matchesPathGlob(path: string, pattern: string): boolean {
  const memo = new Map<string, boolean>();
  const match = (i: number, j: number): boolean => {
    const key = `${i}:${j}`; const cached = memo.get(key); if (cached !== undefined) return cached;
    let result: boolean;
    if (j === pattern.length) result = i === path.length;
    else if (pattern[j] === '*') result = pattern[j + 1] === '*' ? match(i, j + 2) || (i < path.length && match(i + 1, j)) : match(i, j + 1) || (i < path.length && path[i] !== '/' && match(i + 1, j));
    else result = i < path.length && (pattern[j] === '?' || pattern[j] === path[i]) && match(i + 1, j + 1);
    memo.set(key, result); return result;
  };
  return match(0, 0);
}

export function matchesAnyPathGlob(path: string, patterns: readonly string[]): boolean { return patterns.some((pattern) => matchesPathGlob(path, pattern)); }
