import { describe, it, expect } from 'vitest';
import { fitTextToBox } from '../src/image-generation-adapter.js';
import { TypographyArtDirector, TypographyQualityCritic } from '../src/typography-director.js';
import type { CreativeProjectDocument, TypographyDirectionProposal } from '../src/schemas.js';

describe('CS-9 — Typography Robustness & Validation', () => {
  describe('fitTextToBox — horizontal orientation', () => {
    it('fits short headline within generous box without auto-scale', () => {
      const result = fitTextToBox({
        text: 'CYBERPUNK',
        targetW: 800,
        targetH: 200,
        fontSize: 72,
        lineHeight: 1.1,
        letterSpacing: 2,
        strokeWidth: 0,
        uppercase: true,
      });
      expect(result.fitsAtRequestedSize).toBe(true);
      expect(result.fontSize).toBe(72);
    });

    it('auto-scales long headline to fit narrow box', () => {
      const result = fitTextToBox({
        text: 'A REVOLUÇÃO DOS ANDRÓIDES ELÉTRICOS',
        targetW: 400,
        targetH: 120,
        fontSize: 72,
        lineHeight: 1.1,
        letterSpacing: 0,
        strokeWidth: 0,
        uppercase: true,
        minFontSize: 18,
      });
      expect(result.fitsAfterAutoScale).toBe(true);
      expect(result.fontSize).toBeLessThan(72);
      expect(result.fontSize).toBeGreaterThanOrEqual(18);
    });

    it('reports overflow when text exceeds box even at minimum font size', () => {
      const result = fitTextToBox({
        text: 'TEXTO EXTREMAMENTE LONGO QUE NÃO CABE EM NENHUMA CAIXA PEQUENA',
        targetW: 100,
        targetH: 40,
        fontSize: 48,
        lineHeight: 1.2,
        letterSpacing: 0,
        strokeWidth: 0,
        uppercase: true,
        minFontSize: 24,
      });
      expect(result.fitsAfterAutoScale).toBe(false);
      expect(result.fontSize).toBe(24);
    });

    it('handles accented characters correctly in width estimation', () => {
      const withAccents = fitTextToBox({
        text: 'MALDIÇÃO ANÁLISE',
        targetW: 600,
        targetH: 150,
        fontSize: 64,
        lineHeight: 1.1,
        letterSpacing: 0,
        strokeWidth: 0,
        uppercase: true,
      });
      const withoutAccents = fitTextToBox({
        text: 'MALDICAO ANALISE',
        targetW: 600,
        targetH: 150,
        fontSize: 64,
        lineHeight: 1.1,
        letterSpacing: 0,
        strokeWidth: 0,
        uppercase: true,
      });
      // Both should fit at the same size — accents should not cause unexpected overflow
      expect(withAccents.fitsAtRequestedSize).toBe(withoutAccents.fitsAtRequestedSize);
    });
  });

  describe('fitTextToBox — vertical orientation', () => {
    it('fits short vertical text within tall narrow box', () => {
      const result = fitTextToBox({
        text: 'CLÍMAX',
        targetW: 220,
        targetH: 400,
        fontSize: 32,
        lineHeight: 1.15,
        letterSpacing: 2,
        strokeWidth: 0,
        uppercase: true,
        orientation: 'vertical',
      });
      expect(result.fitsAtRequestedSize).toBe(true);
      expect(result.fontSize).toBe(32);
    });

    it('auto-scales vertical text that exceeds available height at requested size', () => {
      // 6 chars at fontSize 48 need ~48*6*1.15=331px; box has 250px → must auto-scale down
      const result = fitTextToBox({
        text: 'CLÍMAX',
        targetW: 180,
        targetH: 250,
        fontSize: 48,
        lineHeight: 1.15,
        letterSpacing: 2,
        strokeWidth: 0,
        uppercase: true,
        orientation: 'vertical',
        minFontSize: 16,
      });
      expect(result.fitsAfterAutoScale).toBe(true);
      expect(result.fontSize).toBeLessThan(48);
      expect(result.fontSize).toBeGreaterThanOrEqual(16);
    });

    it('reports overflow for vertical text when even minimum font exceeds height', () => {
      // 20 chars at minFontSize 16 need ~16*20*1.15+padding≈384px; box has only 80px → cannot fit
      const result = fitTextToBox({
        text: 'REVOLUÇÃO TECNOLÓGICA',
        targetW: 150,
        targetH: 80,
        fontSize: 32,
        lineHeight: 1.15,
        letterSpacing: 2,
        strokeWidth: 0,
        uppercase: true,
        orientation: 'vertical',
        minFontSize: 16,
      });
      expect(result.fitsAfterAutoScale).toBe(false);
    });

    it('uses targetW as column width and targetH as stack height for vertical', () => {
      // A single character should fit in a very narrow but tall box
      const result = fitTextToBox({
        text: 'A',
        targetW: 40,
        targetH: 500,
        fontSize: 32,
        lineHeight: 1.15,
        letterSpacing: 0,
        strokeWidth: 0,
        uppercase: true,
        orientation: 'vertical',
      });
      expect(result.fitsAtRequestedSize).toBe(true);
    });
  });

  describe('buildTypographyLayers — adaptive positioning across canvas sizes', () => {
    const palette = {
      primary: '#0EA5E9',
      secondary: '#6366F1',
      accent: '#F59E0B',
      text: '#E2E8F0',
      background: '#0F172A',
    };

    const baseDirection: TypographyDirectionProposal = {
      id: 'test-dir',
      label: 'A',
      styleName: 'Test Style',
      layoutStyle: 'high_contrast_condensed',
      fontCategory: 'condensed',
      fontFamily: 'Segoe UI',
      fallbackChain: [],
      headlineText: 'NEON CITY',
      kickerText: 'CYBERPUNK 2077',
      textLess: false,
      fontWeight: 800,
      trackingEm: 0.05,
      leadingRatio: 1.05,
      kerningMode: 'optical',
      orientation: 'horizontal',
      behindSubject: false,
      perspectiveSkewXDeg: 0,
      perspectiveSkewYDeg: 0,
      strokeWidth: 0,
      extrusionDepthPx: 0,
      textureOverlay: 'none',
      editorialRationale: 'Test fixture for adaptive positioning validation.',
    };

    const director = new TypographyArtDirector([]);

    it('positions layers within bounds at 1280×720', () => {
      const layers = director.buildTypographyLayers(baseDirection, palette, {
        canvasWidth: 1280,
        canvasHeight: 720,
      });
      for (const layer of layers) {
        const right = layer.transform.x + layer.transform.width;
        const bottom = layer.transform.y + layer.transform.height;
        expect(right).toBeLessThanOrEqual(1280);
        expect(bottom).toBeLessThanOrEqual(720);
        expect(layer.transform.x).toBeGreaterThanOrEqual(0);
        expect(layer.transform.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('positions layers within bounds at 1920×1080', () => {
      const layers = director.buildTypographyLayers(baseDirection, palette, {
        canvasWidth: 1920,
        canvasHeight: 1080,
      });
      for (const layer of layers) {
        const right = layer.transform.x + layer.transform.width;
        const bottom = layer.transform.y + layer.transform.height;
        expect(right).toBeLessThanOrEqual(1920);
        expect(bottom).toBeLessThanOrEqual(1080);
        expect(layer.transform.x).toBeGreaterThanOrEqual(0);
        expect(layer.transform.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('positions layers within bounds at 1080×1920 (portrait)', () => {
      const layers = director.buildTypographyLayers(baseDirection, palette, {
        canvasWidth: 1080,
        canvasHeight: 1920,
      });
      for (const layer of layers) {
        const right = layer.transform.x + layer.transform.width;
        const bottom = layer.transform.y + layer.transform.height;
        expect(right).toBeLessThanOrEqual(1080);
        expect(bottom).toBeLessThanOrEqual(1920);
        expect(layer.transform.x).toBeGreaterThanOrEqual(0);
        expect(layer.transform.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('generates headline-only layers when kickerText is empty', () => {
      const noKickerDir: TypographyDirectionProposal = {
        ...baseDirection,
        kickerText: '',
      };
      const layers = director.buildTypographyLayers(noKickerDir, palette, {
        canvasWidth: 1280,
        canvasHeight: 720,
      });
      const textLayers = layers.filter((l) => l.type === 'text');
      const hasKicker = textLayers.some((l) => l.type === 'text' && l.role === 'kicker');
      expect(hasKicker).toBe(false);
      expect(textLayers.length).toBeGreaterThanOrEqual(1);
    });

    it('scales font sizes proportionally across different canvas heights', () => {
      const layers720 = director.buildTypographyLayers(baseDirection, palette, {
        canvasWidth: 1280,
        canvasHeight: 720,
      });
      const layers1080 = director.buildTypographyLayers(baseDirection, palette, {
        canvasWidth: 1920,
        canvasHeight: 1080,
      });
      const headline720 = layers720.find((l) => l.type === 'text' && l.role === 'headline');
      const headline1080 = layers1080.find((l) => l.type === 'text' && l.role === 'headline');
      expect(headline720).toBeDefined();
      expect(headline1080).toBeDefined();
      if (headline720 && headline1080 && headline720.type === 'text' && headline1080.type === 'text') {
        // Font size should scale with canvas height (1080/720 = 1.5x)
        const ratio = headline1080.fontSize / headline720.fontSize;
        expect(ratio).toBeGreaterThan(1.2);
        expect(ratio).toBeLessThan(1.8);
      }
    });

    it('keeps vertical spine kicker within canvas bounds', () => {
      const verticalDir: TypographyDirectionProposal = {
        ...baseDirection,
        layoutStyle: 'vertical_spine',
        headlineText: 'ANÁLISE PROFUNDA',
        kickerText: 'DOCUMENTÁRIO',
        orientation: 'vertical',
      };
      const layers = director.buildTypographyLayers(verticalDir, palette, {
        canvasWidth: 1280,
        canvasHeight: 720,
      });
      for (const layer of layers) {
        const right = layer.transform.x + layer.transform.width;
        const bottom = layer.transform.y + layer.transform.height;
        expect(right).toBeLessThanOrEqual(1280);
        expect(bottom).toBeLessThanOrEqual(720);
      }
    });
  });
});