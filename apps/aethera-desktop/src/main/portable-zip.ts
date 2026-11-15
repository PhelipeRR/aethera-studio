import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  statSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeflateRaw, createInflateRaw } from 'node:zlib';

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const DATA_DESCRIPTOR_SIG = 0x08074b50;
const CENTRAL_DIR_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

const ALREADY_COMPRESSED_EXT = /\.(mp4|mov|mkv|webm|avi|mp3|aac|ogg|flac|m4a|png|jpe?g|webp|gif|zip|gz|7z|br)$/i;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function updateCrc32(crc: number, chunk: Buffer): number {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < chunk.length; i += 1) {
    c = CRC_TABLE[(c ^ chunk[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Validates that a ZIP archive entry path is strictly relative and cannot escape targetDir.
 */
export function normalizeSafeZipEntryPath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\0')) return null;
  const slashNormalized = rawPath.replace(/\\/g, '/');
  if (slashNormalized.startsWith('/') || /^[a-zA-Z]:/.test(slashNormalized)) {
    return null;
  }
  const segments = slashNormalized.split('/').filter((s) => s.length > 0);
  if (segments.length === 0 || segments.some((seg) => seg === '.' || seg === '..')) {
    return null;
  }
  return segments.join('/');
}

export function resolveSafeZipExtractPath(targetDir: string, rawEntryPath: string): string | null {
  const normalized = normalizeSafeZipEntryPath(rawEntryPath);
  if (!normalized) return null;
  const baseResolved = resolve(targetDir);
  const resolved = resolve(baseResolved, ...normalized.split('/'));
  if (!resolved.startsWith(`${baseResolved}${sep}`)) {
    return null;
  }
  return resolved;
}

export interface ZipInputEntry {
  archivePath: string;
  sourceFilePath?: string;
  buffer?: Buffer;
}

export interface ZipWrittenEntry {
  archivePath: string;
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
  sha256: string;
  method: number;
}

interface CentralRecord {
  nameBuf: Buffer;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dosTime: number;
  dosDate: number;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosTime, dosDate };
}

function writeBufferChunk(stream: NodeJS.WritableStream, buf: Buffer): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (stream.write(buf)) {
      resolvePromise();
    } else {
      stream.once('drain', resolvePromise);
      stream.once('error', rejectPromise);
    }
  });
}

/**
 * Streams files and buffers into a standard ZIP archive without buffering large files in memory.
 */
