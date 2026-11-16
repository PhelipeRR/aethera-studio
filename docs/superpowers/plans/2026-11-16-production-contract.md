# Aethera Studio Production Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform each Aethera audiovisual briefing into a versioned, persisted, evidence-backed Production Contract that survives every pipeline stage and exposes honest compliance status.

**Architecture:** Add pure contract types, extraction, synchronization, revision, evidence and compliance functions to `packages/cinema`. Attach the contract snapshot/history to `StagedProductionJob` and `CinemaProductionPackage`, pass only relevant contract requirements to existing research/script/media/render adapters, and render a compliance view from persisted job state. Do not create a second production engine.

**Tech Stack:** TypeScript, Zod where existing shared contracts use it, Vitest, React/TypeScript renderer, Electron IPC, existing Aethera/Cinema pipeline, FFmpeg/FFprobe measurements.

**Spec:** `docs/superpowers/specs/2026-11-16-production-contract-design.md`

## Global Constraints

- Preserve existing jobs and workflows; contract fields are additive and old jobs are upgraded on load/resume.
- Never discard the original briefing or overwrite a manual control silently.
- Do not simulate research, acquisition, vision validation or render output.
- Reuse `PromptInterpretation`, editorial audit, decupagem, media coverage, QC, invalidation and recovery services.
- A subjective score is evidence, not an absolute guarantee; unresolved subjective requirements remain reviewable.
- Recovery must be finite and must preserve approved artifacts.
- The contract belongs to each execution/job; revisions are immutable snapshots in a current-plus-history record.
- The main process is the only contract writer; late stage results are scoped to their producing revision and cannot satisfy a newer revision.
- Existing jobs are lazily upgraded on load/resume without losing checkpoints.
- Only files changed by this feature may be staged in commits; unrelated dirty files remain untouched.

## Review Focus

- A prompt containing `Duração: 10 minutos` must not reset a user-edited duration on a later prompt edit; test this in `prompt-editor-model` and renderer behavior.
- `35%` UI humor must conflict with a briefing requesting `15%–20%`, not disappear or be silently reconciled; test contract conflicts.
- A ranking requesting five items must remain five through research, script and decupagem; test an underfilled dossier as blocking/pending.
- Jobs saved before the contract exists must resume with a valid first contract revision and retain all previous checkpoints.
- A rejected media item must stop or recover with a finite recorded attempt, never become satisfied without evidence.

---

### Task 1: Production Contract domain model and extraction

**Files:**
- Create: `packages/cinema/src/production-contract.ts`
- Modify: `packages/cinema/src/index.ts`
- Test: `packages/cinema/test/production-contract.test.ts`

**Interfaces:**
- Consumes: `PromptInterpretation`, `DeliveryFormat`, `RenderQualityProfile`, existing prompt parser and control values.
- Produces: `ProductionContract`, `ContractRequirement`, `ContractEvidence`, `ContractConflict`, `extractProductionContract`, `synchronizeProductionContract`, `reviseProductionContract`, `evaluateContractCompliance`, and a compact `contractContextForAgent`.

- [ ] **Step 1: Write failing unit tests** for extracting a long Portuguese briefing into requirements for genre, topic, duration, language, resolution, humor, ranking structure, research sources, narration, editing, SFX, VFX, music, mix and QC; assert original prompt/hash are preserved and requirements have stable IDs.
- [ ] **Step 2: Run** `npx vitest run packages/cinema/test/production-contract.test.ts` and confirm failure is caused by missing contract exports.
- [ ] **Step 3: Implement** serializable types and pure extraction. Reuse `interpretProductionPrompt`; parse only explicit patterns for objective values and create `needs_human_review`/preference requirements for subjective instructions. Keep unknown text as an explicit `unparsed_instruction` requirement rather than dropping it.
- [ ] **Step 3a: Lock lifecycle behavior** in the model: stable requirement IDs for unchanged intent, new content versions for changed dependencies, immutable revision snapshots, revision-scoped evidence and finite recovery budgets.
- [ ] **Step 4: Add failing tests** for manual synchronization, conflict creation, revision numbering, unchanged requirement reuse, and objective compliance (duration, resolution, chapter count, loudness, export parameters).
- [ ] **Step 5: Run** the focused test file and confirm the new failures are expected.
- [ ] **Step 6: Implement** synchronization with a per-field manual override record, revision history, dependency-aware invalidation, finite recovery state, and compliance evaluation that distinguishes satisfied/adapted/pending/human-review/not-met/blocked.
- [ ] **Step 7: Run** the focused contract tests and the existing cinema editorial/QC tests.
- [ ] **Step 8: Commit** only `packages/cinema/src/production-contract.ts`, `packages/cinema/src/index.ts`, and `packages/cinema/test/production-contract.test.ts` with `feat: add versioned production contract domain`.

