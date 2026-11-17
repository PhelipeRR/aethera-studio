# Character Composition Gate (continuação do CS9)

Status: implementado e exercitado em execução real. **A aprovação visual é do usuário.** O gate nunca aprova uma imagem.
Seus veredictos são `passed_pending_human_review`, `needs_review` e `rejected`.

## Objetivo

Depois de gerar uma cena com 2 ou mais personagens, o gate:

1. Detecta e conta os personagens.
2. Separa os principais dos figurantes.
3. Avalia anatomia, sobreposição e posicionamento.
4. Repete com nova seed **e** nova estratégia de composição quando há uma falha acionável.

O prompt fica congelado durante todo o processo, e não existe fallback silencioso.

## Detectores (locais, RTX 4060 Ti 8 GB)

Todos rodam no venv do ComfyUI (`scripts/character_gate_worker.py`), com um processo por lote de imagens.

| Detector | Modelo | Papel |
|---|---|---|
| `yolo_person` | `ultralytics/segm/person_yolov8m-seg.pt` | corpo + máscara |
| `yolo_face` | `ultralytics/bbox/face_yolov8m.pt` | rosto (anime e real) |
| `yolo_hand` | `ultralytics/bbox/hand_yolov8s.pt` | mãos extras |
| `openpose` | lllyasviel `body_pose_model.pth` (CNN, **não YOLO**) | esqueletos, corpos fundidos |

Custo medido:
- Pico de cerca de 540 MiB de torch e cerca de 1,1 s por imagem.
- Uma tentativa leva cerca de 10 s, contando o carregamento dos modelos.
- Pico total de VRAM nas execuções: ≤ 7.835 MiB.

### Limites conhecidos (calibrados em 9 imagens do CS9 verificadas a olho)

- O YOLO person perde personagens anime estilizados e personagens de costas.
- O detector de rosto perde personagens de costas.
- Todos os detectores perdem figuras "glitch" (o grupo de 8 ilegível).
- Por isso, **contagem baixa nunca rejeita**: ela vira `needs_review`.
- Um personagem extra só rejeita quando **≥ 2 detectores** concordam.
- Um figurante só rejeita quando é confiável: conf ≥ 0,6 ou detectado por duas fontes.
- O esqueleto do OpenPose mede cerca de 0,83 × a altura da caixa do YOLO. A fusão aceita razões de altura entre 0,6 e 1,6.
- Candidato para melhorar a detecção em anime: o detector de pessoa anime da deepghs (YOLO treinado em anime). **Não foi baixado**, porque precisa de autorização.

## Regras (`src/character-gate.ts`)

**Classificação das figuras:**
- **Principal:** altura ≥ 30% da imagem.
- **Figurante:** altura entre 8% e 30%.
- Menos de 8% é ignorado.

**Rejeição (`rejected`):**

| Motivo | Quando |
|---|---|
| `extra_main_characters` | ≥ 2 detectores acima do esperado |
| `background_figures` | figurantes confiáveis |
| `safe_area_violation` | mais de 25% da figura dentro da área calma, como a do título |

**Revisão (`needs_review`):**
- `possible_missing_characters` e `characters_not_detected`
- `low_detector_agreement`: a contagem bate, mas menos de 2 detectores concordam
- `possible_background_figures`
- `undersized_character`: figura menor que 0,55 × a altura da região
- `multiple_faces_in_one_figure`, `possible_fused_bodies` e `extra_hands`
- `overlapping_characters`: IoU > 0,3
- `empty_region` e `crowded_region`
- `detector_error`: o erro do detector é reportado, nunca escondido

**Contagem correta não basta.** Uma imagem só recebe `passed_pending_human_review` se não houver nenhum motivo de review ou rejeição.

## Retry com mudança de estratégia (`src/character-gate-runner.ts`)

**Seeds e limites:**
- A seed da tentativa *n* é `base + n·7919`.
- `maxAttempts` vale 4 por padrão, com teto de 6, e é configurável.
- Uma estratégia nunca se repete. Quando a escada da classe de falha termina, o runner usa qualquer estratégia ainda não tentada. Se não houver nenhuma, para com `strategies_exhausted`.

**Escada por classe de falha:**

| Classe | Escada |
|---|---|
| extras | `regional-empty-scene` → `regional-empty-scene-strong-pose` → `layered-individual` |
| missing / anatomy / uncertain | `regional-strong-pose` → `layered-individual` |
| placement | `regional-strong-pose` → `regional-strong-calm` → `layered-individual` |

