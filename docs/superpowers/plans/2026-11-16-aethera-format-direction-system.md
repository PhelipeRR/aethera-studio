# Aethera Format & Creative Direction System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cinema Director's coupled genre/format choices with an extensible creative-direction catalog and independently validated professional delivery presets that affect planning, acquisition, composition, render and audit.

**Architecture:** Add pure, versioned registries to `packages/cinema`: one for narrative formats/content categories/aesthetic directions and one for delivery presets. A compatibility adapter maps the four legacy genres and two legacy delivery formats into the new model. The existing `StagedCinemaPipeline`, `produceCinemaPackage`, real FFmpeg renderer and Cinema Director UI consume the selected snapshots; the UI never invents render capabilities.

**Tech Stack:** TypeScript, Zod, Vitest, React/Electron, FFmpeg/FFprobe.

**Spec:** User request in the current thread.

## Global Constraints

- Preserve legacy projects and migrate existing `documentary`, `gameplay_essay`, `top_list`, `trailer`, `youtube_16_9` and `shorts_9_16` values without losing configuration.
- Keep narrative format, content category, aesthetic direction, platform, aspect ratio, resolution, FPS, audio and quality independently selectable.
- Automatic selection is the default and manual changes always win; conflicts remain visible and serializable.
- Hybrid combinations are valid and must compose profiles rather than selecting a single rigid preset.
- Preview resolution remains independent from master delivery resolution.
- Only expose delivery capabilities that the renderer can execute; unsupported codec/profile combinations are explicit validation errors.
- Reuse the existing Cinema pipeline, Remotion/FFmpeg renderer, research/audit/QC and segment cache; do not create a second production engine.
- Preserve unrelated dirty files and stage only files changed by this feature.

## Review Focus

- A prompt mentioning `TikTok`, `4K`, `60 fps` or `podcast` must be detected into the right delivery dimensions without changing a manual override.
- A hybrid such as `Documentário + Anime + Cinematográfico` must retain all three dimensions and produce a composed profile used by planning and render.
- A custom 4:5 or ultrawide preset with invalid dimensions/aspect or incompatible codec must be rejected before render.
- A legacy job with only the old genre/format fields must load with equivalent creative and delivery selections.
- Preview at 720p must not change a requested 4K master, and final `ffprobe` evidence must use the master dimensions/FPS/audio target.

---

### Task 1: Extensible direction and delivery domain

**Files:**
- Create: `packages/cinema/src/director/aethera-format-catalog.ts`
- Modify: `packages/cinema/src/index.ts`
- Modify: `packages/cinema/src/director/cinematography-director.ts`
- Modify: `packages/cinema/src/edit/editorial-engine.ts`
- Test: `packages/cinema/test/aethera-format-catalog.test.ts`
- Test: `packages/cinema/test/cinema.test.ts`

**Interfaces:**
- Produces `AetheraCreativeSelection`, `AudiovisualFormatDefinition`, `DirectionProfile`, `DeliveryPreset`, `ResolvedDeliveryProfile`, `detectCreativeSelection`, `searchAudiovisualFormats`, `groupFormatsByCategory`, `composeDirectionProfile`, `resolveDeliveryPreset`, `migrateLegacyCreativeSelection`, `validateCustomDeliveryPreset` and `planDeliveryExports`.
- Extends `ProduceCinemaPackageInput` and `CreativeBrief` with optional versioned creative/delivery snapshots while keeping old fields valid.

- [ ] Write failing unit tests for at least 60 catalog entries across the seven requested content groups, short descriptions, search, grouping and each profile's seven direction fields.
- [ ] Run the focused test and observe the expected missing-export failure.
- [ ] Implement the registries, automatic prompt detection, hybrid profile composition, legacy migration and delivery validation.
- [ ] Add failing tests for delivery presets, custom 4:5/ultrawide validation, preview/master separation, multiple export planning and legacy equivalence.
- [ ] Implement the professional presets and pure export planner; expand render quality profiles additively with `master_4k` compatibility.
- [ ] Make `compileCreativeBrief` derive pacing, tone, safe zones, sound identity, narrative beats and media intent from the composed profile when provided.
- [ ] Run focused Cinema tests and package typecheck.
- [ ] Commit only the domain files and focused tests.

### Task 2: Persist and apply selections in the existing staged pipeline

**Files:**
- Modify: `apps/aethera-desktop/src/main/cinema-pipeline.ts`
- Modify: `apps/aethera-desktop/src/main/aethera-ipc.ts`
- Modify: `apps/aethera-desktop/src/preload/index.ts`
- Modify: `packages/cinema/src/render/real-renderer.ts`
- Test: `apps/aethera-desktop/test/staged-pipeline.test.ts`
- Test: `apps/aethera-desktop/test/format-delivery-pipeline.test.ts`

