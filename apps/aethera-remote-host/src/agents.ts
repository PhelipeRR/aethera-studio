import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  RemoteAgentCapability,
  RemoteAgentFailureKind,
  RemoteAgentId,
  RemoteAgentsResponse,
  RemoteAgentStatus,
  RemoteGpuCapability,
  RemoteVisionCapability,
} from './contracts/v1';
import { REMOTE_CONTRACT_VERSION } from './contracts/v1';
import { redactSecrets } from './security';
import { locateBinary } from './telemetry';

const execFileAsync = promisify(execFile);

export interface AgentCliSpec {
  id: RemoteAgentId;
  label: string;
  command: string;
  priority: number;
  capabilities: RemoteAgentCapability[];
}

export const RF07_AGENT_SPECS: readonly AgentCliSpec[] = [
  {
    id: 'antigravity-cli',
    label: 'Antigravity CLI (agy)',
    command: 'agy',
    priority: 1,
    capabilities: ['research', 'script', 'humanize', 'youtube_audit', 'creative_direction', 'technical_qc', 'revision'],
  },
  {
    id: 'claude-cli',
    label: 'Claude Code CLI (claude)',
    command: 'claude',
    priority: 2,
    capabilities: ['research', 'script', 'humanize', 'youtube_audit', 'creative_direction', 'technical_qc', 'revision'],
  },
  {
    id: 'claude-gateway',
    label: 'Claude Gateway (HTTP)',
    command: 'claude',
    priority: 3,
    capabilities: ['research', 'script', 'humanize', 'youtube_audit', 'creative_direction', 'technical_qc', 'revision'],
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI (codex)',
    command: 'codex',
    priority: 4,
    capabilities: ['research', 'script', 'humanize', 'youtube_audit', 'creative_direction', 'technical_qc', 'revision'],
  },
  {
    id: 'ollama',
    label: 'Ollama Local (HTTP)',
    command: 'ollama',
    priority: 5,
    capabilities: ['research', 'script', 'humanize', 'youtube_audit', 'creative_direction', 'technical_qc', 'revision'],
  },
];

export interface AgentRunnerOverrides {
  /** Optional custom command path overrides for tests or custom installations */
  binaryOverrides?: Partial<Record<RemoteAgentId, { command: string; prefixArgs?: string[] }>>;
  ollamaBaseUrl?: string;
  env?: Record<string, string | undefined>;
  /** Read-only hardware probe override used by tests and hosts without nvidia-smi. */
  gpuProbe?: () => Promise<RemoteGpuCapability>;
  /** Read-only package probe override; it never downloads or runs OCR inference. */
  paddleOcrProbe?: () => Promise<{ available: boolean | null; version: string | null }>;
}

function knownVisionModels(models: readonly string[]): string[] {
  return models.filter((name) => /(?:qwen(?:2(?:\.5)?|3(?:\.5)?)?vl|qwen3\.5|llava|gemma(?:2|3).*vision|minicpm-v|moondream|internvl|phi-3-vision)/i.test(name));
}

export function classifyAgentFailure(reason: string): RemoteAgentFailureKind {
  const lower = reason.toLowerCase();
  if (lower.includes('cancel') || lower.includes('abort')) return 'cancelled';
  if (lower.includes('cli_not_installed') || lower.includes('enoent') || lower.includes('não encontrado')) {
    return 'cli_not_installed';
  }
  if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('billing') || lower.includes('credits')) {
    return 'quota_exhausted';
  }
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return 'rate_limited';
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('auth')) {
    return 'auth_failed';
  }
  if (lower.includes('stalled') || lower.includes('inatividade')) return 'stalled';
  if (lower.includes('timeout') || lower.includes('tempo limite')) return 'timeout';
  if (lower.includes('econnrefused') || lower.includes('fetch failed') || lower.includes('network')) return 'network_error';
  if (lower.includes('unknown option') || lower.includes('invalid model')) return 'config_error';
  return 'unknown';
}

export function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // already exited
          }
        }
      }, 3000).unref();
    }
  } catch {
    // best-effort process tree termination
  }
}

export interface AgentExecutionResult {
  ok: boolean;
  agentUsed: RemoteAgentId | null;
  outputText: string;
  durationMs: number;
  attempts: Array<{
    agentId: RemoteAgentId;
    ok: boolean;
    durationMs: number;
    failureKind?: RemoteAgentFailureKind;
    error?: string;
  }>;
  error?: string;
}

