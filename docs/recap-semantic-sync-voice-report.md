# Relatório Completo — Sincronização Semântica e Consistência da Voz (Nano Machine Cap. 01)

- **Data:** 2026-11-21T17:04:49.788Z
- **Novo Vídeo Final (MP4):** `C:\dev\neuralbridge-studio\.aethera-recap-data\story-engine-semantic-sync\render\recap-preview.mp4` (9.61 MB · **29.54s**)
- **Caso de Regressão Anterior:** `.aethera-recap-data/story-engine-natural-render/render/recap-preview.mp4` (10.71 MB · 40.00s)
- **Story Memory:** projeto `nano-machine` (1 personagem, 2 eventos) — preservado sem alterações

## Vereditos dos Quality Gates

| Gate | Escopo | Veredito | Principais Métricas |
| --- | --- | --- | --- |
| **Gate G** | Fidelidade Narrativa | `pass` | 2 cenas · estilo `natural_recap` |
| **Gate H** | Qualidade Audiovisual | `pass` | 6 shots · lacunas=0 · duplicados=0 |
| **Gate I** | Sincronização Semântica | `pass` | beats=7 · wavSnapped=3 · score=0.762 · tailExcess=0ms · freezes=0 |
| **Gate J** | Consistência da Voz | `pass` | sessãoÚnica=true · provedor=`voicestudio_tts` · voz=`9190edfa` · sampleRate=48000Hz · clipping=0 |

## Fase 1 — Diagnóstico do Caso de Regressão Anterior (Evidências)

1. **Divisão igualitária por cena (`recap-visual-planner.ts`):** `baseShotMs = Math.floor(sceneDurationMs / shotCount)` fatiava a Cena 1 em 4× `3.5s` idênticos e a Cena 2 em 2× `13.0s`, sem alinhar acontecimentos narrados aos painéis.
2. **+10.0s de silêncio artificial no final:** a narração real media `29.994s` (`13.74s + 0.35s + 15.554s + 0.35s`), mas o planejador estendia a timeline para a estimativa de `40.0s`, congelando `shot-2-1` (close de choque) por `13.0s` e `shot-2-2` por `13.0s` com `10s` mudos.
3. **Mudança brusca de entonação em `14.1s`:** as duas cenas foram sintetizadas em chamadas HTTP separadas e sem estado ao VoiceStudio (`scene-1.wav` e `scene-2.wav`), gerando variação de pitch/prosódia entre blocos; além disso, o encadeamento anterior não travava o provedor durante o vídeo inteiro.
4. **Taxa de amostragem de saída em 96 kHz:** o filtro `loudnorm` do FFmpeg fazia upsampling interno para `96000 Hz` por ausência de `-ar 48000` na saída AAC.

## Comparativo Antes vs. Depois

| Métrica | Antes (Regressão) | Depois (Corrigido) |
| --- | --- | --- |
| Duração total do MP4 | `40.00s` (+10.0s silêncio artificial) | **`29.54s`** (guiada pela narração real) |
| Sessões TTS | 2 chamadas HTTP separadas (salto de tom em 14.1s) | **1 sessão contínua** (`single_session`) |
| Provedor & Voz | `voicestudio_tts` / `9190edfa` (sem trava de sessão) | **`voicestudio_tts` / `9190edfa`** (travado) |
| Alinhamento de painéis | Igualitário (`3.5s × 4`, `13.0s × 2`) | **Semântico + Pausas reais do WAV** |
| Maior duração de um painel | `13.0s` (congelamento excessivo) | **`9.33s`** |
| Sample rate final (MP4) | `96000 Hz` | **`48000 Hz`** |
| Loudness / True Peak | `-13.6 LUFS` / `-0.9 dBFS` | **`-13.4 LUFS` / `-0.9 dBFS`** |

## Fase 2 & 3 — Mapeamento Frase → Acontecimento → Painel → Tempo Real do Áudio

