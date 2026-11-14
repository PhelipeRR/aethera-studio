# Neura General Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Neura as a local-first general desktop assistant with voice interaction, an extensible HUD, direct Spotify control, multilingual meeting suggestions, and permissioned computer automation.

**Architecture:** Extend the existing Electron Companion/HUD and TaskEngine rather than creating a parallel execution engine. Add typed shared contracts and focused adapters for voice, meeting input, language policy, Spotify, and computer actions; persist user-visible sessions, approvals, and retention decisions in SQLite. Use a local Python worker only for deterministic, high-volume processing where it reduces model-token usage without reducing quality; keep orchestration and permissions in TypeScript/Electron. The UI remains a thin renderer over validated IPC.

**Tech Stack:** Electron 44, React 19, TypeScript strict, Zod, Drizzle/SQLite, Vitest, Playwright, existing Companion/HUD and IPC patterns.

**Spec:** `docs/superpowers/specs/2026-11-02-neura-general-assistant-design.md`

## Global Constraints

- Use the architecture hybrid: official integrations first; visual computer control only as an explicit fallback.
- The first meeting release suggests responses and never sends them automatically.
- Meeting audio/transcription is opt-in, visibly indicated, bounded, and not stored as raw audio by default.
- `meetingLanguage`, `utteranceLanguage`, `userPreferredLanguage`, and confidence remain separate values.
- Spotify actions use the Spotify adapter and do not simulate clicks in the Spotify UI.
- Preserve the existing Companion/HUD contracts and use the existing TaskEngine for executable work.
- Every IPC payload is validated in the main process and every permissioned action is auditable.
- Python workers are local, versioned, bounded, observable, and accessed through a typed subprocess/loopback protocol; they never receive arbitrary executable instructions from transcripts.
- Deterministic local processing must not replace model reasoning when ambiguity or user intent is involved.
- Existing black/orange design tokens, keyboard navigation, visible focus, minimum contrast, and reduced-motion behavior remain the source of truth.
- Migration numbering starts after `0052_companion_registry.sql`; confirm the directory immediately before creating the migration.

## Review Focus

- Noisy or mixed-language meeting segments must not switch suggestion language on a single low-confidence phrase; test confidence thresholds in the language policy task.
- A meeting can expose a transcript but not audio, or audio but not a transcript; test source capability degradation in the meeting task.
- Spotify can be authenticated but have no active device; test a typed actionable error without falling back to screen control.
- The HUD must remain click-through while compact/mascot and become keyboard-accessible only when expanded; test mode transitions and focus.
- A computer action can be approved, expired, cancelled, or duplicated; test idempotency and audit records in the action broker task.

---

### Task 1: Shared Neura, voice, meeting, language, and permission contracts

**Files:**
- Create: `packages/shared/src/neura.ts`
- Create: `packages/shared/src/meeting.ts`
- Create: `packages/shared/src/voice.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/channels.ts`
- Test: `packages/shared/test/neura.test.ts`
- Test: `packages/shared/test/meeting.test.ts`

**Interfaces:**
- Produces `NeuraSession`, `NeuraIntent`, `MeetingSession`, `MeetingUtterance`, `LanguageDecision`, `Suggestion`, `SpotifyCommand`, `ComputerActionRequest`, and their Zod schemas.
- Produces IPC input/output schemas for starting/stopping voice and meetings, accepting/rejecting suggestions, Spotify commands, and pausing Neura.

- [x] **Step 1: Write failing schema tests** for valid Portuguese/English suggestions, mixed-language utterances, confidence bounds, opt-in state, action risk levels, and rejected oversized/untrusted payloads.
- [x] **Step 2: Run `npx vitest run packages/shared/test/neura.test.ts packages/shared/test/meeting.test.ts`** and verify the new contracts are absent.
- [x] **Step 3: Implement the contracts** with strict Zod objects, bounded text, explicit enums, correlation IDs, timestamps, and no raw audio fields in persisted suggestion contracts.
- [x] **Step 4: Add IPC channel names and exports**, then run the focused tests and `npm run typecheck` for `packages/shared`.

