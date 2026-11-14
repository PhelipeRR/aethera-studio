# Aethera Studio — Produção Completa em Novo Tema (`Telescópio James Webb & Buracos Negros`)

**Data:** 2026-11-14  
**Objetivo:** Validar todo o motor do Aethera Studio em um tema inédito (documentário científico), executando pesquisa de ativos reais, download de mídia pública da NASA, planejamento via `produceCinemaPackage`, narração PT-BR no **VoiceStudio**, validação bloqueadora pelo **Diretor de Som**, renderização `h264_nvenc` e auditoria técnica + visual.

---

## 1. Pesquisa & Procedência dos Ativos Baixados (`images-api.nasa.gov`)

Todos os ativos foram pesquisados e baixados em domínio público da **NASA Image and Video Library** e registrados em [provenance.json](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/space-doc/provenance.json):

| Arquivo Local | Tipo | Título / Origem NASA | Uso no Vídeo |
| :--- | :--- | :--- | :--- |
| `jwst_deep_field.jpg` | Imagem | NASA Webb First Deep Field briefing (`STScI` / NASA) | Cena 01 & Cena 08 |
| `jwst_mirror.jpg` | Imagem | *Being "Secondary" is Important for a Webb Telescope Mirror* (`GSFC`) | Cena 02 |
| `nasa_jwst_highlights.mp4` | Vídeo (`7s`, `-an`) | *First Images from the James Webb Space Telescope (Official NASA Highlights)* | Cena 03 |
| `jwst_carina.jpg` | Imagem | *NIRCam Image of the "Cosmic Cliffs" in Carina Nebula* (`STScI`) | Cena 04 (Humor 35%) |
| `jwst_pillars.jpg` | Imagem | *The Eagle Nebula Observed by WISE* (`JPL` / `PIA25433`) | Cena 05 |
| `nasa_black_holes.mp4` | Vídeo (`7s`, `-an`) | *NuSTAR - Hunting Hidden Black Holes* (`JPL`) | Cena 06 |
| `black_hole_m87.jpg` | Imagem | *Spitzer Captures Messier 87* (`JPL` / `PIA23122`) | Cena 07 (Clímax) |

---

## 2. Resultado da Execução do Motor Completo

- **MP4 Final:** [aethera-space-doc.mp4](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/space-doc/aethera-space-doc.mp4)
- **Stem de Voz A1:** [A1_narration.wav](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/space-doc/stems/A1_narration.wav)
- **Métricas Reais (`ffprobe` + `ebur128` + `SoundDirector`):**
  - Duração: `51.25s` (`1280x720 @ 30 fps`, `h264_nvenc`, `aac 48kHz`, `35.360.070 bytes`).
  - Dessincronia A/V: `0.017s`.
  - Loudness: `-14.6 LUFS`, True Peak `-1.4 dBTP`.
  - **Diretor de Som (`SoundDirectorAuditReport`):** `approved: true`, `0` sobreposições de fala (`narration_overlap: 0`), `0` truncamentos (`narration_truncated: 0`), `1` aviso transparente de respiro curto entre `nar_2` e `nar_3` (`64ms`, abaixo do ideal de `200ms`).
  - `blackFramesCount: 1` (apenas o `fade-in` inicial em `t=0`).

---

## 3. Inspeção Visual dos Frames Extraídos

Frames verificados manualmente via `read_file`:
- [frame_01_3s.png](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/space-doc/frames/frame_01_3s.png): *lower-third* legível (`ATO I · OLHANDO PARA O PASSADO`); **observação honesta:** a primeira busca da NASA para `"Webb First Deep Field"` retornou uma foto de coletiva com apresentadoras diante do telão em vez da foto pura da nebulosa.
- [frame_02_10s.png](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/space-doc/frames/frame_02_10s.png): Engenheiros em sala limpa manipulando o espelho dourado do Webb — composição nítida e fiel ao texto.
- [frame_04_23s.png](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/space-doc/frames/frame_04_23s.png): Penhascos Cósmicos da Nebulosa Carina com tarja `MODO HUMOR 35% - CONTRASTE EDITORIAL` e tipografia limpa.
- [frame_07_43s.png](file:///c:/dev/neuralbridge-studio/docs/aethera/cinema/space-doc/frames/frame_07_43s.png): Jato relativístico de M87* com `climax_zoom` + `unsharp`.
