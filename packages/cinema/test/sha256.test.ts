import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/ir/sha256.js';

describe('sha256Hex (browser-safe)', () => {
  it('matches node:crypto for empty, ASCII, UTF-8 and multi-block inputs', () => {
    const samples = [
      '',
      'abc',
      'Crie um vídeo de 10 minutos sobre os TOP 5 animes — ação, magia e emoção ✨',
      JSON.stringify({ prompt: 'x'.repeat(55) }),
      'y'.repeat(64),
      'z'.repeat(1000),
    ];
    for (const text of samples) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
  });
});