| # | Trecho Narrado (Cláusula) | Fala (Início → Fim) | Painel Associado | Exibição do Painel | Método | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A história começa à noite, em uma floresta nas montanhas, | 0.06s → 3.01s | `nano-machine-cap-01_p0_0` | 0.00s → 3.01s (3.01s) | `speech_envelope_aligned` | 0.67 |
| 2 | onde um jovem ferido corre descalço e em alta velocidade pelo terreno rochoso. | 3.01s → 7.92s | `nano-machine-cap-01_p0_1` | 3.01s → 7.92s (4.91s) | `wav_pause_aligned` | 1.00 |
| 3 | onde um jovem ferido corre descalço e em alta velocidade pelo terreno rochoso. | 7.92s → 11.06s | `nano-machine-cap-01_p0_2` | 7.92s → 11.06s (3.14s) | `speech_envelope_aligned` | 0.83 |
| 4 | Mas, no meio da corrida, o pé dele acaba batendo e se enroscando em uma raiz grossa no chão. | 11.06s → 15.76s | `nano-machine-cap-01_p1_0` | 11.06s → 15.76s (4.71s) | `speech_envelope_aligned` | 0.83 |
| 5 | Em choque, o jovem escorrega da borda de um penhasco à noite e despenca de cabeça gritando. | 15.76s → 20.41s | `nano-machine-cap-01_p1_1` | 15.76s → 20.41s (4.65s) | `speech_envelope_aligned` | 0.83 |
| 6 | No meio da queda, ele se choca com força contra o paredão de pedra e sai quicando. | 20.41s → 25.09s | `nano-machine-cap-01_p1_1` | 20.41s → 25.09s (4.68s) | `wav_pause_aligned` | 0.33 |
| 7 | Logo depois, cai pesadamente no chão lá embaixo, ficando estirado e todo contorcido. | 25.09s → 29.14s | `nano-machine-cap-01_p1_2` | 25.09s → 29.55s (4.46s) | `wav_pause_aligned` | 0.83 |

## Timeline Final de Shots Renderizados (Motion Velix)

| Shot | Painel | Início → Fim | Duração | Motion | Transição |
| --- | --- | --- | --- | --- | --- |
| `shot-1-1` | `nano-machine-cap-01_p0_0` | 0.00s → 3.01s | **3.01s** | `pan_vertical` | `dip_black` |
| `shot-1-2` | `nano-machine-cap-01_p0_1` | 3.01s → 7.92s | **4.91s** | `static_focus` | `cut` |
| `shot-1-3` | `nano-machine-cap-01_p0_2` | 7.92s → 11.06s | **3.14s** | `static_focus` | `cut` |
| `shot-1-4` | `nano-machine-cap-01_p1_0` | 11.06s → 15.76s | **4.71s** | `ken_burns_out` | `cut` |
| `shot-2-5` | `nano-machine-cap-01_p1_1` | 15.76s → 25.09s | **9.33s** | `static_focus` | `cut` |
| `shot-2-6` | `nano-machine-cap-01_p1_2` | 25.09s → 29.55s | **4.46s** | `static_focus` | `cut` |

## Identidade Vocal, Acústica do WAV e Stream Final

- **Provedor TTS:** `voicestudio_tts` · **Voz:** `9190edfa` · **Modelo:** `tts-1` · **Velocidade:** `1` · **Idioma:** `pt-BR`
- **Modo de síntese:** `single_session` (1 arquivo WAV contínuo)
- **Acústica do WAV bruto:** duração=29.25s · sampleRate=24000 Hz · RMS=-19.4 dB · Pico=-2.26 dBFS · Pausas naturais detectadas=10 · Clipping=0 amostras
- **Vídeo final:** `h264` · 1280×720 · FPS 24/1
- **Áudio final:** `aac` · **48000 Hz** · 2 canais
- **Loudness / True Peak:** -13.4 LUFS / -0.9 dBFS
- **Motion Velix:** engine=`ffmpeg_motionvelix_hybrid` · SFX=1/1 (whoosh) · VFX shots=6 · Transições=1