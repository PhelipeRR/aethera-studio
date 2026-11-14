import { describe, expect, it } from 'vitest';
import { GeminiCollageProvider } from '../src/main/gemini-collage-provider.js';

describe('GeminiCollageProvider', () => {
  it('sends the key only in the header and parses a metaphor response', async () => {
    let seenInput = '';
    let seenHeaders: Record<string, string> = {};
    const provider = new GeminiCollageProvider('secret', async (input, init) => { seenInput = input; seenHeaders = init.headers; return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: 'Uma ponte de papel' }] } }] }; } }; }, 'http://127.0.0.1:9999');
    const result = await provider.proposeMetaphor({ projectId: 'p', prompt: 'ponte', durationSeconds: 5, aspectRatio: '16:9' });
    expect(result.approvalText).toContain('ponte');
    expect(seenInput).not.toContain('secret');
    expect(seenHeaders['x-goog-api-key']).toBe('secret');
  });
});
