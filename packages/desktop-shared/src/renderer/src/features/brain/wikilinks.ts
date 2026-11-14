/** Pseudo-protocol for links between memories; MarkdownView resolves it to an in-app route. */
export const MEMORY_LINK_PREFIX = 'nb-memory:';

const FENCE = /^\s*(```|~~~)/;
const CODE_SPAN = /(`[^`\n]*`)/;
const WIKILINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
const escapeText = (text: string) => text.replace(/([\\[\]*_`])/g, '\\$1');

/**
 * Rewrites [[Title]] / [[Title|alias]] as Markdown links so react-markdown can render them,
 * leaving fenced and inline code alone (as the brain's parser does).
 */
export function linkifyWikiLinks(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (marker) {
        if (fence === null) fence = marker;
        else if (fence === marker) fence = null;
        return line;
      }
      if (fence !== null) return line;
      return line
        .split(CODE_SPAN)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(WIKILINK, (_match, title: string, alias?: string) => {
                const target = title.trim();
                return `[${escapeText((alias ?? title).trim())}](${MEMORY_LINK_PREFIX}${encodeURIComponent(target)})`;
              }),
        )
        .join('');
    })
    .join('\n');
}
