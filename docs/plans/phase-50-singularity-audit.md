# Fase 50 — Singularity: auditoria 50.01 + CORE-01

**Status: AUDITORIA INICIAL CONCLUÍDA em 2026-11-08 — somente leitura, nada implementado.**
Briefing: `docs/plans/singularity-master-plan.md`. Referência visual: `docs/assets/singularity/reference-memory-galaxy.webp`.
Base auditada: branch `feat/neura-assistant`, versão `0.1.58`, com alterações locais não commitadas preservadas.

Legenda: **EXISTE** · **PARCIAL** · **AUSENTE** · **NÃO VERIFICADO** (precisa de execução ou de leitura mais funda).

## 1. Inventário do sistema atual

### 1.1 Estrutura

| Unidade | Papel | Depende de Electron? |
|---|---|---|
| `apps/desktop` (Electron 44, React 19, electron-vite, Tailwind) | Main, preload, renderer, HUD, empacotamento NSIS | sim |
| `packages/shared` | Tipos, schemas zod, 397 canais IPC (`ipc.ts`), paths | não |
| `packages/database` | SQLite (better-sqlite3 + drizzle), WAL, 94 migrações (última `0092`) | não |
| `packages/brain` | Memória, embeddings locais, busca híbrida, RAG, histórico, aprendizado | não |
| `packages/orchestrator` | TaskEngine (`engine.ts`), swarm, failover, missões, Neura, Velix, diagnósticos, analytics de tokens | não |
| `packages/agents` | Adaptadores Claude Code e Codex CLI (`process-runner.ts`) | não |
| `packages/workspace` | Git, projetos, descoberta, registro MCP nos clientes, skills, Velix | não |
| `packages/mcp-server` | Servidor MCP stdio standalone (`cli.ts`) | não (roda com `ELECTRON_RUN_AS_NODE=1`) |
| `packages/extensions-neura`, `extensions-velix` | Extensões | não |
| `packages/local-worker` | Worker Python da Neura | não |

Nenhum pacote em `packages/*` importa `electron`. O acoplamento está concentrado em `apps/desktop/src/main` (53 arquivos; 6 importam `electron` diretamente) e na raiz de composição `apps/desktop/src/main/index.ts` (1.856 linhas).

### 1.2 Recursos do briefing × estado atual

| Recurso | Estado | Evidência |
|---|---|---|
| Agentes Claude/Codex | EXISTE | `packages/agents/src/claude-adapter.ts`, `codex-adapter.ts` |
| TaskEngine, cancelamento, budget de tokens, recuperação | EXISTE | `packages/orchestrator/src/engine.ts`, `recovery-policy.ts`, `execution_snapshots` |
| Swarm / delegação entre agentes | EXISTE | `swarm.ts`, `application/swarm-service.ts` |
| Hierarquia/organograma de agentes, papéis | AUSENTE | sem tabela ou serviço de papéis |
| Orçamento de custo por agente/projeto (moeda) | PARCIAL | `token_analytics`, `token-intelligence.ts`; budget só por tarefa e Velix |
| Aprovações humanas | PARCIAL | Neura (`neura_action_audits`), Velix (`velix_production_approvals`), workflows; sem modelo único |
| Rotinas agendadas | PARCIAL | `git_automations`, missões autônomas; sem agendador genérico |
| MCP servidor + registro nos clientes | EXISTE | `packages/mcp-server`, `workspace/src/mcp-registration.ts` (`SERVER_NAME = 'neuralbridge'`) |
| RAG, busca híbrida, embeddings locais | EXISTE | `brain/src/rag-engine.ts`, `hybrid-search.ts`, `embeddings/*`, tabela `embeddings` |
| Memória persistente com versões, tags, links | EXISTE | tabelas `memories`, `memory_versions`, `memory_tags`, `links`, `memory_sources` |
| Cérebro 3D | EXISTE | `features/brain3d/*` (2.294 linhas, three.js, `InstancedMesh`, WebGL check, movimento reduzido) |
| Galáxia de Memórias | AUSENTE | substituirá o cérebro 3D |
| Grafo 2D de memórias | EXISTE | `features/brain/GraphPage.tsx` (serve de fallback 2D) |
| Monitoramento CPU/RAM/GPU/VRAM/disco/rede | AUSENTE | nenhum uso de `os.cpus`, `getAppMetrics`, `getGPUInfo` |
| Diagnósticos de saúde | EXISTE | `orchestrator/src/diagnostics-service.ts`, export de diagnósticos |
| Métricas de agentes/MCP/RAG/TaskEngine em série temporal | PARCIAL | eventos e analytics de tarefas existem; sem série temporal nem painel |
| Design system com tokens | PARCIAL | ~90 variáveis CSS em `styles.css` (tema escuro preto/laranja + claro); sem tokens de elevação, vidro, movimento |
| Tema persistido | EXISTE | `handlers/theme.ts` (`dark`/`light`/`system`) |
| Companion HUD | EXISTE | `features/companion/*`, `companion-hud-window.ts` |
| Companion remoto (Fase 42) | PARCIAL | lotes 42.1–42.2 parciais; nenhum servidor HTTP/WebSocket |
| Servidor HTTP local | AUSENTE | único `createServer` é o loopback OAuth (`main/oauth/loopback.ts`) |
| Credenciais protegidas | EXISTE | `safeStorage` (DPAPI) em `*.bin` no `userData` |
| Backup/restore do banco | EXISTE | `database/src/backup.ts`, `database-recovery.ts` |
| Extensões com instalação e rollback | EXISTE | tabela `extensions`, `ExtensionsPage` |
| App mobile | AUSENTE | — |
| Paperclip | AUSENTE | sem dependência; estudo é o lote 50.09 |

