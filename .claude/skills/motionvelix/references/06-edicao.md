# Edição de vídeo existente (pipeline MotionVelix)

Tudo roda com `scripts/mv_edit.py` (FFmpeg) + templates renderizados com `--alpha`.

## Pipeline completo de talking head (F1)

```bash
S=caminho/da/skill
python3 $S/scripts/mv_edit.py info bruto.mp4
python3 $S/scripts/mv_edit.py vertical bruto.mp4 v.mp4 --modo crop --foco 0.5    # se não for 9:16
python3 $S/scripts/mv_edit.py silencio v.mp4 corte.mp4 --db -34 --min 0.32       # tira pausas
python3 $S/scripts/transcrever.py corte.mp4 palavras.json                         # tempos por palavra
#  → monte overlay.json: words (de palavras.json) + heads + keywords + stickers + cta + dur
node $S/engine/render.mjs $S/templates/overlay-talking-head.html overlay.mov --alpha --data overlay.json
python3 $S/scripts/mv_edit.py zoom corte.mp4 zoom.mp4 --em 2.1,5.4:6.2,11 --fator 1.18
python3 $S/scripts/mv_edit.py compor zoom.mp4 overlay.mov comp.mp4
python3 $S/scripts/mv_edit.py musica comp.mp4 trilha.mp3 mix.mp4 --vol 0.2
python3 $S/scripts/mv_edit.py exportar mix.mp4 FINAL.mp4
```

## Escolhendo os tempos de zoom

- Leia `palavras.json` e encontre as palavras de ênfase: números, "nunca", "100%", o nome do produto, o verbo principal e a punchline.
- Faça 1 punch a cada 3–6s. Alterne entre `--fator 1.12` (sutil) e `1.25` (forte).
- Use `--corte` para jump-zoom seco, no estilo YouTube/Hormozi.
- Quando o rosto estiver mais alto ou mais baixo, ajuste `--foco-y` (0,3–0,4).

## Inserts de B-roll / UI no meio da fala

1. Renderize o insert como cena do motor (ex.: janela, dashboard, card) com `--alpha` e `--from/--to`.
2. Componha com offset de tempo: `ffmpeg -i base.mp4 -itsoffset 6.0 -i insert.mov -filter_complex "[0][1]overlay=eof_action=pass" …`
3. Para inserts em tela cheia (que escondem o rosto), faça a cena com fundo opaco.

## Texto atrás da pessoa (V02, V11)

Precisa de máscara da pessoa:

- Remova o fundo com o conector **Magnific `video_remove_background`**, que gera o recorte da pessoa.
- Monte as camadas: vídeo original → texto MotionVelix (--alpha) → pessoa recortada.

```
ffmpeg -i original.mp4 -i texto.mov -i pessoa_alpha.mov -filter_complex "[0][1]overlay[a];[a][2]overlay" …
```

## Cor e acabamento

| Look | Filtro FFmpeg |
|---|---|
| Quente cinematográfico | `eq=contrast=1.06:saturation=1.1,colorbalance=rs=.04:gs=.01:bs=-.04` |
| Frio tech | `colorbalance=rs=-.03:bs=.05,eq=contrast=1.08` |
| Vinheta | `vignette=PI/5` |
| Grão | `noise=alls=6:allf=t` |

- LUTs e color grade com IA: Magnific `video_color_grade` / `video_luts_list`.
- Upscale de vídeo fraco: Magnific `video_upscale`.

## Áudio

- Limpar voz: Magnific `audio_clean_speech` (ou `afftdn=nf=-25,highpass=f=80,lowpass=f=12000` no FFmpeg).
- Trilha: Magnific `audio_music_generate`.
- SFX (whoosh, pop, click): Magnific `audio_sfx_generate`. Posicione cada um com `adelay`.
- Narração para explainer: Magnific `audio_tts`, que gera os tempos por palavra via `audio_timing_get` e já entrega a legenda sincronizada sem transcrever.
- Batidas da trilha: `mv_edit.py batidas trilha.mp3 --salvar beats.json`. Use os tempos como `at` das animações e dos cortes.

## Especificação de export

| Item | Valor |
|---|---|
| Resolução | 1080x1920 |
| Frame rate | 30fps (60fps só para showreel com muito movimento) |
| Vídeo | H.264 High, CRF 18, maxrate 12M |
| Áudio | AAC 192k 48kHz, -14 LUFS, true peak -1 |
| Arquivo | faststart, duração ≤ 90s |

## IA de visão local (`scripts/mv_visao.py`)

| Comando | Faz |
|---|---|
| `reframe IN OUT` | 16:9 → 9:16 com câmera virtual que segue o rosto (zona morta + suavização, sem tremedeira) |
| `rosto IN` | Mede onde está o rosto e sugere `--foco-y` para o zoom |
| `recorte IN OUT.mov` | Recorta a pessoa com fundo transparente (MediaPipe, offline) |
| `atras BASE TEXTO.webm OUT [--pessoa recorte]` | Monta vídeo → texto gigante → pessoa por cima |

**Texto atrás da pessoa (receita):**

```bash
node $S/engine/render.mjs $S/templates/texto-gigante.html texto.webm --alpha --data '{"palavras":[{"t":"MOTION","at":0.3,"dur":3}]}'
python3 $S/scripts/mv_visao.py atras corte.mp4 texto.webm atras.mp4
```

O `--data` aceita um caminho de arquivo JSON ou o JSON direto entre aspas simples.

## Color grade (`mv_edit.py grade`)

- **Looks:** quente, frio, cinema, teal-orange, vibrante, matte, pb, neon.
- **Acabamento:** `--vinheta`, `--grao 3..8`, `--nitidez`.
- Talking head escuro → `cinema --vinheta --grao 4`. Produto/app → `vibrante --nitidez`.

## QC automático (`mv_edit.py qc FINAL.mp4`)

Checa:

- resolução e fps
- duração
- frame 0 com conteúdo
- telas paradas > 2,5s
- tela preta
- loudness (-14 LUFS) e true peak
- tempo até o primeiro som

**Só entregue com APROVADO**, ou explique o porquê.

## Corte na batida

```bash
python3 $S/scripts/mv_edit.py batidas trilha.mp3 --salvar batidas.json
```

Copie a lista `batidas` para o JSON do `kinetic-explainer` (campo `"batidas"`) e cada troca de beat cai numa batida. Em cenas próprias, use os tempos como `at`.
