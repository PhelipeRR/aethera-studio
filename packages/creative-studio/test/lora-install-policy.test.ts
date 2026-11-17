import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessLoraInstallCandidate, installLoraCandidate } from '../src/lora-install-policy.js';

describe('LoRA install policy', () => {
  it('allows a verified SDXL candidate only behind explicit confirmation', () => {
    expect(assessLoraInstallCandidate({
      model: 'characters/goku.safetensors',
      source: 'huggingface',
      sourceUrl: 'https://huggingface.co/example/goku-lora/resolve/main/goku.safetensors',
      license: 'CreativeML Open RAIL++',
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

  it('rejects an unverified license identifier instead of treating any non-empty text as approval', () => {
    const assessment = assessLoraInstallCandidate({
      model: 'styles/manga.safetensors',
      source: 'huggingface',
      sourceUrl: 'https://huggingface.co/example/manga/resolve/main/manga.safetensors',
      license: 'openrail++',
      architecture: 'sdxl',
      sizeBytes: 100 * 1024 * 1024,
      sha256: 'c'.repeat(64),
    });

    expect(assessment.allowed).toBe(false);
    expect(assessment.reasons).toContain('A licença do LoRA precisa usar um identificador canônico verificável antes da instalação.');
  });

  it('does not call the network before explicit confirmation', async () => {
    let calls = 0;
    const candidate = {
      model: 'styles/cinematic.safetensors',
      source: 'huggingface' as const,
      sourceUrl: 'https://huggingface.co/example/cinematic/resolve/main/cinematic.safetensors',
      license: 'Apache-2.0',
      architecture: 'sdxl' as const,
      sizeBytes: 4,
      sha256: createHash('sha256').update('data').digest('hex'),
    };
    await expect(installLoraCandidate(candidate, {
      targetRoot: mkdtempSync(join(tmpdir(), 'lora-policy-')),
      confirmed: false,
      fetchImpl: async () => { calls += 1; return new Response('data'); },
    })).rejects.toThrow(/confirmação/);
    expect(calls).toBe(0);
  });

  it('streams a confirmed candidate, verifies the hash, and installs atomically', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lora-install-'));
    const payload = 'verified lora bytes';
    const candidate = {
      model: 'styles/cinematic.safetensors',
      source: 'huggingface' as const,
      sourceUrl: 'https://huggingface.co/example/cinematic/resolve/main/cinematic.safetensors',
      license: 'Apache-2.0',
      architecture: 'sdxl' as const,
      sizeBytes: Buffer.byteLength(payload),
      sha256: createHash('sha256').update(payload).digest('hex'),
    };
    try {
      const result = await installLoraCandidate(candidate, {
        targetRoot: root,
        confirmed: true,
        fetchImpl: async () => new Response(payload),
      });
      expect(result).toMatchObject({ model: 'styles/cinematic.safetensors', bytes: Buffer.byteLength(payload), sha256: candidate.sha256, alreadyPresent: false });
      expect(readFileSync(join(root, 'styles/cinematic.safetensors'), 'utf8')).toBe(payload);
      expect(readdirSync(join(root, 'styles')).some((name) => name.includes('.part-'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
