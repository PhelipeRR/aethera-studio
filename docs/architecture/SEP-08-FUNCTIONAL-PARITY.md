# SEP-08 — Auditoria de Paridade Funcional e Integração Real

**Data:** 2026-11-13  
**Repositório:** `c:\dev\neuralbridge-studio` (branch `feat/aethera-studio`)  
**Regra de auditoria:** nenhuma funcionalidade é considerada migrada apenas por importação de serviço ou contrato. O monolito `apps/desktop` permanece operacional até que todas as telas ricas e fluxos legados pendentes sejam migrados ou tenham substituição aprovada.

---

## 1. Matriz de Paridade Funcional (`apps/desktop` → 3 Apps Independentes)

### 1.1 Singularity Orchestrator (`apps/orchestrator-desktop`)

| Funcionalidade | App Proprietário | Localização Original (`apps/desktop`) | Nova Localização | Dependências | Estado de Migração | Testes Existentes | Pendências |
|---|---|---|---|---|---|---|---|
| **Bootstrap, SQLite privado e Loopback API** | Orchestrator | `src/main/index.ts`, `database.ts` | `apps/orchestrator-desktop/src/main/{index,runtime}.ts` (`orchestrator-core.db`) | `@neuralbridge/database`, `@neuralbridge/integration-contracts` | **Migrado (UI + Backend)** | `orchestrator-app.test.ts` (2/2) | — |
| **Agentes & Fallback RF-07 (Claude/Codex/Antigravity)** | Orchestrator | `pages/AgentsPage.tsx`, `tasks.ts` | `apps/orchestrator-desktop/src/main/runtime.ts`, `App.tsx` (aba *Tarefas & Agentes*) | `@neuralbridge/agents`, `@neuralbridge/integration-contracts` | **Migrado (UI + Backend)** | `orchestrator-app.test.ts`, `sep08-multiprocess.test.ts` | Login/status detalhado por CLI na UI |
| **Dashboard & Execução de Tarefas** | Orchestrator | `pages/DashboardPage.tsx`, `features/tasks/*`, `handlers/tasks.ts` | `apps/orchestrator-desktop/src/renderer/src/App.tsx` (abas *Dashboard*, *Tarefas*) | `tasks` table, `ClaudeCliAdapter`, `CodexCliAdapter` | **Parcial (Backend + UI dedicada; chat rico no monolito)** | `orchestrator-app.test.ts` | Migrar `ChatPage.tsx`, `RunsPage.tsx` e `SessionPanel.tsx` completos |
| **Neural Brain / Memória / RAG (FTS5)** | Orchestrator | `features/brain/*`, `brain.ts`, `brain-admin.ts` | `apps/orchestrator-desktop/src/main/runtime.ts` (`BrainService`), `App.tsx` (aba *Brain / RAG*) | `@neuralbridge/brain`, `memories` / FTS5 | **Parcial (Backend completo + UI de criação/busca; grafo/editor no monolito)** | `packages/brain/test/*` | Migrar `GraphPage.tsx`, `Brain3DPage.tsx`, `GalaxyPage.tsx`, `MemoryEditor.tsx` |
| **Skills & Descoberta** | Orchestrator | `pages/SkillsPage.tsx`, `features/skills/*`, `handlers/skills-*.ts` | `apps/orchestrator-desktop/src/main/runtime.ts` (`scanSkills`), `App.tsx` (aba *Skills*) | `@neuralbridge/workspace` (`scanSkills`) | **Parcial (Listagem real + UI; SkillStudio no monolito)** | — | Migrar `SkillStudioPanel.tsx` e instalador transacional na UI |
| **Workflows & Missões Autônomas** | Orchestrator | `features/workflows/*`, `workflows.ts` | `apps/orchestrator-desktop/src/main/runtime.ts` (`autonomousMissions`), `App.tsx` (aba *Workflows*) | `@neuralbridge/database` | **Parcial (Persistência + UI; canvas visual no monolito)** | — | Migrar `WorkflowCanvas.tsx` (ReactFlow) |
| **Monitoramento de Sistema** | Orchestrator | `features/monitoring/*`, `handlers/monitoring.ts`, `monitoring/*` | `apps/orchestrator-desktop/src/main/runtime.ts` (`getTelemetry`), `App.tsx` (aba *Monitoramento*) | `node:os`, `process.memoryUsage()` | **Parcial (Telemetria real; gráficos históricos/GPU no monolito)** | — | Migrar probes GPU/rede de `monitoring/probe.ts` |
| **Servidor MCP & Ecossistema** | Orchestrator | `pages/McpPage.tsx`, `mcp.ts` | `apps/orchestrator-desktop/src/main/runtime.ts`, `App.tsx` (aba *Ecossistema & MCP*) | `@neuralbridge/mcp-server`, `@neuralbridge/integration-contracts` | **Parcial (Loopback + pareamento real; config de clientes MCP no monolito)** | `sep08-multiprocess.test.ts` | Expor UI de configuração MCP para Claude/Codex |
| **Projetos, Git Intelligence, Azure/TFS, Extensões, Analytics** | Orchestrator | `features/projects/*`, `GitIntelligencePage.tsx`, `AzureDevOpsPage.tsx`, `ExtensionsPage.tsx`, `AnalyticsPage.tsx` | `listProjects` em `runtime.ts` (demais apenas em `apps/desktop`) | `@neuralbridge/workspace`, `AzureDevOpsRepository` | **Pendente (Somente no Monolito)** | Testes unitários em `packages/*` | Extrair páginas dedicadas para `apps/orchestrator-desktop` |

