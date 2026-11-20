# Linguagem de motion (o "como mexe")

## Motor MotionVelix: `engine/mv.js`

O motor é determinístico: cada frame é calculado do zero por `MV.seek(t)`. Por isso o render sai perfeito em qualquer fps, sem "pular frame". Ele não tem dependências e o código é seu, sem licença de terceiros.

```js
MV.setup({ w:1080, h:1920, fps:30, dur:12 });          // SEMPRE no fim do script
MV.to(sel, { from:{...}, to:{...}, at:1.2, dur:.6, ease:'mv', stagger:.06 });
MV.fn(a, b, (tLocal, p, tGlobal) => {...});           // desenho livre (canvas, física, contadores)
MV.words(el, {mask:true})  // quebra texto em palavras; *destaque* (pode ter várias palavras) vira .hl
MV.chars(el)               // quebra em letras
MV.type(el, 'texto', at, dur)            // máquina de escrever com cursor
MV.count(el, 0, 5000, at, dur, {prefix:'R$ ', dec:0})   // contador pt-BR (1.234,56)
MV.draw('path', at, dur)                 // desenha traço SVG
MV.follow('circle', 'path', at, dur)     // ponto viajando no traço
MV.rand(seed)                            // aleatório determinístico (NUNCA use Math.random)
```

**Propriedades animáveis:** `x y z scale sx sy rot rx ry skx opacity blur bright sat clipT clipR clipB clipL ls width height radius`

## Presets (`MV.fx.*`): a assinatura visual

| Preset | O que faz | Quando usar |
|---|---|---|
| `maskUp` | Palavra sobe de dentro de uma máscara (stagger .06) | Headlines. É o padrão premium |
| `rise` | Sobe 60px + fade + desblur | Subtítulos, kickers, cards |
| `blurIn` | Entra de muito desfocado e grande | Palavras soltas cinematográficas (V17, V01) |
| `slam` | Bate de 2,4x para 1x muito rápido | Preço, número, palavra de impacto + `shake` |
| `pop` | Escala com overshoot (outBack) | Chips, stickers, botões, ícones |
| `slideL` | Desliza lateral | Itens de lista |
| `wipeR` | Revela por máscara da esquerda para a direita | Tarjas, barras, highlight de marca-texto |
| `flip3d` | Gira em X vindo do fundo | Cards e janelas 3D (V16) |
| `punch` | Bump de escala com elástico | Clique, ênfase, batida |
| `shake` | Tremor curto | Impacto (junto com slam) |
| `out` | Sai com blur e subida | Saída padrão de qualquer elemento |
| `dim` | Esmaece para 28% | Linha anterior quando a nova entra (V03, V12) |

## Easing: a regra de ouro

- **Entradas:** `mv` (quint out) ou `outExpo`. Rápido no começo, assenta longo. É o look profissional.
- **Saídas:** `inCubic` ou `inExpo`. Acelera para fora.
- **Movimento de câmera/ida-e-volta:** `inOutCubic` ou `inOutExpo`.
- **Objetos físicos e UI:** `outBack`, `spring` ou `outElastic` (só em coisas pequenas).
- **Nunca use `linear`**, exceto em barra de progresso, rotação contínua e deriva de fundo.

## Durações

| Ação | Tempo |
|---|---|
| Entrada de palavra | 0,35–0,6s · stagger 0,05–0,08s |
| Card / janela | 0,6–0,8s |
| Saída | 0,25–0,35s, sempre mais rápida que a entrada |
| Beat de texto (talking head) | 1,8–2,6s |
| Corte (showreel) | 0,5–0,8s |
| Sobreposição entre beats | 0,15–0,2s. Nunca deixe a tela vazia |

## Transições (todas usadas nas referências)

- **Match-cut de forma:** a bola vira o "O" de MOTION (V10); a bola achatada vira a barra que preenche a tela (template bauhaus).
- **Zoom-through:** a câmera entra na tela do celular até o próximo cenário (V16).
- **Whip/blur lateral:** sai com `x:-1400, blur:24` em 0,3s inExpo.
- **Wipe de faixas coloridas** diagonais (V10, V18).
- **Flash de luz** (radial screen) no impacto (V17, template logo).
- **Dissolve com blur** (`out` + `blurIn` sobrepostos).
- **Mudar claro↔escuro** a cada cena (V01, V19).

## Efeitos de texto prontos para copiar

