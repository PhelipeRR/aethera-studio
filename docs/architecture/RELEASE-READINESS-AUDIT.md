# Auditoria de Prontidão para Distribuição — Singularity Ecosystem

**Data:** 2026-11-13  
**Veredito Global:** **INSTALADORES GERADOS; PENDENTE DE VALIDAÇÃO EM AMBIENTE LIMPO (EXECUÇÃO ISOLADA/GUI/OAUTH)**

> Conforme política de qualidade, os instaladores NSIS foram gerados com sucesso, mas os aplicativos **não** são declarados prontos para distribuição pública até a validação da instalação e execução isolada/simultânea em máquina Windows limpa e revisão de assinatura de código.

---

## 1. Matriz de Prontidão (PASS / FAIL / BLOCKED)

| Área Auditada | Status | Evidência / Achado |
|---|---|---|
| **1. Pareamento, Auth, Revogação e Persistência de Segredos** | **PASS** (com correção aplicada) | **Corrigido:** `PeerPairingManager` anteriormente gravava `tokenSecret` em texto claro no `ecosystem-pairings.json`. Agora exige `secretCipher` (conectado ao `safeStorage` do Electron nos 3 apps) ou grava `tokenSecretRedacted: true` sem expor o segredo em disco (`reauth_required` ao reiniciar sem cipher). Validado em `sep06-pairing.test.ts` (3/3). |
| **2. Migrador, Integridade SQLite/WAL, Idempotência e Rollback** | **PASS** (com melhoria aplicada) | **Corrigido:** `migration.ts` agora usa escrita atômica (`*.tmp-<pid>` + `renameSync`), preserva o `backup-manifest.json` original em reexecuções idempotentes, bloqueia cópia de credenciais/tokens em texto claro (`requiresReauth: true`) e inclui `verifyMigrationIntegrity`. Validado em cópia descartável com `.db`, `-wal` e `-shm` em `sep08-migration-e2e.test.ts` (2/2). Dados reais não foram tocados. |
| **3. Geração dos 3 Instaladores NSIS (`electron-builder`)** | **PASS** (sem assinatura) | Gerados com `exit code 0` após linkar workspaces em `node_modules/@neuralbridge`: `dist/orchestrator/SingularityOrchestrator-Setup-0.1.65-x64.exe` (`202.74 MB`), `dist/aethera/AetheraStudio-Setup-0.1.65-x64.exe` (`130.15 MB`), `dist/void/Void-Setup-0.1.65-x64.exe` (`129.34 MB`), todos com `resources/migrations` verificados. Assinatura digital ignorada (`no code signing certificate configured`). |
| **4. Execução Isolada em Ambiente Limpo e Simultânea** | **BLOCKED** | Pendente de instalação e execução manual dos `.exe` gerados em máquina/VM Windows limpa (sem Node.js e sem o monorepo) e teste de execução simultânea. |
| **5. Recursos Essenciais, IPC, Bancos Isolados e Fallback RF-07** | **PASS** (escopo automatizado) | `orchestrator-app.test.ts` (3/3), `aethera-app.test.ts` (3/3), `void-app.test.ts` (3/3), `contracts.test.ts` (6/6), `typecheck` e `build:all-apps` passaram. Recursos externos reais (OAuth YouTube/Google/Spotify, Azure DevOps, VoiceStudio, FFmpeg e render GUI WebGL) dependem de credenciais/binários externos do usuário. |
| **6. Desacoplamento de Caminhos de Desenvolvimento e `apps/desktop`** | **PASS** | `0` imports de `apps/desktop` nos 3 novos apps (SEP-10). `resolveMigrationsFolder()` prioriza `process.resourcesPath/migrations` (empacotado via `extraResources` no `electron-builder.yml`). |

---

## 2. Problemas Encontrados e Corrigidos Durante a Auditoria

1. **Segredo de pareamento em texto claro (`packages/integration-contracts/src/pairing-manager.ts`):**
   - *Risco:* `tokenSecret` era serializado em texto claro em `ecosystem-pairings.json`.
   - *Correção:* integrado `secretCipher` com `safeStorage` do Electron nos 3 apps e redação obrigatória (`tokenSecretRedacted: true`) quando sem cifragem.
2. **Empacotamento sem `asarUnpack` e `extraResources` (`apps/*/electron-builder.yml`):**
   - *Risco:* `better-sqlite3`, `@modelcontextprotocol/sdk`, `remotion` e `packages/database/migrations` falhariam em executáveis instalados fora do monorepo.
   - *Correção:* adicionados `asarUnpack`, `extraResources` para `migrations`, `icon.ico` local por app, `requestedExecutionLevel: asInvoker` e `deleteAppDataOnUninstall: false`.
3. **Resolução de `migrations` em produção (`apps/*/src/main/index.ts`):**
   - *Risco:* `resolveMigrationsFolder()` não checava `process.resourcesPath/migrations`.
   - *Correção:* `join(process.resourcesPath, 'migrations')` adicionado como primeira prioridade.
4. **Manifesto de rollback sobrescrito em execução idempotente (`packages/integration-contracts/src/migration.ts`):**
   - *Risco:* segunda execução idempotente sobrescrevia `createdTargetFiles` no `backup-manifest.json`.
   - *Correção:* preservação do manifesto existente e escrita atômica com arquivo temporário + `renameSync`.

---

## 3. Pendências Obrigatórias Antes da Liberação (Release Gate)

1. Executar em máquina/CI com acesso à rede ou cache Electron/NSIS:
   - `npm run dist:win:orchestrator`
   - `npm run dist:win:aethera`
   - `npm run dist:win:void`
2. Instalar cada `.exe` gerado em VM/ambiente Windows limpo (sem Node.js e sem `C:\dev\neuralbridge-studio`) e validar:
   - Inicialização individual de cada app sem os outros dois instalados.
   - Execução simultânea dos três apps lado a lado e pareamento opcional SEP-06.
   - Desinstalação de um app preservando `userData` dos demais (`deleteAppDataOnUninstall: false`).
3. Validar manualmente com credenciais reais OAuth (YouTube, Google, Spotify, Azure DevOps) e GPU/WebGL (`Brain 3D` / `Galaxy` / Remotion).
