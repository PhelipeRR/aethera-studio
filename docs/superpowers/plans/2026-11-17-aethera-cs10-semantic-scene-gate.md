# Aethera Studio CS10 Semantic Scene Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate conservative prompt-oriented semantic and visual-quality evidence into the existing Character Composition Gate, with localized repair and real 2/3/8-character acceptance artifacts.

**Architecture:** Keep `runCharacterCompositionGate` as the only orchestration path. Add a focused `semantic-scene-gate.ts` module that extracts only requirements present in `VisualRecipe`, evaluates full-scene and regional crops through existing local adapter contracts, and returns explicit confirmed/uncertain/failed evidence. Extend the runner report with separate count/semantic/visual-quality axes, preserving rejected originals and applying at most one bounded regional repair per attempt before retrying the existing strategy ladder.

**Tech Stack:** TypeScript strict, Vitest, Sharp, existing `ExternalImageAdapter` contracts, existing local CLIP/quality worker and ComfyUI inpaint support, Node filesystem/asset ingestion.

**Spec:** `docs/superpowers/specs/2026-11-17-aethera-cs10-semantic-scene-gate-design.md`

## Global Constraints

- Reuse local models already available; do not download models or add dependencies.
- Integrate with the existing Character Composition Gate; do not create a parallel pipeline.
- Prompt is the source of requirements; absent detection is not proof of absence.
- Insufficient evidence is `needs_review`, never automatic approval.
- A passed result remains `passed_pending_human_review` and requires human visual review.
- Preserve seeds, prompts, parameters, detector results, rejected images and repair images.
- Keep photobombing/negative crowd LoRA opt-in and unchanged.
- Do not modify unrelated pre-existing changes in other sessions.
- Run real tests and real 2/3/8 acceptance when the local ComfyUI/detectors are available.

## Review Focus

- A prompt without a weapon requirement must not create a missing-weapon failure: test in Task 1 with no weapon criterion.
- CLIP/detector uncertainty must not become rejection: test ambiguous score and unavailable evaluator in Task 1.
- A strong contradictory semantic result must be separately reported from count failure: test in Task 1 and Task 2.
- A localized quality defect must preserve the original PNG and repair only its bbox: test in Task 2 with a real Sharp buffer and adapter seam.
- Layered 8-character output must have varied pose guides and contact-shadow pixels without changing per-character prompts: test in Task 3.

## File Map

- Create: `packages/creative-studio/src/semantic-scene-gate.ts` — prompt criteria extraction, regional evaluation, conservative semantic verdicts, deterministic composition heuristics and repair candidates.
- Modify: `packages/creative-studio/src/character-gate-runner.ts` — CS10 config, per-attempt axis reports, localized repair, combined verdict/ranking and audit persistence.
- Modify: `packages/creative-studio/src/layered-composition.ts` — deterministic pose variants, depth-aware scaling and contact shadows.
- Modify: `packages/creative-studio/src/spatial-guides.ts` — optional pose variant while preserving existing default guide output.
- Modify: `packages/creative-studio/src/ai-background.ts` — expose CS10 report through generation output without changing the public generation fallback behavior.
- Modify: `apps/aethera-desktop/src/main/creative-studio-service.ts` — enable semantic gate by default for existing multi-character gate requests, with an explicit opt-out for compatibility/testing.
- Modify: `packages/creative-studio/src/index.ts` — export CS10 public types/functions.
- Create: `packages/creative-studio/test/semantic-scene-gate.test.ts` — red/green tests for prompt criteria and conservative evidence rules.
- Modify: `packages/creative-studio/test/character-gate-runner.test.ts` — integration tests for combined verdicts, retry, localized repair and audit persistence.
- Modify: `packages/creative-studio/test/layered-composition.test.ts` — composition variation/contact-shadow assertions.
- Modify: `scripts/comfyui-character-gate-acceptance.ts` — CS10 real acceptance, contact-sheet labels and separated report axes.
- Modify: `docs/comfyui-character-gate.md` — CS10 behavior, local model policy, evidence semantics and artifact paths.
- Create at runtime only: `artifacts/comfyui-character-gate-acceptance/run-*/report.json`, contact sheet and PNGs; never commit generated binaries unless explicitly requested.

