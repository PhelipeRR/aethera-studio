# TFS/Azure DevOps Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the corporate TFS/Azure DevOps Server into NeuralBridge with a clean read-first interface for PR review, tasks, boards and sprints.

**Architecture:** The Electron main process owns the REST client, browser-session bridge and encrypted credentials. The renderer uses typed Zod IPC contracts and TanStack Query. REST is canonical; browser automation is a constrained fallback for authentication or unsupported operations. State and cache are persisted in SQLite.

**Tech Stack:** Electron 44.9.3, React 19, TypeScript 6, Zod 4, TanStack Query 5, Drizzle/SQLite, safeStorage, Playwright only for the browser fallback and E2E.

**Spec:** [docs/superpowers/specs/2026-11-04-tfs-azure-devops-integration-design.md](../specs/2026-11-04-tfs-azure-devops-integration-design.md)

## Full-stack workflow

- **Dev:** classify the connector as a full-stack integration; implement contract-first, TDD, narrow tests per task and existing Electron/IPC conventions.
- **Architecture:** keep REST, browser-session fallback, persistence and approval policy behind explicit boundaries; do not leak provider payloads into the renderer.
- **UI/UX:** use the existing desktop shell and design tokens; review the master/detail layout, empty/error states, keyboard access, responsive widths and reduced motion before implementation.
- **Final dev pass:** run typecheck, lint, targeted Vitest, fake-server E2E, secret scan and diff-check before marking a subphase complete.

## Global Constraints

- Renderer never sends credentials, arbitrary URLs, shell commands or raw HTTP requests to the main process.
- The main process validates the connection origin against an explicit HTTPS allowlist; the corporate HTTP/HTTPS choice is recorded as a security decision during the discovery spike.
- Read-only mode is the default and cannot perform writes, even when the project has full access.
- No password is persisted; PAT/token is encrypted with `safeStorage` when the user explicitly chooses token authentication.
- API payloads, PR text, task text, comments and imported templates are untrusted data and cannot become agent instructions.
- Migrations are additive; confirm the next migration number in `packages/database/drizzle` before creating one.
- No merge, push, checkout or automatic code modification is part of this integration.
- Existing project, task, memory and Git IDs remain compatible.

## Review Focus

1. HTTP Basic authentication and expired browser sessions must become a clear actionable disconnected state, never an infinite spinner. Test: Task 1 and Task 3.
2. A TFS response with missing permissions, unsupported API version or unexpected fields must be surfaced as unavailable without crashing the app. Test: Task 2.
3. Malicious PR/task/comment text must render as text and never be executed or injected into an agent prompt. Test: Task 2 and Task 6.
4. Reopening the app with an encrypted token or browser session unavailable must preserve cached read-only data and expose its age. Test: Task 4.
5. A write attempt must be denied in read-only mode and require a main-process confirmation assembled from validated data. Test: Task 7.

## File Map

- Create `packages/shared/src/azure-devops.ts`: domain contracts, enums, filters, IPC input/output schemas and redaction helpers.
- Create `packages/database/src/azure-devops-repository.ts`: encrypted connection metadata, cache records, sync cursors and audit records.
- Create migration `packages/database/drizzle/00XX_azure_devops.ts`: additive tables for connections, cached entities and sync state.
- Create `packages/orchestrator/src/integrations/azure-devops-client.ts`: REST boundary and capability detection.
- Create `packages/orchestrator/src/integrations/azure-devops-browser-session.ts`: bounded browser-session adapter; no password storage.
- Create `apps/desktop/src/main/azure-devops-ipc.ts`: main-process connection, query, sync and approval handlers.
- Modify `apps/desktop/src/preload/index.ts` and `packages/shared/src/ipc.ts`: expose typed Azure DevOps methods.
- Create `apps/desktop/src/renderer/src/features/azure-devops/`: page, query hooks, filters, PR review, boards, sprint and settings components.
- Create `apps/desktop/test/azure-devops-ipc.test.ts`, `packages/orchestrator/test/azure-devops-client.test.ts`, `packages/database/test/azure-devops-repository.test.ts` and `tests/e2e/azure-devops.spec.ts`.
- Update `docs/PLAN.md` and `docs/STATUS.md` with evidence and blockers after each subphase.

### Task 1: Read-only discovery spike and connection contract

**Files:** shared contract files, discovery tests, this plan/status docs.

- [ ] Write fixtures for the supplied TFS host shape, HTTP Basic challenge, Azure DevOps Server REST discovery, and an unsupported/unauthenticated response.
- [ ] Implement `AzureDevOpsConnectionInput`, `AzureDevOpsConnectionStatus`, `AzureDevOpsCapabilities` and redacted error schemas in `packages/shared/src/azure-devops.ts`.
- [ ] Implement a read-only capability probe that records server URL, API version, authentication challenge and supported endpoints without creating or changing remote data.
- [ ] Run targeted shared/orchestrator tests and record the actual API version and auth behavior in `docs/STATUS.md`.

