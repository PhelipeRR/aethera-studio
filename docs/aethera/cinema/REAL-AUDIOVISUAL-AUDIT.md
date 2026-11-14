# AETHERA CINEMA — Auditoria Funcional e Audiovisual Independente

Data da auditoria: 2026-11-13  
Aplicativo auditado: `apps/aethera-desktop` (Aethera Studio independente) + `@neuralbridge/cinema`  
Hardware verificado: NVIDIA GeForce RTX 4060 Ti (8188 MiB VRAM), `ffmpeg 8.1-full_build`, `ffprobe 8.1-full_build`, Windows SAPI PT-BR (`Microsoft Maria Desktop - Portuguese(Brazil)`).

---

## 1. Classificação Honesta por Módulo (`CINEMA-00` a `CINEMA-10`)

Critérios estritos aplicados:
- **Implementação funcional comprovada**: executa de ponta a ponta sobre mídia real ou IPC real do aplicativo, com resultado mensurável verificado fora de mocks.
- **Implementação parcial**: possui motor real/determinístico ou integração parcial, mas ainda depende de síntese procedural/heurística ou carece de modelos externos locais (ex.: Whisper/LLM Vision) para ingestão de mídia bruta arbitrária.
- **Planejamento/contrato**: apenas tipos/contratos sem execução real.
- **Não implementado**: ausente.

| Módulo | Escopo | Classificação | Evidência Real & Limitação Observada |
| :--- | :--- | :--- | :--- |
| **CINEMA-00** | Hardware probe (`ffmpeg`, `ffprobe`, `gpuNvenc`, perfis VRAM 8 GB) + Timeline IR | **Implementação funcional comprovada** | `probeCapabilities()` detectou `ffmpeg`, `ffprobe` e `h264_nvenc` reais. IR versionável em `packages/cinema/src/ir/timeline-ir.ts` exportado para OTIO JSON e usado pelo renderizador real. |
| **CINEMA-01** | Ingestão / Inteligência de Mídia (`whisper`, visão, detecção de cena/silêncio) | **Implementação parcial** | `probeRealMp4` (`packages/cinema/src/qc/real-media-probe.ts`) executa `ffprobe`, `ebur128`, `blackdetect` e `freezedetect` reais sobre MP4 final. Porém, transcrição Whisper e análise semântica por modelo de visão em clipes externos ainda operam em modo degradado/heurístico quando os binários/modelos locais não estão instalados. |
| **CINEMA-02** | Direção Cinematográfica (tratamento, arcos, shots, Plano B) | **Implementação funcional comprovada** | `produceCinemaPackage()` gera tratamento, beats narrativos, shots com enquadramento/movimento de câmera/transição e Plano B; consumido diretamente pelo renderizador FFmpeg e pela UI (`CinemaDirectorPanel.tsx`). |
| **CINEMA-03** | Diretor de Humor (35% padrão, 0% desligado, bloqueio sensível) | **Implementação funcional comprovada** | `ComedyDirector` aplicou humor pontual (`35%`, `cbeat_1_nbeat_3_progression`, `epic_mundane`, pausa `8f`, `sfx_subtle_record_stop`) refletido visualmente na Cena 3 (`HUMOR (35%) - Contraste Editorial`) e testado em A/B (35% vs 0% e bloqueio em contexto sensível). |
| **CINEMA-04** | Motor Editorial & Transições (`xfade`, ritmo, cortes) | **Implementação funcional comprovada** | `renderRealCinemaMp4` aplica 6 cenas com transições `xfade` reais (`fade`, `wipeleft`, `smoothleft`, `slideright`, `dissolve`) e duração total exata de `34.00s` em `h264_nvenc`. |
| **CINEMA-05** | Motion Graphics & Tipografia em Safe-Zone | **Implementação funcional comprovada** | Barra animada (`drawbox`), caixa de terço inferior em safe zone (`y=515`, margem `72px`) e tipografia `drawtext` com fonte `segoeui.ttf` e `expansion=none` verificadas visualmente nos frames PNG extraídos. |
| **CINEMA-06** | VFX & Composição | **Implementação parcial** | `vignette=PI/6` real aplicada no MP4 final e verificada nos frames; composição avançada multicamada em Remotion/alpha matting de vídeo externo ainda depende de assets externos do projeto. |
| **CINEMA-07** | Color Pipeline (Rec.709, `eq`, `limiter`) | **Implementação funcional comprovada** | `colorspace=all=bt709:iall=bt709:fast=1`, `eq=contrast=1.06:saturation=1.12` e `limiter=min=16:max=235` aplicados diretamente no grafo FFmpeg do MP4 final. |
| **CINEMA-08** | Áudio (Narração PT-BR, música, SFX, sidechain ducking, LUFS) | **Implementação funcional comprovada** | Narração real via Windows SAPI (`windows_sapi_tts`), cama harmônica, 3 cues de SFX sincronizados (`5.6s`, `11.2s`, `16.8s`), `sidechaincompress` e `loudnorm=I=-14.0:TP=-1.0:LRA=8.0` medidos via `ebur128` (`-16.0 LUFS`, `-3.9 dBTP`). **Limitação**: voz SAPI é síntese local do SO, não locução neural expressiva. |
| **CINEMA-09** | QC Automático + Reparo Cirúrgico + Re-render | **Implementação funcional comprovada** | `runRealMediaQc` detectou defeito real injetado (`real_qc_black_frames` em `aethera-cinema-defective.mp4`), e após reparo + re-render em `aethera-cinema-demo.mp4` o QC zerou os achados (`blackFramesCount: 0`, `frozenSegmentsCount: 0`). |
| **CINEMA-10** | Integração UI & Fluxo sem CLI (`CinemaDirectorPanel.tsx` + IPC) | **Implementação funcional comprovada** | Botões **"Gerar Direção & Storyboard"** e **"Renderizar MP4 Real (FFmpeg)"** expostos via `window.aetheraBridge.cinemaRenderRealMp4`, exibindo duração, resolução, LUFS, True Peak, black frames e achados QC reais na interface. |

