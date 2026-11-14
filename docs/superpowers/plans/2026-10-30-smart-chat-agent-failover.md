# Smart Chat Agent Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement failover e recuperação automática entre Claude Code e Codex CLI no Chat existente.

**Architecture:** Estender o `TaskEngine` e os adaptadores atuais com disponibilidade estruturada, checkpoint por etapa e handoff persistido. O processo principal coordena espera/retomada; o renderer apenas exibe estado e dispara ações IPC.

**Tech Stack:** TypeScript, Electron main/preload/renderer, Drizzle/SQLite, Vitest e Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-10-30-smart-chat-agent-failover-design.md`

## Global Constraints

- Escopo exclusivo do Chat; não criar nova página, Workflow, Mission Control ou Autonomous Mission Mode.
- Automático pode fazer failover; Claude/Codex manual não podem trocar silenciosamente.
- Nunca inventar quota ou horário de recuperação.
- Conteúdo de agente, diff, comandos e resumo é dado não confiável.
- Não executar agentes simultaneamente na mesma tarefa nem repetir efeitos já concluídos.
- O app fechado não executa; recuperação ocorre após reinicialização.

## Review Focus

- Limite durante streaming ou ferramenta deve preservar eventos e arquivos antes do handoff.
- Autenticação, contexto excedido e falha de configuração não podem virar falso `RATE_LIMITED`.
- Checkpoint incompatível com o snapshot atual deve pausar, não editar automaticamente.
- Handoff grande, malformado ou instruído por conteúdo do agente deve ser limitado e inerte.
- Dois gatilhos de recuperação concorrentes não podem iniciar duas execuções.

### Task 1: Disponibilidade e classificação estruturada

**Files:** `packages/agents/src/agent.ts`, adaptadores, `packages/orchestrator/src/failover.ts`, testes de agents/orchestrator.

Implementar contrato de disponibilidade e classificação baseada em códigos/eventos, com fallback textual limitado e extração de `Retry-After`/horário somente quando confiável. Criar testes para os seis estados e para a distinção de autenticação/contexto.

### Task 2: Checkpoints, resumo incremental e handoff persistido

**Files:** nova migração aditiva após a maior migração existente, schema/database, `packages/orchestrator/src/engine.ts`, novo módulo de handoff/checkpoint e testes.

Persistir checkpoint transacional por etapa, resumo técnico limitado/redigido, artefatos, sessões, agente e próximo passo. Expor leitura interna para retomada e registrar evento de handoff na timeline. Testar idempotência, compatibilidade de snapshot, limites de tamanho e não persistência de credenciais.

### Task 3: Failover e espera por capacidade no TaskEngine

**Files:** `packages/orchestrator/src/engine.ts`, recovery policy, adapters, main tasks/IPC, testes unitários e integração.

No modo Automático, ao classificar limite, salvar checkpoint, registrar troca e executar o agente alternativo com handoff. Quando ambos estiverem limitados, persistir `WAITING_FOR_CAPACITY`, backoff/horário e preferência de retomada. Recuperar estados no startup, cancelar/pausar de forma segura e impedir loops/duplicação. Modo manual permanece sem failover.

### Task 4: Feedback no Chat existente

**Files:** shared channels/tasks, preload, `ChatPage.tsx`, `TaskCard.tsx`, labels e testes de renderer/E2E.

Usar os componentes existentes da conversa (`TaskCard`, timeline e controles do Chat) para exibir estado por agente, horário apenas se conhecido, preferência persistida, tentar novamente e evento discreto de troca. Não criar nova página nem novo painel; todos os controles devem chamar IPC real e atualizar pela fonte persistida.

### Task 5: Validação completa e documentação

**Files:** `tests/e2e`, testes de integração, `docs/PLAN.md`, `docs/STATUS.md`.

Cobrir os 20 cenários do documento, executar testes direcionados, suíte, typecheck, lint e build; registrar evidências, limitações de agentes reais e itens ainda planejados.
