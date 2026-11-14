import { describe, expect, it } from 'vitest';
import { codeContent } from '../src/renderer/src/features/brain/markdown-code';

describe('MarkdownView code blocks', () => {
  it('preserves multiline code content for copying', () => {
    const content = 'line one\nline two\n';

    expect(codeContent(content)).toBe(content);
  });
});
