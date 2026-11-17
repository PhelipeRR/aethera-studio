# Aethera CS10 Attribute Evidence and Regional Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace compound-prompt semantic confidence with localized per-attribute evidence, evaluate the original and repaired images, and execute auditable regional repairs for the real 31001/31002/31003 scenarios.

**Architecture:** Extend the existing semantic evaluator contract with criterion metadata and localized evidence boxes. Extract a reusable candidate-evaluation function so both the runner and the acceptance script use the same count/semantic/quality logic. The runner may apply bounded inpaint repairs for actionable placement or uncertain prompt attributes, but adopts a repair only after comparing protected pixels, visual quality, identity, and attribute evidence; otherwise it keeps the prior image and records the failed repair.

**Tech Stack:** TypeScript, Vitest, Sharp, existing local CLIP/visual-quality worker, existing ComfyUI localized inpaint adapter, AssetIngestionService.

**Spec:** Existing CS10 design at `docs/superpowers/specs/2026-11-17-aethera-cs10-semantic-scene-gate-design.md`, the audit of `artifacts/comfyui-character-gate-acceptance/run-2026-11-17T1348/`, and the user requirements in this task.

## Global Constraints

- Reuse local models already available; do not download models or add unnecessary dependencies.
- Preserve current semantic thresholds: confirmation `0.60/0.06`, contradiction `0.16/-0.08`.
- Attribute absence or evaluator uncertainty is `needs_review`, never proof of absence or automatic rejection.
- Keep `humanReview.status` as `pending`; `passed_pending_human_review` is not approval.
- Keep the frozen prompt, seed lineage, mask, repair prompt, image files, and before/after evidence auditable.
- Repair only localized regions; do not silently regenerate the full image.
- Preserve existing correct characters and attributes; reject a repair when regression evidence is unsafe.
- Do not touch the main checkout or unrelated session files.

## Review Focus

- A long compound character prompt must not confirm a missing weapon or outfit attribute; test with a localized crop and a mismatched evaluator label in Task 1.
- A repair must not overwrite a correct neighboring character; test protected-region pixel regression and confirmed-attribute retention in Task 2.
- An uncertain attribute must be eligible for a bounded repair without becoming a semantic rejection; test `needs_review` before and after repair in Task 2.
- The real acceptance run must evaluate the original image as well as the gate output; validate non-null original reports and exact artifact paths in Task 3.
- A failed or ambiguous repair must retain the pre-repair image and remain pending human review; test the rollback decision in Task 2 and inspect it in Task 3.

### Task 1: Localized attribute evidence

**Files:**
- Modify: `packages/creative-studio/src/image-generation-adapter.ts`
- Modify: `packages/creative-studio/src/semantic-scene-gate.ts`
- Test: `packages/creative-studio/test/semantic-scene-gate.test.ts`

**Interfaces:**
- Consumes: `VisualRecipe.characterRegions`, existing local semantic adapter, current thresholds.
- Produces: `SemanticCriterion.evidenceBbox`, attribute-specific negative probes, `SemanticRepairCandidate` entries for uncertain required attributes, and evaluator requests carrying `criterionId`, `criterionKind`, `regionIndex`, and `evidenceBbox`.

- [ ] **Step 1: Write failing tests** for per-region attribute crops, attribute-specific negative probes, and a high-scoring generic/mismatched label remaining `uncertain`.
- [ ] **Step 2: Run the semantic gate tests and verify the new assertions fail for the current compound-prompt behavior.**
- [ ] **Step 3: Implement criterion focus boxes and evaluator metadata without changing the thresholds.** Scene uses the full frame, character uses the planned region, wardrobe uses torso, accessory/hair uses head/upper-body, and object/pose/action uses the character interaction region. Attribute criteria never send the compound character prompt as their positive concept.
- [ ] **Step 4: Emit localized repair candidates for uncertain required attributes while preserving `needs_review`; keep absent-object behavior unchanged.**
- [ ] **Step 5: Run the semantic gate tests and the package typecheck.**
- [ ] **Step 6: Commit `feat(creative-studio): require localized attribute evidence`.**

