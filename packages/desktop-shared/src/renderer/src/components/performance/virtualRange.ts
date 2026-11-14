export function visibleRange(total: number, scrollTop: number, viewportHeight: number, itemHeight: number, overscan = 4) {
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan);
  return { start, end };
}
