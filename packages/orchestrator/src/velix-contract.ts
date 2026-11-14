import { redactSecrets, type AgentAdapter, type AgentRunRequest } from '@neuralbridge/agents';
import type { AgentId } from '@neuralbridge/shared';
import type { z } from 'zod';

export type VelixOperation = 'ideias' | 'temas' | 'pesquisa' | 'roteiro' | 'captura' | 'composição';
export type VelixFailure = 'provider_unavailable' | 'provider_failed' | 'provider_limit' | 'timeout' | 'cancelled' | 'empty_response' | 'invalid_json' | 'contract_violation' | 'missing_web_evidence';
/** What the provider itself reported; a field it did not report stays null. */
export type VelixGeneration = { agent: AgentId; model: string | null; executionId: string | null; generatedAt: string };
export type VelixRun = { structured: unknown; text: string; tools: string[]; generation: VelixGeneration };

const LABELS: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex' };
const MAX_ISSUES = 6;

/** Says which contract failed and why, by field path only: never the agent's content, which may hold private data. */
export class VelixContractError extends Error {
  constructor(readonly code: VelixFailure, readonly operation: VelixOperation, readonly agent: AgentId, message: string, readonly executionId: string | null = null, readonly issues: readonly string[] = []) {
    super(message);
    this.name = 'VelixContractError';
  }
}

const safeDetail = (message: string) => redactSecrets(message).replace(/\s+/g, ' ').trim().slice(0, 200);

function jsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  if (fenced) return fenced[1] ?? null;
  if (trimmed.startsWith('{')) return trimmed;
  const from = trimmed.indexOf('{');
  const to = trimmed.lastIndexOf('}');
  return from >= 0 && to > from ? trimmed.slice(from, to + 1) : null;
}

export type Decoded<T> = { ok: true; data: T } | { ok: false; code: 'invalid_json' | 'contract_violation'; issues: string[] };

/** An answer from the provider's schema channel is final: invalid structured output never falls back to the text. */
export function decodeAnswer<S extends z.ZodType>(schema: S, structured: unknown, text: string): Decoded<z.output<S>> {
  let value = structured;
  if (value === undefined) {
    const candidate = jsonCandidate(text);
    if (candidate === null) return { ok: false, code: 'invalid_json', issues: [] };
    try {
      value = JSON.parse(candidate);
    } catch {
      return { ok: false, code: 'invalid_json', issues: [] };
    }
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, code: 'contract_violation', issues: parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.code}`) };
}

export function decodeOrThrow<S extends z.ZodType>(schema: S, run: VelixRun, operation: VelixOperation): z.output<S> {
  const decoded = decodeAnswer(schema, run.structured, run.text);
  if (decoded.ok) return decoded.data;
  const label = LABELS[run.generation.agent];
  throw new VelixContractError(decoded.code, operation, run.generation.agent, decoded.code === 'invalid_json' ? `${label} não devolveu JSON válido em ${operation}. Nada foi salvo.` : `${label} devolveu ${operation} fora do contrato. Nada foi salvo. Campos: ${decoded.issues.join('; ')}`, run.generation.executionId, decoded.issues);
}

export async function requireReady(adapter: AgentAdapter, operation: VelixOperation): Promise<void> {
  const status = await adapter.detect();
  if (!status.installed || status.authenticated === false || status.problems.length > 0) throw new VelixContractError('provider_unavailable', operation, adapter.id, `${LABELS[adapter.id]} indisponível. Confira o login em Agentes e tente de novo.`);
}

/** Runs one read-only question on exactly this adapter and classifies how it ended. Choosing another agent is the user's call. */
export async function runVelixAgent(adapter: AgentAdapter, operation: VelixOperation, request: AgentRunRequest, signal?: AbortSignal): Promise<VelixRun> {
  const label = LABELS[adapter.id];
  let structured: unknown;
  let resultText = '';
  let lastText = '';
  let doneText = '';
  let model: string | null = null;
  let executionId: string | null = null;
  let providerError = '';
  let outcome: 'ok' | 'failed' | 'timeout' | 'cancelled' | null = null;
  const tools: string[] = [];
  for await (const event of adapter.run(request, signal)) {
    if (event.kind === 'session') {
      model = event.model;
      executionId = event.sessionId || null;
    }
    if (event.kind === 'tool') tools.push(event.name);
    if (event.kind === 'text') lastText = event.text;
    if (event.kind === 'error') providerError ||= event.message;
    if (event.kind === 'result') {
      structured = event.structured;
      resultText = event.text;
    }
    if (event.kind === 'done') {
      doneText = event.result ?? '';
      outcome = event.timedOut ? 'timeout' : event.cancelled ? 'cancelled' : event.ok ? 'ok' : 'failed';
    }
  }
  if (outcome === 'timeout') throw new VelixContractError('timeout', operation, adapter.id, `${label} excedeu o tempo limite em ${operation}. Nada foi salvo.`, executionId);
  if (outcome === 'cancelled' || signal?.aborted) throw new VelixContractError('cancelled', operation, adapter.id, `Operação ${operation} cancelada. Nada foi salvo.`, executionId);
  // The provider's own limit is reported as such and never answered by trying the other agent.
  if (outcome !== 'ok' && /usage limit|rate limit|quota/i.test(providerError)) throw new VelixContractError('provider_limit', operation, adapter.id, `${label} atingiu o próprio limite de uso em ${operation}. Tente mais tarde ou escolha outro agente. Nada foi salvo.`, executionId);
  if (outcome !== 'ok') throw new VelixContractError('provider_failed', operation, adapter.id, `${label} falhou em ${operation}${providerError ? `: ${safeDetail(providerError)}` : '.'}`, executionId);
  // Codex can narrate before answering, so its last message is the answer, not the join of all of them.
  const text = resultText || lastText || doneText;
  if (structured === undefined && !text.trim()) throw new VelixContractError('empty_response', operation, adapter.id, `${label} terminou sem resposta em ${operation}. Nada foi salvo.`, executionId);
  return { structured, text, tools, generation: { agent: adapter.id, model, executionId, generatedAt: new Date().toISOString() } };
}
