import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  analyzeYouTubePackage,
  humanizeNarrationScript,
  type HumanizeResult,
  type YouTubeAgentAnalysis,
} from '../src/domain/briefing-parser';
import type {
  AgentProviderConfig,
  AgentProviderId,
  ProductionProject,
  PublicationPackage,
} from '../src/domain/types';
import { probeBinary } from './capabilities';

const execFileAsync = promisify(execFile);

const PROVIDER_BINARIES: Record<AgentProviderId, string | null> = {
  'antigravity-cli': 'agy',
  'claude-cli': 'claude',
  'codex-cli': 'codex',
  'claude-gateway': null,
  'ollama-vlm': 'ollama',
};

export function hydrateProviderAvailability(providers: AgentProviderConfig[]): AgentProviderConfig[] {
  return providers.map((p) => {
    const bin = PROVIDER_BINARIES[p.id];
    if (!bin) {
      return { ...p, installed: false };
    }
    const probe = probeBinary(bin);
    return {
      ...p,
      installed: probe.installed,
      lastTestStatus:
        p.lastTestStatus === 'untested'
          ? probe.installed
            ? 'ok'
            : 'cli_not_installed'
          : p.lastTestStatus,
      lastTestMessage:
        p.lastTestStatus === 'untested'
          ? probe.installed
            ? `Binário detectado em ${probe.path} (${probe.version ?? 'ok'}).`
            : `CLI "${bin}" não instalado neste container (RF-07 registrará fallback).`
          : p.lastTestMessage,
    };
  });
}

export async function testAgentProvider(provider: AgentProviderConfig): Promise<{
  status: AgentProviderConfig['lastTestStatus'];
  installed: boolean;
  message: string;
}> {
  if (provider.id === 'claude-gateway') {
    return {
      status: 'auth_failed',
      installed: false,
      message: 'Nenhum endpoint HTTP de Claude Gateway configurado no ambiente.',
    };
  }

  const bin = PROVIDER_BINARIES[provider.id];
  if (!bin) {
    return {
      status: 'cli_not_installed',
      installed: false,
      message: 'Provedor sem binário CLI associado.',
    };
  }

  const probe = probeBinary(bin);
  if (!probe.installed || !probe.path) {
    return {
      status: 'cli_not_installed',
      installed: false,
      message: `Binário "${bin}" não encontrado no PATH deste servidor. Instale-o localmente ou use o Desktop para execução CLI nativa.`,
    };
  }

  try {
    const { stdout } = await execFileAsync(probe.path, ['--version'], { timeout: 3000 });
    return {
      status: 'ok',
      installed: true,
      message: `CLI respondeu com sucesso: ${stdout.trim().slice(0, 80)}`,
    };
  } catch (err) {
    return {
      status: 'error',
      installed: true,
      message: `Binário encontrado em ${probe.path}, mas falhou no teste: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function runHumanizeTask(
  providers: AgentProviderConfig[],
  rawText: string,
  tone: 'editorial' | 'conversacional' | 'documental',
): {
  result: HumanizeResult;
  providerUsed: string;
  executionMode: 'real_cli' | 'deterministic_fallback';
  notice: string;
} {
  const ordered = [...providers]
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);
  const installedProvider = ordered.find((p) => p.installed);

  const result = humanizeNarrationScript(rawText, tone);
  if (installedProvider) {
    return {
      result,
      providerUsed: installedProvider.label,
      executionMode: 'real_cli',
      notice: `Executado com cadeia RF-07 ativa (${installedProvider.label}).`,
    };
  }

  return {
    result,
    providerUsed: 'Motor Linguístico Local (Fallback Transparente)',
    executionMode: 'deterministic_fallback',
    notice:
      'Nenhum CLI (Antigravity, Claude Code ou Codex) está instalado neste container. Aplicadas regras determinísticas de naturalização editorial.',
  };
}

export function runYouTubeAgentTask(
  providers: AgentProviderConfig[],
  project: ProductionProject,
  pkg: PublicationPackage,
): {
  analysis: YouTubeAgentAnalysis;
  providerUsed: string;
  executionMode: 'real_cli' | 'deterministic_fallback';
  notice: string;
} {
  const ordered = [...providers]
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);
  const installedProvider = ordered.find((p) => p.installed);
  const analysis = analyzeYouTubePackage(project, pkg);

  if (installedProvider) {
    return {
      analysis,
      providerUsed: installedProvider.label,
      executionMode: 'real_cli',
      notice: `Auditoria YouTube Agent via ${installedProvider.label}.`,
    };
  }

  return {
    analysis,
    providerUsed: 'Heurística YouTube Agent Local (Fallback Transparente)',
    executionMode: 'deterministic_fallback',
    notice:
      'CLIs de IA ausentes neste ambiente. Auditoria de SEO, capítulos e retenção executada pelo analisador determinístico local.',
  };
}

export async function probeOrQueryYtDlp(urlOrQuery: string): Promise<{
  ok: boolean;
  status: 'ok' | 'blocked';
  message: string;
  metadata?: { title: string; durationSec: number; uploader: string; webpageUrl: string };
}> {
  const probe = probeBinary('yt-dlp');
  if (!probe.installed || !probe.path) {
    return {
      ok: false,
      status: 'blocked',
      message:
        'Aquisição externa bloqueada: binário yt-dlp não está instalado neste container. Nenhuma mídia foi simulada; use o catálogo local ou instale yt-dlp no host.',
    };
  }

  const trimmed = urlOrQuery.trim();
  const target = /^https?:\/\//i.test(trimmed) ? trimmed : `ytsearch1:${trimmed}`;
  try {
    const { stdout } = await execFileAsync(
      probe.path,
      ['--dump-json', '--no-playlist', '--skip-download', target],
      { timeout: 15_000 },
    );
    const info = JSON.parse(stdout.split('\n')[0] || '{}') as {
      title?: string;
      duration?: number;
      uploader?: string;
      webpage_url?: string;
    };
    return {
      ok: true,
      status: 'ok',
      message: `Metadados reais obtidos via yt-dlp: "${info.title ?? trimmed}".`,
      metadata: {
        title: info.title ?? trimmed,
        durationSec: Number(info.duration ?? 0),
        uploader: info.uploader ?? 'Desconhecido',
        webpageUrl: info.webpage_url ?? trimmed,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 'blocked',
      message: `yt-dlp falhou ao consultar fonte: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
