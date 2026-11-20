# 11 · Motion do zero com narração + trilha + SFX no beat (ex.: receita)

Referência pronta: `templates/exemplos/receita-bolo/receita-bolo.html` ("Bolo de caneca em 3 minutos", 37s).

## Ordem de produção
1. **Roteiro falado** (30–35s), com tags do eleven_v4: `[excited, warm voice]`, `[pause 0.3s]`, `[amazed]`, `[playful]`.
2. `audio_tts` (voz 1281 Vinícius Cordeiro, stability 0.45) e depois `audio_timing_get`, que dá o tempo de cada palavra.
3. **Abra pausas** na narração onde a animação precisa respirar (contagem, mexer): corte a voz com `atrim` + `adelay`. Mantenha uma função de mapeamento de tempo.
4. Trilha Lyria com BPM explícito no prompt e "steady rhythm from the very first beat". Depois `mv_edit.py batidas trilha.mp3 --salvar bat.json` e `snap(t)` para a batida ou colcheia mais próxima (tolerância de 0,16s).
5. Objetos do Magnific em estilo e câmera iguais ("studio product photo with soft daylight, isolated"), com `transparentBackground`, e depois **sempre** `images_remove_background` (3 créditos) para tirar a sombra branca.
6. Para um "antes e depois" do mesmo objeto, use `images_generate` com `mode: ideogram-4-5` e `preciseEdit` sobre a imagem final. Mantém o enquadramento, então a troca fica encaixada.
7. Render com `--audio voz.wav` e depois `musica` (vol ~0.24), `exportar` e `qc`.

## Regras que evitam "bug" (aprendidas com o cliente)
- **Ordem das camadas:** cartões e cadernos de texto ficam ATRÁS dos objetos que se movem. O objeto que cai dentro de um recipiente fica entre o fundo e o recipiente. Se o caminho do objeto passa por cima de um painel, o painel esconde o objeto.
- **Deixe um corredor livre** de pelo menos 300px entre o painel de texto e o recipiente. O objeto entra pela lateral e paira em cima antes de cair, despejar ou virar.
- Ações por tipo: **cai** (ovo), **despeja** (garrafa gira -128° em torno do gargalo com fio de líquido), **colher** (gira -62° em torno da concha com fio de pó). Cada ação tem impacto na caneca (squash), partículas e som.
- Antes de começar, todo elemento precisa estar fora da tela ou com `opacity:0` no `from`. Valores de `from` valem antes da animação, então um `y:-1000` em algo grande ainda aparece no topo.
- Partículas usam a camada da cena em que aparecem (o parâmetro `pai`). Uma cena escondida esconde as partículas dela.
- Texto gigante: confira a largura. Com Fredoka, "CHOCOLATE" a 190px estoura 1080px; 168px cabe.
- **Não use `--mb`** quando houver números mudando rápido (contadores, display), porque o motion blur mistura os dígitos.
- Para fingir rotação de um objeto 2D, não use scaleX = cos (ele fica fininho). Prefira um balanço pequeno, com brilho girando no prato.
- Cena seguinte com transição por recorte: a cena anterior precisa continuar visível por baixo até a transição terminar, senão aparece um flash de fundo vazio.

## Revisão obrigatória antes de entregar
1. `--preview` com 20–30 tempos-chave e um mosaico rotulado com o tempo.
2. Depois do render: folha densa do vídeo final (`fps=2` no vídeo todo e `fps=4` nas cenas de ação) e **leia as imagens**. Procure objeto escondido, elemento aparecendo antes da hora, texto cortado, frames vazios em transições e dígitos borrados.
3. Só entregue depois de passar pelos itens 1 e 2 e pelo `qc` APROVADO.
