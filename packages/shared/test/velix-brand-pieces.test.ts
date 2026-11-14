import { describe, expect, it } from 'vitest';
import { BANNER_SAFE_AREA, BRAND_PIECES, brandPieceDataUrl, escapeSvgText, renderBrandPiece } from '../src/velix-brand-pieces.js';
import { generateBrandDirections, type BrandIdentity } from '../src/velix-channel.js';

const identity = (): BrandIdentity => { const first = generateBrandDirections('AI Tools & Business Automation')[0]; if (!first) throw new Error('fixture'); return first; };

describe('Velix brand pieces', () => {
  it('renders every piece at its YouTube size, deterministically', () => {
    for (const piece of BRAND_PIECES) {
      const svg = renderBrandPiece(identity(), piece.kind);
      expect(svg).toContain(`width="${piece.width}" height="${piece.height}"`);
      expect(renderBrandPiece(identity(), piece.kind)).toBe(svg);
    }
  });

  it('escapes names and taglines so typed text never becomes markup', () => {
    const svg = renderBrandPiece({ ...identity(), name: '<script>alert(1)</script>', tagline: 'A & "B"' }, 'banner');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A &amp; &quot;B&quot;');
    expect(svg).not.toMatch(/href|<image|<foreignObject|on\w+=/u);
    expect(escapeSvgText(`'`)).toBe('&#39;');
  });

  it('keeps the banner name and symbol inside the area every device shows', () => {
    const svg = renderBrandPiece({ ...identity(), name: 'Um nome de canal bem comprido para testar o encaixe' }, 'banner');
    // Name and tagline are top-level texts; the symbol's initials live in its own scaled group.
    const nameX = Number(/<text x="(\d+)"[^>]*>Um nome/u.exec(svg)?.[1]);
    expect(nameX).toBeGreaterThanOrEqual(BANNER_SAFE_AREA.x);
    expect(nameX).toBeLessThan(BANNER_SAFE_AREA.x + BANNER_SAFE_AREA.width);
    // A long name shrinks, and the hard limit keeps it inside the safe area whatever the face.
    expect(svg).toMatch(/textLength="\d+" lengthAdjust="spacingAndGlyphs">Um nome|font-size="\d+"[^>]*>Um nome/u);
  });

  it('uses the typed name on the banner and a data URL the renderer can show', () => {
    expect(renderBrandPiece({ ...identity(), name: 'NextWorth' }, 'banner')).toContain('>NextWorth<');
    expect(brandPieceDataUrl(identity(), 'avatar')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/u);
    expect(renderBrandPiece(identity(), 'thumbnail', { title: 'Meu vídeo' })).toContain('>Meu vídeo<');
  });
});

describe('Velix brand templates', () => {
  it('picks directions by niche and renders every one with its fonts embedded and readable text', async () => {
    const { BRAND_TEMPLATE_IDS, applyBrandTemplate, suggestBrandTemplates } = await import('../src/velix-channel.js');
    expect(suggestBrandTemplates('receitas de cozinha e viagem')[0]).toBe('quente');
    expect(suggestBrandTemplates('games e humor')[0]).toBe('neon');
    expect(suggestBrandTemplates('investimentos e renda')).toEqual(['premium', 'crescimento', 'fintech']);
    expect(generateBrandDirections('AI tools', 'NextWorth').map((item) => item.name)).toEqual(['NextWorth', 'NextWorth', 'NextWorth']);
    const { evaluateBrandIdentity } = await import('../src/velix-brand-pieces.js');
    for (const id of BRAND_TEMPLATE_IDS) {
      const identity = applyBrandTemplate(id, { name: 'NextWorth', tagline: 'Ferramentas de IA' });
      const banner = renderBrandPiece(identity, 'banner');
      expect(banner).toContain('@font-face');
      expect(banner).toContain('data:font/woff2;base64,');
      expect(banner).toContain('<title>Banner de NextWorth</title>');
      expect(evaluateBrandIdentity(identity).filter((check) => check.status === 'fail')).toEqual([]);
    }
  });
});

describe('Velix identity evaluation', () => {
  it('passes the generated directions and flags what a person must fix', async () => {
    const { evaluateBrandIdentity } = await import('../src/velix-brand-pieces.js');
    for (const direction of generateBrandDirections('ciência e tecnologia')) expect(evaluateBrandIdentity(direction).some((check) => check.status === 'fail')).toBe(false);
    const base = identity();
    const bad = evaluateBrandIdentity({ ...base, name: 'Um nome de canal realmente muito comprido que não cabe no banner de jeito nenhum', tokens: { ...base.tokens, foreground: '#999999', background: '#aaaaaa' }, symbol: { ...base.symbol, initials: 'ABC' } });
    expect(bad.find((check) => check.id === 'text-contrast')?.status).toBe('fail');
    expect(bad.find((check) => check.id === 'name-size')?.status).toBe('fail');
    expect(bad.find((check) => check.id === 'initials')?.status).toBe('warn');
  });
});
