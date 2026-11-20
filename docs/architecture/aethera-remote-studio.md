# Aethera Remote Studio — Auditoria Técnica e Arquitetura (Fase 1)

**Data:** 2026-11-20  
**Escopo:** Arquitetura de execução remota real para controlar o Aethera Studio instalado no PC Windows a partir do Aethera Web, preservando integralmente o Aethera Desktop e os demais aplicativos do monorepo.

---

## 1. Auditoria do Monorepo Atual

### 1.1 Estrutura de Aplicativos (`apps/`)

| Diretório | Pacote | Função | Estado no Snapshot |
| :--- | :--- | :--- | :--- |
| `apps/aethera-desktop` | `@neuralbridge/aethera-desktop` (`0.1.73`) | Estúdio audiovisual desktop autônomo (Electron 44 + electron-vite + React 19 + SQLite/Drizzle + FFmpeg + Sharp) | Preservado intacto; build bloqueado neste container pela ausência de pacotes `@neuralbridge/*` |
| `apps/aethera-web` | `@neuralbridge/aethera-web` (`0.1.73`) | Interface Web Light Bento com 13 telas + 4 subtelas, Express 5, `node:sqlite`, FFmpeg/FFprobe e SSE | Funcional neste ambiente (build, lint, typecheck, 9 testes e E2E Chromium validados) |
| `apps/desktop` | `@neuralbridge/desktop` | Aplicativo Singularity Desktop | Preservado intacto |
| `apps/orchestrator-desktop` | `@neuralbridge/orchestrator-desktop` | Aplicativo Orchestrator Desktop | Preservado intacto |
| `apps/void-desktop` | `@neuralbridge/void-desktop` | Aplicativo Void Desktop | Preservado intacto |
| `apps/mobile` | `@neuralbridge/mobile` | Aplicativo Mobile | Preservado intacto |

### 1.2 Pacotes Internos (`packages/`): Disponíveis vs. Ausentes

A auditoria de `packages/` e de todos os `package.json` / imports em `apps/aethera-desktop/src/main/` identificou:

**Disponíveis no repositório atual (2):**
- `packages/agents` (`@neuralbridge/agents`): `ClaudeCliAdapter`, `CodexCliAdapter`, `claude-parser`, `codex-parser`, `codex-limits`, `process-runner`, `redact`. *(Nota: importa tipos de `@neuralbridge/shared` e utilitários de `@neuralbridge/workspace`.)*
- `packages/brain` (`@neuralbridge/brain`): motor de embeddings/memória (`@huggingface/transformers`, `better-sqlite3`, `drizzle-orm`, `zod`). *(Importa `@neuralbridge/database` e `@neuralbridge/shared`.)*

**Ausentes no snapshot importado (10 pacotes referenciados pelo Desktop):**
- `@neuralbridge/cinema` — motor Cinema Engine real (`produceCinemaPackage`, `renderRealCinemaMp4`, `probeRealMp4`, `runAutonomousMediaAcquisition`, `searchResilientMediaSources`, `EditorialCalendarEngine`, `AetheraAcademyEngine`, `AetheraEvolutionCore`, `evaluateReleaseGates`, `synthesizeElevenLabsWav`, `extractWaveformData`, `exportToOtioJson`, etc.)
- `@neuralbridge/database` — repositórios Drizzle/SQLite (`openDatabase`, `AetheraStudioRepository`, `ContentOperatingSystemRepository`, `VelixProductionRepository`, `VelixChannelRepository`, `AetheraCreativeStudioRepository`, `AetheraTimelineRepository`, `AetheraReviewRepository`, `backupDatabase`)
- `@neuralbridge/shared` — tipos compartilhados (`AgentEvent`, `AgentId`, `AgentStatus`, `planAetheraProductionCommand`)
- `@neuralbridge/workspace` — descoberta de CLIs e ferramentas de mídia (`findClientCli`, `createCliRunner`, `motionMediaTools`)
- `@neuralbridge/integration-contracts` — servidor loopback, pareamento entre apps e contratos (`startLoopbackIntegrationServer`, `IntegrationAuthRegistry`, `PeerPairingManager`, `IAgentProviderContract`, `DATA_OWNERSHIP_BOUNDARIES`)
- `@neuralbridge/orchestrator` — DAG de produção e metadados (`buildAutonomousPipelineDag`, `interpretPromptToBrief`, `generateVideoMetadata`, `planEditorialCalendar`, `detectScheduleConflicts`)
- `@neuralbridge/creative-studio` — presets e fontes de mídia autêntica (`AuthenticMediaSource`, `getProfessionalPreset`, `normalizeComfyUiBaseUrl`)
- `@neuralbridge/core` — protocolo base (`CORE_TIMING`)
- `packages/desktop-shared` — segurança Electron, `hardenApp`, `StudioSecretStore` (referenciado por caminho relativo)
- `@neuralbridge/mcp-server` e `@neuralbridge/extension-neura` — referenciados por apps irmãos

