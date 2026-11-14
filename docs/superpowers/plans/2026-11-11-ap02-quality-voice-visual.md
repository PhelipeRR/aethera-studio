# AP-02 — Qualidade, fundo visual reutilizado e voz natural Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renderizar novamente o AP-02 sem telas pretas sólidas, usando apenas mídia local já usada nos quatro trechos aprovados, com QA/legendas no FFmpeg completo e narração PT-BR mais natural.

**Architecture:** A seleção de fundos continua no contrato compartilhado e só considera assets que já aparecem como `visual.type === 'asset'` no storyboard aprovado. O estágio de render extrai um quadro desses assets para data URL, injeta-o como `background.image` nas cenas tipográficas e grava a referência no manifesto; o compositor embutido continua cuidando dos segmentos, enquanto o engine completo fica reservado à montagem final e às medições do Quality Director. A voz recebe um override de ritmo por execução, sem alterar a identidade ou a autorização persistente do preset.

**Tech Stack:** TypeScript strict, Zod, Vitest, Electron IPC, Remotion, FFmpeg/FFprobe e repositórios Aethera existentes.

**Spec:** `docs/superpowers/specs/2026-11-11-ap02-quality-voice-visual-design.md`

## Global Constraints

- Usar somente arquivos locais que já foram baixados e já aparecem como mídia usada nos jogos do AP-02.
- Tela preta sólida fica proibida; toda cena precisa de um fundo visual, priorizando mídia já usada do mesmo jogo/assunto.
- Nunca buscar mídia nova, gerar mídia abstrata, cruzar direitos ou gravar no Rights Manager.
- O FFmpeg embutido permanece no compositor/segmentação; FFmpeg completo é usado na montagem final, legendas e medições do Quality Director.
- Se uma capacidade obrigatória do FFmpeg não existir, o relatório permanece bloqueado com diagnóstico explícito.
- A velocidade padrão desta narração deve ser 1,0×; direções por cena continuam entre 0,8× e 1,3× e pausas até 2.000 ms.
- Roteiros devem manter acentos e pronúncia de português brasileiro; humor é leve, opcional, contextual e nunca inventa fatos.
- Não criar commits automaticamente; preservar alterações existentes e registrar comandos, resultados e bloqueios em `docs/aethera/STATUS.md`.

## Review Focus

- Uma cena fallback não pode escolher mídia não usada, bloqueada ou de outro jogo quando há mídia aprovada compatível — coberto pelos testes de seleção em `packages/shared/test/velix-composition.test.ts`.
- Um fundo derivado de gameplay precisa conservar referência, intervalo e base de uso no manifesto — coberto pelo teste AP-02 em `packages/orchestrator/test/velix-render-stage.test.ts`.
- Um ambiente com o FFmpeg embutido sem filtros completos não pode parecer aprovado — coberto pelos testes de capacidade em `packages/workspace/test/velix-production-render.test.ts` e pela checagem blocking existente.
- A montagem final deve gravar legendas e produzir loudness/clipping medidos quando o FFmpeg completo existe — coberto pelo teste real de render/QA.
- Um override de 1,0× deve vencer o preset persistido em 1,12× sem mudar o preset nem a autorização — coberto por `packages/orchestrator/test/velix-narration-stage.test.ts` e pelo contrato IPC.

### Task 1: Seleção compartilhada de fundo visual reutilizado

**Files:**
- Modify: `packages/shared/src/velix-composition.ts`
- Modify: `packages/shared/src/motion.ts`
- Modify: `packages/shared/test/velix-composition.test.ts`
- Modify: `packages/shared/test/motion.test.ts` (criar se a cobertura do schema ainda não existir)

**Interfaces:**
- Produces `MotionBackgroundCandidate { referenceId, media, source?, basis? }` e `MotionBackgroundUse { referenceId, assetRef, source?, basis? }`.
- Produces `selectMotionBackgroundCandidates(storyboard, media, mode): ReadonlyMap<string, MotionBackgroundCandidate>`.
- Extends `compositionPlan(..., options)` with `motionBackgrounds?: ReadonlyMap<string, MotionBackgroundUse>`.
- Extends motion render segments/manifest entries with `backgrounds` contendo referência, intervalo e base de uso.

