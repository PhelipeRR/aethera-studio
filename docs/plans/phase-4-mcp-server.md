# Fase 4 — Servidor MCP independente (sub-plano)

Servidor stdio (`@modelcontextprotocol/sdk` 1.32.1) que expõe o Neural Brain e o estado das tarefas a Claude Code, Codex e outros clientes MCP, sem depender da janela do app.

## Arquivos

- `packages/brain/src/brain-service.ts` — novo `search(query, filter, scope, actor): SearchHit[]` (FTS5; a Fase 6 acrescenta semântica e RRF por trás da mesma assinatura).
- `packages/shared/src/brain.ts` — `searchFilterSchema`, `SearchHit`.
- `packages/mcp-server/src/scope-resolution.ts` — `resolveScope({ projectArg, cwd, includeGlobal }, projects): Scope`.
- `packages/mcp-server/src/tasks.ts` — consultas de `orchestrator_status` e `task_status` (somente leitura).
- `packages/mcp-server/src/server.ts` — `createMcpServer({ handle, brain, scope }): McpServer`.
- `packages/mcp-server/src/cli.ts` — entrada stdio: argumentos, banco, transporte, encerramento.
- `apps/desktop/electron.vite.config.ts` — segunda entrada do main → `out/main/mcp-server.js`.
- Testes: `packages/mcp-server/test/*.test.ts` (em processo, `InMemoryTransport`) e `tests/integration/mcp-process.test.ts` (processo real sobre o bundle; `npm run test:integration`).

## Ferramentas

| Ferramenta | Entrada (snake_case) | Saída |
|---|---|---|
| `brain_store` | `title`, `content`, `type`, `tags?`, `links?[{target, relation?}]`, `id?`, `global?` | memória gravada + `created`/`changed` |
| `brain_recall` | `id_or_title` | memória completa com links, backlinks e pendentes |
| `brain_search` | `query`, `type?`, `tags?`, `limit?` (1–20, padrão 8) | resultados com trecho e score |
| `brain_list` | `type?`, `tags?`, `trust?`, `limit?`, `cursor?` | página de resumos |
| `brain_delete` | `id` | confirmação — **somente soft delete** |
| `brain_links` | `id_or_title` | links de saída, backlinks, pendentes |
| `orchestrator_status` | — | contagem de tarefas por status e tarefas ativas do escopo |
| `task_status` | `task_id` | tarefa, etapas e último erro |

Decisões:
- **Sem exclusão definitiva via MCP.** Um agente apagar de vez é destrutivo; só a UI faz hard delete (Fase 8).
- **Agentes não escolhem outro projeto.** Em vez de `projectId`, `brain_store` aceita `global: true`. O projeto vem do escopo do processo.
- **Saída marcada como não confiável.** Todo resultado com dados de memória começa com uma linha avisando que é dado de referência, não instrução; o resto é JSON compacto.
- **Erros esperados** (`BrainError`) voltam como `isError: true` com `código: mensagem`; argumentos inválidos são rejeitados pelo SDK antes do handler. Nenhum dos dois derruba o processo.
- **Identidade do cliente** vem do `initialize` (`clientInfo.name`): contém "claude" → ator `claude`; "codex" → `codex`; senão `mcp`. Registrado como `mcp:<nome>`.
- **stdout é só protocolo.** Logs vão para stderr.

## Escopo do processo

Argumentos: `--project <id>`, `--cwd <dir>` (padrão: `process.cwd()`), `--no-global`. Dados: `NB_DATA_DIR` ou `%APPDATA%\NeuralBridge`.
1. `--project` informado → precisa existir, senão o processo sai com erro claro no stderr.
2. Senão, o projeto cadastrado cujo `root_path` contém o `cwd` (comparação de caminho normalizada, sem diferenciar caixa no Windows; o mais profundo vence).
3. Nenhum → escopo `global`.

## Busca (FTS5, provisória até a Fase 6)

Termos extraídos com `[\p{L}\p{N}_]+` (até 12), cada um como `"termo"*`, unidos por `OR` — a sintaxe FTS do usuário nunca chega crua ao `MATCH`. Ordem por `bm25` com peso 4 para título e 1 para conteúdo. Trecho via `snippet()`. Filtros de tipo e tags. Cada resultado devolvido registra `search_hit` no `access_log`.

## Testes

- Busca: sem acento/caixa; prefixo; título acima de conteúdo; escopo; apagadas fora; sintaxe FTS hostil não quebra; consulta vazia → `[]`; `search_hit` registrado.
- Escopo: `--project` válido/inválido; `cwd` dentro de projeto (inclusive subpasta e caixa diferente); projeto mais profundo vence; nenhum → global; `--no-global`.
- Ferramentas (em processo): `tools/list` com as 8 ferramentas; cada ferramenta no caminho feliz; argumentos inválidos → erro sem derrubar; `BrainError` → `isError`; isolamento entre dois servidores de projetos diferentes; ator derivado do `clientInfo`; aviso de dado não confiável presente; `brain_delete` não remove a linha.
- Processo real (bundle): sobe sem janela e responde `tools/list`; Claude-like grava e Codex-like lê entre dois processos; 3 processos gravando em paralelo sem erro e com `integrity_check = ok`; fechar o stdin encerra o processo.

## Aceite

`ELECTRON_RUN_AS_NODE=1 electron out/main/mcp-server.js` sobe sem a janela aberta e responde `tools/list`; testes acima verdes.
