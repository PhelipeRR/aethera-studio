import { z } from 'zod';

const collageRequestSchema = z.strictObject({
  projectId: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(3).max(1_000),
  durationSeconds: z.number().finite().min(2).max(30),
  aspectRatio: z.enum(['16:9', '9:16']),
});
export type CollageRequest = z.infer<typeof collageRequestSchema>;

export const collageArtifactSchema = z.strictObject({
  mimeType: z.enum(['image/png', 'video/mp4']),
  bytes: z.instanceof(Uint8Array),
  durationSeconds: z.number().finite().positive().nullable(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
});
export type CollageArtifact = z.infer<typeof collageArtifactSchema>;

export type CollageMetaphor = { approvalText: string; visualPrompt: string; estimatedSeconds: number };
export type CollageProvider = {
  proposeMetaphor(request: CollageRequest): Promise<CollageMetaphor>;
  createStill(request: CollageRequest, metaphor: CollageMetaphor): Promise<CollageArtifact>;
  generateClip(request: CollageRequest, still: CollageArtifact): Promise<CollageArtifact>;
};

export type CollageApprovalState = 'draft' | 'metaphor_approved' | 'still_approved' | 'generating' | 'completed' | 'rejected';
export function advanceCollageApproval(state: CollageApprovalState, action: 'approve-metaphor' | 'approve-still' | 'start-generation' | 'complete' | 'reject'): CollageApprovalState {
  if (action === 'reject') return 'rejected';
  const next: Record<CollageApprovalState, Partial<Record<typeof action, CollageApprovalState>>> = {
    draft: { 'approve-metaphor': 'metaphor_approved' }, metaphor_approved: { 'approve-still': 'still_approved' }, still_approved: { 'start-generation': 'generating' }, generating: { complete: 'completed' }, completed: {}, rejected: {},
  };
  const result = next[state][action];
  if (!result) throw new Error(`transição de colagem inválida: ${state} → ${action}`);
  return result;
}

export function validateCollageRequest(input: unknown): CollageRequest {
  return collageRequestSchema.parse(input);
}

export function estimateCollageCost(request: CollageRequest): { currency: 'USD'; amount: number; label: string } {
  const amount = Number((0.04 + request.durationSeconds * 0.012).toFixed(2));
  return { currency: 'USD', amount, label: `Custo estimado: US$ ${amount.toFixed(2)} (a cobrança só ocorre após aprovação)` };
}

export function requireCollageProviderConfigured(configured: boolean): void {
  if (!configured) throw new Error('unavailable: configure a chave Gemini para usar a Colagem editorial com IA.');
}

export function createFakeCollageProvider(): CollageProvider {
  return {
    async proposeMetaphor(request) { return { approvalText: `Metáfora editorial: ${request.prompt}`, visualPrompt: `colagem de papel editorial, ${request.prompt}`, estimatedSeconds: request.durationSeconds }; },
    async createStill(request, metaphor) { return collageArtifactSchema.parse({ mimeType: 'image/png', bytes: new TextEncoder().encode(`PNG:${request.aspectRatio}:${metaphor.visualPrompt}`), durationSeconds: null, sha256: null }); },
    async generateClip(request) { return collageArtifactSchema.parse({ mimeType: 'video/mp4', bytes: new TextEncoder().encode(`MP4:${request.projectId}:${request.durationSeconds}`), durationSeconds: request.durationSeconds, sha256: null }); },
  };
}