### Task 1: Build the conservative prompt-oriented Semantic Scene Gate

**Files:**
- Create: `packages/creative-studio/src/semantic-scene-gate.ts`
- Test: `packages/creative-studio/test/semantic-scene-gate.test.ts`
- Modify: `packages/creative-studio/src/index.ts`

**Interfaces:**
- Consumes: `VisualRecipe`, `ExternalImageAdapter.evaluateImageSemantics`, `ExternalImageAdapter.inspectVisualQuality`, `CharacterGateEvidence`, `LocalizedDefect`.
- Produces: `SemanticCriterion`, `SemanticSceneGateResult`, `buildSemanticCriteria(recipe)`, and `evaluateSemanticSceneGate({ imageBuffer, recipe, adapter, evidence?, options? })`.

- [ ] **Step 1: Write failing tests for criteria extraction.**

  Add tests named `extracts only prompt-required weapon and clothing criteria`, `does not create an absent-object failure`, and `keeps region and scene source prompts in the evidence`. Assert that a recipe mentioning a katana creates an object criterion, while a recipe without a weapon does not.

- [ ] **Step 2: Run the focused tests and verify the expected missing-module failure.**

  Run: `npx vitest run packages/creative-studio/test/semantic-scene-gate.test.ts`

  Expected: FAIL because `semantic-scene-gate.ts` and its exported contracts do not exist.

- [ ] **Step 3: Write failing tests for conservative evaluation.**

  Add real-buffer tests using Sharp and a small deterministic adapter seam for the already-defined adapter contract. Cover: high positive score → `confirmed`; ambiguous score → `uncertain`/`needs_review`; evaluator error → `uncertain`/`needs_review`; strong explicit contradiction → semantic `failed`/`rejected`; no criterion for an unmentioned weapon; criterion result contains evaluator, score, margin, prompt source and optional region bbox.

- [ ] **Step 4: Implement `buildSemanticCriteria(recipe)` and the result types.**

  Keep the extraction deterministic and dependency-free. Use explicit prompt phrases and a small vocabulary for object, wardrobe/accessory, pose and action categories; only emit a category when a term exists in the source prompt/region description. Always emit the scene criterion only from `scenePrompt` (or the full positive prompt when no scene prompt exists), and never invent a missing object criterion.

- [ ] **Step 5: Implement `evaluateSemanticSceneGate(...)`.**

  Crop each planned character region with Sharp, evaluate the crop against that region's required criteria, evaluate the full image against scene criteria, and preserve the local evaluator's raw scores/rationale. Use conservative thresholds: confirmation requires a configured positive score and margin; failure requires an explicit off-topic/contradictory result with a stronger failure threshold; all other cases are uncertain. Add deterministic composition observations only as evidence/repair candidates, never as semantic object absence.

- [ ] **Step 6: Run the focused tests and verify they pass.**

  Run: `npx vitest run packages/creative-studio/test/semantic-scene-gate.test.ts`

  Expected: all criteria/evidence tests PASS with no new model or package installation.

- [ ] **Step 7: Export the new public contracts.**

  Export the module from `packages/creative-studio/src/index.ts` and run `npx tsc -p packages/creative-studio`.

- [ ] **Step 8: Commit the standalone gate.**

  ```bash
  git add packages/creative-studio/src/semantic-scene-gate.ts packages/creative-studio/src/index.ts packages/creative-studio/test/semantic-scene-gate.test.ts docs/superpowers/specs/2026-11-17-aethera-cs10-semantic-scene-gate-design.md docs/superpowers/plans/2026-11-17-aethera-cs10-semantic-scene-gate.md
  git commit -m "feat(creative-studio): add conservative semantic scene gate"
  ```

### Task 2: Integrate CS10 axes, localized repair and audit persistence into the runner

**Files:**
- Modify: `packages/creative-studio/src/character-gate-runner.ts`
- Modify: `packages/creative-studio/src/ai-background.ts`
- Modify: `apps/aethera-desktop/src/main/creative-studio-service.ts`
- Test: `packages/creative-studio/test/character-gate-runner.test.ts`

