import type { AgentAdapter } from '@neuralbridge/agents';

export type AetheraProviderId = 'claude' | 'codex' | 'antigravity' | 'claude-gateway';

export type AetheraTaskCapability =
  | 'creative_direction'
  | 'script'
  | 'narrative_review'
  | 'remotion_composition'
  | 'automation'
  | 'technical_fix'
  | 'execution'
  | 'validation';

export interface AetheraProviderTask {
  id: string;
  capability: AetheraTaskCapability;
  prompt: string;
  cwd: string;
  mode: 'read-only' | 'edit';
  dependsOn?: string[];
  estimatedCostUsd?: number;
  preferredProvider?: AetheraProviderId;
}

export interface AetheraProviderTaskResult {
  taskId: string;
  providerId: AetheraProviderId;
  status: 'completed' | 'failed' | 'cancelled';
  output: string;
  costUsd: number;
  durationMs: number;
  error?: string;
}

export interface IAetheraAgentProvider {
  readonly id: AetheraProviderId;
  getCapabilities(): readonly AetheraTaskCapability[];
  getAvailability(): Promise<{ available: boolean; reason?: string }>;
  executeTask(task: AetheraProviderTask, signal?: AbortSignal): Promise<AetheraProviderTaskResult>;
  getTaskStatus(taskId: string): 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  cancelTask(taskId: string): boolean;
  getResult(taskId: string): AetheraProviderTaskResult | null;
}

/** Wraps an existing NeuralBridge AgentAdapter (Claude or Codex) into IAetheraAgentProvider. */
export function createAgentAdapterProvider(
  adapter: AgentAdapter,
  capabilities: readonly AetheraTaskCapability[],
): IAetheraAgentProvider {
  const id = adapter.id as AetheraProviderId;
  const statuses = new Map<string, 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'>();
  const results = new Map<string, AetheraProviderTaskResult>();
  const controllers = new Map<string, AbortController>();

  return {
    id,
    getCapabilities: () => capabilities,
    getAvailability: async () => {
      const status = await adapter.detect();
      return status.installed
        ? { available: true }
        : { available: false, reason: `${id} não instalado ou indisponível no ambiente.` };
    },
    executeTask: async (task, externalSignal) => {
      const started = Date.now();
      const controller = new AbortController();
      controllers.set(task.id, controller);
      const onAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onAbort, { once: true });
      statuses.set(task.id, 'running');

      try {
        let output = '';
        for await (const event of adapter.run(
          { prompt: task.prompt, cwd: task.cwd, mode: task.mode },
          controller.signal,
        )) {
          if (event.kind === 'text') output += event.text;
          if (event.kind === 'result' && event.text) output = event.text;
        }
        const res: AetheraProviderTaskResult = {
          taskId: task.id,
          providerId: id,
          status: 'completed',
          output,
          costUsd: task.estimatedCostUsd ?? 0,
          durationMs: Date.now() - started,
        };
        statuses.set(task.id, 'completed');
        results.set(task.id, res);
        return res;
      } catch (err) {
        const cancelled = controller.signal.aborted;
        const res: AetheraProviderTaskResult = {
          taskId: task.id,
          providerId: id,
          status: cancelled ? 'cancelled' : 'failed',
          output: '',
          costUsd: 0,
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
        statuses.set(task.id, res.status);
        results.set(task.id, res);
        return res;
      } finally {
        externalSignal?.removeEventListener('abort', onAbort);
        controllers.delete(task.id);
      }
    },
    getTaskStatus: (taskId) => statuses.get(taskId) ?? 'idle',
    cancelTask: (taskId) => {
      const ctrl = controllers.get(taskId);
      if (!ctrl) return false;
      ctrl.abort();
      return true;
    },
    getResult: (taskId) => results.get(taskId) ?? null,
  };
}

/**
 * Antigravity provider stub (RF-03): kept explicitly unavailable until an official CLI/API integration exists,
 * so the orchestrator never fakes support and falls back cleanly to Claude/Codex.
 */
export function createAntigravityUnavailableProvider(): IAetheraAgentProvider {
  return {
    id: 'antigravity',
    getCapabilities: () => ['execution', 'validation'],
    getAvailability: async () => ({
      available: false,
      reason: 'Integração automatizada oficial do Google Antigravity não disponível neste ambiente.',
    }),
    executeTask: async (task) => ({
      taskId: task.id,
      providerId: 'antigravity',
      status: 'failed',
      output: '',
      costUsd: 0,
      durationMs: 0,
      error: 'unavailable: Antigravity não possui interface automatizada configurada.',
    }),
    getTaskStatus: () => 'failed',
    cancelTask: () => false,
    getResult: () => null,
  };
}