> **Regra de Integridade Arquitetural:** Nenhum contrato ou implementação falsa de `@neuralbridge/*` será inventado. O `apps/aethera-remote-host` operará com um **Engine Bridge plugável**:
> - **Modo Monorepo Completo (no PC Windows com todos os pacotes `@neuralbridge/*` presentes):** carrega dinamicamente e reutiliza os serviços reais (`@neuralbridge/cinema`, `@neuralbridge/database`, `@neuralbridge/agents`, `StagedCinemaPipeline`, `TtsProviderRegistry`, `AetheraCreativeStudioService`).
> - **Modo Host Standalone (quando executado no snapshot atual sem os pacotes ausentes):** executa nativamente no SO tudo que não depende dos pacotes ausentes (telemetria real CPU/RAM/GPU, descoberta e execução real de CLIs de agentes, `ffmpeg`/`ffprobe` com detecção de GPU/NVENC, `yt-dlp` real quando instalado, persistência SQLite de jobs e streaming SSE/Range) e reporta explicitamente `engine_package_missing` para etapas que dependem do `@neuralbridge/cinema` completo.

### 1.3 Superfície Electron IPC do Aethera Desktop

O arquivo `apps/aethera-desktop/src/preload/index.ts` expõe `window.aetheraBridge` com mais de **115 canais IPC** divididos em 11 domínios:

1. **Runtime & Pareamento:** `aethera:status`, `aethera:produce`, `aethera:plan-calendar`, `aethera:revise-command`, `aethera:pair-peer`, `aethera:system-backup-*`
2. **Pipeline Cinema & Render Real:** `cinema:start-staged-production`, `cinema:revise-staged-production`, `cinema:cancel-production`, `cinema:resume-production`, `cinema:get-production-state`, `cinema:render-real-mp4`, `cinema:probe-real-mp4`, `cinema:capabilities`, `cinema:export-otio`, `cinema:repair`, `cinema:benchmark`, `cinema:nle-op`
3. **Projetos, Timeline, Áudio, Cor & Grounding:** `cinema:list-projects`, `cinema:load-project`, `cinema:delete-project`, `cinema:update-timeline`, `cinema:update-audio-mix`, `cinema:update-color-plan`, `cinema:update-color-grade`, `cinema:update-script`, `cinema:apply-prompt-revision`, `cinema:resolve-pending-media`, `cinema:review-grounding-evidence`
4. **Fontes de Mídia & Biblioteca:** `media-sources:*`, `cinema:import-media`, `cinema:list-library`, `cinema:extract-waveform`, `cinema:extract-thumbnail`
5. **Supervisão de Agentes:** `agent-execution:get-settings`, `agent-execution:save-settings`, `agent-execution:list-runs`, `agent-execution:stop-run`
6. **Console & Push em Tempo Real:** `cinema:console-list`, `cinema:console-list-all`, `cinema:console-jobs`, `cinema:console-facets`, `cinema:console-export`, `cinema:console-clear` + eventos push `cinema:production-progress` e `cinema:console-log`
7. **TTS:** `tts:list-providers`, `tts:list-voices`, `tts:health-check`, `tts:get-preview-url`, `tts:get-capabilities`, `tts:elevenlabs-*`
8. **Creative Studio:** `creative:*` (Brand Kits, Thumbnail Lab, Typography Lab, Image Engine/ComfyUI, LoRAs, aprovação técnica/estética)
9. **Trend Radar:** `trend-radar:*`
10. **Calendário Editorial:** `cinema:calendar-*`
11. **Evolution Core & Academy:** `cinema:evolution-*`, `cinema:run-directors-dag`, `cinema:academy-*`

