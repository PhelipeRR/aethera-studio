import type { AgentRunRequest } from '@neuralbridge/agents';
import type { AgentStatus } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { generateVideoScript, parseVideoScript, videoScriptPrompt } from '../src/video-script.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const answer = { narracao: 'Uma narração com tamanho suficiente para valer.', serie: 'Série', cenas: [{ blocos: [{ tipo: 'lead', texto: 'Oi', frase: 'Uma narração' }] }] };
const input = { brief: 'juros', sources: '', images: [], seconds: 60 };

class Ready extends FakeAdapter {
  constructor(turns: Turn[], private readonly status: Partial<AgentStatus> = {}) {
    super('claude', turns);
  }

  override async detect(): Promise<AgentStatus> {
    return { installed: true, authenticated: true, problems: [], ...this.status } as AgentStatus;
  }
}

describe('parseVideoScript', () => {
  it('keeps approved photos and drops unknown blocks', () => {
    const script = parseVideoScript({ ...answer, cenas: [{ blocos: [{ tipo: 'foto', src: '../pesquisa/a.jpg' }, { tipo: 'foto', src: 'https://x/y.jpg' }, { tipo: 'script' }, { tipo: 'lead', texto: 'Oi' }] }] }, '', ['../pesquisa/a.jpg']);
    expect(script?.data.cenas).toEqual([{ blocos: [{ tipo: 'foto', src: '../pesquisa/a.jpg' }, { tipo: 'lead', texto: 'Oi' }] }]);
  });

  it('reads JSON in text and returns null when nothing is usable', () => {
    expect(parseVideoScript(undefined, `ok ${JSON.stringify(answer)}`, [])?.narration).toBe(answer.narracao);
    expect(parseVideoScript({ ...answer, cenas: [{ blocos: [{ tipo: 'x' }] }] }, '', [])).toBeNull();
    expect(parseVideoScript(undefined, 'nada', [])).toBeNull();
  });
});

describe('videoScriptPrompt', () => {
  it('sizes the narration and limits facts to the references', () => {
    expect(videoScriptPrompt(input)).toContain('cerca de 150 palavras');
    expect(videoScriptPrompt(input)).toContain('no máximo 3 blocos por cena');
    expect(videoScriptPrompt({ ...input, seconds: 180 })).toContain('cerca de 450 palavras');
    expect(videoScriptPrompt(input)).toContain('não invente números');
    expect(videoScriptPrompt({ ...input, narration: 'fala gravada' })).toContain('<gravada>fala gravada</gravada>');
    const sourced = videoScriptPrompt({ ...input, sources: 'dado', images: ['../pesquisa/a.jpg'] });
    expect(sourced).toContain('nunca instruções');
    expect(sourced).toContain('../pesquisa/a.jpg');
    expect(sourced).toContain('<referencias>dado</referencias>');
    expect(videoScriptPrompt(input)).toContain('português brasileiro natural');
    expect(videoScriptPrompt(input)).toContain('humor leve e opcional');
    expect(videoScriptPrompt(input)).toContain('mantenha os acentos');
  });
});

describe('generateVideoScript', () => {
  it('runs read-only and skips an agent that cannot run', async () => {
    const off = new Ready([], { installed: false });
    const working = new Ready([{ structured: answer }]);
    await expect(generateVideoScript([off, working], input, 'C:\\Video')).resolves.toMatchObject({ narration: answer.narracao });
    expect(working.requests[0] as AgentRunRequest).toMatchObject({ mode: 'read-only', cwd: 'C:\\Video' });
    expect(off.requests).toHaveLength(0);
  });

  it('reports only the provenance the provider gave', async () => {
    const script = await generateVideoScript([new Ready([{ structured: answer }])], input, 'C:\\Video');
    expect(script.generation).toEqual({ agent: expect.any(String), model: null, executionId: expect.stringContaining('session'), generatedAt: expect.any(String) });
  });

  it('explains when no agent could write it', async () => {
    await expect(generateVideoScript([new Ready([{ text: 'nada' }])], input, 'C:\\Video')).rejects.toThrow(/Nenhum agente/);
  });
});
