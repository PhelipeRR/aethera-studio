# Aethera Creative Studio — Integração do ComfyUI ao módulo Thumbs & Artes

> Status: **PLANEJADO — aguardando aprovação** (2026-11-16). Nenhum código foi alterado.
> Escopo: evoluir o módulo existente (`CreativeStudioPanel` + `@neuralbridge/creative-studio`). Não cria módulo novo, não substitui o editor, não remove o SDXL-Turbo, não toca no pipeline de vídeo além de um lease de GPU compartilhado (Etapa CF-3).

---

## 1. Diagnóstico do módulo atual (auditoria do código real)

### 1.1 Mapa de componentes

| Camada | Arquivo | Papel |
|---|---|---|
| UI | `apps/aethera-desktop/src/renderer/src/CreativeStudioPanel.tsx` | Tela única: tipo de arte, prompt, título, vídeo, fidelidade, "Gerar Arte Editável", "Thumbnail Lab (3 Variações)", checkbox "IA Local (SDXL-Turbo / rembg)", Brand Kit, Projetos Salvos, canvas (preview PNG), camadas, edição por prompt, Quality Gate e aprovações. |
| Bridge | `apps/aethera-desktop/src/preload/index.ts` (`creative*`) | `ipcRenderer.invoke('creative:*')`. |
| Serviço main | `apps/aethera-desktop/src/main/creative-studio-service.ts` | `AetheraCreativeStudioService` instancia tudo e registra os IPC `creative:*`. |
| Contrato de IA de imagem | `packages/creative-studio/src/image-generation-adapter.ts` | `ExternalImageAdapter` (`generateImage`, `removeBackground`, `evaluateImageSemantics`, `inspectVisualQuality`, `inpaintRegion`) + `SharpSvgCompositionEngine` (render das camadas). |
| Motor local | `packages/creative-studio/src/local-ai-adapter.ts` | `LocalPythonAiAdapter` (SDXL-Turbo + rembg/BiRefNet + CLIP) e `ProviderChainImageAdapter` (cadeia de fallback). |
| Worker Python | `packages/creative-studio/scripts/vision_worker.py` | Subcomandos `generate`, `segment(-adaptive)`, `evaluate-semantic`, `inspect-visual-quality`, `inpaint-region`. |
| Worker residente | `persistent-ai-adapter.ts` + `vision_worker_persistent.py` | Mantém modelos em GPU. **Usado só em scripts CS-9; não está ligado ao app.** |
| Orquestração | `creative-orchestrator.ts`, `composition-planner.ts`, `concept-engine.ts`, `creative-director.ts` | Direção por CLIs (Claude/Codex/Antigravity/Gateway), planejamento de camadas, Lab de conceitos, loop do diretor. |
| Editor | `layered-editor.ts` | `LayeredDocumentEditor`: undo/redo, transform, máscara, efeitos, `applyLocalizedPromptEdit`. |
| Brand Kit | `brand-kit-manager.ts` + `schemas.ts` (`brandKitSchema`) | Paleta, tipografia, logo/avatar/mascote/watermark, `referenceAssetIds`, `thumbnailStyles`, `compositionPresets`. |
| Qualidade | `quality-gate.ts`, `visual-content-gate.ts`, `typography-geometry-audit.ts`, `approval-states.ts` | Auditoria técnica, conteúdo visual, geometria de texto, estados de aprovação CS-9. |
| Persistência | `packages/database` → `AetheraCreativeStudioRepository` | SQLite: `saveProject`/`getProject`/`listProjects`, Brand Kits como `dataJson` validado por Zod; assets em `userData/creative-studio` via `AssetIngestionService` (caminhos portáveis). |

### 1.2 Fluxo atual de "Gerar Arte Editável" (`creative:create-from-prompt`)