export class RemoteAgentManager {
  private readonly overrides: AgentRunnerOverrides;
  private readonly cooldowns = new Map<RemoteAgentId, { kind: RemoteAgentFailureKind; untilMs: number }>();

  constructor(overrides: AgentRunnerOverrides = {}) {
    this.overrides = overrides;
  }

  private getEnv(): Record<string, string | undefined> {
    return { ...process.env, ...(this.overrides.env ?? {}) };
  }

  private isInCooldown(id: RemoteAgentId): { active: boolean; kind: RemoteAgentFailureKind | null } {
    const entry = this.cooldowns.get(id);
    if (!entry) return { active: false, kind: null };
    if (Date.now() < entry.untilMs) return { active: true, kind: entry.kind };
    this.cooldowns.delete(id);
    return { active: false, kind: null };
  }

  private markCooldown(id: RemoteAgentId, kind: RemoteAgentFailureKind): void {
    const ms =
      kind === 'rate_limited'
        ? 60_000
        : kind === 'quota_exhausted' || kind === 'auth_failed' || kind === 'config_error'
          ? 10 * 60_000
          : 0;
    if (ms > 0) {
      this.cooldowns.set(id, { kind, untilMs: Date.now() + ms });
    }
  }

  public clearCooldowns(): void {
    this.cooldowns.clear();
  }

