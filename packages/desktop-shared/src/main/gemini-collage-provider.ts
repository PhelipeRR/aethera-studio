import { collageArtifactSchema, type CollageMetaphor, type CollageProvider, type CollageRequest } from '@neuralbridge/shared';

type GeminiFetch = (input: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> } }>; response?: { generatedVideos?: Array<{ video?: { uri?: string } }> } };

function inline(value: unknown, mimeType: 'image/png' | 'video/mp4'): Uint8Array {
  const parts = (value as GeminiResponse).candidates?.[0]?.content?.parts ?? [];
  const data = parts.find((part) => part.inlineData?.mimeType === mimeType)?.inlineData?.data;
  if (!data) throw new Error(`Gemini não retornou ${mimeType}.`);
  return Uint8Array.from(Buffer.from(data, 'base64'));
}

export class GeminiCollageProvider implements CollageProvider {
  constructor(private readonly apiKey: string, private readonly request: GeminiFetch = fetch, private readonly endpoint = process.env['NB_GEMINI_API_URL'] ?? 'https://generativelanguage.googleapis.com/v1beta') {}
  private async call(model: string, prompt: string): Promise<GeminiResponse> {
    const response = await this.request(`${this.endpoint}/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
    if (!response.ok) throw new Error(`Gemini falhou (${response.status}).`);
    return (await response.json()) as GeminiResponse;
  }
  async proposeMetaphor(request: CollageRequest): Promise<CollageMetaphor> {
    const result = await this.call('gemini-omni-1.1-flash', `Crie uma metáfora visual editorial para uma colagem de papel. Responda em texto curto e seguro. Pedido: ${request.prompt}`);
    const approvalText = (result.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join(' ').trim();
    if (!approvalText) throw new Error('Gemini não retornou uma metáfora.');
    return { approvalText: approvalText.slice(0, 2_000), visualPrompt: `${request.prompt}; ${approvalText}`.slice(0, 4_000), estimatedSeconds: request.durationSeconds };
  }
  async createStill(request: CollageRequest, metaphor: CollageMetaphor) {
    const result = await this.call('gemini-3.1-flash-image-preview', `Gere somente uma imagem PNG de colagem editorial de papel, proporção ${request.aspectRatio}. ${metaphor.visualPrompt}`);
    return collageArtifactSchema.parse({ mimeType: 'image/png', bytes: inline(result, 'image/png'), durationSeconds: null, sha256: null });
  }
  async generateClip(request: CollageRequest, still: { bytes: Uint8Array }) {
    const result = await this.call('gemini-omni-1.1-flash', `Gere um clipe MP4 editorial de colagem de papel com duração aproximada de ${request.durationSeconds}s. Imagem aprovada em base64: ${Buffer.from(still.bytes).toString('base64').slice(0, 2_000)}`);
    return collageArtifactSchema.parse({ mimeType: 'video/mp4', bytes: inline(result, 'video/mp4'), durationSeconds: request.durationSeconds, sha256: null });
  }
}
