# Fase 0 — Relatório dos spikes (2026-10-28)

Código descartável em `spikes/` (ignorado pelo git). Máquina: Windows 11, Node 24.17.0, Claude Code 2.1.312, Codex CLI 0.162.1.

Versões usadas: electron 44.9.3, better-sqlite3 13.0.3, @huggingface/transformers 4.3.1 (onnxruntime-node 1.30.0), @modelcontextprotocol/sdk 1.32.1, zod 4.6.7.

## Resumo

| Spike | Resultado | Decisão afetada |
|---|---|---|
| S1 SQLite/FTS5 no runtime Electron | ✅ | R1 praticamente eliminado |
| S2 CLIs headless | ✅ com 3 achados | R3, R6, R13, novos R14/R15 |
| S3 Embeddings locais | ✅ | A6 confirmado; R5 quantificado |
| S4 MCP stdio Claude ↔ Codex | ✅ após ajustar permissões | Fase 5 desbloqueada |

## S1 — better-sqlite3 + FTS5

- better-sqlite3 13 é **N-API** (depende de `node-addon-api`) e traz prebuilds `win32-x64`. O **mesmo binário** carregou no Node 24, no Electron 44 com `ELECTRON_RUN_AS_NODE=1` e no processo main do Electron. Sem `electron-rebuild`.
- SQLite 3.53.4, WAL ativo, FTS5 com `tokenize='unicode61 remove_diacritics 2'`: consulta `decisao OR migracao` encontrou "Decisão de arquitetura".
- Concorrência: 3 processos (2 Electron-as-node + 1 Node) × 2.000 transações de 2 inserts no mesmo arquivo WAL com `busy_timeout=5000`: 0 erros, 12.000 linhas, `integrity_check = ok`, 0,18 s.

**Consequência:** Vitest pode rodar no Node do sistema; manter Electron-as-node só no servidor MCP empacotado (o usuário final não precisa ter Node). O script `vitest-electron.mjs` deixa de ser obrigatório.

## S2 — Claude e Codex headless

Execução: `spawn(..., { shell: false, stdio: ['ignore','pipe','pipe'] })`, repositório git temporário em caminho com espaço e acento (`nb s2 ação-*`).

| Teste | Comando-chave | Resultado |
|---|---|---|
| claude-ok | `claude.exe -p "…" --output-format stream-json --verbose --permission-mode plan` | 7,5 s, exit 0 |
| claude-edit | `… --permission-mode acceptEdits --allowedTools Write` | `hello.txt = "oi"` |
| codex-ok | `node codex.js exec --json -s read-only --skip-git-repo-check "…"` | 5,8 s, exit 0 |
| codex-edit | `… -s workspace-write` | ❌ depois ✅ (ver achado 1) |
| cancelamento | `taskkill /PID <pid> /T /F` após 8 s | ambos encerrados, exit 1, nenhum processo filho restante |
| claude --bare | `… --bare` | ❌ "Not logged in" (ver achado 3) |

**Resolução de executáveis (R13):** Claude é `~/.local/bin/claude.exe` nativo. Codex instalado via npm: o shim `codex.cmd` chama `node …/@openai/codex/bin/codex.js`, que define `CODEX_MANAGED_PACKAGE_ROOT` e chama `codex.exe` do pacote `@openai/codex-win32-x64`. Decisão: o adaptador executa `node <codex.js>` com `shell:false` (mantém o ambiente que o launcher oficial monta). Com `stdin` aberto o Codex imprime "Reading additional input from stdin…": usar `stdin: 'ignore'` ou enviar o prompt por stdin de propósito.

