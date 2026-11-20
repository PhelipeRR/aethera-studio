# Aethera Studio — Arquitetura de Sincronização Bidirecional (Web ↔ Remote Host ↔ Desktop)

**Data da auditoria:** 2026-11-20  
**Status de validação:** Camada de Autoridade de Sincronização, Contratos, Integração Web, Ponte Desktop e Testes Automatizados de Integração/E2E implementados neste ambiente; **validação com binário Electron real no Windows pendente de execução local no PC do usuário** (ver Seção 6).

---

## 1. Auditoria Real do Aethera Desktop (Sem Suposições)

A inspeção direta do código-fonte real de `apps/aethera-desktop` revelou que o Desktop **não** armazena todos os dados em um único arquivo SQLite monolítico. O diretório real de dados é definido em `apps/aethera-desktop/src/main/index.ts` (linha 16):

```ts
app.setName('Aethera Studio');
app.setPath('userData', join(app.getPath('appData'), 'AetheraStudio'));
// Windows: %APPDATA%\AetheraStudio
```

### Mapa real de persistência auditado no Desktop

| Artefato / Camada | Caminho real no Windows (`userData`) | Evidência no código | Dono / Observação |
|---|---|---|---|
| **Projetos Cinema AI** (`CinemaProductionPackage`) | `%APPDATA%\AetheraStudio\cinema-projects\<projectId>.json` | `aethera-ipc.ts:1728,1823-1902` | Gravado como JSON completo contendo `timeline`, `direction.brief`, `editorialScript`, cenas, áudio, color grading e legendas. |
| **Metadados de Render** (`RealRenderResult`) | `%APPDATA%\AetheraStudio\cinema-projects\<projectId>.render.json` | `aethera-ipc.ts:1733-1765` | Aponta para o MP4 final (`mp4Path`) + métricas `probe` + `audioAudit`. |
| **Arquivos MP4 renderizados** | `cinema-renders\<id>.mp4` e `cinema-workspaces\<id>\renders\<id>.mp4` | `aethera-ipc.ts:1767-1770` | Servidos no Electron via protocolo `aethera-media://local?path=...`. |
| **Jobs Staged Pipeline** | `cinema-jobs\<projectId>.json` | `aethera-ipc.ts:2095` | Estado vivo do `StagedCinemaPipeline`. |
| **Console de Produção** | `cinema-console-logs\*.jsonl` | `aethera-ipc.ts:339` | Logs JSONL indexados por `jobId`. |
| **Biblioteca de Mídia Gerenciada** | `media-library\` e `cinema-media\` | `managed-media-library.ts`, `aethera-ipc.ts:2096` | Blobs deduplicados por SHA-256 + pastas de aquisição. |
| **Calendário Editorial** | `calendar\editorial-calendar-store.json` | `aethera-ipc.ts:1915` | `EditorialCalendarEngine`. |
| **SQLite interno do Electron** | `runtime.ts:129` (`DATA_OWNERSHIP_BOUNDARIES.aethera.sqliteDbName`) e `aethera-ipc.ts:294` (`initDatabase`) | `runtime.ts:129`, `aethera-ipc.ts:294` | Aberto exclusivamente pelo Electron (`better-sqlite3` / Drizzle) para `videoProjects`, `ContentOperatingSystemRepository`, `VelixProductionRepository`, `AetheraStudioRepository`, `AetheraCreativeStudioService`. **Schemas completos de `@neuralbridge/database` residem apenas no PC Windows.** |

### Defeito crítico identificado na auditoria do Desktop
Em `apps/aethera-desktop/src/main/aethera-ipc.ts:3536-3543`, `cinema:load-project` lia `cinemaPackages.get(targetId)` da memória sem verificar se o arquivo `<projectId>.json` em disco foi atualizado externamente. Sem invalidação baseada em `mtimeMs`/SHA-256 + `fs.watch`, alterações feitas no Web não apareceriam no Desktop sem reiniciar o Electron. Esse defeito é corrigido pela ponte `apps/aethera-desktop/src/main/project-sync-bridge.ts`.

---

## 2. Fonte de Verdade e Autoridade Única de Escrita

Para eliminar escrita concorrente em SQLite (Requisito 2) e preservar integralmente o motor `@neuralbridge/cinema` e o banco interno do Electron (Requisitos 5 e 10):

1. **Autoridade Única de Escrita para Sincronização (`ProjectSyncService` no `aethera-remote-host`):**
   - Roda no **PC Windows** (porta dedicada `127.0.0.1:4848`, exposta via ngrok HTTPS com Bearer Token).
   - Mantém seu banco SQLite WAL dedicado (`apps/aethera-remote-host/data/remote-host.db` — tabelas `synced_projects`, `synced_project_revisions`, `sync_changelog`, `sync_idempotency`, `sync_media_refs`, `sync_backups`).
   - **Nunca** abre o SQLite interno do Electron para gravação concorrente.
2. **Projeção Atômica Bidirecional para o Desktop (`cinema-projects/`):**
   - Projetos criados/editados no Web são persistidos na Autoridade (SQLite) **e** projetados atomicamente (`write .tmp` → `rename`) para `%APPDATA%\AetheraStudio\cinema-projects\<projectId>.json` (formato compatível com `CinemaProductionPackage` + metadados aditivos no sidecar `<projectId>.sync.json`, sem poluir schemas Zod do Cinema Engine).
   - Edições feitas no Aethera Desktop em `cinema-projects/<projectId>.json` são detectadas pelo `ProjectSyncService` (via `fs.watch` + reconciliação por `contentHash`/SHA-256 + notificação loopback opcional `POST /api/sync/desktop-ingest`), incrementam a versão autoritativa, gravam revisão no `sync_changelog` e transmitem evento SSE imediato para todos os navegadores conectados.
   - No Electron, `ProjectSyncBridge` observa `cinema-projects/`, invalida automaticamente o cache `cinemaPackages` quando um arquivo muda em disco e emite o evento IPC `cinema:projects-synced` para as janelas abertas.
3. **Cache Local e Modo Offline no Aethera Web:**
   - Projetos criados sem PC conectado permanecem marcados como **`Local (Web)`** no banco local do Web.
   - Quando o PC conecta (`PC Online`), o Web abre stream SSE `GET /api/sync/events` (com `Last-Event-ID` / `since=<seq>`), exibe todos os projetos reais do PC/Desktop marcados como **`Sincronizado`**, permite enviar projetos locais ao PC em 1 clique, enfileira edições offline como **`Pendente`** e bloqueia sobrescrita silenciosa com estado explícito **`Conflito`**.

---

## 3. Controle de Concorrência, Versionamento e Idempotência

- **IDs estáveis:** todo projeto sincronizado preserva um `id` canônico imutável (`proj_...` ou ID existente do Desktop). Nenhuma sincronização gera IDs duplicados.
- **Versionamento otimista (`version` + `expectedVersion`):**
  - Toda escrita (`PUT /api/sync/projects/:id`) envia `expectedVersion`.
  - Se `expectedVersion !== current.version` e o `contentHash` diferir, a Autoridade **rejeita com HTTP `409 Conflict`**, retornando `serverProject`, `incomingProject` e `changedFields`.
  - O usuário escolhe explicitamente resolver: `keep_server`, `force_client` ou `fork_copy` (`POST /api/sync/projects/:id/resolve-conflict`).
- **Idempotência:** toda operação de criação/atualização aceita `Idempotency-Key` (header ou body), persistida em `sync_idempotency` no SQLite — retries de rede e reconexões SSE nunca criam projetos ou revisões duplicadas.
- **Sincronização incremental e reconexão:**
  - `GET /api/sync/changes?since=<seq>` retorna apenas deltas após a última sequência conhecida.
  - `GET /api/sync/events` transmite eventos em tempo real (`project_upserted`, `project_deleted`, `conflict_detected`, `media_ready`, `desktop_ingested`) com replay automático via `Last-Event-ID` e heartbeat a cada 15s.
- **Mídia segura sem expor caminhos do Windows:**
  - Todo arquivo MP4/áudio/imagem referenciado recebe um `mediaRefId` opaco (`mref_<sha256-16>`), validado dentro das raízes autorizadas (`cinema-renders`, `cinema-workspaces`, `cinema-media`, `media-library`, `remote-host/artifacts`).
  - O navegador recebe apenas `mediaRefId` e emite ticket HMAC temporário (`POST /api/sync/media/:mediaRefId/ticket` → `GET /api/sync/media/:mediaRefId/stream?ticket=...` com suporte a HTTP Range 206). Nenhum caminho `C:\Users\...` é enviado ao cliente.

---

## 4. Estratégia de Migração e Preservação de Dados

1. **Backup automático pré-migração (obrigatório antes da primeira ingestão/alteração):**
   - `ProjectSyncService.ensurePreMigrationBackup()` copia todos os arquivos existentes de `cinema-projects/*.json`, `*.render.json` e o banco `remote-host.db` (se existir) para `<dataDir>/backups/pre-sync-<timestamp>/` com manifesto SHA-256 (`manifest.json`), antes de ingerir ou projetar qualquer projeto.
2. **Migrações exclusivamente aditivas:**
   - Novas tabelas (`synced_projects`, `synced_project_revisions`, `sync_changelog`, `sync_idempotency`, `sync_media_refs`, `sync_backups`) são criadas via `CREATE TABLE IF NOT EXISTS` sem alterar nem apagar tabelas existentes de jobs/artefatos.
   - No Desktop, arquivos originais `cinema-projects/<id>.json` permanecem 100% válidos para o `@neuralbridge/cinema`; metadados extras de versão ficam no sidecar `<id>.sync.json`.
3. **Resolução de projetos pré-existentes:**
   - Projetos existentes em `cinema-projects/` são ingeridos com seu `projectId` original e `origin: 'desktop'`, `version: 1`, `syncState: 'synced'`.
   - Projetos existentes no Web permanecem intactos como `Local (Web)` até o usuário optar por sincronizá-los com o PC (evitando poluir o Desktop com dados seed de demonstração).

---

## 5. Riscos Identificados e Mitigações

| Risco | Impacto | Mitigação aplicada |
|---|---|---|
| **Lock/corrupção de SQLite por escrita dupla** | Perda de dados no Electron | Zero escrita concorrente no SQLite do Electron; Autoridade única em `remote-host.db` + escrita atômica `.tmp`→`rename` para `cinema-projects/*.json`. |
| **Cache obsoleto em memória no Electron (`cinemaPackages`)** | Edições do Web não aparecem no Desktop aberto | `ProjectSyncBridge` invalida `cinemaPackages` comparando `mtimeMs`/`sha256` em `cinema:load-project` e via `fs.watch` + evento IPC `cinema:projects-synced`. |
| **Sobrescrita silenciosa em edição simultânea** | Perda de alterações recentes | `expectedVersion` obrigatório + HTTP `409 Conflict` com diff de campos e resolução explícita na UI. |
| **Vazamento de caminhos do Windows (`C:\Users\...`)** | Exposição de filesystem local | Sanitização de paths + `mediaRefId` opaco validado em raízes autorizadas + tickets HMAC temporários com Range 206. |
| **Schemas Drizzle privados do Desktop ausentes na nuvem** | Incompatibilidade em tabelas internas (`ContentOperatingSystemRepository`) | Não alteramos nem tocamos diretamente nas tabelas Drizzle privadas; integração Desktop é aditiva e compatível com `CinemaProductionPackage`, com validação final obrigatória no Electron Windows. |
| **Fechamento do navegador durante renderização** | Interrupção de job longo | Jobs continuam executando no `RemoteJobOrchestrator` no PC Windows, persistem progresso em SQLite e atualizam automaticamente o projeto sincronizado + `mediaRefId` do MP4 ao concluir. |

---

## 6. Classificação de Validação (Requisito 12)

- **Validado automaticamente neste ambiente (Linux/Node/FFmpeg/Chromium):**
  - Backup pré-migração com manifesto SHA-256;
  - Criação no Web → Autoridade Remote Host → projeção atômica compatível com Desktop (`cinema-projects/<id>.json`);
  - Edição externa no diretório Desktop → detecção automática por hash → evento SSE incremental → atualização visível no Web;
  - Detecção de conflito (`409 Conflict`) sem sobrescrita silenciosa + resolução (`keep_server`, `force_client`, `fork_copy`);
  - Idempotência (`Idempotency-Key`) sem duplicação;
  - Produção MP4 real via FFmpeg vinculada ao projeto sincronizado + streaming autenticado HTTP Range 206 por `mediaRefId` sem expor paths do SO.
- **PENDENTE DE VALIDAÇÃO REAL NO WINDOWS (Electron):**
  - Abrir o aplicativo **Aethera Studio Desktop (Electron)** real em `C:\dev\neuralbridge-studio` simultaneamente com o Remote Host (`start-remote-host.ps1 -Tunnel ngrok`), criar projeto no Web, abrir no Electron, editar no Electron, ver atualização em tempo real no Web, executar produção no PC com Cinema Engine real e reproduzir o MP4 nos dois ambientes.