**Interfaces:**
- Consumes: Task 1 `evaluateSemanticSceneGate` and its `SemanticSceneGateResult`.
- Produces: `CharacterGateConfig.semanticGate`, `CharacterGateAttempt.semantic`, `CharacterGateAttempt.visualQuality`, `CharacterGateAttempt.repair`, `CharacterGateReport.failureCategories`, and an overall verdict that never upgrades human review.

- [ ] **Step 1: Write failing runner tests for the three independent axes.**

  Add tests named `records count semantic and visual-quality failures separately`, `keeps ambiguous semantic evidence as needs_review`, and `does not reject because an evaluator is unavailable`. Assert frozen prompt/seed/engine metadata remain unchanged and the overall report has `failureCategories.count`, `.semantic`, `.visualQuality`.

- [ ] **Step 2: Run the runner tests to verify the new assertions fail.**

  Run: `npx vitest run packages/creative-studio/test/character-gate-runner.test.ts`

  Expected: FAIL because the report has no CS10 axis fields or semantic evaluation.

- [ ] **Step 3: Add the config/report contracts and implement per-attempt evaluation.**

  Extend the runner config with an explicit `semanticGate` option (`enabled`, thresholds, `localizedRepair`, and max one repair per attempt). After count evidence, call Task 1 and the existing `inspectVisualQuality` when enabled and available. Missing evaluators produce an explicit uncertain evidence record when CS10 is enabled; legacy callers without `semanticGate` retain CS9 count-only behavior.

- [ ] **Step 4: Add conservative combined verdict and retry policy.**

  Keep count reasons in `count`, semantic criteria/reasons in `semantic`, and inspector defects/metrics in `visualQuality`. `rejected` requires count rejection, a proven semantic contradiction, or a proven severe visual defect; uncertainty produces `needs_review`. Update retry classification so actionable semantic/visual regional defects can use localized repair before an existing strategy retry, while a pure uncertainty does not burn GPU attempts.

- [ ] **Step 5: Implement bounded localized repair and preserve both images.**

  Choose at most one highest-severity actionable bbox from semantic/quality evidence. Call `adapter.inpaintRegion` with a prompt derived from the failed requirement, a conservative strength and deterministic seed derived from attempt seed/bbox. Re-run the detector/gates on the repaired image; persist original and repaired buffers with distinct asset names, keeping rejected originals even when the repair passes.

- [ ] **Step 6: Run runner tests and verify they pass.**

  Run: `npx vitest run packages/creative-studio/test/character-gate-runner.test.ts`

  Expected: all existing CS9 tests plus new CS10 integration tests PASS.

- [ ] **Step 7: Enable CS10 in the Aethera service and preserve output contracts.**

  Pass `semanticGate: { enabled: true, localizedRepair: true }` from the existing multi-character service configuration unless the caller explicitly opts out. Keep `crowdSuppression` unchanged and expose the richer report through `AiGenerationReport.characterGate` without changing the human approval state.

- [ ] **Step 8: Run package typecheck and commit the integrated runner.**

  Run: `npx tsc -p packages/creative-studio; npx tsc -p apps/aethera-desktop/tsconfig.node.json`

  Then commit only the Task 2 paths with:

  ```bash
  git add packages/creative-studio/src/character-gate-runner.ts packages/creative-studio/src/ai-background.ts apps/aethera-desktop/src/main/creative-studio-service.ts packages/creative-studio/test/character-gate-runner.test.ts
  git commit -m "feat(creative-studio): integrate semantic and quality gates"
  ```

### Task 3: Improve layered cinematic composition with deterministic pose/depth/contact evidence

**Files:**
- Modify: `packages/creative-studio/src/spatial-guides.ts`
- Modify: `packages/creative-studio/src/layered-composition.ts`
- Test: `packages/creative-studio/test/layered-composition.test.ts`

**Interfaces:**
- Consumes: existing `VisualRecipe.characterRegions` and layer seeds.
- Produces: backward-compatible pose guide functions with an optional variant and layered images with varied pose guides, depth-aware scale and soft contact shadows.

- [ ] **Step 1: Write failing tests for pose variation and contact shadows.**

  Add tests named `renders distinct deterministic pose guides for adjacent layers` and `grounds layered figures with contact shadow pixels`. Assert default guide output remains stable, variant output differs, portrait requests retain each region prompt, and the composed image contains non-background shadow pixels immediately beneath a cutout.

