# Aethera P1 Audio-First Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to execute this plan task-by-task, and `test-driven-development` for every production-code change.

**Goal:** Make the Cinema renderer generate and measure the real narration before final timeline assembly, preserve the complete spoken audio and natural pauses, persist the duration audit, and prove the behavior with automated tests plus one real FFmpeg render.

**Architecture:** Keep FFmpeg as the compositor. Extend the existing narration synthesis/cache path with an explicit duration audit and an audio-first timeline decision. The renderer must use measured narration duration as a hard lower bound for the assembled timeline, never shorten the narration with `atrim`, and fail explicitly when only an unapproved procedural voice is available. Persist the audit alongside the existing render evidence so a resumed job can reuse narration without another TTS call.

**Tech Stack:** TypeScript, Vitest, FFmpeg/ffprobe, existing VoiceStudio and ElevenLabs adapters, existing Cinema/Aethera persistence contracts.

## Global Constraints

- Do not alter Scene Grounding thresholds or weaken visual evidence requirements.
- Preserve FFmpeg as the Cinema compositor and do not add a paid mandatory dependency.
- Do not silently accept procedural voice degradation; an explicit opt-in is required, otherwise rendering fails with a diagnostic technical error.
- Preserve existing workspace changes and do not overwrite parallel work. Stage only files changed by this plan; do not push or merge.
- Do not begin P2. This plan ends with a P1 evidence report and an approval request.
- Do not call the E2E production complete unless a reproducible, validated MP4 exists; a focused real render is evidence for P1, not the 60-second P6 completion.

## P0/P0.5 pending items recorded before P1

- Two `technical_blocked` media cases remain unrecovered.
- The physical MP4 files were absent from the investigated workspace; the implementation must reuse cache/local artifacts and must not redownload merely to reproduce the previous run.
- Complete resume behavior still requires a new E2E test.

## Review Focus

- Is narration measured before the final timeline and is the measured value persisted separately from the requested value?
- Can any filter graph truncate the narration or hide a shorter output behind successful FFmpeg exit status?
- Are pauses, segment boundaries, cache keys, provider identity, and failure modes observable after restart?
- Do tests prove long/short audio, cache reuse, explicit provider failures, and a real FFmpeg render without weakening existing thresholds?

---

## Task 0 — Record status and inspect local narration/media artifacts

**Files:** `docs/aethera/STATUS.md`, this plan, `.superpowers/sdd/.../progress.md`

- Record the three P0/P0.5 pending items above without claiming them resolved.
- Verify the seven Cyberpunk files are still absent/present in local cache/artifacts before any P1 validation command; do not download.
- Record the pre-existing parallel worktree changes and the decision to stage only P1 files.

## Task 1 — Specify and test the audio-first duration audit (RED → GREEN → commit)

**Files:** new focused duration-planning module under `packages/cinema/src/`, new Vitest tests under `packages/cinema/test/`

- Add failing tests for measured narration shorter and longer than the requested duration, natural pauses, timeline lower-bound behavior, and persisted adjustment reasons.
- Implement a small pure helper that returns planned duration, measured duration, final timeline duration, tolerance, and explicit adjustments without changing grounding thresholds.
- Commit the focused module and tests after the targeted suite passes.

## Task 2 — Integrate narration-first rendering and remove silent truncation (RED → GREEN → commit)

**Files:** `packages/cinema/src/render/real-renderer.ts`, `packages/cinema/src/audio/sound-director.ts`, focused renderer tests

- Add failing coverage that detects the old `Math.min`/`atrim` truncation path and rejects unapproved procedural fallback.
- Generate/cache narration, measure it with ffprobe, then build final clip/audio durations from the measured result.
- Ensure `audioTimeline` ends at the complete measured narration duration, preserve segment padding, and use only bounded filters/padding that cannot cut speech.
- Keep VoiceStudio, ElevenLabs, and existing provider selection contracts intact; expose provider/cache/error details in the duration audit.
- Commit once targeted renderer tests pass.

## Task 3 — Persist and resume the narration audit (RED → GREEN → commit)

**Files:** existing Cinema/Aethera render result and pipeline persistence contracts, focused persistence/resume tests

- Add failing tests for planned/measured/final durations, adjustments, cache hit, provider failure, and reload after process restart.
- Persist the audio-first audit and narration cache references in the existing checkpoint/render evidence path; avoid a parallel state store.
- Ensure visual corrections reuse the cached narration and do not issue another TTS request.
- Commit after the persistence and resume tests pass.

## Task 4 — Real FFmpeg evidence and verification (RED → GREEN → commit)

**Files:** focused real-render test/harness and evidence documentation only

- Add a deterministic real narration fixture/provider seam that uses the existing FFmpeg path without introducing a paid service or silently falling back to procedural speech.
- Run at least one real FFmpeg render, measure the output with ffprobe, and persist logs/audit evidence.
- Run all relevant automated suites, typecheck the changed packages, inspect the diff, and commit only P1 files.
- Report limitations, including any missing seven Cyberpunk MP4s and the unrecovered technical-blocked cases; do not start P2.

