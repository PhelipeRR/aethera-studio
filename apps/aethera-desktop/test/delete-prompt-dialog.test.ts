import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DeletePromptDialog,
  PROMPT_DELETE_CONFIRM_MESSAGE,
  PROMPT_DELETE_LABEL_MAX_CHARS,
  promptDeleteLabel,
} from '../../../packages/desktop-shared/src/renderer/src/features/video/DeletePromptDialog.js';

function bigPrompt(length: number): string {
  const unit = 'Documentário sobre a história dos games de luta dos anos 90 com narração épica. ';
  let out = '';
  while (out.length < length) out += unit;
  return out.slice(0, length);
}

const PROMPT_20K = bigPrompt(20_000);

function render(label: string, extra: Partial<Parameters<typeof DeletePromptDialog>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(DeletePromptDialog, { label, onCancel: vi.fn(), onConfirm: vi.fn(), ...extra }),
  );
}

describe('promptDeleteLabel', () => {
  it('prefers the title when present', () => {
    expect(promptDeleteLabel({ title: '  Meu vídeo  ', prompt: PROMPT_20K })).toBe('Meu vídeo');
  });

  it('uses the first 100 characters of the prompt followed by an ellipsis', () => {
    const label = promptDeleteLabel({ prompt: PROMPT_20K });
    expect(label.endsWith('…')).toBe(true);
    expect(Array.from(label).length).toBeLessThanOrEqual(PROMPT_DELETE_LABEL_MAX_CHARS + 1);
    expect(PROMPT_20K.startsWith(label.slice(0, -1))).toBe(true);
  });

  it('keeps short prompts intact and collapses whitespace', () => {
    expect(promptDeleteLabel({ prompt: 'Curto\n\n  prompt' })).toBe('Curto prompt');
  });

  it('clips a huge title and never splits surrogate pairs', () => {
    const label = promptDeleteLabel({ title: '🎬'.repeat(5_000) });
    expect(Array.from(label)).toHaveLength(PROMPT_DELETE_LABEL_MAX_CHARS + 1);
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('falls back to the id, then to a generic label', () => {
    expect(promptDeleteLabel({ prompt: '   ', fallback: 'proj_1' })).toBe('proj_1');
    expect(promptDeleteLabel({})).toBe('Prompt sem título');
  });
});

describe('DeletePromptDialog with a 20.000-character prompt', () => {
  const label = promptDeleteLabel({ prompt: PROMPT_20K });
  const html = render(label);

  it('never renders the full prompt', () => {
    expect(html).not.toContain(PROMPT_20K);
    expect(html).not.toContain(PROMPT_20K.slice(0, 200));
    expect(html.length).toBeLessThan(5_000);
  });

  it('shows the required message and the truncated label', () => {
    expect(html).toContain(PROMPT_DELETE_CONFIRM_MESSAGE);
    expect(html).toContain('data-testid="delete-prompt-label"');
    expect(html).toContain('…');
  });

  it('has fixed, compact dimensions with the buttons outside the scroll area', () => {
    expect(html).toMatch(/data-testid="delete-prompt-dialog"[^>]*class="[^"]*max-w-md[^"]*"/);
    expect(html).toMatch(/max-h-\[min\(22rem,calc\(100vh-2rem\)\)\]/);
    expect(html).toContain('truncate');
    const footer = html.indexOf('shrink-0 justify-end');
    const scrollArea = html.indexOf('overflow-y-auto');
    expect(scrollArea).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(scrollArea);
  });

  it('keeps Cancelar and a destructive Excluir button', () => {
    expect(html).toContain('>Cancelar</button>');
    expect(html).toMatch(/data-variant="destructive"[^>]*bg-rose-600[^>]*>.*Excluir<\/button>/s);
    expect(html).toContain('role="alertdialog"');
  });

  it('clips a raw oversized label passed directly', () => {
    const raw = render(PROMPT_20K);
    expect(raw).not.toContain(PROMPT_20K);
    expect(raw).not.toContain(PROMPT_20K.slice(0, 200));
  });

  it('shows pending state on the destructive button', () => {
    const pending = render(label, { pending: true });
    expect(pending).toContain('Excluindo...');
  });
});
