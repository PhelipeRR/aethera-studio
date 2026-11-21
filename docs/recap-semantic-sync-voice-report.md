# Relatório Completo — Sincronização Semântica e Consistência da Voz (Nano Machine Cap. 01)

- **Data:** 2026-11-21T17:13:16.454Z
- **Novo Vídeo Final (MP4):** `C:\dev\neuralbridge-studio\.aethera-recap-data\story-engine-semantic-sync-v2\render\recap-preview.mp4` (7.01 MB · **29.57s**)
- **Caso de Regressão Anterior:** `.aethera-recap-data/story-engine-natural-render/render/recap-preview.mp4` (10.71 MB · 40.00s)
- **Story Memory:** projeto `nano-machine` (1 personagem, 2 eventos) — preservado sem alterações

## Vereditos dos Quality Gates

| Gate | Escopo | Veredito | Principais Métricas |
| --- | --- | --- | --- |
| **Gate G** | Fidelidade Narrativa | `pass` | 2 cenas · estilo `natural_recap` |
| **Gate H** | Qualidade Audiovisual | `pass` | 6 shots · lacunas=0 · duplicados=0 |
| **Gate I** | Sincronização Semântica | `pass` | beats=8 · whisperWordAligned=8 · score=0.844 · tailExcess=0ms · freezes=0 |
| **Gate J** | Consistência da Voz | `pass` | sessãoÚnica=true · provedor=`voicestudio_tts` · voz=`9190edfa` · ΔRMS intra=1.77dB · ΔZCR intra=0.0253 · sampleRate=48000Hz · clipping=0 |

## Fase 1 — Diagnóstico do Caso de Regressão Anterior (Evidências)

1. **Divisão igualitária por cena (`recap-visual-planner.ts`):** `baseShotMs = Math.floor(sceneDurationMs / shotCount)` fatiava a Cena 1 em 4× `3.5s` idênticos e a Cena 2 em 2× `13.0s`, sem alinhar acontecimentos narrados aos painéis.
2. **+10.0s de silêncio artificial no final:** a narração real media `29.994s` (`13.74s + 0.35s + 15.554s + 0.35s`), mas o planejador estendia a timeline para a estimativa de `40.0s`, congelando `shot-2-1` (close de choque) por `13.0s` e `shot-2-2` por `13.0s` com `10s` mudos.
3. **Mudança brusca de entonação em `14.1s`:** as duas cenas foram sintetizadas em chamadas HTTP separadas e sem estado ao VoiceStudio (`scene-1.wav` e `scene-2.wav`), gerando variação de pitch/prosódia entre blocos; além disso, o encadeamento anterior não travava o provedor durante o vídeo inteiro.
4. **Taxa de amostragem de saída em 96 kHz:** o filtro `loudnorm` do FFmpeg fazia upsampling interno para `96000 Hz` por ausência de `-ar 48000` na saída AAC.

## Comparativo Antes vs. Depois

| Métrica | Antes (Regressão) | Depois (Corrigido) |
| --- | --- | --- |
| Duração total do MP4 | `40.00s` (+10.0s silêncio artificial) | **`29.57s`** (guiada pela narração real) |
| Sessões TTS | 2 chamadas HTTP separadas (salto de tom em 14.1s) | **1 sessão contínua** (`single_session`) |
| Provedor & Voz | `voicestudio_tts` / `9190edfa` (sem trava de sessão) | **`voicestudio_tts` / `9190edfa`** (travado) |
| Alinhamento de painéis | Igualitário (`3.5s × 4`, `13.0s × 2`) | **Semântico + Pausas reais do WAV** |
| Maior duração de um painel | `13.0s` (congelamento excessivo) | **`13.66s`** |
| Sample rate final (MP4) | `96000 Hz` | **`48000 Hz`** |
| Loudness / True Peak | `-13.6 LUFS` / `-0.9 dBFS` | **`-13.2 LUFS` / `-0.8 dBFS`** |

## Fase 2 & 3 — Mapeamento Frase → Acontecimento → Painel → Tempo Real do Áudio