1. `handleCreate` envia `{artType, prompt, headline, brandKitId, avatarBackdrop, useAiGeneration}`.
2. `createFromPromptImpl` (`creative-studio-service.ts:392`): se `useAiGeneration` **e** `imageAdapter.isAvailable()`, chama `generateImage({ prompt: input.prompt, width: 1024, height: 576 })` (avatar: 768×768). O resultado vira `backgroundAsset` (avatar: recorte rembg vira `subjectAsset` e mascote do Brand Kit).
3. Só depois roda `orchestrator.orchestrateCreation`: os 4 papéis chamam CLIs de raciocínio, mas o texto devolvido **só é usado para extrair `HEADLINE:` por regex** (`creative-orchestrator.ts:134`); o resto vai para `traces`.
4. `CompositionPlanner.buildDocument` monta camadas fixas por tipo; `CreativeDirectorAgent.directWithIterativeReview` faz até 3 iterações contra o Quality Gate.
5. Salva no SQLite, cria o editor em memória, renderiza preview PNG (Sharp/SVG) e devolve como data URL.

### 1.3 Como o SDXL-Turbo roda

- `LocalPythonAiAdapter.generateImage` executa `python vision_worker.py generate` **por chamada** (recarrega o modelo a cada vez; timeout 180 s).
- Modelo `stabilityai/sdxl-turbo` (no cache HF local), `steps=3`, `guidance_scale=0.0` (sem prompt negativo efetivo), sem seed (o campo existe no worker, mas o adapter nunca passa), lado máximo 1024, `enable_model_cpu_offload`.
- Disponibilidade = `torch`, `diffusers`, `rembg`, `PIL` importáveis (verificado: torch 2.11+cu128, diffusers 0.38, CUDA ok).

### 1.4 Integração com serviços locais de geração

Nenhuma. Não há referência a ComfyUI no repositório. A única "cadeia de provedores" é `ProviderChainImageAdapter([new LocalPythonAiAdapter()])`.

Ambiente auditado: **ComfyUI Desktop instalado** em `%LOCALAPPDATA%\Programs\ComfyUI`, mas sem configuração de primeira execução (`%APPDATA%\ComfyUI` inexistente), pasta `models/` vazia (68 KB) e nada respondendo em `127.0.0.1:8000` (porta padrão do Desktop) ou `:8188` (porta padrão do portátil). Ou seja: o app existe, mas o ComfyUI não está pronto para uso.

### 1.5 Thumbnail Lab (3 variações)

`creative:thumbnail-lab` → `orchestrateConceptThumbnailLab` → `ConceptDrivenEngine.generateConceptLab`: gera 3 conceitos (A/B/C) com arquétipos e *blueprints* diferentes (`mystery_spotlight`, `macro_center_object`, `split_comparison`, `asymmetric_story`…), adquire mídia por requisito (frames do vídeo → mídia autêntica → IA `generateImage` 1024×576 ou 640×720 para comparação, img2img opcional), monta camadas por blueprint, faz crítica pós-render (CLIP + `inspectVisualQuality`) e reparo localizado por `inpaintRegion`. **A diferença entre variações vem do conceito/layout; a imagem de IA não recebe seed nem controle de composição.**

### 1.6 Camadas editáveis

`CreativeProjectDocument.layers[]` com tipos `background | subject | text | vfx | shape | watermark` (Zod em `schemas.ts`). O texto é renderizado como SVG pelo Sharp (nítido, editável, auditado por `typography-geometry-audit`). VFX são presets procedurais (`particles`, `speed_lines`, `light_leak`, `cyber_grid`, `rim_glow`, `duotone_wash`). Fundo: `source: 'asset' | 'color' | 'ai'`.

### 1.7 Brand Kits

`BrandKitManager` sobre `SqliteBrandKitStore`. Paleta (6 cores), tipografia, assets de identidade registrados automaticamente (avatar/watermark/mascote gerados viram identidade do kit), referências e presets. É a fonte única — o plano reaproveita sem duplicar.

### 1.8 Persistência de projetos

Documento inteiro em `dataJson` + colunas de índice (`artType`, `brandKitId`, `schemaVersion`, aprovação). Cada edição salva o documento e re-renderiza preview + auditoria.

### 1.9 Edição localizada por prompt

`LayeredDocumentEditor.applyLocalizedPromptEdit` é **determinística, por regex**: troca de título, cor hex (texto ou fundo), ocultar marca/VFX/sujeito etc. Não usa IA e não altera pixels gerados. Por isso é rápida, previsível e reversível (undo).

