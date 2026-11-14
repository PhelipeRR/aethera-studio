import { z } from 'zod';
import { AGENT_IDS, RUN_MODES } from './domain.js';

export const WORKFLOW_MAX_STEPS = 32;
export const WORKFLOW_MAX_PARALLEL = 4;
export const EXECUTABLE_STEP_KINDS = ['agent', 'approval'] as const;
export type WorkflowStepKind = 'agent' | 'approval' | 'rag' | 'validation' | 'git' | 'condition';
export type WorkflowAccess = 'read-only' | 'edit';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const inputSchema = z.strictObject({ id, label: z.string().trim().min(1).max(120), required: z.boolean() });
export const WORKFLOW_FAILURE_KINDS = ['rate_limit', 'provider_overloaded', 'network', 'timeout', 'usage_limit', 'context_limit', 'authentication', 'permission', 'execution'] as const;
export type WorkflowFailureKind = (typeof WORKFLOW_FAILURE_KINDS)[number];
const failureKind = z.enum(WORKFLOW_FAILURE_KINDS);
const recoverySchema = z.strictObject({
  retry: z.strictObject({ maxAttempts: z.number().int().min(1).max(10), baseDelayMs: z.number().int().min(0).max(600_000), maxDelayMs: z.number().int().min(0).max(3_600_000), maxTotalMs: z.number().int().min(0).max(86_400_000), jitter: z.literal('full'), on: z.array(failureKind).max(WORKFLOW_FAILURE_KINDS.length) }).optional(),
  fallback: z.strictObject({ to: z.enum(AGENT_IDS), on: z.array(failureKind).max(WORKFLOW_FAILURE_KINDS.length), allowEdit: z.boolean() }).optional(),
  autoResume: z.boolean().optional(),
});
export type WorkflowRecovery = z.infer<typeof recoverySchema>;
const base = { id, title: z.string().trim().min(1).max(120), dependsOn: z.array(id).max(WORKFLOW_MAX_STEPS), requiresApproval: z.boolean(), timeoutMs: z.number().int().positive().optional(), recovery: recoverySchema.optional() };
const agentStepSchema = z.strictObject({ ...base, kind: z.literal('agent'), prompt: z.string().trim().min(1).max(20_000), agent: z.enum(AGENT_IDS).or(z.literal('auto')), mode: z.enum(RUN_MODES), access: z.enum(['read-only', 'edit']), skillIds: z.array(z.string().min(1)).max(32).optional(), requiredSkillIds: z.array(z.string().min(1)).max(32).optional(), allowedPaths: z.array(z.string().min(1).max(256)).max(64).optional() });
const approvalStepSchema = z.strictObject({ ...base, kind: z.literal('approval'), message: z.string().trim().min(1).max(20_000) });
const plannedStepSchema = z.union([
  z.strictObject({ ...base, kind: z.literal('rag'), query: z.string(), topK: z.number().int().positive() }),
  z.strictObject({ ...base, kind: z.literal('validation'), command: z.string() }),
  z.strictObject({ ...base, kind: z.literal('git'), action: z.enum(['status', 'diff', 'log', 'diff-range']) }),
  // Closed grammar on purpose: a condition is data, never an expression to evaluate.
  z.strictObject({ ...base, kind: z.literal('condition'), when: z.strictObject({ step: id, contains: z.string().min(1).max(500) }) }),
]);
export const workflowStepSchema = z.union([agentStepSchema, approvalStepSchema, plannedStepSchema]);
export const workflowDefinitionSchema = z.strictObject({ schemaVersion: z.literal(2), name: z.string().trim().min(1).max(120), projectId: z.string().min(1).nullable(), maxParallel: z.number().int().min(1).max(WORKFLOW_MAX_PARALLEL), inputs: z.array(inputSchema).max(32), steps: z.array(workflowStepSchema).min(1).max(WORKFLOW_MAX_STEPS), recovery: recoverySchema.optional(), limits: z.strictObject({ maxDurationMs: z.number().int().positive().optional(), maxTokens: z.number().int().positive().optional() }).optional() });
const v1StepSchema = z.strictObject({ id, title: z.string().trim().min(1).max(120), prompt: z.string().trim().min(1).max(20_000), agent: z.enum(AGENT_IDS).or(z.literal('auto')), mode: z.enum(RUN_MODES), dependsOn: z.array(id).max(WORKFLOW_MAX_STEPS), requiresApproval: z.boolean() });
const v1Schema = z.strictObject({ name: z.string().trim().min(1).max(120), projectId: z.string().min(1).nullable(), steps: z.array(v1StepSchema).min(1).max(WORKFLOW_MAX_STEPS), maxParallel: z.number().int().min(1).max(WORKFLOW_MAX_PARALLEL) });
export const workflowDefinitionInputSchema = z.union([workflowDefinitionSchema, v1Schema]);

export type WorkflowInput = z.infer<typeof inputSchema>;
export type WorkflowAgentStep = z.infer<typeof agentStepSchema>;
export type WorkflowApprovalStep = z.infer<typeof approvalStepSchema>;
export type WorkflowPlannedStep = z.infer<typeof plannedStepSchema>;
export type WorkflowStep = WorkflowAgentStep | WorkflowApprovalStep | WorkflowPlannedStep;
export type WorkflowDefinitionV2 = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowDefinitionV1 = z.infer<typeof v1Schema>;
export type WorkflowDefinition = WorkflowDefinitionV2 | WorkflowDefinitionV1;
export type WorkflowSummary = { id: string; name: string; projectId: string | null; version: number; updatedAt: string };
export type WorkflowRunSummary = { id: string; workflowId: string; status: 'pending' | 'running' | 'waiting_approval' | 'paused' | 'retrying' | 'interrupted' | 'completed' | 'failed' | 'cancelled'; currentLayer: number; taskIds: string[]; error: string | null; updatedAt: string };