---

## 2. Evidências do Vídeo Real Gerado (34,0s)

- **Arquivo final aprovado**: `docs/aethera/cinema/demo-output/aethera-cinema-demo.mp4`
- **Arquivo com defeito injetado (controle de QC)**: `docs/aethera/cinema/demo-output/aethera-cinema-defective.mp4`
- **Métricas completas em JSON**: `docs/aethera/cinema/demo-output/audit-metrics.json`

### Medições Reais via `ffprobe` / `ffmpeg ebur128` / `blackdetect` / `freezedetect`

| Métrica | Valor Medido (`aethera-cinema-demo.mp4`) | Critério / Meta |
| :--- | :--- | :--- |
| Tamanho em disco | `19.253.196` bytes (~18,4 MiB) | Arquivo MP4 real válido |
| Duração total | `34.00s` | 30s–60s |
| Resolução / FPS | `1280x720` @ `30 fps` | `review_720p` |
| Codec de Vídeo | `h264` via **`h264_nvenc`** (RTX 4060 Ti) | Hardware NVENC |
| Codec de Áudio | `aac` @ `48000 Hz` | Padrão broadcast |
| Delta A/V (`avDurationDeltaSec`) | `0.000s` | `< 0.15s` (sincronia exata) |
| Loudness Integrado (`ebur128`) | `-16.0 LUFS` | `-14 ± 2.5 LUFS` |
| True Peak (`ebur128`) | `-3.9 dBTP` | `<= -1.0 dBTP` |
| Black Frames (`blackdetect`) | `0` segmentos (vs `1` no `defective.mp4`) | `0` |
| Freeze Segments (`freezedetect`) | `0` segmentos | `0` |
| Modo de Narração | `windows_sapi_tts` (PT-BR) | Narração real |

