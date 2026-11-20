# 09 · Podcast com cortes de motion (template `podcast-motion.html`)

Use quando o vídeo falado tem pouco espaço para gráficos (rosto ocupa a tela) ou quando o cliente pede "motion pesado".
O vídeo **corta para uma cena de motion em tela cheia com fundo sólido** enquanto a voz continua, e depois volta para a pessoa.
Peça de referência: "O prato mais viral" (Alex Atala · Jota Jota #277), com 7 cenas em 60s.

## Escolher o trecho
- Prefira falas com **objetos, números, lugares, comparações e histórias**. Falas abstratas e emocionais rendem pouco motion.
- 45–60s, com 8–12 trechos emendados (`select/aselect`), cortando dentro dos silêncios (`silencedetect`).

## Ritmo
- Cerca de 50% do tempo em motion. Cada cena dura 1,5–7s, e as que passam de 4s precisam de 2–3 "beats" internos.
- Cubra com cena os planos ruins: plano aberto, entrevistador e reenquadramento errado.
- Cada cena tem uma cor sólida diferente (amarelo, creme, verde, índigo, preto...). As cenas claras trocam a legenda para tinta escura sozinhas.
- Sincronize cada elemento com a palavra exata (`palavras.json`). O objeto aparece quando a palavra é dita.
- Elementos de cena ficam entre y 150 e 1400. A legenda fica em y 1450 (`capY`).

## roteiro.json
```json
{ "dur": 60.1, "credit": "PODCAST · #277", "ac": "#FFC924", "words": [...], "keywords": ["formiga", "mundo"],
  "cenas": [
    { "a": 0, "b": 2.3, "bg": "#FFC924", "entrada": "nenhuma", "els": [
      { "tipo": "texto", "t": "O PRATO", "y": 250, "size": 250, "at": -0.2, "anim": "slam" },
      { "tipo": "img", "src": "/abs/abacaxi.png", "x": 330, "y": 860, "w": 430, "at": 0.28, "anim": "cai", "sombra": true },
      { "tipo": "chip", "t": "+ FORMIGA", "x": 640, "y": 640, "bg": "#D7261E", "cor": "#fff", "rot": 6, "at": 1.98 } ] },
    { "a": 36.35, "b": 45.3, "bg": "#0B0B0C", "saida": "sobe", "els": [
      { "tipo": "mapa", "y": 600, "at": 36.45, "origem": [-23.5, -46.6], "onda": 40.55, "img": "/abs/formiga.png",
        "origemLabel": "BRASIL", "destinos": [ { "ll": [35.7, 139.7], "at": 41.55, "label": "JAPÃO" } ] } ] }
  ],
  "stickers": [ { "t": "🇫🇷 jornalista francês", "at": 20.5, "ate": 23.6 } ] }
```
- **Cena:** `a`, `b`, `bg`, `entrada` (circulo | sobe | direita | esquerda | nenhuma), `saida` (corte | sobe | encolhe), `ox`/`oy` (centro do círculo), `zoom` (ex. 0.035), `claro`.
- **texto:** `t` (com `*destaque*`), `y`, `x?`, `size`, `fonte` (anton | serif | mono | inter), `cor`, `hl`, `caixa: {bg, cor}`, `anim` (slam | mascara | sobe | pop | fade), `risca` (tempo em que o traço vermelho risca a palavra), `sai`, `punch`.
- **img:** `src`, `x`, `y`, `w`, `anim` (cai | pop | dir | esq | baixo | gira | fade), `sombra`, `flutua`, `move: [{at, dx, dy, scale, rot}]`, `sai`.
- **chip:** `t`, `x`, `y`, `bg`, `cor`, `size`, `rot`, `anim` (pop | carimbo).
- **contador:** `de`, `ate`, `at`, `dur`, `prefixo`, `sufixo`, `y`, `size`.
- **traco:** `d` (path ou lista), `x`, `y`, `w`, `h`, `cor`, `esp`, `at`, `dur`, para setas e sublinhados.
- **mapa:** mapa-múndi pontilhado (`assets/mapa-mundi.json`) com `origem` [lat, lon], `onda`, `img`, `origemLabel` e `destinos` [{ll, at, label}].
- Imagens: recortes do Magnific com fundo transparente (`images_generate transparentBackground` + `images_remove_background` se sobrar sombra), sempre em estilo foto de estúdio com flash. O caminho pode ser absoluto (Linux ou Windows).

## Pipeline
```bash
$R $S/templates/podcast-motion.html roteiro.png --alpha --data roteiro.json --preview 1,5,9,...   # confira TODAS as cenas
$R $S/templates/podcast-motion.html overlay.webm --alpha --data roteiro.json
ffmpeg -i corte.mp4 -vf tpad=stop_mode=clone:stop_duration=1.6 -af apad=pad_dur=1.6 -t DUR base.mp4    # se houver cartão final
$E zoom base.mp4 z.mp4 --em <palavras-chave nos trechos de vídeo> --fator 1.12 --foco-y 0.3
$E grade z.mp4 g.mp4 --look cinema --nitidez
$E compor g.mp4 overlay.webm comp.mp4
$E musica comp.mp4 trilha.wav mus.mp4 --vol 0.16      # trilha cortada em DUR com fade-out
$E exportar mus.mp4 FINAL.mp4 && $E qc FINAL.mp4
```
