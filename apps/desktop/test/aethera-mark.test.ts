import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AETHERA_BLADES, AetheraMark, AetheraSignature } from '../src/renderer/src/app/AetheraMark';
import { AetheraNavIcon } from '../src/renderer/src/app/aethera-nav-icon';

// R1: the Aethera mark in its three variants, the menu icon and the signature.
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe('Aethera mark', () => {
  it('draws six blades in the full mark and none in the small and mono marks', () => {
    expect(AETHERA_BLADES).toHaveLength(6);
    expect(html(createElement(AetheraMark, { variant: 'full' })).match(/<path /g)).toHaveLength(6);
    expect(html(createElement(AetheraMark, { variant: 'small' }))).not.toContain('<path ');
    expect(html(createElement(AetheraMark, { variant: 'mono' }))).not.toContain('<path ');
  });

  it('uses only the Singularity gold and the Void horizon black, and the mono mark follows currentColor', () => {
    const full = html(createElement(AetheraMark, { variant: 'full' }));
    expect(full).toContain('#d9b875');
    expect(full).toContain('#010304');
    expect(full).not.toMatch(/#(a890ff|8b6cff|6e4bff|5b3fd9)/i);
    const mono = html(createElement(AetheraMark, { variant: 'mono' }));
    expect(mono).not.toMatch(/#[0-9a-f]{6}/i);
    expect(mono).toContain('currentColor');
  });

  it('keeps gradient ids unique when several marks are on screen', () => {
    const markup = html(createElement('div', null, createElement(AetheraMark), createElement(AetheraMark)));
    const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is decorative by default and an image with a name when labelled', () => {
    expect(html(createElement(AetheraMark))).toContain('aria-hidden="true"');
    const labelled = html(createElement(AetheraMark, { label: 'Aethera' }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Aethera"');
  });

  it('gives the menu a 24-grid line icon in currentColor', () => {
    const icon = html(createElement(AetheraNavIcon, { className: 'size-4', 'aria-hidden': 'true' }));
    expect(icon).toContain('viewBox="0 0 24 24"');
    expect(icon).toContain('stroke="currentColor"');
    expect(icon).toContain('class="size-4"');
  });

  it('renders the signature as a heading named Aethera with the studio line', () => {
    const signature = html(createElement(AetheraSignature));
    expect(signature).toMatch(/<h1[^>]*>Aethera<\/h1>/);
    expect(signature).toContain('AI Cinematic Studio');
    expect(html(createElement(AetheraSignature, { as: 'p' }))).not.toContain('<h1');
  });
});