### 1.10 Erros, progresso e cancelamento

- Erros: exceções propagadas pelo IPC e exibidas em `statusMsg`; mensagens específicas para `[VisualContentGate]`. Falha/indisponibilidade da IA em "Gerar Arte Editável" **cai silenciosamente** para fundo de cor/gradiente.
- Progresso: apenas `job_started`/`job_completed`/`job_failed` e execuções de CLIs no Console de Produção (`withConsoleJob`); a UI mostra um texto fixo ("Gerando composição editável...").
- Cancelamento: **não existe** (nenhum `AbortSignal` no serviço, adapters ou worker).
- GPU: **não existe lease/mutex de GPU** entre Creative Studio e o restante do Aethera, que também usa GPU (Qwen3-TTS, Chatterbox, ACE-Step, faster-whisper, SAM2 no cache HF; `h264_nvenc` no render). No momento da auditoria havia 5,3 GB de 8 GB de VRAM já ocupados por outros processos.

---

## 2. Causas dos resultados visuais ruins

### 2.1 Comprovadas pelo código

| # | Causa | Evidência |
|---|---|---|
| C1 | Sem IA disponível (ou falha), o banner vira **gradiente da paleta + partículas + título** — exatamente o "fundo simples com texto". Não há aviso ao usuário. | `createFromPromptImpl` só gera se `isAvailable()`; `buildBannerLayers` usa `source: 'color'` + `gradientTo` (`composition-planner.ts:797-835`). |
| C2 | O **prompt bruto do usuário** (pt-BR, com instruções tipo "identidade visual profissional") vai direto ao SDXL-Turbo. Os codificadores CLIP do SDXL são treinados em inglês e truncam em 77 tokens. | `generateImage({ prompt: input.prompt, ... })` (`creative-studio-service.ts:415`). |
| C3 | A direção criativa das CLIs **é descartada** e ainda roda **depois** da geração da imagem: nada do raciocínio chega ao modelo de imagem. | `creative-orchestrator.ts:131-143` (só regex `HEADLINE:`); ordem em `createFromPromptImpl`. |
| C4 | O fundo é gerado em 1024×576 e esticado 2,5× para 2560×1440, e o planner ainda aplica **blur 5 + brilho 0,74 + vinheta 0,58** — a arte gerada é rebaixada a textura escura e borrada de propósito. | `local-ai-adapter.ts:93-96`; `composition-planner.ts:812-816`. |
| C5 | Nenhum controle de composição: sem seed, sem layout/blockout, sem ControlNet, sem prompt negativo (`guidance_scale=0`). O texto é posicionado por template, sem saber onde está o conteúdo da imagem. | `vision_worker.py:63-70`; `ImageGenerationRequest` sem `seed`/`negativePrompt`. |
| C6 | No Lab, as 3 imagens de IA não têm seeds/composições controladas; a diversidade depende do template de camadas. | `concept-engine.ts:787-792`. |
| C7 | O worker recarrega o modelo a cada chamada (≈15 s documentados no adapter persistente) e roda com CPU offload — lento, sujeito a timeout, o que reforça C1. | `vision_worker.py:28-41`; comentário em `persistent-ai-adapter.ts`. |

### 2.2 Hipóteses (a medir na etapa CF-0)

- H1: SDXL-Turbo (treinado em 512×512, 1–4 passos) em 1024×576 gera estrutura fraca/duplicada e pouca profundidade — limitação do modelo, não só do prompt.
- H2: Disputa de VRAM com TTS/música/outros apps provoca offload lento ou OOM → timeout → fallback de gradiente.
- H3: Personagens gerados no mesmo plano do cenário perdem destaque após blur/vinheta; uma camada de personagem separada (geração + recorte BiRefNet) resolveria melhor.
- H4: O "Quality Gate" aprova composições vazias porque não mede densidade/saliência fora da área de texto.

