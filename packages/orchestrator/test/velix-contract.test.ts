import type { AgentEvent, AgentStatus } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { decodeAnswer, runVelixAgent, VelixContractError } from '../src/velix-contract.js';
import { generateVideoIdeas, parseStoredVideoIdea, parseVideoIdeas } from '../src/video-ideas.js';
import { parseVideoResearch, runVideoResearch } from '../src/video-research.js';
import { z } from 'zod';
import type { AgentAdapter } from '@neuralbridge/agents';

// Fixtures follow the shapes observed from the real CLIs during homologation, with invented content.
const validIdea = { title: 'Ideia', hook: 'Gancho', synopsis: 'Sinopse', draftScript: 'Roteiro', audience: 'Público', durationSeconds: 60, referenceUrls: [], mediaPlan: 'Plano', claims: [] };
const CODEX_OWN_KEYS = JSON.stringify({ ideas: [{ titulo: 'Por que algo acontece', gancho: 'Uma pergunta', sinopse: 'Resumo', roteiroPreliminar: ['Abertura', 'Fechamento'] }] });
const CODEX_FENCED = `\`\`\`json\n${JSON.stringify({ ideas: [validIdea] })}\n\`\`\``;
const CLAUDE_PREAMBLE = `Aqui está:\n${JSON.stringify({ ideas: [validIdea] })}`;
const TWO_OBJECTS = `${JSON.stringify({ ideas: [validIdea] })}\n${JSON.stringify({ ideas: [validIdea] })}`;
const request = { niche: 'x', mode: 'generate' as const, references: [], avoidTitles: [] };

function adapter(id: 'claude' | 'codex', events: AgentEvent[], status: Partial<AgentStatus> = {}): AgentAdapter {
  return {
    id,
    detect: async () => ({ installed: true, authenticated: true, problems: [], ...status }) as AgentStatus,
    async *run() { for (const event of events) yield event; },
  } as unknown as AgentAdapter;
}
const done = (over: Partial<Extract<AgentEvent, { kind: 'done' }>> = {}): AgentEvent => ({ kind: 'done', ok: true, exitCode: 0, timedOut: false, cancelled: false, sessionId: 's', ...over }) as AgentEvent;
const session: AgentEvent = { kind: 'session', sessionId: 'exec-1', model: null };
const fails = async (promise: Promise<unknown>) => promise.then(() => { throw new Error('should fail'); }, (error: unknown) => error as VelixContractError);

describe('decodeAnswer', () => {
  const schema = z.object({ a: z.number() }).strict();
  it('accepts the fenced and preamble forms each provider produced', () => {
    expect(parseVideoIdeas(undefined, CODEX_FENCED, [])).toHaveLength(1);
    expect(parseVideoIdeas(undefined, CLAUDE_PREAMBLE, [])).toHaveLength(1);
  });
  it('rejects valid JSON that breaks the contract, naming fields and not content', () => {
    expect(parseVideoIdeas(undefined, CODEX_OWN_KEYS, [])).toBeNull();
    const decoded = decodeAnswer(schema, undefined, '{"a":1,"segredo":"valor-privado"}');
    expect(decoded).toMatchObject({ ok: false, code: 'contract_violation' });
    expect(JSON.stringify(decoded)).not.toContain('valor-privado');
  });
  it('never merges two objects or trusts text over an invalid structured answer', () => {
    expect(decodeAnswer(schema, undefined, TWO_OBJECTS)).toMatchObject({ ok: false, code: 'invalid_json' });
    expect(decodeAnswer(schema, { a: 'x' }, '{"a":1}')).toMatchObject({ ok: false, code: 'contract_violation' });
    expect(decodeAnswer(schema, undefined, 'sem json')).toMatchObject({ ok: false, code: 'invalid_json' });
  });
  it('does not fill missing fields', () => {
    const partial = Object.fromEntries(Object.entries(validIdea).filter(([key]) => key !== 'durationSeconds'));
    expect(parseVideoIdeas({ ideas: [partial] }, '', [])).toBeNull();
  });
  it('rejects a damaged stored idea', () => {
    expect(parseStoredVideoIdea(JSON.stringify(validIdea))).toMatchObject({ title: 'Ideia' });
    expect(parseStoredVideoIdea('{quebrado')).toBeNull();
    expect(parseStoredVideoIdea(JSON.stringify({ title: 'x' }))).toBeNull();
  });
});

