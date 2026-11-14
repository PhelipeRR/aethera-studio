# Aethera Autonomous Studio — Runbook dos pré-requisitos do AS-02 (P1–P5)

Data: 2026-11-10. Status: **preparado, nada executado além de auditoria e backup.** Commits, branches, worktrees e
migrações descritos aqui exigem autorização específica do usuário, passo a passo. Nenhum passo descarta, sobrescreve
ou mistura alterações existentes.

## 0. Achados da auditoria da árvore (2026-11-10, ~20:50)

- Branch atual: `feat/neura-assistant`, `HEAD` = `f81fa6c` (release 0.1.60). Nada do trabalho abaixo está em commit.
- 26 arquivos modificados + 75 não rastreados (inclui `.impeccable/`).
- **Há uma sessão escrevendo na árvore agora**: `apps/desktop/src/renderer/src/main.tsx` e `features/aethera/*.tsx`
  mudaram entre 20:36 e 20:53, durante a própria auditoria (o diff de `main.tsx` passou de +12 para +18/−1 linhas).
  Qualquer commit antes de essa sessão terminar captura um estado intermediário. → **Pré-requisito P0 (novo).**
- **Três frentes misturadas no mesmo arquivo, por trecho (hunk)**, em 13 arquivos compartilhados (§2.3). Não é
  possível separar por arquivo; só por trecho.
- **Ordem obrigatória pelas migrações**: o `_journal.json` registra `0097_personal_agent` (Fase 51) antes de
  `0098…0107` (Content OS). Commitar o Content OS sem a 0097 deixaria um buraco na sequência do journal. → A Fase 51
  entra **antes** do Content OS.
- Versão já subiu para `0.1.63` em `package.json` e `apps/desktop/package.json` (STATUS cita builds 0.1.62); isso é
  de release, não de nenhuma frente.
- Existe outro worktree antigo (`feat/phase-34-remaining`, em pasta temporária de outra sessão). Não é tocado.
- `NB_DATA_DIR` (em `packages/shared/src/paths.ts`) permite rodar o app com pasta de dados isolada: é a base do
  ambiente exclusivo do Studio (P5), para que migrações novas nunca toquem `%APPDATA%\NeuralBridge` real.

## 1. Backup não destrutivo (feito)