### Task 2: REST client with safe payload handling

**Files:** `packages/orchestrator/src/integrations/azure-devops-client.ts`, tests and shared contracts.

- [ ] Add failing tests for projects, repositories, PR list/detail/diff/comments, work items, board columns and sprint iteration mapping.
- [ ] Implement a typed fetch boundary with timeout, cancellation, pagination, rate-limit handling, capability checks and tolerant parsing of unknown fields.
- [ ] Ensure all returned rich text is treated as display data; strip secrets from errors and never log Authorization/cookies.
- [ ] Run the client test suite, including 401, 403, 404, 429, timeout and malformed payload fixtures.

### Task 3: Browser-session fallback

**Files:** `packages/orchestrator/src/integrations/azure-devops-browser-session.ts`, main handlers and tests.

- [ ] Define the minimal browser bridge interface: attach/open authenticated tab, inspect session state, navigate only to the approved TFS origin, and return sanitized page data.
- [ ] Implement detection of the HTTP Basic dialog shown in the reference image; the Neura must ask the user to complete login in the browser and never collect or persist the password.
- [ ] Add bounded retries, cancellation and explicit states for login required, session expired, origin mismatch and unsupported operation.
- [ ] Run browser-session unit tests with a fake browser boundary; do not automate credentials.

### Task 4: Persistence, cache and sync

**Files:** next additive Drizzle migration, `packages/database/src/azure-devops-repository.ts`, repository tests.

- [ ] Confirm the next migration number, then add tables for connections, cached PRs, PR files/comments, work items, iterations, sync cursors and redacted audit events.
- [ ] Store only encrypted token material and non-secret connection metadata; browser cookies remain in the browser session.
- [ ] Implement stale-while-revalidate reads, per-entity timestamps, pagination cursors, invalidation and cancellation-safe sync checkpoints.
- [ ] Verify reopen/recovery, duplicate sync, partial sync failure and encrypted credential deletion.

### Task 5: Secure IPC/preload boundary

**Files:** `packages/shared/src/ipc.ts`, `apps/desktop/src/main/azure-devops-ipc.ts`, `apps/desktop/src/preload/index.ts`, IPC tests.

- [ ] Add typed channels for connection status, projects, PRs, PR detail, work items, boards, iterations, sync, disconnect and open-in-browser.
- [ ] Validate every input in the main process; reject arbitrary URLs, project IDs from another connection and write requests in read-only mode.
- [ ] Return sanitized domain objects only, never raw response headers, cookies, tokens or HTML.
- [ ] Run IPC tests for authorization, redaction, cancellation and stale cache behavior.

### Task 6: Clean read-only UI

**Files:** `apps/desktop/src/renderer/src/features/azure-devops/` and navigation registration.

- [ ] Add the Azure DevOps area with four tabs: Visão geral, Pull Requests, Boards e Sprint, Configuração.
- [ ] Build the list/detail review layout: filters on top, master list on the left, contextual detail on the right, readable diff, comments and related tasks.
- [ ] Implement accessible loading, empty, stale, disconnected, permission-denied and unsupported states; preserve the last selected entity on refresh.
- [ ] Add responsive/reduced-motion behavior and keyboard navigation for PR/task lists.
- [ ] Run renderer tests and an accessibility check on the main routes.

### Task 7: Confirmed write actions

**Files:** approval gate, main IPC, REST client, UI action components and tests.

- [ ] Add a main-process approval gate for comment, approve, change PR status and update work item state; the confirmation must show target, action and resulting value.
- [ ] Implement idempotency keys/checks and refresh-after-write; failure must preserve the draft and explain whether the remote action may have occurred.
- [ ] Keep all writes disabled until the user enables write access for that connection; read-only connections reject writes server-side in the main process.
- [ ] Test approve/reject, cancellation, expired session, permission denial and duplicate-click behavior.

### Task 8: E2E, hardening and release gate

**Files:** `tests/e2e/azure-devops.spec.ts`, fixtures/fake server, docs and package scripts only if required.

- [ ] Create a local fake TFS/Azure DevOps server covering discovery, PR review, sprint data, auth expiry and a confirmed write.
- [ ] Exercise connect → overview → PR → diff/comment → sprint/task → restart → cached data → reconnect.
- [ ] Assert no secret appears in renderer text, IPC payload snapshots, logs or the app data directory.
- [ ] Run targeted Vitest, Playwright, typecheck, lint and `git diff --check`; if parallel Git tests fail, rerun with `npx vitest run --no-file-parallelism`.
- [ ] Update `docs/PLAN.md` and `docs/STATUS.md` with evidence, known external blockers and the exact TFS capabilities validated.

## Definition of Done

The user can connect the corporate TFS without storing a password, browse PRs and diffs, inspect tasks/boards/sprint, recover from an expired session, and use the clean read-only UI after restart. Any enabled write action is explicitly confirmed in the main process, audited without secrets, and covered by automated tests. Existing NeuralBridge flows remain green.
