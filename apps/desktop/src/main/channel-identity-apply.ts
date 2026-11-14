import type { WatermarkCorner, YouTubeChannelClient } from '@neuralbridge/orchestrator';

export interface IdentityApplyInput {
  banner?: { imageBase64: string };
  watermark?: { imageBase64: string; position: WatermarkCorner };
  description?: string;
  keywords?: string;
}
export interface IdentityApplyProgress { progress: number; step: string; done: string[]; }

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// YouTube's published limits for channel art.
const BANNER = { minWidth: 2048, minHeight: 1152, maxBytes: 6 * 1024 * 1024 };
const WATERMARK = { maxSide: 800, maxBytes: 1024 * 1024 };
export const CHANNEL_DESCRIPTION_MAX = 1000;
export const CHANNEL_KEYWORDS_MAX = 500;

export type ArtImage = { bytes: Buffer; width: number; height: number; type: 'image/png' | 'image/jpeg' };
/** Reads an image the renderer rasterized (PNG or JPEG); nothing it sends is trusted until the header and size check out. */
export function readImage(base64: string, label: string): ArtImage {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.toString('latin1', 12, 16) === 'IHDR') return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), type: 'image/png' };
  if (bytes.byteLength > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the JPEG segments to the start-of-frame, which holds the size.
    let offset = 2;
    while (offset + 9 < bytes.byteLength && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { bytes, width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), type: 'image/jpeg' };
      offset += 2 + bytes.readUInt16BE(offset + 2);
    }
  }
  throw new Error(`invalid: ${label} não é um PNG ou JPEG válido.`);
}

export function validateIdentityApply(input: IdentityApplyInput): { banner?: ArtImage; watermark?: ArtImage } {
  if (!input.banner && !input.watermark && input.description === undefined && input.keywords === undefined) throw new Error('invalid: escolha pelo menos uma mudança para aplicar.');
  const result: { banner?: ArtImage; watermark?: ArtImage } = {};
  if (input.banner) {
    const png = readImage(input.banner.imageBase64, 'o banner');
    if (png.width < BANNER.minWidth || png.height < BANNER.minHeight || Math.abs(png.width / png.height - 16 / 9) > 0.01) throw new Error('invalid: o banner precisa ter proporção 16:9 e pelo menos 2048×1152.');
    if (png.bytes.byteLength > BANNER.maxBytes) throw new Error('invalid: o banner passa de 6 MB.');
    result.banner = png;
  }
  if (input.watermark) {
    const png = readImage(input.watermark.imageBase64, "a marca d'água");
    if (png.width > WATERMARK.maxSide || png.height > WATERMARK.maxSide || png.bytes.byteLength > WATERMARK.maxBytes) throw new Error("invalid: a marca d'água precisa ter no máximo 800×800 e 1 MB.");
    result.watermark = png;
  }
  if (input.description !== undefined && input.description.length > CHANNEL_DESCRIPTION_MAX) throw new Error('invalid: a descrição do canal passa de 1.000 caracteres.');
  if (input.keywords !== undefined && input.keywords.length > CHANNEL_KEYWORDS_MAX) throw new Error('invalid: as palavras-chave passam de 500 caracteres.');
  return result;
}

const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** channels.update replaces brandingSettings whole, so the change is merged into what the channel has today. */
export function mergeBranding(current: unknown, change: { bannerUrl?: string; description?: string; keywords?: string }): Record<string, unknown> {
  const settings = asObject(current);
  const channel = { ...asObject(settings['channel']), ...(change.description === undefined ? {} : { description: change.description }), ...(change.keywords === undefined ? {} : { keywords: change.keywords }) };
  const image = change.bannerUrl ? { ...asObject(settings['image']), bannerExternalUrl: change.bannerUrl } : settings['image'];
  return { ...settings, channel, ...(image === undefined ? {} : { image }) };
}

export function identityApplySummary(input: IdentityApplyInput): string[] {
  const corner: Record<WatermarkCorner, string> = { topLeft: 'canto superior esquerdo', topRight: 'canto superior direito', bottomLeft: 'canto inferior esquerdo', bottomRight: 'canto inferior direito' };
  return [
    ...(input.banner ? ['Banner novo do canal (2560×1440).'] : []),
    ...(input.watermark ? [`Marca d'água nos vídeos, ${corner[input.watermark.position]}, o vídeo todo.`] : []),
    ...(input.description === undefined ? [] : [`Descrição do canal (${input.description.length} caracteres).`]),
    ...(input.keywords === undefined ? [] : ['Palavras-chave do canal.']),
    'O que não for marcado continua como está no canal.',
  ];
}

/** Applies the approved changes in order, reporting each finished step; stops at the first failure. */
export async function runIdentityApply(input: IdentityApplyInput, art: { banner?: ArtImage; watermark?: ArtImage }, client: YouTubeChannelClient, onProgress: (progress: IdentityApplyProgress) => void, signal?: AbortSignal): Promise<string[]> {
  const profile = await client.getChannel();
  const brandingNeeded = !!art.banner || input.description !== undefined || input.keywords !== undefined;
  const total = (art.banner ? 1 : 0) + (art.watermark ? 1 : 0) + (brandingNeeded ? 1 : 0);
  const done: string[] = [];
  const report = (step: string) => onProgress({ progress: Math.round((done.length / total) * 100), step, done: [...done] });
  let bannerUrl: string | undefined;
  if (art.banner) { report('Enviando o banner'); bannerUrl = await client.uploadBanner(art.banner.bytes, art.banner.type, signal); done.push('Banner enviado'); }
  if (art.watermark && input.watermark) { report("Aplicando a marca d'água"); await client.setWatermark(profile.id, art.watermark.bytes, art.watermark.type, input.watermark.position, signal); done.push("Marca d'água aplicada"); }
  if (brandingNeeded) {
    report('Atualizando o canal');
    await client.updateBranding({ id: profile.id, brandingSettings: mergeBranding(profile.brandingSettings, { ...(bannerUrl ? { bannerUrl } : {}), ...(input.description === undefined ? {} : { description: input.description }), ...(input.keywords === undefined ? {} : { keywords: input.keywords }) }) });
    done.push(bannerUrl ? 'Banner definido no canal' : 'Canal atualizado');
  }
  onProgress({ progress: 100, step: 'Concluído', done: [...done] });
  return done;
}

const IMAGE_HOSTS = ['.googleusercontent.com', '.ggpht.com', '.ytimg.com'];
/** Fetches the channel's current banner for the before/after view; only Google's image hosts, only images, bounded. */
export async function fetchChannelImage(url: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<string | null> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || !IMAGE_HOSTS.some((host) => parsed.hostname.endsWith(host))) return null;
  const response = await fetcher(parsed.toString(), { redirect: 'error' }).catch(() => null);
  const type = response?.headers.get('content-type') ?? '';
  if (!response?.ok || !/^image\/(png|jpeg|webp)$/u.test(type.split(';')[0]?.trim() ?? '')) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 8 * 1024 * 1024) return null;
  return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
}
