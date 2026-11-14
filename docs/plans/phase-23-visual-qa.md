# Fase 23 — Visual QA

Status inicial: **PENDENTE**. Planejamento somente.

1. Objetivo: validar regressões visuais de aplicações autorizadas.
2. Reutilizar: Playwright, Electron, projetos e permissões existentes.
3. Lacunas: baselines, comparação e relatórios ainda não são um fluxo do produto.
4. Escopo: resoluções, screenshots, overflow, comparação, evidências e aprovação humana.
5. Arquitetura: runner isolado integrado ao TaskEngine, sem substituir testes funcionais.
6. Componentes: workspace, orchestrator, Playwright e UI de execuções.
7. Dados: artefatos por execução, baseline versionada e metadados de projeto.
8. Fluxo: autorização → execução → captura → comparação → revisão → baseline aprovada.
9. Dependências: permissões de projeto, Playwright e armazenamento de artefatos.
10. Segurança: somente origens/projetos autorizados; sem acesso externo implícito.
11. Limites: resoluções, tamanho e retenção de screenshots.
12. Testes: overflow, escala, baseline, rejeição e limpeza.
13. Aceite: relatório reproduzível sem confundir comparação visual com aceite funcional.
14. Riscos: flutuação de renderização; tolerâncias explícitas.
15. Fora do escopo: aprovação automática de baselines.
16. Entregáveis: runner, comparação, UI, testes e documentação.
17. Status: PENDENTE.
