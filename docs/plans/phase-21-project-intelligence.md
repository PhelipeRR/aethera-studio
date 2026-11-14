# Fase 21 — Project Intelligence

**Status: CONCLUÍDA em 2026-10-29.** Implementação, decisões e testes em `docs/PLAN.md`, Roadmap posterior.

1. Objetivo: perfil técnico incremental e isolado por projeto.
2. Reutilizar: ProjectService, RAG, embeddings, Brain e TaskEngine.
3. Lacunas: estrutura, stack e convenções não estão consolidadas em um perfil.
4. Escopo: módulos, dependências, decisões, problemas recorrentes e contexto por tarefa.
5. Arquitetura: indexação incremental sobre o scanner/RAG existente; sem segunda indexação.
6. Componentes: workspace, brain, orchestrator, MCP e Dashboard.
7. Dados: entidades de perfil e evidências, com migração somente se necessário.
8. Fluxo: projeto autorizado → descoberta → delta → evidências → contexto selecionado.
9. Dependências: Memory Confidence, projetos e permissões.
10. Segurança: raiz canônica, symlink/traversal bloqueados e isolamento entre projetos.
11. Limites: lotes, orçamento de tokens e exclusão de arquivos sensíveis.
12. Testes: fixtures de projetos, isolamento, incrementalidade, RAG e E2E.
13. Aceite: perfil reproduzível, atualizado por delta e usado no contexto correto.
14. Riscos: inferência errada; exigir evidência e permitir revisão.
15. Fora do escopo: refatorar o ProjectService ou enviar código a provedores.
16. Entregáveis: indexador, contexto, UI, testes e documentação.
17. Status: CONCLUÍDA (2026-10-29).
