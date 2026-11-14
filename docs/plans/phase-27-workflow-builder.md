# Fase 27 — Workflow Builder

## 1. Objetivo

Permitir workflows visuais persistidos executados pelo TaskEngine existente.

## 2. Estado atual

O TaskEngine possui etapas fixas, aprovação, cancelamento, retomada e eventos; não há editor de workflows.

## 3. Reutilização

TaskEngine, Router, permissões, Brain/RAG, Token Optimizer, Chat e SQLite.

## 4. Escopo

Editor de etapas, agentes, permissões, condições, dependências, aprovação, sequência e paralelismo controlado, persistência, retomada e auditoria.

## 5. Arquitetura

Workflow validado por schema estrito que compila para comandos do TaskEngine; não executar DSL arbitrária nem criar executor paralelo independente.

## 6. Componentes

Orchestrator, shared contracts, database, main IPC, renderer Chat/Workflows e Brain.

## 7. Dados

Migração reversível para definições, versões, execuções, etapas e status; referências às tarefas existentes.

## 8. Fluxo

Criar/validar → revisar permissões → aprovar → executar dependências → persistir eventos → pausar/retomar → concluir.

## 9. Segurança

Allowlist de agentes/comandos, confirmação destrutiva, isolamento por projeto, sem conteúdo do workflow alterar autorização.

## 10. Desempenho

Limite de etapas, paralelismo, tokens, profundidade e duração; backpressure e cancelamento.

## 11. Dependências

TaskEngine estável, Fases 22 e 24, permissões e Brain.

## 12. Etapas

1. Schema/modelo. 2. CRUD e validação. 3. compilação para TaskEngine. 4. persistência/retomada. 5. editor. 6. auditoria. 7. testes.

## 13. Testes

Fluxo linear, dependências, paralelismo, aprovação, falha, retomada, cancelamento, schema inválido e isolamento.

## 14. Aceite

Workflow criado na UI executa somente etapas autorizadas, preserva ordem/dependências, pode pausar/retomar e deixa auditoria completa.

## 15. Riscos

Deadlock, duplicação e reexecução. Mitigar com IDs idempotentes, DAG validado e mutex.

## 16. Fora do escopo

Marketplace, workflows remotos e agentes sem autorização.

## 17. Entregáveis

Persistência, executor integrado, editor, IPC, auditoria, testes e documentação.

## 18. Status

**PENDENTE.**
