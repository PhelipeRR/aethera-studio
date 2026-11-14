import { classify } from '../router.js';
import { buildHandoffs, detectSwarmConflicts, selectSpecialists, type SpecialistHandoff, type SwarmPlan } from '../swarm.js';
import type { TaskPort } from './ports.js';

const DEFAULT_SWARM_BUDGET = 100_000;

export interface SwarmRunResult {
  taskIds: string[];
  roles: string[];
  results: Array<{ role: string; taskId: string; status: string; summary: string | null; error: string | null; filesChanged: string[] }>;
  conflicts: string[];
}

/**
 * Agent Swarm as an application service: plans specialists deterministically and runs them layer by
 * layer as ordinary TaskEngine tasks (through {@link TaskPort}); no CLI is called here.
 */
export function createSwarmService(tasks: TaskPort) {
  const plan = (prompt: string, tokenBudget?: number): SwarmPlan & { handoffs: SpecialistHandoff[] } => {
    const selected = selectSpecialists(classify(prompt).type, prompt, tokenBudget ?? DEFAULT_SWARM_BUDGET);
    return { ...selected, handoffs: buildHandoffs(selected) };
  };

  return {
    plan,
    async run(input: { prompt: string; projectId: string | null; approved: boolean; tokenBudget?: number | undefined }): Promise<SwarmRunResult> {
      const { handoffs, ...selected } = plan(input.prompt, input.tokenBudget);
      if (selected.requiresHumanApproval && !input.approved) throw new Error('approval_required: O plano do Agent Swarm exige aprovação humana.');
      const completed = new Set<string>();
      const taskIds: string[] = [];
      const results: SwarmRunResult['results'] = [];
      while (completed.size < handoffs.length) {
        const ready = handoffs.filter((handoff) => !completed.has(handoff.role) && handoff.dependsOn.every((dependency) => completed.has(dependency)));
        if (!ready.length) throw new Error('invalid: dependências circulares no plano de especialistas.');
        const started = await Promise.all(ready.map((handoff) => tasks.start({ prompt: `[Agent Swarm · ${handoff.role}]\nPedido original: ${input.prompt}\n\nEntregue ${handoff.output}.`, projectId: input.projectId, mode: handoff.role === 'developer' ? 'codex' : 'claude' })));
        taskIds.push(...started.map((task) => task.id));
        await tasks.idle();
        for (const [index, task] of started.entries()) {
          const role = ready[index]?.role ?? 'desconhecido';
          const detail = tasks.get(task.id);
          results.push({ role, taskId: task.id, status: detail.status, summary: detail.summary, error: detail.error, filesChanged: [...new Set(detail.steps.flatMap((step) => step.filesChanged))] });
          if (detail.status !== 'completed') throw new Error(`failed: O especialista ${role} terminou com status ${detail.status}.`);
        }
        for (const handoff of ready) completed.add(handoff.role);
      }
      return { taskIds, roles: selected.roles, results, conflicts: detectSwarmConflicts(results) };
    },
  };
}

export type SwarmService = ReturnType<typeof createSwarmService>;
