import { describe, expect, it } from 'vitest';
import { newId } from '../src/ids.js';

describe('newId', () => {
  it('produces 26-character Crockford base32 ULIDs', () => {
    expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('does not repeat within a large batch', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(ids.size).toBe(5000);
  });

  it('sorts by creation time', () => {
    const earlier = newId(Date.UTC(2026, 0, 1));
    const later = newId(Date.UTC(2026, 9, 28));
    expect(earlier < later).toBe(true);
    expect(earlier.slice(0, 10)).not.toBe(later.slice(0, 10));
  });
});
