import { describe, expect, it } from 'vitest';
import { visibleRange } from '../src/renderer/src/components/performance/virtualRange';

describe('VirtualList', () => {
  it('keeps only the viewport and overscan range visible', () => {
    expect(visibleRange(1000, 500, 200, 50, 2)).toEqual({ start: 8, end: 16 });
    expect(visibleRange(3, 0, 400, 50)).toEqual({ start: 0, end: 3 });
  });
});
