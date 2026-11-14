import { z } from 'zod';

export const azureDevOpsConnectionInputSchema = z.strictObject({
  baseUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), 'URL HTTP(S) inválida').transform((value) => value.replace(/\/$/, '')),
  collection: z.string().trim().min(1).max(200),
  project: z.string().trim().min(1).max(200),
  readOnly: z.boolean().default(true),
});
export type AzureDevOpsConnectionInput = z.infer<typeof azureDevOpsConnectionInputSchema>;

export const azureDevOpsConnectionStatusSchema = z.enum(['disconnected', 'login_required', 'connected', 'expired', 'forbidden', 'unavailable']);
export type AzureDevOpsConnectionStatus = z.infer<typeof azureDevOpsConnectionStatusSchema>;

export const azureDevOpsCapabilitiesSchema = z.strictObject({
  apiVersion: z.string().nullable(),
  projects: z.boolean(), repositories: z.boolean(), pullRequests: z.boolean(), workItems: z.boolean(), boards: z.boolean(), iterations: z.boolean(),
});
export type AzureDevOpsCapabilities = z.infer<typeof azureDevOpsCapabilitiesSchema>;

export const azureDevOpsErrorSchema = z.strictObject({ code: z.string(), message: z.string(), status: z.number().int().nullable() });
export type AzureDevOpsError = z.infer<typeof azureDevOpsErrorSchema>;

export type AzureDevOpsPullRequest = { id: number; title: string; status: string; createdBy: string | null; sourceRef: string; targetRef: string; url: string | null; updatedAt: string | null };
export type AzureDevOpsPullRequestDetail = AzureDevOpsPullRequest & { description: string | null; mergeStatus: string | null; reviewers: string[] };
export type AzureDevOpsPullRequestThread = { id: number; status: string; comments: Array<{ id: number; author: string | null; content: string; publishedAt: string | null }> };
export type AzureDevOpsPullRequestChange = { path: string; changeType: string; objectId: string | null; url: string | null; content: string | null; baseContent: string | null; targetContent: string | null };
export type AzureDevOpsWorkItemAttachment = { id: string; name: string; contentType: string | null; size: number | null };
export type AzureDevOpsWorkItem = { id: number; title: string; description: string | null; state: string; type: string; assignedTo: string | null; parentId: number | null; url: string | null; originalEstimate: number | null; remainingWork: number | null; completedWork: number | null; commits: Array<{ id: string; message: string; url: string | null }>; attachments: AzureDevOpsWorkItemAttachment[] };
export type AzureDevOpsProject = { id: string; name: string; url: string | null; state: string | null };
export type AzureDevOpsRepository = { id: string; name: string; url: string | null; projectId: string | null; projectName: string | null };
export type AzureDevOpsBoard = { id: string; name: string; url: string | null };
export type AzureDevOpsWriteDraft = { operationId: string; action: 'comment_pr' | 'set_pr_status' | 'create_work_item' | 'update_work_item'; target: string; summary: string; requiresApproval: true };
export const azureDevOpsWriteRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('comment_pr'), repositoryId: z.string().trim().min(1).max(200), pullRequestId: z.number().int().positive(), content: z.string().trim().min(1).max(10_000) }),
  z.strictObject({ action: z.literal('set_pr_status'), repositoryId: z.string().trim().min(1).max(200), pullRequestId: z.number().int().positive(), status: z.enum(['active', 'completed', 'abandoned']) }),
  z.strictObject({ action: z.literal('create_work_item'), type: z.enum(['Task', 'User Story']), title: z.string().trim().min(1).max(250), description: z.string().trim().max(20_000), parentId: z.number().int().positive().nullable().optional() }),
  z.strictObject({ action: z.literal('update_work_item'), workItemId: z.number().int().positive(), title: z.string().trim().min(1).max(250).optional(), description: z.string().trim().max(20_000).optional(), state: z.string().trim().min(1).max(80).optional() }).refine((value) => value.title !== undefined || value.description !== undefined || value.state !== undefined, 'Informe pelo menos um campo para atualizar.'),
]);
export type AzureDevOpsWriteRequest = z.infer<typeof azureDevOpsWriteRequestSchema>;

export function redactAzureDevOpsError(error: unknown): AzureDevOpsError {
  if (error instanceof Error) return { code: 'request_failed', message: error.message.replace(/(authorization|cookie|token|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]'), status: null };
  return { code: 'request_failed', message: 'Falha desconhecida no TFS.', status: null };
}
