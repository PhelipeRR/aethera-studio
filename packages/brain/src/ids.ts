import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48-bit millisecond timestamp + 80 random bits, Crockford base32. Lexicographic order = creation order. */
export function newId(now: number = Date.now()): string {
  let time = '';
  for (let remaining = now, i = 0; i < 10; i++) {
    time = CROCKFORD[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }

  const bytes = randomBytes(10);
  let random = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      random += CROCKFORD[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return time + random;
}
