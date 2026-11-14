# Aethera Content Operating System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implantar a fundação do Aethera como sistema de operação de conteúdo, com Workspace, canais, projetos, execuções, publicações e uma linha de produção guiada, preservando o pipeline audiovisual existente.

**Architecture:** Adicionar uma camada de produto sobre os contratos e serviços atuais de vídeo. O `ProductionRunService` continua sendo a execução técnica; novos contratos distinguem projeto, execução e publicação. A interface passa a centralizar o trabalho na página do projeto, com próxima ação única e política de autonomia por canal/projeto.

**Tech Stack:** TypeScript strict, React, React Query, Electron IPC, Zod, Drizzle/SQLite, Vitest e Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-aethera-content-operating-system-design.md`

## Current implementation status (2026-11-10, fechamento)

Tasks 1–6 estão entregues no worktree (migrações aditivas `0098`–`0107`, não commitadas). As caixas de seleção das
tarefas abaixo descrevem o roteiro original; a evidência real de cada lote (testes, typecheck, build, E2E) está em
`docs/aethera/STATUS.md`, seção "Content Operating System", e a matriz de aceite final fica no mesmo arquivo.

Pendências restantes, todas externas ou transferidas: OAuth/YouTube real depende das credenciais do usuário; geração
real depende de Claude/Codex autenticado; edição por cena e invalidação seletiva passaram para o Aethera Autonomous
Studio (AS-06/AS-08). Nenhum commit ou push foi feito.

## Global Constraints

- Preservar tabelas, IDs, canais IPC, projetos legados e o pipeline atual de produção.
- Projeto de vídeo, execução de produção e publicação são entidades diferentes.
- O Aethera coordena; agentes, modelos, provedores e motores de render são substituíveis.
- Publicação pública exige aprovação explícita na primeira versão.
- Migrações são aditivas e não criam credenciais fictícias.
- Conteúdo externo, prompts e arquivos de projeto são dados não confiáveis.
- Não desabilitar testes, remover validações, criar commit ou fazer push sem autorização.

## Review Focus

- Projeto sem canal configurado: a primeira produção deve continuar possível sem preencher configurações avançadas.
- Execução falha ou é cancelada: o projeto deve manter histórico e oferecer uma próxima ação recuperável.
- Várias execuções para o mesmo projeto: nenhuma execução posterior pode apagar ou mascarar artefatos anteriores.
- Publicação pública em modo autônomo: deve permanecer bloqueada até aprovação explícita.
- Projeto legado Velix/Aethera: deve continuar abrindo e usando o pipeline existente sem migração destrutiva.

## Task 1: Contratos de domínio do Content Operating System — CONCLUÍDA

**Files:**
- Create: `packages/shared/src/content-operating-system.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/content-operating-system.test.ts`

**Interfaces:**
- Produces `ContentChannel`, `ContentIdea`, `ContentProject`, `ProductionExecution`, `PublicationPackage`, `ContentPublication`, `AutonomyMode`, `ProjectNextAction` e schemas Zod correspondentes.
- Produces pure helpers `deriveProjectNextAction(project, executions, packages, publications)` and `isPublicPublicationApprovalRequired(mode, visibility)`.

- [ ] Write failing schema/helper tests covering valid entities, invalid autonomy values, project with no execution, failed execution recovery, and public publication approval.
- [ ] Run `npx vitest run packages/shared/test/content-operating-system.test.ts` and observe failure.
- [ ] Implement the schemas and pure state helpers without database or renderer dependencies.
- [ ] Export the contracts from `packages/shared/src/index.ts`.
- [ ] Run the focused test and `npm run typecheck` for shared.

## Task 2: Persistência aditiva para canais, projetos e publicações — CONCLUÍDA

**Files:**
- Create: `packages/database/migrations/0098_content_operating_system.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/src/content-operating-system-repository.ts`
- Modify: `packages/database/src/index.ts`
- Test: `packages/database/test/content-operating-system-repository.test.ts`

**Interfaces:**
- Consumes the shared domain contracts from Task 1.
- Produces repository methods for channel CRUD, project CRUD, execution links, publication package versioning and publication status updates.

- [ ] Write failing repository tests for creating a default channel, creating a project, adding multiple executions, preserving old package versions, and recording publication approval.
- [ ] Run the focused database test and observe failure.
- [ ] Add additive tables/columns with foreign keys and unique constraints; do not alter existing Velix tables.
- [ ] Implement repository methods with parameterized Drizzle queries and explicit version/status transitions.
- [ ] Run focused database tests and existing database tests.

## Task 3: IPC and main-process application service — CONCLUÍDA

**Files:**
- Modify: `packages/shared/src/channels.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/ipc-capabilities.ts`
- Create: `apps/desktop/src/main/content-operating-system-service.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/test/content-operating-system-ipc.test.ts`

**Interfaces:**
- Consumes repository methods from Task 2 and project/execution state from the existing video service.
- Produces `window.neuralbridge.content` methods for channels, projects, project dashboard state, next action, publication packages and approval transitions.

- [ ] Write failing IPC contract tests for list/create channel, create project, dashboard state, and rejecting public publication without approval.
- [ ] Run focused IPC tests and observe failure.
- [ ] Add typed channels, capability declarations and handlers using the existing IPC registration pattern.
- [ ] Expose the smallest stable preload API; do not expose raw database access.
- [ ] Run focused IPC tests, shared typecheck and desktop typecheck.

## Task 4: Aethera product shell and project pipeline UI — CONCLUÍDA

**Files:**
- Create: `apps/desktop/src/renderer/src/features/aethera/AetheraHomePage.tsx`
- Create: `apps/desktop/src/renderer/src/features/aethera/ChannelPage.tsx`
- Create: `apps/desktop/src/renderer/src/features/aethera/ContentProjectPage.tsx`
- Create: `apps/desktop/src/renderer/src/features/aethera/ContentPipeline.tsx`
- Create: `apps/desktop/src/renderer/src/features/aethera/content-status.ts`
- Modify: `apps/desktop/src/renderer/src/app/routes.ts`
- Modify: `apps/desktop/src/renderer/src/features/video/VelixPage.tsx`
- Test: `apps/desktop/test/aethera-content-pipeline.test.ts`
- Test: `tests/e2e/aethera-content-os.spec.ts`

**Interfaces:**
- Consumes `window.neuralbridge.content` from Task 3 and preserves existing `/video` behavior as a compatibility entry point.
- Produces a project-centered UI with one next-action button, visible stage states, approvals, versions and links into existing production tools.

- [ ] Write failing pure mapping tests for all project states and the five review-focus failure cases.
- [ ] Run focused renderer tests and observe failure.
- [ ] Implement the pipeline and project page with accessible labels, loading/error/empty states and responsive layout.
- [ ] Add Home/Channel/Project routes without removing existing video routes.
- [ ] Add E2E coverage for first-project flow, resume after failed execution, and approval gate.
- [ ] Run focused Vitest, Playwright E2E, lint and typecheck.

## Task 5: Briefing, publication package and autonomy policy — CONCLUÍDA

**Files:**
- Create: `packages/shared/src/content-brief.ts`
- Create: `packages/orchestrator/src/content-project-service.ts`
- Create: `packages/orchestrator/src/content-publication-service.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `apps/desktop/src/renderer/src/features/aethera/ContentProjectPage.tsx`
- Test: `packages/orchestrator/test/content-project-service.test.ts`
- Test: `packages/orchestrator/test/content-publication-service.test.ts`

**Interfaces:**
- Consumes project/execution/publication contracts and existing `ProductionRunService`.
- Produces structured briefing generation, package drafts (titles, description, tags, chapters, thumbnail candidates), policy checks and approval transitions.

- [ ] Write failing service tests for manual/assisted/autonomous behavior, package versioning, cost/limit rejection, and public visibility approval.
- [ ] Run focused orchestrator tests and observe failure.
- [ ] Implement services as orchestration around existing tasks; no parallel render or agent engine.
- [ ] Connect the project page to briefing and package actions with explicit approval states.
- [ ] Run focused tests, all existing orchestrator tests and typecheck.

## Task 6: Final integration, regression and documentation — CONCLUÍDA (OAuth real pendente externo)

**Files:**
- Modify: `docs/aethera/STATUS.md`
- Modify: `docs/aethera/PLAN.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/STATUS.md`
- Test: existing focused and global suites

- [ ] Run all new unit/integration tests and the existing global suite.
- [ ] Run the Aethera/video E2E suite and build the desktop application.
- [ ] Verify legacy Velix project opening, no public publication bypass, and `git diff --check`.
- [ ] Record OAuth/YouTube external validation separately from automated approvals.
- [ ] Update plan/status with evidence and leave the repository uncommitted.

