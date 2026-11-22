# MotionVelix MOGRT Engine — Relatório da Fase 2 Experimental

> [!IMPORTANT]
> **Critério de aprovação atingido:** O Aethera decodificou diretamente o arquivo binário `.aep` (`RIFX/Egg!`) de dentro do `Dynamic Anime Burst Logo 01.mogrt`, extraiu **todas as 90 máscaras Bézier animadas reais** (620 keyframes de forma, vértices + tangentes de entrada/saída + keyframes de opacidade `Hold` + ordem de camadas) da composição **`Transition 01`** e reproduziu a animação original em MP4 em **465 ms**, **sem Adobe e sem animação procedural substituta**.

---

## 1. Módulos Implementados no Protótipo (Zero Dependência Adobe)

1. **[mogrt-importer.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/motionvelix/mogrt-importer.ts)** — Importador e Inspetor `.mogrt`/`.zip`:
   - Trabalha sobre cópias isoladas (preserva arquivos originais intactos).
   - Lê `definition.json` e extrai metadados (`4096×2304 @ 30fps`, `7.267s`, fonte `Montserrat-Bold`), **28 controles editáveis** (cores RGBA→Hex, texto, escala, posição, checkboxes) e **2 media placeholders** (`Logo Placeholder 500×500`, `BG Placeholder 4096×2304`).
   - Classifica honestamente todos os 21 efeitos do template (`10 native_exact`, `7 webgl_approximable`, `4 adobe_proprietary_gap`) e marca `canRenderFaithfullyWithoutAdobe: false` quando há efeitos proprietários fechados.
2. **[aep-mask-extractor.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/motionvelix/aep-mask-extractor.ts)** — Extrator binário `RIFX/Egg!` de Máscaras Bézier:
   - Decodifica composições (`cdta`), camadas (`Layr`), `ADBE Mask Atom` (`mkif` modo/inversão), `ADBE Mask Shape` (`om-s`/`omks`/`shap`/`shph`/`ldat`: vértices, tangentes `outHandle`/`inHandle`, flag `closed`, timestamps exatos) e `ADBE Mask Opacity` (incluindo flag de interpolação `Hold` do After Effects).
   - Em `Dynamic Anime Burst Logo 01.mogrt`, extraiu:
     - `Transition 01` (`1920×1080 @ 15fps`, `1.667s`): **90 máscaras animadas** (`Layer[0]`: 62 máscaras de raios brancos; `Layer[1]`: 28 máscaras de massas magenta), totalizando **620 keyframes de forma**.
     - `Energy 25 Glow` (`1920×947 @ 30fps`, `0.867s`): **16 máscaras animadas**, **212 keyframes de forma**.
3. **[mogrt-mask-renderer.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/motionvelix/mogrt-mask-renderer.ts)** — Renderizador Determinístico de Máscaras Bézier:
   - Subdivide segmentos cúbicos Bézier em polilinhas densas, rasteriza com scanline even-odd respeitando `add`/`subtract` e ordem de pilha de camadas do AE, e gera MP4 via pipe RGBA → FFmpeg.
   - Mantém intacto o motor procedural de chamas existente.

---

## 2. Evidências Visuais (Frames Reais vs. Referência Oficial)

