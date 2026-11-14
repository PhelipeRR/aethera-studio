"""Energy-based speech ranges over PCM16. Audio stays in memory for one call and only timings leave."""

import array
import math
import sys

FRAME_MS = 10
SPEECH_RMS = 0.02
MERGE_GAP_MS = 200


def detect_speech(pcm, sample_rate, check):
    samples = array.array("h")
    samples.frombytes(pcm)
    if sys.byteorder == "big":
        samples.byteswap()
    frame_samples = sample_rate * FRAME_MS // 1000
    ranges = []
    voiced = 0
    frames = len(samples) // frame_samples
    for index in range(frames):
        check()
        frame = samples[index * frame_samples : (index + 1) * frame_samples]
        rms = math.sqrt(sum(value * value for value in frame) / frame_samples) / 32768
        if rms < SPEECH_RMS:
            continue
        voiced += 1
        start = index * FRAME_MS
        if ranges and start - ranges[-1]["endMs"] <= MERGE_GAP_MS:
            ranges[-1]["endMs"] = start + FRAME_MS
        else:
            ranges.append({"startMs": start, "endMs": start + FRAME_MS})
    return {"ranges": ranges, "durationMs": frames * FRAME_MS, "speechRatio": round(voiced / frames, 4) if frames else 0.0}
