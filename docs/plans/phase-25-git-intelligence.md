# Fase 25 — Git Intelligence

## 1. Objetivo

Relacionar commits, branches, diffs, tarefas e memórias para recuperar soluções históricas com referências verificáveis.

## 2. Estado atual

O NeuralBridge já possui Git por projeto, diffs, contagens, permissões, RAG, Brain e TaskEngine. Não criar um segundo scanner nem alterar repositórios.

## 3. Reutilização

Reutilizar `workspace/git`, projetos, RagEngine, HybridSearch, `memory_sources`, TaskEngine, MCP e IPC existentes.

## 4. Escopo

- Leitura somente leitura de commits, branches, autores, mensagens e diffs limitados.
- Indexação incremental por ref, hash e checkpoint.
- Associação a projeto, tarefa, memória e arquivos alterados.
- Busca textual/semântica com links para commit, arquivo e linha.
- Exclusão de segredos e isolamento por projeto.

## 5. Arquitetura

Adicionar um indexador incremental no pacote workspace e adaptar o RagEngine para fontes Git, sem duplicar busca ou embeddings. O contexto expõe dados como referência não confiável.

## 6. Componentes

`packages/workspace`, `packages/brain`, `packages/orchestrator`, MCP, Dashboard e página do projeto.

## 7. Dados

Preferir checkpoint por projeto/ref e documentos existentes do RAG. Migração só se a medição provar necessidade; nunca armazenar o repositório inteiro.

## 8. Fluxo

Projeto autorizado → validar raiz Git → ler delta → redigir segredos → indexar chunks → associar evidências → disponibilizar no RAG.

## 9. Segurança

Sem comandos de escrita, hooks, submódulos ou rede implícita. Respeitar raiz canônica, symlinks, permissões e projetos privados.

## 10. Desempenho

Lotes, limites de commits/diff/bytes, cancelamento, backpressure e uma execução por projeto.

## 11. Dependências

Fases 20 e 21, RAG, projetos e permissões.

## 12. Etapas

1. Contratos e checkpoint. 2. Leitor Git seguro. 3. Redação/chunking. 4. Indexação incremental. 5. associações Brain/Task. 6. UI/MCP. 7. validação.

## 13. Testes

Fixtures Git com commits, branches, renames, diffs grandes, segredos, repositório ausente, histórico alterado e projetos isolados; unitários, integração e E2E.

## 14. Aceite

Indexação reproduzível e incremental; busca retorna solução com commit/arquivo/linha; nenhum dado cru fora do projeto; cancelamento e reinicialização preservam checkpoint.

## 15. Riscos

Histórico grande, force-push, segredos e associação ambígua. Mitigar com limites, hashes, estado não associado e revisão humana.

## 16. Fora do escopo

Push, commit, checkout, merge, PR remoto e execução de hooks.

## 17. Entregáveis

Indexador, contratos, integração RAG/Brain, UI/MCP, testes e documentação.

## 18. Status

**CONCLUÍDA em 2026-10-29.** Implementação, decisões e testes em `docs/PLAN.md`, Roadmap posterior.
