import { mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Page } from '@playwright/test';

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electron = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const serverScript = join(desktopDir, 'out/main/mcp-server.js');

/** Registers projects and stores memories through the app's real IPC; returns project ids by name. */
export async function seedBrain(page: Page, plan: { projects: string[]; memories: { title: string; content: string; type: string; project: string | null }[] }) {
  const ids: Record<string, string> = {};
  for (const name of plan.projects) {
    const folder = join(mkdtempSync(join(tmpdir(), 'nb-e2e-brain3d-')), name);
    mkdirSync(folder, { recursive: true });
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
    ids[name] = project.id;
  }
  for (const memory of plan.memories) {
    await page.evaluate((input) => window.neuralbridge.brain.store(input), {
      title: memory.title,
      content: memory.content,
      type: memory.type as never,
      projectId: memory.project === null ? null : (ids[memory.project] ?? null),
    });
  }
  return ids;
}

/** An agent recalling a memory through the real MCP server (a separate process), as Claude Code would. */
export async function recallThroughMcp(dataDir: string, clientName: string, title: string, projectId?: string): Promise<void> {
  const result = await callMcpTool(dataDir, clientName, 'brain_recall', { id_or_title: title }, projectId);
  if (result.isError) throw new Error(`brain_recall failed for ${title}`);
}

/** Calls one tool of the real NeuralBridge MCP server (the bundled script), as an agent would. */
export async function callMcpTool(dataDir: string, clientName: string, name: string, args: Record<string, unknown>, projectId?: string): Promise<{ isError?: boolean; text: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({
    command: electron,
    args: [serverScript, ...(projectId ? ['--project', projectId] : [])],
    cwd: dataDir,
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: dataDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: clientName, version: '1.0.0' });
  await client.connect(transport);
  try {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { ...(result.isError ? { isError: true } : {}), text: result.content[0]?.text ?? '' };
  } finally {
    await client.close();
  }
}

/** Minimal PNG reader (8-bit RGB/RGBA, no interlace), enough to measure a screenshot's lit pixels. */
export function decodePng(buffer: Buffer): { width: number; height: number; pixel: (x: number, y: number) => [number, number, number] } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const data: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      channels = chunk[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(chunk);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const i = y * stride + x * channels;
      return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
    },
  };
}

/** Share of pixels brighter than the dark background (the brain's particles and glow). */
export function litShare(png: Buffer, threshold = 90): number {
  const image = decodePng(png);
  let lit = 0;
  let total = 0;
  for (let y = 0; y < image.height; y += 2)
    for (let x = 0; x < image.width; x += 2) {
      const [r, g, b] = image.pixel(x, y);
      total++;
      if (r + g + b > threshold * 3) lit++;
    }
  return lit / total;
}

/** Share of pixels that changed between two screenshots of the same view. */
export function changedShare(a: Buffer, b: Buffer): number {
  const first = decodePng(a);
  const second = decodePng(b);
  let changed = 0;
  let total = 0;
  for (let y = 0; y < Math.min(first.height, second.height); y += 2)
    for (let x = 0; x < Math.min(first.width, second.width); x += 2) {
      const [r1, g1, b1] = first.pixel(x, y);
      const [r2, g2, b2] = second.pixel(x, y);
      total++;
      if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 30) changed++;
    }
  return changed / total;
}
