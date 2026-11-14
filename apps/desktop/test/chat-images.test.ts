import { describe, expect, it } from 'vitest';
import { IMAGE_MAX_BYTES } from '@neuralbridge/shared';
import { formatBytes, triageImages } from '../src/renderer/src/features/tasks/chat-images.js';

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

describe('triageImages', () => {
  it('keeps PNG, JPEG, GIF and WebP within the size and count limits, and says why the rest was left out', () => {
    const result = triageImages(4, [file('a.png', 'image/png'), file('b.svg', 'image/svg+xml'), file('c.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 1), file('d.webp', 'image/webp'), file('e.gif', 'image/gif')]);
    expect(result.accepted.map((entry) => entry.name)).toEqual(['a.png', 'd.webp']);
    expect(result.problems).toEqual([
      '“b.svg” não é PNG, JPEG, GIF ou WebP.',
      '“c.jpg” passa de 5 MB.',
      'No máximo 6 imagens por mensagem: “e.gif” ficou de fora.',
    ]);
  });

  it('accepts nothing new when the message is already full', () => {
    expect(triageImages(6, [file('a.png', 'image/png')])).toEqual({ accepted: [], problems: ['No máximo 6 imagens por mensagem: “a.png” ficou de fora.'] });
  });
});

describe('formatBytes', () => {
  it('reads like a file size', () => {
    expect([512, 2048, 3 * 1024 * 1024].map(formatBytes)).toEqual(['512 B', '2 KB', '3,0 MB']);
  });
});