### Task 2: Persisted Neura sessions, consent, suggestions, and audit

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0053_neura_assistant.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Create: `packages/orchestrator/src/neura-registry.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Test: `packages/database/test/neura.test.ts`
- Test: `packages/orchestrator/test/neura-registry.test.ts`

**Interfaces:**
- `NeuraRegistry.startSession(input): NeuraSession`
- `NeuraRegistry.setConsent(sessionId, input): NeuraSession`
- `NeuraRegistry.recordSuggestion(input): Suggestion`
- `NeuraRegistry.recordAction(input): ActionAudit`
- `NeuraRegistry.listSuggestions(query): SuggestionPage`
- Produces durable state for later IPC and renderer consumers.

- [x] **Step 1: Write failing repository tests** for session lifecycle, consent revocation, suggestion retention, action audit, duplicate event idempotency, and deletion of derived transcript text.
- [x] **Step 2: Run the focused database/orchestrator tests** and verify the tables/registry are absent.
- [x] **Step 3: Confirm the next migration number**, add additive tables and indexes for sessions, consents, suggestions, and action audits, and update the migration journal.
- [x] **Step 4: Implement `NeuraRegistry`** behind a small interface; reuse existing database handle and timestamp/id conventions.
- [x] **Step 5: Run focused tests plus the database migration test suite.**

### Task 3: Voice Gateway and Neura orchestration seam

**Files:**
- Create: `packages/orchestrator/src/neura-voice-gateway.ts`
- Create: `packages/orchestrator/src/neura-orchestrator.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/neura-ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/types.ts`
- Test: `packages/orchestrator/test/neura-voice-gateway.test.ts`
- Test: `packages/orchestrator/test/neura-orchestrator.test.ts`
- Test: `apps/desktop/test/neura-ipc.test.ts`

**Interfaces:**
- `VoiceGateway.start(input): Promise<VoiceSession>`
- `VoiceGateway.stop(sessionId): Promise<void>`
- `VoiceGateway.onTranscript(observer): Unsubscribe`
- `NeuraOrchestrator.handleTranscript(input): Promise<NeuraResponse>`
- `NeuraOrchestrator.pauseAll(): Promise<void>`

- [x] **Step 1: Write failing tests** for wake-word gating, interruption, no-consent rejection, bounded transcript context, and typed IPC sender validation.
- [x] **Step 2: Implement provider-neutral gateway interfaces** with an initial provider adapter selected by existing project conventions; keep wake-word/provider details behind the seam.
- [x] **Step 3: Implement orchestration** that routes voice intents to Spotify, meeting suggestions, or TaskEngine-backed actions without executing arbitrary text as a command.
- [x] **Step 4: Register IPC handlers and preload methods** using existing trusted-sender and `parseIpcInput/parseIpcOutput` patterns.
- [x] **Step 5: Run focused tests and desktop typecheck.**

### Task 3A: Local Python processing worker

**Files:**
- Create: `packages/local-worker/pyproject.toml`
- Create: `packages/local-worker/src/neura_worker/__init__.py`
- Create: `packages/local-worker/src/neura_worker/protocol.py`
- Create: `packages/local-worker/src/neura_worker/audio.py`
- Create: `packages/local-worker/src/neura_worker/language.py`
- Create: `packages/local-worker/tests/test_protocol.py`
- Create: `packages/local-worker/tests/test_language.py`
- Create: `packages/orchestrator/src/local-worker-client.ts`
- Test: `packages/orchestrator/test/local-worker-client.test.ts`

**Interfaces:**
- `LocalWorkerClient.detectLanguage(input): Promise<LanguageDetection>`
- `LocalWorkerClient.filterTranscript(input): Promise<TranscriptWindow>`
- `LocalWorkerClient.summarizeWindow(input): Promise<MeetingContext>`
- Worker protocol uses newline-delimited JSON with request IDs, schema version, size limits, timeout, cancellation, and health status.

- [x] **Step 1: Write failing protocol tests** for malformed messages, oversized input, unknown operations, timeout, cancellation, and deterministic response correlation.
- [x] **Step 2: Implement the Python worker** for bounded audio/transcript preprocessing, language detection, deduplication, silence filtering, and rolling context windows; do not implement open-ended agent reasoning in Python.
- [x] **Step 3: Write failing TypeScript client tests** for process startup, health failure, restart-once behavior, and fallback to the model path when the worker is unavailable.
- [x] **Step 4: Implement the client** with a pinned interpreter/venv strategy, no global installation, sanitized environment, and bounded subprocess lifetime.
- [x] **Step 5: Benchmark representative meeting windows** and record token reduction and latency; accept the worker only if quality remains within the suggestion tests' thresholds.

### Task 4: Spotify official integration

**Files:**
- Create: `packages/orchestrator/src/integrations/spotify-adapter.ts`
- Create: `packages/shared/src/spotify.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/orchestrator/src/neura-orchestrator.ts`
- Modify: `apps/desktop/src/main/neura-ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `packages/orchestrator/test/spotify-adapter.test.ts`
- Test: `packages/shared/test/spotify.test.ts`