| # | Trecho Narrado (Cláusula) | Fala (Início → Fim) | Painel Associado | Exibição do Painel | Método | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A história começa à noite, em uma floresta nas montanhas, | 0.07s → 3.08s | `nano-machine-cap-01_p0_0` | 0.00s → 3.24s (3.24s) | `whisper_word_aligned` | 0.67 |
| 2 | onde um jovem ferido corre descalço e em alta velocidade pelo terreno rochoso. | 3.40s → 7.68s | `nano-machine-cap-01_p0_1` | 3.24s → 7.90s (4.67s) | `whisper_word_aligned` | 1.00 |
| 3 | Mas, no meio da corrida, o pé dele acaba batendo | 8.12s → 10.95s | `nano-machine-cap-01_p0_2` | 7.90s → 11.10s (3.19s) | `whisper_word_aligned` | 0.25 |
| 4 | e se enroscando em uma raiz grossa no chão. | 11.25s → 13.27s | `nano-machine-cap-01_p1_0` | 11.10s → 13.53s (2.43s) | `whisper_word_aligned` | 1.00 |
| 5 | Em choque, o jovem escorrega da borda | 13.79s → 15.89s | `nano-machine-cap-01_p1_1` | 13.53s → 15.91s (2.38s) | `whisper_word_aligned` | 1.00 |
| 6 | de um penhasco à noite e despenca de cabeça gritando. | 15.93s → 18.92s | `nano-machine-cap-01_p1_2` | 15.91s → 19.15s (3.23s) | `whisper_word_aligned` | 1.00 |
| 7 | No meio da queda, ele se choca com força contra o paredão de pedra e sai quicando. | 19.38s → 23.72s | `nano-machine-cap-01_p1_2` | 19.15s → 23.88s (4.73s) | `whisper_word_aligned` | 1.00 |
| 8 | Logo depois, cai pesadamente no chão lá embaixo, ficando estirado e todo contorcido. | 24.02s → 29.27s | `nano-machine-cap-01_p1_2` | 23.88s → 29.57s (5.70s) | `whisper_word_aligned` | 0.83 |

## Timeline Final de Shots Renderizados (Motion Velix)

| Shot | Painel | Início → Fim | Duração | Motion | Transição |
| --- | --- | --- | --- | --- | --- |
| `shot-1-1` | `nano-machine-cap-01_p0_0` | 0.00s → 3.24s | **3.24s** | `pan_vertical` | `dip_black` |
| `shot-1-2` | `nano-machine-cap-01_p0_1` | 3.24s → 7.90s | **4.67s** | `static_focus` | `cut` |
| `shot-1-3` | `nano-machine-cap-01_p0_2` | 7.90s → 11.10s | **3.19s** | `static_focus` | `cut` |
| `shot-1-4` | `nano-machine-cap-01_p1_0` | 11.10s → 13.53s | **2.43s** | `ken_burns_out` | `cut` |
| `shot-2-5` | `nano-machine-cap-01_p1_1` | 13.53s → 15.91s | **2.38s** | `static_focus` | `cut` |
| `shot-2-6` | `nano-machine-cap-01_p1_2` | 15.91s → 29.57s | **13.66s** | `pan_vertical` | `cut` |

## Identidade Vocal, Acústica do WAV e Stream Final

- **Provedor TTS:** `voicestudio_tts` · **Voz:** `9190edfa` · **Modelo:** `tts-1` · **Velocidade:** `1` · **Idioma:** `pt-BR`
- **Modo de síntese:** `single_session` (1 arquivo WAV contínuo)
- **Acústica do WAV bruto:** duração=29.27s · sampleRate=24000 Hz · RMS=-18.55 dB · Pico=-1.92 dBFS · Pausas naturais detectadas=14 · Clipping=0 amostras
- **Vídeo final:** `h264` · 1280×720 · FPS 24/1
- **Áudio final:** `aac` · **48000 Hz** · 2 canais
- **Loudness / True Peak:** -13.2 LUFS / -0.8 dBFS
- **Motion Velix:** engine=`ffmpeg_motionvelix_hybrid` · SFX=1/1 (whoosh) · VFX shots=6 · Transições=1