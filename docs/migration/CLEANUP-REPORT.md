# SEP-07.5 — Relatório de Reorganização e Limpeza Segura

**Data:** 2026-11-13  
**Escopo:** `apps/orchestrator-desktop`, `apps/aethera-desktop`, `apps/void-desktop`, `packages/integration-contracts`, `tooling/migrations`

## 1. Verificação de Fronteiras e Imports Cruzados

Foi executada inspeção estática em todos os arquivos `.ts` e `.tsx` sob `apps/orchestrator-desktop/src`, `apps/aethera-desktop/src` e `apps/void-desktop/src` buscando referências cruzadas entre os três aplicativos independentes:

- **Resultado:** `0` imports cruzados entre `orchestrator-desktop`, `aethera-desktop` e `void-desktop`.
- Cada aplicativo importa apenas:
  - Seus próprios módulos (`src/main`, `src/preload`, `src/renderer`).
  - Pacotes compartilhados versionados de build/runtime (`@neuralbridge/integration-contracts`, `@neuralbridge/core`, `@neuralbridge/database`, `@neuralbridge/brain`, `@neuralbridge/orchestrator`, `@neuralbridge/shared`, etc.).
  - Camada compartilhada de UI/preload em `apps/desktop/src/{renderer,preload}` e helpers de hardening (`apps/desktop/src/main/security/*`), sem acoplamento a processos ou bancos SQLite de outros apps.

## 2. Classificação da Árvore e Preservação de Dados

| Diretório | Classificação | Ação aplicada |
|---|---|---|
| `apps/orchestrator-desktop` | App independente (SEP-03/09) | Mantido e consolidado com IPC de domínio e pareamento SEP-06 |
| `apps/aethera-desktop` | App independente (SEP-04/09) | Mantido e consolidado com IPC de domínio e pareamento SEP-06 |
| `apps/void-desktop` | App independente (SEP-05/09) | Mantido e consolidado com IPC de domínio e pareamento SEP-06 |
| `apps/desktop` | Monolito baseline | **Preservado intacto** até validação GUI/instaladores NSIS em ambiente com rede |
| `packages/integration-contracts` | Contratos, descoberta, loopback, pareamento e migração | Expandido com `pairing-manager.ts` e `migration.ts` |
| `tooling/migrations` | Ferramenta CLI de migração e rollback | Adicionado `migrate-ecosystem.mjs` |

## 3. Exclusões e Estratégia de Recuperação

- **Exclusões destrutivas realizadas:** `0` (nenhum código, dado, migration histórica ou asset de produção foi excluído).
- **Recuperação:** todo o estado anterior é rastreado por Git na branch `feat/aethera-studio`, permitindo reversão pontual sem perda de histórico.
