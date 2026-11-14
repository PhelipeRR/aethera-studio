# Velix Production Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted global Claude/Codex choice that is captured on each new Velix production and remains stable across restart, pause, and resume.

**Architecture:** Store the global default in the existing validated desktop preferences file. Add a nullable provider column to `velix_production_runs`; new rows receive the current preference, while legacy `NULL` rows resolve to deterministic `claude` without mutating history. The existing `videoProductionRunRender` path remains unchanged and reads the run's provider only through the production's agent-stage inputs where applicable; no failover is introduced.

**Tech Stack:** TypeScript, Electron IPC/preload, React, Drizzle SQLite migrations, Vitest.

**Spec:** User requirements in the active conversation (option 3, items 1–10).

## Global Constraints

- The global selector is persisted in the Velix settings.
- A production captures the selected provider at creation time.
- Existing, paused, resumed, and legacy productions keep/use their recorded or deterministic fallback provider.
- Claude/Codex failures do not switch providers automatically in this change.
- Video style selection remains independent.
- No unrelated functionality changes and no regression to `videoProductionRunRender`.

## Review Focus

- Changing the global setting must not alter an existing run — repository test covers captured provider.
- Restart/resume must use the recorded provider — service/IPC test covers the run row after reload.
- Legacy rows with `NULL` provider must resolve to `claude` deterministically — migration/repository test covers fallback.
- Invalid provider values must be rejected at the settings and IPC boundaries — schema test covers validation.
- Style persistence must remain untouched — existing style tests and production render regression remain in the targeted suite.

### Task 1: Shared provider contract and global settings

**Files:**
- Modify: `apps/desktop/src/main/preferences.ts`
- Modify: `packages/shared/src/channels.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: relevant Velix settings component in `apps/desktop/src/renderer/src/features/video/`
- Test: `packages/shared/test/ipc.test.ts` and the existing settings/UI test location

- [x] Add `velixAgent: z.enum(['claude', 'codex']).default('claude')` to validated preferences and expose a typed get/save IPC contract.
- [x] Add a compact selector to the existing limiter card, with accessible labels and copy that states it affects new productions only.
- [x] Add tests for default and persistence; IPC schemas continue to reject invalid values through the enum boundary.

### Task 2: Persist the provider on production runs

**Files:**
- Create: `packages/database/migrations/0086_velix_production_agent.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/velix-production-repository.ts`
- Test: `packages/database/test/velix-production-repository.test.ts` or the closest existing production repository suite

- [x] Add nullable `agent`/provider column to `velix_production_runs` with an additive migration.
- [x] Extend `createRun` to accept `agent: 'claude' | 'codex'` and add `effectiveAgent`/equivalent deterministic fallback for legacy `NULL` rows (`claude`).
- [x] Ensure the row and view expose the provider without changing style fields or render contracts.
- [x] Test new rows, legacy rows, and database reopen.

### Task 3: Capture and reuse the provider in IPC and production stages

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts` if contract exposure requires it
- Modify: `packages/shared/src/channels.ts` and `packages/shared/src/ipc.ts` as needed
- Modify: `apps/desktop/src/renderer/src/features/video/ProductionRuns.tsx`
- Test: `packages/orchestrator/test/velix-production.test.ts` and the focused desktop/E2E production test

- [x] Read the global preference only when handling `videoProductionRunCreate` and pass it to repository creation.
- [x] Make script/research agent selection resolve from the run's recorded provider; no failover was added.
- [x] Keep the existing optional stage input contract for future per-production selection, while the current production path always uses the recorded provider.
- [x] Verify restart persistence and keep style selection/render contracts independent.

### Task 4: Verification and status evidence

**Files:**
- Modify: `docs/PLAN.md`
- Modify: `docs/STATUS.md`

- [x] Run focused shared/database/orchestrator/desktop tests, typecheck, lint for touched files, and `git diff --check`.
- [x] Run the narrow E2E production flow that covers create/restart/resume and the existing style/render regression.
- [x] Record commands, results, fallback policy, and any environmental blockers in the phase status.

