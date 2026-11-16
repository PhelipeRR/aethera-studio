import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { auditGeneratedImage } from '../src/generated-image-quality.js';

describe('generated image quality audit', () => {
  it('rejects a near-uniform buffer instead of manufacturing a quality score', async () => {
    const image = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#224466' } }).png().toBuffer();
    const audit = await auditGeneratedImage(image, { expectedWidth: 512, expectedHeight: 512 });
    expect(audit.passed).toBe(false);
    expect(audit.metrics.lumaStdDev).toBeLessThan(5);
    expect(audit.findings.some((finding) => finding.code === 'NEAR_UNIFORM_IMAGE' && finding.severity === 'critical')).toBe(true);
  });

  it('passes a correctly sized image with measurable tonal structure', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g"><stop stop-color="#06152d"/><stop offset="1" stop-color="#ff3a8c"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="380" cy="230" r="130" fill="#00e5ff"/></svg>`;
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    const audit = await auditGeneratedImage(image, { expectedWidth: 512, expectedHeight: 512 });
    expect(audit.passed).toBe(true);
    expect(audit.metrics.lumaStdDev).toBeGreaterThanOrEqual(5);
    expect(audit.findings).toEqual([]);
  });
});
