import { describe, expect, it } from 'vitest';
import { errorMessage, formatWhen } from '../src/renderer/src/features/brain/format.js';
import { plainText, snippetParts } from '../src/renderer/src/features/brain/snippet.js';
import { linkifyWikiLinks, MEMORY_LINK_PREFIX } from '../src/renderer/src/features/brain/wikilinks.js';

describe('linkifyWikiLinks', () => {
  it('turns [[Title]] and [[Title|alias]] into internal links', () => {
    expect(linkifyWikiLinks('Use [[Redis]] and [[Cache strategy|the cache note]].')).toBe(
      `Use [Redis](${MEMORY_LINK_PREFIX}Redis) and [the cache note](${MEMORY_LINK_PREFIX}Cache%20strategy).`,
    );
  });

  it('leaves code untouched', () => {
    const markdown = ['```cpp', '[[nodiscard]] int f();', '```', 'Inline `[[maybe_unused]]` and [[Real]].'].join('\n');
    expect(linkifyWikiLinks(markdown)).toBe(['```cpp', '[[nodiscard]] int f();', '```', `Inline \`[[maybe_unused]]\` and [Real](${MEMORY_LINK_PREFIX}Real).`].join('\n'));
  });

  it('escapes characters that would break the link text', () => {
    expect(linkifyWikiLinks('[[a]b]]')).toBe('[[a]b]]');
    expect(linkifyWikiLinks('[[Tipo *forte*]]')).toBe(`[Tipo \\*forte\\*](${MEMORY_LINK_PREFIX}Tipo%20*forte*)`);
  });
});

describe('formatting', () => {
  it('shows IPC errors without the Electron wrapper and the error code', () => {
    expect(errorMessage(new Error("Error invoking remote method 'brain:store': Error: conflict: A memory titled \"X\" already exists here."))).toBe(
      'A memory titled "X" already exists here.',
    );
    expect(errorMessage(new Error("Error invoking remote method 'brain:store': IpcRejectedError: Invalid payload for brain:store"))).toBe(
      'Os dados enviados são inválidos.',
    );
    expect(errorMessage('boom')).toBe('boom');
  });

  it('formats dates in Brazilian Portuguese', () => {
    expect(formatWhen('2026-10-28T15:04:00.000Z', 'America/Sao_Paulo')).toBe('28 de out. de 2026, 12:04');
  });
});

describe('search snippets', () => {
  it('cleans Markdown noise from previews', () => {
    expect(plainText('## Regra\nVer [[Pool de conexões]] e [[Índices|índices]].\n- revisar `SQL`')).toBe('Regra Ver Pool de conexões e índices. revisar SQL');
  });

  it('splits highlighted matches marked with control characters, even next to [[links]]', () => {
    expect(snippetParts('Ver [[Pool]] e \u0002migração\u0003 aplicada')).toEqual([
      { text: 'Ver Pool e ', match: false },
      { text: 'migração', match: true },
      { text: ' aplicada', match: false },
    ]);
    expect(snippetParts('sem destaque')).toEqual([{ text: 'sem destaque', match: false }]);
  });
});
