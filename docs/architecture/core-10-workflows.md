# CORE-10 — Workflows no Core

## Decisão

As etapas de agente de Workflows passam a usar a mesma ponte híbrida já usada por tarefas e Missões. O coordenador,
checkpoints, recuperação, etapas RAG/validation/Git nativas e aprovações continuam no Desktop; somente a execução da
etapa de agente atravessa o Core.

## Ownership e idempotência

Cada etapa usa `externalRef.system = workflow`, `externalRef.id = <workflow-run>/<step-id>` e a revisão do número da
tentativa. A mesma tentativa pode ser repetida sem criar outra tarefa no Core; uma nova tentativa tem revisão maior.
O Core continua dono do lease e do executor quando está ativo.

## Rollback

`NB_CORE_TASKS=main` ou uma queda do Core faz a ponte usar o `TaskService` local, preservando o coordenador e os dados de
workflow. Não há migração de banco. A alteração do contrato é aditiva e os `timeoutMs` continuam sendo responsabilidade
do coordenador.

## Evidência

Os testes de `workflow-runner` (25) e de Missões (4) passaram, junto do typecheck do Orchestrator/Desktop e lint dos
arquivos alterados. O inventário dinâmico (`tests/e2e/core-dynamic-inventory.spec.ts`) prova o passo de agente no
processo do Core. A recuperação de execuções no boot também espera o Core (`waitForCore`), para que passos retomados não
caiam no Desktop enquanto o Core ainda inicia.