- [x] **Step 1: Write the failing tests**

  Adicionar casos em `velix-composition.test.ts` que criem duas cenas asset já usadas, uma cena fallback do mesmo assunto e outra de assunto diferente. Verificar que:

  - a cena do mesmo assunto recebe o asset usado do mesmo assunto;
  - a cena sem correspondência recebe apenas o asset já usado mais próximo, nunca um `LocalMedia` que não esteja no storyboard;
  - um asset `not_allowed`/`preview_only` não é candidato ao render final;
  - `compositionPlan` coloca `background.kind === 'image'` quando recebe `motionBackgrounds` e não usa fundo solid preto.

- [x] **Step 2: Run the focused tests and verify failure**

  Run: `npm exec vitest run packages/shared/test/velix-composition.test.ts packages/shared/test/motion.test.ts`

  Expected: FAIL porque ainda não existe seleção de candidato nem injeção de background para cenas Motion.

- [x] **Step 3: Implement the shared contract**

  Em `velix-composition.ts`, considerar apenas cenas `visual.type === 'asset'` do storyboard, validar `mediaRenderable`, ordenar candidatos por mesmo `subjectId`, depois distância de índice e depois `referenceId`, e usar o intervalo de `visual.match` quando presente. Para cada cena fallback sem candidato, manter um gradiente de marca não-preto como último mecanismo técnico, sem criar uma referência falsa de mídia. Em `motion.ts`, permitir que `background.kind === 'image'` carregue o data URL preparado pelo estágio; aumentar o limite somente até o necessário para um JPEG de quadro e manter a validação estrita.

- [x] **Step 4: Run the focused tests and verify pass**

  Run: `npm exec vitest run packages/shared/test/velix-composition.test.ts packages/shared/test/motion.test.ts`

  Expected: PASS; os testes devem provar seleção restrita, background não-preto e rastreabilidade do uso.

### Task 2: Quadro de gameplay sob texto e render sem preto

**Files:**
- Modify: `packages/workspace/src/velix-production-render.ts`
- Modify: `packages/workspace/test/velix-production-render.test.ts`
- Modify: `packages/orchestrator/src/velix-render-stage.ts`
- Modify: `packages/orchestrator/test/velix-render-stage.test.ts`
- Modify: `apps/desktop/src/renderer/src/features/video/motion/MotionComposition.tsx`
- Modify: `packages/shared/src/velix-composition.ts` (somente para completar a interface definida na Task 1)

**Interfaces:**
- Produces `extractStillDataUrl(input: { ffmpeg: string; source: string; kind: 'image' | 'video'; atMs: number; signal?: AbortSignal }): Promise<string>` in `velix-production-render.ts`.
- Extends `RenderStageDeps` with `backgroundFrame(input: { source: string; kind: 'image' | 'video'; atMs: number; signal: AbortSignal }): Promise<string>`.
- `createRenderStageAdapter` prepares one data URL per background candidate, passes `motionBackgrounds` to `compositionPlan`, and records background uses in motion segments and `mediaReferenceIds`.

- [x] **Step 1: Write the failing tests**

  Em `velix-production-render.test.ts`, gerar um vídeo sintético local e verificar que `extractStillDataUrl` retorna `data:image/jpeg;base64,...` de um instante diferente de zero. Em `velix-render-stage.test.ts`, montar um storyboard com uma cena fallback e uma cena asset já usada, injetar um `backgroundFrame` fake e verificar que o projeto Motion recebe o data URL e que o manifesto registra o `referenceId`, `source` e `basis` do fundo.

- [x] **Step 2: Run the focused tests and verify failure**

  Run: `npm exec vitest run packages/workspace/test/velix-production-render.test.ts packages/orchestrator/test/velix-render-stage.test.ts`

  Expected: FAIL porque a extração, a dependência do estágio e os campos de manifesto ainda não existem.

- [x] **Step 3: Implement frame extraction and compositor support**

  Implementar a extração usando o FFmpeg já disponível, com `-ss`, `-frames:v 1`, escala limitada e saída JPEG em buffer; rejeitar caminho inválido/saída vazia. No estágio, preparar somente candidatos escolhidos da Task 1, usando o meio do intervalo aceito ou `0 ms`, e preservar o cache de segmentos por referência/intervalo sem incluir bytes voláteis no `segmentKey`. Em `MotionComposition.tsx`, renderizar `background.image` como `<Img>` atrás de todos os tipos de cena, aplicar o `dim` como overlay e parar de sobrescrever o fundo do preset base com `#000000`; o estilo default deve ser um gradiente escuro de marca, nunca preto sólido.

