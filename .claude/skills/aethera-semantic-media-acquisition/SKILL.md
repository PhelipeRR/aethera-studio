---
name: aethera-semantic-media-acquisition
description: Acquire and validate per-scene media for Aethera Studio. Trigger when debugging missing coverage, incompatible B-roll/gameplay recycling, query generation, fallback ordering, or scene-grounding mismatches.
---

# Aethera Semantic Media Acquisition

Enforce strict per-scene semantic correspondence between narration and visual media. Never mask missing footage by recycling media from a different game, character, or work.

## Workflow

1. **Identify scene target:** Extract canonical work/game, entities, visual intent, and `expectedDurationSec` from `SceneDecupagem` (`packages/cinema/src/analysis/`).
2. **Generate specific queries:** Include the exact game/work title + visual context (`gameplay`, `trailer`, `cutscene`, `boss fight`, `gameplay no commentary`).
3. **Search appropriate sources first:** Query configured providers in priority order (`local_library`, `steam`, `igdb`, `rawg`, `wikimedia_commons`, `internet_archive`, `yt_dlp`).
4. **Verify download & decodability:** Probe every acquired file (`ffprobe` / `probeRealMp4`) before considering it usable; record origin, duration, resolution, classification, and semantic confidence.
5. **Bind to scene & enforce compatibility:** Reject cross-work substitution (e.g., never assign Mario/Sonic footage to GTA, Red Dead Redemption, or Cyberpunk scenes).

## Mandatory Fallback Ladder

When a scene lacks verified footage:
1. Retry with alternative queries (`expandScriptOrientedQueries` / `buildMediaRecoveryPlan`).
2. Query remaining configured providers.
3. Evaluate related static images (IGDB/RAWG/Steam screenshots) with Ken Burns motion + graphic framing.
4. Consider local ComfyUI visual generation when appropriate for abstract/illustrative beats.
5. Mark the scene `needs_review` (`paused_pending_media` / review item) when no reliable coverage exists — never silently recycle incompatible footage.

## Completion Criteria

- Every scene has either verified compatible media (`exact_match` or verified `contextual_support`) or an explicit `needs_review` entry.
- Zero cross-work incompatible placements in `v1` or `coverageReport`.
