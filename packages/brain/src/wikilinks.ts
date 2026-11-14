import { LIMITS } from '@neuralbridge/shared';

const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /`[^`\n]*`/g;
const WIKILINK = /\[\[([^[\]\n|]*)(?:\|[^[\]\n]*)?\]\]/g;

/**
 * Titles referenced as [[Title]] or [[Title|alias]], in order of first appearance, deduplicated
 * case-insensitively. Code (fenced blocks and inline spans) is skipped: [[nodiscard]] is C++, not a link.
 */
export function parseWikiLinks(markdown: string): string[] {
  const titles = new Map<string, string>();
  let fence: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const marker = FENCE.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    for (const match of line.replace(INLINE_CODE, '').matchAll(WIKILINK)) {
      const title = (match[1] ?? '').trim();
      if (title.length === 0 || title.length > LIMITS.titleLength) continue;
      const key = title.toLowerCase();
      if (!titles.has(key)) titles.set(key, title);
    }
  }
  return [...titles.values()];
}