### 1.3 Dados que a Galáxia vai consumir

- `memories`: `id`, `title`, `content`, `type` (8 tipos: decision, code_pattern, project_context, bug_fix, learning, preference, documentation, execution_summary), `project_id` (null = global), `trust`, `confidence`, `source_kind` (user, claude, codex, mcp, extractor), datas, soft delete.
- `embeddings`: vetor Float32 por memória. Permite posicionar estrelas por similaridade.
- `links`: relações explícitas e wikilinks. São as únicas linhas "verificáveis" para desenhar.
- **Limite atual:** o grafo 3D carrega no máximo `GRAPH_LIMIT = 5000` memórias (`packages/shared/src/brain.ts:213`) e marca `truncated`. A Galáxia precisa de agregação por cluster e carregamento incremental acima disso.
- **Divergência com o mockup:** os grupos da imagem (Projetos, Desenvolvimento, Documentação, RAG, Agentes, MCP) não são uma coluna do banco. É preciso decidir o mapeamento (D-3).

## 2. Inventário para a renomeação

| Identificador | Valor atual | Onde | Risco se mudar |
|---|---|---|---|
| Nome do app → pasta de dados | `app.setName('NeuralBridge')` → `%APPDATA%\NeuralBridge` | `main/index.ts:87`, `shared/src/paths.ts` (`APP_DIR_NAME`) | **Crítico.** O banco (`db/brain.db`), as preferências, os backups, os modelos, as extensões e os `.bin` cifrados ficam nessa pasta. Mudar o nome cria uma pasta vazia. |
| Segredos `safeStorage` | `velix-channel-oauth.bin`, `gemini-api-key.bin`, `azure-devops-credentials.bin` | `main/index.ts:113-116` | **Crítico.** No Windows a chave do `safeStorage` fica no `Local State` dentro do `userData`. Mover a pasta sem esse arquivo torna os segredos ilegíveis. |
| AppUserModelId / appId | `com.neuralbridge.desktop` | `main/index.ts:89`, `electron-builder.yml` | Alto: atalhos, notificações, fixação na barra e o instalador NSIS identificam o app por ele. Mudar gera uma segunda instalação lado a lado. |
| Nome do servidor MCP | `neuralbridge` | `workspace/src/mcp-registration.ts:5` | Alto: as configs de Claude Code e Codex já registradas apontam para esse nome e para o caminho do executável. |
| Instalador | `productName: NeuralBridge`, `NeuralBridge-Setup-*` | `electron-builder.yml` | Médio: caminho de instalação e desinstalação. |
| Variáveis de ambiente | prefixo `NB_` (`NB_DATA_DIR`, `NB_FFMPEG` e outras) | vários | Baixo: o prefixo é neutro e pode ficar. |
| Pacotes internos | `@neuralbridge/*` | 10 pacotes, ~400 arquivos | Baixo valor, alto custo. **Não renomear.** |
| Canais IPC | 397 canais sem prefixo de marca | `shared/src/ipc.ts` | Nenhum. |
| URL interna | `https://local.neuralbridge/asset/...` | `main/index.ts:428,457` e dados Velix persistidos | Médio: já está gravada no banco. Manter como alias. |
| Textos e marca visível | "NeuralBridge", mascote `NeuralBridgeMascot` | renderer, docs, testes E2E | Baixo: é o primeiro passo seguro. |

