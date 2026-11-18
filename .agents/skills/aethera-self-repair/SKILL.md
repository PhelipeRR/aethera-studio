---
name: aethera-self-repair
description: Perform targeted audiovisual self-repair with partial re-render. Trigger when Quality Gates detect scene, track, or interval defects after assembly or render.
---

# Aethera Self-Repair

Repair detected defects with minimal scope while preserving already-approved segments.

## Repair Loop

1. **Localize:** Identify exact `sceneId`, `trackId`, and time interval (`startSec`–`endSec`) flagged by Gate A/B/C.
2. **Diagnose:** Determine probable root cause (missing media, wrong SFX, duration overflow, black frame, missing VFX/transition).
3. **Minimal Fix:** Apply the smallest targeted fix (swap asset, re-query scene, adjust trim/SFX/transition, or trim script beat).
4. **Invalidate Dependents:** Invalidate only affected segment caches/renders, preserving approved segments.
5. **Partial Re-render & Recompose:** Re-render impacted segments when technically viable and recompose the final MP4.
6. **Re-verify:** Run Gate B/C again up to a configurable `maxRepairAttempts` limit to prevent infinite loops.
7. **Escalate:** If repair cannot resolve the defect within the attempt budget, mark `needs_review` with cause, evidence, and suggested user action.
