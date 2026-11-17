# P1 — Audio-First Timeline: evidência real

Execução: 2026-11-17, run `20261117162819`.

## Fonte local reutilizada

- Arquivo: `C:\dev\neuralbridge-studio\artifacts\creative-studio-cs6\cyberpunk-2077-clip.mp4`
- SHA-256: `db64afb8c1f43b6efdad4029d820f2e7c04b3b0728f797818100638af3dc37bc`
- Aquisição: reutilizado sem download (`reusedWithoutDownload: true`)

## Audit de áudio

| Medição | Resultado |
|---|---:|
| Duração planejada | 1,800 ms |
| Narração medida por ffprobe | 19,285 ms |
| Duração final da timeline | 19,285 ms |
| Ajuste aplicado | +17,485 ms na última cena, antes da concatenação FFmpeg |
| Master de áudio medido | 19,285 ms |
| Palavras enviadas ao TTS | 36 |
| Provedor efetivo | `windows_sapi_tts` |

A fala mais longa estendeu a cena antes da montagem final. Não houve `atrim` no caminho da narração, truncamento por `Math.min`, nem congelamento de quadro: `frozenSegmentsCount = 0`.

## MP4 validado

- Arquivo: `C:\dev\neuralbridge-studio\artifacts\aethera-p1-audio-first\20261117162819\render\cyberpunk-audio-first.mp4`
- FFprobe: 1280×720, 30 fps, H.264, AAC, 48 kHz, 19,285 s
- A/V duration delta: `0.018 s`
- Loudness: `-14 LUFS`; true peak: `-1 dBTP`
- Black frames: `0`; frozen segments: `0`; silêncios prolongados: `0`
- `deliveryValidation.valid`: `true`

Relatório completo: `C:\dev\neuralbridge-studio\artifacts\aethera-p1-audio-first\20261117162819\report.json`.

## Cache e retomada

O primeiro render registrou `narrationCacheHits: 0` e gravou WAV + metadata de provedor no `segment-cache/voice-segments`. O teste de correção visual verifica que uma segunda renderização reutiliza os segmentos de narração e preserva a duração medida. O audit é serializável no `RealRenderResult` e também é copiado para o checkpoint de `StagedProductionJob`, sem credenciais.

Esta é evidência focada de P1, não a conclusão do E2E de 60 segundos. P2 e P6 continuam não iniciados.