### Task 2: Candidate evaluation, regional repair, and regression evidence

**Files:**
- Modify: `packages/creative-studio/src/character-gate-runner.ts`
- Modify: `packages/creative-studio/test/character-gate-runner.test.ts`
- Modify: `packages/creative-studio/src/index.ts`

**Interfaces:**
- Consumes: Task 1 localized criteria and existing `ExternalImageAdapter.inpaintRegion`.
- Produces: `evaluateCharacterGateCandidate`, original/final evaluations, `repairs[]` with mask/original/repaired/diff assets, per-attribute before/after evidence, and visual-regression status.

- [ ] **Step 1: Write failing tests** for original candidate evaluation, uncertain-attribute repair, mask/diff persistence, protected-region regression, and rollback of a repair that worsens a confirmed attribute.
- [ ] **Step 2: Run the runner tests and verify these assertions fail before implementation.**
- [ ] **Step 3: Extract the existing detector/semantic/quality evaluation into `evaluateCharacterGateCandidate` and retain the current runner report shape for compatibility.**
- [ ] **Step 4: Implement bounded repair sequencing for `undersized_character` and uncertain attribute candidates.** Use a maximum of three regional repairs per generated attempt; derive deterministic repair seeds from the base seed and criterion/bbox; do not run full-image generation for these repairs.
- [ ] **Step 5: Generate and ingest a matching mask and absolute-difference image for every repair.** Pass `compareBeforeBuffer` into the existing visual-quality evaluator and compare protected pixels outside the repair box; adopt only repairs that preserve confirmed attributes and do not introduce a regression.
- [ ] **Step 6: Run runner/layered/semantic tests, package and web typechecks.**
- [ ] **Step 7: Commit `feat(creative-studio): add auditable regional semantic repairs`.**

### Task 3: Real 31001/31002/31003 acceptance evidence

**Files:**
- Modify: `scripts/comfyui-character-gate-acceptance.ts`
- Modify: `docs/comfyui-character-gate.md`

**Interfaces:**
- Consumes: Task 2 `evaluateCharacterGateCandidate`, repair evidence assets, and existing local ComfyUI service.
- Produces: CS10 v2 report with original and final gate axes, real repair history, masks, diffs, before/after attribute metrics, and a contact sheet.

- [ ] **Step 1: Write or update the acceptance assertions** so each original result has count/semantic/quality evidence and each repair asset path is checked.
- [ ] **Step 2: Run the script-level typecheck and verify the new report assertions fail against the current acceptance shape.**
- [ ] **Step 3: Evaluate each original image with the same gate, enable bounded regional repair for after images, and copy every mask/original/repaired/diff asset into the run directory.** Keep `humanReview.status` pending.
- [ ] **Step 4: Run the real `duo`, `trio`, and `eight` scenarios with existing local models and record seeds, prompts, VRAM, detector evidence, repair seeds, and before/after metrics.**
- [ ] **Step 5: Inspect each pair and the contact sheet; verify that the eight-character layered composition remains intact and that duo/trio repairs are real pixel changes localized to their masks.**
- [ ] **Step 6: Update documentation with the new run and explicit limitations; do not describe an unexercised repair as observed evidence.**
- [ ] **Step 7: Run focused tests, script typecheck, `git diff --check`, and commit `test(creative-studio): record CS10 attribute repair acceptance`.**

### Task 4: Final verification

- [ ] Run the focused CS10 suite and package/web typechecks from a fresh command.
- [ ] Validate the report JSON, all referenced files, SHA/pixel differences, pending human review, and no model downloads.
- [ ] Review `git diff 1f19706...HEAD` and record any unresolved technical findings; do not claim CS10 accepted without human visual approval.