export async function writeStreamingZip(
  targetZipPath: string,
  entries: readonly ZipInputEntry[],
): Promise<ZipWrittenEntry[]> {
  mkdirSync(dirname(targetZipPath), { recursive: true });
  const out = createWriteStream(targetZipPath);
  out.setMaxListeners(0);
  const centralRecords: CentralRecord[] = [];
  const written: ZipWrittenEntry[] = [];
  const seenPaths = new Set<string>();
  let offset = 0;

  try {
    const { dosTime, dosDate } = toDosDateTime(new Date());

    for (const entry of entries) {
      const safeName = normalizeSafeZipEntryPath(entry.archivePath);
      if (!safeName) {
        throw new Error(`Caminho de entrada inválido no ZIP: ${entry.archivePath}`);
      }
      if (seenPaths.has(safeName)) {
        throw new Error(`Entrada duplicada no ZIP: ${safeName}`);
      }
      seenPaths.add(safeName);

      const nameBuf = Buffer.from(safeName, 'utf8');
      const useStore = ALREADY_COMPRESSED_EXT.test(safeName);
      const method = useStore ? METHOD_STORE : METHOD_DEFLATE;
      const flags = FLAG_DATA_DESCRIPTOR | FLAG_UTF8;

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
      localHeader.writeUInt16LE(20, 4); // version needed 2.0
      localHeader.writeUInt16LE(flags, 6);
      localHeader.writeUInt16LE(method, 8);
      localHeader.writeUInt16LE(dosTime, 10);
      localHeader.writeUInt16LE(dosDate, 12);
      localHeader.writeUInt32LE(0, 14); // crc32 in descriptor
      localHeader.writeUInt32LE(0, 18); // compressed size in descriptor
      localHeader.writeUInt32LE(0, 22); // uncompressed size in descriptor
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28); // extra len

      const localHeaderOffset = offset;
      await writeBufferChunk(out, localHeader);
      await writeBufferChunk(out, nameBuf);
      offset += localHeader.length + nameBuf.length;

      let crc = 0;
      let uncompressedSize = 0;
      let compressedSize = 0;
      const sha = createHash('sha256');

      if (entry.buffer) {
        const buf = entry.buffer;
        uncompressedSize = buf.length;
        crc = updateCrc32(0, buf);
        sha.update(buf);

        if (method === METHOD_STORE) {
          compressedSize = buf.length;
          if (buf.length > 0) {
            await writeBufferChunk(out, buf);
            offset += buf.length;
          }
        } else {
          const deflater = createDeflateRaw({ level: 6 });
          const chunks: Buffer[] = [];
          deflater.on('data', (c: Buffer) => chunks.push(c));
          const done = new Promise<void>((res, rej) => {
            deflater.once('end', res);
            deflater.once('error', rej);
          });
          deflater.end(buf);
          await done;
          const compressed = Buffer.concat(chunks);
          compressedSize = compressed.length;
          if (compressed.length > 0) {
            await writeBufferChunk(out, compressed);
            offset += compressed.length;
          }
        }
      } else if (entry.sourceFilePath) {
        const readStream = createReadStream(entry.sourceFilePath, { highWaterMark: 64 * 1024 });
        const hasher = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            uncompressedSize += chunk.length;
            crc = updateCrc32(crc, chunk);
            sha.update(chunk);
            cb(null, chunk);
          },
        });
        const counter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            compressedSize += chunk.length;
            offset += chunk.length;
            cb(null, chunk);
          },
        });

        if (method === METHOD_STORE) {
          await pipeline(readStream, hasher, counter, out, { end: false });
        } else {
          const deflater = createDeflateRaw({ level: 6 });
          await pipeline(readStream, hasher, deflater, counter, out, { end: false });
        }
      } else {
        throw new Error(`Entrada sem origem para ZIP: ${safeName}`);
      }

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(DATA_DESCRIPTOR_SIG, 0);
      descriptor.writeUInt32LE(crc >>> 0, 4);
      descriptor.writeUInt32LE(compressedSize >>> 0, 8);
      descriptor.writeUInt32LE(uncompressedSize >>> 0, 12);
      await writeBufferChunk(out, descriptor);
      offset += descriptor.length;

      centralRecords.push({
        nameBuf,
        method,
        flags,
        crc32: crc >>> 0,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        dosTime,
        dosDate,
      });

      written.push({
        archivePath: safeName,
        uncompressedSize,
        compressedSize,
        crc32: crc >>> 0,
        sha256: sha.digest('hex'),
        method,
      });
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;

    for (const rec of centralRecords) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(CENTRAL_DIR_HEADER_SIG, 0);
      header.writeUInt16LE(20, 4); // version made by
      header.writeUInt16LE(20, 6); // version needed
      header.writeUInt16LE(rec.flags, 8);
      header.writeUInt16LE(rec.method, 10);
      header.writeUInt16LE(rec.dosTime, 12);
      header.writeUInt16LE(rec.dosDate, 14);
      header.writeUInt32LE(rec.crc32, 16);
      header.writeUInt32LE(rec.compressedSize >>> 0, 20);
      header.writeUInt32LE(rec.uncompressedSize >>> 0, 24);
      header.writeUInt16LE(rec.nameBuf.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(rec.localHeaderOffset >>> 0, 42);
      await writeBufferChunk(out, header);
      await writeBufferChunk(out, rec.nameBuf);
      centralDirSize += header.length + rec.nameBuf.length;
      offset += header.length + rec.nameBuf.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(centralRecords.length, 8);
    eocd.writeUInt16LE(centralRecords.length, 10);
    eocd.writeUInt32LE(centralDirSize >>> 0, 12);
    eocd.writeUInt32LE(centralDirOffset >>> 0, 16);
    eocd.writeUInt16LE(0, 20);
    await writeBufferChunk(out, eocd);

    await new Promise<void>((res, rej) => {
      out.once('finish', res);
      out.once('error', rej);
      out.end();
    });
    return written;
  } catch (err) {
    out.destroy();
    throw err;
  }
}

