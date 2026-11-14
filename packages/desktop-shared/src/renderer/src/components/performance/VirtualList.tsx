import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { visibleRange } from './virtualRange';

export function VirtualList<T>({ items, itemHeight, renderItem, ariaLabel, className = '' }: { items: T[]; itemHeight: number; renderItem: (item: T, index: number) => ReactNode; ariaLabel: string; className?: string }) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 480 });
  const range = useMemo(() => visibleRange(items.length, viewport.scrollTop, viewport.height, itemHeight), [items.length, itemHeight, viewport]);
  useEffect(() => {
    const update = () => setViewport((value) => ({ ...value, height: window.innerHeight > 0 ? Math.max(240, Math.min(640, window.innerHeight - 240)) : 480 }));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  // Read scrollTop while the event is being dispatched: React runs the updater later, when currentTarget is already null.
  return <ul aria-label={ariaLabel} className={`max-h-[40rem] overflow-y-auto divide-y divide-border/70 ${className}`} onScroll={(event) => { const scrollTop = event.currentTarget.scrollTop; setViewport((value) => ({ ...value, scrollTop })); }}>
    <li aria-hidden="true" className="pointer-events-none border-0" style={{ height: range.start * itemHeight }} />
    {/* Every row is exactly itemHeight tall: the spacers above and below assume it, so a taller row would make the window drift. */}
    {items.slice(range.start, range.end).map((item, offset) => <li key={range.start + offset} style={{ height: itemHeight }}>{renderItem(item, range.start + offset)}</li>)}
    <li aria-hidden="true" className="pointer-events-none border-0" style={{ height: Math.max(0, (items.length - range.end) * itemHeight) }} />
  </ul>;
}
