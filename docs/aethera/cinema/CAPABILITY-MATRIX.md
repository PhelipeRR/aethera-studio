# Capability Matrix & Degradação Graciosa

`probeCapabilities()` verifica em runtime:
- `ffmpeg` / `ffprobe` via `execFileSync` (timeout 2.5s)
- `whisper`, `visionModel`, `remotion`, `gpuNvenc`

Quando uma capacidade está ausente, o sistema registra `degradedReasons` explícitos e aplica fallback determinístico (ex.: `cpu_basic` ou análise determinística de container), nunca inventando resultados externos.