**Formatos de saída (fixtures em `spikes/s2/fixtures/`):**
- Claude stream-json: `system/init` (session_id, tools, mcp_servers, model, permissionMode, versão), `system/hook_*`, `system/thinking_tokens`, `assistant`, `rate_limit_event`, `system/post_turn_summary`, `result/success` (`session_id`, `usage`, `modelUsage`, `total_cost_usd`, `permission_denials`, `num_turns`, `is_error`, `terminal_reason`).
- Codex `--json`: `thread.started` (`thread_id`), `turn.started`, `item.completed` (`item.type = agent_message | command_execution | …`), `turn.completed` (`usage.input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`).
- As fixtures contêm caminhos e lista de skills do usuário → **redigir antes de versionar** em `packages/agents/test/fixtures` (Fase 7).

**Achado 1 — sandbox do Codex no Windows.** O `~/.codex/config.toml` do usuário tem `[windows] sandbox = "elevated"` (compartilhado com o app Codex desktop). Iniciado por outro processo, `workspace-write` falha com `helper_unknown_error: setup refresh had errors` — não é o caminho (falhou também em `C:\dev\…\plain-*`). Valores válidos (do próprio parser do CLI): `elevated`, `unelevated`, `mxc`. Com `-c windows.sandbox="unelevated"` **por invocação** a escrita funcionou, sem tocar no config do usuário. Trade-off: `unelevated` isola menos que `elevated`. → novo risco R14.

**Achado 2 — custo base do Claude.** Um "Responda apenas: ok" gerou `cache_creation_input_tokens = 45.063` (hooks, skills, plugins e CLAUDE.md globais carregados em toda sessão) e `total_cost_usd = 0.36` (equivalente API; o usuário usa assinatura). Codex: `input_tokens = 15.015` (11.392 em cache). O TokenOptimizer não controla esse piso; deve medi-lo e mostrá-lo separado do contexto que o NeuralBridge injeta. → R15.

**Achado 3 — `--bare` exige API key.** Com login claude.ai, `--bare` retorna `terminal_reason: api_error`, "Not logged in". Não é opção para reduzir o piso do achado 2. Alternativas a avaliar na Fase 7/14: `--strict-mcp-config` (já usado), `--disallowedTools`, `--setting-sources` se existir na versão instalada (verificar no `--help`, não presumir).

**Permissões no modo headless (R3):** Claude com `--permission-mode plan` não executa ferramentas de escrita nem MCP de escrita, mesmo listadas em `--allowedTools`; com `default` + `--allowedTools` executa só o que foi liberado. Isso confirma o desenho "aprovação antes da execução + lista de ferramentas permitidas".

## S3 — Embeddings locais

`pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8', device: 'cpu' })`, prefixos `query: ` / `passage: `, mean pooling + normalização.

| Métrica | Node 24 (1ª vez, com download) | Electron-as-node (cache) |
|---|---|---|
| Carga | 5,98 s | 0,51 s |
| Lote de 4 passagens | 13 ms | 11 ms |
| Por consulta | 2 ms | 1 ms |
| RSS após carga | 510 MB (+444) | 374 MB (+313) |

- Disco: 130 MB em `models/`. Dimensão 384.
- Relevância: 3/3 consultas com o documento certo em 1º, incluindo cruzamento de idioma ("authentication flow" → texto EN; "database connection pool error" → texto PT). Cosseno 0,80–0,85.
- **R5 quantificado:** ~300 MB de RAM por processo com o modelo carregado. Com 2–3 sessões MCP abertas → até ~1 GB. Mantém a decisão de carga sob demanda + descarga por ociosidade; reavaliar o daemon (A5) se o uso real mostrar várias sessões simultâneas.

## S4 — MCP stdio entre Claude e Codex

Servidor: `McpServer` + `StdioServerTransport` (SDK 1.32.1, `registerTool` com schema Zod), executado como `electron.exe server.mjs` com `ELECTRON_RUN_AS_NODE=1`, gravando no SQLite.

Fluxo comprovado: Claude chamou `spike_store(key, value aleatório)` → a linha ficou gravada com `who = 'claude'` → Codex, em outro processo, chamou `spike_recall(key)` e devolveu o mesmo valor aleatório. ~10 s cada.

