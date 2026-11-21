---
name: aethera-manga-vision-analyst
description: Specialized narrative comprehension skill for manga, manhwa, and webtoons integrated with VisionRouter, Story Memory, and Story Engine (natural_recap). Use when analyzing manga/manhwa panels, extracting speech/thought/narration/SFX OCR, consolidating panel sequences into natural stories, or auditing analysis quality gates.
---

# Aethera Manga Vision Analyst

Specialized skill for narrative comprehension of manga, manhwa, and webtoons. Produces structured, evidence-grounded panel and sequence analyses that feed `StoryEngine` and `natural_recap` without cinematographic jargon or hallucinated details.

## Core Principles

1. **Story-first, zero camera jargon:** Internal analysis may be detailed, but narrative summaries must NEVER use framing/camera language (`plano geral`, `plano médio`, `plongée`, `close-up`, `enquadramento`, `painel vertical`) or repeat clothing/hair descriptions without narrative relevance.
2. **Zero fabrication:** Never invent character names, dialogues, or events not supported by visual or OCR evidence. When uncertain, record the doubt in `uncertainties` and lower `confidence`.
3. **Anti-spoiler Story Memory:** Query confirmed characters, aliases, visual traits, relationships, and prior events strictly from chapters `< currentChapterNumber`. Never leak future-chapter information.

## Pipeline Stages

### 1. Contextual Multimodal Analysis (`MANGA_VISION_ANALYST_SCHEMA_VERSION = 1`)
For each panel, extract using `mangaVisionPanelContractSchema`:
- `characters`: visible characters with `idOrLabel`, `storyMemoryId` (if matched), `visualSignature`, `confidence`.
- `actions`: concrete observable actions (`actor`, `action`, `target`, `basis`, `confidence`).
- `speechBubbles`: specialized OCR for `dialogue`, `thought`, `narration`, and `sfx` preserving `originalText`, `translatedText` (PT-BR), `readingOrder`, `speaker`, `speakerConfidence`, `attributionBasis`, and `uncertainty`.
- `expressions`: relevant emotional/facial expressions.
- `environment`: setting (`description`, `basis`, `confidence`).
- `relationToPrevious` & `relationToNext`: narrative continuity links.
- `visualEvidence` & `confidence`: explicit visual evidence backing the interpretation.
- `narrativeSummary`: natural PT-BR story beat for the panel.

### 2. Sequence Consolidation (`consolidateMangaPanelSequence`)
Group consecutive panels that form a single physical or dramatic action (e.g., running → tripping on a root → shock → falling off a cliff) into a cohesive `MangaSequenceGroup` with a unified `consolidatedNarrative`:
- Merge redundant character/clothing/setting mentions across panels in the same group.
- Preserve chronological action order and substantive dialogues.

### 3. VisionRouter & Checkpoint Integration
- Use `createMangaVisionVisionAdapter` to wrap any compatible `VisionRouter`, `RecapVisionRouterPort`, `RecapVisualAnalysisPort`, or `VisionAdapter`.
- Contract is versioned (`MANGA_VISION_ANALYST_VERSION`) and model-agnostic.
- Preserves `VisionRouter` fallback/quota behavior and `checkpoint-persistence.ts` hash caching.

### 4. Analysis Quality Gate (`runMangaVisionQualityGate`)
Validates:
- Panel coverage
- Important dialogue preservation
- Continuity between events
- Character identification consistency
- Absence of hallucinations/spoilers
- Interpretation confidence

Requests **punctual review** (`reviewItems` per panel/beat) when doubts exist, without blocking production (`shouldBlockProduction: false`) for minor or irrelevant details.

## Key Files

- Implementation: [manga-vision-analyst.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/recap/manga-vision-analyst.ts)
- Story Engine: [story-engine.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/recap/story-engine.ts)
- Vision Adapter: [recap-vision-adapter.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/recap/recap-vision-adapter.ts)
- Story Memory: [story-memory.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/recap/story-memory.ts)
- E2E Comparison Script: [e2e-recap-manga-vision-analyst.mts](file:///c:/dev/neuralbridge-studio/scripts/e2e-recap-manga-vision-analyst.mts)