---

### 1.2 Aethera Studio (`apps/aethera-desktop`)

| Funcionalidade | App Proprietário | Localização Original (`apps/desktop`) | Nova Localização | Dependências | Estado de Migração | Testes Existentes | Pendências |
|---|---|---|---|---|---|---|---|
| **Bootstrap, SQLite privado e Loopback API** | Aethera | `src/main/index.ts`, `database.ts` | `apps/aethera-desktop/src/main/{index,runtime}.ts` (`aethera-studio.db`) | `@neuralbridge/database`, `@neuralbridge/integration-contracts` | **Migrado (UI + Backend)** | `aethera-app.test.ts` (2/2) | — |
| **Produção Autônoma por Prompt (AETHERA-AUTO-01 + RF-07)** | Aethera | `features/video/{AetheraStart,AetheraFlow,AetheraProductionWorkspace}.tsx`, `index.ts` | `apps/aethera-desktop/src/main/runtime.ts` (`produceFromPrompt`), `App.tsx` (aba *Produção por Prompt*) | `@neuralbridge/orchestrator` (`interpretPromptToBrief`, `buildAutonomousPipelineDag`), `VelixProductionRepository` | **Migrado (Backend + UI dedicada; workspace visual completo no monolito)** | `aethera-app.test.ts`, `aethera-auto-orchestrator.test.ts` (6/6) | Migrar player/timeline interativos de `AetheraProductionWorkspace.tsx` |
| **Pipeline Audiovisual (Pesquisa, Mídia, Narração, Música, SFX, VFX, Remotion)** | Aethera | `features/video/Production*.tsx`, `motion/*`, `packages/workspace` | `runtime.ts` (`buildAutonomousPipelineDag`, `checkMediaTools`), motor em `packages/{orchestrator,workspace,shared}` | FFmpeg, FFprobe, yt-dlp, Remotion | **Parcial (DAG + verificação de ferramentas; preview/render UI no monolito)** | `aethera-auto-orchestrator.test.ts` | Migrar `AetheraTimelinePreview.tsx` e `MotionComposition.tsx` |
| **Revisão Cirúrgica por Prompt** | Aethera | `features/video/AetheraEditorMode.tsx`, `planAetheraProductionCommand` | `apps/aethera-desktop/src/main/runtime.ts` (`planRevisionCommand`), `App.tsx` (aba *Revisão por Prompt*) | `@neuralbridge/shared` | **Parcial (Planejador real + UI; timeline editor visual no monolito)** | `aethera-app.test.ts` | Integrar preview Remotion na aba de revisão |
| **Metadados (Título, Descrição, Tags, Capítulos, Thumbnails)** | Aethera | `features/video/{ChannelThumbnail,VelixChannel}.tsx`, `channel-files.ts` | `apps/aethera-desktop/src/main/runtime.ts` (`generateVideoMetadata`, `refineMetadata`), `App.tsx` | `@neuralbridge/orchestrator` (`channel-planner.ts`) | **Parcial (Geração + ajuste por prompt; upload/geração de imagem thumbnail no monolito)** | `aethera-channel-planner.test.ts` (3/3) | Migrar `ChannelThumbnail.tsx` e `gemini-collage-provider.ts` |
| **Canais & Calendário Editorial (AETHERA-CHANNEL-01)** | Aethera | `features/video/AetheraChannelCalendar.tsx`, `channel-publish.ts`, `oauth/channel-token.ts` | `apps/aethera-desktop/src/main/runtime.ts` (`planCalendar`, `listChannels`), `App.tsx` (aba *Canais & Calendário*) | `@neuralbridge/orchestrator`, `VelixChannelRepository` | **Parcial (Planejamento + detecção de conflitos; drag-and-drop e OAuth YouTube no monolito)** | `aethera-channel-planner.test.ts` | Migrar OAuth YouTube + `AetheraChannelCalendar.tsx` completo |
| **Content OS (`/aethera/*` legado)** | Aethera | `features/aethera/*`, `handlers/content-operating-system.ts` | Somente em `apps/desktop` | `ContentOperatingSystemRepository` | **Pendente (Somente no Monolito)** | — | Avaliar consolidação definitiva em `apps/aethera-desktop` |