**Dependências exclusivas de Electron (não expor diretamente à Web):**
- `ipcMain`, `ipcRenderer`, `BrowserWindow`, `Menu`
- `app.getPath('userData')` (`%APPDATA%\AetheraStudio`) e `dialog.showOpenDialog` / `shell`
- `safeStorage` (criptografia DPAPI do Windows usada para credenciais locais) — segredos jamais saem do PC; a API remota retorna apenas status/máscaras.
- Protocolo customizado `aethera-media://` com Range requests — substituído no Remote Host por `GET /api/artifacts/:id` autenticado, restrito a diretórios permitidos e com suporte a `Range: bytes=...`.

### 1.4 Telas e Rotas da Versão Web vs. Desktop

O `apps/aethera-web` já possui paridade estrutural com as **13 rotas principais** e **4 subtelas de projeto** definidas em `apps/aethera-desktop/src/renderer/src/main.tsx`:

| Rota Desktop | Tela no `apps/aethera-web` | Estado Atual |
| :--- | :--- | :--- |
| `/aethera` | Home (Dashboard Bento) | Implementada (conectada ao backend local do Web) |
| `/aethera/projects` + `:id` + `/package`, `/variants`, `/analytics/idea` | Projeto Manual + 4 subtelas | Implementada |
| `/aethera/cinema` | Produção com IA | Implementada |
| `/aethera/console` | Console Geral | Implementada (SSE) |
| `/aethera/creative` | Thumbs & Artes | Implementada |
| `/video` (`/aethera/editor`) | Editor Multifaixa | Implementada |
| `/aethera/library` | Biblioteca de Mídia | Implementada |
| `/agents` | Agentes (RF-07, Humanize, YouTube Agent) | Implementada |
| `/aethera/review` | Revisão e Qualidade | Implementada |
| `/aethera/queue` | Pipeline e Fila de Renderização | Implementada (FFmpeg real + SSE) |
| `/aethera/calendar` | Calendário Editorial | Implementada |
| `/aethera/channels/new` | Publicação e Canais | Implementada |
| `/settings` | Configurações | Implementada |
| *(Novo na Fase 5)* | **Painel Remote Host** (em Configurações / barra superior / rota dedicada `/remote`) | **A implementar** (telemetria CPU/RAM/GPU, pareamento HTTPS, fila remota, logs, prévias, downloads, reconexão) |

### 1.5 Módulos e Interfaces Reutilizáveis Existentes

Os seguintes módulos do repositório são **Node.js puro** (sem dependência de Electron) e podem ser reutilizados diretamente ou adaptados sem duplicação de motor:
- `apps/aethera-desktop/src/main/antigravity-cli.ts` (`findAntigravityCli`, `detectAntigravityCli`, `runAntigravityPrompt`)
- `apps/aethera-desktop/src/main/production-console.ts` (formato de logs estruturados JSONL, `ProductionLogStage`, `ProductionLogEvent`, `ProductionJobSummary`)
- `apps/aethera-desktop/src/main/production-agent-runner.ts` (supervisão de processos longos, detecção de travamento por inatividade, encerramento de árvore de processos no Windows/Linux, `ClaudeStreamReader`)
- `apps/aethera-desktop/src/main/production-agent-providers.ts` (classificação de falhas `quota_exhausted` / `rate_limited` / `auth_failed` / `cli_not_installed` / `stalled`, cooldown por backend e cadeia RF-07)
- `packages/agents/src/claude-parser.ts`, `codex-parser.ts`, `process-runner.ts`, `redact.ts` (parsers de stream e redação de segredos)

### 1.6 Banco de Dados e Armazenamento

- **Desktop (Windows):** SQLite (`better-sqlite3` + Drizzle) em `%APPDATA%\AetheraStudio\aethera.db`, logs JSONL em `production-console/`, cache em `CinemaSmartCache`, biblioteca gerenciada em `ManagedMediaLibrary`.
- **Web (`apps/aethera-web`):** SQLite (`node:sqlite` `DatabaseSync` em WAL) em `apps/aethera-web/data/aethera-web.db` e renders em `apps/aethera-web/data/renders/`.
- **Remote Host (`apps/aethera-remote-host`):** SQLite próprio (`node:sqlite` WAL) em `%LOCALAPPDATA%\AetheraRemoteHost\remote-host.db` (configurável por `AETHERA_REMOTE_DATA_DIR`) para estado persistente de jobs, fila, eventos SSE com `Last-Event-ID`, aprovações humanas, trilha de auditoria e índice de artefatos autorizados — garantindo recuperação limpa após reinicialização sem corromper o banco do Desktop.