Snapshot em
`C:\Users\Pheli\AppData\Local\Temp\claude\9821d6397502182a\93c98bd6-d04e-4bc5-9484-eabf0f1b72e6\scratchpad\backup-2026-11-10\`:
`HEAD.txt`, `tracked.patch` (`git diff --binary`), `untracked.tar` (75 arquivos não ignorados), `status.txt`,
`SHA256SUMS`. É temporário e de um momento em que a outra sessão ainda escrevia: **refazer no passo F1** e copiar
para fora da pasta temporária (ex.: `C:\dev\_backups\neuralbridge-2026-11-10\`). Restauração, se um dia for preciso:
`git checkout f81fa6c` num worktree limpo → `git apply --binary tracked.patch` → `tar -xf untracked.tar`.

## 2. Inventário por frente

### 2.1 Fase 51 — Void Personal Agent (só dela)
`apps/desktop/src/main/handlers/personal.ts`, `apps/desktop/src/main/personal/*` (6), `apps/desktop/src/main/security/integration-token-store.ts`,
`apps/desktop/src/renderer/src/pages/PersonalAgentPage.tsx`, `apps/desktop/test/{calendar-client,gmail-client,integration-token-store,personal-*}.test.ts` (9),
`packages/database/migrations/0097_personal_agent.sql`, `packages/database/src/personal-{automation,notification,sync}-repository.ts` + testes (3+3),
`packages/orchestrator/src/personal-*.ts` (7) + testes (7), `packages/shared/src/personal-agent.ts` + teste,
`packages/shared/src/extensions.ts` (manifesto `personal-agent`, permissões `personal.*`), `tests/e2e/personal-agent.spec.ts`,
`docs/plans/phase-51-*.md` (2), trechos da Fase 51 em `docs/PLAN.md` e `docs/STATUS.md`.

### 2.2 Content OS (só dele)
`apps/desktop/src/main/handlers/content-operating-system.ts`, `apps/desktop/src/renderer/src/features/aethera/*` (7),
`apps/desktop/test/content-operating-system-ipc.test.ts`, `packages/database/migrations/0098…0107` (10),
`packages/database/src/content-operating-system-repository.ts` + teste, `packages/orchestrator/src/content-{autonomy,project,publication}-service.ts` + testes (3+3),
`packages/shared/src/content-{brief,operating-system,script}.ts` + teste, `packages/orchestrator/src/velix-youtube-channel.ts` + teste (analytics/publicação),
`tests/e2e/aethera-content.spec.ts`, `docs/superpowers/{specs,plans}/2026-11-10-aethera-content-operating-system*.md`,
entradas do Content OS em `docs/aethera/STATUS.md`, `docs/aethera/Aethera-o-que-o-sistema-faz.pdf` (confirmar com o autor).

### 2.3 Arquivos compartilhados (separar por trecho)
| Arquivo | Fase 51 | Content OS | Outro |
|---|---|---|---|
| `apps/desktop/src/main/index.ts` | imports e composição `personal*`, sync/loop, `will-quit` | import/handler Content OS, `autonomyDecision`, repositório | — |
| `apps/desktop/src/preload/index.ts` | API `personal` | API `contentOs` | — |
| `apps/desktop/src/renderer/src/app/routes.ts` | rota `/personal-agent` | rota `/aethera` | — |
| `apps/desktop/src/renderer/src/main.tsx` | `PersonalAgentPage` | rotas `/aethera/*` (em edição agora) | — |
| `packages/database/migrations/meta/_journal.json` | entrada 97 | entradas 98–103 | — |
| `packages/database/src/schema.ts`, `src/index.ts` | tabelas/exports `personal*` | tabelas/exports `content*` | — |
| `packages/database/test/database.test.ts` | inventário de tabelas `personal*` | inventário `content*` | — |
| `packages/orchestrator/src/index.ts`, `packages/shared/src/index.ts` | exports `personal*` | exports `content*` | — |
| `packages/shared/src/channels.ts`, `ipc.ts`, `ipc-capabilities.ts` | canais `personal:*` | canais `contentOs:*` | — |

### 2.4 Infraestrutura comum e outros
- Testes: `tests/vitest.setup.ts` (fixtures Git não interativos), `vitest.config.ts`, `vitest.integration.config.ts`
  (`setupFiles`) — usado pelas duas frentes; commit próprio, primeiro.
- `apps/desktop/tsconfig.web.json` (`types: ["node"]`) — citado no STATUS do Content OS; vai com o Content OS.
- `package.json`, `apps/desktop/package.json`, `package-lock.json` (versão 0.1.63) — commit de release, por último.
- Autonomous Studio (só docs): `docs/plans/aethera-autonomous-studio.md`, este runbook, entradas AS em
  `docs/aethera/PLAN.md` e `docs/aethera/STATUS.md`.
- `.impeccable/` (cache de ferramenta de design) — **não commitar**; decidir se entra no `.gitignore`.

## 3. Sequência proposta (cada passo pede autorização própria)

| Passo | Ação | Destrutivo? | Verificação |
|---|---|---|---|
| **F0** | Confirmar com a sessão do Content OS (e da Fase 51, se ativa) que pararam de escrever; nenhum arquivo alterado nos últimos 15 min | Não | `git status` idêntico em duas leituras com 15 min de intervalo |
| **F1** | Refazer o backup (§1) e copiar para fora da pasta temporária; conferir `SHA256SUMS` | Não | `git apply --check --reverse tracked.patch` passa na árvore congelada |
| **F2** | Gerar, por frente, um patch de índice a partir do diff atual (trechos atribuídos pela tabela §2.3) e revisar cada um lendo o diff, sem tocar a árvore | Não | A soma dos patches = diff total (nenhum trecho órfão ou duplicado) |
| **C0** | Commit "test infra": `tests/vitest.setup.ts`, `vitest*.config.ts` | Commit local | Ver V1 |
| **C1** | Commit Fase 51: arquivos §2.1 + trechos Fase 51 de §2.3 (`git apply --cached` do patch revisado; nunca `git add -A`) | Commit local | V1 no commit C1 isolado |
| **C2** | Commit Content OS: arquivos §2.2 + trechos Content OS de §2.3 + `tsconfig.web.json` | Commit local | V1 no commit C2 isolado |
| **C3** | Commit docs do Autonomous Studio | Commit local | `git diff C2 C3 --stat` só em `docs/` |
| **C4** | Commit de release 0.1.63 (versões + lockfile) | Commit local | `npm ci` limpo no V1 |
| **V2** | Validação final na árvore principal (§4) | Não | Tudo verde, árvore principal sem diferenças pendentes além de `.impeccable/` |
| **W1** | Criar ambiente do Studio (§5) | Não (worktree novo) | — |

Regras: staging só por patch revisado ou caminho explícito; depois de cada commit, `git status` tem que mostrar
exatamente os trechos restantes das outras frentes (nada perdido). Se a separação de um arquivo compartilhado não
compilar sozinha (ex.: Fase 51 sem o Content OS), registrar o motivo e juntar C1+C2 num commit com corpo listando as
duas frentes — preferível a um commit que não compila. Push só com autorização separada.

## 4. Validação (P3)

- **V1 — por commit, sem tocar a árvore principal**: `git worktree add <tmp> <sha>` → `npm ci` → `npm run typecheck`
  → `npx vitest run --no-file-parallelism` → remover o worktree temporário. Prova que cada commit compila e passa
  sozinho.
- **V2 — final**: `npm run typecheck`, `npm run lint`, `npx vitest run --no-file-parallelism`,
  `npm run test:integration`, E2E `tests/e2e/aethera-content.spec.ts` e `tests/e2e/personal-agent.spec.ts`,
  `npm run build`, `git diff --check`. Falhas são investigadas, não desabilitadas.
- Linha de base registrada em `docs/aethera/STATUS.md` (execução de 2026-11-10 na árvore ainda em edição).

## 5. Ambiente exclusivo do Autonomous Studio (P5)

- Worktree próprio a partir do commit validado: `git worktree add C:\dev\neuralbridge-studio -b feat/aethera-studio <sha de C4>`.
  A árvore principal e o branch `feat/neura-assistant` continuam com as outras frentes.
- Pasta de dados isolada para rodar o app do Studio: `NB_DATA_DIR=C:\dev\neuralbridge-studio-data` (migrações novas
  do AS-02 nunca rodam no banco real em `%APPDATA%\NeuralBridge`). Opcional: copiar um banco real para essa pasta
  como fixture, nunca o contrário.
- Mídia real do cenário de referência fora do repositório: `C:\dev\aethera-reference-media\` (trailers, gameplays,
  rótulos do B-1). No repositório só entram clipes sintéticos curtos.
- Próximo número de migração (P4) confirmado no worktree: `ls packages/database/migrations` após C4 (esperado 0108).
- Regra de convivência: sessões de outras frentes não escrevem no worktree do Studio, e o Studio não escreve na
  árvore principal.

### 5.1 Estado em 2026-11-10 (criado)

- Worktree `C:/dev/neuralbridge-studio`, branch `feat/aethera-studio`, base `d62a5616`; dependências instaladas
  (`npm ci`) e binário do Electron 44.9.3 baixado pelo instalador oficial do pacote; `npm run typecheck` aprovado;
  testes de caminhos e banco `32/32`.
- Pastas criadas e vazias: `C:/dev/neuralbridge-studio-data` (dados do app) e `C:/dev/aethera-reference-media`.
- Rodar o app do Studio sempre com a pasta isolada (PowerShell, dentro do worktree):
  `$env:NB_DATA_DIR = 'C:/dev/neuralbridge-studio-data'; npm run dev -w @neuralbridge/desktop`.
  Com o override, `resolveDataDir` não executa a migração M2 nem lê `%APPDATA%`; banco, segredos e modelos ficam na
  pasta isolada (contas OAuth e preferências precisam ser configuradas de novo nela).
- Cuidado: não rodar o app do Studio e o app principal ao mesmo tempo se ambos subirem o Core/MCP na mesma porta;
  verificar antes do primeiro `npm run dev`.
