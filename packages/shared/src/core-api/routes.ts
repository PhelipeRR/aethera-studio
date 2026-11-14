import { z } from 'zod';
import { CORE_API_PREFIX } from './common.js';
import { deviceSchema, pairingClaimRequestSchema, pairingClaimResponseSchema, pairingDecisionRequestSchema, pairingOfferSchema, pairingStartRequestSchema, pairingStatusSchema, revokeRequestSchema, revokeResponseSchema, tokenRequestSchema, tokenResponseSchema, auditEntrySchema, type Scope } from './auth.js';
import { healthSchema, orchestratorRegistrationSchema, reconciliationReportSchema } from './integrations.js';
import type { RateLimitClass } from './limits.js';
import type { CoreErrorCode } from './errors.js';
import { indexJobRequestSchema, indexJobSchema, indexStatusSchema, memoryListQuerySchema, memoryPageSchema, memorySchema, memorySearchRequestSchema, memorySearchResponseSchema, projectSearchRequestSchema, projectSearchResponseSchema, updateMemoryRequestSchema, writeMemoryRequestSchema } from './memory.js';
import { approvalDecisionRequestSchema, cancelTaskRequestSchema, continueTaskRequestSchema, createTaskRequestSchema, createTaskResponseSchema, recoverTaskRequestSchema, taskDetailSchema, taskListQuerySchema, taskPageSchema, taskSchema } from './tasks.js';
import { monitorSnapshotSchema } from '../monitoring.js';
import { pageSchema } from './common.js';

/*
 * CORE-02: the v1 route catalog. One entry per operation; CORE-03+ build the server, the OpenAPI document and the
 * desktop adapter from it, and the contract tests enforce its rules:
 * - every route lives under /api/v1 and declares the scope it needs (null only for health and the pairing/token
 *   handshake, which authenticate by code or refresh token instead);
 * - every POST/PUT/PATCH/DELETE that changes state requires an Idempotency-Key — retries can never create a second
 *   task, memory, device or job. Exceptions: the token endpoint (rotation already makes it single-use) and the two
 *   searches, which use POST only to carry the query in the body;
 * - local-only routes (pairing start, devices, orchestrator registration) are refused to remote principals.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteContract {
  method: HttpMethod;
  path: `${typeof CORE_API_PREFIX}/${string}`;
  summary: string;
  scope: Scope | null;
  /** Only the desktop (local principal) may call it. */
  localOnly: boolean;
  idempotencyKey: 'required' | 'none';
  rateLimit: RateLimitClass;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;
  /** Error codes specific to this route besides the common ones (invalid_request, unauthenticated, rate_limited…). */
  errors: readonly CoreErrorCode[];
}

const id = z.strictObject({ id: z.string().min(1).max(64) });
const empty = z.strictObject({});
const ok = z.strictObject({ ok: z.literal(true) });
const p = <S extends string>(path: S) => `${CORE_API_PREFIX}${path}` as const;

