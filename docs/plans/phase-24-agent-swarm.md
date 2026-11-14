# Fase 24 — Agent Swarm

Status inicial: **PENDENTE**. Planejamento somente.

1. Objetivo: orquestrar especialistas quando a complexidade justificar.
2. Reutilizar: TaskEngine, Router, failover, permissões, Token Optimizer e Brain.
3. Lacunas: papéis, dependências, paralelismo e consolidação ainda não existem como fluxo único.
4. Escopo: arquiteto, desenvolvedor, QA, segurança, revisor, contexto e resultados.
5. Arquitetura: extensão do TaskEngine; não criar um segundo orquestrador.
6. Componentes: orchestrator, agents, brain, workspace e Chat.
7. Dados: plano, especialistas, permissões, handoffs, artefatos e auditoria.
8. Fluxo: classificar → selecionar → executar isolado → revisar → consolidar → aprovar.
9. Dependências: fases 14, 16, 20–22 e estabilidade do TaskEngine.
10. Segurança: workspaces isolados, mutex, permissões por papel e confirmação destrutiva.
11. Limites: não acionar especialistas desnecessários; orçamento global obrigatório.
12. Testes: tarefas simples, paralelismo, conflitos, falhas, recuperação e E2E.
13. Aceite: resultados rastreáveis, sem sobrescrita concorrente e com parada segura.
14. Riscos: custo, deadlock e divergência; mitigar com limites e consolidação humana.
15. Fora do escopo: agentes autônomos sem autorização e execução fora do projeto.
16. Entregáveis: extensão do TaskEngine, UI, auditoria, testes e documentação.
17. Status: PENDENTE.
