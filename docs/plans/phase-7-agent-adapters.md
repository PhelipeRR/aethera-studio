# Fase 7 — Adaptadores Claude Code e Codex (sub-plano)

Execução real e detecção dos dois CLIs, com eventos normalizados para o orquestrador (Fase 11) e o chat (Fase 12).

## Pacote `packages/agents`

- `process-runner.ts` — `runProcess(options): ProcessRun`. Sem shell, argumentos em array, `stdin` com o prompt, linhas de stdout/stderr como `AsyncIterable`, timeout, `AbortSignal`, kill da árvore no Windows (`taskkill /PID <pid> /T /F`), log completo opcional em arquivo, memória limitada (fila com pausa do stdout acima de 1.000 linhas; linhas acima de 1 MB truncadas; só os últimos 64 KB de stderr guardados).
- `redact.ts` — `redactSecrets(text)`: chaves Anthropic/OpenAI, tokens GitHub, AWS, JWT, `Authorization: Bearer`, `api_key=`/`password=`/`token=`. Aplicado ao log em arquivo e às mensagens de erro.
- `events.ts` — `AgentEvent` (union discriminada): `session`, `text`, `tool`, `file_change`, `permission_denied`, `usage`, `error`, `raw`, `done`.
- `claude-parser.ts`, `codex-parser.ts` — funções puras linha JSON → eventos. Tipos desconhecidos viram `raw`; ruído conhecido (hooks, thinking, rate limit, reasoning) é ignorado.
- `claude-adapter.ts`, `codex-adapter.ts` — `detect(): Promise<AgentStatus>` e `run(request, signal): AgentRun`.

## Decisões

- **Prompt sempre pelo stdin** (`claude -p` sem argumento; `codex exec -`): sem limite de ~32 KB da linha de comando do Windows e sem problemas de aspas. Verificado nas versões instaladas.
- **Modos** (`AgentRunRequest.mode`):
  - `read-only` — Claude `--permission-mode default` com ferramentas de leitura liberadas; Codex `-s read-only`.
  - `edit` — Claude `--permission-mode acceptEdits` com leitura + edição; Codex `-s workspace-write`.
  - `allowedTools` do pedido substitui o padrão do Claude (o orquestrador decide, p.ex., liberar `Bash` para testes).
  - Nunca `--dangerously-*` nem `bypassPermissions`.
- **MCP do NeuralBridge por invocação** quando `request.mcp` vem preenchido: Claude `--mcp-config <arquivo temporário> --strict-mcp-config` + ferramentas `mcp__neuralbridge__*` liberadas; Codex `-c mcp_servers.neuralbridge.*` com `default_tools_approval_mode="approve"` e `enabled_tools`. Nenhuma configuração do usuário é alterada.
- **Sandbox do Codex (R14)**: se o `config.toml` do usuário tiver `[windows] sandbox = "elevated"`, runs `edit` recebem `-c windows.sandbox="unelevated"` e o status mostra o aviso de isolamento menor.
- **Retomada**: `request.resumeSessionId` → Claude `--resume <id>`; Codex `exec resume <id> -`.
- **Detecção**: caminho (`findClientCli` da Fase 5), `--version`, login (`claude auth status` → `loggedIn`/`authMethod`; `codex login status` → "Logged in"/"Not logged in"), recursos pelo `--help`. **E-mail e organização do `auth status` não são lidos nem guardados.** Versões abaixo das testadas (Claude 2.1.312, Codex 0.162.1) geram aviso, não bloqueio. Resultado em cache por 60 s.
- **Uso de tokens**: Claude `result.usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`) e `total_cost_usd` como **custo equivalente de API (estimado)**; Codex `turn.completed.usage`. Nada é inventado: campo ausente → `null`.
- **Fixtures**: `scripts/record-cli-fixtures.mjs` grava saídas reais em `packages/agents/test/fixtures/`, redigidas (pasta do usuário, nome de usuário, listas de skills/plugins/slash commands, caminhos de memória).

## UI

- `agents:status` (IPC, com `refresh`) → `AgentStatus[]`.
- **Dashboard** passa a mostrar o estado real dos dois agentes; tarefas e tokens continuam como "ainda não disponível" (Fases 11 e 14).
- **Agentes**: caminho, versão, login, recursos, avisos e "Verificar novamente".

## Testes

- Runner (CLI falso em Node, numa pasta com espaço e acento): linhas e código de saída; prompt pelo stdin; timeout e cancelamento matam a árvore (PIDs do filho e do neto conferidos); executável inexistente → erro claro, sem exceção não tratada; 50 MB de saída com fila limitada e log completo em arquivo; linha gigante truncada; segredo redigido no log.
- Parsers: fixtures reais de cada CLI (texto, edição, uso, sessão); linha não-JSON e tipo desconhecido → `raw`; erro do Codex → `error`.
- Detecção (CLIs falsos): não instalado; deslogado; versão antiga → aviso; sandbox elevado → aviso; e-mail nunca aparece no status.
- Argumentos: cada modo, MCP, retomada e sandbox geram exatamente os argumentos documentados.
- Reais (`NB_REAL_CLI=1`): por agente, tarefa `edit` cria arquivo num repositório temporário; `read-only` não consegue escrever; cancelamento no meio encerra todos os processos.

## Aceite

Dashboard e Agentes mostram o estado real dos CLIs; tarefa real executada com Claude e com Codex; testes acima verdes.
