# SEP-10 — Desacoplamento Definitivo e Estabilização da Estrutura

**Data:** 2026-11-13  
**Escopo:** `packages/desktop-shared`, `apps/orchestrator-desktop`, `apps/aethera-desktop`, `apps/void-desktop`, `apps/desktop`

## 1. Problema Identificado na Auditoria

Embora os três aplicativos independentes já tivessem seus próprios entrypoints, bancos SQLite e `userData` isolados (SEP-03..SEP-09), eles ainda dependiam diretamente de caminhos relativos dentro de `apps/desktop` para:
- Camada de preload (`../../../desktop/src/preload/index.js`)
- UI React e aliases `@/*` (`../../apps/desktop/src/renderer/src/*`)
- Hardening, IPC e utilitários main (`../../../desktop/src/main/*`)
- Ícones e `buildResources` (`../desktop/build/icon.ico`)

## 2. Árvore Antes vs. Depois

### Antes
```text
apps/
  desktop/                  # Monolito + fonte direta importada pelos 3 novos apps
  orchestrator-desktop/     # Importava ../../../desktop/src/* e ../desktop/build/*
  aethera-desktop/          # Importava ../../../desktop/src/* e ../desktop/build/*
  void-desktop/             # Importava ../../../desktop/src/* e ../desktop/build/*
```

### Depois
```text
packages/
  desktop-shared/           # Pacote compartilhado de runtime/UI/preload/security Electron
    src/{main,preload,renderer}
apps/
  desktop/                  # Monolito preservado operacional durante a transição
  orchestrator-desktop/     # 0 imports de apps/desktop; build/icon.ico próprio; asarUnpack/extraResources
  aethera-desktop/          # 0 imports de apps/desktop; build/icon.ico próprio; asarUnpack/extraResources
  void-desktop/             # 0 imports de apps/desktop; build/icon.ico próprio; asarUnpack/extraResources
```

## 3. Mudanças Executadas

1. **Criação de `packages/desktop-shared/` (`@neuralbridge/desktop-shared`):**
   - Consolidados os módulos compartilhados `src/main`, `src/preload` e `src/renderer` para uso em build-time pelos aplicativos Electron separados sem acoplamento a `apps/desktop`.
2. **Desacoplamento completo dos 3 aplicativos:**
   - Atualizados `tsconfig.web.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/main/{orchestrator,aethera,void}-ipc.ts`, `src/preload/index.ts` e `apps/orchestrator-desktop/src/renderer/src/main.tsx`.
   - Adicionados `apps/{orchestrator,aethera,void}-desktop/build/icon.ico` próprios.
   - Verificação estática em `apps/{orchestrator,aethera,void}-desktop/{src,electron*,tsconfig*}`: **`0` referências remanescentes a `apps/desktop`**.
3. **Configuração de empacotamento independente (`electron-builder.yml`):**
   - Adicionados `asarUnpack` (módulos nativos `better-sqlite3`, `@modelcontextprotocol/sdk`, `ws`, `remotion`, `@remotion`, `cross-spawn`, `execa`), `extraResources` (`packages/database/migrations` -> `migrations`), `requestedExecutionLevel: asInvoker` e `deleteAppDataOnUninstall: false`.
   - `resolveMigrationsFolder()` atualizado nos 3 apps para priorizar `join(process.resourcesPath, 'migrations')` antes de qualquer caminho de desenvolvimento.

## 4. Auditoria de `C:\dev` (Pastas Externas ao Repositório)

Foram listadas as pastas em `C:\dev` (`ace-step-1.5`, `ace-step-models`, `aethera-reference-media`, `keycloak-profissionais`, `neuralbridge`, `neuralbridge-backups`, `neuralbridge-studio`, `neuralbridge-studio-data`, `setup-ia`, `_backups`).  
**Regra aplicada:** nenhuma pasta externa a `C:\dev\neuralbridge-studio` foi alterada ou removida sem autorização explícita, preservando integralmente backups e dados de produção/referência.

## 5. Evidências de Verificação

- `npx eslint` (contratos + testes + `src/` e `test/` dos 3 apps): **PASS** (`0` erros).
- `npx vitest run` (`6` arquivos de teste, `20/20` testes): **PASS**.
- `npm run typecheck` (todos os pacotes + 4 apps): **PASS**.
- `npm run build:all-apps` (`desktop`, `orchestrator-desktop`, `aethera-desktop`, `void-desktop`): **PASS**.
