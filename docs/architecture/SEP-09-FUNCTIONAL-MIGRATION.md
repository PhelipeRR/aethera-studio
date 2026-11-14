# SEP-09 — Migração de Paridade Visual e Funcional

**Data:** 2026-11-13  
**Branch:** `feat/aethera-studio`  
**Status:** Concluída (paridade visual e funcional via reutilização direta de UI + handlers IPC reais por domínio, com monolito `apps/desktop` preservado)

---

## 1. Arquitetura Adotada na SEP-09

Em vez de criar interfaces simplificadas ou duplicar componentes visuais, os três aplicativos independentes passaram a reutilizar diretamente o design system e as páginas reais de `apps/desktop/src/renderer/src` (via alias `@` em `tsconfig.web.json` e `electron.vite.config.ts`) e a API tipada completa do preload (`apps/desktop/src/preload/index.ts`), conectadas aos handlers IPC reais do domínio em processos Electron independentes:

- **Shell compartilhado parametrizado:** [`AppShell.tsx`](file:///c:/dev/neuralbridge-studio/apps/desktop/src/renderer/src/app/AppShell.tsx) aceita `{ routes?, brandName?, brandSubtitle? }` mantendo 100% da experiência do monolito por padrão.
- **Isolamento estrito de dados (`userData`):**
  - `Singularity Orchestrator` -> `%APPDATA%/SingularityOrchestrator` (`neuralbridge.db` / `singularity-orchestrator.db`, `azure-devops-credentials.bin`)
  - `Aethera Studio` -> `%APPDATA%/AetheraStudio` (`neuralbridge.db` / `aethera-studio.db`, `velix-channel-oauth.bin`, `gemini-api-key.bin`, `aethera-igdb-credentials.bin`, `aethera-rawg-key.bin`)
  - `Void` -> `%APPDATA%/Void` (`neuralbridge.db` / `void-assistant.db`, `personal-google-oauth.bin`, `personal-integration-tokens.bin`, `spotify-tokens.bin`)
- **Integração opcional e fallback multiagente:** Cada app funciona de forma autônoma mesmo sem os outros dois instalados e preserva o fallback entre Claude Code e Codex CLI (`TaskEngine` / `ProductionRunService` / `runtime.ts`).

---

## 2. Matriz de Paridade por Aplicativo

### 2.1 Singularity Orchestrator (`apps/orchestrator-desktop`)

| Funcionalidade | UI Migrada (`src/renderer/src/main.tsx`) | Backend / IPC Real (`src/main/orchestrator-ipc.ts`) | Estado |
| :--- | :--- | :--- | :--- |
| Dashboard, Chat, Runs & Mission Control | `DashboardPage`, `ChatPage`, `RunsPage`, `RunPage`, `MissionControlPage` | `composeTaskEngine`, `createHybridTaskService`, `createCoreSupervisor`, `registerTasksIpcHandlers`, `createAutonomousMissionMode` | Migrado |
| Brain 3D, Galaxy & Memória / RAG | `BrainLayout`, `OverviewPage`, `ExplorerPage`, `GraphPage`, `Brain3DPage`, `GalaxyPage`, `LearningPage`, `BrainSettingsPage` | `createBrainService`, `createBrainAdmin`, `createSemanticService`, `brainGraph3d`, `brainGalaxy`, `historySync` | Migrado |
| Workflow Canvas & Git Automations | `WorkflowsPage` (`WorkflowCanvas` ReactFlow) | `createWorkflowService`, `createGitAutomationService`, `workflows*` IPC channels | Migrado |
| Git Intelligence & Projetos | `ProjectsPage`, `ProjectPage`, `GitIntelligencePage` | `createProjectService`, `registerGitIpcHandlers`, `projectsGit*` IPC channels | Migrado |
| Azure DevOps / TFS | `AzureDevOpsPage` | `AzureDevOpsRepository`, `AzureDevOpsCredentialStore`, `AzureDevOpsClient`, `azureDevOps*` IPC | Migrado |
| Skills Catalog, Studio & Transactional | `SkillsPage` | `registerSkillsCatalogIpcHandlers`, `registerSkillsIntelligenceIpcHandlers`, `createSkillStudioService`, `createTransactionalSkillInstaller` | Migrado |
| MCP Server & Monitoramento | `McpPage`, `MonitoringPage`, `AnalyticsPage`, `AgentsPage`, `ExtensionsPage`, `SettingsPage` | `createMcpService`, `createMonitoring`, `registerMonitoringIpcHandlers`, `registerCoreIpcHandlers`, `registerThemeIpcHandlers` | Migrado |

### 2.2 Aethera Studio (`apps/aethera-desktop`)

| Funcionalidade | UI Migrada (`src/renderer/src/main.tsx`) | Backend / IPC Real (`src/main/aethera-ipc.ts`) | Estado |
| :--- | :--- | :--- | :--- |
| Home Autônoma, Fila, Biblioteca & Projetos | `AetheraHomePage`, `ContentQueuePage`, `ContentLibraryPage`, `ContentProjectPage`, `ContentPackagePage`, `ContentVariantsPage`, `ContentAnalyticsIdeasPage` | `registerContentOperatingSystemIpcHandlers`, `ContentOperatingSystemRepository`, `ProductionRunService`, `DerivativeService` | Migrado |
| Estúdio Remotion & Renderização Real | `VelixPage`, `AetheraProductionWorkspace` | `renderMotionProject`, `renderMotionFrames`, `renderStyleMix`, `renderAetheraTimelineSegments`, `createVelixService`, `RenderService` | Migrado |
| Narração, Música, SFX, VFX & Edição | `VelixPage`, `AetheraProductionWorkspace` | `createVoiceStudioClient`, `generateVoiceStudioNarration`, `AceStepLocalClient`, `applyTimelineOps`, `AetheraTimelineRepository` | Migrado |
| Revisão e Modificações por Prompt | `AetheraProductionWorkspace` | `runAetheraReviewCycles`, `createEditorialPlanService`, `videoStoryboardSemanticEdit`, `videoAetheraTimelineApply` | Migrado |
| OAuth YouTube, Canais & Publicação | `ContentChannelSetupPage`, `VelixPage` | `channelOAuthStore`, `youtubeChannelClient`, `runChannelPublication`, `videoChannelOAuth*`, `videoChannelPublish*`, `videoChannelSaveThumbnail` | Migrado |
| Calendário Editorial Interativo | `ContentCalendarPage` | `contentCalendar*` via `registerContentOperatingSystemIpcHandlers`, `videoChannelAgenda` | Migrado |
| Fallback de Agente Único | `AgentsPage` | `ClaudeCliAdapter` + `CodexCliAdapter` em `composeTaskEngine` e `runtime.ts` | Migrado |

### 2.3 Void (`apps/void-desktop`)

| Funcionalidade | UI Migrada (`src/renderer/src/main.tsx`) | Backend / IPC Real (`src/main/void-ipc.ts`) | Estado |
| :--- | :--- | :--- | :--- |
| Assistente Pessoal, Notificações & Automações | `PersonalAgentPage` | `registerPersonalIpcHandlers`, `PersonalSyncService`, `PersonalAutomationLoop`, `PersonalActionService` | Migrado |
| Captura de Voz & Reuniões | `PersonalAgentPage`, `CompanionHud` | `registerNeuraIpc`, `createNeuraRuntime`, `VoiceStudioWhisperProvider`, `VoiceStudioStreamingProvider`, `WindowsSpeechProvider`, `SystemAudioSource` | Migrado |
| OAuth Google (Gmail/Calendar) & Spotify | `PersonalAgentPage`, `ExtensionsPage`, `CompanionHud` | `GooglePersonalOAuth`, `GmailClient`, `GoogleCalendarClient`, `SpotifyService`, `SpotifyAdapter`, `spotify*` IPC | Migrado |
| Companion HUD & Configurações | `CompanionHud` (`?companion=hud`), `AgentsPage`, `ExtensionsPage`, `SettingsPage` | `CompanionHudController`, `registerCompanionIpcHandlers`, `companionHud*` IPC, `BrainService` | Migrado |

---

## 3. Evidências de Validação e Ressalvas Honestas

- **Typecheck, Lint e Build:** Executados e aprovados após as edições finais em `orchestrator-desktop`, `aethera-desktop` e `void-desktop` (`npm run typecheck`, `npx eslint`, `npm run build:all-apps`).
- **Testes Automatizados:**
  - `apps/orchestrator-desktop/test/orchestrator-app.test.ts` (3/3)
  - `apps/aethera-desktop/test/aethera-app.test.ts` (3/3)
  - `apps/void-desktop/test/void-app.test.ts` (3/3)
  - `packages/integration-contracts/test/contracts.test.ts` (6/6)
  - `packages/integration-contracts/test/sep08-multiprocess.test.ts` (1/1, 3 processos reais)
  - `test/skills-library-discovery.test.ts` (1/1)
- **Ressalvas de ambiente / serviços externos:**
  - Fluxos que dependem de credenciais OAuth reais do usuário (YouTube Data API, Google Gmail/Calendar, Spotify, Azure DevOps) ou binários locais opcionais (VoiceStudio, Remotion Chromium download, FFmpeg externo) estão com toda a infraestrutura IPC e UI conectada, mas a execução ponta a ponta contra provedores externos depende de login/credenciais fornecidas pelo usuário em ambiente com rede.
  - O monolito `apps/desktop` foi mantido intacto conforme exigido até validação visual em execução GUI completa pelo usuário.
