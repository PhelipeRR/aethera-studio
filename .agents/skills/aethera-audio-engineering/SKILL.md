---
name: aethera-audio-engineering
description: Engineer music, semantic SFX, narration sync, and FFmpeg audio QA in Aethera Studio. Trigger when fixing empty music tracks, mismatched SFX, clipping, silence gaps, loudness (-14 LUFS), or narration-to-video timing.
---

# Aethera Audio Engineering

Guarantee clean narration, mood-matched music with ducking, semantically matched SFX, and objective FFmpeg audio measurements.

## Music Rules

1. Select background music by narrative mood, energy, and tempo from local library or permitted external sources.
2. Loop with crossfade when the track is shorter than `requestedDurationSec`; apply fade-in at start and fade-out at end.
3. Duck music under `A1_narration` (target integrated loudness around `-14 LUFS`, narration clearly intelligible over music).
4. If no suitable track exists, record an explicit traceable fallback/diagnostic instead of leaving `a_mus` silently empty.

## Semantic SFX Rules

Never pick SFX solely by filename availability. Match every SFX by:
- Event type (`transition`, `impact`, `reveal`, `ui_pop`, `comic_sting`, `whoosh`)
- Scene context & domain (e.g., gaming/editorial transitions must reject unrelated vehicle/animal/ambient recordings like motorcycles)
- Intensity, placement timestamp, duration, and mix compatibility.

## Objective Audio QA (FFmpeg)

Verify rendered audio with FFmpeg filters (`astats`, `ebur128`, `silencedetect`):
- **Clipping:** Peak `< -0.5 dBTP` / zero clipped samples.
- **Unexpected silence:** Detect unintended long silence gaps inside active narration/music windows.
- **Abrupt cuts / join distortion:** Check segment boundaries for clicks/pops or missing fades.
- **Noise reduction guard:** Never apply aggressive noise reduction without verifying narration clarity is preserved.
- **Duration sync:** Do not speed up TTS artificially to hide script/duration budget errors.