- [ ] **Step 2: Run the focused test and verify it fails.**

  Run: `npx vitest run packages/creative-studio/test/layered-composition.test.ts`

  Expected: FAIL because the guide has no variant option and composition has no contact shadow.

- [ ] **Step 3: Implement optional pose variants in `spatial-guides.ts`.**

  Preserve the current standing pose for the default call. For a supplied index/variant, apply bounded, deterministic shoulder/arm/leg offsets that keep all keypoints inside the region and do not alter the region count.

- [ ] **Step 4: Implement depth-aware scale, coherent lighting hints and contact shadows in `layered-composition.ts`.**

  Use region row/depth and index to vary scale within safe bounds, request the same scene lighting in every portrait, render a soft ellipse at each figure baseline before the figure overlay, and pass variant guides for portraits and the full harmonization guide.

- [ ] **Step 5: Run layered tests, then package tests.**

  Run: `npx vitest run packages/creative-studio/test/layered-composition.test.ts packages/creative-studio/test/character-gate.test.ts`

  Expected: all PASS and existing event/request assertions remain valid.

- [ ] **Step 6: Commit the composition improvements.**

  ```bash
  git add packages/creative-studio/src/spatial-guides.ts packages/creative-studio/src/layered-composition.ts packages/creative-studio/test/layered-composition.test.ts
  git commit -m "feat(creative-studio): improve layered cinematic composition"
  ```

### Task 4: Produce real CS10 acceptance evidence for 2/3/8 characters

**Files:**
- Modify: `scripts/comfyui-character-gate-acceptance.ts`
- Modify: `docs/comfyui-character-gate.md`

**Interfaces:**
- Consumes: Task 2 CS10 report and Task 3 layered output.
- Produces: runtime-only `report.json`, contact sheet, before/after/attempt PNGs and documented real-test results; never asserts human approval.

- [ ] **Step 1: Add acceptance assertions before executing GPU work.**

  Update the script to enable CS10, include semantic/quality labels in each contact-sheet tile, and write a report schema containing per-axis verdicts, criteria, detector metrics, seeds, prompts, repair records and artifact paths. The script must record unavailable local evaluators as blocked/uncertain instead of fabricating compliance.

- [ ] **Step 2: Run the narrow real acceptance for all requested cases.**

  Run: `$env:GATE_CASES='duo,trio,eight'; node --import tsx scripts/comfyui-character-gate-acceptance.ts` (or the repository's existing TypeScript runner if `tsx` is unavailable).

  Expected: real ComfyUI/local-detector execution, preserved attempt PNGs, `report.json`, contact sheet and no claim of human approval. If the local engine/model is unavailable, record the exact blocker and keep deterministic tests green.

- [ ] **Step 3: Inspect generated artifacts and document evidence.**

  Verify JSON parses, every report image path exists, rejected originals are present, contact sheet includes 2/3/8 before/after rows, and docs distinguish count/semantic/quality failures and the known limitations of local CLIP/detectors.

- [ ] **Step 4: Run full verification before completion.**

  Run: `npx vitest run packages/creative-studio/test/semantic-scene-gate.test.ts packages/creative-studio/test/character-gate-runner.test.ts packages/creative-studio/test/layered-composition.test.ts`; `npm run typecheck`; `git diff --check`; `git status --short`.

  Expected: commands report zero new test/typecheck failures, diff is clean, and pre-existing unrelated changes remain unstaged/uncommitted.

- [ ] **Step 5: Commit docs/script only after artifacts are verified.**

  ```bash
  git add scripts/comfyui-character-gate-acceptance.ts docs/comfyui-character-gate.md
  git commit -m "test(creative-studio): add CS10 real acceptance evidence"
  ```

## Self-Review

- The design covers all requested axes: prompt-oriented semantics, local model reuse, transparent/duplicate/incomplete/fused evidence, cinematic layering, identity preservation, localized repair, human review, separated failure categories and audit artifacts.
- The plan explicitly preserves the existing provider requirement and photobombing opt-in behavior.
- Every new production path has a test step before implementation and a focused verification command.
- Ambiguous evidence is explicitly tested as `needs_review`; unmentioned objects are not criteria.
- Real GPU acceptance is isolated to the final task and cannot be replaced by fixtures in the completion report.
