---
name: aethera-audiovisual-qa
description: Execute Aethera Studio 3-stage Quality Gates (Pre-assembly, Pre-render, Post-render). Trigger when validating scene coverage, timeline completeness, or inspecting rendered MP4 output.
---

# Aethera Audiovisual QA

Enforce the 3-gate quality pipeline. Technical validity (MP4 exists and decodes) never implies editorial approval.

## Gate A — Pre-Assembly

- Semantic coverage per scene (`coverageReport`): every scene has verified compatible media or is marked `needs_review`.
- Media file integrity (`ffprobe` decodable, non-zero frames/duration).
- Planned duration within tolerance of `requestedDurationSec` (±5%).
- Required assets present; narration matches visual subjects.

## Gate B — Pre-Render

- Timeline has no unjustified visual gaps or out-of-bounds clips.
- Zero incompatible cross-game/cross-work media placements in `v1`.
- Complete narration track, semantically valid SFX, music present (or explicit traceable fallback), active VFX/motion/transitions matching the audiovisual plan.

## Gate C — Post-Render (Real MP4)

Analyze the rendered MP4 objectively (`ffprobe`, FFmpeg filters, sampled frame inspection):
- Duration within ±5% of `requestedDurationSec`, expected resolution and FPS.
- Audio integrity: no clipping, no unintended long silences, clean loudness.
- Video integrity: no black frames, no unexpected freezes, no unjustified visual loops.
- Synchronization and narrative coverage across scenes.
- When semantic correspondence cannot be confirmed, return `needs_review` — never auto-approve.