Contagem: 1.645 ocorrências de "neuralbridge" em 408 arquivos fora de `docs/`. A maioria são imports `@neuralbridge/*`, que ficam como estão.

**Recomendação:** trocar só a marca visível no lote 50.04. Manter `userData`, `appId`, o nome MCP e os pacotes como estão até uma migração própria (D-1).

## 3. CORE-01 — separação Electron ↔ Core

### 3.1 Classificação

| Classe | Conteúdo |
|---|---|
| **Core independente (já é)** | `shared`, `database`, `brain`, `orchestrator`, `agents`, `workspace`, `mcp-server` |
| **Adaptador desktop** | `main/ipc/handle.ts` e os registros de handlers, `preload/index.ts` (488 linhas), `main/index.ts` (raiz de composição) |
| **Serviço local dependente do Windows/Electron** | `safeStorage`, janelas (`window.ts`, HUD, captura Velix), tray, `desktop-startup.ts`, fala do Windows, áudio do sistema, `screen-observer.ts`, launcher do VoiceStudio |
| **UI** | `apps/desktop/src/renderer/**` |
| **Compartilhável com mobile** | schemas zod e tipos de `shared` (precisam de versão pública separada dos canais IPC) |

### 3.2 Achados

1. **A lógica já está fora do Electron.** O trabalho do Core é extrair a raiz de composição (`main/index.ts`) para um processo Node e trocar a fonte de segredos. Não é preciso reescrever domínio.
2. **Já existem dois processos no mesmo banco.** O servidor MCP stdio (`mcp-server/src/cli.ts`) abre o mesmo `brain.db` que o desktop, com WAL e `busy_timeout = 5000`. O precedente é útil, mas só com leitura e escrita de memória. Com um Core separado, **só um processo pode executar tarefas** (D-6).
3. **Os segredos dependem do Electron.** `safeStorage` não existe em Node puro. O Core precisa de outro mecanismo, como DPAPI via módulo nativo ou o Windows Credential Manager. Essa decisão bloqueia o CORE-03 (D-7).
4. **Os agentes rodam como subprocesso** (`agents/src/process-runner.ts`), com o diretório de trabalho e as permissões vindos do projeto. Isso funciona igual fora do Electron, mas o Core precisa rodar na sessão do usuário: um serviço Windows em Session 0 não enxerga a autenticação das CLIs.
5. **Não há API de rede.** O caminho do mobile exige criar do zero HTTP + WebSocket/SSE, autenticação e pareamento. O loopback OAuth é o único servidor hoje.
6. **Contrato:** os 397 canais IPC com schema zod são a melhor base para a API v1. Dá para gerar rotas a partir deles, mas o mobile precisa só de um subconjunto pequeno.

### 3.3 Diagrama atual

```text
Electron main (index.ts = composição)
  ├─ IPC handlers ──► packages: orchestrator / brain / workspace / agents / database
  ├─ safeStorage, janelas, tray, HUD, fala, captura
  └─ subprocessos: claude, codex, worker Python, render Velix
Claude Code / Codex ──stdio──► mcp-server (Node) ──► mesmo brain.db (WAL)
```

### 3.4 Alvo candidato (para o ADR do CORE-01)

```text
Singularity Core (Node, sessão do usuário, supervisionado)
  ├─ composição hoje em main/index.ts, sem electron
  ├─ API /api/v1 + eventos (só loopback por padrão)
  ├─ dono único do TaskEngine e da escrita no banco
  └─ secret store nativo do Windows
Desktop Electron = cliente (IPC → adaptador → Core) + recursos de SO (janelas, HUD, fala, captura)
Mobile = cliente da API via VPN/HTTPS pareado
mcp-server = cliente do Core ou leitor direto do banco (a decidir)
```

Alternativas para o ADR: (a) **Core embutido**: o Electron sobe o Core como processo filho, e é o caminho de menor risco; (b) Core como processo independente iniciado no login; (c) serviço Windows, desaconselhado pelo achado 4.