- `regional-empty-scene` mexe só no prompt **mascarado** da cena: strength 0,35 e o sufixo "empty, deserted, no bystanders". O prompt global fica intocado.
- **Grupos grandes** (≥ 6 por padrão) começam direto em `layered-individual`.
- **Política de retry** `actionable` (padrão): repete em `rejected` e em `needs_review` de classe missing ou placement. Uma incerteza pura não gasta GPU à toa.
- **Sem fallback silencioso:** o provider é obrigatório (`comfyui-native`). Uma tentativa servida por outro provider fica marcada como `wrong_provider` e é descartada. Se todas forem descartadas, o runner lança um erro.
- **Registro:** cada tentativa grava seed, estratégia, veredicto, motivos, contagem e confiança por detector, tempo e o PNG. As rejeitadas também ficam salvas como evidência.

## Composição em camadas (`src/layered-composition.ts`)

1. Gera a placa de cenário vazia.
2. Gera um retrato 832×1216 por personagem, com fundo branco e um esqueleto OpenPose.
3. Faz o recorte em lote com rembg `isnet-general-use`, num só processo (`scripts/cutout_batch_worker.py`).
4. Posiciona cada personagem na sua região, com os pés na base.
5. Harmoniza com img2img: denoise 0,4, com o guia de pose a 0,6.

Os modelos do ComfyUI ficam carregados durante os retratos (`withModelsHeld`). Com isso, o grupo de 8 caiu de 477 s para 198–223 s.

## Execução real: antes × depois

- Animagine XL 3.1 em `comfyui-native`, nas 12 execuções.
- Direção criativa fixa, sem LLM: o prompt é idêntico entre as execuções.
- LoRA photobombing desligado.
- "Antes" é o CS9 sem gate. Os veredictos do "antes" foram obtidos depois, rodando o mesmo detector sobre essas imagens, sem regiões.

| Run / caso | Antes (CS9) | Depois (gate) |
|---|---|---|
| T1208 duo (31001) | passaria sem regiões (2/1/2), mas o personagem esquerdo é minúsculo | #1 `needs_review` undersized → #2 `regional-strong-pose` seed 38920 **passed** (2/2/1), 116 s |
| T1208 trio (31002) | passed (3/3/1) | #1 passed (3/3/1), 54 s |
| T1208 eight (31003) | `needs_review` (6/4/3; faltando, sobreposição); visualmente ilegível | #1 `layered-individual` **passed** (8/8/6), 198 s |
| T1217 duo (31101) | passed (2/2/2) | #1 passed (2/2/2), 51 s |
| T1217 trio (31102) | **rejected** (4/4/1: extra + pedestres) | #1 rejected → #2 `regional-empty-scene` seed 39021 **passed** (3/3/1, 0 figurantes), 113 s |
| T1217 eight (31103) | `needs_review` (2/1/0); visualmente ilegível | #1 layered **passed** (8/8/7), 223 s |

As contagens estão no formato yolo_person / openpose / yolo_face.

Evidências em `artifacts/comfyui-character-gate-acceptance/run-2026-11-17T1208/` e `run-2026-11-17T1217/`:
- `report.json`
- `contact-sheet-before-after-gate.png`
- `*-before.png` e `*-after.png`
- `*-attempt<n>-<veredicto>-seed<s>.png`

## Revisão visual do agente do CS9 (histórica; não substitui a do usuário)

