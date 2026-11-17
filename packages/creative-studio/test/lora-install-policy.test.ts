import { describe, expect, it } from 'vitest';
import { assessLoraInstallCandidate } from '../src/lora-install-policy.js';

describe('LoRA install policy', () => {
  it('allows a verified SDXL candidate only behind explicit confirmation', () => {
    expect(assessLoraInstallCandidate({
      model: 'characters/goku.safetensors',
      source: 'huggingface',
      sourceUrl: 'https://huggingface.co/example/goku-lora/resolve/main/goku.safetensors',
      license: 'OpenRAIL++',
      architecture: 'sdxl',
      sizeBytes: 420 * 1024 * 1024,
      sha256: 'a'.repeat(64),
    })).toEqual({
      allowed: true,
      requiresConfirmation: true,
      reasons: ['Download externo requer confirmação explícita antes da instalação.'],
    });
  });

  it('rejects incompatible, oversized, unlicensed, or untrusted candidates', () => {
    const assessment = assessLoraInstallCandidate({
      model: '../outside.safetensors',
      source: 'unknown',
      sourceUrl: 'https://evil.example/download',
      architecture: 'sd15',
      sizeBytes: 3 * 1024 * 1024 * 1024,
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.requiresConfirmation).toBe(true);
    expect(assessment.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('relativo'),
      expect.stringContaining('fonte'),
      expect.stringContaining('licença'),
      expect.stringContaining('arquitetura'),
      expect.stringContaining('tamanho'),
      expect.stringContaining('SHA-256'),
    ]));
  });

  it('does not permit a trusted-looking URL from the wrong host', () => {
    const assessment = assessLoraInstallCandidate({
      model: 'styles/cinematic.safetensors',
      source: 'huggingface',
      sourceUrl: 'https://example.com/cinematic.safetensors',
      license: 'Apache-2.0',
      architecture: 'sdxl',
      sizeBytes: 100 * 1024 * 1024,
      sha256: 'b'.repeat(64),
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.reasons).toContain('A URL do Hugging Face precisa usar um host oficial confiável.');
  });
});