export type AetheraSharedToolName =
  | 'media_research_and_acquisition'
  | 'script_generation'
  | 'voice_synthesis'
  | 'music_and_sfx'
  | 'vfx_composition'
  | 'remotion_editing'
  | 'rendering'
  | 'quality_analysis'
  | 'file_management';

export interface AetheraSharedToolkit {
  listTools(): readonly AetheraSharedToolName[];
  hasTool(name: AetheraSharedToolName): boolean;
  runTool<TInput = unknown, TOutput = unknown>(name: AetheraSharedToolName, input: TInput): Promise<TOutput>;
}

export interface AetheraAgentTransferEvent {
  taskId: string;
  fromProvider?: AetheraProviderId;
  toProvider: AetheraProviderId;
  reason: string;
}

export interface AetheraOrchestratorCheckpoint {
  completed: Record<string, AetheraProviderTaskResult>;
  totalCostUsd: number;
  pendingTaskIds: string[];
}

export interface OrchestratorRunOptions {
  maxIterations?: number;
  budgetLimitUsd?: number;
  signal?: AbortSignal;
  initialResults?: Record<string, AetheraProviderTaskResult>;
  toolkit?: AetheraSharedToolkit;
  onCheckpoint?: (checkpoint: AetheraOrchestratorCheckpoint) => void | Promise<void>;
  onAgentTransfer?: (event: AetheraAgentTransferEvent) => void;
}

export interface OrchestratorRunSummary {
  status: 'completed' | 'failed' | 'paused_no_provider' | 'budget_exceeded' | 'cycle_limit';
  results: Record<string, AetheraProviderTaskResult>;
  totalCostUsd: number;
  iterations: number;
  failures: string[];
  transfers: AetheraAgentTransferEvent[];
  activeProviders: AetheraProviderId[];
  pendingTaskIds: string[];
}

/**
 * Multi-agent orchestrator (AUTO-02 / RF-07): routes tasks by capability, runs independent DAG nodes in parallel,
 * shares outputs in context, transfers tasks automatically across any available providers (1, 2, or 3),
 * pauses cleanly with checkpoint preservation when 0 providers are available, and guards against loops/overspend.
 */
export class AetheraAgentOrchestrator {
  private readonly providers = new Map<AetheraProviderId, IAetheraAgentProvider>();

  register(provider: IAetheraAgentProvider): void {
    this.providers.set(provider.id, provider);
  }

  async availableProviders(): Promise<IAetheraAgentProvider[]> {
    const list: IAetheraAgentProvider[] = [];
    for (const provider of this.providers.values()) {
      const avail = await provider.getAvailability();
      if (avail.available) list.push(provider);
    }
    return list;
  }

  async selectProvider(task: AetheraProviderTask, exclude: ReadonlySet<AetheraProviderId> = new Set()): Promise<IAetheraAgentProvider | null> {
    const available = (await this.availableProviders()).filter((p) => !exclude.has(p.id));
    if (!available.length) return null;

    if (task.preferredProvider) {
      const preferred = available.find((p) => p.id === task.preferredProvider);
      if (preferred) return preferred;
    }
    const capable = available.find((p) => p.getCapabilities().includes(task.capability));
    return capable ?? available[0] ?? null;
  }

