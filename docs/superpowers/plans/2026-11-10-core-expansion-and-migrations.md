# Core Expansion and Technical Migrations Plan

> **For agentic workers:** Each migration is additive, reversible and separately authorized. Do not bundle M1–M4 with feature work.

**Goal:** Move the remaining execution groups behind the Singularity Core and perform only the safe, approved parts of the NeuralBridge-to-Singularity technical migration.

**Current decision state:** M2 has a local implementation with focused evidence; M3 is implemented. M1 still requires installer-specific authorization/evidence, and each remaining implementation needs separate tests and rollback evidence. M4 remains deferred. Execution groups must be migrated individually, beginning with the lowest-risk group identified by the read-only inventory.

**Architecture:** Existing Core lease/idempotency remains the single execution boundary. Desktop modules become adapters one group at a time: workflows, Void/Neura, Velix, missions and Git automations. Technical identity migration is separate from execution migration and preserves old data paths/aliases during rollback windows.

**Tech Stack:** Existing `packages/core`, `packages/orchestrator`, `packages/shared`, Electron adapters, additive Drizzle migrations, Windows installer and `safeStorage`.

**Spec:** `docs/plans/phase-50-rebrand-migration.md`, `docs/architecture/core-04-lease-idempotency.md`, `core-05-06-task-domain.md`, `core-08-standalone.md`.

## Global Constraints

- No destructive move/delete; copy, verify and retain the old identity for rollback.
- Keep `app.setName('NeuralBridge')`, `com.neuralbridge.desktop`, MCP name `neuralbridge`, `@neuralbridge/*` and `safeStorage` until an approved migration changes them.
- No credential migration out of S0 without a separate security decision.
- One execution owner and one lease per task.
- Every migration has backup, hash/semantic verification, retry safety, rollback and second-run idempotency evidence.

## Review Focus

- Existing user data and WAL files — prove no loss with the app and MCP server open.
- SafeStorage key continuity — prove secrets remain decryptable before and after migration.
- Installer identity — prove no side-by-side install or duplicate shortcut.
- Adapter failure/restart — prove the task resumes once through Core.
- Legacy clients — prove Claude/Codex and old MCP registrations continue to work.

### Task 1: Group migration inventory

**Files:**
- Create: `docs/architecture/core-group-migration-matrix.md`
- Read: `packages/orchestrator/src/*`, `packages/core/src/*`, Electron handlers/adapters and related tests.

- [x] Inventory every execution entry point for workflows, Void/Neura, Velix, missions and Git automations.
- [x] Mark each as Core-ready, contract-gap, unsafe-to-move or explicitly desktop-only.
- [x] Define one group per migration with its lease, event, approval, cancellation and rollback proof in
  `docs/architecture/core-group-migration-matrix.md`.
- [x] Execute the dynamic read-only inventory against a test installation: `tests/e2e/core-dynamic-inventory.spec.ts`
  (chat, Void, Workflow and Mission all execute in the Core process); it found and fixed boot recovery landing on the
  desktop (`waitForCore`).

### Task 2: M1 installer identity

**Files:** `apps/desktop/electron-builder.yml`, NSIS include/script, installer tests and `docs/plans/phase-50-rebrand-migration.md`.

- [x] Implement only after migration approval; preserve `appId` and detect the existing install location
  (`productName: Singularity`, `executableName: NeuralBridge`, version 0.1.59).
- [x] Test upgrade, one installed entry, shortcuts, uninstall and rollback (0.1.58 → 0.1.59 → 0.1.58 on this machine).

### Task 3: M2 data-directory copy

**Files:** `apps/desktop/src/main/*`, `packages/shared/src/paths.ts`, MCP path resolution, additive migration/tests.

- [x] Copy `NeuralBridge` to `Singularity` only when the destination is absent; include Chromium Local State and verify hashes in staging.
- [x] Keep the source untouched, record `migrated-from.json`, and make the second launch a no-op.
- [x] Test WAL-open behavior (an open database defers the copy), disk-full rollback, safeStorage decryption and MCP
  compatibility (every process resolves the same directory; the loser of a race adopts the winner's copy).

### Task 4: M3 MCP alias / M4 decision

- [x] Register `singularity` beside `neuralbridge` for one compatibility window and test removal/rollback; see
  `docs/architecture/m3-mcp-alias.md`.
- [x] Do not implement M4 unless a separate decision proves a strong product need; documented as rejected.

### Task 5: Group adapters

- [x] Migrate the lowest-risk group, autonomous missions, using the existing Core composition, lease, idempotency and
  event bridge; see `docs/architecture/core-09-missions.md`.
- [x] Migrate Workflows as the second group: agent steps use the hybrid Core adapter with `externalRef`; native steps
  remain Desktop-owned; see `docs/architecture/core-10-workflows.md`.
- [x] Close the Git automation boundary as CORE-11: Git remains a trigger/read adapter and delegates execution to
  CORE-10 Workflows; see `docs/architecture/core-11-git-automations.md`.
- [x] Migrate the confirmed Void project-edit action through the hybrid Core adapter with a stable `externalRef`; local
  voice, UI Automation, screen, conversation, RAG and Spotify remain Desktop-owned; see `docs/architecture/core-12-void-task-adapter.md`.
- [x] Route Velix stage tasks through the hybrid adapter with an external reference scoped to the stage attempt; media,
  filesystem and approval adapters remain Desktop-owned; see `docs/architecture/core-13-velix-task-adapter.md`.
- [x] Add unit/integration/E2E evidence for duplicate prevention, restart, cancellation, approval and `NB_CORE_TASKS=main` rollback
  (`core-tasks.spec.ts`, `core-velix-tasks.spec.ts`, `core-dynamic-inventory.spec.ts`; approvals stay Desktop-owned).
- [x] Commit each group separately (the user granted full authorization on 2026-11-10).

