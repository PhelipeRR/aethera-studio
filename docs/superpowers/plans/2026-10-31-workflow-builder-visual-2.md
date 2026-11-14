# Workflow Builder Visual 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize the existing Workflow Builder into a premium, accessible three-area editor while preserving React Flow, `WorkflowDefinitionV2`, IPC, layout persistence, and TaskEngine execution.

**Architecture:** Refine `WorkflowsPage`, `BlockPalette`, `WorkflowCanvas`, and the existing property/run surfaces incrementally. Keep `workflow-graph` as the only graph conversion and the existing IPC/database model as the source of truth; visual state is derived from persisted workflow/run data only.

**Tech Stack:** React 19, React Flow, Tailwind CSS 4, Lucide, TanStack Query, Vitest, Playwright, Electron.

**Spec:** Fase 37 — Lote 5: Workflow Builder Visual 2.0 (user request, 2026-10-31)

## Global Constraints

- Preserve existing workflows, `WorkflowDefinitionV2`, `workflow-graph`, IPC, persistence, and TaskEngine integration.
- Do not invent node kinds, execution telemetry, templates, or progress states.
- Use the existing NeuralBridge Master design system and semantic tokens; no second visual system or new dependency.
- Keep JSON mode as a compatibility/debug surface, not the primary authoring experience.
- Do not create commits.

## Review Focus

- Existing workflow reopen/save must preserve IDs and positions — covered by the workflow persistence E2E.
- Unsupported/planned node types must not appear as addable blocks — covered by node-library assertions against `createStep` kinds.
- Invalid dependencies and incomplete required fields must be understandable and block save/run — covered by validation tests and E2E.
- Keyboard users need an alternative to drag-only insertion/selection — covered by keyboard add/select E2E.
- Real run states must map to nodes without fabricated progress — covered by execution E2E and existing TaskEngine tests.

### Task 1: Extract the real node catalog and visual state mapping

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/workflows/builder/model.ts`
- Modify: `apps/desktop/src/renderer/src/features/workflows/WorkflowsPage.tsx`
- Test: `packages/shared/test/workflow-graph.test.ts` or focused renderer test where existing conventions permit

- [ ] Add a typed catalog derived only from supported `NodeKind`/`createStep`, with category, Lucide icon, description, and required-configuration metadata.
- [ ] Add pure helpers for validation issue lookup and real run-step status labels/tone, preserving existing statuses.
- [ ] Test that every addable catalog item creates a schema-supported step and that planned/unsupported kinds are absent.

### Task 2: Build the three-area editor composition

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/workflows/WorkflowsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/features/workflows/builder/BlockPalette.tsx`
- Modify: `apps/desktop/src/renderer/src/features/workflows/builder/WorkflowCanvas.tsx`

- [ ] Recompose the page as responsive library / canvas / contextual properties regions with stable accessible labels.
- [ ] Give the canvas the dominant area, subtle semantic-token grid, readable React Flow controls, and an empty-state instruction that uses real supported actions.
- [ ] Keep template/saved library functionality and all existing save/run controls intact.
- [ ] Preserve zoom, pan, selection, organize, duplicate, delete, and layout persistence.

### Task 3: Modernize nodes, connections, and contextual properties

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/workflows/builder/WorkflowCanvas.tsx`
- Modify: `apps/desktop/src/renderer/src/features/workflows/WorkflowsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/features/workflows/builder/model.ts`

- [ ] Create consistent node hierarchy: icon/kind, title, short function, configuration warning, dependency handles, and real execution state.
- [ ] Highlight selected and executed paths without relying on color alone; include text/icon status labels and reduced-motion behavior.
- [ ] Group properties into essentials and collapsible advanced settings; preserve values on selection changes and show field-level validation context.
- [ ] Provide keyboard-reachable add/select/delete/duplicate actions and visible focus states.

### Task 4: Improve library search, insertion, and templates

**Files:**
- Modify: `apps/desktop/src/renderer/src/features/workflows/builder/BlockPalette.tsx`
- Modify: `apps/desktop/src/renderer/src/features/workflows/WorkflowsPage.tsx`
- Test: `tests/e2e/workflows.spec.ts`

- [ ] Add node search/filter by the real catalog and category groups with concise descriptions and required-config hints.
- [ ] Make insertion work from keyboard and pointer; retain existing “Adicionar …” accessible names for compatibility.
- [ ] Improve template cards/preview using only existing template metadata, requirements, and steps.
- [ ] Add E2E coverage for search, keyboard insertion, contextual selection, template preview, and persistence.

### Task 5: Validate responsive/accessibility behavior and real execution

**Files:**
- Modify: `tests/e2e/workflows.spec.ts`
- Create/Modify: visual snapshot coverage near existing `tests/e2e/visual-qa.spec.ts`
- Modify: `docs/PLAN.md`
- Modify: `docs/STATUS.md`

- [ ] Add E2E for create/edit/save/reopen, real TaskEngine run state, approval/recovery controls, and keyboard-only editor flow.
- [ ] Run Electron screenshots at 1024×768, 1280×800, 1440×900, and the smallest supported window; inspect canvas, library, properties, templates, and execution state.
- [ ] Run relevant unit tests, E2E, typecheck, lint, build, and `git diff --check`; record exact results and blockers.
- [ ] Update Phase 37 checkpoint without marking Phase 37 complete; record limitations and next priorities.
