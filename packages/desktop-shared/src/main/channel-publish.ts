import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { VelixChannelRepository } from '@neuralbridge/database';
import type { YouTubeChannelClient } from '@neuralbridge/orchestrator';
import { validatePublishInput } from '@neuralbridge/shared';

export type ChannelPublishInput = { projectId: string; rootPath: string; outputRelativePath: string; thumbnailRelativePath?: string; title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null; id: string; onUploadCheckpoint?: (sessionUrl: string, offset: number) => void; };
/** Job progress while bytes go up: 5% for the session, 90% spread over the bytes, the last 5% for the thumbnail and records. */
export const uploadProgress = (offset: number, total: number) => Math.min(95, 5 + Math.floor((offset / Math.max(total, 1)) * 90));
export async function runChannelPublication(input: ChannelPublishInput, client: YouTubeChannelClient, repository: VelixChannelRepository, signal: AbortSignal): Promise<string> {
  validatePublishInput(input);
  const video = resolve(input.rootPath, input.outputRelativePath); const videoRel = relative(input.rootPath, video); if (!videoRel || videoRel.startsWith('..') || isAbsolute(videoRel) || !existsSync(video)) throw new Error('forbidden: MP4 fora do projeto ou inexistente.');
  const base = { schemaVersion: 1 as const, id: input.id, videoAssetId: input.outputRelativePath, title: input.title, description: input.description, tags: input.tags, thumbnailPath: input.thumbnailRelativePath ?? null, privacy: input.privacy, publishAt: input.publishAt, categoryId: '22', madeForKids: false, scores: { title: 0, description: 0, tags: 0 } };
  repository.updatePublicationJob(input.id, { status: 'uploading', progress: 5 }); repository.savePublication(input.projectId, { ...base, status: 'uploading', youtubeVideoId: null });
  try {
    const bytes = readFileSync(video);
    const uploaded = await client.uploadVideo({ snippet: { title: input.title, description: input.description, tags: input.tags, categoryId: '22' }, status: { privacyStatus: input.privacy, ...(input.publishAt ? { publishAt: input.publishAt } : {}), selfDeclaredMadeForKids: false } }, bytes, signal, (sessionUrl, offset) => { repository.updatePublicationJob(input.id, { status: 'uploading', progress: uploadProgress(offset, bytes.byteLength) }); input.onUploadCheckpoint?.(sessionUrl, offset); });
    repository.updatePublicationJob(input.id, { status: 'uploading', progress: 96 });
    if (input.thumbnailRelativePath) { const thumbnail = resolve(input.rootPath, input.thumbnailRelativePath); const thumbnailRel = relative(input.rootPath, thumbnail); if (!thumbnailRel || thumbnailRel.startsWith('..') || isAbsolute(thumbnailRel) || !existsSync(thumbnail)) throw new Error('forbidden: thumbnail fora do projeto ou inexistente.'); const thumbnailBytes = readFileSync(thumbnail); if (thumbnailBytes.byteLength > 2 * 1024 * 1024) throw new Error('invalid: thumbnail excede 2 MB.'); const lower = thumbnail.toLowerCase(); const contentType = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : null; if (!contentType) throw new Error('invalid: thumbnail precisa ser PNG ou JPEG.'); await client.uploadThumbnail(uploaded.id, thumbnailBytes, contentType, signal); }
    const status = input.publishAt ? 'scheduled' : 'uploaded'; repository.savePublication(input.projectId, { ...base, status, youtubeVideoId: uploaded.id });
    if (input.publishAt) repository.saveAgendaItem(input.projectId, { schemaVersion: 1, id: `publication:${input.id}`, origin: 'youtube', title: input.title, at: input.publishAt, state: 'scheduled', ideaId: null, productionId: null });
    repository.updatePublicationJob(input.id, { status: 'completed', progress: 100, checkpoint: null, checkpointOffset: null }); return uploaded.id;
  } catch (error) { const cancelled = signal.aborted; repository.savePublication(input.projectId, { ...base, status: cancelled ? 'cancelled' : 'failed', youtubeVideoId: null }); repository.updatePublicationJob(input.id, { status: cancelled ? 'cancelled' : 'failed', error: cancelled ? 'Cancelado pelo usuário.' : error instanceof Error ? error.message : String(error) }); throw error; }
}
