import { z } from 'zod';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const channelResponse = z.object({ items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string(), customUrl: z.string().nullable().optional() }).passthrough(), brandingSettings: z.unknown().optional() }).passthrough()).max(10) }).passthrough();
const videosResponse = z.object({ items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }).passthrough(), status: z.object({ privacyStatus: z.enum(['private', 'unlisted', 'public']), publishAt: z.string().datetime().nullable().optional() }).passthrough() }).passthrough()).max(50) }).passthrough();
const videoStatisticsResponse = z.object({ items: z.array(z.object({ id: z.string(), statistics: z.object({ viewCount: z.string().regex(/^\d+$/).optional(), likeCount: z.string().regex(/^\d+$/).optional(), commentCount: z.string().regex(/^\d+$/).optional() }).passthrough() }).passthrough()).max(1) }).passthrough();
const searchResponse = z.object({ items: z.array(z.object({ id: z.object({ videoId: z.string() }), snippet: z.object({ title: z.string() }).passthrough() }).passthrough()).max(50) }).passthrough();
/** Data API for metadata; bytes (videos and thumbnails) go to the separate upload endpoint, as the API requires. */
export interface YouTubeEndpoints { api: string; upload: string; }
export const YOUTUBE_ENDPOINTS: YouTubeEndpoints = { api: 'https://www.googleapis.com/youtube/v3', upload: 'https://www.googleapis.com/upload/youtube/v3' };
// An override is only for a local stand-in: anything else must be https.
const endpointBase = (value: string) => { const url = new URL(value.replace(/\/+$/, '')); const loopback = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'); if (url.protocol !== 'https:' && !loopback) throw new Error('invalid: endpoint do YouTube inseguro.'); return url; };
const within = (base: URL, path: string) => { const url = new URL(path.replace(/^\/+/, ''), `${base.toString()}/`); if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`)) throw new Error('invalid: URL do YouTube fora da API oficial.'); return url; };
// Only Google's reason codes are read from an error body; its free text never reaches the person or a log.
const errorBody = z.object({ error: z.object({ errors: z.array(z.object({ reason: z.string() }).passthrough()).optional(), status: z.string().optional() }).passthrough() }).passthrough();
const REASONS: Record<string, string> = {
  quotaExceeded: 'quota: a cota diária da API do YouTube acabou. Tente de novo amanhã.',
  dailyLimitExceeded: 'quota: a cota diária da API do YouTube acabou. Tente de novo amanhã.',
  rateLimitExceeded: 'quota: o YouTube pediu para esperar antes de novas chamadas.',
  uploadLimitExceeded: 'quota: o canal atingiu o limite de envios do YouTube por agora.',
  accessNotConfigured: 'unavailable: ative a YouTube Data API v3 no projeto do Google Cloud (console.cloud.google.com/apis/library/youtube.googleapis.com).',
  SERVICE_DISABLED: 'unavailable: ative a YouTube Data API v3 no projeto do Google Cloud (console.cloud.google.com/apis/library/youtube.googleapis.com).',
  insufficientPermissions: 'scope_required: autorize a escrita no canal em "Permitir envio e edição".',
  youtubeSignupRequired: 'not_found: esta conta Google ainda não tem um canal no YouTube.',
  channelNotFound: 'not_found: esta conta Google ainda não tem um canal no YouTube.',
};
/** Turns a failed YouTube answer into an actionable message, keyed by status and Google's reason code. */
export async function youtubeFailure(response: Response, context = ''): Promise<Error> {
  let reasons: string[] = [];
  try { const parsed = errorBody.safeParse(await response.json()); if (parsed.success) reasons = [...(parsed.data.error.errors ?? []).map((item) => item.reason), parsed.data.error.status ?? '']; } catch { /* not JSON: the status decides */ }
  const known = reasons.map((reason) => REASONS[reason]).find(Boolean);
  if (known) return new Error(known);
  if (response.status === 401) return new Error('auth_expired: a autorização do YouTube expirou. Conecte o canal de novo.');
  if (response.status === 403) return new Error(`forbidden: o YouTube recusou a operação${context}.`);
  return new Error(`YouTube respondeu HTTP ${response.status}${context}.`);
}
/** YouTube requires chunks in multiples of 256 KiB; 8 MiB keeps the progress smooth without too many requests. */
export const UPLOAD_CHUNK_BYTES = 32 * 256 * 1024;
export type WatermarkCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
export interface YouTubeChannelProfile {
  id: string;
  title: string;
  handle: string | null;
  brandingSettings: unknown;
  description?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  country?: string;
  defaultLanguage?: string;
}
export interface YouTubeVideoSnippetUpdate {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
}
export interface YouTubeChannelClient { getChannel(): Promise<YouTubeChannelProfile>; researchNiche(query: string): Promise<{ query: string; quotaCost: number; titles: string[]; totalResults: number }>; listUploadedVideos(): Promise<Array<{ id: string; title: string; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null }>>; getVideoStatistics(videoId: string): Promise<{ videoId: string; views: number; likes: number; comments: number }>; updateVideo(videoId: string, status: { privacyStatus: 'private' | 'unlisted' | 'public'; publishAt?: string | null }, snippet?: YouTubeVideoSnippetUpdate): Promise<void>; updateBranding(body: unknown): Promise<void>; createUploadSession(metadata: unknown, totalBytes: number, signal?: AbortSignal): Promise<string>; resumeUpload(sessionUrl: string, bytes: Uint8Array, offset: number, signal?: AbortSignal, total?: number): Promise<{ id: string } | { offset: number }>; continueUpload(sessionUrl: string, file: Uint8Array, offset: number, signal?: AbortSignal, onCheckpoint?: (sessionUrl: string, offset: number) => void): Promise<{ id: string }>; uploadVideo(metadata: unknown, bytes: Uint8Array, signal?: AbortSignal, onCheckpoint?: (sessionUrl: string, offset: number) => void): Promise<{ id: string }>; uploadThumbnail(videoId: string, bytes: Uint8Array, contentType: 'image/png' | 'image/jpeg', signal?: AbortSignal): Promise<void>; uploadBanner(bytes: Uint8Array, contentType: 'image/png' | 'image/jpeg', signal?: AbortSignal): Promise<string>; setWatermark(channelId: string, bytes: Uint8Array, contentType: 'image/png' | 'image/jpeg', position: WatermarkCorner, signal?: AbortSignal): Promise<void>; }
export function createYouTubeChannelClient(input: { accessToken: string; fetcher?: Fetcher; endpoints?: YouTubeEndpoints }): YouTubeChannelClient {
  if (!input.accessToken.trim()) throw new Error('auth_required: token do YouTube ausente.');
  const fetcher = input.fetcher ?? ((url, init) => fetch(url, init));
  const api = endpointBase(input.endpoints?.api ?? YOUTUBE_ENDPOINTS.api);
  const upload = endpointBase(input.endpoints?.upload ?? YOUTUBE_ENDPOINTS.upload);
  // The resumable session URL comes back from the server: it is only followed on the upload endpoint's own origin.
  // In a resumable session 308 means "Resume Incomplete", not a redirect, so it is read with redirect: 'manual'.
  const uploadSession = (value: string) => { const url = new URL(value); if (url.origin !== upload.origin || !url.pathname.startsWith(`${upload.pathname}/`)) throw new Error('invalid: o YouTube não devolveu uma sessão de upload segura.'); return url; };
  // A cancelled call keeps its abort error so the caller can tell cancelling from a network failure.
  const call = async (url: string, init: RequestInit): Promise<Response> => { try { return await fetcher(url, init); } catch (error) { if (init.signal?.aborted) throw error; throw new Error('network: sem conexão com o YouTube. Verifique a internet e tente de novo.', { cause: error }); } };
  const request = async (path: string, init: RequestInit = {}, base: URL = api): Promise<Response> => { const url = within(base, path); const response = await call(url.toString(), { ...init, headers: { authorization: `Bearer ${input.accessToken}`, ...(init.headers ?? {}) }, redirect: 'error' }); if (!response.ok) throw await youtubeFailure(response); return response; };
  return {
    async getChannel() {
      const parsed = channelResponse.parse(await (await request('/channels?part=snippet,brandingSettings&mine=true')).json());
      const item = parsed.items[0];
      if (!item) throw new Error('not_found: nenhum canal YouTube foi encontrado.');
      const snippet = item.snippet as Record<string, unknown>;
      const thumbs = (snippet.thumbnails ?? {}) as Record<string, { url?: string } | undefined>;
      const avatarUrl = thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url;
      const branding = (item.brandingSettings ?? {}) as Record<string, unknown>;
      const imageObj = (branding.image ?? {}) as Record<string, unknown>;
      const bannerUrl = typeof imageObj.bannerExternalUrl === 'string' ? imageObj.bannerExternalUrl : undefined;
      return {
        id: item.id,
        title: item.snippet.title,
        handle: item.snippet.customUrl ?? null,
        brandingSettings: item.brandingSettings ?? {},
        ...(typeof snippet.description === 'string' ? { description: snippet.description } : {}),
        ...(typeof avatarUrl === 'string' ? { avatarUrl } : {}),
        ...(bannerUrl ? { bannerUrl } : {}),
        ...(typeof snippet.country === 'string' ? { country: snippet.country } : {}),
        ...(typeof snippet.defaultLanguage === 'string' ? { defaultLanguage: snippet.defaultLanguage } : {}),
      };
    },
    async researchNiche(query) { if (!query.trim()) throw new Error('invalid: informe um nicho.'); const parsed = searchResponse.parse(await (await request(`/search?part=snippet&type=video&maxResults=50&q=${encodeURIComponent(query.trim())}&order=viewCount`)).json()); return { query: query.trim(), quotaCost: 100, titles: parsed.items.map((item) => item.snippet.title).slice(0, 50), totalResults: parsed.items.length }; },
    async listUploadedVideos() { const search = searchResponse.parse(await (await request('/search?part=snippet&forMine=true&type=video&maxResults=50')).json()); const ids = search.items.map((item) => item.id.videoId).join(','); if (!ids) return []; const parsed = videosResponse.parse(await (await request(`/videos?part=snippet,status&id=${encodeURIComponent(ids)}`)).json()); return parsed.items.map((item) => ({ id: item.id, title: item.snippet.title, privacy: item.status.privacyStatus, publishAt: item.status.publishAt ?? null })); },
    async getVideoStatistics(videoId) { if (!videoId.trim()) throw new Error('invalid: vídeo ausente.'); const parsed = videoStatisticsResponse.parse(await (await request(`/videos?part=statistics&id=${encodeURIComponent(videoId.trim())}`)).json()); const item = parsed.items[0]; if (!item) throw new Error('not_found: vídeo não encontrado no canal autorizado.'); return { videoId: item.id, views: Number(item.statistics.viewCount ?? '0'), likes: Number(item.statistics.likeCount ?? '0'), comments: Number(item.statistics.commentCount ?? '0') }; },
    async updateVideo(videoId, status, snippet) {
      if (!videoId.trim()) throw new Error('invalid: vídeo ausente.');
      const part = snippet ? 'snippet,status' : 'status';
      const payload = snippet ? { id: videoId, snippet, status } : { id: videoId, status };
      await request(`/videos?part=${part}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    },
    async updateBranding(body) { await request('/channels?part=brandingSettings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); },
    async createUploadSession(metadata, totalBytes, signal) { const response = await request('/videos?part=snippet,status&uploadType=resumable', { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(totalBytes), 'x-upload-content-type': 'video/mp4' }, body: JSON.stringify(metadata), ...(signal ? { signal } : {}) }, upload); const location = response.headers.get('location'); if (!location) throw new Error('invalid: o YouTube não devolveu uma sessão de upload segura.'); return uploadSession(location).toString(); },
    async resumeUpload(sessionUrl, bytes, offset, signal, total) { const parsedUrl = uploadSession(sessionUrl); if (!Number.isInteger(offset) || offset < 0) throw new Error('invalid: offset de upload inválido.'); const end = offset + bytes.byteLength - 1; const response = await call(parsedUrl.toString(), { method: 'PUT', headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'video/mp4', 'content-length': String(bytes.byteLength), 'content-range': `bytes ${offset}-${end}/${total ?? '*'}` }, body: Buffer.from(bytes), redirect: 'manual', ...(signal ? { signal } : {}) }); if (response.status === 308) { if (response.headers.get('location')) throw new Error('invalid: o YouTube redirecionou a sessão de upload.'); const range = response.headers.get('range'); const match = range?.match(/bytes=\d+-(\d+)/); if (!match) throw new Error('invalid: YouTube não informou o progresso da sessão.'); return { offset: Number(match[1]) + 1 }; } if (!response.ok) throw await youtubeFailure(response, ' no upload'); const result = z.object({ id: z.string().min(1) }).passthrough().parse(await response.json()); return { id: result.id }; },
    async uploadVideo(metadata, bytes, signal, onCheckpoint) { const location = await this.createUploadSession(metadata, bytes.byteLength, signal); onCheckpoint?.(location, 0); return this.continueUpload(location, bytes, 0, signal, onCheckpoint); },
    // Sends the file in chunks so every confirmed byte is a checkpoint: progress is real and a retry never restarts from zero.
    async continueUpload(location, file, start, signal, onCheckpoint) { let offset = start; while (offset < file.byteLength) { const result = await this.resumeUpload(location, file.slice(offset, offset + UPLOAD_CHUNK_BYTES), offset, signal, file.byteLength); if ('id' in result) return result; if (result.offset <= offset || result.offset > file.byteLength) throw new Error('invalid: YouTube devolveu um offset de upload inválido.'); offset = result.offset; onCheckpoint?.(location, offset); } throw new Error('invalid: upload concluído sem ID de vídeo.'); },
    async uploadThumbnail(videoId, bytes, contentType, signal) { if (!videoId.trim()) throw new Error('invalid: vídeo da thumbnail ausente.'); const response = await request(`/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, { method: 'POST', headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) }, body: Buffer.from(bytes), ...(signal ? { signal } : {}) }, upload); if (!response.ok) throw await youtubeFailure(response, ' na thumbnail'); },
    // channelBanners.insert only stores the image and returns its URL; channels.update then points the channel at it.
    async uploadBanner(bytes, contentType, signal) { const response = await request('/channelBanners/insert', { method: 'POST', headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength) }, body: Buffer.from(bytes), ...(signal ? { signal } : {}) }, upload); const parsed = z.object({ url: z.string().url() }).passthrough().parse(await response.json()); return parsed.url; },
    // watermarks.set takes the settings and the image together, as a multipart/related upload.
    async setWatermark(channelId, bytes, contentType, position, signal) {
      if (!channelId.trim()) throw new Error("invalid: canal da marca d'água ausente.");
      const boundary = `nb-${Date.now().toString(36)}`;
      const metadata = JSON.stringify({ timing: { type: 'offsetFromStart', offsetMs: 0 }, position: { type: 'corner', cornerPosition: position } });
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
      const body = Buffer.concat([Buffer.from(head), Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--`)]);
      await request(`/watermarks/set?channelId=${encodeURIComponent(channelId)}&uploadType=multipart`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}`, 'content-length': String(body.byteLength) }, body, ...(signal ? { signal } : {}) }, upload);
    },
  };
}