---

## 2. Arquitetura Alvo: Separação em 3 Camadas

```
┌────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 1 — FRONTEND (Qualquer navegador / dispositivo)                    │
│  apps/aethera-web (React 19 + Vite + Light Bento UI — 13 telas + Remote)  │
│  • Conecta ao Remote Host via HTTPS + Bearer Token (X-Aethera-Token / Auth)│
│  • Painel Remote Host: Online/Offline, CPU/RAM/GPU, Agentes, Jobs, Logs   │
│  • EventSource / fetch-SSE com reconexão automática e Last-Event-ID       │
│  • Player de prévias (Range streaming) e download seguro de MP4           │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ HTTPS (ngrok / Cloudflare Tunnel)
                                     │ TLS 1.3 + Bearer Token + CORS estrito
                                     │ + Rate Limit + Auditoria + Aprovação
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 2 — BACKEND REMOTO NO PC WINDOWS (127.0.0.1:4848)                  │
│  apps/aethera-remote-host (Node.js 22+ / TypeScript / Express 5)           │
│  • Escuta EXCLUSIVAMENTE em 127.0.0.1 (nunca 0.0.0.0 por padrão)           │
│  • Contratos versionados (v1) compartilhados com o frontend                │
│  • Auth middleware (token hash SHA-256 + scopes por operação)              │
│  • Catálogo fechado de operações permitidas (zero shell arbitrário)        │
│  • Job Orchestrator persistente em SQLite (queued/running/awaiting_approval│
│    /completed/failed/cancelled/interrupted_on_restart)                     │
│  • SSE Hub por job (GET /api/jobs/:id/events) + global (/api/events)       │
│  • Artifact Server seguro (allowlist de diretórios + HTTP Range 206)       │
│  • Approval Gate para ações sensíveis (delete, publish, edit, export)      │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ Chamadas locais controladas
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  CAMADA 3 — SERVIÇOS LOCAIS DO PC WINDOWS                                  │
│  • Telemetria real: os.cpus/totalmem/freemem + nvidia-smi / WMIC GPU       │
│  • Agentes reais: Antigravity (agy), Claude Code (claude), Codex (codex),  │
│    Claude Gateway, Ollama HTTP (127.0.0.1:11434) — fallback RF-07 real     │
│  • Cinema Engine Bridge:                                                   │
│     - Se @neuralbridge/cinema presente: delega 100% ao motor real          │
│     - Se ausente: executa etapas nativas reais (FFmpeg/NVENC, FFprobe,     │
│       yt-dlp, agentes CLI) e marca etapas ausentes com clareza             │
│  • Mídia & Render: FFmpeg (h264_nvenc / libx264), FFprobe, EBU R128,       │
│    yt-dlp, VoiceStudio local / ElevenLabs                                  │
│  • Armazenamento autorizado: diretórios explícitos (allowlist),            │
│    sem exposição direta de Electron IPC, banco Desktop ou terminal         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Contratos Versionados da API (`v1`)

Todos os contratos serão definidos em um pacote/módulo compartilhado tipado (`packages/remote-contracts` ou `apps/aethera-remote-host/src/contracts/v1.ts` importado pelo frontend) com versão explícita `schemaVersion: "1.0.0"`.

### Endpoints Obrigatórios (Fase 2)

| Método | Rota | Auth / Scope | Responsabilidade |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Pública (mínima) | Verifica se o host está vivo (`ok`, `version`, `schemaVersion`, `uptimeSec`, `engineMode`) |
| `GET` | `/api/host/status` | `host:read` | Telemetria real do PC: SO, hostname, CPU (modelo, núcleos, carga %), RAM (total/usada/livre), GPU(s) (nome, VRAM, driver, suporte `h264_nvenc`), disco, uptime, capacidades de binários e modo do Cinema Engine |
| `GET` | `/api/agents` | `agents:read` | Descoberta real de agentes instalados (`antigravity`, `claude`, `codex`, `claude-gateway`, `ollama`), versão, caminho resolvido, status de autenticação, capacidades suportadas e ordem de fallback RF-07 |
| `GET` | `/api/projects` | `projects:read` | Lista projetos acessíveis a partir dos diretórios/repositórios autorizados (Desktop + Remote Host) |
| `POST` | `/api/jobs` | `jobs:write` | Cria um job tipado a partir do catálogo fechado de operações (`agent.run`, `cinema.produce`, `cinema.humanize`, `cinema.youtube_audit`, `media.acquire`, `render.ffmpeg`, `media.probe`), retornando `201` com `jobId` |
| `GET` | `/api/jobs` | `jobs:read` | Lista fila de jobs (ativos, aguardando aprovação, concluídos, falhos, recuperados) |
| `GET` | `/api/jobs/:id` | `jobs:read` | Detalhe completo do job, etapas reais, progresso real, artefatos gerados, erro e histórico |
| `POST` | `/api/jobs/:id/cancel` | `jobs:control` | Cancela o job e encerra de forma segura a árvore de processos (`taskkill /T /F` no Windows / `SIGTERM→SIGKILL` no POSIX) |
| `POST` | `/api/jobs/:id/approve` | `jobs:approve` | Aprova ou rejeita um job sensível em estado `awaiting_approval` |
| `GET` | `/api/jobs/:id/events` | `jobs:read` | Stream SSE em tempo real (`stage`, `log`, `progress`, `heartbeat`, `artifact`, `completed`, `failed`, `cancelled`) com replay via `Last-Event-ID` |
| `GET` | `/api/artifacts/:id` | `artifacts:read` | Streaming HTTP Range (`206 Partial Content`) para prévia `<video>` e download autenticado de MP4/thumbnails/logs |

### Modelo de Segurança (Fase 6)
- **Bind estrito:** `127.0.0.1` por padrão (recusa bind externo sem flag explícita).
- **Autenticação obrigatória:** Bearer token (ou query token efêmero de uso único / curto prazo apenas para `<video src>` e `EventSource` quando headers customizados não forem suportados pelo navegador, assinado por HMAC-SHA256 com expiração curta de 60s).
- **Autorização por escopo e catálogo fechado:** nenhuma rota aceita comandos shell livres (`exec`/`cmd`/`powershell`). Apenas operações enumeradas com validação estrita de schema.
- **Allowlist de diretórios:** toda leitura de projeto/mídia passa por canonicalização (`realpath` / `resolve`) + verificação estrita de pertencimento aos diretórios permitidos.
- **Rate limiting + Auditoria:** limite por IP/token + registro persistente em SQLite de toda chamada autenticada, falha de autenticação, aprovação humana e cancelamento.
- **CORS restritivo:** somente origens explicitamente listadas em `AETHERA_ALLOWED_ORIGINS`.
- **Aprovação humana:** operações sensíveis (exclusão, publicação externa, sobrescrita de arquivos ou escrita fora do diretório de saída do job) entram em `awaiting_approval` até confirmação explícita.
- **Sem credenciais no repositório:** tokens gerados localmente pelos scripts PowerShell em `.env.local` (ignorado pelo `.gitignore`).

---

## 4. Plano de Implementação por Fases e Critérios de Aceite

### Fase 2 — `apps/aethera-remote-host` (Core API, Persistência, Jobs e SSE)
- **Escopo:** criar o workspace `apps/aethera-remote-host` com contratos tipados `v1`, servidor Express escutando em `127.0.0.1`, banco SQLite persistente (`remote-host.db`), recuperação de jobs órfãos após reinicialização (`interrupted_on_restart`), telemetria real de CPU/RAM/GPU (`nvidia-smi` / `os`), artifact server com HTTP Range e endpoints `/api/health`, `/api/host/status`, `/api/agents`, `/api/projects`, `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/cancel`, `/api/jobs/:id/approve`, `/api/jobs/:id/events` e `/api/artifacts/:id`.
- **Critérios de aceite:** testes automatizados cobrindo auth (401/403), criação/cancelamento/recuperação após restart do SQLite, streaming SSE com `Last-Event-ID`, prevenção de path traversal nos artefatos e typecheck/lint limpos.

### Fase 3 — Integração Real com Agentes (RF-07 + Solo Agent + Isolamento)
- **Escopo:** integrar descoberta e execução real de `antigravity` (`agy`), `claude` (`Claude Code`), `codex` (`Codex CLI`), `claude-gateway` e `ollama` (HTTP API `/api/tags` + `/api/generate`), reutilizando a lógica de classificação de falhas, cooldown por backend, supervisão de inatividade e encerramento de árvore de processos do Desktop. Garantir operação completa com apenas 1 agente instalado (qualquer um deles executa tarefas compatíveis sozinho) e catálogo fechado de tarefas + aprovação humana.
- **Critérios de aceite:** testes com binários mockados em processo real (para validar spawn, stream, timeout/cancelamento e fallback entre provedores) + sonda real do ambiente confirmando honestidade quando CLIs não estão presentes.

### Fase 4 — Cinema Engine Bridge Real (Monorepo + FFmpeg GPU/CPU)
- **Escopo:** conectar o Remote Host ao `@neuralbridge/cinema` via carregador dinâmico tipado (zero recriação do motor) cobrindo pesquisa, YouTube Agent, Humanize, aquisição (`yt-dlp`), storyboard, TTS, legendas, edição, SFX/VFX, renderização FFmpeg com detecção automática de `h264_nvenc` (GPU NVIDIA) / `libx264` (CPU), auditoria `ffprobe`/EBU R128 e revisão/aprovação. Progresso real baseado em eventos de etapa e `time=` real do FFmpeg (zero porcentagens fictícias).
- **Critérios de aceite:** teste real de renderização FFmpeg no ambiente atual validado por `ffprobe` + progresso SSE real derivado do stderr do FFmpeg + teste do fallback limpo (`engine_package_missing`) quando `@neuralbridge/cinema` não está presente.

### Fase 5 — Integração no `apps/aethera-web` + Painel Remote Host
- **Escopo:** preservar o design Light Bento e as 13 telas (+ 4 subtelas já restauradas), adicionando um **Painel Remote Host** completo (status online/offline do PC, CPU/RAM/GPU, agentes instalados no PC, fila de jobs remotos, progresso real via SSE, logs ao vivo, player de prévias, download de MP4, cancelamento, aprovação humana e reconexão automática com recuperação de sessão). Adicionar alternador transparente de modo (**Host Remoto Windows** vs. **Backend Local do Container**) sinalizando claramente o que executa no PC vs. o que está bloqueado.
- **Critérios de aceite:** testes de integração Web ↔ Remote Host + verificação em Chromium real (desktop e mobile) sem erros de console/rede, validando conexão, monitoramento, disparo de job, acompanhamento SSE, cancelamento e reconexão.

### Fase 6 — Acesso Remoto Seguro & Scripts PowerShell Windows
- **Escopo:** adicionar suporte pronto para **ngrok** e **Cloudflare Tunnel (`cloudflared`)**, rate limiting, CORS restritivo, trilha de auditoria SQLite, tickets efêmeros de mídia e scripts PowerShell em `apps/aethera-remote-host/scripts/`:
  - `start-remote-host.ps1` (gera token seguro na primeira execução, inicia host em `127.0.0.1` e opcionalmente abre túnel HTTPS ngrok ou cloudflared)
  - `status-remote-host.ps1` (verifica processo, `/api/health`, `/api/host/status`, GPU e túnel ativo)
  - `stop-remote-host.ps1` (encerra host e túnel de forma limpa)
  - Documentação completa de instalação e configuração no Windows (`docs/architecture/aethera-remote-setup-windows.md`).
- **Critérios de aceite:** validação de segurança (rate limit, CORS bloqueando origem não autorizada, recusa de bind externo sem opt-in, validação estática dos scripts PowerShell e zero credenciais no repositório).

### Fase 7 — Teste Real de Ponta a Ponta e Relatório Final
- **Escopo:** executar todos os testes automatizados e E2E possíveis no ambiente Linux atual (Web ↔ Remote Host via HTTP/SSE + FFmpeg real + reconexão) e entregar roteiro passo a passo + checklist de validação para execução no PC Windows real com túnel HTTPS.
- **Regra de honestidade:** como este container é Linux sem acesso físico ao PC Windows do usuário, os testes de execução real no Windows (agentes instalados no Windows, NVENC/GPU local, `@neuralbridge/cinema` do monorepo completo e acesso externo via ngrok/Cloudflare) serão **explicitamente marcados como pendentes de execução no host Windows**, nunca declarados concluídos sem evidência real.