**Conclusão:** aumentar o prompt não resolve C3–C6. A correção é (a) uma *receita visual* estruturada em inglês derivada do conceito, (b) controle de composição por blockout/seed, (c) geração em resolução nativa + upscale real, (d) parar de degradar o fundo, (e) um gate que reprove "fundo vazio".

---

## 3. Arquitetura de integração proposta

```
CreativeStudioPanel (mesma tela)
  └─ seletor compacto de motor + status + preset + Rascunho/Final + progresso/cancelar
        │ IPC creative:* (existente) + creative:image-engine-* (novo)
AetheraCreativeStudioService
  ├─ VisualRecipeBuilder (novo, puro)  ← conceito/brief/BrandKit/artType
  │     produz ImageGenerationPlan: prompt EN, negativo, preset, seed, blockout, zonas seguras
  ├─ ProviderChainImageAdapter (existente, ordem configurável)
  │     ├─ ComfyUiImageAdapter (novo)  → HTTP/WS 127.0.0.1
  │     └─ LocalPythonAiAdapter (existente, SDXL-Turbo — fallback/rascunho)
  ├─ GpuLease (novo, no main; compartilhado com cinema/TTS)
  └─ CompositionPlanner/ConceptEngine/Editor/Brand Kit/Quality Gate (existentes)
```

Princípios:
- **Mesmo contrato**: `ComfyUiImageAdapter implements ExternalImageAdapter`. Campos novos são opcionais; o SDXL-Turbo continua funcionando sem mudança de chamada.
- **Difusão nunca escreve texto.** Título, slogan, logo e watermark continuam camadas SVG/asset do editor. O prompt de imagem pede *espaço negativo* onde o texto ficará.
- **Workflows como dados versionados** no repositório (JSON de API do ComfyUI), com placeholders injetados por `_meta.title` dos nós; v1 usa **somente nós nativos** (sem custom nodes).
- **Saída do ComfyUI é dado não confiável**: valida dimensões/formato, ingere via `AssetIngestionService`.
- Endpoint aceito só em loopback (`127.0.0.1`/`localhost`/`[::1]`).

---

## 4. Arquivos existentes reutilizados

`image-generation-adapter.ts` (contrato + engine de composição), `local-ai-adapter.ts` (`ProviderChainImageAdapter`, SDXL-Turbo, rembg/BiRefNet, CLIP), `persistent-ai-adapter.ts` (embeddings CLIP para medir diversidade), `composition-planner.ts`, `concept-engine.ts`, `creative-orchestrator.ts`, `layered-editor.ts`, `brand-kit-manager.ts`, `schemas.ts` (`ART_SPECIFICATIONS.safeArea`), `quality-gate.ts`, `typography-geometry-audit.ts`, `asset-ingestion.ts`, `creative-studio-service.ts`, `CreativeStudioPanel.tsx`, `ProductionConsoleAccordion` (progresso no console), `AetheraCreativeStudioRepository`.

## 5. Arquivos a criar / modificar

**Criar** (`packages/creative-studio`):
- `src/comfyui/comfyui-client.ts` — HTTP + WebSocket (health, object_info, models, prompt, history, view, upload, interrupt, queue delete, free).
- `src/comfyui/comfyui-image-adapter.ts` — `ExternalImageAdapter` sobre o client.
- `src/comfyui/workflow-registry.ts` + `workflows/*.json` — presets versionados e injeção de parâmetros.
- `src/comfyui/comfyui-discovery.ts` — detecção (portas 8000/8188, config do Desktop, endpoint manual).
- `src/visual-recipe.ts` — `VisualRecipeBuilder` (conceito → `ImageGenerationPlan`).
- `src/composition-blockout.ts` — gera imagem-guia (zonas de profundidade/luz/silhuetas) com Sharp.
- `test/cf-*.test.ts` + `test/fixtures/fake-comfyui-server.ts`.

**Criar** (`apps/aethera-desktop`): `src/main/gpu-lease.ts`; `src/main/creative-image-engine-settings.ts` (persistência da configuração); seção "Motor de imagem" na área de Configurações existente (local exato confirmado na CF-7).

