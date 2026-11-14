import { describe, expect, it } from 'vitest';
import { seriesPaths, summary } from '../src/renderer/src/components/ui/chart-model.js';
import { bits, bytes, celsius, megahertz, niceMax, percent, rate, share } from '../src/renderer/src/features/monitoring/format.js';

describe('monitoring formatting', () => {
  it('formats real values and shows a dash for missing readings', () => {
    expect(percent(42.4)).toBe('42%');
    expect(percent(null)).toBe('—');
    expect(bytes(31.1 * 1024 ** 3)).toBe('31,1 GB');
    expect(bytes(512)).toBe('512 B');
    expect(rate(2 * 1024 * 1024)).toBe('2 MB/s');
    expect(bits(1e9)).toBe('1 Gbit/s');
    expect(bits(0)).toBe('—');
    expect(megahertz(4370)).toBe('4,4 GHz');
    expect(celsius(41.01)).toBe('41 °C');
    expect(share(5, 20)).toBe(25);
    expect(share(5, 0)).toBeNull();
  });

  it('scales charts to a readable maximum above the peak', () => {
    expect(niceMax([0.3, 0.9])).toBe(1);
    expect(niceMax([3_400_000])).toBe(5_000_000);
    expect(niceMax([null, null], 64)).toBe(100);
  });
});

describe('chart paths', () => {
  it('breaks the line where there was no reading and anchors new samples to the right edge', () => {
    const paths = seriesPaths([10, null, 50, 100], 100, 300, 60, 4);
    expect(paths.line.match(/M/g)?.length).toBe(2);
    expect(paths.line.startsWith('M0.0,54.0')).toBe(true);
    expect(paths.line.endsWith('L300.0,0.0')).toBe(true);
    const partial = seriesPaths([20], 100, 300, 60, 4);
    expect(partial.line).toBe('M300.0,48.0');
  });

  it('summarises only real values', () => {
    expect(summary([null, 2, 4, null])).toEqual({ last: 4, min: 2, max: 4, average: 3 });
    expect(summary([null])).toEqual({ last: null, min: null, max: null, average: null });
  });
});
