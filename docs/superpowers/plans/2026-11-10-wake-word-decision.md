# Wake Word Decision and Migration Plan

> **For agentic workers:** This is a decision gate, not authorization to change the wake word.

**Goal:** Decide whether the functional wake word remains `Neura` or changes to `Void`, then migrate it without breaking existing voice behavior.

**Current decision state:** The user confirmed `Void` as the primary wake word, with configurable temporary `Neura` alias. The migration is implemented additively; details and rollback are in `docs/architecture/wake-word-void.md`.

**Architecture:** Keep the technical extension id and package identifiers unchanged. The selected phrase is a versioned user preference; recognition, acknowledgement, prompts, tests and accessibility copy must use the same normalized setting. A compatibility alias is opt-in and time-bounded if the user chooses migration support.

**Spec:** `docs/plans/phase-50-rebrand-migration.md`; current voice contracts in `packages/shared/src/voice.ts`, `packages/shared/src/neura.ts` and `apps/desktop/src/main/neura-*`.

## Decision required

- [ ] Keep `Neura` as the only wake word.
- [x] Change the default to `Void` and retain `Neura` as a temporary, configurable compatibility alias.
- [ ] Change the default to `Void` and remove `Neura` after an explicit migration window.

## Review Focus

- False positives and language normalization — test exact activation boundaries.
- Existing preferences — preserve and migrate explicitly.
- Voice acknowledgements and HUD labels — keep visible identity consistent without changing internal IDs.
- Disabled microphone/permission states — do not start listening unexpectedly.
- Upgrade/rollback — old app must remain usable with the preserved preference.

### Task 1: Decision evidence — **implemented**

- [x] Inventory the recognition boundary and preserve internal Neura identifiers and compatibility tests.
- [ ] Measure the current behavior with the real local provider where available; this machine has no provider smoke run.
- [x] Record the selected option and rollback in `docs/architecture/wake-word-void.md`.

### Task 2: Approved migration — **implemented**

- [x] Add additive preferences and normalize the selected phrase in the VoiceGateway.
- [x] Update focused tests for Void, aliases, rejection and intent parsing.
- [x] Run typecheck, lint, affected Vitest and `git diff --check`; real-provider voice E2E remains an environment gate.

