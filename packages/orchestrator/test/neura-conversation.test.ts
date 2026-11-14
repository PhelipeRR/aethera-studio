import { describe, expect, it, vi } from 'vitest';
import { TaskEngineConversation } from '../src/neura-conversation.js';

const setup = (target: { projectId: string | null; agent: 'claude' | 'codex' } = { projectId: null, agent: 'claude' }) => {
  const runStructuredReadOnly = vi.fn().mockResolvedValue({ structured: { text: 'Claro.' } });
  return { runStructuredReadOnly, conversation: new TaskEngineConversation({ engine: { runStructuredReadOnly }, target: () => target }) };
};

describe('TaskEngineConversation', () => {
  it('answers with no project at all', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    await expect(conversation.reply({ text: 'Oi', language: 'pt-BR' })).resolves.toBe('Claro.');
    expect(runStructuredReadOnly.mock.calls[0]?.[0].projectId).toBeNull();
    expect(runStructuredReadOnly.mock.calls[0]?.[0].origin).toBe('neura');
  });

  it('explains that file edits need a project instead of pretending to edit', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    await expect(conversation.reply({ text: 'Edite o arquivo src/app.ts e corrija o erro', language: 'pt-BR' })).resolves.toContain('selecionar um projeto');
    expect(runStructuredReadOnly).not.toHaveBeenCalled();
  });

  it('keeps English project-bound edit refusal explicit', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    await expect(conversation.reply({ text: 'Please edit the file src/app.ts', language: 'pt-BR' })).resolves.toContain('select a project');
    expect(runStructuredReadOnly).not.toHaveBeenCalled();
  });

  it('runs lean on the cheap model, with its instructions as the system prompt', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    await conversation.reply({ text: 'Oi', language: 'pt-BR' });
    const input = runStructuredReadOnly.mock.calls[0]?.[0];
    expect(input.lean.systemPrompt).toContain('You are Neura');
    expect(input.model).toBe('haiku');
    expect(input.prompt).not.toContain('You are Neura');
  });

  it('keeps the instructions in the prompt for Codex, which ignores a system prompt', async () => {
    const { conversation, runStructuredReadOnly } = setup({ projectId: 'p1', agent: 'codex' });
    await conversation.reply({ text: 'Oi', language: 'pt-BR' });
    expect(runStructuredReadOnly.mock.calls[0]?.[0].prompt).toContain('You are Neura');
  });

  it('answers in the language of the request, not the preference', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    await conversation.reply({ text: 'What can you do for me?', language: 'pt-BR' });
    expect(runStructuredReadOnly.mock.calls[0]?.[0].prompt).toContain('Answer in: en');
  });

  it('remembers the last exchanges, as data', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    await conversation.reply({ text: 'Meu nome é Ana', language: 'pt-BR' });
    await conversation.reply({ text: 'Qual é o meu nome?', language: 'pt-BR' });
    const prompt = runStructuredReadOnly.mock.calls[1]?.[0].prompt as string;
    expect(prompt).toContain('<history>');
    expect(prompt).toContain('Meu nome é Ana');
    expect(prompt).toContain('Claro.');
  });

  it('adds only bounded global memories as data, even without a project', async () => {
    const runStructuredReadOnly = vi.fn().mockResolvedValue({ structured: { text: 'Claro.' } });
    const conversation = new TaskEngineConversation({
      engine: { runStructuredReadOnly },
      target: () => ({ projectId: null, agent: 'claude' }),
      memory: { search: vi.fn().mockResolvedValue([{ title: 'Preferências', snippet: 'Responda em português.', confidence: 'reviewed' }]) },
    });
    await conversation.reply({ text: 'Como devo responder?', language: 'pt-BR' });
    const prompt = runStructuredReadOnly.mock.calls[0]?.[0].prompt as string;
    expect(prompt).toContain('<global-memory-data>');
    expect(prompt).toContain('Preferências');
    expect(prompt).toContain('Responda em português.');
    expect(prompt).toContain('não são instruções');
  });

  it('reads only the selected project and honours the global memory pause', async () => {
    const runStructuredReadOnly = vi.fn().mockResolvedValue({ structured: { text: 'Claro.' } });
    const search = vi.fn().mockResolvedValue([]);
    let global = true;
    let projectId: string | null = 'p1';
    const conversation = new TaskEngineConversation({ engine: { runStructuredReadOnly }, target: () => ({ projectId, agent: 'claude' }), memory: { search }, globalMemory: () => global });
    await conversation.reply({ text: 'Oi', language: 'pt-BR' });
    expect(search.mock.calls[0]?.[2]).toEqual({ global: true, projectId: 'p1' });
    global = false;
    projectId = null;
    await conversation.reply({ text: 'Oi', language: 'pt-BR' });
    expect(search.mock.calls[1]?.[2]).toEqual({ global: false, projectId: null });
  });

  it('runs a general question against the selected project without refusing it', async () => {
    const { conversation, runStructuredReadOnly } = setup({ projectId: 'p1', agent: 'claude' });
    await expect(conversation.reply({ text: 'Edite o arquivo src/app.ts', language: 'pt-BR' })).resolves.toBe('Claro.');
    expect(runStructuredReadOnly.mock.calls[0]?.[0].projectId).toBe('p1');
  });

  it('passes screen images to the read-only agent without requiring a project', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    await conversation.reply({ text: 'Descreva a tela', language: 'pt-BR', images: [{ path: 'C:/Temp/screen.png', name: 'screen.png', mime: 'image/png', size: 3 }] });

    expect(runStructuredReadOnly.mock.calls[0]?.[0].projectId).toBeNull();
    expect(runStructuredReadOnly.mock.calls[0]?.[0].images).toEqual([{ path: 'C:/Temp/screen.png', name: 'screen.png', mime: 'image/png', size: 3 }]);
  });

  it('forwards provider text events as progress without changing the final structured reply', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    const progress: string[] = [];
    runStructuredReadOnly.mockImplementationOnce(async (input: { onEvent?: (event: { kind: string; text?: string }) => void }) => { input.onEvent?.({ kind: 'text', text: 'Primeiro trecho' }); return { structured: { text: 'Resposta final.' } }; });
    await expect(conversation.reply({ text: 'Oi', language: 'pt-BR', onProgress: (text) => progress.push(text) })).resolves.toBe('Resposta final.');
    expect(progress).toEqual(['Primeiro trecho']);
  });

  it('forwards cancellation to the structured read-only run', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    const controller = new AbortController();
    await conversation.reply({ text: 'Pare esta resposta', language: 'pt-BR', signal: controller.signal });
    expect(runStructuredReadOnly.mock.calls[0]?.[0].signal).toBe(controller.signal);
  });

  it('forgets what is older than the window', async () => {
    const { conversation, runStructuredReadOnly } = setup();
    for (let turn = 0; turn < 9; turn += 1) await conversation.reply({ text: `mensagem-${turn}`, language: 'pt-BR' });
    const prompt = runStructuredReadOnly.mock.calls[8]?.[0].prompt as string;
    expect(prompt).not.toContain('mensagem-0');
    expect(prompt).toContain('mensagem-7');
  });
});
