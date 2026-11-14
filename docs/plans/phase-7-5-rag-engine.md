# Fase 7.5 — Neural RAG Engine

## Objetivo

Adicionar recuperação inteligente de documentos, documentação e código ao Neural Brain, reutilizando SQLite/Drizzle, FTS5, embeddings locais, BrainService, MCP e o Token Optimizer planejado.

## Escopo

Indexação incremental por hash, chunks semânticos para Markdown, chunks orientados a símbolos para C# e TypeScript, busca híbrida RRF, filtros, grafo relacionado, contexto compacto com referências, exclusão/reindexação e avaliação reproduzível.

## Dependências

Fases 2, 3, 4 e 6; contratos de projeto e escopo; embeddings locais com fallback FTS-only; Token Optimizer da Fase 14 por contrato preparado.

## Arquitetura

O pipeline descobre arquivos elegíveis, aplica segurança e .gitignore, calcula hash, extrai chunks e grava estado em transações curtas. A recuperação reutiliza FTS5 e VectorIndex, funde rankings por RRF, deduplica, aplica escopo/filtros e passa trechos ao ContextBuilder. O MCP expõe a capacidade; conteúdo recuperado é dado não confiável e nunca é executado.

## Componentes reutilizados

packages/database (SQLite, Drizzle, WAL e FTS5); packages/brain (BrainService, links, busca híbrida, EmbeddingProvider, VectorIndex e ContextBuilder); packages/mcp-server (stdio, Zod e isolamento); packages/orchestrator (Token Optimizer); packages/shared (contratos).

## Componentes novos

Modelo de documento, versão e chunk; descoberta segura; pipeline incremental; extratores Markdown, C# e TypeScript; indexador com reconciliação; adaptador de recuperação contextual e métricas.

## Arquivos previstos

Possíveis caminhos: packages/database/src/schema.ts e migrações; packages/brain/src/ingestion/, chunking/ e rag/; contratos em packages/shared/src/; handlers em packages/mcp-server/src/; testes em packages/*/test/ e benchmarks em tests/benchmarks/. Nenhum arquivo de código deve ser criado nesta fase documental.

## Contratos e interfaces

DocumentIndexer: indexProject(projectId, root, signal?) e removeDocument(projectId, path).
Retriever: search(query, scope).
RetrievalResult: hits, degraded, references e metrics.

Os nomes finais devem preservar BrainService.search, BrainService.context, schemas MCP e o escopo atual; extensões são aditivas.

## Migrações necessárias

Adicionar tabelas/índices para documentos, versões e chunks, com hash por projeto/caminho/versão, linhas e estado de embedding. Manter FTS5, FKs com cascata e migrações reversíveis/testáveis.

## TDD: ciclos Red → Green → Refactor

1. Red: contratos, isolamento e migração falham. Green: schema mínimo e persistência. Refactor: índices alinhados.
2. Red: fixtures de descoberta, ignore, segredos e hash. Green: ingestão e reconciliação. Refactor: idempotência.
3. Red: chunks esperados de Markdown/C#/TypeScript. Green: extratores determinísticos. Refactor: metadados comuns.
4. Red: busca híbrida, deduplicação, filtros e fallback. Green: composição sobre FTS5/embeddings/RRF. Refactor: sem duplicação.
5. Red: contexto acima do orçamento e injection. Green: sanitização, truncamento e referências. Refactor: Token Optimizer.
6. Red: MCP inválido e escopo cruzado. Green: handler compatível e testes de processo. Refactor: schemas compartilhados.
7. Red: benchmark sem baseline. Green: dataset e harness reproduzíveis. Refactor: relatório compacto.

## Testes unitários

Hash e reconciliação; .gitignore/segredos; chunking determinístico; símbolos; metadados/linhas; RRF; deduplicação; filtros; orçamento; referências; sanitização contra prompt injection.

## Testes de integração

Banco vazio e existente; reindexação; exclusão; FTS5 + embeddings; fallback sem modelo; isolamento entre projetos; grafo relacionado; MCP stdio; Token Optimizer.

## Testes de segurança

Credenciais e arquivos sensíveis não persistem; traversal e symlinks fora da raiz são rejeitados; projetos não vazam dados; conteúdo recuperado não vira comando; exclusão remove obsoletos.

## Testes de desempenho

Medir ingestão incremental, latência p50/p95, memória, índice e tokens. Medir Recall@K, Precision@K e MRR com e sem semântica. Publicar somente resultados executados.

## Critérios de aceite

- Indexação idempotente e incremental por hash.
- Chunks e referências localizam arquivo e linhas.
- Busca híbrida, filtros, deduplicação e fallback funcionam.
- Isolamento, exclusão e proteção contra conteúdo instrucional são comprovados.
- MCP e Token Optimizer preservam contratos.
- Benchmarks reproduzíveis registram latência, relevância e tokens.

## Riscos e mitigações

RAM/latência: lazy load e FTS-only. Parser incompleto: fixtures e fallback por arquivo. Prompt injection: fontes são dados, nunca comandos. Concorrência: WAL, timeout e transações curtas. Escopo: interfaces pequenas e reutilização.

## Estratégia de rollback

Desativar RAG por configuração, manter BrainService.search em FTS-only e reverter a migração RAG apenas em ambiente de teste. Backups do SQLite precedem migrações; exclusões definitivas exigem operação explícita coberta por teste.
