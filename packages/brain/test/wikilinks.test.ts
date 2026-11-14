import { describe, expect, it } from 'vitest';
import { parseWikiLinks } from '../src/wikilinks.js';

describe('parseWikiLinks', () => {
  it('finds plain and aliased links in order of appearance', () => {
    expect(parseWikiLinks('Use [[Redis]] as described in [[Cache strategy|the cache note]].')).toEqual(['Redis', 'Cache strategy']);
  });

  it('trims titles and deduplicates without regard to case', () => {
    expect(parseWikiLinks('[[ Redis ]] and [[redis]] and [[REDIS|again]]')).toEqual(['Redis']);
  });

  it('ignores links inside fenced and inline code', () => {
    const markdown = ['See [[Real link]].', '```cpp', '[[nodiscard]] int f();', '```', 'Inline `[[maybe_unused]]` too.', '~~~', '[[Tilde fence]]', '~~~'].join('\n');
    expect(parseWikiLinks(markdown)).toEqual(['Real link']);
  });

  it('ignores empty, multi-line and over-long titles', () => {
    expect(parseWikiLinks(`[[]] [[   ]] [[a\nb]] [[${'x'.repeat(201)}]] [[ok]]`)).toEqual(['ok']);
  });

  it('returns nothing for plain text', () => {
    expect(parseWikiLinks('No links [here] or [[unclosed')).toEqual([]);
  });
});
