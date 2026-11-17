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

## Revisão visual do agente (não substitui a do usuário)

- **T1217 duo (passed):** o personagem da direita aparece **semi-transparente** e se mistura ao céu. O gate não mede opacidade ou "fantasma", então isso é um possível falso positivo que precisa da revisão humana.
- **Duos:** nenhum mostra katana ou lança. A aderência à descrição é fraca e não é avaliada pelo gate.
- **Grupos de 8 em camadas:** os 8 personagens estão distintos e legíveis, o que é uma melhora grande sobre o "antes" ilegível. Os problemas são poses rígidas em fila, pés às vezes "flutuando" sobre o cenário e adesão parcial às descrições.
- **Trios aprovados:** ficaram limpos. O trio rejeitado (T1217 #1) tinha de fato um 4º personagem e pedestres.

## Pendências

- Detectar personagens translúcidos ou fantasmas, por exemplo pela opacidade da máscara versus o fundo.
- Avaliar aderência à descrição (CLIP/WD14 por região).
- Variar poses nas camadas e aterrar os pés com sombra de contato.
- Detector anime dedicado (deepghs), que precisa de autorização para download.
- Banners estilizados com evidência só de rosto continuam em `needs_review`, o que é intencional.