```js
// palavra que "faz o que diz"
MV.to('#spin', {from:{rot:-180,scale:0},to:{rot:0,scale:1},at:2,dur:.7,ease:'outBack'});
MV.to('#stretch', {from:{sx:.2},to:{sx:1},at:3,dur:.5,ease:'outElastic'});
// linha anterior esmaece quando a nova entra (empilhar)
MV.fx.dim('.l1', 2.0); MV.fx.maskUp(MV.words('.l2',{mask:true}), 2.0);
// marca-texto atrás da palavra
MV.to('.hlbox', {from:{clipR:100},to:{clipR:0},at:1.1,dur:.35,ease:'inOutExpo'});
// número com blur rolando (V03)
MV.count('#preco',300,5000,1,1.2,{prefix:'R$ '}); MV.to('#preco',{from:{blur:12},to:{blur:0},at:1,dur:1.2,ease:'outExpo'});
```

## Ambiente (o fundo nunca para)

- Glow respirando: `MV.fn(0,DUR,lt=>{bg.style.scale=1+.04*Math.sin(lt*.8)})`
- Deriva de câmera: o contêiner inteiro faz `scale` de 1 para 1,04 ao longo da cena.
- Grão: `.grain` com opacidade de 0,06.
- Partículas e pontos: use `MV.rand(seed)` para posições estáveis entre frames.

## Efeitos sonoros sincronizados (MV.sfx)

```js
MV.sfx('whoosh', 1.2, .7)      // nome da biblioteca (assets/sfx) ou caminho de um .wav; volume 0–1
```

- Os presets já tocam som: `pop`→pop, `slam`→impacto, `slideL`/`wipeR`→whoosh_rapido, `flip3d`→whoosh, `punch`→tap. `MV.type`→digitando.
- Desligue com `{sfx:false}` ou troque com `{sfx:'click'}`.
- **Biblioteca (19 sons originais, uso comercial livre):** whoosh, whoosh_rapido, whoosh_grave, swish_reverso, pop, pop_agudo, click, tap, digitando, impacto, boom, riser, ding, sucesso, dinheiro, glitch, brilho, obturador, drop.
- **Regras de mixagem:**
  - Transição: whoosh em -6 a -10 dB (vol .4–.6).
  - Impacto: só em 1–2 momentos-chave por vídeo.
  - Riser: termina exatamente no impacto.
  - Nunca use mais de 2 SFX no mesmo 0,3s.

## Motion blur (render final)

`--mb 4` renderiza 4 subframes por frame com obturador de 180° e faz a média. O movimento rápido fica com o borrão natural de câmera. É o detalhe que mais separa "feito no PowerPoint" de "feito no After Effects". Custa 4x o tempo de render: use só no render final.

## Lottie (milhares de animações prontas do LottieFiles/After Effects)

```html
<script src="../engine/vendor/lottie.min.js"></script>
<div id="ic" style="position:absolute;left:340px;top:700px;width:400px;height:400px"></div>
<script> MV.lottie('#ic', 'icone.json', 1.2, {speed:1, loop:false}) </script>
```

É controlado frame a frame pelo motor (determinístico). Ótimo para ícones animados, emojis, setas, check, confete. Verifique a licença do arquivo Lottie que o usuário trouxer.

## 3D com Three.js (WebGL)

- `engine/vendor/three.module.min.js` (MIT). Use `<script type="module">` e `import * as THREE from '../engine/vendor/three.module.min.js'`.
- Crie o renderer com `preserveDrawingBuffer:true` e chame `renderer.render()` dentro de `MV.fn(-1,1e9,…)`.
- Assets assíncronos (fontes, texturas): coloque em `window.MV_READY = (async()=>{...})()`.
- Render com `--webgl`. Exemplo completo: `templates/particulas-3d.html` (esfera → texto de partículas → galáxia).

## Preferência do cliente (Rodri): transições leves

**Evite whoosh pesado/grave nas transições.** Prefira `deslize`, `bolha`, `blip`, `tic` ou `tap` (ver atualização no fim), em volume baixo (0,3–0,5). Reserve `whoosh_grave` e `boom` para no máximo um momento de revelação por vídeo.

### Atualização de som (23/10): transições sem "papel passando"
O cliente achou o `swish_suave` (som de papel passando) alto e incômodo. O padrão agora é:
- **Troca de cena ou de celular:** `deslize`, um "uíp" tonal curtinho e macio, a 0,3. Na volta, use `deslize_reverso`.
- **Riscar, marcar:** `traco` a 0,4, no lugar de `papel`.
- **Entrada de elemento:** `pop`, `bolha`, `tic` ou `blip`.
- `swish_suave`, `whoosh*` e `papel` só se o cliente pedir.