export interface ParsedZipEntry {
  archivePath: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

/**
 * Reads only the ZIP Central Directory from disk without loading archive payloads into memory.
 */
export function listZipEntries(zipFilePath: string): ParsedZipEntry[] {
  const st = statSync(zipFilePath);
  const fileSize = st.size;
  if (fileSize < 22) {
    throw new Error('Arquivo ZIP inválido ou truncado.');
  }

  const fd = openSync(zipFilePath, 'r');
  try {
    const searchLen = Math.min(fileSize, 65536 + 22);
    const tail = Buffer.alloc(searchLen);
    readSync(fd, tail, 0, searchLen, fileSize - searchLen);

    let eocdPos = -1;
    for (let i = searchLen - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos < 0) {
      throw new Error('Cabeçalho EOCD do ZIP não encontrado.');
    }

    const totalEntries = tail.readUInt16LE(eocdPos + 10);
    const centralDirSize = tail.readUInt32LE(eocdPos + 12);
    const centralDirOffset = tail.readUInt32LE(eocdPos + 16);

    if (centralDirOffset + centralDirSize > fileSize) {
      throw new Error('Diretório central do ZIP corrompido.');
    }

    const cdBuf = Buffer.alloc(centralDirSize);
    readSync(fd, cdBuf, 0, centralDirSize, centralDirOffset);

    const entries: ParsedZipEntry[] = [];
    let ptr = 0;
    for (let idx = 0; idx < totalEntries; idx += 1) {
      if (ptr + 46 > cdBuf.length || cdBuf.readUInt32LE(ptr) !== CENTRAL_DIR_HEADER_SIG) {
        throw new Error('Entrada do diretório central do ZIP inválida.');
      }
      const method = cdBuf.readUInt16LE(ptr + 10);
      const crc32 = cdBuf.readUInt32LE(ptr + 16);
      const compressedSize = cdBuf.readUInt32LE(ptr + 20);
      const uncompressedSize = cdBuf.readUInt32LE(ptr + 24);
      const nameLen = cdBuf.readUInt16LE(ptr + 28);
      const extraLen = cdBuf.readUInt16LE(ptr + 30);
      const commentLen = cdBuf.readUInt16LE(ptr + 32);
      const localHeaderOffset = cdBuf.readUInt32LE(ptr + 42);

      const rawName = cdBuf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
      ptr += 46 + nameLen + extraLen + commentLen;

      // Skip explicit directory entries safely, but still reject traversal names
      const isDirEntry = rawName.endsWith('/');
      const safeName = normalizeSafeZipEntryPath(rawName);
      if (!safeName) {
        throw new Error(`Entrada ZIP insegura bloqueada (path traversal): ${rawName}`);
      }
      if (isDirEntry) continue;

      if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
        throw new Error(`Método de compressão ZIP não suportado (${method}) para ${safeName}`);
      }

      const lhBuf = Buffer.alloc(30);
      readSync(fd, lhBuf, 0, 30, localHeaderOffset);
      if (lhBuf.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIG) {
        throw new Error(`Cabeçalho local ZIP inválido para ${safeName}`);
      }
      const lhNameLen = lhBuf.readUInt16LE(26);
      const lhExtraLen = lhBuf.readUInt16LE(28);
      const dataOffset = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
      if (dataOffset + compressedSize > fileSize) {
        throw new Error(`Payload ZIP truncado para ${safeName}`);
      }

      entries.push({
        archivePath: safeName,
        method,
        crc32,
        compressedSize,
        uncompressedSize,
        dataOffset,
      });
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

/**
 * Streams a single ZIP entry to compute SHA-256 and CRC-32 (and optionally write to disk or return Buffer).
 */
export async function streamZipEntry(
  zipFilePath: string,
  entry: ParsedZipEntry,
  options?: { destFilePath?: string; collectBuffer?: boolean },
): Promise<{ sha256: string; bytes: number; crc32: number; buffer?: Buffer }> {
  const sha = createHash('sha256');
  let crc = 0;
  let bytes = 0;
  const chunks: Buffer[] = [];

  const compressedStream =
    entry.compressedSize === 0
      ? (async function* () {})()
      : createReadStream(zipFilePath, {
          start: entry.dataOffset,
          end: entry.dataOffset + entry.compressedSize - 1,
          highWaterMark: 64 * 1024,
        });

  const verifier = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      crc = updateCrc32(crc, chunk);
      sha.update(chunk);
      if (options?.collectBuffer) chunks.push(chunk);
      cb(null, chunk);
    },
  });

  if (options?.destFilePath) {
    mkdirSync(dirname(options.destFilePath), { recursive: true });
    const out = createWriteStream(options.destFilePath);
    if (entry.method === METHOD_STORE) {
      await pipeline(compressedStream, verifier, out);
    } else {
      await pipeline(compressedStream, createInflateRaw(), verifier, out);
    }
  } else {
    const sink = new Transform({
      transform(_chunk: Buffer, _enc, cb) {
        cb();
      },
    });
    if (entry.method === METHOD_STORE) {
      await pipeline(compressedStream, verifier, sink);
    } else {
      await pipeline(compressedStream, createInflateRaw(), verifier, sink);
    }
  }

  if ((crc >>> 0) !== (entry.crc32 >>> 0) || bytes !== entry.uncompressedSize) {
    throw new Error(
      `Falha de integridade ZIP em ${entry.archivePath}: CRC ou tamanho divergente (esperado ${entry.uncompressedSize}B, obtido ${bytes}B).`,
    );
  }

  return {
    sha256: sha.digest('hex'),
    bytes,
    crc32: crc >>> 0,
    ...(options?.collectBuffer ? { buffer: Buffer.concat(chunks) } : {}),
  };
}
