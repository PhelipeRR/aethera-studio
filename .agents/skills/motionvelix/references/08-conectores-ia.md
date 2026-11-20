# Conectores de IA: o que levar o vídeo ao nível "estúdio"

A skill funciona 100% local. Com conectores, ela ganha voz, música, cenas geradas por IA e recorte profissional.

**Regra geral:** antes de gerar, verifique os créditos (`account_balance` no Magnific) e avise o custo estimado. Gere, espere (`creations_wait`), pegue a URL (`creations_get` → `url`) e baixe para a pasta de trabalho com `curl -L -o arquivo URL`.

## Magnific (recomendado)

| Precisa de… | Ferramenta | Como usar no MotionVelix |
|---|---|---|
| Narração profissional | `audio_voices_list` → `audio_tts` (ElevenLabs v4) | Leia `audio_tts_direction` antes de escrever o texto. Baixe o mp3 e use como `--audio` no render |
| Legenda perfeita da narração | `audio_timing_get(creationIdentifier)` | Devolve tempo por palavra: monte `words:[{w,s,e}]` para `overlay-talking-head` ou `lyric-kinetic`. Não precisa transcrever |
| Narração com SUA voz | `audio_voice_clone` → `audio_tts` com `source:"mine"` | Grave 1 minuto limpo do usuário uma vez |
| Trilha original | `audio_music_generate` (google-lyria-3-pro, 30–180s) | Prompt: gênero, BPM, energia, "no vocals". Depois rode `mv_edit.py batidas` e passe as batidas ao template (`batidas`) |
| SFX específico | `audio_sfx_generate` (1–3s) | Para sons que a biblioteca local não tem. Salve em `assets/sfx/<nome>.wav` e use `MV.sfx('nome', t)` |
| Limpar áudio ruim | `audio_clean_speech` / `audio_isolate` | Antes do `silencio` |
| Cena B-roll / insert cinematográfico | `video_models_list` → `video_generate` (9:16, 3–8s) | Insira com `mv_edit.py compor` ou concatene entre falas |
| Objeto 3D still-life (estilo V15) | `images_generate` (com `transparentBackground` se o modelo suportar) | Use como `<img>` numa cena do motor com `flip3d`/`pop` e sombra |
| Texto atrás da pessoa (qualidade máxima) | `video_remove_background` (model `Portrait` ou `Matting`, saída webm) | Clipe ≤ 20s. Baixe o .webm e rode `mv_visao.py atras base.mp4 texto.webm out.mp4 --pessoa recorte.webm` |
| Vídeo com qualidade ruim | `video_upscale` | Antes de editar |
| Look de cinema | `video_color_grade` / `video_luts_list` | Alternativa ao `mv_edit.py grade` |
| Remover silêncios com IA | `video_magic_cut` | Alternativa ao `mv_edit.py silencio` |
| Marca do cliente | `brand_kit_create` / `brand_kit_scrape_url` (site do cliente) | Extraia as cores e crie um tema `.t-cliente` (ver 03-estilos) |

**Enviar arquivo local ao Magnific:**

1. `creations_request_upload(mimeType)` devolve uma URL PUT.
2. `curl -X PUT -T arquivo "URL"`.
3. `creations_finalize_upload` devolve o identificador.

## Figma

- `get_screenshot` / `get_design_context`: puxa as telas do app/site do cliente para o template `ui-showcase` (`scenes[].img`).
- `get_motion_context`: lê animações/protótipos do Figma para replicar o timing.
- `get_variable_defs`: lê cores e fontes do design system e as converte em tema MotionVelix.

## Sem conectores (fallback local)

| Recurso | Ferramenta local |
|---|---|
| Voz | Grave no celular e use `mv_edit.py silencio` |
| Legenda | `transcrever.py` (sherpa-onnx, com faster-whisper opcional) |
| Trilha | Música livre de direitos do usuário + `mv_edit.py musica` (ducking automático) |
| SFX | Biblioteca local de 19 sons sintetizados (`assets/sfx`, uso comercial livre) |
| Recorte de pessoa | `mv_visao.py recorte` (MediaPipe, Python ≤ 3.12) |


## Higgsfield (se estiver conectado via MCP)

Use as ferramentas do Higgsfield que aparecerem na sessão para gerar cenas cinematográficas, B-roll e movimentos de câmera por IA quando o vídeo precisar de imagem que o usuário não tem. Mesmas regras do Magnific: avise o custo em créditos antes, gere só depois do plano aprovado, e prefira o motor próprio (`engine/`) para tipografia, legendas e motion graphics.