**Interfaces:**
- `SpotifyAdapter.status(): Promise<SpotifyStatus>`
- `SpotifyAdapter.search(input): Promise<SpotifySearchResult>`
- `SpotifyAdapter.play(input): Promise<PlaybackState>`
- `SpotifyAdapter.pause(): Promise<PlaybackState>`
- `SpotifyAdapter.next(): Promise<PlaybackState>`
- `SpotifyAdapter.setVolume(input): Promise<PlaybackState>`

- [x] **Step 1: Write failing adapter tests** for OAuth/token absence, no active device, search bounds, play/pause/next/volume mapping, and provider error normalization.
- [x] **Step 2: Implement the adapter** using official API calls, secret storage already approved by the app, and no UI automation fallback for Spotify.
- [x] **Step 3: Route voice intents to typed Spotify commands** and expose safe controls in IPC. *(Comando Spotify Neura exposto via preload e handler Electron; voz ainda aguarda o gateway.)*
- [x] **Step 4: Run focused tests and integration tests with a fake Spotify client.**

### Task 5: Meeting input, language policy, and suggestion engine

**Files:**
- Create: `packages/orchestrator/src/meeting/meeting-input.ts`
- Create: `packages/orchestrator/src/meeting/language-policy.ts`
- Create: `packages/orchestrator/src/meeting/suggestion-engine.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `apps/desktop/src/main/neura-ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `packages/orchestrator/test/meeting-input.test.ts`
- Test: `packages/orchestrator/test/language-policy.test.ts`
- Test: `packages/orchestrator/test/suggestion-engine.test.ts`

**Interfaces:**
- `MeetingInput.start(input): Promise<MeetingSession>`
- `MeetingInput.stop(sessionId): Promise<void>`
- `LanguagePolicy.decide(input): LanguageDecision`
- `SuggestionEngine.suggest(input): Promise<Suggestion>`
- Consumes `LocalWorkerClient.detectLanguage/filterTranscript/summarizeWindow` for preprocessing; the model remains responsible for question understanding and response generation.

- [x] **Step 1: Write failing tests** for predominant English, Portuguese questions inside English meetings, low-confidence mixed utterances, translation toggle, no raw-audio persistence, and Teams transcript capability degradation.
- [x] **Step 2: Implement `LanguagePolicy`** so utterance language wins only above the configured confidence threshold; otherwise meeting language wins, then user preference.
- [x] **Step 3: Implement provider-neutral meeting input** with transcript adapter capability reporting; do not claim Teams integration when only a generic audio/transcript source is available.
- [x] **Step 4: Implement suggestion generation** with source excerpt, language decision, confidence, and explicit `accept/edit/copy/speak` actions; never send to Teams automatically.
- [x] **Step 5: Run focused tests and an integration test using fake transcript events.**

