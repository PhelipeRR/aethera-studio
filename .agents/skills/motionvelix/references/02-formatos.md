# 12 formatos que viralizam (com roteiro-esqueleto e template)

Escolha o formato **antes** do estilo. Cada um traz a referência de origem, a estrutura por tempo e como produzir.

---
### F1 · Talking head turbinado (V02, V11, V01)
**Quando:** a pessoa grava falando e quer edição profissional.
**Estrutura:**

- 0–3s: headline no topo + legenda
- 3–20s: legenda karaokê + 3 a 6 punch-ins + 2 a 4 inserts (UI/B-roll/card)
- final: CTA de comentário

**Produção:**

1. `mv_edit.py silencio`
2. `transcrever.py`
3. Template `overlay-talking-head` (--alpha)
4. `mv_edit.py zoom` nos tempos das palavras-chave
5. `compor`
6. `musica`
7. `exportar`

**Variações:**

- HUD "EDITANDO AO VIVO / CORTE 03/13" (V11)
- texto atrás da pessoa: `texto-gigante` + `mv_visao.py atras` (ver 06-edicao.md)
- tela encolhe para janela + timeline embaixo (V11)

### F2 · Kinetic explainer de números (V12, V07, V06)
**Quando:** explicar uma ideia, um cálculo ou um passo a passo sem aparecer.
**Estrutura:** pergunta → "faz a conta comigo" → 4 a 7 beats (janela, contador, preço, hub, lista) → CTA.
**Produção:** template `kinetic-explainer` + narração (voz real ou TTS do Magnific) + trilha.

### F3 · Anúncio de oferta agressivo (V03)
**Estrutura:**

- "PARE de…" (condensada gigante)
- dor ("página genérica por migalha") + prova visual (mockup estilhaça)
- preço subindo (R$300→5.000)
- "Nível Apple. Feita com IA. Sem programar." (frases empilhadas)
- CTA com botão e mão

**Produção:** `kinetic-explainer` com tema `t-vermelho-glow`, beats `text`, `price` e `cta` (com loop).

### F4 · Tutorial com cursor e canvas (V05)
**Quando:** mostrar um método em passos.
**Estrutura:**

- fundo claro tipo canvas
- pessoa recortada embaixo
- pill "PASSO 1/2/3"
- cursor nomeado voando
- cards de print com anotação à mão ("CARA DE IA")
- final com notificação "te mandou o setup"

**Produção:** `ui-showcase` ou `kinetic-explainer` (tema `t-branco-estudio`) por cima de split; pessoa via `split`.

### F5 · Split-screen B-roll × rosto (V04)
**Estrutura:**

- metade de cima: telas, B-roll e demo
- metade de baixo: rosto
- tarja mono pequena na divisa
- momentos de tela cheia com headline gigante

**Produção:** `mv_edit.py split` + overlay (legenda `s-mono`, capY≈940).

### F6 · Prova / bastidor lo-fi (V06)
**Estrutura:**

- celular filmando o monitor rodando um motion
- caixa de texto nativa no topo: "Esse anúncio foi 100% criado por…"

**Produção:** renderize o motion, toque no monitor e filme com o celular; ou simule com `vertical --modo blur` + overlay.

### F7 · Batalha / comparação (V14)
**Estrutura:**

- título fixo "QUAL O MELHOR?"
- 2 vídeos 16:9 empilhados, cada um com o rótulo da marca
- mesmo roteiro, resultados diferentes
- CTA em tarja

**Produção:** `mv_edit.py comparar` + overlay com títulos.

### F8 · Antes × Depois (V15)
**Estrutura:**

- fundo de foto quente
- celular "Before" pequeno e celular "After" grande
- no After: legendas com glow amarelo + B-roll 3D
- CTA fixo "Comment 'Edit'"

**Produção:** `mv_edit.py antesdepois` + overlay estilo `s-glow`.

### F9 · Showreel / motion reel (V08, V10, V13, V18)
**Estrutura:**

- cortes a cada ~0,6s
- HUD técnico nos cantos e capítulos
- tipografia que "faz o que diz" ("SPIN" gira, "STRETCH" estica)
- formas primárias, padrões, 3D, dashboard
- título final + loop

**Produção:** template `showreel-bauhaus` (troque palavras, cores e título) ou monte cenas novas com o motor.

### F10 · Logo reveal / branding premium (V17, V19, V21)
**Estrutura:**

- ponto de luz → traço → impacto → marca (letra a letra com blur) → tagline → recolhe ao ponto (loop)
- ritmo calmo e easing suave

**Produção:** template `logo-reveal` (serif/sans/wide; aceita `logo` PNG/SVG) ou `particulas-3d` (`--webgl`) para versão 3D com partículas.

### F11 · Lançamento de app/produto (V20, V16, V09)
**Estrutura:**

- foto/ambiente real + cards de UI flutuando
- mão tocando os botões
- headlines curtíssimas com palavra destacada ("Your *usual.*")
- contador em anel, toast "Review posted", logo
- volta ao plano inicial

**Produção:** template `ui-showcase` com `img` dos prints do app.

### F12 · Lyric / kinetic type musical (V16)
**Estrutura:**

- cada palavra da letra em 3D, com perspectiva, blur e mudança de cor por frase
- cenário alterna claro e escuro
- a palavra ganha forma literal ("cell" → grades)

**Produção:** `transcrever.py` na música/narração (ou `audio_timing_get` do Magnific) → template `lyric-kinetic` com `--audio` e `--mb 4`.

---
## Escolha rápida

| Objetivo | Formato |
|---|---|
| Vender curso/serviço | F3, F2 ou F1 |
| Autoridade | F1, F4, F6 ou F7 |
| Portfólio de editor/motion | F9, F8 ou F10 |
| Lançar produto | F11 ou F10 |
| Viralizar em alcance | F7 (polêmica), F8 (prova) ou F2 (curiosidade de dinheiro) |