export type WorkflowIssue = { stepId?: string; edge?: { from: string; to: string }; code: string; message: string };

export function normalizeWorkflow(input: unknown): WorkflowDefinitionV2 {
  const parsed = workflowDefinitionSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const legacy = v1Schema.parse(input);
  return { schemaVersion: 2, name: legacy.name, projectId: legacy.projectId, maxParallel: legacy.maxParallel, inputs: [], steps: legacy.steps.map((step) => ({ ...step, kind: 'agent' as const, access: legacy.projectId === null ? 'read-only' as const : 'edit' as const })) };
}

function validateDefinition(input: unknown): { definition: WorkflowDefinitionV2; issues: WorkflowIssue[] } {
  let definition: WorkflowDefinitionV2;
  try { definition = normalizeWorkflow(input); } catch (error) { return { definition: undefined as never, issues: [{ code: 'schema', message: error instanceof Error ? error.message : String(error) }] }; }
  const issues: WorkflowIssue[] = [];
  const byId = new Map(definition.steps.map((step) => [step.id, step]));
  if (byId.size !== definition.steps.length) issues.push({ code: 'duplicate', message: 'Workflow step duplicated.' });
  for (const step of definition.steps) {
    if (step.kind === 'condition' && !step.dependsOn.includes(step.when.step)) issues.push({ stepId: step.id, code: 'condition_dependency', message: `A condição ${step.id} precisa depender de ${step.when.step}.` });
    if (step.kind === 'agent' && step.access === 'edit' && definition.projectId === null) issues.push({ stepId: step.id, code: 'project_required', message: 'Etapa edit exige projectId.' });
    if (step.kind === 'agent' && step.allowedPaths && step.access !== 'edit') issues.push({ stepId: step.id, code: 'allowed_paths_access', message: 'allowedPaths exige access edit.' });
    for (const dependency of step.dependsOn) if (!byId.has(dependency) || dependency === step.id) issues.push({ stepId: step.id, edge: { from: dependency, to: step.id }, code: 'dependency', message: `Workflow dependency is invalid: ${dependency}.` });
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (stepId: string) => { if (visiting.has(stepId)) { issues.push({ stepId, code: 'cycle', message: 'Workflow dependencies contain a cycle.' }); return; } if (visited.has(stepId)) return; visiting.add(stepId); for (const dep of byId.get(stepId)?.dependsOn ?? []) if (byId.has(dep)) visit(dep); visiting.delete(stepId); visited.add(stepId); };
  for (const step of definition.steps) visit(step.id);
  for (const step of definition.steps) if (step.kind === 'agent') for (const match of step.prompt.matchAll(/\{\{\s*steps\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.output\s*\}\}/g)) {
    const target = match[1]; const reachable = new Set<string>(); const stack = [...step.dependsOn];
    while (stack.length) { const current = stack.pop(); if (!current || reachable.has(current)) continue; reachable.add(current); stack.push(...(byId.get(current)?.dependsOn ?? [])); }
    if (!target || !reachable.has(target)) issues.push({ stepId: step.id, code: 'interpolation_dependency', message: `A etapa ${step.id} não pode referenciar ${target ?? 'desconhecida'}.` });
  }
  return { definition, issues };
}

export function validateWorkflow(input: unknown): { ok: boolean; issues: WorkflowIssue[] } { const result = validateDefinition(input); return { ok: result.issues.length === 0, issues: result.issues }; }

export function compileWorkflow(input: unknown): { definition: WorkflowDefinitionV2; layers: WorkflowStep[][] } {
  const result = validateDefinition(input); if (result.issues.length) throw new Error(result.issues.map((issue) => issue.message).join(' '));
  const definition = result.definition; const remaining = new Set(definition.steps.map((step) => step.id)); const completed = new Set<string>(); const layers: WorkflowStep[][] = [];
  while (remaining.size) { const ready = definition.steps.filter((step) => remaining.has(step.id) && step.dependsOn.every((dependency) => completed.has(dependency))); if (!ready.length) throw new Error('Workflow dependencies contain a cycle'); for (let i = 0; i < ready.length; i += definition.maxParallel) { const layer = ready.slice(i, i + definition.maxParallel); layers.push(layer); for (const step of layer) { remaining.delete(step.id); completed.add(step.id); } } }
  return { definition, layers };
}

const OUTPUT_LIMIT = 8 * 1024;
function safeOutput(value: unknown): string { const raw = String(value ?? '').replaceAll('{{/untrusted}}', '[closed-delimiter-neutralized]'); return raw.length > OUTPUT_LIMIT ? `${raw.slice(0, OUTPUT_LIMIT - 14)}…[truncated]` : raw; }
export function interpolate(template: string, context: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }): string { return template.replace(/\{\{\s*(inputs\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})|steps\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.output)\s*\}\}/g, (_match, _expression: string, inputId?: string, stepId?: string) => `{{untrusted}}${safeOutput(inputId ? context.inputs[inputId] : context.outputs[stepId ?? ''])}{{/untrusted}}`); }
