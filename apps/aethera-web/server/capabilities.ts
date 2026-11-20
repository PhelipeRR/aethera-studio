import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CapabilityItem, SystemCapabilities } from '../src/domain/types';

export interface BinaryProbe {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export function probeBinary(cmd: string, versionArgs: string[] = ['--version']): BinaryProbe {
  try {
    const resolved = execFileSync('which', [cmd], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!resolved) {
      return { installed: false, path: null, version: null };
    }
    let version: string | null = null;
    try {
      const out = execFileSync(resolved, versionArgs, {
        encoding: 'utf8',
        timeout: 2500,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      version = out.split('\n')[0]?.trim().slice(0, 80) || null;
    } catch {
      version = 'presente';
    }
    return { installed: true, path: resolved, version };
  } catch {
    return { installed: false, path: null, version: null };
  }
}

const EXPECTED_NEURALBRIDGE_PACKAGES = [
  'agents',
  'brain',
  'cinema',
  'core',
  'creative-studio',
  'database',
  'integration-contracts',
  'mcp-server',
  'orchestrator',
  'shared',
  'workspace',
];

export function probeSystemCapabilities(opts: {
  dbPath: string;
  rendersDir: string;
  monorepoRoot: string;
}): SystemCapabilities {
  const ffmpeg = probeBinary('ffmpeg', ['-version']);
  const ffprobe = probeBinary('ffprobe', ['-version']);
  const ytDlp = probeBinary('yt-dlp', ['--version']);
  const claude = probeBinary('claude', ['--version']);
  const codex = probeBinary('codex', ['--version']);
  const agy = probeBinary('agy', ['--version']);
  const ollama = probeBinary('ollama', ['--version']);

  const packagesDir = path.join(opts.monorepoRoot, 'packages');
  const presentDirs = fs.existsSync(packagesDir)
    ? fs.readdirSync(packagesDir).filter((entry) => {
        try {
          return fs.statSync(path.join(packagesDir, entry)).isDirectory();
        } catch {
          return false;
        }
      })
    : [];

  const presentWorkspacePackages = presentDirs.map((d) => `@neuralbridge/${d}`);
  const missingWorkspacePackages = EXPECTED_NEURALBRIDGE_PACKAGES.filter(
    (pkg) => !presentDirs.includes(pkg),
  ).map((d) => `@neuralbridge/${d}`);

  const hasElevenLabsKey = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  const hasYouTubeOAuth = Boolean(process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim());

  const items: CapabilityItem[] = [
    {
      id: 'sqlite',
      label: 'Banco SQLite Real (node:sqlite)',
      available: true,
      status: 'funcional',
      detail: `Persistência em disco ativa (${path.basename(opts.dbPath)}).`,
      version: process.version,
    },
    {
      id: 'ffmpeg',
      label: 'Renderização FFmpeg',
      available: ffmpeg.installed,
      status: ffmpeg.installed ? 'funcional' : 'bloqueada',
      detail: ffmpeg.installed
        ? `Binário real em ${ffmpeg.path}. Gera MP4 H.264/AAC com legendas drawtext.`
        : 'Binário ffmpeg não encontrado no PATH.',
      version: ffmpeg.version ?? undefined,
    },
    {
      id: 'ffprobe',
      label: 'Auditoria Técnica FFprobe',
      available: ffprobe.installed,
      status: ffprobe.installed ? 'funcional' : 'bloqueada',
      detail: ffprobe.installed
        ? 'Inspeção real de codecs, resolução, duração, bitrate e loudness EBU R128.'
        : 'Binário ffprobe não encontrado no PATH.',
      version: ffprobe.version ?? undefined,
    },
    {
      id: 'sse',
      label: 'Tempo Real (SSE /api/events)',
      available: true,
      status: 'funcional',
      detail: 'Streaming real de progresso de render, etapas do pipeline e logs do Console Geral.',
    },
    {
      id: 'yt-dlp',
      label: 'Aquisição de Mídia (yt-dlp)',
      available: ytDlp.installed,
      status: ytDlp.installed ? 'funcional' : 'bloqueada',
      detail: ytDlp.installed
        ? `Binário yt-dlp ativo em ${ytDlp.path}.`
        : 'Binário yt-dlp não instalado neste container. Downloads externos retornam bloqueio explícito.',
      version: ytDlp.version ?? undefined,
    },
    {
      id: 'agents-cli',
      label: 'CLIs de Agentes (Antigravity / Claude / Codex)',
      available: agy.installed || claude.installed || codex.installed,
      status: agy.installed || claude.installed || codex.installed ? 'funcional' : 'parcial',
      detail:
        agy.installed || claude.installed || codex.installed
          ? `CLIs encontrados: ${[agy.installed && 'agy', claude.installed && 'claude', codex.installed && 'codex'].filter(Boolean).join(', ')}.`
          : 'CLIs agy, claude e codex ausentes no container. Testes retornam cli_not_installed; Humanize/YouTube Agent sinalizam modo determinístico local.',
    },
    {
      id: 'ollama',
      label: 'Ollama VLM (Visão Local)',
      available: ollama.installed,
      status: ollama.installed ? 'funcional' : 'bloqueada',
      detail: ollama.installed
        ? `Binário ollama ativo (${ollama.path}).`
        : 'Ollama não instalado neste ambiente.',
    },
    {
      id: 'tts',
      label: 'TTS (VoiceStudio / ElevenLabs)',
      available: hasElevenLabsKey,
      status: hasElevenLabsKey ? 'funcional' : 'parcial',
      detail: hasElevenLabsKey
        ? 'ELEVENLABS_API_KEY configurada no ambiente.'
        : 'VoiceStudio local (127.0.0.1:3900) e ELEVENLABS_API_KEY indisponíveis no container; áudio de prévia MP4 usa trilha FFmpeg + Web Speech opcional.',
    },
    {
      id: 'youtube-oauth',
      label: 'Publicação YouTube OAuth',
      available: hasYouTubeOAuth,
      status: hasYouTubeOAuth ? 'funcional' : 'bloqueada',
      detail: hasYouTubeOAuth
        ? 'Credenciais YOUTUBE_OAUTH_CLIENT_ID detectadas.'
        : 'YOUTUBE_OAUTH_CLIENT_ID ausente. Gestão de canais e pacotes com aprovação funciona; upload direto para YouTube permanece bloqueado.',
    },
  ];

  return {
    dbPath: opts.dbPath,
    rendersDir: opts.rendersDir,
    nodeVersion: process.version,
    checkedAt: new Date().toISOString(),
    items,
    missingWorkspacePackages,
    presentWorkspacePackages,
  };
}