**Interfaces:**
- `StagedProductionJob` persists `creativeSelection`, `directionProfile`, `deliveryPreset`, `previewProfile` and export history additively.
- Existing old job JSON is lazily migrated on load/resume.
- `renderRealCinemaMp4` consumes the resolved master/preview delivery profile, generates the requested dimensions/FPS/audio profile and records actual probe evidence.

- [ ] Write failing integration tests for automatic detection, manual override precedence, persistence/migration and pipeline propagation into package/stage context.
- [ ] Implement additive job fields and pass selection/profile through interpretation, research queries, storyboard/decupagem, acquisition context, `produceCinemaPackage`, composition and QC.
- [ ] Write failing tests that preview render stays at preview resolution while master output follows 4K, vertical, square and cinematic presets.
- [ ] Replace renderer hardcoded 1280×720/30 assumptions with profile-derived dimensions/FPS, adapt safe-zone overlays and mux encoding/bitrate/audio target, and retain real ffprobe verification.
- [ ] Add finite export planning/reuse metadata without duplicating pipeline execution or discarding cached scenes.
- [ ] Run focused staged-pipeline/render tests and the Aethera typecheck/build.
- [ ] Commit only the pipeline/renderer/IPC files and focused tests.

### Task 3: Creative Direction UI and contract synchronization

**Files:**
- Create: `packages/desktop-shared/src/renderer/src/features/video/creative-format-model.ts`
- Modify: `packages/desktop-shared/src/renderer/src/features/video/CinemaDirectorPanel.tsx`
- Modify: `packages/desktop-shared/src/renderer/src/features/video/PromptEditor.tsx` only if needed for conflict display
- Test: `packages/desktop-shared/test/creative-format-model.test.ts`

**Interfaces:**
- The pure UI model exposes independent controls, search/grouping, automatic labels, manual override tracking, contract conflicts and delivery capability warnings.

- [ ] Write failing model tests for automatic prompt synchronization, manual precedence, conflict signals, hybrid selections and legacy display values.
- [ ] Implement the model and replace the coupled genre/format controls with searchable grouped direction and delivery selectors, keeping the existing visual language.
- [ ] Add profile summaries for narrative structure, pacing, research/media, narration, motion, SFX/VFX, music/mix and quality; show unsupported delivery limitations before submission.
- [ ] Add multiple export selection using the pure export planner and keep preview profile visibly separate from master profile.
- [ ] Wire selected snapshots into staged and direct Cinema calls; show contract revision/conflicts when available without silently overwriting manual controls.
- [ ] Run renderer model tests and relevant Aethera build/typecheck.
- [ ] Commit only UI/model files and focused tests.

### Task 4: Verification and documentation

**Files:**
- Modify: `docs/STATUS.md` with measured evidence only
- Test: focused Cinema/Aethera suites, full Vitest, typecheck, Aethera build and relevant Playwright flow

- [ ] Run focused domain, pipeline, renderer and UI model tests.
- [ ] Run `npm run typecheck`, `npm run build:aethera` and `npx vitest run --no-file-parallelism`; record unrelated pre-existing failures separately.
- [ ] Run the relevant E2E flow with real IPC/FFmpeg when available, including horizontal, vertical, square and cinematic delivery cases.
- [ ] Inspect `git diff --check`, persisted JSON, ffprobe evidence and `git status`; ensure unrelated dirty files are untouched.
- [ ] Update documentation with supported presets, compatibility limits and any environment-blocked verification.
- [ ] Commit only documentation/final test changes.

## Status de execução (2026-11-16)

Implementado pelas sessões Codex (interrompidas por limite de uso) e concluído/validado pelo Claude Code; os checkboxes acima não foram marcados durante a execução.

- Domínio (`production-contract.ts`, `director/aethera-format-catalog.ts`), propagação no `StagedCinemaPipeline`, renderer (preview/master, safe areas, validação FFprobe), IPC e UI (sincronização com conflito, painel de conformidade, seletores de direção/entrega) estão implementados.
- Correções na validação final: prévia legada (`renderProfile: draft_540p`) não sobe mais para 720p; render sem `renderTarget`/preset volta ao comportamento de prévia (master só quando pedido); placeholder procedural gerado a ≤640px (o `geq` em resolução cheia estourava timeouts); renderer passa a importar só `@neuralbridge/cinema/browser` (o barrel puxava FFmpeg/`node:util` para o navegador e o app abria em branco); `node:crypto` trocado por SHA-256 puro com saída idêntica (`ir/sha256.ts`).
- Evidência: typecheck limpo (cinema src, aethera node/web, tests); suíte Cinema+Aethera+desktop-shared 351/352 passando — a única falha (`project-isolation-and-preview` › full-length preview, timeout 60s) também falha no HEAD anterior.
- E2E `tests/e2e/aethera-redesign.spec.ts` atualizado para o pipeline em etapas: valida conflito/“Manter controle”, painel de conformidade e a pausa em “Pesquisa Pendente” sem fatos inventados (agentes falsos não geram dossiê); o Editor usa um pacote semeado via `cinema:produce`. Passou 2×.