Sem nenhum registro persistente nos clientes:
- Claude: `--mcp-config claude-mcp.json --strict-mcp-config --allowedTools mcp__nbspike__spike_store --permission-mode default`.
- Codex: `-c mcp_servers.nbspike.command=… -c mcp_servers.nbspike.args=[…] -c mcp_servers.nbspike.env={…} -c mcp_servers.nbspike.default_tools_approval_mode="approve" -c mcp_servers.nbspike.enabled_tools=["spike_recall"]`.

Falhas encontradas no caminho (e corrigidas):
- Claude em `--permission-mode plan` recusou gravar ("modo de planejamento ativo").
- Codex `exec` recusou a ferramenta: "MCP tool call requires approval, but approval policy is never". Chave oficial `default_tools_approval_mode`, valores válidos `auto | prompt | writes | approve`.

**Consequência para o produto:** quando o NeuralBridge executa os agentes, ele injeta o próprio MCP por invocação (`--mcp-config` / `-c mcp_servers…`) e não depende do registro global. O registro global (`claude mcp add` / `codex mcp add`, Fase 5) continua sendo para o uso do usuário fora do app.

## Pendências não cobertas pelos spikes

- Build empacotado (asar/asarUnpack) com better-sqlite3 e onnxruntime-node — Fase 17.
- GPU (DirectML) para embeddings — opcional, não testado.
- `--resume` do Claude e `codex exec resume` — Fase 11.
- Comportamento com CLI deslogado — Fase 7.

---

# Fase 5 — Prova real Claude Code ↔ Codex (2026-10-28)

Teste: `tests/integration/real-clients.test.ts` (`NB_REAL_CLI=1`), sobre o bundle `out/main/mcp-server.js` injetado por invocação (`--mcp-config --strict-mcp-config` no Claude; `-c mcp_servers.neuralbridge.*` no Codex). Nenhuma configuração do usuário foi alterada. Projeto temporário `shop api` (com espaço) cadastrado no banco; os dois CLIs foram executados dentro dessa pasta.

| Passo | Cliente | Ação | Resultado |
|---|---|---|---|
| 1 | Claude Code 2.1.312 | `brain_store` de uma decisão com código de verificação aleatório | gravada: `type=decision`, `source_kind=claude`, `project_id=shop-api` |
| 2 | Codex CLI 0.162.1 | `brain_recall` da decisão + `brain_store` do resultado com `[[link]]` para a decisão | Codex respondeu o código de verificação da decisão; resultado gravado com `source_kind=codex` no mesmo projeto |
| 3 | Claude Code | `brain_recall` do resultado do Codex | Claude respondeu o código de verificação gravado pelo Codex |

Banco ao final (pasta temporária `nb-real-42gtKa`):
- `ADR f12362e4: data access through repositories` — decision, shop-api, claude, v1.
- `Repositories implemented f12362e4` — learning, shop-api, codex, v1.
- Link `wikilink/references` do resultado para a decisão, resolvido.
- `access_log`: `mcp:claude-code` (recall), `mcp:codex-mcp-client` (recall).

Duração total: 27 s para os três passos.

Achados:
- **Os dois clientes iniciam o servidor MCP com o `cwd` da sessão**, então a resolução de projeto por pasta (Fase 4) funciona sem `--project`.
- **Nomes reais do `clientInfo`**: `claude-code` e `codex-mcp-client` — o mapeamento de ator (contém "claude"/"codex") acerta os dois.
- **Codex com `-s read-only` consegue gravar via MCP**: o sandbox se aplica aos comandos do agente, não ao processo do servidor MCP.
- **Registro persistente** (`claude mcp add -s user`, `codex mcp add`) testado com os CLIs reais em pastas de configuração isoladas (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`): registrar, detectar, reparar caminho desatualizado e remover. Hash do `~/.claude.json` e do `~/.codex/config.toml` reais idêntico antes e depois. `claude mcp get` mostrou `Status: ✔ Connected` para o servidor.
- `codex mcp add` com `CODEX_HOME` em pasta temporária avisa que não cria aliases de PATH ali; inofensivo.