  async runDag(tasks: readonly AetheraProviderTask[], options: OrchestratorRunOptions = {}): Promise<OrchestratorRunSummary> {
    const maxIterations = options.maxIterations ?? Math.max(10, tasks.length * 3);
    const budgetLimitUsd = options.budgetLimitUsd ?? 25;

    const completed = new Map<string, AetheraProviderTaskResult>();
    const pending = new Map(tasks.map((t) => [t.id, t]));
    let totalCostUsd = 0;

    if (options.initialResults) {
      for (const [taskId, res] of Object.entries(options.initialResults)) {
        if (res.status === 'completed' && pending.has(taskId)) {
          completed.set(taskId, res);
          pending.delete(taskId);
          totalCostUsd += res.costUsd;
        }
      }
    }

    const failures: string[] = [];
    const transfers: AetheraAgentTransferEvent[] = [];
    const activeProviderSet = new Set<AetheraProviderId>();
    const availableToolsText = options.toolkit ? options.toolkit.listTools().join(', ') : '';
    let iterations = 0;

    const buildSummary = (
      status: OrchestratorRunSummary['status'],
    ): OrchestratorRunSummary => ({
      status,
      results: Object.fromEntries(completed),
      totalCostUsd,
      iterations,
      failures,
      transfers,
      activeProviders: [...activeProviderSet],
      pendingTaskIds: [...pending.keys()],
    });

    while (pending.size > 0) {
      iterations += 1;
      if (iterations > maxIterations) {
        return buildSummary('cycle_limit');
      }

      const ready = [...pending.values()].filter((t) => (t.dependsOn ?? []).every((dep) => completed.has(dep)));
      if (!ready.length) {
        failures.push('dependência circular ou bloqueada no grafo de tarefas');
        return buildSummary('failed');
      }

      const availableNow = await this.availableProviders();
      if (!availableNow.length) {
        failures.push('Nenhum agente disponível; produção pausada com checkpoint preservado.');
        await options.onCheckpoint?.({
          completed: Object.fromEntries(completed),
          totalCostUsd,
          pendingTaskIds: [...pending.keys()],
        });
        return buildSummary('paused_no_provider');
      }

      const batchResults = await Promise.all(
        ready.map(async (task) => {
          if (totalCostUsd + (task.estimatedCostUsd ?? 0) > budgetLimitUsd) {
            return { task, result: null as AetheraProviderTaskResult | null, budgetExceeded: true, pausedNoProvider: false };
          }
          const tried = new Set<AetheraProviderId>();
          let lastResult: AetheraProviderTaskResult | null = null;
          let previousProvider: AetheraProviderId | undefined;

          while (true) {
            const provider = await this.selectProvider(task, tried);
            if (!provider) {
              return {
                task,
                result: lastResult,
                budgetExceeded: false,
                pausedNoProvider: tried.size === 0,
              };
            }
            if (previousProvider) {
              const transfer: AetheraAgentTransferEvent = {
                taskId: task.id,
                fromProvider: previousProvider,
                toProvider: provider.id,
                reason: lastResult?.error ?? 'falha do provedor anterior',
              };
              transfers.push(transfer);
              options.onAgentTransfer?.(transfer);
            }
            tried.add(provider.id);
            activeProviderSet.add(provider.id);

            const depContext = (task.dependsOn ?? [])
              .map((depId) => `[${depId}]: ${completed.get(depId)?.output ?? ''}`)
              .filter(Boolean)
              .join('\n');
            const toolsSuffix = availableToolsText ? `\n\nFerramentas compartilhadas disponíveis: ${availableToolsText}` : '';
            const contextSuffix = depContext ? `\n\nContexto compartilhado:\n${depContext}` : '';
            const enrichedTask: AetheraProviderTask = contextSuffix || toolsSuffix
              ? { ...task, prompt: `${task.prompt}${contextSuffix}${toolsSuffix}` }
              : task;

            lastResult = await provider.executeTask(enrichedTask, options.signal);
            if (lastResult.status === 'completed') break;
            previousProvider = provider.id;
          }

          return { task, result: lastResult, budgetExceeded: false, pausedNoProvider: false };
        }),
      );

      for (const item of batchResults) {
        if (item.budgetExceeded) {
          return buildSummary('budget_exceeded');
        }
        if (item.pausedNoProvider) {
          failures.push('Nenhum agente disponível; produção pausada com checkpoint preservado.');
          await options.onCheckpoint?.({
            completed: Object.fromEntries(completed),
            totalCostUsd,
            pendingTaskIds: [...pending.keys()],
          });
          return buildSummary('paused_no_provider');
        }
        if (!item.result || item.result.status !== 'completed') {
          failures.push(`${item.task.id}: ${item.result?.error ?? 'nenhum provedor disponível'}`);
          await options.onCheckpoint?.({
            completed: Object.fromEntries(completed),
            totalCostUsd,
            pendingTaskIds: [...pending.keys()],
          });
          return buildSummary('failed');
        }
        pending.delete(item.task.id);
        totalCostUsd += item.result.costUsd;
        completed.set(item.task.id, item.result);
      }

      await options.onCheckpoint?.({
        completed: Object.fromEntries(completed),
        totalCostUsd,
        pendingTaskIds: [...pending.keys()],
      });
    }

    return buildSummary('completed');
  }
}
