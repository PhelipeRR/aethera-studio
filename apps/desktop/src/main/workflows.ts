import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { workflowCheckpoints, workflowRuns, workflowRunSteps, workflowTemplateFavorites, workflowTemplates as templateRows, workflows, type DatabaseHandle } from '@neuralbridge/database';
import { createWorkflowCoordinator, type WorkflowCoordinatorPorts, type WorkflowDecision, type WorkflowTrigger } from '@neuralbridge/orchestrator';
import { compileWorkflow, getWorkflowTemplate, instantiateWorkflow, normalizeWorkflow, workflowTemplates, type WorkflowDefinition } from '@neuralbridge/shared';

type WorkflowHost = Omit<WorkflowCoordinatorPorts, 'handle'>;

export function createWorkflowService({ handle }: { handle: DatabaseHandle | null }) {
  const need = () => {
    if (!handle) throw new Error('unavailable: O banco de dados está indisponível.');
    return handle;
  };
  const parse = (raw: string): WorkflowDefinition => compileWorkflow(JSON.parse(raw)).definition;
  let coordinator: ReturnType<typeof createWorkflowCoordinator> | null = null;
  const running = () => {
    if (!coordinator) throw new Error('unavailable: A execução de workflows não está disponível.');
    return coordinator;
  };
  return {
    templates() { return workflowTemplates.map((template) => ({ id: template.id, version: template.version, name: template.name, category: template.category, description: template.description, requirements: template.requirements, source: 'builtin' })); },
    instantiateTemplate(templateId: string, projectId: string | null) {
      const template = getWorkflowTemplate(templateId);
      if (!template) throw new Error('not_found: Template não encontrado.');
      return { templateId, version: template.version, definition: instantiateWorkflow(template, projectId) };
    },
    favoriteTemplate(templateId: string, favorite: boolean) {
      const db = need().db;
      const builtin = getWorkflowTemplate(templateId);
      if (builtin && !db.select({ id: templateRows.id }).from(templateRows).where(eq(templateRows.id, templateId)).get()) db.insert(templateRows).values({ id: builtin.id, version: builtin.version, name: builtin.name, category: builtin.category, description: builtin.description, requirements: JSON.stringify(builtin.requirements), definition: JSON.stringify(builtin.definition), source: 'builtin' }).run();
      if (favorite) db.insert(workflowTemplateFavorites).values({ templateId }).onConflictDoNothing().run();
      else db.delete(workflowTemplateFavorites).where(eq(workflowTemplateFavorites.templateId, templateId)).run();
      return { ok: true as const };
    },
    exportTemplate(templateId: string) {
      const template = getWorkflowTemplate(templateId);
      if (!template) throw new Error('not_found: Template não encontrado.');
      return JSON.stringify({ id: template.id, version: template.version, name: template.name, category: template.category, description: template.description, requirements: template.requirements, definition: template.definition });
    },
    importTemplate(payload: string) {
      let value: unknown;
      try { value = JSON.parse(payload); } catch { throw new Error('invalid: Template JSON inválido.'); }
      if (!value || typeof value !== 'object' || !('id' in value) || !('definition' in value)) throw new Error('invalid: Template incompleto.');
      const input = value as { id: unknown; version?: unknown; name?: unknown; category?: unknown; description?: unknown; requirements?: unknown; definition: unknown };
      const definition = normalizeWorkflow(input.definition);
      const id = typeof input.id === 'string' ? input.id.slice(0, 100) : '';
      if (!id) throw new Error('invalid: Identificador de template ausente.');
      const version = typeof input.version === 'number' ? input.version : 1;
      need().db.insert(templateRows).values({ id, version, name: typeof input.name === 'string' ? input.name : id, category: typeof input.category === 'string' ? input.category : 'imported', description: typeof input.description === 'string' ? input.description : '', requirements: JSON.stringify(Array.isArray(input.requirements) ? input.requirements : []), definition: JSON.stringify(definition), source: 'imported' }).onConflictDoUpdate({ target: templateRows.id, set: { version, definition: JSON.stringify(definition), source: 'imported' } }).run();
      return { id, version };
    },
    saveLayout(id: string, layout: string) {
      need().db.update(workflows).set({ layout, updatedAt: new Date().toISOString() }).where(eq(workflows.id, id)).run();
      return { ok: true as const };
    },
    list(projectId?: string) {
      const rows = need().db.select().from(workflows).where(projectId ? eq(workflows.projectId, projectId) : undefined).orderBy(desc(workflows.updatedAt)).all();
      return rows.map(({ id, name, projectId: owner, version, updatedAt }) => ({ id, name, projectId: owner, version, updatedAt }));
    },
    get(id: string) {
      const row = need().db.select().from(workflows).where(eq(workflows.id, id)).get();
      if (!row) throw new Error('not_found: Workflow não encontrado.');
      return { id: row.id, definition: parse(row.definition), version: row.version, layout: row.layout, updatedAt: row.updatedAt };
    },
    save(id: string | undefined, definition: WorkflowDefinition) {
      const checked = compileWorkflow(definition).definition;
      const db = need().db;
      const existing = id ? db.select().from(workflows).where(eq(workflows.id, id)).get() : undefined;
      const workflowId = id ?? randomUUID();
      if (existing) db.update(workflows).set({ name: checked.name, projectId: checked.projectId, definition: JSON.stringify(checked), version: existing.version + 1, updatedAt: new Date().toISOString() }).where(eq(workflows.id, workflowId)).run();
      else db.insert(workflows).values({ id: workflowId, name: checked.name, projectId: checked.projectId, definition: JSON.stringify(checked) }).run();
      return { id: workflowId, version: existing ? existing.version + 1 : 1 };
    },
    remove(id: string) {
      need().db.delete(workflows).where(eq(workflows.id, id)).run();
      return { ok: true as const };
    },
    runs(workflowId?: string) {
      const rows = need().db.select().from(workflowRuns).where(workflowId ? eq(workflowRuns.workflowId, workflowId) : undefined).orderBy(desc(workflowRuns.updatedAt)).all();
      return rows.map((row) => ({ id: row.id, workflowId: row.workflowId, status: row.status, currentLayer: row.currentLayer, taskIds: JSON.parse(row.taskIds) as string[], error: row.error, updatedAt: row.updatedAt }));
    },
    timeline(runId: string) {
      return need().db.select().from(workflowCheckpoints).where(eq(workflowCheckpoints.runId, runId)).all().sort((a, b) => a.sequence - b.sequence).map((row) => ({ sequence: row.sequence, completed: JSON.parse(row.completed) as string[], pending: JSON.parse(row.pending) as string[], recoveryMeta: JSON.parse(row.recoveryMeta) as Record<string, unknown>, createdAt: row.createdAt }));
    },
    /** The app wires tasks in after they exist; the catalogue above works without them. */
    bind(host: WorkflowHost) {
      coordinator = createWorkflowCoordinator({ handle: need(), ...host });
    },
    steps(runId: string) {
      return need().db.select().from(workflowRunSteps).where(eq(workflowRunSteps.runId, runId)).all().map(({ stepId, status, taskId, error }) => ({ stepId, status, taskId, error }));
    },
    taskEvent(taskId: string, status: string, error: string | null = null) {
      return coordinator?.onTask(taskId, status, error);
    },
    recover() {
      return running().recover();
    },
    async run(id: string, approved: boolean, options: { inputs?: Record<string, unknown>; trigger?: WorkflowTrigger } = {}) {
      if (!approved) throw new Error('approval_required: O workflow precisa de aprovação explícita antes da execução.');
      const workflow = this.get(id);
      return { runId: await running().start(id, normalizeWorkflow(workflow.definition), workflow.version, options) };
    },
    async pause(runId: string) { await running().pause(runId); return { ok: true as const }; },
    async resume(runId: string) { await running().resume(runId); return { ok: true as const }; },
    async cancel(runId: string) { await running().cancel(runId); return { ok: true as const }; },
    async approveStep(runId: string, stepId: string) { await running().approve(runId, stepId); return { ok: true as const }; },
    async rejectStep(runId: string, stepId: string) { await running().reject(runId, stepId); return { ok: true as const }; },
    async decideStep(runId: string, stepId: string, choice: WorkflowDecision) { await running().decide(runId, stepId, choice); return { ok: true as const }; },
  };
}
