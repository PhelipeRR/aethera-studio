# NeuralBridge Enterprise Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform NeuralBridge from a broad advanced prototype into a focused, reliable, premium local-first platform for safe and auditable execution of Claude Code and Codex work, with Neura and Velix delivered as optional extensions.

**Architecture:** Keep the existing Electron monorepo and deepen the TaskEngine as the product's central module. The renderer consumes a smaller set of stable IPC interfaces; integrations, Neura, Velix, Git, and the Neural Brain become adapters/features around that core. No parallel orchestration engine, in-memory execution state, or destructive data migration will be introduced.

**Tech Stack:** Electron 44, React 19, TypeScript 6 strict, Vite 8, Tailwind 4, Radix/shadcn, Zustand, TanStack Query, SQLite/Drizzle, Zod, Vitest, Playwright, electron-builder.

**Spec:** Existing product contract in `docs/PLAN.md`, `docs/STATUS.md`, `README.md`, and `design-system/neuralbridge-intelligent-workspace/MASTER.md`; this plan is the consolidation strategy that prioritizes and sequences those existing commitments.

## Global Constraints

- Preserve project IDs, task history, memories, indexes, and physical files.
- All execution state remains persisted in SQLite; the renderer never executes shell commands.
- Read-only stages never write, even when the project has full access.
- Automations never commit, push, checkout, merge, or perform destructive Git operations.
- Imported templates, agent output, diffs, and external integration content are untrusted data.
- Migrations are additive and versioned; confirm the next migration number before creating one.
- No new runtime dependency without a measured need and an explicit decision record.
- No broad deletion before an inventory, reference scan, replacement path, and passing regression suite.
- Do not modify or discard the user's current worktree changes as part of planning or implementation setup.

## Review Focus

- Interrupted or duplicated execution must resume from the persisted snapshot without double-running a side effect.
- Database lock, corruption, disk-full, and migration failure must open a degraded recovery surface instead of a blank window.
- Provider, CLI, FFmpeg, VoiceStudio, TFS, and network failures must expose actionable state and preserve the last safe checkpoint.
- Long histories, logs, memories, graph nodes, and workflow definitions must remain usable without freezing the renderer.
- Secrets must not appear in renderer payloads, logs, memories, diffs, diagnostics, screenshots, or exported reports.

## Product decisions

### Primary product

NeuralBridge's primary promise becomes:

> Describe work once, execute it safely with the right agent, review the evidence, and resume it later with complete local auditability.

The primary daily journey is `request → plan → approval → execution → validation → evidence → learning`.

### Feature hierarchy

1. Core: Chat, TaskEngine, Projects, permissions, approvals, evidence, recovery.
2. Power tools: Neural Brain, Git Intelligence, Workflows, MCP, Analytics.
3. Integrations: Azure/TFS, YouTube, Spotify, VoiceStudio, FFmpeg.
4. Extensions: Neura and Velix, installed and updated independently from the core application.

No new top-level product area should be added until the core journey has passed the release gates in Phase 5. Neura and Velix may evolve independently as extensions, provided they only consume stable extension interfaces.

### What to freeze, isolate, or remove

- Stop treating Neura/Velix as built-in product areas; migrate them to independently installable extensions.
- Continue Neura/Velix work only behind extension contracts, with separate packaging, versioning, update channels, permissions, and acceptance suites.
- Move spikes, generated media, temporary runtime directories, debug data, and visual artifacts out of the tracked product surface; delete only after checking references and confirming they are reproducible.
- Keep migrations, historical plans, fixtures, and test snapshots unless a replacement is proven and the user explicitly approves history cleanup.
- Remove only duplicate pass-through modules, abandoned placeholders, and dead routes after static references, runtime route coverage, and test coverage prove they are unused.

## Phase 0 — Baseline and change control

**Outcome:** a reviewable baseline before consolidation changes begin.