---

## 3. Análise Visual dos Frames Extraídos e Problemas Corrigidos Durante a Auditoria

Frames inspecionados em `docs/aethera/cinema/demo-output/frames/`:
- `frame_01_2s.png` (2s — Ato I)
- `frame_02_8s.png` (8s — Ato II)
- `frame_03_12s.png` (12s — Cena de Humor 35%)
- `frame_04_20s.png` (20s — Ato IV)
- `frame_05_30s.png` (30s — Ato VI)

### Problemas Reais Encontrados e Corrigidos na Própria Auditoria
1. **Crash do FFmpeg `drawtext` no Windows sem `fontfile`**: na primeira execução, `drawtext` falhou com `Fontconfig error` e código `3221225477`. **Correção**: resolução automática de fonte do sistema (`C:/Windows/Fonts/segoeui.ttf`) em `resolveFontOption()` (`packages/cinema/src/render/real-renderer.ts`).
2. **Desaparecimento do título na Cena 3 (`HUMOR (35%)`)**: `drawtext` interpretava `%` como macro de expansão. **Correção**: adicionado `:expansion=none` em `drawtext`, restaurando `"HUMOR (35%) - Contraste Editorial"` com nitidez em `frame_03_12s.png`.
3. **Truncamento de áudio em `24.4s` e falsos positivos de `blackdetect`**: o filtro `amix` reutilizava `[nar]` sem `asplit`, e a luminância procedural inicial estava muito baixa. **Correção**: `asplit=2[nar_sc][nar_mix]` + `atrim=0:34` e elevação da curva de luminância procedural, resultando em `34.00s` exatos e `0` black frames no render limpo.

### Avaliação Qualitativa Honesta
- **Narrativa, Ritmo e Humor (35%)**: A estrutura em 6 atos com transições variadas (`fade`, `wipeleft`, `smoothleft`, `slideright`, `dissolve`) e 1 beat de humor explícito na Cena 3 mantém ritmo constante sem exagero.
- **Legibilidade e Safe-Zone**: A tipografia branca (`34px`) e subtítulo âmbar (`20px`) sobre caixa escura translúcida em `y=515` têm alto contraste e zero corte nas bordas.
- **Áudio e Sincronia**: `avDurationDeltaSec = 0`, ducking real via `sidechaincompress` e True Peak seguro (`-3.9 dBTP`).
- **Limitações Atuais**:
  - O fundo visual do render demonstrativo é **procedural (FFmpeg `geq` + `drawbox`)**, pois não há biblioteca de clipes de gameplay/filmagem real anexada ao repositório.
  - A narração utiliza **Windows SAPI (`Microsoft Maria Desktop`)**, que é inteligível, porém robótica comparada a vozes neurais; além disso, dentro de ambientes Windows sandboxed com bloqueio de registro COM (`0x80045039`), o motor cai para cue procedural de fallback.
  - Whisper e modelos de visão multimodal locais ainda não estão empacotados no instalador.

---

## 4. Verificação de Testes, Build e Interface

- `npm run typecheck`: **PASS** (exit code 0 em todos os workspaces, incluindo `@neuralbridge/cinema` e `@neuralbridge/aethera-desktop`).
- `npx eslint packages/cinema apps/aethera-desktop/src packages/desktop-shared/src/renderer/src/features/video/CinemaDirectorPanel.tsx`: **PASS** (0 erros).
- `npm run build:aethera`: **PASS** (electron-vite main + preload + renderer).
- `npx vitest run packages/cinema/test/cinema.test.ts apps/aethera-desktop/test/aethera-app.test.ts`: **PASS** (`10 passed`).
- `npx playwright test tests/e2e/aethera-redesign.spec.ts tests/e2e/sep-apps-smoke.spec.ts`: **PASS** (`4 passed`).