describe('runVelixAgent', () => {
  const input = { prompt: 'p', cwd: 'C:\\x', mode: 'read-only' as const };
  it('classifies each way a run can end', async () => {
    expect(await fails(runVelixAgent(adapter('codex', [session, done({ ok: false, timedOut: true })]), 'ideias', input))).toMatchObject({ code: 'timeout', agent: 'codex', executionId: 'exec-1' });
    expect(await fails(runVelixAgent(adapter('codex', [done({ ok: false, cancelled: true })]), 'ideias', input))).toMatchObject({ code: 'cancelled' });
    expect(await fails(runVelixAgent(adapter('codex', [session, done()]), 'ideias', input))).toMatchObject({ code: 'empty_response' });
    expect(await fails(runVelixAgent(adapter('codex', []), 'ideias', input))).toMatchObject({ code: 'provider_failed' });
  });
  it('reports the provider limit without blaming the contract', async () => {
    const error = await fails(runVelixAgent(adapter('codex', [session, { kind: 'error', message: 'You have hit your usage limit.' }, done({ ok: false })]), 'ideias', input));
    expect(error).toMatchObject({ code: 'provider_limit', agent: 'codex', executionId: 'exec-1' });
  });
  it('keeps the provider error short and without secrets', async () => {
    const error = await fails(runVelixAgent(adapter('codex', [{ kind: 'error', message: `Invalid schema sk-ant-api03-${'a'.repeat(40)} ${'x'.repeat(400)}` }, done({ ok: false })]), 'ideias', input));
    expect(error).toMatchObject({ code: 'provider_failed' });
    expect(error.message.length).toBeLessThan(260);
    expect(error.message).not.toContain('sk-ant-api03');
  });
  it('takes the last Codex message as the answer and keeps real metadata', async () => {
    const run = await runVelixAgent(adapter('codex', [session, { kind: 'text', text: 'Vou pensar.' }, { kind: 'text', text: '{"a":1}' }, done({ result: 'Vou pensar.{"a":1}' })]), 'ideias', input);
    expect(run.text).toBe('{"a":1}');
    expect(run.generation).toEqual({ agent: 'codex', model: null, executionId: 'exec-1', generatedAt: expect.any(String) });
  });
});

describe('provider contracts', () => {
  it('rejects Codex answers with its own keys, keeping the execution id', async () => {
    const error = await fails(generateVideoIdeas(adapter('codex', [session, { kind: 'text', text: CODEX_OWN_KEYS }, done()]), request, 'C:\\x'));
    expect(error).toBeInstanceOf(VelixContractError);
    expect(error).toMatchObject({ code: 'contract_violation', agent: 'codex', executionId: 'exec-1' });
    expect(error.message).not.toContain('Por que algo acontece');
  });
  it('reads a Claude structured answer and keeps the model it reports', async () => {
    const result = await generateVideoIdeas(adapter('claude', [{ kind: 'session', sessionId: 'c1', model: 'modelo-real' }, { kind: 'result', text: '', ok: true, structured: { ideas: [validIdea] } } as AgentEvent, done()]), request, 'C:\\x');
    expect(result.generation).toMatchObject({ agent: 'claude', model: 'modelo-real', executionId: 'c1' });
  });
  it('names the provider that is unavailable', async () => {
    expect(await fails(generateVideoIdeas(adapter('codex', [], { authenticated: false }), request, 'C:\\x'))).toMatchObject({ code: 'provider_unavailable', agent: 'codex' });
  });
});

describe('source authorization', () => {
  it('does not let an idea cite a source that is pending or rejected', async () => {
    const approved = { title: 'Aprovada', url: 'https://a.example/ok', publisher: 'x', publishedAt: null };
    const idea = { ...validIdea, referenceUrls: ['https://a.example/ok', 'https://a.example/pendente'], claims: [{ text: 'Afirma', type: 'fact', referenceUrl: 'https://a.example/pendente' }] };
    const { ideas } = await generateVideoIdeas(adapter('codex', [session, { kind: 'text', text: JSON.stringify({ ideas: [idea] }) }, done()]), { ...request, references: [approved] }, 'C:\\x');
    expect(ideas[0]?.referenceUrls).toEqual(['https://a.example/ok']);
    expect(ideas[0]?.claims[0]).toMatchObject({ type: 'hypothesis', referenceUrl: null });
  });
});

describe('research contract', () => {
  const answer = JSON.stringify({ references: [{ kind: 'texto', title: 'Boa', url: 'https://a.example/1', license: 'citação', note: '' }, { kind: 'texto', title: 'Sem https', url: 'http://a.example/2', license: 'citação', note: '' }] });
  const search: AgentEvent = { kind: 'tool', name: 'web_search', summary: 'consulta' };
  it('refuses links that never touched the web', async () => {
    expect(await fails(runVideoResearch(adapter('codex', [session, { kind: 'text', text: answer }, done()]), 't', 'C:\\x'))).toMatchObject({ code: 'missing_web_evidence', executionId: 'exec-1' });
  });
  it('keeps valid items, counts the rest and reports the provider', async () => {
    const run = await runVideoResearch(adapter('codex', [session, search, { kind: 'text', text: answer }, done()]), 't', 'C:\\x');
    expect(run).toMatchObject({ rejected: 1, generation: { agent: 'codex', executionId: 'exec-1' } });
    expect(run.references.map((item) => item.url)).toEqual(['https://a.example/1']);
  });
  it('accepts the web tools Claude reports', async () => {
    const run = await runVideoResearch(adapter('claude', [{ kind: 'tool', name: 'WebSearch', summary: '' }, { kind: 'result', text: answer, ok: true } as AgentEvent, done()]), 't', 'C:\\x');
    expect(run.references).toHaveLength(1);
  });
  it('still rejects an answer with no valid reference', () => {
    expect(parseVideoResearch(undefined, '{"references":[]}')).toBeNull();
  });
});
