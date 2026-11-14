import { describe, expect, it } from 'vitest';
import { advanceCollageApproval, createFakeCollageProvider, estimateCollageCost, requireCollageProviderConfigured, validateCollageRequest } from '../src/velix-collage.js';

describe('Velix editorial collage', () => {
  it('estimates paid generation and validates the metaphor request', () => {
    const request = validateCollageRequest({ projectId: 'p1', prompt: 'Uma ponte de papel sobre uma cidade', durationSeconds: 5, aspectRatio: '16:9' });
    expect(request.prompt).toContain('ponte');
    expect(estimateCollageCost(request)).toMatchObject({ currency: 'USD', amount: expect.any(Number), label: expect.stringContaining('estimado') });
  });

  it('fake provider produces the two approval artifacts and a deterministic MP4 plan', async () => {
    const provider = createFakeCollageProvider();
    const request = validateCollageRequest({ projectId: 'p1', prompt: 'Uma ponte de papel', durationSeconds: 5, aspectRatio: '16:9' });
    const metaphor = await provider.proposeMetaphor(request);
    const still = await provider.createStill(request, metaphor);
    const generated = await provider.generateClip(request, still);
    expect(metaphor.approvalText).toContain('ponte');
    expect(still.mimeType).toBe('image/png');
    expect(generated.mimeType).toBe('video/mp4');
    expect(generated.durationSeconds).toBe(5);
    expect(generated.bytes.length).toBeGreaterThan(0);
  });

  it('rejects prompts and durations outside the bounded contract', () => {
    expect(() => validateCollageRequest({ projectId: 'p1', prompt: '', durationSeconds: 5, aspectRatio: '16:9' })).toThrow(/prompt/i);
    expect(() => validateCollageRequest({ projectId: 'p1', prompt: 'uma ponte', durationSeconds: 31, aspectRatio: '16:9' })).toThrow();
  });

  it('requires the two approvals before generation can start', () => {
    expect(advanceCollageApproval('draft', 'approve-metaphor')).toBe('metaphor_approved');
    expect(advanceCollageApproval('metaphor_approved', 'approve-still')).toBe('still_approved');
    expect(() => advanceCollageApproval('draft', 'start-generation')).toThrow(/inválida/);
    expect(advanceCollageApproval('draft', 'reject')).toBe('rejected');
  });

  it('keeps the optional feature unavailable until Gemini is configured', () => {
    expect(() => requireCollageProviderConfigured(false)).toThrow(/configure a chave Gemini/i);
    expect(() => requireCollageProviderConfigured(true)).not.toThrow();
  });
});
