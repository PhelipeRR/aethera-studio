# Singularity (antigo NeuralBridge)

> Orquestrador multiagente local e memória compartilhada para **Claude Code** e **Codex CLI**, empacotado como app desktop para Windows.

Você descreve o que quer em linguagem natural ("analise meu projeto .NET, corrija os problemas de performance e rode os testes"). O NeuralBridge:

1. interpreta o pedido;
2. identifica o projeto e o contexto dele;
3. recupera memórias e trechos de código relevantes (RAG);
4. classifica a complexidade e escolhe Claude, Codex ou os dois;
5. divide o trabalho, controla o orçamento de tokens e roda os CLIs instalados;
6. acompanha logs, diffs e testes;
7. grava as decisões e os aprendizados na memória;
8. devolve um resultado consolidado.

Os dados ficam na sua máquina, em SQLite, e os agentes rodam pelos CLIs oficiais já autenticados por você. O app não usa respostas simuladas.

---

## Sumário

- [Funcionalidades](#funcionalidades)
- [Arquitetura](#arquitetura)
- [Stack tecnológica](#stack-tecnológica)
- [Requisitos](#requisitos)
- [Como rodar](#como-rodar)
- [Servidor MCP](#servidor-mcp)
- [Testes e qualidade](#testes-e-qualidade)
- [Distribuição Windows](#distribuição-windows)
- [Segurança e privacidade](#segurança-e-privacidade)
- [Documentação](#documentação)

---

## Funcionalidades

### Orquestração de agentes
- **Roteador determinístico e configurável** (`packages/orchestrator/src/router.ts`). Escolhe o agente pelo tipo de tarefa, complexidade, tamanho do contexto, disponibilidade, histórico de sucesso e custo. Não gasta tokens para decidir quem chamar.
- **Modos:** automático, Claude, Codex e colaborativo. No colaborativo, Claude planeja e define os critérios de aceite, Codex implementa a parte delimitada e Claude revisa. Há limite de iterações, timeout e orçamento.
- **TaskEngine:** estados persistidos (`pending → planning → running → awaiting_approval → validating → completed/failed/cancelled`, além de `paused`), etapas, eventos, tokens, arquivos alterados e diff. Pausa, retomada e cancelamento sobrevivem a um reinício do app.
- **Agent Swarm:** especialistas escolhidos de forma determinística, handoffs com dependências explícitas, execução em camadas e auditoria de conflito por arquivo (dois agentes nunca editam o mesmo arquivo ao mesmo tempo).
- **Failover e recuperação:** retry com backoff, fallback de agente, checkpoints e prevenção de execução duplicada.
- **Auto-Healing seguro** e **Security Guardian**, que classificam o risco das ações e pedem aprovação humana quando precisa.
- **Permissões por projeto:** somente leitura, edição ou acesso total. Uma etapa `read-only` nunca edita, mesmo em projeto com acesso total.

### Neural Brain (memória compartilhada)
- Memórias com escopo (global ou projeto), tipos, tags, versões, histórico, restauração e wikilinks `[[Título]]`.
- **Busca híbrida:** FTS5 do SQLite + embeddings locais (Transformers.js), sem enviar texto para nenhuma API.
- **Neural RAG Engine:** indexação incremental por hash, chunking determinístico (Markdown, C#, TypeScript), exclusão de arquivos sensíveis, contexto limitado e deduplicado, com referências.
- **Memory Confidence** e **aprendizado controlado:** aprendizados registrados com confiança, backup e retenção.
- **Visualização:** grafo 2D (Cytoscape, com caminho mais curto e nós pendentes) e cérebro 3D de partículas (Three.js / React Three Fiber) que acende os nós conforme Claude e Codex consultam memórias reais.
- Importação e sincronização do histórico dos clientes de IA.

### Chat e execuções
- Chat no estilo Codex: histórico recolhível, Markdown e blocos de código, imagens coladas como referência, arquivos modificados, progresso em tempo real e cancelamento.
- Funciona **sem projeto** (conversa geral, somente leitura) ou com um ou mais projetos como contexto.
- **Execuções** e **Mission Control:** lista de tarefas com filtros por status, agente e projeto, detalhes, pausa, retomada e cancelamento.

### Projetos e workspaces
- Detecção de stack: .NET / ASP.NET Core / EF Core / SQL Server, PostgreSQL (Npgsql), Next.js, Nuxt/Vue, Prisma, Drizzle, Remotion e outros.
- **Hierarquia de workspaces** com descoberta somente leitura. Nada é cadastrado sem confirmação, e remover um projeto nunca apaga arquivos.
- **Project Intelligence:** perfil do projeto exposto aos agentes via MCP (`project_profile`).
- Criação de projeto, `git init` e `git clone` apenas por ação explícita.

### Git Intelligence 2.0
- Histórico com grafo de commits, referências, working tree e diffs.
- Operações Git autorizadas, com confirmação contextual. `reset --hard`, `clean`, force-push e rebase destrutivo ficam de fora.
- **AI Code Review e Bug Detective**, **Smart Commit & PR Assistant**.
- **Automações por gatilho** (commit, branch), integradas ao TaskEngine. Automações nunca fazem commit, push, checkout ou merge.

### Workflows
- **Workflow Builder visual** (React Flow + dagre): DAG validado, definições e execuções versionadas no SQLite, cada etapa é uma tarefa do TaskEngine.
- **Biblioteca de templates** com busca, favoritos, importação e exportação.

### Token Intelligence e Analytics
- Token Optimizer: orçamento de contexto, deduplicação e referências no lugar de conteúdo repetido.
- Estimativas e métricas reais ficam separadas. Custos só aparecem quando o provedor informa o valor.
- Painel de Analytics com consumo por agente, projeto e tarefa.

### Skills e MCPs
- **Skills Manager / Skill Studio:** instalação, atualização e rollback de skills por HTTPS ou Git, com aprovação explícita.
- **Página MCP:** status do servidor e registro oficial em Claude Code e Codex, com backup da configuração anterior.

### Neura — assistente pessoal
Assistente por voz e texto, **desligado por padrão**, com consentimento separado para microfone, tela e localização.
- Voz PT-BR / EN pelo **VoiceStudio local** (Whisper para transcrição e TTS por `localhost`). O áudio não é guardado.
- Comandos locais determinísticos: hora, data, clima (Open-Meteo, com cache), abrir apps (Spotify, Teams, Configurações, Bloco de Notas, Calculadora) e descrição da tela.
- **Spotify:** reprodução de faixa, álbum, artista e playlist, controle de player e transferência de dispositivo.
- "Responder este chat": captura a janela ativa, prepara uma prévia e só cola depois da sua confirmação. Recusa campos de senha.
- Assistente de reuniões com um worker Python local de pré-processamento (`packages/local-worker`).
- **Companion HUD:** janela flutuante com mascote animado, voz, sugestões e aprovações.

### Aethera — AI Cinematic Studio (antes Velix)
- Novo nome do Velix: projetos, produções e configurações criados no Velix abrem normalmente, sem migração.
- Descoberta de temas e pesquisa (YouTube), roteiro, narração (ElevenLabs ou VoiceStudio), captura e cortes.
- **Video Studio / Motion Engine** com Remotion: composição, timeline com áudio e legendas, render com jobs e cancelamento, preview MP4.
- Comando `/video` no Chat envia o pedido ao Studio.

### Interface
- Tema escuro padrão e tema claro, tokens semânticos, foco visível, navegação por teclado e `prefers-reduced-motion`.
- **Guided Tours** por rota.
- Páginas: Dashboard, Chat, Execuções, Memória, Skills, Projetos, Git Intelligence, Agentes, MCPs, Analytics, Workflows, Mission Control, Aethera e Configurações.

---

## Arquitetura

Monorepo com npm workspaces:

```
apps/
  desktop/            App Electron (main, preload, renderer React)
packages/
  shared/             Contratos Zod e tipos compartilhados
  database/           SQLite + Drizzle ORM, migrações versionadas
  brain/              Neural Brain: memórias, busca híbrida, RAG, embeddings
  mcp-server/         Servidor MCP standalone (SDK oficial)
  agents/             Adaptadores Claude Code e Codex CLI (process runner, parsers, redação de segredos)
  orchestrator/       Roteador, TaskEngine, swarm, workflows, Git automation, Neura, Velix
  workspace/          Projetos, stack, Git (leitura/escrita separadas), skills, registro MCP
  local-worker/       Worker Python local para pré-processamento de reuniões
docs/                 Spec, plano, status, distribuição e sub-planos por fase
tests/                E2E (Playwright), integração, benchmarks, fixtures
scripts/              Ícone, bundle de motion, verificação da distribuição
```

```
 Renderer (React)  ──IPC validado com Zod──►  Main (Electron)
                                                │
              ┌─────────────────────────────────┼──────────────────────┐
              ▼                                 ▼                      ▼
        Orchestrator / TaskEngine         Neural Brain + RAG       Workspace / Git
              │                                 │
              ▼                                 ▼
   Claude Code CLI · Codex CLI             SQLite (Drizzle) ◄── MCP Server ◄── Claude / Codex
```

- O renderer **nunca executa shell**. O processo principal valida remetente e schema de cada chamada IPC.
- Os processos rodam com `shell: false`, argumentos em array, timeout e cancelamento.
- O estado de execução fica no banco, não em memória.
- Claude Code e Codex leem e gravam a **mesma memória** pelo servidor MCP.

---

## Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Desktop | Electron 44, electron-vite 6, electron-builder (NSIS) |
| UI | React 19, TypeScript 6 (strict), Vite 8, Tailwind CSS 4, Radix UI / shadcn, Lucide, Motion |
| Estado e dados na UI | Zustand 5, TanStack Query 5, React Router 8 |
| Persistência | SQLite (better-sqlite3), Drizzle ORM, FTS5 |
| Validação | Zod 4 |
| IA local | Transformers.js (`@huggingface/transformers`) para embeddings |
| Agentes | Claude Code CLI, Codex CLI |
| Protocolo | Model Context Protocol (`@modelcontextprotocol/sdk`) |
| Visualização | Cytoscape (fcose), Three.js + React Three Fiber, React Flow + dagre |
| Vídeo | Remotion 4 (player, renderer, bundler), FFmpeg |
| Voz | VoiceStudio local (Whisper + TTS), Windows Speech como alternativa, ElevenLabs no Aethera |
| Integrações | Spotify Web API, Open-Meteo, YouTube |
| Worker local | Python ≥ 3.11 (hatchling) |
| Testes | Vitest 5, Playwright 1.64 (Electron), testes de integração com CLIs reais |
| Qualidade | ESLint 10, typescript-eslint, react-hooks |

---

## Requisitos

- Windows 10/11 x64
- Node.js **22 ou superior**
- [Claude Code](https://docs.anthropic.com/claude-code) e/ou [Codex CLI](https://github.com/openai/codex) instalados e autenticados
- Opcional: VoiceStudio local (voz da Neura), Python 3.11+ (worker de reuniões), FFmpeg (Aethera), conta Spotify

---

## Como rodar

```bash
npm install
```

```bash
npm run dev
```

Scripts principais:

| Comando | O que faz |
|---|---|
| `npm run dev` | App desktop em modo desenvolvimento |
| `npm run build` | Build de produção do app |
| `npm run typecheck` | Typecheck de todos os pacotes e testes |
| `npm run lint` | ESLint |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:integration` | Build + integração (MCP em processo real, CLIs) |
| `npm run test:e2e` | Build + E2E Playwright no Electron |
| `npm run dist:win` | Gera o instalador NSIS em `dist/` |
| `npm run verify:dist` | Verifica o pacote gerado |

---

## Servidor MCP

O bundle inclui o `mcp-server.js`, que roda sem o app aberto. Para registrar em Claude Code e Codex, use a página **MCPs**: ela mostra os comandos oficiais e faz backup da configuração antes de alterar.

Ferramentas expostas:

| Ferramenta | Função |
|---|---|
| `brain_store` | Grava uma memória |
| `brain_recall` | Recupera uma memória |
| `brain_search` | Busca híbrida (FTS + semântica) |
| `brain_rag_search` | Busca trechos de código e documentos indexados |
| `brain_list` | Lista memórias |
| `brain_links` | Relações entre memórias |
| `brain_delete` | Remove uma memória (sem exclusão definitiva via MCP) |
| `project_profile` | Perfil e stack do projeto |
| `task_status` | Estado de uma tarefa |
| `orchestrator_status` | Estado do orquestrador e dos agentes |

Toda saída com dados vem marcada como **dado não confiável**, para que o agente não trate o conteúdo como instrução.

---

## Testes e qualidade

- **Unitários:** cerca de 1.476 testes em 168 arquivos (Vitest).
- **Integração:** servidor MCP em processo real e tarefas reais com Claude e Codex (`NB_REAL_CLI=1`).
- **E2E:** Playwright no Electron, cobrindo Chat, Memória, Grafo, Projetos, Git, Workflows, Mission Control, Neura, além de Visual QA em três resoluções.
- **Benchmarks:** RAG (`tests/benchmarks/rag-benchmark.test.ts`).

Se testes que usam `git` falharem em paralelo, confirme com:

```bash
npx vitest run --no-file-parallelism
```

---

## Distribuição Windows

```bash
npm run dist:win
```

Gera `dist/NeuralBridge-Setup-<versão>-x64.exe`, um instalador assistido que deixa escolher a pasta. Os dados ficam em `%APPDATA%\NeuralBridge` e **não são apagados** ao desinstalar. O build local não tem assinatura de código. Veja [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

### Postura de release 0.1.58

O estado atual é **Core stable** e **Power tools stable** para validação local;
Neura, Aethera (antes Velix) e integrações são **experimentais**. A distribuição empresarial
está bloqueada até haver Authenticode, atualização automática, registry de
extensões HTTPS assinado, upgrade sobre uma versão anterior e homologação com
credenciais reais em ambiente isolado. Consulte a [decisão de release](docs/release/0.1.58-release-decision.md) e a [matriz de homologação](docs/release/homologation-matrix.md).

---

## Segurança e privacidade

- Isolamento do Electron (`contextIsolation`, sandbox), CSP restritiva e bloqueio de navegação externa.
- IPC com remetente confiável e schemas Zod na entrada e na saída.
- Segredos são removidos dos logs dos agentes (`packages/agents/src/redact.ts`). Arquivos sensíveis ficam fora do RAG.
- Commits, diffs, saídas de etapa e templates importados são tratados como dados não confiáveis.
- Neura: cada sensor tem consentimento próprio, o áudio não é guardado e ações no computador ficam auditadas. Detalhes em [docs/neura-privacy.md](docs/neura-privacy.md).

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/SPEC.MD](docs/SPEC.MD) | Especificação do produto |
| [docs/PLAN.md](docs/PLAN.md) | Plano por fases, status e evidências |
| [docs/STATUS.md](docs/STATUS.md) | Status de qualidade, segurança e pendências |
| [docs/plans/](docs/plans/) | Sub-planos de cada fase |
| [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) | Geração e instalação do instalador |
| [docs/neura-voice.md](docs/neura-voice.md) | Voz da Neura e VoiceStudio |
| [docs/neura-privacy.md](docs/neura-privacy.md) | Privacidade e dados da Neura |
| [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md) | Licenças de terceiros (o Remotion exige Company License para empresas com mais de 3 funcionários) |
| [AGENTS.md](AGENTS.md) | Regras para agentes que trabalham neste repositório |