**Modificar**: `image-generation-adapter.ts` (campos opcionais), `local-ai-adapter.ts` (repassar seed/negativo/cancelamento; cadeia configurável), `vision_worker.py` (aceitar `--seed`/`--negative` já parcialmente presentes), `creative-studio-service.ts` (receita antes da geração, motor escolhido, progresso, cancelamento, lease), `creative-orchestrator.ts` (usar a direção estruturada em vez de descartar), `composition-planner.ts` (tratamento de fundo por origem: sem blur/escurecimento para fundo composto; *scrim* local atrás do texto), `concept-engine.ts` (plano por conceito com seed/blockout próprios), `layered-editor.ts` (classificador de intenção: determinístico × edição de região por IA), `quality-gate.ts` (métrica de "composição vazia"), `preload/index.ts`, `CreativeStudioPanel.tsx`, `cinema-pipeline.ts`/`tts-providers.ts` **apenas** para adquirir o lease de GPU (sem mudar lógica de vídeo).

## 6. Contratos e interfaces

```ts
// image-generation-adapter.ts — extensão retrocompatível
export interface ImageGenerationRequest {
  prompt: string; width: number; height: number;
  style?: string; referenceImagePaths?: string[]; strength?: number;
  negativePrompt?: string;
  seed?: number;
  preset?: VisualPresetId;          // escolhe workflow/checkpoint
  quality?: 'draft' | 'final';      // poucos passos × completo + upscale
  maskPath?: string;                // inpaint/outpaint
  outpaint?: { left: number; top: number; right: number; bottom: number };
  signal?: AbortSignal;
  onProgress?: (p: ImageJobProgress) => void;
}
export interface ImageJobProgress { stage: 'queued'|'loading'|'sampling'|'upscaling'|'decoding'|'done'; step?: number; totalSteps?: number; pct: number; queuePosition?: number }

export type VisualPresetId =
  | 'anime_thumbnail' | 'game_thumbnail' | 'geek_banner'
  | 'cinematic_cover' | 'avatar' | 'logo_element';

export interface ImageEngineStatus {
  id: 'comfyui' | 'local-sdxl-turbo' | 'none';
  state: 'ready' | 'busy' | 'offline' | 'misconfigured';
  endpoint?: string; version?: string; vramFreeMb?: number;
  missingModels: string[]; message?: string;
}

// visual-recipe.ts
export interface ImageGenerationPlan {
  preset: VisualPresetId;
  positivePrompt: string;     // inglês, estruturado: sujeito, ação, cenário, câmera, luz, paleta, estilo
  negativePrompt: string;     // inclui "text, letters, watermark, logo"
  seed: number;               // hash(projectId+label) — reprodutível
  nativeSize: { width: number; height: number }; // bucket SDXL (ex.: 1344×768)
  targetSize: { width: number; height: number }; // 2560×1440 etc.
  textSafeZones: Array<{ x: number; y: number; width: number; height: number }>;
  blockoutPath?: string;      // guia de composição p/ img2img/ControlNet
  denoise?: number;
  characterLayer?: { prompt: string; seed: number } | null; // personagem separado p/ recorte
}

// comfyui-client.ts
export interface ComfyUiClient {
  health(): Promise<{ ok: boolean; version?: string; devices: Array<{ name: string; vramTotal: number; vramFree: number }> }>;
  listModels(folder: 'checkpoints'|'loras'|'upscale_models'|'controlnet'): Promise<string[]>;
  queuePrompt(graph: object, clientId: string): Promise<{ promptId: string }>;
  watch(promptId: string, onProgress: (p: ImageJobProgress) => void, signal?: AbortSignal): Promise<ComfyOutputRef[]>;
  fetchImage(ref: ComfyOutputRef): Promise<Buffer>;
  uploadImage(buf: Buffer, name: string, kind: 'image'|'mask'): Promise<string>;
  cancel(promptId: string): Promise<void>;     // /queue delete se pendente, /interrupt se executando
  freeMemory(): Promise<void>;                 // POST /free {unload_models, free_memory}
}

// gpu-lease.ts (main)
export interface GpuLease { acquire(owner: 'creative'|'cinema'|'tts'|'music', opts?: { signal?: AbortSignal }): Promise<() => Promise<void>> }
```