### Task 2: Persist and propagate the contract through staged production

**Files:**
- Modify: `apps/aethera-desktop/src/main/cinema-pipeline.ts`
- Modify: `apps/aethera-desktop/src/main/aethera-ipc.ts`
- Modify: `packages/cinema/src/index.ts` or the package type that defines `CinemaProductionPackage`
- Test: `apps/aethera-desktop/test/production-contract-pipeline.test.ts`
- Test: `apps/aethera-desktop/test/staged-pipeline.test.ts`

**Interfaces:**
- Consumes: Task 1 contract functions and existing staged job checkpoints/adapters.
- Produces: `StagedProductionJob.contract`, `contractHistory`, contract-aware agent input, contract evidence after each relevant stage, and package/render metadata containing the active contract revision.

- [ ] **Step 1: Write failing integration tests** that start a staged pipeline with deterministic real adapters, assert contract persistence at prompt/interpretation/research/script/decupagem/media/render stages, and assert an old job without contract is upgraded without losing checkpoints.
- [ ] **Step 2: Run** `npx vitest run apps/aethera-desktop/test/production-contract-pipeline.test.ts apps/aethera-desktop/test/staged-pipeline.test.ts` and confirm failure because the job/package has no contract.
- [ ] **Step 3: Implement** additive job fields, contract creation/upgrading, and a helper that appends evidence to the persisted contract after each stage. Save before and after external calls so a crash cannot erase the last known contract state.
- [ ] **Step 4: Add failing tests** proving research/script agents receive a sanitized contract context containing only relevant requirements and that provider fallback still works when one provider is unavailable.
- [ ] **Step 5: Run** the focused integration tests and confirm the expected propagation failures.
- [ ] **Step 6: Implement** contract context propagation to research and script prompts, provider/media context metadata, scene/audit linkage, package construction, render invocation, and QC evidence. Do not add a new coordinator or fake artifact.
- [ ] **Step 7: Add failing tests** for finite media recovery: repeated identical rejection signatures stop after the configured budget and leave a pending/human-review requirement.
- [ ] **Step 8: Implement** contract recovery bookkeeping around existing alternate-query/graphic-recovery/pending-media behavior, preserving approved scenes and recording the next action.
- [ ] **Step 9: Run** the focused integration suite, existing staged pipeline tests, and `npx tsc -p packages/cinema && npx tsc -p apps/aethera-desktop`.
- [ ] **Step 10: Commit** only the staged pipeline/package/test files with `feat: propagate production contract through cinema pipeline`.

### Task 3: Control synchronization and conflicts in the production UI

**Files:**
- Modify: `packages/desktop-shared/src/renderer/src/features/video/CinemaDirectorPanel.tsx`
- Modify: `packages/desktop-shared/src/renderer/src/features/video/prompt-editor-model.ts` only if needed for pure synchronization rules
- Create or modify: `packages/desktop-shared/src/renderer/src/features/video/production-contract-view.tsx`
- Test: `apps/aethera-desktop/test/production-contract-ui-model.test.ts`

**Interfaces:**
- Consumes: Task 1 synchronization types and persisted staged job view.
- Produces: conflict-aware form state, explicit “briefing vs. manual” resolution affordance, and a compliance data view model.

- [ ] **Step 1: Write failing pure-model tests** for prompt extraction into controls, preserving a manual duration/humor/genre override, reporting conflicts, and accepting an explicit “use briefing” or “keep manual” resolution.
- [ ] **Step 2: Run** the focused UI model test and confirm failure.
- [ ] **Step 3: Implement** the smallest pure state adapter; replace direct duration overwrite in `handlePromptChange` with conflict-aware synchronization and record manual changes before dispatch.
- [ ] **Step 4: Add failing component/model tests** for the compliance summary labels and requirement statuses.
- [ ] **Step 5: Implement** a compact compliance panel in the existing Cinema panel, reusing `EditorialAuditPanel` and `MediaCoveragePanel` data rather than duplicating their tables. Show contract revision, status counts, conflicts, blocking requirements, evidence and next actions.
- [ ] **Step 6: Add E2E coverage** in `tests/e2e/aethera-redesign.spec.ts` or a focused spec for entering a long briefing, changing duration manually, generating the run, and seeing the conflict/compliance state.
- [ ] **Step 7: Run** focused renderer tests and the relevant Playwright spec.
- [ ] **Step 8: Commit** only UI/model/test files with `feat: expose production contract compliance in cinema panel`.

