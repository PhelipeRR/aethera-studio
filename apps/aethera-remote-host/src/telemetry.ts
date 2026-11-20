import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  BinaryToolStatus,
  GpuInfo,
  RemoteEngineMode,
  RemoteHostStatusResponse,
} from './contracts/v1';
import { REMOTE_CONTRACT_VERSION } from './contracts/v1';

const execFileAsync = promisify(execFile);

export function locateBinary(
  name: string,
  env: Record<string, string | undefined> = process.env,
  extraWindowsDirs: string[] = [],
): string | null {
  const candidates =
    process.platform === 'win32'
      ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`]
      : [name];

  const pathEnv = env['PATH'] ?? env['Path'] ?? '';
  const searchDirs = [
    ...pathEnv.split(path.delimiter).filter(Boolean),
    ...(process.platform === 'win32' ? extraWindowsDirs : ['/usr/local/bin', '/usr/bin', path.join(os.homedir(), '.local', 'bin')]),
  ];

  for (const dir of searchDirs) {
    for (const file of candidates) {
      const full = path.join(dir, file);
      if (fs.existsSync(full)) {
        return full;
      }
    }
  }
  return null;
}

export async function probeBinaryTool(
  id: BinaryToolStatus['id'],
  versionArgs: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<BinaryToolStatus> {
  const foundPath = locateBinary(id, env);
  if (!foundPath) {
    return { id, available: false, path: null, version: null };
  }
  try {
    const winCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(foundPath);
    const { stdout, stderr } = await execFileAsync(foundPath, versionArgs, {
      timeout: 5_000,
      windowsHide: true,
      shell: winCmd,
      env,
    });
    const firstLine = `${stdout}\n${stderr}`.trim().split(/\r?\n/)[0]?.slice(0, 120) ?? null;
    return { id, available: true, path: foundPath, version: firstLine };
  } catch {
    return { id, available: false, path: foundPath, version: null };
  }
}

export async function checkFfmpegNvencSupport(ffmpegPath: string | null): Promise<boolean> {
  if (!ffmpegPath) return false;
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
      timeout: 5_000,
      windowsHide: true,
    });
    if (!/\bh264_nvenc\b/.test(stdout)) return false;
    // Verify NVENC can actually initialize on the host hardware (not just compiled into FFmpeg)
    await execFileAsync(
      ffmpegPath,
      [
        '-hide_banner',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=256x144:d=0.1',
        '-c:v',
        'h264_nvenc',
        '-f',
        'null',
        '-',
      ],
      { timeout: 6_000, windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

export async function probeGpus(
  ffmpegPath: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<GpuInfo[]> {
  const nvencSupported = await checkFfmpegNvencSupport(ffmpegPath);
  const nvidiaSmi = locateBinary('nvidia-smi', env, ['C:\\Windows\\System32', 'C:\\Program Files\\NVIDIA Corporation\\NVSMI']);

  if (nvidiaSmi) {
    try {
      const { stdout } = await execFileAsync(
        nvidiaSmi,
        [
          '--query-gpu=name,memory.total,memory.used,utilization.gpu,driver_version',
          '--format=csv,noheader,nounits',
        ],
        { timeout: 5_000, windowsHide: true, env },
      );
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length > 0) {
        return lines.map((line) => {
          const [name = 'NVIDIA GPU', totalStr, usedStr, utilStr, driver] = line.split(',').map((s) => s.trim());
          return {
            name,
            vendor: 'nvidia',
            vramTotalMb: Number.isFinite(Number(totalStr)) ? Math.round(Number(totalStr)) : null,
            vramUsedMb: Number.isFinite(Number(usedStr)) ? Math.round(Number(usedStr)) : null,
            utilizationPct: Number.isFinite(Number(utilStr)) ? Math.round(Number(utilStr)) : null,
            driverVersion: driver || null,
            nvencSupported,
          };
        });
      }
    } catch {
      // fall through to Windows WMI fallback
    }
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress',
        ],
        { timeout: 6_000, windowsHide: true, env },
      );
      const raw = JSON.parse(stdout.trim()) as
        | { Name?: string; AdapterRAM?: number; DriverVersion?: string }
        | Array<{ Name?: string; AdapterRAM?: number; DriverVersion?: string }>;
      const list = Array.isArray(raw) ? raw : [raw];
      return list
        .filter((g) => g?.Name)
        .map((g) => {
          const name = String(g.Name);
          const lower = name.toLowerCase();
          const vendor: GpuInfo['vendor'] = lower.includes('nvidia')
            ? 'nvidia'
            : lower.includes('amd') || lower.includes('radeon')
              ? 'amd'
              : lower.includes('intel')
                ? 'intel'
                : 'unknown';
          return {
            name,
            vendor,
            vramTotalMb: g.AdapterRAM ? Math.round(Number(g.AdapterRAM) / (1024 * 1024)) : null,
            vramUsedMb: null,
            utilizationPct: null,
            driverVersion: g.DriverVersion ?? null,
            nvencSupported: vendor === 'nvidia' && nvencSupported,
          };
        });
    } catch {
      return [];
    }
  }

  return [];
}

export function detectMonorepoPackages(monorepoRoot: string): {
  cinema: boolean;
  database: boolean;
  agents: boolean;
  workspace: boolean;
  engineMode: RemoteEngineMode;
} {
  const has = (pkg: string) => fs.existsSync(path.join(monorepoRoot, 'packages', pkg, 'package.json'));
  const cinema = has('cinema');
  const database = has('database');
  const agents = has('agents');
  const workspace = has('workspace');
  return {
    cinema,
    database,
    agents,
    workspace,
    engineMode: cinema ? 'monorepo_cinema' : 'standalone_host',
  };
}

let lastCpuSample = os.cpus();

function computeCpuUsagePct(): number {
  const current = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;

  for (let i = 0; i < current.length; i++) {
    const prev = lastCpuSample[i]?.times;
    const curr = current[i]?.times;
    if (!prev || !curr) continue;
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
    const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
    totalDelta += Math.max(0, currTotal - prevTotal);
    idleDelta += Math.max(0, curr.idle - prev.idle);
  }
  lastCpuSample = current;

  if (totalDelta === 0) {
    const load1 = os.loadavg()[0] ?? 0;
    return Math.min(100, Math.max(0, Math.round((load1 / Math.max(1, current.length)) * 100)));
  }
  return Math.min(100, Math.max(0, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
}

export async function collectHostStatus(options: {
  monorepoRoot: string;
  bindHost: string;
  port: number;
  allowedRoots: string[];
  activeJobsCount: number;
  queuedJobsCount: number;
  awaitingApprovalCount: number;
  startedAtMs: number;
  env?: Record<string, string | undefined>;
}): Promise<RemoteHostStatusResponse> {
  const env = options.env ?? process.env;
  const [ffmpeg, ffprobe, ytdlp, nvidiaSmi] = await Promise.all([
    probeBinaryTool('ffmpeg', ['-version'], env),
    probeBinaryTool('ffprobe', ['-version'], env),
    probeBinaryTool('yt-dlp', ['--version'], env),
    probeBinaryTool('nvidia-smi', ['--version'], env),
  ]);

  const gpus = await probeGpus(ffmpeg.path, env);
  const monorepo = detectMonorepoPackages(options.monorepoRoot);

  const cpus = os.cpus();
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMb = Math.round(os.freemem() / (1024 * 1024));
  const usedMb = Math.max(0, totalMb - freeMb);

  return {
    schemaVersion: REMOTE_CONTRACT_VERSION,
    online: true,
    checkedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    uptimeSec: Math.round((Date.now() - options.startedAtMs) / 1000),
    bindHost: options.bindHost,
    port: options.port,
    engineMode: monorepo.engineMode,
    monorepoPackages: {
      cinema: monorepo.cinema,
      database: monorepo.database,
      agents: monorepo.agents,
      workspace: monorepo.workspace,
    },
    cpu: {
      model: cpus[0]?.model?.trim() || 'CPU',
      cores: cpus.length,
      loadAvg1m: Number((os.loadavg()[0] ?? 0).toFixed(2)),
      usagePct: computeCpuUsagePct(),
    },
    memory: {
      totalMb,
      usedMb,
      freeMb,
      usagePct: totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0,
    },
    gpus,
    tools: [ffmpeg, ffprobe, ytdlp, nvidiaSmi],
    allowedRoots: options.allowedRoots,
    activeJobsCount: options.activeJobsCount,
    queuedJobsCount: options.queuedJobsCount,
    awaitingApprovalCount: options.awaitingApprovalCount,
  };
}