Novos IPC: `creative:image-engine-status`, `creative:image-engine-settings` (get/save), `creative:cancel-job`, evento `creative:job-progress`. Ação nova do editor: `{ kind: 'aiRegionEdit', instruction, region? }` (assíncrona; separada de `promptEdit`).

## 7. Modelos locais recomendados (RTX 4060 Ti 8 GB)

Nenhum modelo é presumido compatível: cada um entra só após o benchmark CF-0/CF-9 (VRAM de pico, tempo, qualidade). Licenças precisam ser confirmadas antes de recomendar download (uso em canal monetizado).

| Uso | Candidato | Por quê | Risco/observação |
|---|---|---|---|
| Base cinematográfica / games | SDXL 1.0 fine-tune fotográfico-cinematográfico (ex.: Juggernaut XL) | SDXL fp16 cabe em 8 GB no ComfyUI com gestão de memória; 1344×768 nativo | ~6,5 GB em disco; verificar licença |
| Anime | Checkpoint SDXL anime (ex.: Illustrious-XL / NoobAI-XL / Animagine XL 4.0) | Mesmo custo de VRAM do SDXL | Licenças próprias — confirmar uso comercial |
| Rascunho rápido | LoRA de poucos passos (DMD2 / SDXL-Lightning / Hyper-SD) sobre o checkpoint acima | 4–8 passos para iterar e para o Lab | Leve queda de detalhe; final usa passos completos |
| Fallback | SDXL-Turbo atual (já no cache) | Já funciona; mantém o app útil sem ComfyUI | Qualidade limitada (H1) |
| Upscale | 4x-UltraSharp ou RealESRGAN x4plus + passe tile img2img leve | 1344×768 → 2560×1440 com detalhe real | Upscale em tiles para caber em 8 GB |
| Composição (fase 2) | ControlNet SDXL Union (depth/canny) | Controle forte de layout a partir do blockout | +~2,5 GB; avaliar se cabe junto ao checkpoint |
| Recorte | BiRefNet / ISNet já existentes (rembg) | Já integrado e testado | — |
| Opcional (benchmark) | FLUX.1-schnell GGUF Q4/Q5 + T5 fp8 | Prompt adherence superior, Apache-2.0 | Lento com offload em 8 GB; **FLUX.1-dev excluído** (licença não comercial) |

## 8. Workflows ComfyUI recomendados (só nós nativos na v1)

Todos com `CheckpointLoaderSimple` → `LoraLoader` (opcional) → `CLIPTextEncode` ×2 → `KSampler` → `VAEDecode` → `SaveImage`, variando:

| Preset | Entrada de composição | Tamanho nativo | Notas de receita |
|---|---|---|---|
| `geek_banner` | blockout panorâmico (img2img, denoise 0,75–0,85) | 1344×768 → upscale 2560×1440 | Faixa central (área segura 1546×423) com baixo detalhe/luz controlada para o título; personagens e energia nas laterais e na faixa desktop; profundidade em 3 planos |
| `game_thumbnail` | blockout por blueprint do conceito | 1344×768 → 1280×720 | Sujeito em terço, ação, luz de recorte, contraste alto |
| `anime_thumbnail` | idem, checkpoint anime | 1344×768 → 1280×720 | Linhas limpas, cel shading, cores saturadas |
| `cinematic_cover` | blockout + paleta do Brand Kit | 1344×768 | Lente, grão, teal/orange ou paleta do kit |
| `avatar` | sem blockout, fundo liso | 1024×1024 → 800×800 | Personagem/mascote centrado → recorte BiRefNet |
| `logo_element` | fundo liso | 1024×1024 | Ícone/emblema sem texto → recorte; nunca gerar letras |
| `region_inpaint` | `LoadImage` + máscara, `DifferentialDiffusion` + `InpaintModelConditioning` / `SetLatentNoiseMask` | recorte da região | Edita só a área mascarada da camada de fundo |
| `outpaint` | `ImagePadForOutpaint` | — | Ex.: thumbnail 16:9 → banner panorâmico |
| `upscale` | `UpscaleModelLoader` + `ImageUpscaleWithModel` + KSampler tile leve | — | Separado para reaproveitar no Lab |

