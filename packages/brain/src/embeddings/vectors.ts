import { createHash } from 'node:crypto';

export function toBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/** Copies into an aligned Float32Array (a Buffer slice may start at an odd byte offset). */
export function fromBlob(blob: Uint8Array): Float32Array {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer, 0, copy.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** Text that gets embedded for a memory. */
export function embeddingText(title: string, content: string): string {
  return `${title}\n\n${content}`;
}

/** Identifies the exact text a vector was computed from, to detect stale vectors. */
export function contentHash(title: string, content: string): string {
  return createHash('sha256').update(embeddingText(title, content)).digest('hex');
}
