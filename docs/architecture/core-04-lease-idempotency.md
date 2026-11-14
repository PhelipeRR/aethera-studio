# CORE-04 — Lease, `external_ref` e idempotência

Status: **concluído em 2026-11-09** (commit por lote autorizado pelo usuário). Base: ADR CORE-01 §2.2 e §6, contratos
CORE-02 (C2-5, C2-6).

## O que mudou

| Peça | Onde | Comportamento |
|---|---|---|
| Migração 0093 (aditiva) | `tasks.owner_instance_id`, `lease_expires_at`, `external_system`, `external_id`, `external_revision` + índice único parcial `(external_system, external_id)` | Código antigo ignora as colunas; tarefas existentes ficam com tudo nulo |
| Migração 0094 (aditiva) | tabela `idempotency_keys` (chave primária `scope + key`, expiração) | Nova; nada existente muda |
| `TaskLeases` | `packages/orchestrator/src/task-lease.ts` | Um único `UPDATE` adquire: livre, já é meu ou vencido → meu. O SQLite serializa escritores, então entre processos só um ganha. Renovação a cada 20 s, validade de 60 s |
| `TaskEngine` | `launch()` (ponto único de toda execução: tarefa, correção, revisão Git, smart commit) | Sem lease, não executa (evento `lease_denied`, tarefa intocada). Se a renovação falhar (lease perdido), a execução é abortada. O lease é liberado no fim |
| Recuperação | `TaskEngine.recover()` | Não marca como interrompida uma tarefa cujo lease outro executor vivo ainda segura; ao recuperar, limpa o lease |
| Identidade do executor | `newInstanceId()` = `<pid>:<uuid>` | Um lease de processo morto, ou de um engine anterior do mesmo processo, não conta como ocupado: a recuperação depois de uma queda continua imediata, sem esperar 60 s |
| `externalRef` | `StartInput.externalRef` | O mesmo `system + id` devolve a tarefa já criada (guarda a maior revisão); o índice único resolve corrida entre processos |
| `IdempotencyStore` | `packages/database/src/idempotency.ts` | `claim` → `new`, `replay` (mesmo corpo), `conflict` (outro corpo), `in_progress`; `release` libera depois de falha; retenção de 24 h. Usado pela API HTTP a partir do CORE-05 |

## Testes

- `packages/orchestrator/test/task-lease.test.ts` (6): 8 threads com conexões próprias disputando o mesmo lease ao mesmo
  tempo → exatamente 1 vence; renovação, expiração e liberação; lease de processo morto ou de engine anterior; engine
  que não executa sem lease e recuperação que não toca tarefa de outro executor vivo; `externalRef` sem duplicar.
- `packages/database/test/idempotency.test.ts` (5): replay, conflito, por escopo, liberação, retenção, duas conexões
  disputando a mesma chave, índice único de `external_ref`.
- Regressão: Vitest serial 2059/2059; E2E de tarefas, chat, correção automática, Mission Control, permissões, workflows,
  produções do Velix e Core 42/42.

## Reverter

As colunas e a tabela são aditivas: uma versão anterior abre o banco normalmente e as ignora. No código, remover as
chamadas a `leases` em `launch()`/`recover()` volta ao comportamento anterior.