  private locateAgentCommand(id: RemoteAgentId, env: Record<string, string | undefined>): { command: string; prefixArgs: string[] } | null {
    const custom = this.overrides.binaryOverrides?.[id];
    if (custom) {
      return { command: custom.command, prefixArgs: custom.prefixArgs ?? [] };
    }

    if (id === 'antigravity-cli') {
      const override = env['NB_ANTIGRAVITY_CLI']?.trim();
      if (override && fs.existsSync(override)) return { command: override, prefixArgs: [] };
      const extraWin = [
        path.join(env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'agy', 'bin'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Antigravity', 'bin'),
      ];
      const found = locateBinary('agy', env, extraWin);
      return found ? { command: found, prefixArgs: [] } : null;
    }

    if (id === 'claude-cli' || id === 'claude-gateway') {
      const extraWin = [
        path.join(env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'),
        path.join(os.homedir(), '.local', 'bin'),
      ];
      const found = locateBinary('claude', env, extraWin);
      return found ? { command: found, prefixArgs: [] } : null;
    }

    if (id === 'codex-cli') {
      const extraWin = [
        path.join(env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'),
        path.join(os.homedir(), '.local', 'bin'),
      ];
      const found = locateBinary('codex', env, extraWin);
      return found ? { command: found, prefixArgs: [] } : null;
    }

    if (id === 'ollama') {
      const extraWin = [path.join(env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama')];
      const found = locateBinary('ollama', env, extraWin);
      return found ? { command: found, prefixArgs: [] } : null;
    }

    return null;
  }

  private async probeOllama(env: Record<string, string | undefined>): Promise<{
    reachable: boolean;
    models: string[];
    baseUrl: string;
  }> {
    const baseUrl = (this.overrides.ollamaBaseUrl || env['OLLAMA_HOST'] || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return { reachable: false, models: [], baseUrl };
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      const models = (body.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n));
      return { reachable: true, models, baseUrl };
    } catch {
      return { reachable: false, models: [], baseUrl };
    }
  }

  private async probeOllamaVision(baseUrl: string, model: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return false;
      const body = (await res.json()) as { capabilities?: unknown };
      return Array.isArray(body.capabilities) && body.capabilities.includes('vision');
    } catch {
      return false;
    }
  }

  private async probeGpu(env: Record<string, string | undefined>): Promise<RemoteGpuCapability> {
    if (this.overrides.gpuProbe) return this.overrides.gpuProbe();
    const located = locateBinary('nvidia-smi', env, []);
    if (!located) return { available: null, name: null, vramMb: null };
    try {
      const { stdout } = await execFileAsync(located, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 2_500, windowsHide: true, env });
      const [name, vramText] = stdout.trim().split(/,\s*/u);
      const vramMb = Number(vramText);
      return { available: true, name: name?.trim() || null, vramMb: Number.isFinite(vramMb) ? vramMb : null };
    } catch {
      return { available: false, name: null, vramMb: null };
    }
  }

  private async probePaddleOcr(env: Record<string, string | undefined>): Promise<{ available: boolean | null; version: string | null }> {
    if (this.overrides.paddleOcrProbe) return this.overrides.paddleOcrProbe();
    const configured = env['AETHERA_PADDLEOCR_PYTHON']?.trim();
    const python = configured && fs.existsSync(configured) ? configured : locateBinary('python', env, []);
    if (!python) return { available: null, version: null };
    try {
      const { stdout } = await execFileAsync(python, ['-c', "import importlib.metadata as m; print(m.version('paddleocr'))"], { timeout: 3_000, windowsHide: true, env });
      const version = stdout.trim().split(/\r?\n/u)[0]?.trim() ?? '';
      return version ? { available: true, version } : { available: false, version: null };
    } catch {
      return { available: false, version: null };
    }
  }

  public async discoverAgents(): Promise<RemoteAgentsResponse> {
    const env = this.getEnv();
    const checkedAt = new Date().toISOString();
    const ollamaInfo = await this.probeOllama(env);
    const gpu = await this.probeGpu(env);
    const paddleOcr = await this.probePaddleOcr(env);
    const visualModels = knownVisionModels(ollamaInfo.models);
    const configuredVisionModel = env['NB_LOCAL_VLM_MODEL'] || env['OLLAMA_MODEL'] || 'qwen2.5vl:3b';
    const configuredVisionMaxImagesRaw = Number(env['NB_LOCAL_VLM_MAX_IMAGES_PER_CALL']);
    const configuredVisionMaxImages = Number.isFinite(configuredVisionMaxImagesRaw) && configuredVisionMaxImagesRaw >= 1 ? Math.floor(configuredVisionMaxImagesRaw) : 1;
    const selectedVisionModelAvailable = visualModels.includes(configuredVisionModel);
    const selectedVisionModelIsMultimodal = selectedVisionModelAvailable && await this.probeOllamaVision(ollamaInfo.baseUrl, configuredVisionModel);

    const agents: RemoteAgentStatus[] = await Promise.all(
      RF07_AGENT_SPECS.map(async (spec) => {
        const cd = this.isInCooldown(spec.id);

        if (spec.id === 'ollama') {
          const located = this.locateAgentCommand('ollama', env);
          const available = ollamaInfo.reachable && ollamaInfo.models.length > 0;
          return {
            id: spec.id,
            label: spec.label,
            command: spec.command,
            priority: spec.priority,
            available: available && !cd.active,
            installed: Boolean(located) || ollamaInfo.reachable,
            path: located?.command ?? (ollamaInfo.reachable ? ollamaInfo.baseUrl : null),
            version: ollamaInfo.reachable ? `${ollamaInfo.models.length} modelo(s)` : null,
            authenticated: ollamaInfo.reachable ? true : null,
            models: ollamaInfo.models,
            capabilities: [...spec.capabilities],
            inCooldown: cd.active,
            cooldownReason: cd.kind,
            problem: !ollamaInfo.reachable
              ? `Serviço Ollama indisponível em ${ollamaInfo.baseUrl}.`
              : ollamaInfo.models.length === 0
                ? 'Ollama ativo, porém nenhum modelo instalado (rode `ollama pull llama3.2`).'
                : visualModels.length === 0
                  ? 'Ollama ativo, mas nenhum modelo visual conhecido foi detectado; análise multimodal desabilitada.'
                  : !selectedVisionModelAvailable
                    ? `Modelo visual configurado para Recap (${configuredVisionModel}) não está instalado; rota local desabilitada.`
                    : !selectedVisionModelIsMultimodal
                      ? `Ollama não comprovou capacidade vision para ${configuredVisionModel}; rota local desabilitada.`
                : null,
            checkedAt,
            vision: {
              available: ollamaInfo.reachable && selectedVisionModelIsMultimodal && !cd.active,
              multimodal: selectedVisionModelIsMultimodal,
              selectedModel: configuredVisionModel,
              models: visualModels,
              maxImagesPerCall: visualModels.length > 0 ? configuredVisionMaxImages : null,
              gpu,
              telemetry: { tokens: true, cache: false, effectiveApiCost: false, estimatedCost: false, cliQuota: false },
              ocr: { ...paddleOcr, engine: paddleOcr.available === true ? 'paddleocr' : null, cpuPreferred: true },
              worker: { maxConcurrent: Number(env['NB_RECAP_WORKER_COUNT']) === 1 ? 1 : 1, active: null },
              vramLimitMb: Number(env['NB_RECAP_MAX_VRAM_MB']) > 0 ? Number(env['NB_RECAP_MAX_VRAM_MB']) : 6_500,
              host: 'remote_host',
            } satisfies RemoteVisionCapability,
          };
        }

        if (spec.id === 'claude-gateway') {
          const hasGw = Boolean(env['ANTHROPIC_BASE_URL'] && (env['ANTHROPIC_AUTH_TOKEN'] || env['ANTHROPIC_API_KEY']));
          const located = this.locateAgentCommand('claude-gateway', env);
          const available = hasGw && Boolean(located) && !cd.active;
          return {
            id: spec.id,
            label: spec.label,
            command: spec.command,
            priority: spec.priority,
            available,
            installed: Boolean(located),
            path: located?.command ?? null,
            version: env['ANTHROPIC_MODEL'] ?? null,
            authenticated: hasGw,
            models: env['ANTHROPIC_MODEL'] ? [env['ANTHROPIC_MODEL']] : [],
            capabilities: [...spec.capabilities],
            inCooldown: cd.active,
            cooldownReason: cd.kind,
            problem: !hasGw
              ? 'ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN não configurados.'
              : !located
                ? 'Binário claude não encontrado para acionar o gateway.'
                : null,
            checkedAt,
          };
        }

        const located = this.locateAgentCommand(spec.id, env);
        if (!located) {
          return {
            id: spec.id,
            label: spec.label,
            command: spec.command,
            priority: spec.priority,
            available: false,
            installed: false,
            path: null,
            version: null,
            authenticated: null,
            models: [],
            capabilities: [...spec.capabilities],
            inCooldown: cd.active,
            cooldownReason: cd.kind,
            problem: `CLI "${spec.command}" não encontrado no PATH deste host.`,
            checkedAt,
          };
        }

        let version: string | null = null;
        let problem: string | null = null;
        try {
          const winCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(located.command);
          const { stdout, stderr } = await execFileAsync(
            located.command,
            [...located.prefixArgs, '--version'],
            { timeout: 6_000, windowsHide: true, shell: winCmd, env },
          );
          const combined = `${stdout}\n${stderr}`.trim();
          version = /(\d+\.\d+\.\d+)/.exec(combined)?.[1] ?? combined.split(/\r?\n/)[0]?.slice(0, 60) ?? 'installed';
        } catch (err) {
          problem = `CLI encontrado, mas falhou ao verificar versão: ${err instanceof Error ? err.message : String(err)}`;
        }

        return {
          id: spec.id,
          label: spec.label,
          command: spec.command,
          priority: spec.priority,
          available: !problem && !cd.active,
          installed: true,
          path: located.command,
          version,
          authenticated: problem ? null : true,
          models: [],
          capabilities: [...spec.capabilities],
          inCooldown: cd.active,
          cooldownReason: cd.kind,
          problem,
          checkedAt,
        };
      }),
    );

    const availableCount = agents.filter((a) => a.available).length;
    return {
      schemaVersion: REMOTE_CONTRACT_VERSION,
      checkedAt,
      fallbackOrder: RF07_AGENT_SPECS.map((s) => s.id),
      availableCount,
      soloModeReady: availableCount >= 1,
      agents,
    };
  }

  private buildSafePrompt(task: RemoteAgentCapability, userPrompt: string): string {
    const headerByTask: Record<RemoteAgentCapability, string> = {
      research: 'Você é o agente de pesquisa factual do Aethera Studio. Retorne um dossiê objetivo em PT-BR com fontes verificáveis.',
      script: 'Você é o roteirista do Aethera Studio. Escreva um roteiro cinematográfico em PT-BR dividido em cenas numeradas.',
      humanize: 'Você é o editor Humanize do Aethera Studio. Reescreva a narração abaixo com cadência natural em PT-BR sem clichês robóticos.',
      youtube_audit: 'Você é o YouTube Agent do Aethera Studio. Avalie título, descrição com capítulos 00:00, tags e retenção em PT-BR.',
      creative_direction: 'Você é o diretor criativo do Aethera Studio. Proponha direção visual, paleta, enquadramentos e ritmo de corte em PT-BR.',
      technical_qc: 'Você é o supervisor de QC técnico do Aethera Studio. Aponte inconsistências narrativas, de áudio ou de ritmo.',
      revision: 'Você é o editor de revisão cirúrgica do Aethera Studio. Aplique somente o ajuste solicitado sem alterar cenas aprovadas.',
    };
    return `${headerByTask[task]}\n\nSolicitação:\n${userPrompt.trim()}`;
  }

  private buildProviderArgs(id: RemoteAgentId, prompt: string, env: Record<string, string | undefined>): string[] {
    if (id === 'antigravity-cli') {
      return ['--output-format', 'json', '--mode', 'plan', '--print', prompt];
    }
    if (id === 'claude-cli') {
      return ['-p', '--output-format', 'text', prompt];
    }
    if (id === 'claude-gateway') {
      const model = env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-5';
      return ['-p', '--output-format', 'text', '--tools', '', '--allowedTools', '', '--model', model, prompt];
    }
    // codex-cli
    return ['exec', '--skip-git-repo-check', prompt];
  }

  private async runSingleAgent(options: {
    agentId: RemoteAgentId;
    prompt: string;
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    onLog?: (line: string, level: 'info' | 'warn' | 'error') => void;
    onSpawn?: (child: ChildProcess) => void;
  }): Promise<{ ok: boolean; text: string; durationMs: number; failureKind?: RemoteAgentFailureKind; error?: string }> {
    const start = Date.now();
    const env = this.getEnv();

    if (options.agentId === 'ollama') {
      const ollama = await this.probeOllama(env);
      if (!ollama.reachable || ollama.models.length === 0) {
        return {
          ok: false,
          text: '',
          durationMs: Date.now() - start,
          failureKind: 'network_error',
          error: 'Ollama indisponível ou sem modelos locais.',
        };
      }
      const model = env['OLLAMA_MODEL'] || ollama.models[0];
      options.onLog?.(`[ollama] Chamando modelo local ${model} em ${ollama.baseUrl}...`, 'info');
      try {
        const res = await fetch(`${ollama.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: options.prompt, stream: false }),
          signal: options.signal,
        });
        if (!res.ok) {
          return {
            ok: false,
            text: '',
            durationMs: Date.now() - start,
            failureKind: 'unknown',
            error: `Ollama retornou HTTP ${res.status}`,
          };
        }
        const data = (await res.json()) as { response?: string };
        const text = (data.response ?? '').trim();
        if (!text) {
          return {
            ok: false,
            text: '',
            durationMs: Date.now() - start,
            failureKind: 'invalid_response',
            error: 'Ollama retornou resposta vazia.',
          };
        }
        return { ok: true, text, durationMs: Date.now() - start };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          text: '',
          durationMs: Date.now() - start,
          failureKind: classifyAgentFailure(msg),
          error: redactSecrets(msg),
        };
      }
    }

    const located = this.locateAgentCommand(options.agentId, env);
    if (!located) {
      return {
        ok: false,
        text: '',
        durationMs: 0,
        failureKind: 'cli_not_installed',
        error: `CLI "${options.agentId}" não encontrado neste computador.`,
      };
    }

    const args = [...located.prefixArgs, ...this.buildProviderArgs(options.agentId, options.prompt, env)];
    const winCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(located.command);

    options.onLog?.(`[${options.agentId}] Executando agente isolado em ${located.command}`, 'info');

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(located.command, args, {
        cwd: options.cwd,
        env,
        shell: winCmd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      options.onSpawn?.(child);

      const finish = (res: { ok: boolean; text: string; failureKind?: RemoteAgentFailureKind; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        resolve({ ...res, durationMs: Date.now() - start });
      };

      const onAbort = () => {
        killProcessTree(child);
        finish({ ok: false, text: '', failureKind: 'cancelled', error: 'Execução cancelada pelo usuário.' });
      };
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const timer = setTimeout(() => {
        killProcessTree(child);
        finish({
          ok: false,
          text: '',
          failureKind: 'timeout',
          error: `Tempo limite de ${Math.round(options.timeoutMs / 1000)}s excedido.`,
        });
      }, options.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const str = chunk.toString('utf8');
        stdout += str;
        const preview = redactSecrets(str.trim()).split(/\r?\n/)[0]?.slice(0, 180);
        if (preview) options.onLog?.(`[${options.agentId}] ${preview}`, 'info');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const str = chunk.toString('utf8');
        stderr += str;
        const preview = redactSecrets(str.trim()).split(/\r?\n/)[0]?.slice(0, 180);
        if (preview) options.onLog?.(`[${options.agentId}:stderr] ${preview}`, 'warn');
      });

      child.on('error', (err) => {
        const msg = redactSecrets(err.message);
        finish({ ok: false, text: '', failureKind: classifyAgentFailure(msg), error: msg });
      });

      child.on('close', (code) => {
        if (code === 0) {
          let finalText = stdout.trim();
          if (options.agentId === 'antigravity-cli') {
            try {
              const parsed = JSON.parse(finalText) as { status?: string; response?: string; error?: string };
              if (parsed.status && parsed.status !== 'SUCCESS') {
                const err = parsed.error || `Status ${parsed.status}`;
                finish({ ok: false, text: '', failureKind: classifyAgentFailure(err), error: redactSecrets(err) });
                return;
              }
              finalText = (parsed.response ?? finalText).trim();
            } catch {
              // plain text fallback
            }
          }
          if (!finalText) {
            finish({ ok: false, text: '', failureKind: 'invalid_response', error: 'Agente encerrou com saída vazia.' });
            return;
          }
          finish({ ok: true, text: redactSecrets(finalText) });
          return;
        }
        const detail = redactSecrets(`${stderr.trim().slice(-400) || `exit code ${code}`}`);
        finish({ ok: false, text: '', failureKind: classifyAgentFailure(detail), error: detail });
      });
    });
  }

  /**
   * Executes a closed-catalog task across the RF-07 fallback chain.
   * If only ONE agent is installed/available, it executes the task solo cleanly.
   */
  public async executeWithFallback(options: {
    task: RemoteAgentCapability;
    prompt: string;
    cwd: string;
    preferredAgent?: RemoteAgentId | 'auto';
    timeoutMs?: number;
    signal?: AbortSignal;
    onLog?: (line: string, level: 'info' | 'warn' | 'error') => void;
    onSpawn?: (child: ChildProcess) => void;
  }): Promise<AgentExecutionResult> {
    const start = Date.now();
    const discovery = await this.discoverAgents();
    const safePrompt = this.buildSafePrompt(options.task, options.prompt);

    const orderedIds = [...discovery.fallbackOrder];
    if (options.preferredAgent && options.preferredAgent !== 'auto') {
      const idx = orderedIds.indexOf(options.preferredAgent);
      if (idx > 0) {
        orderedIds.splice(idx, 1);
        orderedIds.unshift(options.preferredAgent);
      }
    }

    const availableOrdered = orderedIds.filter((id) => {
      const info = discovery.agents.find((a) => a.id === id);
      return Boolean(info?.available && info.capabilities.includes(options.task));
    });

    if (availableOrdered.length === 0) {
      return {
        ok: false,
        agentUsed: null,
        outputText: '',
        durationMs: Date.now() - start,
        attempts: [],
        error:
          'Nenhum agente de IA disponível neste host (Antigravity, Claude Code, Codex, Claude Gateway ou Ollama). Instale ou autentique pelo menos um agente no PC Windows.',
      };
    }

    if (availableOrdered.length === 1) {
      options.onLog?.(
        `[RF-07 Solo] Executando tarefa "${options.task}" exclusivamente com o único agente disponível: ${availableOrdered[0]}.`,
        'info',
      );
    }

    const attempts: AgentExecutionResult['attempts'] = [];

    for (let i = 0; i < availableOrdered.length; i++) {
      if (options.signal?.aborted) break;
      const agentId = availableOrdered[i];
      const run = await this.runSingleAgent({
        agentId,
        prompt: safePrompt,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs ?? 120_000,
        signal: options.signal,
        onLog: options.onLog,
        onSpawn: options.onSpawn,
      });

      attempts.push({
        agentId,
        ok: run.ok,
        durationMs: run.durationMs,
        ...(run.failureKind ? { failureKind: run.failureKind } : {}),
        ...(run.error ? { error: run.error } : {}),
      });

      if (run.ok) {
        return {
          ok: true,
          agentUsed: agentId,
          outputText: run.text,
          durationMs: Date.now() - start,
          attempts,
        };
      }

      if (run.failureKind) {
        this.markCooldown(agentId, run.failureKind);
      }
      if (run.failureKind === 'cancelled') break;

      const next = availableOrdered[i + 1];
      if (next) {
        options.onLog?.(
          `[RF-07 Fallback] ${agentId} falhou (${run.failureKind ?? 'erro'}). Acionando próximo agente: ${next}...`,
          'warn',
        );
      }
    }

    const lastErr = attempts[attempts.length - 1]?.error ?? 'Todos os agentes da cadeia RF-07 falharam.';
    return {
      ok: false,
      agentUsed: null,
      outputText: '',
      durationMs: Date.now() - start,
      attempts,
      error: lastErr,
    };
  }
}
