import { z } from 'zod';

const planStepKind = z.enum(['research', 'script', 'storyboard', 'narration', 'sync', 'composition', 'quality', 'preview']);
export const aetheraProductionPlanSchema = z.strictObject({
  schemaVersion: z.literal(1), status: z.enum(['ready', 'needs_questions']), command: z.string(), topic: z.string().nullable(), durationMinutes: z.number().positive().nullable(),
  questions: z.array(z.strictObject({ id: z.string(), prompt: z.string(), reason: z.string() })),
  steps: z.array(z.strictObject({ id: z.string(), kind: planStepKind, status: z.literal('planned'), dependsOn: z.array(z.string()) })),
  approvals: z.array(z.enum(['sources', 'editorial-preview', 'export'])),
  voice: z.strictObject({ presetId: z.literal('aethera-voz-dinamica'), modelId: z.literal('OmniVoice'), scope: z.literal('noncommercial') }),
  mediaPolicy: z.literal('reuse-downloaded-only'),
});
export type AetheraProductionPlan = z.infer<typeof aetheraProductionPlanSchema>;

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR');

/** Parses only the bounded production vocabulary; execution still happens through the persisted production service. */
export function planAetheraProductionCommand(input: { command: string }): AetheraProductionPlan {
  const command = input.command.trim();
  const normalized = normalize(command);
  const topicMatch = /\bsobre\s+(.+?)(?=,|\s+em\s+|\.|$)/iu.exec(command);
  const topic = topicMatch?.[1]?.trim() || null;
  const duration = /\b(\d+(?:[.,]\d+)?)\s*min/iu.exec(command)?.[1];
  const durationMinutes = duration ? Number(duration.replace(',', '.')) : null;
  if (!topic) return aetheraProductionPlanSchema.parse({ schemaVersion: 1, status: 'needs_questions', command, topic: null, durationMinutes, questions: [{ id: 'topic', prompt: 'Qual é o tema da produção?', reason: 'O plano não cria fatos nem escolhe um tema por conta própria.' }], steps: [], approvals: ['sources', 'editorial-preview', 'export'], voice: { presetId: 'aethera-voz-dinamica', modelId: 'OmniVoice', scope: 'noncommercial' }, mediaPolicy: 'reuse-downloaded-only' });
  const steps: AetheraProductionPlan['steps'] = [
    { id: 'research', kind: 'research', status: 'planned', dependsOn: [] },
    { id: 'script', kind: 'script', status: 'planned', dependsOn: ['research'] },
    { id: 'storyboard', kind: 'storyboard', status: 'planned', dependsOn: ['script'] },
    { id: 'narration', kind: 'narration', status: 'planned', dependsOn: ['script'] },
    { id: 'sync', kind: 'sync', status: 'planned', dependsOn: ['storyboard', 'narration'] },
    { id: 'composition', kind: 'composition', status: 'planned', dependsOn: ['sync'] },
    { id: 'quality', kind: 'quality', status: 'planned', dependsOn: ['composition'] },
    { id: 'preview', kind: 'preview', status: 'planned', dependsOn: ['quality'] },
  ];
  const approvals: AetheraProductionPlan['approvals'] = ['sources', 'editorial-preview', 'export'];
  void normalized;
  return aetheraProductionPlanSchema.parse({ schemaVersion: 1, status: 'ready', command, topic, durationMinutes, questions: [], steps, approvals, voice: { presetId: 'aethera-voz-dinamica', modelId: 'OmniVoice', scope: 'noncommercial' }, mediaPolicy: 'reuse-downloaded-only' });
}
