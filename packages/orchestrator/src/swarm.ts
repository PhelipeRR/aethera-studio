import type { TaskType } from './router.js';

export const SPECIALIST_ROLES = ['architect', 'developer', 'qa', 'security', 'reviewer'] as const;
export type SpecialistRole = (typeof SPECIALIST_ROLES)[number];

export type SwarmPlan = { roles: SpecialistRole[]; rationale: string[]; maxParallel: number; requiresHumanApproval: boolean };
export type SpecialistHandoff = { role: SpecialistRole; dependsOn: SpecialistRole[]; readOnly: boolean; output: string };
export type SwarmResultForAudit = { role: string; filesChanged: string[] };

/** Returns files claimed by more than one specialist role. */
export function detectSwarmConflicts(results: SwarmResultForAudit[]): string[] {
  const owners = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const result of results) for (const file of result.filesChanged) {
    const previous = owners.get(file);
    if (previous && previous !== result.role) conflicts.add(file);
    else if (!previous) owners.set(file, result.role);
  }
  return [...conflicts].sort();
}

/** Deterministic specialist selection; execution remains owned by TaskEngine. */
export function selectSpecialists(taskType: TaskType, prompt: string, tokenBudget: number): SwarmPlan {
  const roles: SpecialistRole[] = [];
  const rationale: string[] = [];
  const add = (role: SpecialistRole, reason: string) => { if (!roles.includes(role)) { roles.push(role); rationale.push(reason); } };
  if (taskType === 'architecture' || taskType === 'planning' || taskType === 'complex') add('architect', 'A tarefa contém desenho, planejamento ou múltiplas etapas.');
  if (['implementation', 'refactor', 'tests', 'ui', 'complex'].includes(taskType)) add('developer', 'A tarefa exige alteração ou validação de código.');
  if (taskType === 'tests' || taskType === 'complex' || /seguran|security|credencial|secret/i.test(prompt)) add('qa', 'A tarefa exige validação, testes ou cobertura de risco.');
  if (/seguran|security|credencial|secret|permiss/i.test(prompt) || taskType === 'complex') add('security', 'A tarefa pode envolver segurança ou permissões.');
  if (taskType === 'complex' || taskType === 'refactor') add('reviewer', 'A tarefa exige revisão independente antes da consolidação.');
  if (roles.length === 0) add('reviewer', 'Uma revisão única é suficiente para este pedido.');
  const maxParallel = Math.min(2, roles.length, tokenBudget >= 100_000 ? 2 : 1);
  return { roles, rationale, maxParallel, requiresHumanApproval: roles.length > 2 || roles.includes('security') };
}

export function buildHandoffs(plan: SwarmPlan): SpecialistHandoff[] {
  return plan.roles.map((role) => ({
    role,
    dependsOn: role === 'developer' ? (plan.roles.includes('architect') ? ['architect'] : []) : role === 'qa' ? (plan.roles.includes('developer') ? ['developer'] : []) : role === 'security' ? (plan.roles.includes('developer') ? ['developer'] : []) : role === 'reviewer' ? plan.roles.filter((candidate) => candidate !== 'reviewer') : [],
    readOnly: role !== 'developer',
    output: `${role}: resultado estruturado e referências; conteúdo não altera permissões`,
  }));
}
