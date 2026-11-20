---
name: aethera-pipeline-debugging
description: Debug Aethera Studio production failures and silent data loss. Trigger when inspecting cinema-jobs/*.job.json, cinema-projects/*.json, console logs, dropped fields (vfxPlan, humorBeats, transitionIn), or duration drift.
---

# Aethera Pipeline Debugging

Trace root causes across planning, acquisition, timeline assembly, and FFmpeg/Remotion rendering using persisted artifacts instead of guessing.

## Inspection Order

1. **Job state:** Inspect `%APPDATA%\AetheraStudio\cinema-jobs\<projectId>.job.json` (`state`, `targetDurationSec`, `completedStages`, `acquiredMedia`, `pendingMedia`, `coverageReport`, `autonomousAudit`, `audioSources`, `musicSelection`).
2. **Timeline package:** Inspect `%APPDATA%\AetheraStudio\cinema-projects\<projectId>.json` (`timeline.tracks`, `timeline.clips`, `direction.vfxPlan`, `direction.humorBeats`, `effects`, `transitionIn`).
3. **Execution logs:** Inspect `%APPDATA%\AetheraStudio\cinema-console-logs\<jobId>.log.jsonl` for stage transitions, timeouts, and provider rejections.
4. **Media probe:** Run `ffprobe` on rendered MP4s and acquired clips to verify codecs, pixel format (`yuv420p`), resolution, FPS, and real duration.

## Contract Propagation Checks

- Verify `requestedDurationSec` is the single source of truth from prompt -> interpretation -> script -> TTS -> acquisition -> timeline -> render.
- Verify `vfxPlan`, `humorBeats`, `transitionIn`, motion graphics, and audio tracks survive `produceCinemaPackage` and `renderRealCinemaMp4` without being silently dropped.
- Distinguish optional missing fields (handled explicitly) from required missing resources (traceable failure).
