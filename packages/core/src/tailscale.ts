import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * CORE-07: remote access through Tailscale (decision D-8). The Core stays on 127.0.0.1; `tailscale serve` publishes
 * that loopback port as HTTPS inside the user's tailnet only. Funnel (public internet) is never used and is refused if
 * found on our port. Singularity does not install Tailscale: it detects it and guides the user. Off by default.
 */

export interface TailscaleExec { (args: readonly string[]): Promise<{ code: number; stdout: string }> }

export function defaultTailscaleExec(binary: string): TailscaleExec {
  return (args) => new Promise((resolve) => {
    execFile(binary, [...args], { windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => resolve({ code: error ? (typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((error as { code: number }).code) : 1) : 0, stdout: String(stdout) }));
  });
}

/** Fixed install location only (Program Files), never PATH, so a planted tailscale.exe is not run. */
export function findTailscale(env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const candidates = [env['ProgramFiles'], env['ProgramW6432']].filter((value): value is string => Boolean(value)).map((root) => join(root, 'Tailscale', 'tailscale.exe'));
  return candidates.find(exists) ?? null;
}

export type RemoteState =
  | { state: 'not-installed' }
  | { state: 'logged-out' | 'stopped'; detail: string }
  | { state: 'ready'; hostname: string; serving: boolean }
  | { state: 'blocked'; reason: string };

export class TailscaleRemote {
  constructor(private readonly exec: TailscaleExec | null) {}

  async status(port: number | null): Promise<RemoteState> {
    if (!this.exec) return { state: 'not-installed' };
    const result = await this.exec(['status', '--json']);
    if (result.code !== 0) return { state: 'stopped', detail: 'O Tailscale não respondeu.' };
    let status: { BackendState?: string; Self?: { DNSName?: string } };
    try { status = JSON.parse(result.stdout) as typeof status; } catch { return { state: 'stopped', detail: 'Resposta do Tailscale ilegível.' }; }
    if (status.BackendState === 'NeedsLogin') return { state: 'logged-out', detail: 'Entre na sua conta do Tailscale.' };
    if (status.BackendState !== 'Running') return { state: 'stopped', detail: `Tailscale em ${status.BackendState ?? 'estado desconhecido'}.` };
    const hostname = (status.Self?.DNSName ?? '').replace(/\.$/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i.test(hostname)) return { state: 'stopped', detail: 'Este computador não tem nome MagicDNS (.ts.net).' };
    const serve = await this.serveConfig();
    if (serve.funnel) return { state: 'blocked', reason: 'O Funnel do Tailscale está ligado; o Singularity não aceita exposição pública.' };
    return { state: 'ready', hostname, serving: port !== null && serve.targets.includes(`http://127.0.0.1:${port}`) };
  }

  private async serveConfig(): Promise<{ funnel: boolean; targets: string[] }> {
    if (!this.exec) return { funnel: false, targets: [] };
    const result = await this.exec(['serve', 'status', '--json']);
    if (result.code !== 0 || !result.stdout.trim()) return { funnel: false, targets: [] };
    try {
      const config = JSON.parse(result.stdout) as { AllowFunnel?: Record<string, boolean>; Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
      const funnel = Object.values(config.AllowFunnel ?? {}).some(Boolean);
      const targets = Object.values(config.Web ?? {}).flatMap((site) => Object.values(site.Handlers ?? {}).map((handler) => handler.Proxy ?? '')).filter(Boolean);
      return { funnel, targets };
    } catch { return { funnel: false, targets: [] }; }
  }

  /** Publishes the Core's loopback port inside the tailnet (HTTPS 443). Never funnel. */
  async enable(port: number): Promise<RemoteState> {
    const before = await this.status(port);
    if (before.state !== 'ready') return before;
    const result = await this.exec?.(['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`]);
    if (!result || result.code !== 0) return { state: 'stopped', detail: 'O Tailscale recusou publicar o Core.' };
    const after = await this.status(port);
    // Belt and braces: if funnel appeared anyway, take the publication down again.
    if (after.state === 'blocked') await this.disable();
    return after;
  }

  async disable(): Promise<void> {
    await this.exec?.(['serve', '--https=443', 'off']);
  }
}
