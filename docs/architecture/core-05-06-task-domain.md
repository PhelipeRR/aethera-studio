# CORE-05 e CORE-06 — Domínio de tarefas no Core e desktop como adaptador

Status: **concluído em 2026-11-09** (commits por lote autorizados pelo usuário). Base: ADR CORE-01 §2.2–2.3, contratos
CORE-02, processo do CORE-03 e lease/idempotência do CORE-04.

## CORE-05 — o Core compõe e serve o domínio de tarefas

| Peça | Onde | O que faz |
|---|---|---|
| Composição única do motor | `apps/desktop/src/main/task-composition.ts` | O mesmo `TaskEngine` (adaptadores Claude/Codex, MCP por tarefa, contexto de memória e RAG, skills, aprendizados, orçamento de tokens) para o main e para o Core. Sem Electron (regra de lint). O main passou a usá-la, então não há duas versões do motor |
| Host do Core | `apps/desktop/src/core-host/main.ts` → `out/main/core.js` | O processo genérico do `packages/core` (`runCoreProcess`) com o domínio do desktop. `packages/core/src/bin.ts` continua sendo um Core sem domínio |
| Domínio | `core-host/domain.ts` | Abre o mesmo banco (WAL), monta só o provedor de busca semântica (o indexador continua só no desktop, para não indexar em dobro), a fila de aprendizados e o motor com identidade de lease própria |
| Rotas públicas (contrato CORE-02) | `POST/GET /api/v1/tasks`, `GET /api/v1/tasks/{id}`, `cancel`, `approval`, `pause`, `resume`, `messages`, `recover`, `GET /api/v1/streams/{tasks\|task:<id>}` | Validação pelos esquemas do contrato, `Idempotency-Key` obrigatória nas mudanças (repetição devolve `replayed: true`, outro corpo é `idempotency_conflict`), transições checadas (`invalid_transition`), erros no envelope do contrato |
| Rotas internas do adaptador | `POST /internal/v1/tasks/<comando>`, `GET /internal/v1/engine-events` | Os mesmos esquemas de entrada do IPC (`parseIpcInput`) e as atualizações cruas do motor, para o desktop se comportar exatamente como antes |
| Eventos | `packages/core/src/event-log.ts` | Log por stream com ids crescentes, retenção de 10.000, SSE com `Last-Event-ID`/`since` e evento `gap` quando a retenção foi ultrapassada |
| Autenticação provisória | `Authorization: Bearer` com token aleatório de 32 bytes | O Core gera o token, envia só pelo canal IPC na mensagem `ready` e nunca o grava. O `/health` continua público. Aparelhos e escopos chegam no CORE-07 |
| Nível de acesso da tarefa | migração aditiva 0095 `tasks.access` | Guarda `read-only`/`edit` pedido; linhas antigas ficam nulas, que no motor sempre significou `edit` |
| Mapeamento público | `core-host/task-mapping.ts` | Converte o modelo de leitura atual no `Task` do contrato sem inventar dados (criador = desktop, ou o orquestrador do `externalRef`) |

## CORE-06 — o desktop vira adaptador (grupo de tarefas)

O renderer continua falando o mesmo IPC. Atrás dele, `apps/desktop/src/main/core/hybrid-task-service.ts`:

| Operação | Para onde vai |
|---|---|
| Iniciar trabalho: chat, continuar conversa, correção automática, revisão Git, smart commit, swarm | Core (executor) |
| Comandos sobre uma tarefa existente: aprovar, cancelar, pausar, retomar, capacidade | Quem segura o lease da tarefa (Core ou desktop) |
| Leituras: lista, detalhe, threads, imagens, modelos, relatórios | Locais, no mesmo banco, como antes |
| Eventos | O stream do Core é reemitido no emissor do motor do desktop: janelas, Companion, workflows, missões e atualização de perfil continuam iguais |
| Core fora do ar (desligado, falhou, reiniciando) | O desktop executa localmente, como antes; o lease mantém um executor por tarefa |

Grupos que **continuam no desktop** e mudam em lotes futuros: workflows (etapas), Void/Neura (execuções somente leitura
estruturadas), produções do Velix, missões autônomas e automações Git. Eles usam o motor do desktop; o lease garante
que nenhuma tarefa roda em dois lugares.

Chave de reversão: `NB_CORE_TASKS=main` mantém o grupo de tarefas no desktop (testado). `NB_CORE_DISABLED=1` desliga o
Core inteiro; nesse caso o adaptador cai no caminho local automaticamente.

## Testes

- `apps/desktop/test/core-task-routes.test.ts` (6, servidor real com motor e agente falso): exige o token; idempotência
  (sem chave 428, criação 201, repetição com `replayed`, outro corpo 409); detalhe, lista e comandos nos esquemas do
  contrato; transição impossível 409; lease visível durante a execução e cancelamento pela API; SSE com ids crescentes
  e retomada exata por `Last-Event-ID`; rotas internas com os esquemas do IPC.
- `tests/e2e/core-tasks.spec.ts` (3, app real): a tarefa do chat roda no processo do Core (o dono do lease é o PID do
  Core, não o do desktop), aparece em execução na tela pela ponte de eventos e é cancelada pelo Core; tarefa concluída
  chega com etapas e resposta; `NB_CORE_TASKS=main` executa no desktop.
- Regressão completa registrada em `docs/STATUS.md`.

## Riscos e limites

- Busca semântica no contexto da tarefa carrega o modelo também no Core quando ativada (mais memória na primeira tarefa).
- Durante a subida do Core (fração de segundo), um pedido cai no caminho local; é correto, mas a tarefa executa no desktop.
- Aprovar/cancelar via IPC continua síncrono para o renderer; o encaminhamento ao Core é assíncrono e falhas ficam no log
  (o estado da tarefa mostra o resultado real).
