// Keyword snippets from the main process wrap matches in these control characters (see main/brain.ts):
// unlike [ and ], they never occur in memory text.
const OPEN = '\u0002';
const CLOSE = '\u0003';

/** Markdown syntax that reads as noise in a one-line preview. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[\[([^[\]\n|]+)\|([^[\]\n]+)\]\]/g, '$2')
    .replace(/\[\[([^[\]\n|]+)\]\]/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/```[^\n]*|`/g, '')
    .replace(/[*_]{1,3}([^*_\n]+)[*_]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a snippet into plain and matched parts, cleaned of Markdown. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  const pattern = new RegExp(`${OPEN}([^${CLOSE}]*)${CLOSE}`, 'g');
  let last = 0;
  for (const found of snippet.matchAll(pattern)) {
    if (found.index > last) parts.push({ text: snippet.slice(last, found.index), match: false });
    parts.push({ text: found[1] ?? '', match: true });
    last = found.index + found[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  // Clean each plain piece separately so the matches survive, keeping the spaces at its edges.
  return parts
    .map((part) => (part.match ? part : { match: false, text: `${/^\s/.test(part.text) ? ' ' : ''}${plainText(part.text)}${/\s$/.test(part.text) ? ' ' : ''}` }))
    .filter((part) => part.text.trim().length > 0);
}
