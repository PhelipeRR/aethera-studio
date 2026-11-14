import type { WorkflowDefinitionV2, WorkflowStep } from '@neuralbridge/shared/workflows';

export const NODE_DRAG_TYPE = 'application/x-neuralbridge-node';
export type NodeKind = 'claude' | 'codex' | 'generic' | 'skill' | 'approval' | 'rag' | 'validation' | 'git' | 'condition';

const base = (id: string, title: string) => ({ id, title, dependsOn: [] as string[], requiresApproval: false });
const agent = (id: string, title: string, chosen: 'claude' | 'codex' | 'auto') => ({ ...base(id, title), kind: 'agent' as const, prompt: 'Descreva o que esta etapa deve fazer.', agent: chosen, mode: 'auto' as const, access: 'read-only' as const });

/** The blocks offered in the canvas. Every one of them has a real executor. */
export const NODE_CATALOG: { kind: NodeKind; label: string; hint: string; group: 'Agentes' | 'Controle' | 'Ferramentas'; matches: (step: WorkflowStep) => boolean; create: (id: string) => WorkflowStep }[] = [
  { kind: 'claude', group: 'Agentes', label: 'Claude Code', hint: 'Etapa executada pelo Claude Code.', matches: (step) => step.kind === 'agent' && step.agent === 'claude' && !step.skillIds?.length, create: (id) => agent(id, 'Claude Code', 'claude') },
  { kind: 'codex', group: 'Agentes', label: 'Codex', hint: 'Etapa executada pelo Codex CLI.', matches: (step) => step.kind === 'agent' && step.agent === 'codex' && !step.skillIds?.length, create: (id) => agent(id, 'Codex', 'codex') },
  { kind: 'generic', group: 'Agentes', label: 'Agente automático', hint: 'O roteador escolhe o agente.', matches: (step) => step.kind === 'agent' && step.agent === 'auto' && !step.skillIds?.length, create: (id) => agent(id, 'Agente', 'auto') },
  { kind: 'skill', group: 'Agentes', label: 'Skill', hint: 'Agente com uma skill habilitada.', matches: (step) => step.kind === 'agent' && Boolean(step.skillIds?.length), create: (id) => ({ ...agent(id, 'Skill', 'auto'), skillIds: ['nome-da-skill'] }) },
  { kind: 'approval', group: 'Controle', label: 'Aprovação humana', hint: 'Espera sua decisão.', matches: (step) => step.kind === 'approval', create: (id) => ({ ...base(id, 'Aprovação humana'), kind: 'approval', message: 'Aprovar esta etapa?' }) },
  { kind: 'rag', group: 'Ferramentas', label: 'Busca no RAG', hint: 'Busca no índice do projeto.', matches: (step) => step.kind === 'rag', create: (id) => ({ ...base(id, 'Busca no RAG'), kind: 'rag', query: 'O que procurar', topK: 8 }) },
  { kind: 'validation', group: 'Ferramentas', label: 'Validação', hint: 'Roda um comando da lista permitida.', matches: (step) => step.kind === 'validation', create: (id) => ({ ...base(id, 'Validação'), kind: 'validation', command: 'npm test' }) },
  { kind: 'git', group: 'Ferramentas', label: 'Git (leitura)', hint: 'Lê status, diff ou histórico.', matches: (step) => step.kind === 'git', create: (id) => ({ ...base(id, 'Git'), kind: 'git', action: 'diff' }) },
  { kind: 'condition', group: 'Controle', label: 'Condição', hint: 'Só segue se a saída de uma etapa contiver um texto.', matches: (step) => step.kind === 'condition', create: (id) => ({ ...base(id, 'Condição'), kind: 'condition', when: { step: id, contains: 'texto' } }) },
];

function freeId(definition: WorkflowDefinitionV2, prefix: string): string {
  const used = new Set(definition.steps.map((step) => step.id));
  for (let n = definition.steps.length + 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

export function createStep(kind: NodeKind, definition: WorkflowDefinitionV2): WorkflowStep {
  const entry = NODE_CATALOG.find((item) => item.kind === kind);
  if (!entry) throw new Error(`Bloco desconhecido: ${kind}`);
  return entry.create(freeId(definition, 'step'));
}

/** Would making `source` run before `target` close a loop? */
function reaches(definition: WorkflowDefinitionV2, from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    if (current === to) return true;
    seen.add(current);
    stack.push(...(definition.steps.find((step) => step.id === current)?.dependsOn ?? []));
  }
  return false;
}

export function addDependency(definition: WorkflowDefinitionV2, source: string, target: string): WorkflowDefinitionV2 {
  if (source === target || reaches(definition, source, target)) return definition;
  return { ...definition, steps: definition.steps.map((step) => {
    if (step.id !== target || step.dependsOn.includes(source)) return step;
    const linked = { ...step, dependsOn: [...step.dependsOn, source] };
    return linked.kind === 'condition' && linked.when.step === linked.id ? { ...linked, when: { ...linked.when, step: source } } : linked;
  }) };
}

export function removeDependency(definition: WorkflowDefinitionV2, source: string, target: string): WorkflowDefinitionV2 {
  return { ...definition, steps: definition.steps.map((step) => (step.id === target ? { ...step, dependsOn: step.dependsOn.filter((id) => id !== source) } : step)) };
}

/** Removes steps and the links to them. The last step stays: a workflow needs one. */
export function removeSteps(definition: WorkflowDefinitionV2, ids: readonly string[]): WorkflowDefinitionV2 {
  const gone = new Set(ids);
  const steps = definition.steps.filter((step) => !gone.has(step.id)).map((step) => ({ ...step, dependsOn: step.dependsOn.filter((id) => !gone.has(id)) }));
  return steps.length ? { ...definition, steps } : definition;
}

export function duplicateStep(definition: WorkflowDefinitionV2, id: string): WorkflowDefinitionV2 {
  const original = definition.steps.find((step) => step.id === id);
  if (!original) return definition;
  return { ...definition, steps: [...definition.steps, { ...original, id: freeId(definition, id.replace(/-\d+$/, '')), title: `${original.title} (cópia)` }] };
}
