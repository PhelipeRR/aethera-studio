// Fase 4B.11 fidelity re-analysis: the independent audit found (a) the protagonist's visual labels
// reused for different people (the newcomer, the fleeing assassin) because the context presented
// previous labels as a plain roster, (b) Hangul SFX transliterated as speech ("KOOY", "ok") and
// (c) schema fillers ("N/A") persisted as dialogue.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOllamaLocalVlmProvider } from '../src/aethera/vision-providers.js';

afterEach(() => { vi.unstubAllGlobals(); });

function stubChat(content: unknown, prompts: string[]) {
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:4b-q4_K_M' }] }), { status: 200 });
    if (href.endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }), { status: 200 });
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: Array<{ content?: string }> };
    prompts.push(body.messages?.[0]?.content ?? '');
    return new Response(JSON.stringify({ message: { content: JSON.stringify(content) }, prompt_eval_count: 900, eval_count: 200, done: true }), { status: 200 });
  });
}

const panel = {
  schemaVersion: 1, nature: 'action', natureConfidence: 0.8, description: 'Figura escura é atingida; jovem de costas em primeiro plano.',
  frames: [{ atMs: 0, observed: 'golpe', dialogue: [{ text: 'N/A', region: 'top' }, { text: 'WHO ARE YOU!', region: 'top' }] }],
  characters: [{ name: 'jovem de túnica clara', basis: 'observed', evidence: 'visível', confidence: 0.8 }],
  actions: [{ description: 'golpe', basis: 'observed', confidence: 0.7 }],
  environment: null, overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false }, limitations: [], confidence: 0.8,
};

describe('Fase 4B.11 — identidade, SFX e placeholders no local-vlm', () => {
  it('prompt pede um rótulo por pessoa, com roupa, e proíbe transliterar hangul; N/A não vira fala', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'identity-sfx-'));
    try {
      const prompts: string[] = [];
      stubChat(panel, prompts);
      const imagePath = join(directory, 'p13_0.png');
      writeFileSync(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'));
      const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.test', model: 'qwen3.5:4b-q4_K_M', structuredOutput: true, maxImagesPerCall: 1 });
      const result = await provider.analyze!({ frames: [{ id: 'p13_0', path: imagePath, atMs: 0 }], context: 'Rótulos visuais já usados (reutilize só para a mesma pessoa, com a mesma roupa): jovem de túnica clara.' });
      expect(prompts[0]).toMatch(/hangul\) estilizadas são efeito sonoro: nunca as transcreva nem translitere/);
      expect(prompts[0]).toMatch(/um item por pessoa visível, sem repetir a mesma pessoa/);
      expect(prompts[0]).toMatch(/pessoa diferente recebe rótulo novo/);
      const texts = result.frames.flatMap((frame) => frame.visibleText.map((line) => line.text));
      expect(texts).toEqual(['WHO ARE YOU!']);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