### Task 6: Computer Action Broker with permissioned fallback automation

**Files:**
- Create: `packages/orchestrator/src/computer-action-broker.ts`
- Create: `packages/shared/src/computer-actions.ts`
- Modify: `packages/orchestrator/src/index.ts`
- Modify: `apps/desktop/src/main/neura-ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `packages/orchestrator/test/computer-action-broker.test.ts`
- Test: `packages/shared/test/computer-actions.test.ts`

**Interfaces:**
- `ComputerActionBroker.preview(request): ActionPreview`
- `ComputerActionBroker.request(request): PermissionRequest`
- `ComputerActionBroker.decide(input): ActionResult`
- `ComputerActionBroker.cancel(actionId): void`

- [x] **Step 1: Write failing tests** for safe automatic actions, confirmation-required actions, read-only restrictions, expiration, duplicate approvals, cancellation, and audit linkage.
- [x] **Step 2: Implement typed action classification** and approval state machine; reuse existing permission concepts where compatible instead of adding an untracked permission path.
- [x] **Step 3: Add provider-neutral execution adapters** for opening apps and typing/clicking fallback actions, with a disabled default until explicitly enabled. *(Só abrir aplicativos da allowlist. Digitar e clicar não foram implementados: ver desvios no handoff.)*
- [x] **Step 4: Integrate action events with the existing TaskEngine/Companion event stream.**
- [x] **Step 5: Run focused tests and verify no action executes without a valid decision.**

### Task 7: HUD/Companion Neura experience

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/companion/CompanionHud.tsx`
- Modify: `apps/desktop/src/renderer/src/features/companion/companion-state.ts`
- Modify: `apps/desktop/src/renderer/src/styles.css`
- Modify: `apps/desktop/src/main/companion-hud-window.ts`
- Modify: `apps/desktop/src/main/companion-ipc.ts`
- Create: `apps/desktop/src/renderer/src/features/neura/NeuraSuggestionCard.tsx`
- Create: `apps/desktop/src/renderer/src/features/neura/NeuraVoiceState.tsx`
- Create: `apps/desktop/src/renderer/src/features/neura/neura-state.ts`
- Test: `apps/desktop/test/companion-hud.test.tsx`
- Test: `tests/e2e/neura-hud.spec.ts`

**Interfaces:**
- HUD consumes typed Neura session/suggestion/action state through preload subscriptions.
- HUD emits `startVoice`, `pauseAll`, `acceptSuggestion`, `editSuggestion`, `copySuggestion`, and `requestAction` intents.

- [x] **Step 1: Write failing renderer tests** for mascot/compact/expanded behavior, meeting badge, language badge, suggestion actions, pause-all, keyboard focus, and click-through state.
- [x] **Step 2: Implement state selectors** that merge existing Companion sessions with Neura state without changing existing session semantics.
- [x] **Step 3: Implement the suggestion and voice-state cards** using the existing black/orange system, Lucide icons, visible focus, accessible labels, and reduced-motion behavior.
- [x] **Step 4: Add subscription plumbing** through the existing HUD window and IPC lifecycle.
- [x] **Step 5: Run renderer tests, build, and Playwright HUD flow.**