### Task 0.1: Capture the current product baseline

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/PLAN.md`
- Create: `docs/architecture/enterprise-baseline.md`

- [x] Record current version, branch, worktree status, typecheck, lint, build, focused Vitest, E2E, distribution verification, and known environmental blockers (`docs/architecture/enterprise-baseline.md`).
- [x] Classify each active phase as `core`, `power tool`, `integration`, `extension`, `blocked external`, or `retired candidate`.
- [x] Produce an inventory of tracked, generated, temporary, and untracked artifacts without deleting anything.
- [x] Define a single release-critical test matrix for the primary journey.

### Task 0.2: Split the roadmap into product slices

**Files:**
- Create: `docs/superpowers/specs/2026-11-05-neuralbridge-enterprise-consolidation.md`
- Modify: `docs/PLAN.md`

- [x] Move the current broad roadmap into the hierarchy defined above (companion spec).
- [x] Mark new Velix/Neura capability work as frozen until the core release gates pass.
- [x] Add explicit acceptance criteria and owner module for every remaining open item.

## Phase 1 — Core execution platform

**Outcome:** the primary request-to-evidence journey is reliable and understandable.

### Task 1.1: Define the execution contract

**Files:**
- Modify: `packages/shared/src/tasks.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/orchestrator/src/engine.ts`
- Test: `packages/orchestrator/test/engine*.test.ts`

- [x] Define the minimal persisted execution snapshot: task identity, phase, attempt, checkpoint, approval, cancellation, failure category, evidence references, recovery action and correlation ID (`ExecutionSnapshot`, `TaskEngine.executionSnapshot`). Fixed (2026-11-08): approval/cancellation were never updated after insert, `attempt` stayed 0, and a paused task produced an invalid `paused` phase that the strict IPC schema rejects.
- [x] Make duplicate side-effect prevention and resume semantics explicit in the interface: contract documented on `ExecutionSnapshot`; `executionSideEffectKey`; evidence written at most once per key; `approve` ignored unless the task is awaiting approval (a stray approve could previously release a capacity wait).
- [x] Add tests for restart, duplicate event, cancellation during approval, provider timeout, missing CLI, pause and stale worker recovery (`packages/orchestrator/test/engine-execution-contract.test.ts`, 10/10).

### Task 1.2: Create a unified evidence and diagnostic model

**Files:**
- Create: `packages/shared/src/evidence.ts`
- Create: `packages/orchestrator/src/evidence-service.ts`
- Modify: `packages/database/src/schema.ts`
- Create: additive migration under `packages/database/migrations/`
- Test: shared, database, and orchestrator evidence tests

- [x] Store structured evidence rather than only free-form output: every agent step now records one evidence row (agent, step kind, files, timings, redacted output, attempt). Before, only `evidence` events were recorded and no adapter emitted them.
- [x] Add correlation IDs across task, agent attempt, IPC request, and external integration calls: `registerIpcHandler` runs each request under its own ID (`AsyncLocalStorage`, `orchestrator/src/correlation.ts`); tasks persist it (migration `0092_execution_snapshot_correlation`); evidence carries it; Azure DevOps/TFS calls send it as `X-TFS-Session`. Spotify/YouTube inherit the context but do not send a header.
- [x] Redact secrets before persistence and export: evidence uses both redactors and truncates after redaction; diagnostic reports (in-app and `diagnostics:export`) also redact `sk-`/`gh*_` credential shapes.

### Task 1.3: Finish degraded-mode recovery

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `apps/desktop/src/renderer/src/app/`
- Test: database recovery tests and Electron startup E2E

- [x] Handle database lock, corruption, disk-full, migration failure, missing CLI, and invalid configuration as explicit recoverable states: `DatabaseFailure` gains `disk-full`/`migration`; invalid `preferences.json` is copied aside before any write and reported in `app:status`; a missing CLI fails tasks as `configuration`/`manual-review` and appears as an actionable diagnostic check.
- [x] Provide backup, restore, export diagnostics, and safe retry flows: degraded-mode banner offers restore of a verified backup (unusable files moved to `db/preserved/<time>/`, never deleted), redacted diagnostics export and restart-based retry (`main/handlers/recovery.ts`, `main/database-recovery.ts`).
- [x] Ensure the app never opens as a blank window after a startup exception: `startup-guard.ts` replaces a failed or crashed renderer with a static recovery page plus retry, shows a window whose renderer never became ready, and a failure after `whenReady` still opens the main window.

## Phase 2 — Architecture consolidation

**Outcome:** fewer shallow interfaces, clearer seams, and lower maintenance cost.

### Task 2.1: Establish application services around deep modules

**Files:**
- Create or split focused modules under `packages/orchestrator/src/application/`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `packages/shared/src/ipc.ts`
- Test: service contract tests and IPC contract tests

- [x] Extract orchestration, approvals, evidence, recovery, and diagnostics from the Electron entrypoint: task lifecycle/approval/cancellation, Agent Swarm, agent status and token analytics moved to `main/handlers/tasks.ts` (Swarm orchestration is now `orchestrator/src/application/swarm-service.ts`); recovery to `main/handlers/recovery.ts` + `main/database-recovery.ts`; diagnostics export to `main/diagnostics-export.ts`; evidence lives in `orchestrator/src/evidence-service.ts`.
- [x] Keep the main process as composition root, not the implementation of every feature: the extracted groups receive their dependencies from `main/index.ts`, which only wires them. The remaining large groups (Velix `video`, Neura, Azure DevOps handlers) stay in place for later bounded slices; Velix/Neura feature work is frozen by this plan.
- [x] Expose small interfaces with injected adapters for database, agents, filesystem, clock, and external integrations: `application/ports.ts` (`Clock`, `TaskPort`, `DesktopShellPort`); `TaskEngine` and the evidence service accept a `Clock`; handler groups take nullable services (database), agent detectors, shell and analytics adapters. Contract tests: `tasks-ipc`, `swarm-service`, `diagnostics-export`, plus the clock test in `engine-execution-contract`.

### Task 2.2: Audit and reduce IPC surface

**Files:**
- Modify: `packages/shared/src/ipc.ts`
- Modify: `apps/desktop/src/main/`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: renderer API modules under `apps/desktop/src/renderer/src/`
- Test: IPC allowlist, sender validation, schema rejection, and capability tests

- [x] Group IPC by product capability instead of individual UI click handlers: `shared/src/ipc-capabilities.ts` maps every channel to one capability and its preload namespaces; Azure DevOps (20 methods) moved out of the Velix `video` facade into `window.neuralbridge.azureDevOps`. Enforced by `ipc-capabilities.test.ts` and `preload-capabilities.test.ts`.
- [x] Remove unused or duplicate channels only after a reference scan and E2E coverage check: the scan found 13 preload methods without a renderer/E2E consumer (listed in `docs/architecture/ipc-consumer-matrix.md`). None was removed: the deletion policy requires a replacement or a retirement decision, and most belong to frozen extensions.
- [x] Ensure no credentials or raw provider payloads cross into the renderer: `azure-devops:write:execute` returned the full TFS response; the client now normalizes it and the contract is closed. Tests fail on any credential-named output field (except the main-issued Git capability grant), on secret input outside the documented entry channels, and on loosely typed output not documented as app-owned data.

### Task 2.3: Define ownership for integrations

**Files:**
- Modify: `packages/orchestrator/src/integrations/`
- Modify: `packages/workspace/src/`
- Modify: `packages/agents/src/`
- Create: `docs/architecture/integration-ownership.md`

- [x] Assign each external system one adapter, one credential owner, one retry policy, one redaction policy, and one test seam (`docs/architecture/integration-ownership.md`, updated with correlation and normalization rules).
- [x] Prevent feature-specific clients from reaching directly into the database or Electron APIs: `architecture-boundaries.test.ts` locks packages, provider clients, credential stores and application services (no violation existed; the test prevents regressions).
- [x] Keep fake servers and real-provider tests separate and clearly labeled: real Claude/Codex checks moved to `agents-real.spec.ts` and `mcp-real.spec.ts`; every `*-real` spec needs an explicit `NB_*=1` opt-in (`neura-voice-real` previously ran whenever VoiceStudio was up). The two Velix mixed specs are a documented exception.

### Task 2.4: Define the extension platform

**Files:**
- Create: `packages/shared/src/extensions.ts`
- Create: `packages/orchestrator/src/extensions/extension-registry.ts`
- Create: `packages/orchestrator/src/extensions/extension-installer.ts`
- Create: `packages/orchestrator/src/extensions/extension-updater.ts`
- Modify: `packages/database/src/schema.ts`
- Create: additive migration under `packages/database/migrations/`
- Modify: `apps/desktop/src/main/`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: extension contract, registry, install, update, rollback, permission, and signature tests

- [x] Define a versioned manifest with extension ID, version, minimum core version, capabilities, permissions, entrypoints, checksum, signature, and update channel.
- [x] Define the initial narrow registry/installer interface; navigation, commands, settings, TaskEngine integration, artifacts, and diagnostics remain capability identifiers for the next adapter slice.
- [x] Install/register extensions from a local `extension.json` directory into isolated `id/version` staging, with enable/disable/update/rollback state without deleting user data.
- [x] Verify package checksum, signature callback, and Core compatibility before activation; equal-version updates are rejected.
- [x] Keep extension code outside the renderer; approved `extensions:*` IPC/preload handlers expose only list/install/enable/disable/update/rollback, while the full management UI remains deferred to Task 3.1.
- [x] Persist extension manifest/state/version in SQLite migration `0090_extensions` plus index `0091_extensions_state_index`; secrets remain out of the manifest store.

## Phase 3 — UI/UX product consolidation

**Outcome:** a coherent premium desktop experience centered on work, not on a collection of modules.

### Task 3.1: Reframe navigation and information architecture

**Files:**
- Modify: `apps/desktop/src/renderer/src/app/routes.ts`
- Modify: shell/navigation components under `apps/desktop/src/renderer/src/app/`
- Create: `docs/ux/information-architecture.md`
- Test: route, keyboard navigation, and deep-link E2E

- [x] Organize navigation into `Trabalho`, `Conhecimento`, `Integrações`, and `Configurações`.
- [x] Make Chat/Execuções/Projetos the primary path; show Neura and Velix only when their extensions are installed and enabled.
- [x] Add an Extensions surface for discovery, install, update, disable, uninstall, permissions, and rollback through the existing typed IPC seam.
- [x] Preserve existing routes and deep links through the existing hash-router paths and a guarded legacy `/video` route.

### Task 3.2: Build a consistent application state language

**Files:**
- Create: shared UI primitives under `apps/desktop/src/renderer/src/components/feedback/`
- Modify: affected feature pages
- Test: visual and accessibility E2E for loading, empty, error, success, offline, and approval states

- [x] Standardize status banners, progress, inline errors, retry actions, approval cards, and degraded-mode notices through `components/feedback/FeedbackState.tsx`; existing task/video-specific controls remain compatible.
- [x] Use semantic announcements (`role=alert`, `aria-live`) and never rely on color alone; primitive semantics are unit-tested.
- [x] Keep touch/click targets, focus rings, contrast, headings, and reduced-motion behavior consistent with the existing design system; degraded database mode now reuses `OfflineState`.

### Task 3.3: Performance and density pass

**Files:**
- Modify: Chat, Runs, Memory, Git, Workflows, Analytics, Azure/TFS, and Velix list surfaces
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Test: Playwright performance probes and visual snapshots at 800, 1024, and 1280 px

- [x] Lazy-load heavy routes and visualizations (Brain Graph, Brain 3D, Analytics and Velix).
- [x] Add the reusable virtual-list foundation and apply it to Execuções and Workflows templates; remaining collection surfaces stay explicitly pending.
- [x] Profile startup and lazy-route transitions with explicit budgets documented in `docs/performance/task-3.3-budgets.md`; renderer responsiveness remains guarded by bounded/windowed collections.

### Task 3.4: Onboarding and first-success journey

**Files:**
- Create: onboarding components under `apps/desktop/src/renderer/src/features/onboarding/`
- Modify: Dashboard, Projects, Chat, Settings
- Test: first-run and recovery E2E

- [x] Add the first-success guide from Dashboard through project selection, agent verification and first request; approval/result remain in the existing Chat journey.
- [x] Explain local-first privacy, agent availability, and permission scope in plain language.
- [x] Keep the first successful task path on Dashboard → Projects/Agents → Chat, without requiring Neura, Velix, MCP or advanced settings.

## Phase 4 — Enterprise readiness

**Outcome:** a trustworthy, supportable Windows product.

### Task 4.1: Release engineering

**Files:**
- Modify: `electron-builder.yml`
- Modify: root package scripts and release metadata
- Create: `docs/release/windows-release-checklist.md`
- Test: clean-machine packaging and distribution verification

- [x] Add signed installer/update strategy or document the explicit blocker and temporary trust model. Local artifacts remain unsigned; signing requires the distribution environment and `WIN_CSC_LINK`/`CSC_LINK`. Auto-update is not configured.
- [x] Define the install, upgrade, downgrade policy, migration-failure handling, uninstall behavior, and data-preservation matrix in `docs/release/windows-release-checklist.md`.
- [x] Produce a support bundle with redacted diagnostics and version/build metadata via `npm run diagnostics:export`.

### Task 4.4: Extension distribution and updates

**Files:**
- Create: `docs/release/extension-distribution.md`
- Modify: `packages/shared/src/extensions.ts`
- Modify: `packages/orchestrator/src/extensions/`
- Modify: Settings/Extensions UI
- Test: package verification, update, rollback, offline install, and uninstall E2E

- [x] Publish Neura and Velix as separate versioned extension packages; distribution status and compatibility matrix are documented in `docs/release/extension-distribution.md`.
- [x] Support manual local install; HTTPS registry integration is documented as disabled until publisher trust is available.
- [x] Verify checksum/signature and Core compatibility before installation and activation.
- [x] Write updates to isolated staging, validate them, retain the previous version for rollback, and leave the active version untouched on staging failure.
- [x] Keep extension updates independent from Core updates; failed updates do not prevent Core startup.
- [x] Define permission disclosure and re-approval requirements in the distribution contract.
- [x] Provide a compatibility matrix with version, minimum Core, OS, dependencies and channel.

### Task 4.2: Security and privacy review

**Files:**
- Create: `docs/security/threat-model.md`
- Modify: secret detection, redaction, permission, IPC, and export modules as findings require
- Test: secret corpus, path traversal, prompt-injection, permission escalation, and export redaction suites

- [x] Document trust boundaries and abuse cases in `docs/security/threat-model.md`.
- [x] Threat-model prompt injection, malicious repository content, unsafe agent output, credential exposure, extensions, and local database theft; harden extension directory import against symlinks.
- [x] Define a security regression gate for every release candidate.

### Task 4.3: Operational diagnostics

**Files:**
- Create: `packages/shared/src/diagnostics.ts`
- Create: `packages/orchestrator/src/diagnostics-service.ts`
- Modify: Settings and degraded-mode UI
- Test: diagnostic export and redaction tests

- [x] Add local health checks for database, migrations, disk, CLIs, agent authentication, FFmpeg, VoiceStudio, and integration credentials through `collectDiagnostics`.
- [x] Expose actionable remediation in each diagnostic check, not only raw error text.
- [x] Keep telemetry disabled; no anonymous product metrics are collected.

## Phase 5 — Validation and product release

**Outcome:** a release candidate that can be installed and used for real work.

### Task 5.1: Primary journey acceptance suite

**Files:**
- Create or consolidate `tests/e2e/primary-journey.spec.ts`
- Modify: Playwright helpers and fake-agent fixtures
- Test: clean-install, first-run, request, approval, execution, validation, evidence, cancel, restart, and recovery

- [x] Run the journey against the packaged Electron application, not only the development renderer (`dist/win-unpacked`, see STATUS 2026-11-05).
- [x] Repeat interrupted and failed scenarios across three runs.
- [x] Require evidence that persisted state and redaction survive restart.

### Task 5.2: Real-environment homologation

**Files:**
- Modify: `docs/STATUS.md`
- Create: `docs/release/homologation-matrix.md`

- [x] Validate supported Windows versions, clean profile, real Claude/Codex authentication, real project permissions, and real TFS read/write approval flow — executed to the extent the environment allows (2026-11-08): real CLI detection, MCP registration, AI Code Review and Smart Commit passed with real providers (Claude) in temp repositories with approval-gated writes and no commit. **Externally blocked, not code:** Codex usage limit (collaborative chat and Codex runs; resets 2026-11-09), TFS credential rejected (401) and TFS server down, no second Windows version/machine. TFS write was not attempted by user decision.
- [x] Record external blockers separately from code failures (`docs/release/homologation-matrix.md`, "Real-environment run — 2026-11-08"). One code defect found by the real TFS check — probe reported `connected` while every endpoint returned 401 — was fixed with tests.
- [x] Do not mark an integration complete from a fake-server test alone: Azure DevOps/TFS stays **not homologated** (only fake-server and 401 evidence); real-provider tests are labeled `*-real` and opt-in (Task 2.3 test).

### Task 5.3: Release gate and roadmap reset

**Files:**
- Modify: `docs/PLAN.md`
- Modify: `docs/STATUS.md`
- Modify: `README.md`

- [x] Define the release as `core stable`, `power tools stable`, `integrations experimental`, or `extensions experimental`; the 0.1.58 decision records the additional `blocked external` and `retired candidate` classifications.
- [x] Rewrite the next roadmap around measured product outcomes in `docs/release/0.1.58-release-decision.md`; archival of historical phase text remains conservative because the worktree contains shared evidence and ongoing Phase 49/Velix work.
- [x] Complete an inventory-only cleanup review; no artifact was proven obsolete enough to delete or quarantine in this task.

The consolidation plan is closed as a local validation release decision. It is
not an enterprise-ready release gate: signing, updater, signed registry,
previous-version upgrade and real-environment homologation remain external
blockers documented in the release decision and STATUS.

## Execution order

1. Phase 0 before any deletion or broad refactor.
2. Phase 1 core execution and recovery.
3. Phase 2 architecture consolidation in the seams proven by Phase 1.
4. Phase 3 UI/UX and performance around the stable core.
5. Phase 4 enterprise readiness.
6. Phase 5 packaged validation and release decision.

Neura and Velix may receive feature work during Phases 1–4 only through the extension contract and isolated packaging work. Azure/TFS and other integrations remain subject to the core release gates. New extension capabilities must attach to the core execution/evidence model without importing extension-specific assumptions into the core.

## Deletion policy

Deletion is allowed only when all conditions hold:

1. The item is classified as generated, temporary, duplicate, dead, or superseded.
2. `rg` and route/build/reference scans show no live consumer.
3. A replacement exists or the behavior is intentionally retired in `docs/PLAN.md`.
4. Relevant tests pass without the item.
5. The deletion is reversible through Git and does not remove user data, migrations, memories, or history.

The first likely cleanup candidates are temporary runtime/debug directories and generated artifacts. The last candidates are migrations, snapshots, historical plans, fixtures, and compatibility code.

## Self-review

- Product scope is covered by the core/power/integration/extension hierarchy.
- UI/UX has dedicated navigation, state language, performance, accessibility, and onboarding tasks.
- Code has dedicated execution, evidence, recovery, IPC, adapter, and diagnostics tasks.
- Deletion is explicitly gated and cannot erase user data or historical migrations.
- Every phase has a testable outcome and a release-facing acceptance path.
