# P3 — Smart Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render verified word-timed smart captions over the real Audio-First narration through the existing FFmpeg compositor, with cacheable scene-local rerenders and a reproducible MP4 acceptance artifact.

**Architecture:** Add a pure caption compiler that normalizes measured narration words, groups them into short cues, assigns safe-area styles and highlighted keywords, and serializes deterministic ASS. Extend the real renderer to derive captions from the timeline's caption clips, cache the ASS artifact with the scene fingerprint, and burn it with FFmpeg after scene composition. Keep the current drawtext path only for legacy subtitle clips without word timings.

**Tech Stack:** TypeScript, Vitest, Node filesystem/crypto, FFmpeg/libass, existing Aethera timeline and Audio-First renderer.

**Spec:** User-approved P3 — Smart Captions requirements in the current task.

## Global Constraints

- Preserve P0/P0.5, P1, P2 and P2.6 behavior; do not alter Scene Grounding thresholds.
- Preserve FFmpeg as the Cinema compositor; do not introduce Remotion or paid dependencies.
- Measured narration duration and word timestamps remain authoritative; never silently truncate audio or captions.
- Positive semantic evidence with insufficient confidence remains available for human review.
- Do not accept procedural voice fallback silently.
- Preserve unrelated dirty work and parallel ComfyUI work; do not push, merge, reset, clean, or overwrite it.
- Do not start P4.

## Review Focus

- Word timings with natural pauses and the final word: test monotonic cues and coverage through measured narration end.
- Longer/shorter measured audio than planned timeline: test caption timing follows measured audio without atrim-like truncation.
- Windows paths and ASS special characters: test deterministic escaping and FFmpeg-compatible subtitle paths.
- Scene-local edits: test only affected scene caption/segment cache keys change.
- Legacy subtitle clips without words: test the existing fallback remains available and does not claim word-level sync.

---

### Task 1: Deterministic caption compiler

**Files:**
- Create: `packages/cinema/src/captions/smart-captions.ts`
- Test: `packages/cinema/test/smart-captions.test.ts`
- Modify: `packages/cinema/src/index.ts`

**Interfaces:**
- Consumes `CaptionWord[]`, measured duration, safe-area format, and `SmartCaptionStyle`.
- Produces `compileSmartCaptions(input: SmartCaptionInput): SmartCaptionArtifact` with normalized words, grouped cues, ASS text, cache key, and coverage diagnostics.

- [ ] **Step 1: Write failing tests** for pause-aware grouping, max words per cue, keyword highlighting, safe-area placement, ASS escaping, and final-word coverage.
- [ ] **Step 2: Run** `npx vitest run packages/cinema/test/smart-captions.test.ts`; expect failure because the compiler does not exist.
- [ ] **Step 3: Implement** strict timestamp validation, deterministic cue grouping, `game`/`anime`/`geek` styles, configurable font/position/contrast/safe area, and ASS serialization without changing editorial thresholds.
- [ ] **Step 4: Run** the focused test and typecheck for Cinema; expect all caption tests to pass.
- [ ] **Step 5: Commit** only the compiler, tests, export, and plan with `feat: add deterministic smart caption compiler`.

### Task 2: Audio-First timeline integration and cache

**Files:**
- Modify: `packages/cinema/src/render/real-renderer.ts`
- Modify: `packages/cinema/src/render/real-renderer.ts` result/audit types as needed
- Test: `packages/cinema/test/real-renderer-captions.test.ts`

**Interfaces:**
- Consumes caption clips from `input.pkg.timeline`, including `source.words`, and the measured narration duration already returned by `prepareNarrationAudio`.
- Produces a cached ASS artifact and caption diagnostics included in `RealRenderResult`/render audit; cache keys include words, measured duration, style, format, and affected scene IDs.

- [ ] **Step 1: Write failing tests** for measured-duration authority, caption cache hit, scene-local invalidation, missing-word legacy fallback, and no audio truncation.
- [ ] **Step 2: Run** the focused tests; expect failures for missing diagnostics/cache integration.
- [ ] **Step 3: Implement** caption extraction after narration preparation, map scene-relative word timestamps to timeline timestamps, persist ASS/diagnostics under the existing segment cache, and expose counts/cache hits without re-synthesizing narration.
- [ ] **Step 4: Run** focused tests and the existing Audio-First renderer tests; expect PASS.
- [ ] **Step 5: Commit** with `feat: integrate smart captions with audio-first timeline`.

### Task 3: FFmpeg ASS burn-in and legacy compatibility

**Files:**
- Modify: `packages/cinema/src/render/real-renderer.ts`
- Test: `packages/cinema/test/real-renderer-captions.test.ts`

**Interfaces:**
- Consumes the Task 2 ASS artifact and existing raw video path.
- Produces the final captioned raw video through FFmpeg/libass, preserving the existing drawtext fallback only where word timings are unavailable.

- [ ] **Step 1: Add failing integration assertions** for visible ASS captions, FFmpeg path escaping, final duration tolerance, and legacy subtitle behavior.
- [ ] **Step 2: Run** the focused integration test; expect failure until ASS burn-in is wired.
- [ ] **Step 3: Implement** an FFmpeg `subtitles`/`ass` filter invocation with Windows-safe path escaping, deterministic style selection, and no `atrim`; include caption inputs in scene cache fingerprints so unaffected scenes remain cached.
- [ ] **Step 4: Run** focused integration tests plus `npm run typecheck` for Cinema/shared; expect PASS.
- [ ] **Step 5: Commit** with `feat: burn smart captions through ffmpeg`.

### Task 4: Real MP4 acceptance evidence

**Files:**
- Create: `packages/cinema/test/fixtures` only if an existing local fixture cannot be reused
- Modify: `docs/STATUS.md` only with P3 evidence and limitations
- Test: existing real-render test or a new narrow acceptance test under `packages/cinema/test/`

**Interfaces:**
- Consumes an existing local narration/media cache and the P1/P2 render path; no new download is allowed when local files exist.
- Produces a reproducible MP4, ffprobe measurements, caption diagnostics, and cache/re-render evidence.

- [ ] **Step 1: Locate** existing local media and narration caches without downloading or altering unrelated artifacts.
- [ ] **Step 2: Write/extend** the acceptance test to assert visible caption stream/burn-in evidence, measured narration coverage, and final duration tolerance.
- [ ] **Step 3: Run** the real render with FFmpeg, capture MP4 path, ffprobe output, caption artifact, cache stats, and logs.
- [ ] **Step 4: Run** all relevant automated tests and record any environmental limitation separately from product failures.
- [ ] **Step 5: Commit** only the acceptance test/evidence documentation with `test: validate real smart caption render`.