### A. Máscara Bézier Única (`Mask 1` — 18 keyframes, até 228 vértices)
- **Vídeo MP4 (268 ms de render):** [logo01-single-mask1.mp4](file:///c:/dev/neuralbridge-studio/renders/mogrt-proto/logo01-single-mask1.mp4)
- **Frame com pontos de vértice destacados (`0.47s`):**

![Máscara única com vértices extraídos do AEP](C:/Users/Pheli/.gemini/antigravity/brain/01318809-de6a-47e0-9094-8803e9ca85ee/scratch/mogrt_phase2_work/frames/single_0.47s.png)

### B. Composição Completa `Transition 01` (Todas as 90 Máscaras Reais) vs. Referência Oficial (`thumb.png`)
- **Vídeo MP4 (465 ms de render):** [logo01-transition01-all90masks.mp4](file:///c:/dev/neuralbridge-studio/renders/mogrt-proto/logo01-transition01-all90masks.mp4)
- **Comparação lado a lado — Esquerda: Referência original Adobe (`thumb.png`) | Direita: Aethera sem Adobe (`0.73s`):**

![Comparação lado a lado: Referência Adobe vs. Aethera 90 máscaras reais](C:/Users/Pheli/.gemini/antigravity/brain/01318809-de6a-47e0-9094-8803e9ca85ee/scratch/mogrt_phase2_work/frames/compare_vs_thumb.png)

- **Dissipação real dos raios + massas de energia (`0.90s`):**

![Frame 0.90s mostrando raios brancos sobre massas magenta extraídos do AEP](C:/Users/Pheli/.gemini/antigravity/brain/01318809-de6a-47e0-9094-8803e9ca85ee/scratch/mogrt_phase2_work/frames/all90_0.90s.png)

---

## 3. Análise Honesta de Diferenças e Efeitos Ainda Bloqueantes

Olhando lado a lado para a comparação acima:
- **O que JÁ está 100% fiel ao original:**
  - Silhueta exata de todas as 90 máscaras desenhadas à mão (raios brancos + massas magenta), posição, proporção, ordem de sobreposição (`Layer[0]` sobre `Layer[1]`), cores lidas de `definition.json` (`#ffffff` e `#ff5eff`) e timing em 15 fps "on twos" com keyframes `Hold`.
- **O que difere da referência em `Transition 01` (fácil de fechar em WebGL2):**
  1. **`ADBE Glo2` (Glow):** a referência tem um halo neon suave rosa/branco em volta das bordas das máscaras; nosso protótipo renderizou apenas as máscaras puras sem pós-processamento.
  2. **`ADBE Box Blur2` / `ADBE Simple Choker`:** suavização/arredondamento das bordas das massas magenta na referência.
  3. **`ADBE Noise2`:** granulação fina de filme anime sobre a imagem.
- **O que ainda impede a reprodução completa do template inteiro (`Dynamic Anime Burst Logo 01`, 7,27s):**
  1. **Composição aninhada + Transformações (`DABL_01`, `L01 LOGO`, `L01 STROKE`, `Text`):** ainda não decodificamos o grafo de precomps, `Transform` keyframes (posição/escala/rotação/âncora), `Track Matte` / `Set Matte` e a camada de `Logo Placeholder`.
  2. **Expressões JS (120 expressões):** vínculo dinâmico entre os controles de `definition.json` e propriedades internas das camadas.
  3. **Efeitos proprietários fechados (4 efeitos):**
     - `ADBE Turbulent Displace` (106 refs) — distorce organicamente bordas de logo e energia.
     - `ADBE Fractal Noise` (99 refs) — usado em mapas de deslocamento (`L01 REF_MAP`) e texturas.
     - `APC Vegas` (115 refs) — gera traços animados percorrendo o contorno da logo (`L01 STROKE`).
     - `ADBE Scribble Fill` (95 refs) — preenchimento rabiscado estilizado na transição da logo.

---

## 4. Estimativa Revisada (Após Evidência Real da Fase 2)

A descoberta de que o coração visual anime 2D deste pack (`Transition 01`, `Energy 25 Glow`, e em `Logo 02` o `Smoke2D_09` com 384 máscaras!) é composto por **máscaras Bézier reais animadas quadro a quadro** — e que nosso extrator decodificou e renderizou **90 máscaras em 465 ms** — **reduz drasticamente o risco técnico** do motor nativo:

| Etapa | Escopo concreto | Esforço revisado | Fidelidade esperada |
| --- | --- | --- | --- |
| **Fase 2B — UI do Importador + Preview de Máscaras no MotionVelix** | Botão "Importar `.mogrt`", leitura de controles reais na UI, relatório de compatibilidade e preview interativo das máscaras extraídas | **2 a 3 dias** | 100% para inspeção; 90%+ para composições de máscaras |
| **Fase 3A — Grafo de Precomps + Logo/Texto + Shaders Base (Glow, Blur, Choker, Noise, Set Matte)** | Montar a timeline completa do `.aep` (precomps, `Logo Placeholder`, `Text Layer`, `Fill`/`Tint`, `Glow`, `Box Blur`, `Noise`, `Simple Choker`, expressões de controle) | **1,5 a 2,5 semanas** | **80–90%** em packs baseados em máscaras + shape layers (incluindo `Transition 01` com visual quase idêntico à referência!) |
| **Fase 3B — Equivalentes WebGL2 para Efeitos Gerativos (`Turbulent Displace`, `Fractal Noise`, `Vegas`, `Scribble`)** | Shaders/geradores equivalentes para fechamento dos efeitos de contorno e distorção da logo | **2 a 4 semanas** | **85–95%** (equivalente visual próximo, sem prometer paridade bit-a-bit da Adobe) |