## 9. Instalação e configuração

1. **Reutilizar instalação existente (prioridade)**: detectar ComfyUI Desktop (`%LOCALAPPDATA%\Programs\ComfyUI`, `%APPDATA%\ComfyUI\config.json` para `basePath`) e portáteis em execução (`127.0.0.1:8000` e `:8188`, `GET /system_stats`). O usuário pode informar endpoint manual (só loopback).
2. **Assistente guiado** quando o ComfyUI estiver instalado mas sem setup (caso desta máquina): instrui a concluir a primeira execução e verifica de novo. O Aethera não inicia nem configura o Desktop por conta própria na v1.
3. **Instalação gerenciada (opcional, etapa posterior)**: só após aprovação explícita; ComfyUI portátil em pasta escolhida pelo usuário, iniciado com `--listen 127.0.0.1`.
4. **Modelos**: lista por preset com tamanho, licença e SHA-256; download só com confirmação do usuário; nunca automático. `missingModels` aparece no status.
5. **Validação**: `object_info` confirma que os nós exigidos pelo workflow existem antes de enfileirar; workflow incompatível = estado `misconfigured` com mensagem clara, fallback para o motor local.

## 10. Gerenciamento de VRAM

- **`GpuLease` único no processo main** (FIFO com prioridade): Creative Studio, render de vídeo com NVENC, TTS (Qwen3/Chatterbox), música (ACE-Step) e whisper adquirem antes de usar GPU. Jobs de imagem enquanto um vídeo renderiza ficam "na fila" (visível na UI), não concorrem.
- Após cada job (ou lote do Lab): `POST /free` opcional conforme configuração ("manter modelo carregado por N min" × "liberar sempre").
- Pré-checagem: `system_stats.vram_free`; abaixo do limiar do preset → avisa e usa rascunho/fallback em vez de falhar por OOM.
- Resolução nativa sempre em bucket SDXL (~1 MP); upscale em tiles; VAE em tiles.
- SDXL-Turbo local passa a ser carregado via worker persistente (já existente) só quando escolhido, e liberado ao trocar para ComfyUI — evita dois modelos SDXL na VRAM.
- Medir no CF-0: pico de VRAM e tempo por preset com 5 GB já ocupados por outros apps (cenário real observado).

## 11. Plano de testes

- **Unidade**: `VisualRecipeBuilder` (inglês, negativo com "text", zonas seguras, seed determinística), `workflow-registry` (injeção por `_meta.title`, recusa de nó ausente), `composition-blockout`, `GpuLease` (ordem, cancelamento, liberação em erro), classificador de intenção do editor.
- **Contrato**: `ComfyUiImageAdapter` contra `fake-comfyui-server` (HTTP + WS) — fila, progresso, `execution_error`, cancelamento (`/queue` delete × `/interrupt`), timeout, servidor caindo no meio.
- **Integração**: `ProviderChainImageAdapter` com ComfyUI offline → SDXL-Turbo → sem IA com **aviso explícito** (fim do fallback silencioso); documento e camadas compatíveis com projetos antigos (schemaVersion).
- **E2E (Playwright/Electron)**: seletor de motor, status, progresso, cancelar, gerar banner com fake server, editar por prompt, undo.
- **Real em GPU** (`scripts/cf-comfy-banner-acceptance.ts`, fora do CI): cenário NextWorth + 1 thumbnail anime + 1 game; relatório HTML com tempos, pico de VRAM, imagens, métricas.
- **Métricas de qualidade**: densidade de bordas/saliência fora das zonas de texto (reprova "fundo vazio"), CLIP semântico (existente), diversidade do Lab (cosseno de embeddings CLIP < limiar), geometria de texto (existente). Aprovação estética continua humana (CS-9).

## 12. Critérios de aceite

