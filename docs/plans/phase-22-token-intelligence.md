# Fase 22 — Token Intelligence

**Status: CONCLUÍDA em 2026-10-29.** Implementação, decisões e testes em `docs/PLAN.md`, Roadmap posterior.

1. Objetivo: transformar métricas reais de tokens em diagnóstico e otimização.
2. Reutilizar: Token Optimizer, eventos TaskEngine, painel Chat e analytics.
3. Lacunas: análise por agente/etapa/projeto e detecção de repetição ainda são limitadas.
4. Escopo: entrada, saída, cache, contexto, orçamento, progresso e alertas.
5. Arquitetura: consumir eventos existentes; não inventar contadores nem substituir o optimizer.
6. Componentes: orchestrator, agents, brain analytics, Chat e Dashboard.
7. Dados: agregações persistidas apenas para métricas fornecidas pelos agentes.
8. Fluxo: evento → normalização → agregação → alerta/relatório → recomendação.
9. Dependências: Fase 14, failover e adaptadores reais.
10. Segurança: credenciais e prompts completos não entram nos relatórios.
11. Limites: retenção, amostragem e orçamento configuráveis.
12. Testes: fixtures de eventos, ausência de métricas, loops e regressões.
13. Aceite: números rotulados como reais/estimados e recomendações reproduzíveis.
14. Riscos: métricas incompatíveis; exibir indisponível quando faltar dado.
15. Fora do escopo: preços ou limites de provedores não informados.
16. Entregáveis: agregador, UI, alertas, testes e documentação.
17. Status: CONCLUÍDA (2026-10-29).
