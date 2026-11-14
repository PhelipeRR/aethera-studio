# Fase 20 — Memory Confidence

**Status: CONCLUÍDA em 2026-10-29.** Implementação, decisões e testes em `docs/PLAN.md`, Roadmap posterior.

1. Objetivo: tornar cada memória rastreável e graduar sua confiança.
2. Reutilizar: BrainService, LearningService, SQLite, RAG, aprovação existente.
3. Lacunas: proveniência, evidências, validação e expiração ainda não são uniformes.
4. Escopo: origem, tarefa/sessão, arquivos/testes, estados `unverified/reviewed/stale`, revalidação e ranking.
5. Arquitetura: ampliar metadados existentes e integrar o ranking, sem novo serviço de memória.
6. Componentes: `packages/brain`, migrations, MCP, telas Aprendizados e Memória.
7. Dados: migração reversível para proveniência/evidências; preservar memórias antigas como não verificadas.
8. Fluxo: proposta → evidências → revisão → persistência → revalidação → RAG.
9. Dependências: fase 13, 7.5, 14 e sincronização de históricos estável.
10. Segurança: não elevar confiança por texto; não persistir segredos; respeitar projeto privado.
11. Limites: evidências e embeddings devem ser limitados por tarefa.
12. Testes: unitários, SQLite, RAG, MCP e E2E de revisão.
13. Aceite: confiança, origem e evidências visíveis; memórias obsoletas deixam de ser priorizadas.
14. Riscos: evidência ausente ou desatualizada; mitigar com estado explícito.
15. Fora do escopo: classificador externo obrigatório e backfill automático.
16. Entregáveis: migração, APIs, UI, testes e documentação.
17. Status: CONCLUÍDA (2026-10-29).
