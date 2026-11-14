import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { aetheraMediaProxySchema, type AetheraMediaProxy } from '@neuralbridge/shared';

const exec = promisify(execFile);
const BUFFER = 8 * 1_024 * 1_024;

function confined(root: string, value: string): string {
  if (isAbsolute(value)) throw new Error('invalid: caminho de proxy fora do projeto.');
  const base = realpathSync(root);
  const target = resolve(base, value);
  const rel = relative(base, target);
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('invalid: caminho de proxy fora do projeto.');
  return target;
}

function fps(value: string | undefined): number {
  const [num, den] = (value ?? '0/1').split('/').map(Number);
  return den && Number.isFinite(num ?? NaN) ? (num ?? 0) / den : 30;
}

/** Generates a seek-friendly 540p proxy from an already local asset; it never downloads or changes rights metadata. */
export async function createAetheraMediaProxy(input: { root: string; assetId: string; originalHash: string; sourceRelativePath: string; outputRelativePath: string; ffmpeg: string; ffprobe: string; signal?: AbortSignal }): Promise<AetheraMediaProxy> {
  const source = confined(input.root, input.sourceRelativePath);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error('not_found: mídia local para proxy não encontrada.');
  const output = confined(input.root, input.outputRelativePath);
  mkdirSync(dirname(output), { recursive: true });
  await exec(input.ffmpeg, ['-y', '-v', 'error', '-i', source, '-vf', 'scale=960:-2:flags=fast_bilinear', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', output], { windowsHide: true, maxBuffer: BUFFER, ...(input.signal ? { signal: input.signal } : {}) } as Parameters<typeof exec>[2]);
  const probe = await exec(input.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,codec_name', '-of', 'json', output], { windowsHide: true, maxBuffer: BUFFER });
  const stream = (JSON.parse(String(probe.stdout)) as { streams?: Array<{ width?: number; height?: number; avg_frame_rate?: string; codec_name?: string }> }).streams?.[0];
  if (!stream?.width || !stream.height) throw new Error('invalid: o proxy não tem vídeo legível.');
  return aetheraMediaProxySchema.parse({ schemaVersion: 1, assetId: input.assetId, originalHash: input.originalHash, relativePath: input.outputRelativePath, width: stream.width, height: stream.height, fps: fps(stream.avg_frame_rate), codec: stream.codec_name ?? 'h264', createdAt: new Date().toISOString() });
}