- [x] **Step 4: Run the focused tests and verify pass**

  Run: `npm exec vitest run packages/workspace/test/velix-production-render.test.ts packages/orchestrator/test/velix-render-stage.test.ts`

  Expected: PASS; cenas tipográficas têm quadro reutilizado ou gradiente não-preto, e os usos aparecem no manifesto sem alterar Rights Manager.

### Task 3: Separar FFmpeg de composição e FFmpeg completo de QA

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/workspace/src/velix-production-render.ts`
- Modify: `packages/workspace/test/velix-production-render.test.ts`
- Modify: `packages/orchestrator/test/velix-render-stage.test.ts`
- Modify: `docs/aethera/STATUS.md`

**Interfaces:**
- Adds a quality-engine resolver in `apps/desktop/src/main/index.ts` that prefers `NB_QUALITY_FFMPEG`/`NB_QUALITY_FFPROBE`, then configured `NB_FFMPEG`/`NB_FFPROBE`, then executables on PATH.
- Keeps `productionMedia()` for `renderMotion` and `renderAsset`.
- Routes `assemble`, `probe`, `silences`, `inspect` and the recorded QA engine name through the quality engine.
- Adds a capability check for `subtitles`, `ebur128`, `astats`, `silencedetect`, `blackdetect` and `freezedetect`; missing mandatory filters produce an explicit unavailable/blocking result.

- [x] **Step 1: Write the failing tests**

  Testar com o FFmpeg completo disponível que `ffmpegFilters` encontra os filtros necessários, `assembleProduction` retorna `captionsBurned: true` quando recebe SRT e `inspectRenderQuality` retorna `loudness` preenchido. Testar também um binário sem `subtitles`/`ebur128` e verificar diagnóstico explícito, nunca aprovação.

- [x] **Step 2: Run the focused tests and verify failure**

  Run: `npm exec vitest run packages/workspace/test/velix-production-render.test.ts packages/orchestrator/test/velix-render-stage.test.ts`

  Expected: FAIL no ambiente atual porque a montagem/inspeção ainda recebem o FFmpeg embutido através de `productionMedia()`.

- [x] **Step 3: Implement the resolver and wiring**

  Criar a resolução determinística sem hardcode de caminho de usuário. Manter o engine embutido somente na composição de segmentos; usar o engine completo na montagem final, no FFprobe e nas medições do Quality Director. Fazer `inspectRenderQuality` verificar os filtros antes dos comandos e preservar `null`/bloqueio quando a medição não puder ser feita. Não transformar ausência de filtro em aprovação e não mudar direitos, claims ou Rights Manager.

- [x] **Step 4: Run the focused tests and verify pass**

  Run: `npm exec vitest run packages/workspace/test/velix-production-render.test.ts packages/orchestrator/test/velix-render-stage.test.ts`

  Expected: PASS; o relatório registra loudness/clipping e legendas gravadas com o engine completo, enquanto um engine incompleto segue bloqueando.

### Task 4: Voz C em 1,0×, PT-BR e humor controlado

**Files:**
- Modify: `packages/shared/src/channels.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/src/features/video/ProductionChannelVoice.tsx`
- Modify: `packages/orchestrator/src/velix-narration-stage.ts`
- Modify: `packages/orchestrator/src/velix-script-stage.ts`
- Modify: `packages/orchestrator/src/video-script.ts`
- Modify: `packages/shared/test/aethera-voice.test.ts`
- Modify: `packages/orchestrator/test/velix-narration-stage.test.ts`
- Modify: `packages/orchestrator/test/video-script.test.ts`
- Modify: `packages/orchestrator/test/velix-script-stage.test.ts`

**Interfaces:**
- Extends `productionRunNarrationVoice` IPC input with optional `speed: number` bounded to `0.8..1.3`.
- `ProductionChannelVoice` sends `speed: 1.0` by default for the AP-02 channel narration and keeps per-scene speed/pauses available.
- `velix-narration-stage` gives an explicit run speed precedence over `VoicePreset.speed` and appends guidance for natural Brazilian Portuguese pronunciation without changing the preset identity.

- [x] **Step 1: Write the failing tests**

  Verificar que o contrato IPC aceita `speed: 1.0` e rejeita valores fora do intervalo; que a etapa de narração, com preset 1,12× e input 1,0×, envia 1,0× a todos os blocos; e que os prompts contêm: acentos PT-BR preservados, pontuação/pausas, números e siglas pronunciáveis, humor leve opcional e proibição de inventar fatos.

- [x] **Step 2: Run the focused tests and verify failure**

  Run: `npm exec vitest run packages/shared/test/aethera-voice.test.ts packages/orchestrator/test/velix-narration-stage.test.ts packages/orchestrator/test/video-script.test.ts packages/orchestrator/test/velix-script-stage.test.ts`

  Expected: FAIL nos contratos/prompt/precedência de velocidade ainda não cobertos.

- [x] **Step 3: Implement the voice and prompt changes**

  Propagar o override pelo IPC até o `scheduleAdapterStage`; manter o preset persistido e sua autorização intactos. Atualizar os prompts curto e longo com as regras PT-BR e humor opcional; não inserir humor em afirmações, números, datas ou citações que dependam de fonte. Ajustar o texto da UI para deixar claro que 1,0× é o ritmo desta narração, não uma alteração global da voz.

- [x] **Step 4: Run the focused tests and verify pass**

  Run: `npm exec vitest run packages/shared/test/aethera-voice.test.ts packages/orchestrator/test/velix-narration-stage.test.ts packages/orchestrator/test/video-script.test.ts packages/orchestrator/test/velix-script-stage.test.ts`

  Expected: PASS; Voz C mantém seed/modelo/autorização e a nova geração usa ritmo 1,0× com instruções naturais de PT-BR.

### Task 5: Rerender, validação e registro do AP-02

**Files:**
- Modify: `docs/aethera/STATUS.md`
- Use existing AP-02 storyboard, manifest, downloaded media and approved run data; do not add new media files.

**Interfaces:**
- Consumes the completed shared visual plan, quality engine and narration override from Tasks 1–4.
- Produces a new AP-02 render/manifest/SRT/report in the existing project run folder and evidence in STATUS.

- [x] **Step 1: Run the narrow project verification**

  Run: `npm exec vitest run packages/shared/test/velix-composition.test.ts packages/workspace/test/velix-production-render.test.ts packages/orchestrator/test/velix-render-stage.test.ts packages/orchestrator/test/velix-narration-stage.test.ts packages/orchestrator/test/video-script.test.ts`

  Expected: PASS, or an environment-only failure recorded with its exact cause; do not disable tests.

- [x] **Step 2: Regenerate the AP-02 narration at 1,0× and synchronize**

  Use the existing approved Voice C, storyboard and authorization. Preserve the four approved media references and do not create new source files. To honor the absolute no-black rule, the second Elden Ring segment uses a clean subrange of the same already-downloaded trailer (`128000–135835 ms`) instead of its original source window, which contained source-provided black frames. If the local AP-02 run/database is unavailable, mark only this execution step blocked and preserve the code/test evidence.

- [x] **Step 3: Render 1920×1080 at 30 fps and run the checks**

  Verify with FFprobe: resolution, frame rate, duration and audio. Verify with the Quality Director: no solid-black intervals, no unavailable loudness/clipping measurement, subtitles burned, and any remaining factual/rights/subject blocks reported accurately. Compare frames against the four approved source ranges and confirm no new Rights Manager entries.

- [x] **Step 4: Record evidence in STATUS**

  Record the commands, engine paths/names, filter capabilities, render path, manifest path, SRT path, frame comparisons, quality checks, rights result and any residual blocking claims in `docs/aethera/STATUS.md`. Leave the worktree uncommitted.

## Self-review checklist

- Shared selection covers the approved-media-only rule and same-subject preference.
- Motion rendering covers the user’s absolute “zero solid black screen” requirement, including the no-candidate emergency gradient.
- Manifest and media-use accounting preserve auditability of reused frames.
- Full FFmpeg is used only where the Quality Director/embedded subtitles need it; the bundled engine remains the compositor.
- Voice speed override, PT-BR punctuation/accent guidance and optional humor are independently tested.
- The final AP-02 rerender is attempted only with the existing downloaded/used media and all blockers are reported rather than bypassed.