---

### 1.3 Void (`apps/void-desktop`)

| Funcionalidade | App Proprietário | Localização Original (`apps/desktop`) | Nova Localização | Dependências | Estado de Migração | Testes Existentes | Pendências |
|---|---|---|---|---|---|---|---|
| **Bootstrap, SQLite privado e Degradação Offline** | Void | `src/main/index.ts`, `database.ts` | `apps/void-desktop/src/main/{index,runtime}.ts` (`void-assistant.db`) | `@neuralbridge/database`, `@neuralbridge/integration-contracts` | **Migrado (UI + Backend)** | `void-app.test.ts` (2/2) | — |
| **Assistente Pessoal & Fallback RF-07** | Void | `features/neura/{NeuraChat,NeuraPanel}.tsx`, `neura-runtime.ts`, `neura-ipc.ts` | `apps/void-desktop/src/main/runtime.ts` (`askAssistant`), `App.tsx` (aba *Assistente & Voz*) | `@neuralbridge/agents`, `@neuralbridge/integration-contracts` | **Parcial (Chat + RF-07; captura de voz/reunião no monolito)** | `void-app.test.ts` | Migrar `useVoiceCapture.ts`, `useMeetingCapture.ts`, `neura-speech.ts` |
| **Memória Pessoal & Notificações** | Void | `neura-history.ts`, `PersonalNotificationRepository` | `apps/void-desktop/src/main/runtime.ts` (`notifications`), `App.tsx` (aba *Memória & Lembretes*) | `PersonalNotificationRepository` | **Migrado (UI + Backend)** | `void-app.test.ts` (persistência entre restarts) | — |
| **Automações Pessoais** | Void | `pages/PersonalAgentPage.tsx`, `handlers/personal.ts` | `apps/void-desktop/src/main/runtime.ts` (`PersonalAutomationRepository`), `App.tsx` (aba *Automações*) | `PersonalAutomationRepository` | **Parcial (CRUD persistente; loop executor em background e aprovação de ações no monolito)** | — | Migrar `PersonalAutomationLoop` e fluxo de aprovação |
| **Gmail, Google Agenda, Spotify, Companion HUD** | Void | `personal/*`, `spotify/*`, `features/companion/*`, `companion-hud-window.ts` | Listagem de `personalAccounts` em `runtime.ts` (OAuth/HUD no monolito) | `GooglePersonalOAuth`, `GmailClient`, `SpotifyService` | **Pendente (Somente no Monolito)** | Testes da Fase 51 em `tests/` | Migrar PKCE OAuth isolado no Void + Companion HUD |

---

## 2. Evidência de Integração Real Multi-Processo (SEP-08 §3)

Implementada infraestrutura real de transporte e descoberta entre processos em `packages/integration-contracts/src/discovery.ts` e `loopback-server.ts` (suporte a **Windows Named Pipes** / Unix Domain Sockets + HTTP/SSE + `IntegrationAuthRegistry`) e validada por teste real de 3 processos OS independentes em `tests/integration/sep08-multiprocess.test.ts`:

