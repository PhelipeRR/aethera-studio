import { describe, expect, it } from 'vitest';
import { fetchChannelImage, mergeBranding, runIdentityApply, validateIdentityApply } from '../src/main/channel-identity-apply.js';

const png = (width: number, height: number, extra = 0) => { const bytes = Buffer.alloc(33 + extra); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12, 'latin1'); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes.toString('base64'); };

// A minimal JPEG: SOI, an APP0 segment to skip, then the SOF0 frame header with the size.
const jpeg = (width: number, height: number) => { const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]); bytes.writeUInt16BE(height, 13); bytes.writeUInt16BE(width, 15); return bytes.toString('base64'); };

describe('channel identity apply', () => {
  it('accepts only real PNG or JPEG images inside YouTube limits', () => {
    expect(() => validateIdentityApply({})).toThrow(/pelo menos uma/);
    expect(validateIdentityApply({ banner: { imageBase64: png(2560, 1440) } }).banner).toMatchObject({ width: 2560, height: 1440, type: 'image/png' });
    expect(validateIdentityApply({ banner: { imageBase64: jpeg(2560, 1440) } }).banner).toMatchObject({ width: 2560, height: 1440, type: 'image/jpeg' });
    expect(() => validateIdentityApply({ banner: { imageBase64: png(1280, 720) } })).toThrow(/2048×1152/);
    expect(() => validateIdentityApply({ banner: { imageBase64: Buffer.from('<svg/>').toString('base64') } })).toThrow(/PNG ou JPEG válido/);
    expect(() => validateIdentityApply({ watermark: { imageBase64: png(1000, 1000), position: 'bottomRight' } })).toThrow(/800×800/);
    expect(() => validateIdentityApply({ description: 'x'.repeat(1001) })).toThrow(/1.000/);
  });

  it('merges into the current branding so nothing else is lost', () => {
    const current = { channel: { description: 'antiga', keywords: 'a b', country: 'BR' }, image: { bannerExternalUrl: 'old', other: 1 }, watermark: { x: 1 } };
    expect(mergeBranding(current, { bannerUrl: 'new' })).toEqual({ channel: { description: 'antiga', keywords: 'a b', country: 'BR' }, image: { bannerExternalUrl: 'new', other: 1 }, watermark: { x: 1 } });
    expect(mergeBranding(current, { description: 'nova' })).toMatchObject({ channel: { description: 'nova', keywords: 'a b', country: 'BR' }, image: { bannerExternalUrl: 'old' } });
  });

  it('uploads the banner, sets the watermark, then points the channel at the new banner, reporting each step', async () => {
    const calls: string[] = []; const progress: number[] = []; let branding: unknown;
    const client = {
      getChannel: async () => ({ id: 'UC1', title: 'Canal', handle: null, brandingSettings: { channel: { description: 'mantida' } } }),
      uploadBanner: async () => { calls.push('banner'); return 'https://yt3.googleusercontent.com/new'; },
      setWatermark: async (channelId: string) => { calls.push(`watermark:${channelId}`); },
      updateBranding: async (body: unknown) => { calls.push('branding'); branding = body; },
    } as never;
    const input = { banner: { imageBase64: png(2560, 1440) }, watermark: { imageBase64: png(150, 150), position: 'bottomRight' as const } };
    const done = await runIdentityApply(input, validateIdentityApply(input), client, (step) => progress.push(step.progress));
    expect(calls).toEqual(['banner', 'watermark:UC1', 'branding']);
    expect(branding).toEqual({ id: 'UC1', brandingSettings: { channel: { description: 'mantida' }, image: { bannerExternalUrl: 'https://yt3.googleusercontent.com/new' } } });
    expect(progress).toEqual([0, 33, 67, 100]);
    expect(done).toEqual(['Banner enviado', "Marca d'água aplicada", 'Banner definido no canal']);
  });

  it('fetches the current banner only from Google image hosts', async () => {
    const image = async () => new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    await expect(fetchChannelImage('https://yt3.googleusercontent.com/b', image)).resolves.toBe(`data:image/jpeg;base64,${Buffer.from('img').toString('base64')}`);
    await expect(fetchChannelImage('https://evil.example/b', image)).resolves.toBeNull();
    await expect(fetchChannelImage('http://yt3.googleusercontent.com/b', image)).resolves.toBeNull();
    await expect(fetchChannelImage('https://yt3.googleusercontent.com/b', async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))).resolves.toBeNull();
  });
});
