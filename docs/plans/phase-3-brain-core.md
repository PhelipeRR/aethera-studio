# Fase 3 — Núcleo do Neural Brain (sub-plano)

Implementa `store / recall / list / delete / links / versions` sobre o banco da Fase 2. Busca (FTS e semântica) fica na Fase 6; `brain_context` na Fase 14.

## Arquivos

- `packages/shared/src/brain.ts` — schemas Zod de entrada (`storeInputSchema`, `listFilterSchema`) e tipos de saída (`Memory`, `MemoryDetail`, `MemorySummary`, `MemoryVersion`, `LinkRef`). Compartilhados com o MCP (Fase 4) e o IPC (Fase 8).
- `packages/brain/src/ids.ts` — `newId(): string` (ULID, 26 chars Crockford, ordenável por tempo).
- `packages/brain/src/wikilinks.ts` — `parseWikiLinks(markdown): string[]`.
- `packages/brain/src/scope.ts` — `Scope` e regras de visibilidade/escrita.
- `packages/brain/src/errors.ts` — `BrainError` com `code: 'not_found' | 'forbidden' | 'invalid' | 'conflict'`.
- `packages/brain/src/brain-service.ts` — `class BrainService`.

## Regras decididas

**Escopo** (`Scope`):
- `{ kind: 'project', projectId, includeGlobal }` — MCP iniciado num projeto. Vê memórias do projeto e, se `includeGlobal`, as globais.
- `{ kind: 'global' }` — MCP sem projeto identificado. Vê só globais.
- `{ kind: 'all', includePrivate }` — a UI do usuário. Vê tudo; projetos `is_private` só com `includePrivate`.
- Escrita: `projectId` omitido → projeto do escopo (ou global); `null` explícito → global (exige ver globais). Escopo `project` não escreve em outro projeto (`forbidden`). Mudar o projeto de uma memória existente → `invalid`.

**Ator** (`Actor = { kind: SourceKind; client: string }`): grava `source_kind` na criação, `changed_by` nas versões e `client` no `access_log`. Só `kind: 'user'` pode definir `trust`; escrita de agente sempre deixa `trust = 'unverified'`.

**store** (cria ou atualiza, em uma transação):
1. `id` informado → atualiza essa memória (visível e não apagada) ou `not_found`.
2. Sem `id`, existe memória viva com o mesmo título (sem diferenciar caixa) no projeto alvo → atualiza (upsert por título, semântica do AI Brain).
3. Senão cria com `version = 1`.
4. Atualização sem mudança real (título, conteúdo, tipo, tags, links explícitos) → não cria versão nem altera `updated_at`.
5. Toda criação/mudança grava snapshot em `memory_versions`. Mudança de título/conteúdo → `embedding_status = 'pending'`.
6. Links de saída são substituídos: `[[Título]]` do conteúdo (`origin = 'wikilink'`) + `links` explícitos (`origin = 'explicit'`, `relation` livre). Resolução do alvo: memória viva com o título no mesmo projeto; senão global. Sem alvo → pendente (`target_id = null`).
7. Criação ou renomeação resolve pendentes que apontam para o novo título: fontes do mesmo projeto, ou de qualquer projeto quando a memória nova é global.
8. Escritas (`store`, `delete`) rodam em `BEGIN IMMEDIATE`: o lock de escrita é pego antes da busca por título, então outro processo (app ou servidor MCP) espera o `busy_timeout` em vez de criar o mesmo título no meio. (A ideia inicial de "repetir como atualização" não funcionaria: em WAL, uma transação adiada que leu e depois escreve falha com `SQLITE_BUSY_SNAPSHOT`, não com violação de unicidade.) Renomear para um título já existente → `conflict`.

**delete**: soft por padrão (`deleted_at`); links que apontavam para ela voltam a pendentes. `hard: true` remove a linha (cascata da Fase 2).

**recall(idOrTitle)**: por id; senão por título, preferindo o projeto do escopo ao global. Retorna tags, links de saída, backlinks (de fontes vivas e visíveis) e títulos pendentes. Registra `access_log` (`recall`).

**list**: filtros `projectId`, `type`, `tags` (todas), `trust`; ordem `updated_at desc, id desc`; `limit` 1–100 (padrão 20); cursor opaco. Itens com trecho de até 240 caracteres.

**Limites (Zod)**: título 1–200 sem quebra de linha nem `[[`/`]]`; conteúdo até 100.000 caracteres; até 20 tags de 1–40 caracteres (normalizadas: trim + minúsculas); até 50 links explícitos.

**Wikilinks**: `[[Título]]` e `[[Título|apelido]]`; ignorados dentro de blocos de código cercados e de código inline; deduplicados sem diferenciar caixa; título vazio ou > 200 ignorado.

## Testes (TDD)

- `ids.test.ts`: formato, unicidade em lote, ordem por tempo.
- `wikilinks.test.ts`: básico, apelido, dedupe, código cercado/inline ignorado, vazio/longo ignorado.
- `brain-service.test.ts`: criação com versão 1; upsert por título; update sem mudança não versiona; trust de agente vs usuário; embedding volta a `pending`; pendente resolvido ao criar o alvo; renomeação resolve pendentes; link de projeto para global; global não liga para memória de projeto; backlinks e pendentes; isolamento entre projetos (leitura e escrita); `global` não vê projetos; `all` sem `includePrivate` esconde privados; soft delete torna links pendentes e libera o título; hard delete; list com filtros, ordem e paginação; validação de entrada; `access_log` no recall; corrida simulada no índice único.

## Aceite

Todos os testes verdes; typecheck e lint limpos. Nenhuma mudança visível no app nesta fase.