## 4. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | Renomear o `userData` perde banco e segredos | Crítico | Não mudar no 50.04; migração própria com cópia, verificação e rollback |
| R2 | Dois processos executando a mesma tarefa | Crítico | Dono único do TaskEngine; lease no banco antes do Core |
| R3 | Galáxia acima de 5k memórias trava a GPU | Alto | Clusters, LOD, carregamento incremental, fallback 2D, medir FPS |
| R4 | Números fictícios no painel | Alto | Só métricas coletadas; "indisponível" quando o sensor faltar |
| R5 | GPU/VRAM/temperatura indisponíveis no Windows sem driver ou privilégio | Médio | `app.getGPUInfo` + contadores de desempenho; temperatura opcional |
| R6 | Segredos do Core sem `safeStorage` | Alto | ADR de secret store antes do CORE-03 |
| R7 | API remota exposta | Crítico | Loopback por padrão; remoto só via VPN/HTTPS com pareamento (briefing §11.6) |
| R8 | Paperclip duplica o TaskEngine | Alto | Decisão 50.09 depois do CORE-01; fusão bloqueada sem ADR |
| R9 | Redesign quebra fluxos e E2E (64 arquivos E2E citam a marca) | Médio | Tokens primeiro, telas uma a uma, E2E por papel e rótulo |

## 5. Decisões

**Aprovadas pelo usuário em 2026-11-08.** A aprovação cobre só as decisões e o detalhamento do plano; a
implementação não está autorizada.

| # | Decisão aprovada |
|---|---|
| D-1 | Renomear agora só a marca visível. `userData`, `appId`, nome MCP e pacotes ficam para uma migração própria e futura. |
| D-2 | Escuro Singularity como padrão; claro e "sistema" continuam disponíveis. |
| D-3 | Os grupos da Galáxia são tipo de memória e projeto (dado real); clusters semânticos vêm depois. |
| D-4 | A posição das estrelas vem da similaridade dos embeddings, calculada fora da thread de UI. |
| D-5 | A linha do tempo entra no MVP, só com eventos reais do dia. |
| D-6 | **Ajustado:** o Core começa como processo filho do Electron, mas é projetado desde o início para rodar como serviço Node independente. Assim o Companion Mobile continua funcionando com a janela fechada, enquanto o Core estiver ativo. |
| D-7 | **Ajustado:** o mecanismo atual (`safeStorage`) é mantido no início. Depois vem uma migração segura e reversível para um armazenamento acessível pelo Core, sem perder credenciais nem enfraquecer a criptografia. |
| D-8 | **Ajustado:** Tailscale é a primeira solução de acesso remoto, com a arquitetura aberta a outros meios seguros. O escopo inclui autenticação, pareamento, revogação de dispositivos e notificações. |
| D-9 | A trilha visual vem primeiro; a trilha CORE começa por contratos e ADR, em paralelo. |

Requisito adicional do usuário: a arquitetura deve considerar a futura integração com o Paperclip, sem execução
duplicada de tarefas nem conflito entre orquestradores (ADR CORE-01, §6).

Documentos derivados: `docs/plans/phase-50-singularity-lots.md` (lotes 50.02, 50.03, 50.06) e
`docs/architecture/adr-core-01-singularity-core.md`.

### Texto original das decisões, antes da aprovação

- **D-1 Renomeação técnica:** só a marca visível agora (recomendado), ou migrar também `userData`/`appId`/nome MCP numa versão futura?
- **D-2 Tema claro:** o Singularity é só escuro (o mockup é escuro), ou mantém claro e "sistema"?
- **D-3 Grupos da Galáxia:** os nós em órbita são projetos (`project_id`), tipos de memória (`type`), origem (`source_kind`) ou clusters semânticos dos embeddings?
- **D-4 Posição das estrelas:** similaridade de embedding (recomendado, com UMAP/PCA num worker), projeto ou tempo?
- **D-5 Linha do tempo do rodapé:** eventos reais do dia (tarefas, indexação, MCP) ou fica de fora do MVP?
- **D-6 Execução:** o Core embutido (filho do Electron) é o primeiro alvo?
- **D-7 Segredos no Core:** DPAPI por módulo nativo ou Windows Credential Manager?
- **D-8 Mobile:** host no próprio PC via VPN (ex.: Tailscale), mini PC dedicado ou nuvem?
- **D-9 Prioridade:** a trilha visual (50.02–50.08) vem antes da trilha CORE, ou correm em paralelo?

## 6. Próximo passo (cumprido em 2026-11-08: lotes e ADR detalhados, aguardando autorização)

Depois das respostas D-1 a D-9:

1. Detalhar os lotes 50.02, 50.03 e 50.06 no padrão do projeto (objetivo, escopo, arquivos, riscos, aceite, testes, migração, rollback).
2. Escrever o ADR do CORE-01 com a alternativa escolhida.
3. Só então pedir aprovação para implementar o primeiro lote.

Comandos usados nesta auditoria: somente leitura (`ls`, `grep`, `git grep`, `wc`, `sed -n`). Nenhum teste foi executado, porque nada foi alterado em código.