### Task 4: Natural-language revision and dependency-aware reprocessing

**Files:**
- Modify: `apps/aethera-desktop/src/main/cinema-pipeline.ts`
- Modify: `apps/aethera-desktop/src/main/aethera-ipc.ts`
- Modify: `packages/cinema/src/production-contract.ts`
- Modify: `packages/desktop-shared/src/renderer/src/features/video/CinemaDirectorPanel.tsx`
- Test: `apps/aethera-desktop/test/production-contract-revision.test.ts`

**Interfaces:**
- Consumes: existing `handleRevision`, `computeIncrementalInvalidation`, `editorialRecoveryPlans`, and Task 1 revision APIs.
- Produces: a contract revision from natural-language changes with affected requirement IDs and stage invalidation.

- [ ] **Step 1: Write failing tests** for revisions such as “troque apenas o humor para 20%” and “pesquise mais cenas para o anime #3”; assert unrelated approved artifacts stay valid and only dependent stages are invalidated.
- [ ] **Step 2: Run** the focused revision test and confirm failure.
- [ ] **Step 3: Implement** revision classification using existing prompt-revision/invalidation services, attach the natural-language instruction and human decision to the contract history, and map changes to the minimal stage set.
- [ ] **Step 4: Add a failing test** that an unsupported or ambiguous revision remains pending for human review instead of being applied silently.
- [ ] **Step 5: Implement** the pending-review path and UI message; preserve the current approved prompt/package until the revision is accepted.
- [ ] **Step 6: Run** focused revision tests and existing prompt-revision/editorial invalidation tests.
- [ ] **Step 7: Commit** only revision-related files with `feat: make prompt revisions contract-aware`.

### Task 5: Full verification and documentation

**Files:**
- Modify: `docs/STATUS.md` with actual evidence and limitations
- Modify: `docs/PLAN.md` only if this requested work is explicitly adopted into the active Fase 50 plan; otherwise leave it unchanged
- Modify: `README.md` only if the user-facing workflow needs a documented entry point
- Test: existing full suites and relevant E2E specs

- [ ] **Step 1: Run** `npx vitest run --no-file-parallelism` and record failures by name; do not hide unrelated failures.
- [ ] **Step 2: Run** `npm run typecheck` and `npm run build:aethera`.
- [ ] **Step 3: Run** the focused Playwright flow with real application wiring; skip only tests explicitly marked opt-in or blocked by external provider/media dependencies, recording the reason.
- [ ] **Step 4: Inspect** `git diff`, `git status`, persisted contract JSON fixtures and generated compliance output; ensure unrelated existing changes are not staged.
- [ ] **Step 5: Update** documentation with measured capabilities and known limitations, especially subjective quality, legal rights, unavailable providers and preview-versus-master resolution.
- [ ] **Step 6: Commit** only the documentation and final test changes with `docs: document production contract verification`.
- [ ] **Step 7: Report** exact test/build results, commits, remaining pending requirements and any environmental blocks. Do not claim full acceptance unless every required verification is green and evidence shows no explicit requirement was silently dropped.

## Status de execução (2026-11-16)

Implementado pelas sessões Codex (interrompidas por limite de uso) e concluído/validado pelo Claude Code; os checkboxes acima não foram marcados durante a execução.

- Domínio (`production-contract.ts`, `director/aethera-format-catalog.ts`), propagação no `StagedCinemaPipeline`, renderer (preview/master, safe areas, validação FFprobe), IPC e UI (sincronização com conflito, painel de conformidade, seletores de direção/entrega) estão implementados.
- Correções na validação final: prévia legada (`renderProfile: draft_540p`) não sobe mais para 720p; render sem `renderTarget`/preset volta ao comportamento de prévia (master só quando pedido); placeholder procedural gerado a ≤640px (o `geq` em resolução cheia estourava timeouts); renderer passa a importar só `@neuralbridge/cinema/browser` (o barrel puxava FFmpeg/`node:util` para o navegador e o app abria em branco); `node:crypto` trocado por SHA-256 puro com saída idêntica (`ir/sha256.ts`).
- Evidência: typecheck limpo (cinema src, aethera node/web, tests); suíte Cinema+Aethera+desktop-shared 351/352 passando — a única falha (`project-isolation-and-preview` › full-length preview, timeout 60s) também falha no HEAD anterior.
- Pendente: `tests/e2e/aethera-redesign.spec.ts` valida conflito/“Manter controle”/painel de conformidade, mas falha no passo legado “Planejamento Narrativo & Storyboard” — o botão agora inicia o pipeline em etapas (mudança anterior, `a5265fe`), e a spec não foi atualizada para esse fluxo.
