import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { basename, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

export interface RenderMediaServer {
  /** Loopback URL of a listed file; any other path throws. */
  urlFor(path: string): string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', wav: 'audio/wav', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const contentType = (path: string) => TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/**
 * Remotion's OffthreadVideo only downloads http(s) URLs. This serves the media of one render job on 127.0.0.1, on a
 * random port, under an unguessable token, and only the files listed by the caller (already confined to the project).
 * It lives for one job and is closed by the caller.
 */
export async function serveRenderMedia(paths: readonly string[]): Promise<RenderMediaServer> {
  const files = [...new Set(paths.map((path) => resolve(path)))];
  const token = randomBytes(16).toString('hex');
  const server = createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const [, requestToken, index, name] = (request.url ?? '').split('?')[0]?.split('/') ?? [];
    const file = requestToken === token && index !== undefined && /^\d+$/u.test(index) ? files[Number(index)] : undefined;
    if (!file || name === undefined || decodeURIComponent(name) !== basename(file)) { response.writeHead(404).end(); return; }
    let size: number;
    try { size = statSync(file).size; } catch { response.writeHead(404).end(); return; }
    const headers = { 'content-type': contentType(file), 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
    const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range ?? '');
    if (!range) {
      response.writeHead(200, { ...headers, 'content-length': size });
      if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
      return;
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2] || 0));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!(start <= end) || start >= size) { response.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
    response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (request.method === 'HEAD') response.end(); else createReadStream(file, { start, end }).pipe(response);
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => done()); });
  const { port } = server.address() as AddressInfo;
  return {
    urlFor(path: string) {
      const index = files.indexOf(resolve(path));
      if (index < 0) throw new Error('forbidden: arquivo não autorizado para este render.');
      return `http://127.0.0.1:${port}/${token}/${index}/${encodeURIComponent(basename(files[index] as string))}`;
    },
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
}
