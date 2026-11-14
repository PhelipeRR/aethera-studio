import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VisionPolicy } from '@neuralbridge/shared';
import {
  createAntigravityCliVisionProvider,
  createVisionProviders,
  VisionRouter,
} from '../../../packages/orchestrator/src/index.js';
import { detectAntigravityCli, runAntigravityPrompt } from '../src/main/antigravity-cli.js';

const PRESERVED_DBZ_VIDEO =
  'C:\\Users\\Pheli\\AppData\\Roaming\\AetheraStudio\\validation-2026-11-14\\dbz-14seg-funnel\\media\\acq_1\\slot_1.mp4';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('AGY CLI + VisionRouter DBZ Real Frame Integration', () => {
  it('audits real AGY CLI detection and exercises VisionRouter on preserved DBZ video frames', async () => {
    const status = await detectAntigravityCli({ refresh: true });
    expect(status.id).toBe('antigravity');

    if (!existsSync(PRESERVED_DBZ_VIDEO)) {
      return;
    }

    const workDir = makeTempDir('dbz-agy-frames-');
    const frame1 = join(workDir, 'frame_2s.png');
    const frame2 = join(workDir, 'frame_6s.png');
    execFileSync('ffmpeg', ['-y', '-ss', '2', '-i', PRESERVED_DBZ_VIDEO, '-frames:v', '1', frame1], {
      stdio: 'ignore',
      timeout: 15_000,
    });
    execFileSync('ffmpeg', ['-y', '-ss', '6', '-i', PRESERVED_DBZ_VIDEO, '-frames:v', '1', frame2], {
      stdio: 'ignore',
      timeout: 15_000,
    });
    expect(existsSync(frame1)).toBe(true);
    expect(existsSync(frame2)).toBe(true);

    // Exercise real runAntigravityPrompt process path against a local node CLI shim using real DBZ frames
    const shimPath = join(workDir, process.platform === 'win32' ? 'agy-shim.cmd' : 'agy-shim.sh');
    const shimJs = join(workDir, 'agy-shim.mjs');
    writeFileSync(
      shimJs,
      `
import { existsSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('1.5.8'); process.exit(0); }
if (args.includes('--help')) { console.log('--print --output-format --mode --model'); process.exit(0); }
const promptIdx = args.indexOf('--print');
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : '';
const hasFrames = prompt.includes('frame_2s.png') && prompt.includes('frame_6s.png');
console.log(JSON.stringify({
  status: 'SUCCESS',
  model: 'agy-multimodal-test',
  response: JSON.stringify({
    schemaVersion: 1,
    nature: 'action',
    natureConfidence: 0.86,
    frames: [
      { atMs: 2000, observed: hasFrames ? 'Cena de anime Dragon Ball em combate.' : 'missing', visibleText: [] },
      { atMs: 6000, observed: 'Personagens em confronto energético.', visibleText: [] }
    ],
    entities: [{ type: 'character', name: 'Vegeta', basis: 'observed', confidence: 0.86, evidence: 'Armadura Saiyajin visível' }],
    actions: [{ description: 'Combate', basis: 'observed', confidence: 0.86 }],
    environment: { description: 'Arena rochosa', basis: 'observed', confidence: 0.8 },
    overlays: { burnedText: false, watermark: false, webcam: false },
    description: 'Trecho de anime Dragon Ball com confronto entre guerreiros Saiyajins.',
    confidence: 0.86,
    limitations: []
  })
}));
`,
      'utf8',
    );
    writeFileSync(shimPath, `@echo off\r\nnode "${shimJs}" %*\r\n`, 'utf8');

    const envWithShim = { ...process.env, NB_ANTIGRAVITY_CLI: shimPath };
    const agyProvider = createAntigravityCliVisionProvider({
      root: workDir,
      detect: async () => {
        const st = await detectAntigravityCli({ refresh: true, env: envWithShim });
        return st.installed ? { available: true } : { available: false, reason: 'missing' };
      },
      runPrompt: ({ prompt, cwd, model, signal }) =>
        runAntigravityPrompt({
          prompt,
          cwd,
          mode: 'read-only',
          ...(model ? { model } : {}),
          ...(signal ? { signal } : {}),
          env: envWithShim,
        }),
    });

    const cache = new Map<string, unknown>();
    const router = new VisionRouter(createVisionProviders([agyProvider]), {
      get: (k) => cache.get(JSON.stringify(k)),
      put: (k, v) => cache.set(JSON.stringify(k), v),
    });
    const policy: VisionPolicy = {
      schemaVersion: 1,
      task: 'describe',
      chain: ['local-vlm', 'antigravity', 'claude', 'codex', 'local-siglip', 'ffmpeg-heuristics'],
      scope: 'project',
      thresholds: null,
      version: 'aethera-dbz-agy-v1',
      budgetUsd: 0.25,
      maxLatencyMs: 20_000,
    };

    const result = await router.analyze({
      frames: [
        { path: frame1, hash: createHash('sha256').update(readFileSync(frame1)).digest('hex'), atMs: 2000 },
        { path: frame2, hash: createHash('sha256').update(readFileSync(frame2)).digest('hex'), atMs: 6000 },
      ],
      context: 'Dragon Ball Z combate',
      policy,
    });

    expect(result.provider).toBe('antigravity');
    expect(result.value?.confidence).toBe(0.86);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual([
      'local-vlm:unavailable',
      'antigravity:ok',
    ]);
  }, 30_000);
});