- **Comando executado:** `npx vitest run --config vitest.integration.config.ts tests/integration/sep08-multiprocess.test.ts`
- **Resultado:** **1/1 passando** (3 processos Node/TSX independentes com PIDs distintos e bancos SQLite separados):
  1. **Descoberta:** os 3 processos (`orchestrator`, `aethera`, `void`) registram e descobrem uns aos outros via `discoverPeers(discoveryDir)`.
  2. **Autenticação e permissões:** chamadas sem token retornam `http_401`; chamadas com token `health:read` tentando delegar tarefa retornam `http_403:forbidden_scope`.
  3. **Envio, acompanhamento e eventos SSE:** `orchestrator` delega tarefa para `aethera`, acompanha via `GET /v1/tasks/:id` e recebe evento SSE `task.completed` em tempo real.
  4. **Fallback RF-07:** com `claude` indisponível no processo `aethera`, `codex` assume e conclui a tarefa (`executedByAgent: 'codex'`).
  5. **Revogação de acesso:** após `revokePairingToken`, o token passa a retornar `http_401:revoked`.
  6. **Tolerância offline e reconexão:** após `SIGKILL` no processo `aethera`, `void` e `orchestrator` continuam operacionais (`IntegrationClient.checkPeer()` retorna `connected: false`); após reinicialização do `aethera` com novo PID/pipe, a reconexão é restabelecida.

---

## 3. Instaladores e Empacotamento (SEP-08 §4)

- **Builds `electron-vite`:** `npm run build:all-apps` executa com **código 0** para os 4 apps (`desktop`, `orchestrator-desktop`, `aethera-desktop`, `void-desktop`).
- **Configuração `electron-builder`:** `devDependencies.electron` (`44.9.3`) adicionado aos 3 novos apps e identidades isoladas configuradas em `electron-builder.yml`:
  - Orchestrator: `com.singularity.orchestrator` → `dist/orchestrator/`
  - Aethera Studio: `com.singularity.aethera` → `dist/aethera/`
  - Void: `com.singularity.void` → `dist/void/`
  - Monolito preservado: `com.neuralbridge.desktop` → `dist/`
- **Procedimento reproduzível local (fora do sandbox sem rede para download de binários NSIS/WinCodeSign):**
  ```powershell
  npm run build:all-apps
  npm run dist:win:orchestrator
  npm run dist:win:aethera
  npm run dist:win:void
  ```

---

## 4. Organização, Limpeza e Preservação (SEP-08 §5)

- Nenhuma tabela, banco SQLite legado, credencial OAuth ou página do monolito `apps/desktop` foi excluída destrutivamente.
- Contratos compartilhados e transporte real foram consolidados em `packages/integration-contracts/src/{index,loopback-server,discovery}.ts`.
- Remoção de código legado de `apps/desktop` permanece bloqueada até a conclusão das pendências listadas na Seção 1.

---

## 5. Critérios de Aceite (SEP-08 §6)

- [x] Os três aplicativos iniciam isoladamente com bancos SQLite e `userData` próprios.
- [x] Os três aplicativos podem ser executados simultaneamente (comprovado em `sep08-multiprocess.test.ts`).
- [x] Integração real entre processos (descoberta, auth, escopos, tarefas, SSE, revogação, reconexão, offline e RF-07) comprovada sem mocks de transporte.
- [x] Sistema original (`apps/desktop`) permanece 100% funcional.
- [ ] **Critério aberto (bloqueio honesto para encerrar o monolito):** cada app separado já possui interface e funcionalidades reais iniciais, porém telas ricas específicas listadas como *Parcial* ou *Pendente* na Seção 1 (ex.: Remotion preview visual completo, calendário drag-and-drop + OAuth YouTube, Brain 3D/Galaxy, WorkflowCanvas, voz/meeting capture e OAuth Google/Spotify do Void) ainda residem em `apps/desktop`. Portanto, a separação arquitetural e integração real estão comprovadas, mas a descontinuação do monolito **não** deve ser declarada até a migração dessas telas ricas.