1. Cenário principal (banner NextWorth 2560×1440) gerado via ComfyUI com composição real: personagens originais, efeitos de energia, cenário futurista, profundidade e luz dramática — e não gradiente + texto.
2. "NEXTWORTH" é camada de texto do editor, dentro da área segura 1546×423, legível nas prévias Desktop/Mobile/TV, aprovada pelo `typography-geometry-audit`.
3. Métrica de composição vazia aprovada; CLIP semântico acima do limiar atual.
4. Edição posterior sem regenerar tudo: (a) texto/cor por regex instantâneo; (b) "adicione raios de energia à direita" altera só a região mascarada do fundo, com undo.
5. Lab gera 3 propostas com seeds/blockouts distintos e similaridade abaixo do limiar.
6. ComfyUI offline/misconfigurado → mensagem clara + fallback, sem travar a UI; cancelamento interrompe em ≤ 3 s.
7. Nenhuma execução simultânea com render de vídeo/TTS; sem OOM no benchmark com 5 GB ocupados (ou degradação controlada para rascunho).
8. Projetos, Brand Kits e o fluxo SDXL-Turbo atuais continuam funcionando; testes existentes CS-1…CS-9 verdes.

## 13. Roadmap em etapas pequenas

| Etapa | Entrega | Depende de |
|---|---|---|
| CF-0 | Baseline: reproduzir o banner NextWorth com o fluxo atual; medir tempo/VRAM; confirmar H1–H4 | — |
| CF-1 | Correções sem ComfyUI: receita EN + negativo + seed no SDXL-Turbo, direção das CLIs usada, fim do blur/escurecimento em fundo composto (scrim local), aviso de fallback | CF-0 |
| CF-2 | `ComfyUiClient` + discovery + status (sem geração) + fake server | — |
| CF-3 | `GpuLease` no main e adoção por cinema/TTS/música (só aquisição) | — |
| CF-4 | `ComfyUiImageAdapter` + workflow `geek_banner` (txt2img + upscale) + progresso/cancelamento | CF-2, CF-3 |
| CF-5 | Blockout de composição + zonas seguras por tipo de arte | CF-1, CF-4 |
| CF-6 | Presets restantes (anime, game, cinematic, avatar, logo) + camada de personagem separada com recorte | CF-5 |
| CF-7 | UI mínima: seletor de motor, status, preset, Rascunho/Final, progresso, cancelar; Configurações avançadas | CF-4 |
| CF-8 | Lab com ComfyUI: seeds/blockouts por conceito, verificação de diversidade, "refinar variação" | CF-6 |
| CF-9 | Edição de região por IA (inpaint) e outpaint, integrados ao undo do editor | CF-4 |
| CF-10 | Gate de composição vazia, benchmark real e relatório de aceite; atualização de `docs/PLAN.md`/`STATUS.md` | todas |

Instalação gerenciada do ComfyUI e ControlNet ficam como etapas opcionais, só com pedido explícito.

## 14. Riscos, limitações e dependências

- **VRAM**: 8 GB com ~5 GB já usados por outros processos pode inviabilizar SDXL completo sem offload; mitigação: lease, `/free`, rascunho, aviso. Números reais só após CF-0.
- **Licenças** de checkpoints anime/fine-tunes variam; recomendação final depende de verificação.
- **Disco/download**: ~7 GB por checkpoint; downloads exigem confirmação.
- **API do ComfyUI** não é estável/versionada formalmente; mitigação: client fino, validação via `object_info`, testes de contrato, versão mínima registrada.
- **Custom nodes** são código de terceiros: v1 proíbe; uso futuro exige revisão.
- **Personagens "originais"** não garantem ausência de semelhança com IPs conhecidas; o prompt negativo e a revisão humana (CS-9) seguem obrigatórios.
- **Tempo por arte** (hipótese: dezenas de segundos para rascunho, mais com upscale) — medir antes de prometer.
- **ComfyUI Desktop** desta máquina ainda não concluiu o setup inicial — dependência do usuário para a CF-4 em diante (o desenvolvimento usa fake server até lá).
- Edição por regex continua limitada a intenções conhecidas; a edição por IA é uma ação separada, para não quebrar a previsibilidade atual.
