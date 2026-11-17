import { describe, expect, it } from 'vitest';
import { CROWD_SUPPRESSION_LORA, resolveCrowdSuppression } from '../src/crowd-suppression.js';

describe('crowd suppression LoRA', () => {
  it('applies the negative photobombing slider only when requested on installed multi-character scenes', () => {
    const installed = ['other.safetensors', CROWD_SUPPRESSION_LORA.model];
    expect(resolveCrowdSuppression(3, installed, true).lora).toEqual({ model: CROWD_SUPPRESSION_LORA.model, strengthModel: -1.5, strengthClip: -1.5 });
    expect(resolveCrowdSuppression(1, installed, true)).toEqual({ lora: null, reason: 'single-character scene' });
    expect(resolveCrowdSuppression(2, ['other.safetensors'], true).reason).toMatch(/not installed/);
    expect(resolveCrowdSuppression(8, installed).lora).toBeNull();
  });
});
