# Companion Mobile MOB-01–03 Implementation Plan

> **For agentic workers:** Implement only after the mobile scope and release authorization are approved.

**Goal:** Deliver a private, paired Companion Mobile client that remains useful while the desktop window is closed, without creating a second executor.

**Architecture:** A new mobile client consumes the versioned Singularity Core API through the existing private endpoint and Tailscale boundary. It owns presentation, local session state and push registration; the Core owns tasks, approvals, memory/RAG operations and execution. No direct SQLite, agent CLI, MCP process or desktop IPC access is allowed.

**Tech Stack:** React Native + Expo with development builds, Android first and iOS later (new app only after implementation authorization), existing `packages/shared/src/core-api`, pairing tokens/DPoP, WebSocket/SSE, platform push providers.

**Current decision state:** The user confirmed this stack, metadata-only push, optional voice/RAG through Core services, and internal distribution. MOB-01 is authorized and its additive scaffold is implemented; push provider, background delivery and production distribution remain deferred to MOB-02/MOB-03 gates.

**Spec:** `docs/plans/singularity-master-plan.md` §11.8–11.9; `docs/architecture/core-02-api-contracts.md`, `core-07-auth-remote.md`, `core-08-standalone.md`.

## Global Constraints

- Mobile is opt-in and private; no Tailscale Funnel or public endpoint.
- Pairing, scoped access, revocation, refresh-token rotation and stream closure use the existing Core contracts.
- No fake task, memory, approval or metric data in production UI.
- Preserve desktop behavior and keep all execution in the Core.
- Distribution and store credentials are out of scope until release approval.

## Review Focus

- Offline/reconnect and expired tokens — show stale state and re-authenticate without replaying commands.
- Revocation while a stream is open — close it and remove local access immediately.
- Project scope/IDOR — verify every read and write is authorized by the Core.
- Push privacy — notifications contain no secret prompt, memory content or token.
- App absence/old API version — fail closed with an actionable compatibility message.

### Task 1: Mobile contract and threat model — **implemented for MOB-01**

**Files:**
- Create: `docs/architecture/mobile-threat-model.md`
- Test: contract fixtures in `packages/shared/test/core-api-*`

- [x] Freeze the first subset around pairing, tokens and task read/create/cancel routes; commands stay in the Core.
- [x] Define endpoint, DPoP, token, scope, revocation and metadata-only push boundaries in `mobile-threat-model.md`.
- [x] Use the approved React Native + Expo, Android-first choice; the push provider remains deferred.

### Task 2: MOB-01 MVP — **implemented scaffold**

**Files:**
- Create: `apps/mobile/*` or the approved mobile workspace path.
- Modify: only shared API types when a contract gap is proven.
- Test: mobile unit tests and Core integration tests.

- [x] Implement Core client contracts, Tailscale endpoint validation, secure token storage, task list/detail/create/cancel and pairing/token helpers.
- [x] Prove all implemented commands call Core routes and no mobile code starts an executor.
- [x] Run Core contract tests, mobile client tests, mobile typecheck and lint. Device/emulator smoke remains MOB-03.

### Task 3: MOB-02 controls

- [x] Add metadata-only push validation, approval/continuation commands, refresh rotation and scoped hybrid memory search through Core routes.
- [x] Test metadata rejection, refresh rotation, idempotency headers and no mobile executor surface. Offline queue refusal is explicit because no command queue is implemented.

### Task 4: MOB-03 hardening and distribution

- [x] Define the bounded reconnect/offline policy and explicit no-queue rule; device/emulator execution remains an environment-dependent gate.
- [x] Produce the internal-distribution and rollback procedure in `mobile-release-and-rollback.md`; no release artifact or signing credential was created.
