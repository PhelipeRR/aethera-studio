# P2 — B-roll Intelligence implementation plan

## Scope

Implement the approved architecture from `P2-BROLL-RESEARCH.md` in TypeScript, reusing the existing FFmpeg analysis path, VisionRouter, repository cache, checkpointed production stages, Scene Matching and P1 Audio-First Timeline. Do not change Scene Grounding thresholds, introduce a Python orchestrator, replace FFmpeg, start P3, or modify unrelated ComfyUI work.

## Task 1 — P2.1: versioned segment index

- Add an additive persisted B-roll index contract/table and repository methods.
- Extend the visual index stage to persist index version, source fingerprint, cut parameters, segment states, keyframe hashes/timestamps, and contact-sheet artifact metadata.
- Make segment IDs deterministic from source hash, interval and indexer version.
- Add a deterministic keyframe/contact-sheet module with atomic/idempotent writes.
- Tests: stable IDs, multiple keyframes, contact sheet, cache reuse, persistence and restart.

## Task 2 — P2.2: temporal quality

- Add explicit flash-candidate confirmation using neighboring frames, black/freeze/continuity checks and structured technical statuses.
- Preserve valid static material as valid; reject only technically invalid intervals and never synthesize frames to meet target duration.
- Test against the existing multi-section synthetic fixture and a real local Cyberpunk asset.

## Task 3 — P2.3: semantic correspondence

- Route one interval's frames through VisionRouter with deterministic cache keys and persisted attempts/diagnostics.
- Store semantic evidence and distinct statuses: `technical_blocked`, `media_unavailable`, `needs_review`, `editorial_rejected`, `semantic_adequate`.
- Integrate scene needs without changing thresholds or approving metadata-only matches.
- Tests: fallback/cache/deduplication, evidence attribution, technical-vs-editorial classification, insufficient evidence.

## Task 4 — P2.4/P2.5: Audio-First integration and ranking

- Rank only semantically eligible intervals using quality, motion, continuity, framing and duration after identity/rights/threshold gates.
- Allow different intervals from one asset to serve multiple scenes and retain provenance.
- Feed selected source ranges into the existing FFmpeg renderer while using measured P1 audio duration as the timeline authority.
- Tests: multiple scene matches, short/long interval handling, P1 duration compatibility, renderer integration.

## Task 5 — real benchmark and acceptance evidence

- Run the full focused suite, typecheck/build targets and an integration render with P2-selected segments.
- Benchmark a local multi-cut real Cyberpunk file when present; otherwise run the controlled multi-cut fixture and clearly label the limitation.
- Persist benchmark metrics, contact sheets, scene decisions, provider attempts, and a reproducible MP4.
- Run a fresh whole-branch review before claiming completion.

## Constraints and rulings

- No new downloads when an existing local asset/cache is available.
- No threshold changes and no automatic approval when visual evidence is insufficient.
- Technical failures remain diagnostic and never become editorial rejections.
- Existing uncommitted work is outside this plan and must not enter its commits.
