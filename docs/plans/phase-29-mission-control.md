# Fase 29 — Mission Control

## 1. Objetivo

Centralizar acompanhamento e controle de tarefas autônomas reais.

## 2. Estado atual

TaskEngine persiste status/eventos e o Chat exibe tarefas; falta uma visão operacional multi-tarefa.

## 3. Reutilização

TaskEngine, tasks/events/steps, Chat, token analytics, projetos, Brain e IPC reativo.

## 4. Escopo

Status em tempo real, progresso, filtros por projeto/agente, pausa, retomada, cancelamento, aprovações, alertas, tokens e histórico.

## 5. Arquitetura

Nova página sobre as consultas existentes; eventos coalescidos e atualização push, sem segundo estado de execução nem polling agressivo.

## 6. Componentes

Renderer Mission Control, main task service, shared contracts e TaskEngine.

## 7. Dados

Nenhuma duplicação de tarefas; agregações derivadas de tasks/steps/events/token analytics. Migração apenas se a retomada exigir checkpoint adicional.

## 8. Fluxo

Listar → filtrar → abrir detalhe → aprovar/pausar/retomar/cancelar → observar eventos → recuperar após reinício.

## 9. Segurança

Operações destrutivas confirmadas, isolamento por projeto e validação estrita de IDs.

## 10. Desempenho

Paginação, agregação bounded, coalescing de eventos e limite de tarefas simultâneas.

## 11. Dependências

TaskEngine, estados persistidos, Fase 22 e estabilidade de permissões/contexto.

## 12. Etapas

1. Modelo de consulta. 2. contratos/IPC. 3. página. 4. controles. 5. eventos e retomada. 6. acessibilidade. 7. testes.

## 13. Testes

Tarefas concorrentes, aprovação, pausa, retomada, cancelamento, falha, reinício, filtros e isolamento.

## 14. Aceite

Todas as tarefas reais aparecem com status/progresso; comandos de controle são idempotentes; reinício preserva estado; nenhuma métrica é inventada.

## 15. Riscos

Eventos fora de ordem e estado obsoleto. Mitigar com banco como fonte de verdade e versões/timestamps.

## 16. Fora do escopo

Agendamento recorrente, execução remota e nova engine.

## 17. Entregáveis

Página, contratos, agregações, controles, testes e documentação.

## 18. Status

**PENDENTE.**