export const CORE_ROUTES = {
  health: { method: 'GET', path: p('/health'), summary: 'Estado do Core, versões e capacidades do desktop', scope: null, localOnly: false, idempotencyKey: 'none', rateLimit: 'read', response: healthSchema, errors: [] },

  // Pairing, tokens, devices
  pairingStart: { method: 'POST', path: p('/pairing'), summary: 'Inicia um pareamento e devolve a oferta do QR', scope: 'devices:manage', localOnly: true, idempotencyKey: 'required', rateLimit: 'pairing', body: pairingStartRequestSchema, response: pairingOfferSchema, errors: ['capability_unavailable'] },
  pairingClaim: { method: 'POST', path: p('/pairing/claim'), summary: 'O aparelho apresenta o código e a chave pública', scope: null, localOnly: false, idempotencyKey: 'required', rateLimit: 'pairing', body: pairingClaimRequestSchema, response: pairingClaimResponseSchema, errors: ['pairing_expired', 'locked_out'] },
  pairingStatus: { method: 'GET', path: p('/pairing/{id}'), summary: 'O aparelho acompanha a confirmação no desktop', scope: null, localOnly: false, idempotencyKey: 'none', rateLimit: 'pairing', params: id, response: pairingStatusSchema, errors: ['not_found', 'pairing_expired'] },
  pairingDecide: { method: 'POST', path: p('/pairing/{id}/decision'), summary: 'O desktop aprova ou recusa o aparelho', scope: 'devices:manage', localOnly: true, idempotencyKey: 'required', rateLimit: 'write', params: id, body: pairingDecisionRequestSchema, response: pairingStatusSchema, errors: ['not_found', 'pairing_expired', 'conflict'] },
  token: { method: 'POST', path: p('/auth/token'), summary: 'Troca o pareamento aprovado ou o refresh token por tokens novos', scope: null, localOnly: false, idempotencyKey: 'none', rateLimit: 'token', body: tokenRequestSchema, response: tokenResponseSchema, errors: ['proof_invalid', 'device_revoked', 'token_expired', 'locked_out'] },
  devicesList: { method: 'GET', path: p('/devices'), summary: 'Aparelhos pareados, último acesso e escopos', scope: 'devices:manage', localOnly: true, idempotencyKey: 'none', rateLimit: 'read', response: z.strictObject({ items: z.array(deviceSchema) }), errors: [] },
  devicesRevoke: { method: 'POST', path: p('/devices/revoke'), summary: 'Revoga um aparelho ou todos, na hora', scope: 'devices:manage', localOnly: true, idempotencyKey: 'required', rateLimit: 'write', body: revokeRequestSchema, response: revokeResponseSchema, errors: ['not_found'] },
  auditList: { method: 'GET', path: p('/audit'), summary: 'Trilha de auditoria (quem, o quê, de qual aparelho)', scope: 'devices:manage', localOnly: true, idempotencyKey: 'none', rateLimit: 'read', query: z.strictObject({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), response: pageSchema(auditEntrySchema), errors: [] },

  // Tasks
  tasksCreate: { method: 'POST', path: p('/tasks'), summary: 'Cria uma tarefa; o Core é o único executor', scope: 'task:create', localOnly: false, idempotencyKey: 'required', rateLimit: 'taskCreate', body: createTaskRequestSchema, response: createTaskResponseSchema, errors: ['not_found', 'scope_required', 'idempotency_conflict', 'external_ref_conflict', 'local_confirmation_required'] },
  tasksList: { method: 'GET', path: p('/tasks'), summary: 'Lista tarefas visíveis ao chamador', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'read', query: taskListQuerySchema, response: taskPageSchema, errors: [] },
  tasksGet: { method: 'GET', path: p('/tasks/{id}'), summary: 'Tarefa com etapas, executor e último id de evento', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'read', params: id, response: taskDetailSchema, errors: ['not_found'] },
  tasksContinue: { method: 'POST', path: p('/tasks/{id}/messages'), summary: 'Continua a conversa numa tarefa filha', scope: 'task:create', localOnly: false, idempotencyKey: 'required', rateLimit: 'taskCreate', params: id, body: continueTaskRequestSchema, response: createTaskResponseSchema, errors: ['not_found', 'invalid_transition', 'idempotency_conflict'] },
  tasksApproval: { method: 'POST', path: p('/tasks/{id}/approval'), summary: 'Aprova ou recusa a etapa que pediu aprovação', scope: 'task:approve', localOnly: false, idempotencyKey: 'required', rateLimit: 'command', params: id, body: approvalDecisionRequestSchema, response: taskSchema, errors: ['not_found', 'invalid_transition', 'local_confirmation_required'] },
  tasksCancel: { method: 'POST', path: p('/tasks/{id}/cancel'), summary: 'Pede o cancelamento; o Core cancela e emite task.cancelled', scope: 'task:cancel', localOnly: false, idempotencyKey: 'required', rateLimit: 'command', params: id, body: cancelTaskRequestSchema, response: taskSchema, errors: ['not_found', 'invalid_transition'] },
  tasksPause: { method: 'POST', path: p('/tasks/{id}/pause'), summary: 'Pausa entre etapas', scope: 'task:cancel', localOnly: false, idempotencyKey: 'required', rateLimit: 'command', params: id, body: empty, response: taskSchema, errors: ['not_found', 'invalid_transition'] },
  tasksResumePaused: { method: 'POST', path: p('/tasks/{id}/resume'), summary: 'Retoma uma tarefa pausada', scope: 'task:cancel', localOnly: false, idempotencyKey: 'required', rateLimit: 'command', params: id, body: empty, response: taskSchema, errors: ['not_found', 'invalid_transition'] },
  tasksRecover: { method: 'POST', path: p('/tasks/{id}/recover'), summary: 'Recupera uma tarefa interrompida ou com falha (nova tarefa filha)', scope: 'task:create', localOnly: false, idempotencyKey: 'required', rateLimit: 'taskCreate', params: id, body: recoverTaskRequestSchema, response: createTaskResponseSchema, errors: ['not_found', 'invalid_transition', 'idempotency_conflict'] },

  // Memory and RAG
  memoriesList: { method: 'GET', path: p('/memories'), summary: 'Lista memórias visíveis', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'read', query: memoryListQuerySchema, response: memoryPageSchema, errors: [] },
  memoriesGet: { method: 'GET', path: p('/memories/{id}'), summary: 'Memória completa', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'read', params: id, response: memorySchema, errors: ['not_found'] },
  memoriesCreate: { method: 'POST', path: p('/memories'), summary: 'Cria memória (sempre não verificada para chamadores remotos)', scope: 'memory:write', localOnly: false, idempotencyKey: 'required', rateLimit: 'write', body: writeMemoryRequestSchema, response: memorySchema, errors: ['not_found', 'idempotency_conflict', 'payload_too_large'] },
  memoriesUpdate: { method: 'PUT', path: p('/memories/{id}'), summary: 'Atualiza com versão esperada (concorrência otimista)', scope: 'memory:write', localOnly: false, idempotencyKey: 'required', rateLimit: 'write', params: id, body: updateMemoryRequestSchema, response: memorySchema, errors: ['not_found', 'conflict', 'idempotency_conflict', 'payload_too_large'] },
  memoriesDelete: { method: 'DELETE', path: p('/memories/{id}'), summary: 'Arquiva a memória (exclusão lógica, como hoje)', scope: 'memory:write', localOnly: false, idempotencyKey: 'required', rateLimit: 'write', params: id, response: ok, errors: ['not_found'] },
  memoriesSearch: { method: 'POST', path: p('/memories/search'), summary: 'Busca híbrida (texto + significado)', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'search', body: memorySearchRequestSchema, response: memorySearchResponseSchema, errors: ['semantic_unavailable'] },
  projectKnowledgeSearch: { method: 'POST', path: p('/projects/{id}/knowledge/search'), summary: 'Busca nos arquivos e no histórico Git indexados do projeto', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'search', params: id, body: projectSearchRequestSchema, response: projectSearchResponseSchema, errors: ['not_found'] },
  indexStatus: { method: 'GET', path: p('/index'), summary: 'Situação da indexação de memórias e projetos', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'read', response: indexStatusSchema, errors: [] },
  indexJobsCreate: { method: 'POST', path: p('/index/jobs'), summary: 'Pede reindexação; um trabalho por alvo', scope: 'index:manage', localOnly: false, idempotencyKey: 'required', rateLimit: 'write', body: indexJobRequestSchema, response: indexJobSchema, errors: ['not_found', 'conflict'] },
  indexJobsGet: { method: 'GET', path: p('/index/jobs/{id}'), summary: 'Andamento de um trabalho de indexação', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'read', params: id, response: indexJobSchema, errors: ['not_found'] },

  // Metrics and streams
  metricsSnapshot: { method: 'GET', path: p('/metrics'), summary: 'Amostras reais de hardware e consumo (mesma coleta do monitoramento)', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'read', query: z.strictObject({ since: z.coerce.number().int().nonnegative().optional() }), response: monitorSnapshotSchema, errors: ['capability_unavailable'] },
  websocket: { method: 'GET', path: p('/ws'), summary: 'WebSocket singularity.v1: eventos, assinatura, ack e comandos', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'stream', response: empty, errors: ['unsupported_version'] },
  sse: { method: 'GET', path: p('/streams/{stream}'), summary: 'SSE somente leitura com Last-Event-ID', scope: 'read', localOnly: false, idempotencyKey: 'none', rateLimit: 'stream', params: z.strictObject({ stream: z.string().min(1).max(80) }), response: empty, errors: ['not_found'] },

  // Orchestrators (Paperclip or other), prepared only
  orchestratorsRegister: { method: 'POST', path: p('/orchestrators'), summary: 'Registra um adaptador de orquestrador externo', scope: 'devices:manage', localOnly: true, idempotencyKey: 'required', rateLimit: 'write', body: orchestratorRegistrationSchema, response: ok, errors: ['conflict'] },
  orchestratorsReconcile: { method: 'POST', path: p('/orchestrators/{id}/reconciliation'), summary: 'O adaptador envia a comparação de estados; divergências viram alerta', scope: 'read', localOnly: false, idempotencyKey: 'required', rateLimit: 'write', params: id, body: reconciliationReportSchema, response: ok, errors: ['not_found', 'forbidden'] },
} as const satisfies Record<string, RouteContract>;

export type CoreRouteName = keyof typeof CORE_ROUTES;