- **T1217 duo (passed):** o personagem da direita aparecia **semi-transparente** e se misturava ao céu. Essa limitação foi coberta pelo detector de alfa explícito do CS10.
- **Duos:** nenhum mostra katana ou lança. A aderência à descrição é fraca e não é avaliada pelo gate.
- **Grupos de 8 em camadas:** os 8 personagens estão distintos e legíveis, o que é uma melhora grande sobre o "antes" ilegível. Os problemas são poses rígidas em fila, pés às vezes "flutuando" sobre o cenário e adesão parcial às descrições.
- **Trios aprovados:** ficaram limpos. O trio rejeitado (T1217 #1) tinha de fato um 4º personagem e pedestres.

## Pendências históricas do CS9

- Detector anime dedicado (deepghs), que precisa de autorização para download.
- Banners estilizados com evidência só de rosto continuam em `needs_review`, o que é intencional.

## CS10 — Semantic Scene Gate e composição cinematográfica

O CS10 está integrado ao mesmo `runCharacterCompositionGate`; não existe um
segundo pipeline. Quando `semanticGate.enabled` está ativo, cada tentativa
registra separadamente:

- `count`: contagem, figurantes, regiões vazias, sobreposição, anatomia e área segura;
- `semantic`: critérios derivados somente do prompt por cena/personagem, objetos,
  roupas, acessórios, poses e ações;
- `visualQuality`: métricas do crítico visual local, artefatos localizados,
  coerência física, composição e identidade.

Os critérios são avaliados com o CLIP local já disponível (`local-clip-vit-base-patch32`)
em crops regionais e na imagem completa. A inspeção local já existente também é
reutilizada. O gate não baixa modelos nem instala pesos adicionais.

Política de evidência:

- objeto não mencionado não vira requisito;
- ausência de detecção, score inconclusivo, evaluator indisponível e recorte
  potencialmente incompleto viram `needs_review`;
- somente contradição semântica forte ou defeito objetivo comprovado (como uma
  máscara explicitamente semi-transparente) pode gerar `rejected`;
- `passed_pending_human_review` continua exigindo aprovação visual humana.

Quando existe um bbox acionável, o runner pode fazer uma única correção
localizada via `inpaintRegion`, reavaliar a imagem e preservar tanto a imagem
original rejeitada quanto a reparada, com seed e prompt registrados. A
composição em camadas agora usa variações determinísticas de OpenPose,
profundidade, iluminação compartilhada e sombras de contato reaplicadas após a
harmonização.

O acceptance script CS10 usa os mesmos casos de dupla, trio e oito personagens
e grava `schemaVersion: cs10-semantic-scene-gate-v1`, contact sheet com os três
eixos, `report.json`, PNGs antes/depois e todos os artefatos rejeitados em
`artifacts/comfyui-character-gate-acceptance/<run-id>/`. O relatório registra
explicitamente indisponibilidade de modelos/evaluators; não fabrica evidência
de conformidade.

### Aceitação real CS10 — `run-2026-11-17T1348`

| Caso | Contagem | Semântica | Qualidade visual | Veredicto do gate |
|---|---|---|---|---|
| 2 personagens | `needs_review` — 2 detectados | `needs_review` — evidência insuficiente | `passed_pending_human_review` | `needs_review` |
| 3 personagens | `passed_pending_human_review` — 3 detectados | `passed_pending_human_review` | `needs_review` — métrica visual fraca | `needs_review` |
| 8 personagens | `needs_review` — 8 detectados, baixa concordância | `needs_review` — evidência insuficiente | `passed_pending_human_review` | `needs_review` |

Os três pares foram gerados com modelos locais na RTX 4060 Ti, sem download de
pesos adicionais; todos os arquivos referenciados no relatório existem e
`humanReview.status` permanece `pending`. A contact sheet mostra a melhora
visual do caso de 8 personagens com composição em camadas, mas não substitui a
aprovação visual final.

### CS10 — evidência por atributo e reparo regional real — `run-2026-11-17T1611`

Esta reexecução usa o schema `cs10-attribute-evidence-repair-v2`. As imagens
originais foram avaliadas pelo mesmo `ProviderChainImageAdapter` usado pelo
gate, corrigindo a lacuna da execução anterior em que os evaluators semântico e
visual não estavam disponíveis no modo *before*. O relatório, o contact sheet
e todas as imagens de auditoria estão em:

`artifacts/comfyui-character-gate-acceptance/run-2026-11-17T1611/`

`humanReview.status` continua `pending`. Os eixos abaixo são evidência de
detector, não aprovação final:

| Cenário | Original: contagem / semântica / qualidade | Gate final: contagem / semântica / qualidade | Resultado dos reparos | Motivo final de `needs_review` |
|---|---|---|---|---|
| 2 personagens (`31001`) | `needs_review` / `needs_review` / `passed_pending_human_review` | `needs_review` / `needs_review` / `passed_pending_human_review` | Katana localizada executada, **rejeitada** pela regressão: score `0,5625 → 0,5846`, ainda incerto | personagem 1 subdimensionado e evidência insuficiente para katana, espada, armadura, lenço, pose; também lança/armadura/guarda do personagem 2 |
| 3 personagens (`31002`) | `passed_pending_human_review` / `needs_review` / `needs_review` | `passed_pending_human_review` / `needs_review` / `needs_review` | Rifle localizado **aplicado**: score `0,7190 → 0,7727`, margem `0,0335 → 0,0818`; casaco localizado executado e **rejeitado**: `0,7032 → 0,6629` | evidência do casaco permanece incerta e a qualidade visual continua abaixo do limite automático |
| 8 personagens (`31003`) | `needs_review` / `needs_review` / `needs_review` | `needs_review` / `needs_review` / `passed_pending_human_review` | Techwear localizado executado e **rejeitado**: score `0,6954 → 0,6884`; composição em camadas foi preservada | contagem com baixa concordância, várias roupas/acessórios sem evidência localizada suficiente; a melhoria de qualidade não elimina a revisão humana |

Detalhes verificáveis dos reparos:

- `duo`: `character-1-object-katana`, região `0`, bbox `{x:84,97,y:112,60,w:563,06,h:554,70}`, seed `1505161448`; regressão `failed` somente por `target_attribute_not_confirmed`. A imagem reparada e a diferença foram preservadas, mas a imagem original continuou sendo a escolhida.
- `trio`: `character-3-object-rifle`, região `2`, bbox `{x:893,85,y:112,60,w:371,30,h:554,70}`, seed `1925846911`; regressão `passed`, alteração fora do bbox `3,84%`, identidade `94`; reparo adotado. `character-3-wardrobe-coat`, seed `127411626`, regressão `failed` por atributo não confirmado.
- `eight`: `character-1-wardrobe-techwear`, região `0`, bbox `{x:75,46,y:321,66,w:124,08,h:320,74}`, seed `1417852993`; regressão `failed` por atributo não confirmado. A placa em camadas não foi regenerada.

Cada reparo possui máscara, imagem antes, imagem candidata, diferença antes/depois,
seed, prompt localizado e referências persistidas no `report.json`. O reparo
regional só é adotado quando o atributo-alvo é confirmado e a regressão fora da
região permanece dentro da política; ausência ou score inconclusivo continua
como `needs_review`, sem reduzir thresholds.

Contact sheet: `contact-sheet-before-after-gate.png`.

### CS10 — prioridade de escala e retentativa regional — `run-2026-11-17T1729`

Após a auditoria do `run-2026-11-17T1611`, o runner passou a priorizar a falha
objetiva `undersized_character` antes de atributos incertos e a repetir a mesma
região com variante auditável (`:retryN`, seed e prompt próprios) quando a
correção de escala é rejeitada (commit `79ac6dd`). Thresholds inalterados;
`humanReview.status` continua `pending`. Artefatos em
`artifacts/comfyui-character-gate-acceptance/run-2026-11-17T1729/`.

| Cenário | Original: contagem / semântica / qualidade | Gate final | Reparos | Motivo final de `needs_review` |
|---|---|---|---|---|
| 2 personagens (`31001`) | `needs_review` (`undersized_character`) / `needs_review` / `passed_pending_human_review` | igual ao original; imagem final = original | 3 inpaints da região `0` (seeds `2709488337`, `2020167405`, `160546862`), todos **rejeitados** por `count_placement_not_corrected`; alteração fora do bbox ≈ 3,8–4,0% | personagem 1 continua subdimensionado; 11 critérios semânticos sem evidência |
| 3 personagens (`31002`) | `passed_pending_human_review` / `needs_review` / `needs_review` | mesma contagem/semântica/qualidade | rifle **aplicado** (`0,7190 → 0,7727`, seed `1925846911`); casaco **rejeitado** (`0,7032 → 0,6629`) | casaco e jaquetas/acessórios sem evidência; `weak_visual_quality_metric` |
| 8 personagens (`31003`) | `needs_review` (6 motivos de contagem) / `needs_review` / `needs_review` | `needs_review` (`low_detector_agreement`) / `needs_review` / `passed_pending_human_review` | techwear (`0,6954 → 0,6884`), visor (`0,7423 → 0,6627`) e jaqueta (`0,6320 → 0,6773`, abaixo do limite) **rejeitados**; composição em camadas preservada | baixa concordância dos detectores; roupas/acessórios sem evidência localizada |

Conclusões técnicas desta rodada (não são aprovação):

- **Inpaint regional não corrige escala.** Com `repairStrength` 0,48 o
  inpaint preserva a silhueta original; as três variantes mantiveram a altura
  do personagem 1 do duo. Corrigir escala exige outra estratégia (recompor a
  camada do personagem ou inpaint com força/máscara maiores), não mais
  retentativas iguais.
- **As retentativas de contagem consomem todo o orçamento de reparo.** Com
  `maxLocalizedRepairs = 3` e prioridade fixa da contagem, o duo nunca chegou a
  reparar atributos incertos. A variante `retry2` chegou a acrescentar espadas
  visíveis ao personagem 1, mas foi descartada porque o critério-alvo era a
  escala. Pendência: limitar retentativas de contagem para liberar ao menos um
  reparo semântico.
- O ganho visual do caso de 8 personagens vem da composição em camadas; os
  reparos de atributo nesse caso não confirmaram evidência e foram revertidos.