### Task 8: Privacy settings, provider setup, and end-to-end verification

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/settings/*` (exact settings route identified during implementation)
- Modify: `apps/desktop/src/main/preferences.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Create: `tests/e2e/neura-assistant.spec.ts`
- Create: `docs/neura-privacy.md`
- Modify: `docs/THIRD-PARTY.md`

**Interfaces:**
- Settings expose consent, retention, language preference, provider status, Spotify connection, and global pause.
- E2E uses fake providers and verifies voice → Spotify, meeting → English suggestion, and approval → audited action flows.

- [x] **Step 1: Write failing E2E tests** for first-run consent, provider unavailable state, English meeting suggestion, Spotify no-device error, and global pause.
- [x] **Step 2: Implement settings persistence and visible provider/consent status** without exposing secrets in the renderer.
- [x] **Step 3: Document retention, participant consent, provider data flow, and limitations.**
- [x] **Step 4: Run `npm run typecheck`, focused Vitest suites, `npm run build`, and `npx playwright test tests/e2e/neura-assistant.spec.ts tests/e2e/neura-hud.spec.ts`.**
- [x] **Step 5: Run lint and the narrowest full integration suite; record any environment-only blocker.**

## Execution Order

Tasks 1–2 establish contracts and persistence. Task 3 establishes the orchestration seam. Task 3A can proceed after the shared contracts and before Task 5. Tasks 4 and 5 can proceed in parallel after Task 3, while Task 6 depends on the action contracts. Task 7 depends on the IPC and state contracts from Tasks 3–6. Task 8 closes the product loop and is the release gate.

## Ownership Split

The work is split so each executor owns complete modules and their tests. Do not edit the same files concurrently. Handoffs happen only through the interfaces named in each task.

### Claude Code — isolated feature modules

Claude owns the following tasks:

- **Task 1:** shared Neura/meeting/voice/Spotify/computer-action contracts and focused schema tests.
- **Task 3A:** local Python worker, protocol, deterministic preprocessing, TypeScript client, and worker tests.
- **Task 4:** Spotify adapter and fake-provider tests. Claude may add the shared Spotify contract in Task 1, but must not change orchestration routing owned by Codex.
- **Task 5:** provider-neutral meeting input, language policy, and suggestion engine. Claude may consume `LocalWorkerClient`; it must not modify HUD components or Electron window lifecycle.

Claude's handoff artifacts:

- exported TypeScript types and Zod schemas;
- Python worker protocol and test fixtures;
- adapter interfaces with fake implementations;
- focused test commands and measured worker latency/token reduction;
- a short handoff note listing assumptions, unavailable providers, and any intentionally deferred behavior.

### Codex — architecture, integration, safety, and product surface

Codex owns the following tasks:

- **Task 2:** persistence, migration, `NeuraRegistry`, retention, and audit state.
- **Task 3:** Voice Gateway, Neura orchestrator, Electron IPC, preload bridge, and TaskEngine routing.
- **Task 6:** Computer Action Broker, permission state machine, TaskEngine/Companion event integration, and safety tests.
- **Task 7:** HUD/Companion state, suggestion cards, voice state, click-through/focus behavior, and E2E HUD flow.
- **Task 8:** settings, privacy documentation, provider status, final E2E flows, full typecheck/build/lint, and release verification.

Codex consumes Claude's exported interfaces and does not duplicate provider logic. Codex owns the final integration branch and resolves conflicts at the seam, not by changing Claude's module internals without review.

### Handoff sequence

1. Claude completes Task 1 and publishes the contract/test handoff.
2. Codex consumes Task 1 while implementing Tasks 2 and 3.
3. Claude implements Tasks 3A, 4, and 5 against the frozen contracts; only contract defects go back to Task 1.
4. Codex integrates Tasks 4–5 into Tasks 3 and 6, then implements Tasks 7–8.
5. Codex runs the final verification suite and records any environmental blockers.

**Fechamento e desvios:** `docs/superpowers/plans/2026-11-02-neura-claude-handoff.md`.

## Architecture Review Notes

- The existing Companion/HUD is the primary integration seam; deepening it with Neura state avoids a second floating-window system.
- Provider-neutral adapters are justified because voice, meeting input, Spotify, and computer control each have multiple possible providers; provider-specific behavior must stay behind those seams.
- `NeuraRegistry` owns durable state and audit locality; the renderer never becomes the source of truth.
- The TaskEngine remains the execution authority for actions that become tasks; Neura only decides intent and requests permission.

