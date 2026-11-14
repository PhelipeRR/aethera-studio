# Fase 26 — Auto-Healing Seguro

## 1. Objetivo

Detectar falhas, propor correções autorizadas, testar e reverter com segurança.

## 2. Estado atual

TaskEngine registra etapas, erros, failover conservador, permissões, rollback e limites. Não existe correção automática completa.

## 3. Reutilização

TaskEngine, Brain/RAG, LearningService, Token Optimizer, Git/workspace, aprovação e permissões.

## 4. Escopo

Captura de falhas de build/testes/execução; diagnóstico baseado em evidência; proposta; aprovação; patch no workspace autorizado; validação; rollback; limite de tentativas e ausência de progresso.

## 5. Arquitetura

Extensão do TaskEngine como ciclo bounded diagnose → propose → approve → edit → validate. Nenhum segundo orquestrador.

## 6. Componentes

Orchestrator, agents, workspace, Brain, RAG, Skills, Chat e Mission Control futura.

## 7. Dados

Reutilizar tasks/events/steps e Git. Persistir tentativa, diagnóstico, evidências, aprovação, resultado e rollback somente se necessário.

## 8. Fluxo

Falha → classificar → recuperar evidências → propor → aprovação → snapshot/branch → alteração → testes → concluir ou restaurar.

## 9. Segurança

Sem correção automática de alto risco; confirmação para destruição, fora da raiz, permissões e credenciais. Não sobrescrever alterações não salvas.

## 10. Desempenho

Máximo de tentativas, orçamento global, timeout, mutex por projeto e cancelamento real.

## 11. Dependências

Fases 20–22, permissões, TaskEngine e adapters.

## 12. Etapas

1. Modelo de diagnóstico. 2. Propostas. 3. aprovação/snapshot. 4. execução limitada. 5. validação/rollback. 6. UI/auditoria. 7. testes.

## 13. Testes

Falha corrigível, hipótese sem evidência, patch inválido, testes falhos, rollback, cancelamento, loops, permissões e concorrência.

## 14. Aceite

Correções só após autorização; testes comprovam sucesso; falha restaura estado; loops param; cada ação tem evidência e auditoria.

## 15. Riscos

Diagnóstico errado, perda de alterações, loop e custo. Mitigar com snapshots, limites e aprovação.

## 16. Fora do escopo

Agente autônomo irrestrito, deploy, push e correções sem evidência.

## 17. Entregáveis

Ciclo bounded, rollback, UI, auditoria, testes e documentação.

## 18. Status

**CONCLUÍDA em 2026-10-29.** Implementação, decisões e limitações em `docs/PLAN.md`, Roadmap posterior.
