# Status de qualidade e segurança

## ComfyUI image engine — audit and native integration (2026-11-17)

- [x] **Diagnóstico reproduzível:** `npx tsx scripts/comfyui-audit.ts` confirma ComfyUI `0.20.1` em `C:\Users\Pheli\AppData\Local\Programs\ComfyUI`, endpoint local `http://127.0.0.1:8000`, Python 3.12.11, PyTorch `2.10.0+cu130`, CUDA 13.0 e RTX 4060 Ti com 8,585,216,000 bytes de VRAM. Evidência completa: `docs/comfyui-audit.md`.
- [x] **Engine real:** cliente loopback (`/system_stats`, `/object_info`, `/prompt`, `/history`, `/view`, `/upload/image`, `/interrupt`, `/free`), discovery, workflows nativos txt2img/img2img/inpaint/upscale e adapter integrado antes do fallback SDXL local.
- [x] **Controles profissionais:** presets Anime Premium, Anime Cinematic, Gaming Cinematic, Cyberpunk Neon, YouTube Thumbnail e Banner; seed, resolução, steps, CFG, sampler, scheduler, checkpoint persistido, referência img2img com intensidade de preservação, LoRA nativa opcional, ControlNet e IP-Adapter opcionais com imagem de condicionamento, e reparo localizado (`VAEEncodeForInpaint`) quando disponíveis.
- [x] **Segurança de qualidade/VRAM:** lease serial de GPU, liberação explícita/opcional de memória, relatório visível no painel, rejeição de buffers inválidos/quase uniformes por dimensão e `σ` de luminância.
- [x] **Gate contra fallback vazio:** documentos de produção de thumbnail/banner marcam `visualFocusRequired`; sem sujeito ou fundo de imagem asset-backed, o `QualityGateService` emite `THUMBNAIL_NO_VISUAL_FOCUS`/`BANNER_NO_VISUAL_FOCUS` crítico. Coberto por regressão dedicada; fixtures técnicas de layout continuam sem essa exigência.
- [x] **Harness de aceitação:** `npx tsx scripts/comfyui-acceptance.ts` executou os seis casos baseline reais e `scripts/comfyui-advanced-acceptance.ts` executou Depth, OpenPose e IP-Adapter com seeds, tempos, picos de VRAM, PNGs e `report.json` reais; nenhum resultado foi fabricado.
- [x] **Histórico persistente:** migração aditiva `0122_aethera_creative_generation_runs.sql`, IPC de listagem/regeneração e painel com regeneração explícita; o pedido armazenado exclui o manifesto transitório de assets.
- [x] **Múltiplos personagens:** regiões não sobrepostas (1–8) entram na receita; com ComfyUI real, dois ou mais personagens executam um passe de ambiente e inpaint delimitado por região, sem alegar contagem correta antes da revisão visual humana.
- [x] **Operação no painel:** seed opcional, resolução IA (768/1024 px), batch serializado (1–4), prévias de lote, regeneração pelo histórico e ação explícita de upscale do fundo; fidelidade estética/contagem/anatomia continuam gates de revisão humana.
- [x] **Bootstrap operacional:** Animagine XL 3.1, Illustrious XL v2, 4x-UltraSharp, Impact Pack/Subpack/Manager, detector FaceDetailer, ControlNet Depth/OpenPose, `controlnet_aux`, IP-Adapter Plus e CLIP Vision foram instalados e conferidos por hash; as capacidades foram redescobertas no `/object_info`.
- [x] **Validação visual/runtime avançada:** Depth e OpenPose produziram condições reais e gerações coerentes; a revisão visual desta execução considerou `0.35` um candidato seguro, enquanto `0.80` foi rejeitado por superexposição apesar do gate estrutural. O painel agora parte de `0.35` e expõe o modelo disponível; aceite humano de produção continua pendente.
- [x] **Auto-start opcional:** configuração persistente e checkbox no painel invocam `Start-ComfyUI.ps1` uma única vez quando o endpoint está offline, com estados `starting/ready/missing/failed`; o default permanece desligado.
- [x] **Recuperação real:** `scripts/comfyui-autostart-acceptance.ts` parou os processos ComfyUI verificados, ativou o auto-start pelo serviço Aethera e confirmou endpoint/provider `ready`; evidência em `artifacts/comfyui-autostart-acceptance/report.json`.
- [x] **Integração LoRA segura:** catálogo lê metadados safetensors quando disponíveis, classifica a seleção essencial (personagem, cinematográfico, mangá, efeitos e games), bloqueia seleção automática sem arquitetura verificada, encadeia até três LoRAs no workflow nativo, expõe `off/manual/automatic` no painel, persiste a pilha por projeto e inclui a explicação no relatório de geração.
- [ ] **Pendências operacionais:** revisão comercial da licença “other” do OpenPose. LoRA continua indisponível porque nenhum modelo LoRA foi instalado.
- [x] **Validação de código:** settings focados 2/2, renderer TypeScript e main TypeScript isolado passaram; `npm run typecheck` agregado ainda reproduz somente o JSX6142 preexistente em `apps/aethera-desktop/test/delete-prompt-dialog.test.ts`.

## Fontes de mídia do Aethera (2026-11-15)

Detalhes em `docs/aethera/MEDIA-SOURCES.md`.

- **Operacionais com validação real:** Steam, nekos.best (aquisição bloqueada pelos ToS), kawaii.red (licença pendente de revisão) e HF Datasets (só metadados).
- **Pendentes de chave:** IGDB, YouTube, Pexels e Pixabay. Até agora foram testados apenas com mocks.
- **Testes:** `media-providers` 30/30, `media-sources-service` 6/6, `settings-isolation` ok.
- **Falhas pré-existentes, não relacionadas a esta mudança:**
  - `media-relevance-coverage-voice` "funnel audit" é instável (usa rede real e estoura o timeout de 5 s).
  - `staged-pipeline` "pauses in paused_pending_media…" falha.

## Console de Produção profissional (Aethera Studio) (2026-11-15)

- [x] **Modelo de log (`apps/aethera-desktop/src/main/production-console.ts`):** cada entrada passou a carregar `jobId`, `runId`, `origin`, `channel` (`progress`/`command`/`stdout`/`stderr`/`result`), `event` (`stage_started|completed|failed|retry|paused`, `command_*`, `log`), `pct`, `durationMs`, `exitCode` e `details` técnicos. Redação de segredos estendida a `details` (incluindo arrays e objetos aninhados), truncamento por campo (`maxFieldChars`), filtros por severidade/etapa/origem/canal/evento/fonte/busca/janela temporal, `facets()` para os seletores e normalização de entradas antigas do JSONL. Persistência por job em `userData/cinema-console-logs`, 4000 entradas em memória, 8 MB por arquivo com rotação.
- [x] **Execução real de processos (`production-agent-runner.ts`):** `spawn` sem shell com streaming linha a linha (`onLine`), captura limitada por stream, timeout, cancelamento por `AbortSignal`, contagem de linhas, detecção de ENOENT sem exceção e `runInstrumentedCommand`, que grava comando, stdout, stderr e resultado com código de saída e duração. Nada é sintetizado: só o que o processo escreveu.
- [x] **Agentes reais (`production-agent-providers.ts`):** Antigravity (`agy --output-format json --mode plan --print`), Claude Code (`claude -p --output-format stream-json --verbose`, com `readClaudeStreamLine`/`ClaudeStreamReader` resumindo eventos `system/assistant/result` e extraindo a resposta final) e Codex (`codex exec --skip-git-repo-check`). Localização via `findAntigravityCli`/`findClientCli`; provedor ausente vira entrada `warn`, não erro inventado.
- [x] **Ciclo de vida das etapas (`production-stage-tracker.ts`):** snapshots do `StagedCinemaPipeline` viram `stage_started`, `stage_completed` (com duração), `stage_failed` (com o erro real), `stage_retry` (etapa reentrante) e `stage_paused` (`cancelled`/`paused_pending_*`), mantendo os jobs isolados. Foi corrigido também o `stage` inválido que o console gravava em estados como `error`/`paused_pending_media`.
- [x] **Instrumentação dos pontos reais (`aethera-ipc.ts`):** pesquisa editorial e roteiro por blocos passam pela cascata instrumentada (comandos, streams, resultado, fallback entre agentes); busca e aquisição de mídia registram consulta, provedor, tentativas e progresso real em bytes do `yt-dlp` (throttle de 5%/3 s); o progresso do job propaga o `pct` para as linhas de agente. Assinatura de `searchExternalMedia`/`acquireExternalMedia`/`runEditorialResearch` ganhou `context.projectId` (parâmetro opcional, retrocompatível) para associar cada entrada ao job correto.
- [x] **Thumbnails (`creative-studio-service.ts`):** cada execução dos motores de direção criativa (Claude Code, Codex, Antigravity, Claude Gateway) é registrada no console sob o job `creative-studio`, com duração, tamanho e prévia da resposta; o painel do Creative Studio monta o mesmo `ProductionConsoleAccordion`.
- [x] **UI (`ProductionConsoleAccordion.tsx` + `production-console-view.ts`):** accordion recolhível e abas Terminal/Eventos/Erros preservadas, agora com barra de progresso da etapa corrente, linha do tempo de etapas (iniciada/concluída/falha/retry/pausada), percentual e etapa por linha, badge de origem, distinção visual de stdout/stderr, filtros por origem, agente/fonte, etapa, nível, canal e período, busca, detalhes técnicos expansíveis (comando, argumentos, exit code, stderr), atualização em lote a cada 140 ms (máx. 600 linhas na janela), autoscroll opcional, cópia e exportação TXT/JSON.
- [x] **Testes:** `production-console-professional.test.ts`, `production-agent-runner.test.ts` (processos Node reais: ordem dos streams, exit code, timeout, abort, cap de linhas, ENOENT, stream-json), `production-stage-tracker.test.ts` e `production-console-view.test.ts` — **52/52** junto de `production-console.test.ts`. `tsc -p tsconfig.node.json`/`tsconfig.web.json`, `npm run build:aethera` e `eslint` dos arquivos novos sem erros.
- [x] **Validação com execução real:** `AETHERA_CONSOLE_REAL=1 npx vitest run apps/aethera-desktop/test/console-real-agents.test.ts` executou os CLIs instalados e gravou evidências em `artifacts/aethera-console/<timestamp>/` (`console.jsonl`, `console.txt`, `summary.json`). Claude Code concluiu (`result` com `exit=0`, 5,4 s, 6 linhas de stream resumidas); Antigravity respondeu `429 RESOURCE_EXHAUSTED` (créditos) e Codex `usage limit` — ambas as falhas reais foram registradas com stderr e código de saída, sem inventar saída.
- [ ] **Pendências fora do escopo:** 3 arquivos de teste de `packages/cinema` falham por timeout de render FFmpeg real e `apps/aethera-desktop/test/staged-pipeline.test.ts` falha no passo `resolvePendingMedia` (confirmado pré-existente: reproduz com `cinema-pipeline.ts` original via `git stash`); `eslint` ainda acusa erros pré-existentes em `aethera-ipc.ts` (tipos de calendário não usados, asserções não nulas antigas) e `creative-studio-service.ts`.
- [x] **Correção de compilação pré-existente:** `creative-studio-service.ts` referenciava `this.compositionEngine` (inexistente) em `runTypographyLab`; trocado por `this.engine`, destravando `npm run typecheck -w @neuralbridge/aethera-desktop`.

### Validação funcional do console (2026-11-15)

Relatório completo em `docs/aethera/production-console-validation.md`.

- [x] **Produção real concluída no Electron:** prompt "Os 3 chefes mais difíceis de Elden Ring", 10 s, `draft_540p`, 3 clipes semeados, render real por FFmpeg — `editor`/100% em 158 s, com a sequência completa de etapas e percentuais (`prompt 5 → 8 → interpretacao 18 → pesquisa 32 → roteiro 44 → decupagem 56 → aquisicao 62 → validacao_visual → planejamento 74 → montagem 84 → audio_sfx_vfx 92 → previa 100 → editor`). Evidência: `artifacts/aethera-console-e2e/<ts>/`.
- [x] **Fallback real:** `antigravity-cli` falhou (`exit=3`, quota 429), `claude-cli` assumiu e concluiu pesquisa (54 s) e roteiro (10,5 s); a produção seguiu sem travar. `codex-cli` bloqueado por limite de uso da conta.
- [x] **Isolamento por job:** `console-isolation.test.ts` com processos reais (simultâneos e consecutivos) — arquivos e listagens separados por job, `runId` separando execuções, histórico recarregado após reinício.
- [x] **Segredos:** `console-secrets.test.ts` cobre broadcast, list, TXT, JSON, JSONL e histórico recarregado. Achado real corrigido: valor de segredo passado como argumento separado (`--password valor`) não era mascarado; `previewArguments()` agora mascara valores após flags sensíveis e a forma inline.
- [x] **UI Electron validada na rota real** (`tests/e2e/aethera-console-ui.spec.ts`): progresso 20% + sessão, timeline com `✓/●/Ⅱ/○`, filtros por origem (46→42), canal (34 linhas só stdout/stderr), busca/nível/etapa/período, auto-scroll, detalhes expansíveis e aba Erros (3 linhas, todas `error`). Desempenho com histórico de 2.400 entradas (1,28 MB): abre em 180 ms e filtra em 80 ms.
- [x] **Integração corrigida:** o componente estava só em `App.tsx` (shell legado, fora do roteador). Movido para `packages/desktop-shared/src/renderer/src/features/video/` e montado no `CinemaDirectorPanel` (`/aethera/cinema`); o arquivo antigo virou re-export.
- [ ] **Bloqueios externos registrados:** quota Antigravity esgotada (~126 h) e limite de uso do Codex; ~~teto de 90 s por tentativa de pesquisa~~ resolvido em 2026-11-16: agentes editoriais rodam sem tempo total fixo, com timeout de inatividade configurável (padrão 10 min) e limite máximo opcional (ver `docs/aethera/production-console-validation.md` §7).
- [ ] **`resolvePendingMedia(allowProcedural)` é no-op sem dossiê (pré-existente):** a autorização é gravada no slot e o slot é removido, mas `computeIncrementalInvalidation` invalida `aquisicao` no resume quando não há dossiê, e `allowProcedural` não é lido em nenhum outro ponto do pipeline. `staged-pipeline.test.ts` reproduz o mesmo comportamento com o arquivo original (via `git stash`).


### Console individual por produção (jobId) e Console Geral (2026-11-15)

Detalhes em `docs/aethera/production-console-validation.md` §8.

- [x] **Identidade da execução = `jobId` + `attempt`**, não `projectId`: pipeline, tracker de etapas (`recordPipelineSnapshot`), agentes, pesquisa, mídia, narração, render, thumbnails (job `thumb_…` por execução), IPC/preload e persistência (`<jobId>.log.jsonl` + `jobs-index.json`). Logs antigos continuam legíveis (jobId = projectId).
- [x] **UI:** o mesmo `ProductionConsoleAccordion` (desktop-shared) roda por `jobId` dentro do card de cada produção e como Console Geral (`scope="all"`) com filtros por job, status, agente e etapa; Creative Studio usa o geral restrito a thumbnails.
- [x] **Correções encontradas na revisão:** foco da tela trocava entre produções simultâneas; botão de iniciar ficava bloqueado durante uma produção; cancelar durante a pesquisa virava `paused_pending_research`; a execução substituída apagava o controller da retomada (cancelar parava de funcionar) e podia sobrescrever o job; console carregava as 600 linhas mais antigas em vez da cauda.
- [x] **Testes:** `console-concurrency.test.ts` (4 produções simultâneas + 2ª produção do mesmo projeto, processos reais; 3/3 verdes), `staged-pipeline-jobs.test.ts`, tracker e view — 79 testes do console/pipeline verdes (fora a falha pré-existente de `staged-pipeline.test.ts`).
- [ ] **Validação real limitada por contas:** Antigravity com quota esgotada e Codex no limite de uso; com HOME isolado o Claude cai na `ANTHROPIC_API_KEY` do ambiente ("Invalid API key"). Use `AETHERA_CONSOLE_JOBS_REAL_HOME=1` para os CLIs usarem o login normal.
- [ ] **Limite conhecido:** o pipeline continua com uma execução ativa por workspace de projeto (iniciar outra produção no mesmo projeto aborta a anterior, cujo histórico fica preservado no próprio `jobId`).

## Dependências do monorepo — `npm ls --workspaces` (2026-11-15)

- [x] **Neura (E404 / UNMET `@neuralbridge/extensions-neura@0.1.0`):** causa raiz — `apps/void-desktop/package.json` usava o nome da pasta (`extensions-neura`) em vez do nome do pacote. O workspace em `packages/extensions-neura` se chama `@neuralbridge/extension-neura` (singular) versão `1.0.0`, então o npm buscava um pacote inexistente no registro. Correção: dependência trocada para `"@neuralbridge/extension-neura": "1.0.0"` e a lista `WORKSPACE_PACKAGES` de `apps/void-desktop/electron.vite.config.ts` ajustada para o mesmo nome. Não há imports de código do pacote nos apps; o caminho de pasta `packages/extensions-neura` no script `typecheck` raiz continua correto.
- [x] **Cinema (UNMET `@neuralbridge/cinema@0.1.0`):** o pacote existe em `packages/cinema` e está coberto pelo glob `packages/*`, mas o `package-lock.json` estava defasado: não tinha entradas para `packages/cinema`, `packages/creative-studio`, `packages/desktop-shared`, `packages/integration-contracts` nem para os apps `aethera-desktop`, `orchestrator-desktop` e `void-desktop` (adicionados sem regenerar o lock). Sem entrada no lock, o npm não criava o link `node_modules/@neuralbridge/cinema`. Correção: `npm install` incremental (sem apagar `node_modules`/lock) adicionou as entradas e os links; pacote e implementação preservados.
- [x] **Zod (`zod@4.6.7 invalid: "4.3.6"`):** `integration-contracts`, `cinema` e `creative-studio` fixavam `4.3.6`, enquanto `shared`, `brain`, `core`, `mcp-server`, `orchestrator` e `apps/desktop` usam `4.6.7` (versão hoisted na raiz, que esses três pacotes já resolviam na prática). Mesma major (minor bumps, sem quebra de API usada). Correção: padronizado em `4.6.7`.
- **Validação:** `npm install` sem E404; `npm ls --workspaces --depth=0` exit 0 sem UNMET/invalid; `tsc -p` OK em `integration-contracts`, `creative-studio`, `extensions-neura`, `shared`; `npm run typecheck -w @neuralbridge/void-desktop` OK; `npm run build:void` e `npm run build:aethera` OK; testes de `packages/integration-contracts` passam.
- [ ] **Pendências pré-existentes, fora deste escopo (não relacionadas a dependências):** `tsc -p packages/cinema` falha com 55 erros de strictness só em arquivos `test/*.test.ts` (ex.: `waveform-extractor.test.ts`, `trend-radar.test.ts`); `npm run typecheck -w @neuralbridge/aethera-desktop` falha em `src/main/creative-studio-service.ts:460` (`compositionEngine` inexistente, já presente em HEAD `2a988ab`); 10 testes de `packages/cinema` falham por timeouts de render FFmpeg real e `ENOENT`/`EPERM` em diretórios temporários.

## Aethera Creative Studio (`CS-1` .. `CS-5`) (2026-11-15)

- [x] **CS-1 — Fundação (`@neuralbridge/creative-studio` + `@neuralbridge/database`):** schemas portáveis v1, `AssetIngestionService` (SHA-256, sem traversal), `BrandKitManager`, `SharpSvgCompositionEngine` (com `sharp` + SVG e interface `ExternalImageAdapter`), `ExportService` (PNG/JPG/WebP/`.aethera-creative.json` + prévia animada + marca d'água idempotente em vídeo) e migração `0121_aethera_creative_studio.sql`. Validado em `packages/creative-studio/test/cs1-foundation.test.ts` (5/5) e `tsc`.
- [x] **CS-2 — Editor por Camadas (`LayeredDocumentEditor`):** histórico undo/redo, alinhamento em área segura, máscaras, efeitos não destrutivos, edição localizada por prompt e dirty-tracking. Validado em `packages/creative-studio/test/cs2-editor.test.ts` (1/1) e `tsc`.
- [x] **CS-3 — Frame Analyzer, Orquestrador 4 Motores, Quality Gate & Thumbnail Lab:** `VideoFrameAnalyzer` (ffmpeg/ffprobe + sharp stats), `CreativeOrchestrator` (Claude Code, Codex CLI, Antigravity CLI, Claude Gateway + fallback RF-07 para 1 agente), `QualityGateService` (bloqueio em falhas críticas + scorecard heurístico sem previsão de CTR) e `CompositionPlanner` (3 variações no Thumbnail Lab). Validado em `packages/creative-studio/test/cs3-orchestrator-lab.test.ts` (3/3) e `tsc`.
- [x] **CS-4 — Integração Full-Stack (`apps/aethera-desktop`):** `AetheraCreativeStudioService` com os 4 provedores reais (`ClaudeCliAdapter`, `CodexCliAdapter`, `antigravity-cli`, `claudeGatewaySecretStore`), IPC `creative:*`, `CreativeStudioPanel.tsx`, gancho automático de thumbnail em `cinema:render-real-mp4` e inclusão no Backup Geral (`system-backup.ts`).
- [x] **CS-5 — Validação E2E Real, Typecheck & Build:** suíte `packages/creative-studio/test/` (10/10 em 4 arquivos) cobrindo Cyberpunk 2077 gameplay frames + Thumbnail Lab + prévia MP4 + reabertura de `.aethera-creative.json`, banner `2560×1440`, avatar `800×800`, marca d'água `150×150` transparente aplicada de forma idempotente em vídeo, persistência SQLite (`0121_aethera_creative_studio.sql`), `tsc` e `npm run build:aethera`.
- [x] **CS-6 — Inteligência Visual Profissional (`LocalPythonAiAdapter` + Composição Cinematográfica):** geração local por IA (`stabilityai/sdxl-turbo` em CUDA RTX 4060 Ti 8 GB), segmentação semântica real (`rembg` `u2net`), `ProviderChainImageAdapter`, efeitos cinematográficos editáveis (`directionalLight`, `rimLightColor`, `depthBlur`, `dropShadow`, `outerGlow`), edição por prompt expandida e evidências visuais reais em `artifacts/creative-studio-cs6/`. Validado com **13/13** testes em 6 arquivos (`cs6-visual-intelligence.test.ts` + `cs6-real-ai-e2e.test.ts`), `tsc` e `npm run build:aethera`.
- [x] **CS-7 — Revisão Arquitetural de Direção de Arte, Relevância Editorial & Identidade Persistente:** composição orientada por assunto e roteiro (`extractTopicVisualBrief`, genérica para jogos/animes/documentários), `segment-adaptive` + `trimTransparentBounds`, enquadramentos distintos (`closeup`/`medium`/`full`) com integração luminosa natural (sem halos exagerados) e remoção de barras/pílulas decorativas sem função narrativa, 3 conceitos distintos no Thumbnail Lab com fundos de IA próprios, banner `2560×1440` sem redundância de marca com `slogan` configurável no `BrandKit` e validação de área segura Desktop/Celular/TV (`1546×423`), `QualityGateService` em resolução original e miniatura reduzida (`224×126` / `320×180`, `BANNER_BRAND_REDUNDANCY`, `BANNER_SAFE_AREA_VIOLATION`, `THUMBNAIL_LOW_LEGIBILITY_AT_SMALL_SIZE`, rejeição de composições genéricas), `editorialRationale` no `CreativeDirectorAgent` e evidências visuais regeneradas em `artifacts/creative-studio-cs7/`. Validado com `cs7-director-identity.test.ts` (**4/4**), `cs6-visual-intelligence.test.ts` (**2/2**), `cs3-orchestrator-lab.test.ts` (**3/3**), `cs1-foundation.test.ts` (**5/5**), `cs2-editor.test.ts` (**1/1**) e `npm run build:aethera`. *(Status estético: pendente de aprovação).*
- [x] **CS-8 — Concept-Driven Creative Engine (`ConceptDrivenEngine` + Modos de Fidelidade + Avaliação Semântica Multimodal CLIP + Combinação de Conceitos):** ideação de 3 conceitos narrativos independentes com diversidade por gênero (`games`, `anime`, `documentary`) sem exigir personagem humano; modos de fidelidade (`conceptual_art`, `content_faithful`, `authentic_gameplay`) com bloqueio de conteúdo sintético quando `authentic_gameplay` é exigido; transformação `ai_img2img` condicionada mantendo o mesmo sujeito em comparações antes/depois; avaliação semântica multimodal pós-render com `openai/clip-vit-base-patch32` (`evaluate-semantic` em `vision_worker.py` e `LocalPythonAiAdapter.evaluateImageSemantics`) + rejeição/reparo automático de propostas fora do tema; combinação entre conceitos (`combineConceptElements`, IPC `creative:combine-concepts`) e seletores de fidelidade/origem de vídeo em `CreativeStudioPanel.tsx`; evidências reais em `artifacts/creative-studio-cs8/`. Validado com `cs8-concept-engine.test.ts` (**3/3**), `cs1`/`cs2`/`cs3`/`cs6` (**11/11** — **14/14** no total), `tsc -p packages/creative-studio/tsconfig.json --noEmit`, `tsc -p apps/aethera-desktop/tsconfig.web.json --noEmit` e `npm run build:aethera`. *(Nota: `packages/cinema/src/qc/media-relevance-gate.ts` possui alteração não comitada de outra frente com duplicidade de `animeProvenanceMeta` em `tsconfig.node.json`, preservada sem modificação).*
- [x] **CF-0/CF-1 — Baseline e correções do banner NextWorth (2026-11-16):** CF-0 mediu o fluxo atual e confirmou visualmente o fallback vazio (`luma σ 3,19`) aprovado indevidamente pelo gate (`78 ✓`), além do custo SDXL-Turbo (`44,1 s`, `5060→7607 MiB`). CF-1 implementou receita visual EN determinística com seed/paleta/zona segura, direção estruturada antes da geração, relatório explícito de geração/fallback no serviço e painel, composição AI sem blur/escurecimento global e scrim local. A passagem real `npx tsx scripts/cf-banner-acceptance.ts cf1` gerou 2/2 seeds em `16,5–18,6 s`, picos `6560–6565 MiB`, `luma σ 58,40/59,48` e gates `86/87`; as prévias mostram personagens, skyline e efeitos de energia em vez de gradiente vazio. A correção pós-baseline agora marca thumbnails/banners de produção com `visualFocusRequired` e bloqueia o fallback apenas de paleta/texto com finding crítico, coberta por teste regressivo. Testes focados CF-1 + CS-1/2/3: **21/21**; typecheck do pacote e renderer: ok. O typecheck do processo principal ainda reproduz apenas o erro pré-existente de JSX em `test/delete-prompt-dialog.test.ts`. Falhas CS-7/CS-9 e o teste de persistência que inicializa CLIs reais permanecem pendências independentes.
- [ ] **CS-9 (BLOQUEADA — aprovação pendente; não iniciar a matriz de nove thumbnails):** (1) conjunto de referência em `artifacts/cs9-reference-set/labels.json` (32 imagens, incluindo as rejeitadas e depois aprovadas pelo gate CS-9; rótulos humanos documentados só por conjunto para CS-7/CS-8, os demais são revisão visual provisória com `humanLabel` a preencher) e benchmark `scripts/cs9-reference-benchmark.ts`: a métrica "Quality" dos scripts CS-9 aprova 23/25 imagens ruins (FPR 0,92) e o gate histórico aprovou 2/5 erradas (Johnny, Malenia); (2) tipografia auditada pela geometria real renderizada (`typography-geometry-audit.ts`, integrada ao `QualityGateService` e ao `TypographyQualityCritic`): corte por canvas/caixa (contagem de glifos), colisões por máscara de pixels, área segura 5%, selo de duração, oclusão e tamanho/contraste WCAG medidos em 224×126; corrigiu o renderizador da espinha vertical (antes invisível) e a margem da espinha; (3) porta `AuthenticMediaSource` no `ConceptDrivenEngine` + adaptador desktop `creative-authentic-media.ts` reutilizando IGDB, biblioteca local, Wikimedia, Internet Archive, Sakugabooru e yt-dlp (exclui cosplay/fan art; `authentic_gameplay` sem mídia real bloqueia); (4) identidade só por comparação imagem↔imagem com referências autênticas e distratores (`identity-verification.ts`, comando `embed-images` no worker CLIP); (5) estados independentes técnica / fidelidade semântica / estética humana (`approval-states.ts`, IPC `creative:aesthetic-decision`, `creative:evaluate-technical`, `creative:approval-status`). Identidade real medida para Malenia (`scripts/cs9-identity-check.ts`, referências recortadas de VODs de gameplay arquivados, sem webcam): a thumbnail CS-9 "Malenia" tem similaridade 0,41 (mín. 0,80) → `not_confirmed`; porém o CLIP ViT-B/32 não separa Malenia do personagem do jogador (controles positivos com margem −0,007 e +0,004 → 2 FN), logo nenhuma identidade pode ser confirmada com este modelo/referências. **Bloqueios:** rótulos humanos por imagem; identidade confirmável exige referências oficiais em maior resolução e/ou modelo de embedding mais discriminativo; referências de Johnny Silverhand (0 candidatos autênticos) e Hornet (1 candidato incerto); PNGs CS-9 sem `.aethera-creative.json` (geometria não avaliável retroativamente); `CreativeStudioPanel` não montado nas rotas do renderer real; título `minimal_whisper` renderizado a 5,9px em 224×126.
- [ ] **Próxima prioridade operacional (Fluxo Interativo Electron):** CS-8 aprovada com ressalvas estéticas e refinamento multimodal concluído; próxima prioridade é validar o fluxo completo pela janela Electron (`npm run dev -w @neuralbridge/aethera-desktop`), do prompt à escolha, combinação, edição por camadas/prompt e exportação final.

## Aethera Cinema AI (`CINEMA-00` .. `CINEMA-10`) (2026-11-13)

- [x] **`@neuralbridge/cinema` (`packages/cinema/`):** Timeline IR racional (`OTIO Timeline.1`), sanitização anti-prompt-injection, direção cinematográfica com Plano A/B, direção de comédia (`cinematic_subtle_humor` 35% padrão + bloqueio sensível + 0% disable), edição determinística + undo/redo, VFX/tipografia HUD-safe, pipeline de cor Rec.709 e som EBU R128, QC multi-pass, reparo incremental (`budget <= 3`), Release Gates e benchmark corpus (12 cenários: 8 dev / 4 holdout).
- [x] **Integração Full-Stack (`apps/aethera-desktop`):** handlers IPC `cinema:{capabilities,produce,export-otio,repair,benchmark}` em `src/main/aethera-ipc.ts`, ponte `aetheraBridge` em `src/preload/index.ts` e UI `CinemaDirectorPanel` na rota `/aethera/cinema`.
- [x] **Documentação:** suíte completa em `docs/aethera/cinema/` (`MASTER-PLAN.md`, `BASELINE.md`, `CREATIVE-RUBRIC.md`, `TIMELINE-IR.md`, `CAPABILITY-MATRIX.md`, `BENCHMARK-CORPUS.md`, `QC-TAXONOMY.md`, `COMEDY-DIRECTION.md`, `COMEDY-BENCHMARK.md`, `PERFORMANCE.md`, `RELEASE-GATES.md`).
- [ ] **Pendência operacional externa:** validação em mídia real de produção externa e avaliação humana cega (testes atuais cobrem lógica determinística, sinais sintéticos e smoke E2E).

## SEP-2026-01 — SEP-06 (Pareamento Opcional), SEP-07.5 (Limpeza/Fronteiras) & SEP-08 (Migração, Rollback e E2E) (2026-11-13)

- [x] **SEP-06 — Conexões Opcionais (`PeerPairingManager` + IPC nos 3 apps):** implementado em `packages/integration-contracts/src/pairing-manager.ts` e integrado via `registerPairingIpcHandlers(ipcMain, pairingManager)` nos processos principais de `orchestrator-desktop`, `aethera-desktop` e `void-desktop` (descoberta, pareamento explícito com escopos, revogação, reconexão com backoff e circuit breaker). Validado com servidor loopback real em `packages/integration-contracts/test/sep06-pairing.test.ts` (2/2).
- [x] **SEP-07.5 — Reorganização e Limpeza Segura:** auditoria de fronteiras confirmou `0` imports cruzados entre os 3 apps separados; monolito `apps/desktop` preservado intacto; relatório auditável salvo em `docs/migration/CLEANUP-REPORT.md`.
- [x] **SEP-08 — Migrador Idempotente, Rollback e Matriz RF-07:** implementado em `packages/integration-contracts/src/migration.ts` e `tooling/migrations/migrate-ecosystem.mjs` (`--dry-run`, `--apply`, `--rollback` com manifesto SHA-256 e bloqueio de cópia de credenciais em texto claro). Validado em `packages/integration-contracts/test/sep08-migration-e2e.test.ts` (2/2) e documentado em `docs/migration/MIGRATION-AND-ROLLBACK.md`.
- [ ] **Pendência externa de ambiente:** geração final dos instaladores NSIS (`npm run dist:win:{orchestrator,aethera,void}`) requer ambiente com rede/cache do Electron (`github.com`) para `electron-builder`, além de validação GUI/OAuth com credenciais reais do usuário.

## SEP-2026-01 — SEP-08 (Auditoria + IPC Real), Skills Audit & SEP-09 (Paridade Visual e Funcional) (2026-11-13)

- [x] **SEP-08 — Auditoria de Paridade e Integração Real:** transporte real via Windows Named Pipe / Unix Socket (`packages/integration-contracts/src/loopback-server.ts`), descoberta (`discovery.ts`), registro de paridade (`docs/architecture/SEP-08-FUNCTIONAL-PARITY.md`), e teste multiprocesso real em 3 processos (`sep08-multiprocess.test.ts` 1/1).
- [x] **Skills Audit & Biblioteca Compartilhada:** auditoria completa das skills globais/locais e registro compartilhado em `.agents/skills-registry.json` (`docs/architecture/SKILLS-AUDIT-REPORT.md`, `skills-library-discovery.test.ts` 1/1, 38 skills válidas, 0 duplicações).
- [x] **SEP-09 — Migração de Paridade Visual e Funcional:**
  - **Singularity Orchestrator (`apps/orchestrator-desktop`):** UI real (`Dashboard`, `Chat`, `Runs`, `Brain` + `Brain3D` + `Galaxy`, `WorkflowCanvas`, `GitIntelligence`, `AzureDevOps`, `Skills`, `Mcp`, `Monitoring`, `Analytics`, `MissionControl`, `Extensions`, `Settings`) + `src/main/orchestrator-ipc.ts` com handlers IPC reais e `userData` isolado.
  - **Aethera Studio (`apps/aethera-desktop`):** UI real (`AetheraHomePage`, `VelixPage`, `AetheraProductionWorkspace`, `ContentCalendarPage`, `ContentQueuePage`, `ContentLibraryPage`, `ContentChannelSetupPage`, `ContentPackagePage`, `ContentVariantsPage`) + `src/main/aethera-ipc.ts` (Remotion, narração, música ACE-Step, revisão por prompt, OAuth YouTube, publicação, calendário editorial, fallback RF-07).
  - **Void (`apps/void-desktop`):** UI real (`PersonalAgentPage`, `CompanionHud` via `?companion=hud`, `AgentsPage`, `ExtensionsPage`, `SettingsPage`) + `src/main/void-ipc.ts` (Google OAuth Gmail/Calendar, Spotify OAuth, voz/reuniões VoiceStudio/Whisper/SystemAudio, Companion HUD, notificações e automações).
  - Documentado em `docs/architecture/SEP-09-FUNCTIONAL-MIGRATION.md`. Monolito `apps/desktop` preservado intacto.

## SEP-2026-01 — SEP-03, SEP-04, SEP-05 e SEP-07 (Separação Incremental dos 3 Apps) (2026-11-13)

- [x] **SEP-03 — Singularity Orchestrator (`apps/orchestrator-desktop`):** app Electron independente (`appId: com.singularity.orchestrator`, `executableName: SingularityOrchestrator`, `userData: SingularityOrchestrator`, SQLite privado `orchestrator-core.db`, servidor loopback `/v1/{health,capabilities,tasks,events}` e fallback RF-07). Validado com `orchestrator-app.test.ts` (2/2), `typecheck`, `eslint` e `electron-vite build` (`out/`).
- [x] **SEP-04 — Aethera Studio (`apps/aethera-desktop`):** app Electron independente (`appId: com.singularity.aethera`, `executableName: AetheraStudio`, `userData: AetheraStudio`, SQLite privado `aethera-studio.db`, `AetheraAgentOrchestrator`, `AetheraChannelPlanner` e fallback RF-07). Validado com `aethera-app.test.ts` (2/2), `typecheck`, `eslint` e `electron-vite build` (`out/`).
- [x] **SEP-05 — Void (`apps/void-desktop`):** app Electron independente (`appId: com.singularity.void`, `executableName: Void`, `userData: Void`, SQLite privado `void-assistant.db`, `PersonalNotificationRepository`, degradação graciosa via `IntegrationClient(null)` sem Orchestrator/Aethera e fallback RF-07). Validado com `void-app.test.ts` (2/2), `typecheck`, `eslint` e `electron-vite build` (`out/`).
- [x] **SEP-07 — Identidades, scripts raiz e empacotamento (`electron-builder.yml`):** identidades, executáveis, `artifactName` e diretórios de saída distintos (`dist/orchestrator`, `dist/aethera`, `dist/void`), preservando `apps/desktop` (`com.neuralbridge.desktop`, `dist/`) operacional. Scripts `build:{orchestrator,aethera,void,all-apps}` e `dist:win:{orchestrator,aethera,void}` adicionados ao `package.json` raiz; `npm run typecheck` global atualizado.
- [ ] **Pendências SEP-2026-01:** execução local dos instaladores NSIS (`npm run dist:win:{orchestrator,aethera,void}`) fora do sandbox sem rede (para download/cache de binários NSIS pelo `electron-builder`), **SEP-06** (UI de pareamento loopback ativo entre processos) e **SEP-08** (migração assistida de dados do monolito e testes E2E).

## SEP-2026-01 — SEP-01 & SEP-02 Contratos e Limites + AETHERA-AUTO-01 + AETHERA-CHANNEL-01 (2026-11-13)

- [x] **SEP-01 — Auditoria e baseline:** inventário completo de apps, pacotes, features UI e repositórios SQLite registrado em `docs/architecture/SEP-2026-01-BASELINE.md`; nenhuma exclusão destrutiva realizada.
- [x] **SEP-02 — Contratos versionados (`@neuralbridge/integration-contracts`):** pacote puro em `packages/integration-contracts/src/index.ts` com identidades (`orchestrator`, `aethera`, `void`), matriz de propriedade de dados (`DATA_OWNERSHIP_BOUNDARIES` com bancos SQLite e credenciais isolados), endpoints loopback `/v1/{health,capabilities,tasks,events}`, compatibilidade `N/N-1` (`isCompatibleSchemaVersion`), pareamento com escopos e revogação (`IntegrationAuthRegistry`), degradação graciosa para modo isolado (`IntegrationClient`) e contrato `IAgentProviderContract` preservando o fallback multiagente RF-07. Documentado em `docs/architecture/ADR-SEP-02-CONTRACTS.md`.
- [x] **AETHERA-AUTO-01 (RF-01..RF-07):** `AetheraAgentOrchestrator` com transferência automática entre provedores sem perda de artefatos, pausa/retomada por checkpoint (`paused_no_provider`), `AetheraSharedToolkit`, canais `video:aethera-auto:{produce,providers}`, botão **Aprovar e Exportar**, histórico de versões e chips de edição por comando.
- [x] **AETHERA-CHANNEL-01 (RF-08..RF-15, base):** `channel-planner.ts` (metadados, ajuste por prompt, calendário editorial com conflitos e planejamento em lote) e `AetheraChannelCalendar.tsx` (visões mensal/semanal/lista, arrastar e soltar, piloto automático).
- [x] **Validação:** `contracts.test.ts` (6/6), `aethera-auto-orchestrator.test.ts` (6/6), `aethera-channel-planner.test.ts` (3/3) — 15/15 passando; ESLint 0 erros nos arquivos alterados; `npm run typecheck` e `npm run build` passando.
- [ ] **Pendências SEP-2026-01:** `SEP-03` (extração do Singularity Orchestrator), `SEP-04` (extração do Aethera Studio), `SEP-05` (extração do Void), `SEP-06` (pareamento loopback ativo entre processos), `SEP-07` (3 instaladores independentes) e `SEP-08` (migração e E2E).

## Aethera Smart Director — SD-2.2, SD-2.3, SD-2.4, SD-3, SD-4 e Autonomia de Mídia (2026-11-13), G3 pendente

- [x] **Decisão D-AP-18 — Autonomia total de mídia (sem limitação):** agentes decidem, selecionam, adquirem e geram mídia autonomamente sem bloqueio por consentimento humano (`selectAutonomousMediaCandidates` em `packages/orchestrator/src/aethera/media-hunter.ts` e `resolveMediaGapsAutonomously` em `packages/orchestrator/src/aethera/autonomous-media.ts`), mantendo o registro de proveniência (`origin`, `license`, `sha256`, `autonomous: true`).
- [x] **SD-2.2 — Integração Contextual de SFX:** consolidado de `practical-almeida-3d5074` (`packages/shared/src/aethera-sfx-classifier.ts`, `scripts/render-plan-sd22.mts`, 18/18 testes passando e ESLint limpo).
- [x] **SD-2.3 — Música e mixagem cinematográfica:** `buildContextualMusicPrompt`, `selectContextualMusicTrack` e `computeAdaptiveDucking` em `packages/shared/src/aethera-music-director.ts` (ducking adaptativo por densidade de SFX + janela de palavras); masterização em `packages/workspace/src/aethera-audio-render.ts` (`aresample=48000`, `alimiter`, EBU R128 `loudnorm` `LRA=7`).
- [x] **SD-2.4 — VFX cinematográficos:** camada `VfxOverlay` em `apps/desktop/src/renderer/src/features/video/motion/AetheraTimelineComposition.tsx` (`particles`, `volumetric_light`, `optical_distortion`) e `color_grading` em `mediaFilter`. `AETHERA_COMPOSITION_VERSION` = 7.
- [x] **SD-3 — Transições e pontuação explicável:** `wipeTransitionClipPath` (`wipe`, `wipe-left`, `wipe-right`, `wipe-up`, `wipe-down`), `match_cut` na composição Remotion e `scoreShotExplainable` em `packages/shared/src/aethera-timeline-composition.ts`.
- [x] **SD-4 — Revisor pós-render com correção local:** `applyLocalCutCorrections` em `packages/orchestrator/src/aethera/post-render-review.ts` aplica patches apenas nos segmentos com `replace_footage` sem replanejar a produção.
- [ ] **Pendência humana:** Portão **G3** (revisão audiovisual humana dos renders completos).

## Aethera Smart Director — SD-2.1 Auditoria de Evidências (2026-11-14), G3 pendente

Auditoria técnica dos quatro renders SD-2.1 (jogos, buraco-como, farol, filas). **Parecer: SD-2.1 está pronto para revisão visual humana G3.** Não há bloqueios técnicos; as lacunas identificadas são de mídia (ausência de filmagem para temas abstratos), não de execução do Remotion.

### Evidências por render

| Render | Técnica planejada | Executada | Fallbacks | Lacunas de mídia | Transições degradadas |
|---|---|---|---|---|---|
| **jogos** | kinetic, panels, title, diagram | ✅ Todas executadas | 0 | 0 | 0 |
| **buraco-como** | kinetic, single_shot, continue_previous, diagram, typographic_card | ✅ Diagrama executado | 0 | 6 (segments 1,2,4,5,6,7) | 3 (dissolve→cut em 2,4,7) |
| **farol** | single_shot, typographic_card, diagram, kinetic_type | ✅ Diagrama executado | 0 | 7 (segments 1–7) | 3 (dissolve→cut em 3,4; match_cut→cut em 6) |
| **filas** | kinetic_type, typographic_card, diagram, continue_previous | ✅ Diagrama executado | 0 | 5 (segments 1,2,3,5,6) | 2 (dissolve→cut em 5; match_cut→cut em 6) |

### Reconciliação de lacunas (sem duplicidades)

- **Total de lacunas de mídia: 18** (6 + 7 + 5 + 0 jogos). Todas são "nenhuma filmagem limpa disponível" ou "sem filmagem aceita" — o diretor planejou corretamente, mas o banco de mídia não tem footage para temas abstratos (buraco negro, farol cósmico, teoria de filas). Isso é **comportamento esperado do SD-2.1**, não defeito.
- **Fallbacks de técnica: 0.** Os diagramas foram **efetivamente executados** pelo componente Remotion `DiagramLayer` em todos os segmentos onde foram planejados. A confusão anterior vinha de relatórios que classificavam "diagrama sem filmagem por baixo" como fallback de técnica, quando na verdade é lacuna de mídia com técnica executada sobre fundo degradê.
- **Transições degradadas: 8** (3 + 3 + 2). Dissolve/match_cut planejado → cut executado porque não há filmagem de destino para fazer a transição. Comportamento correto do executor.

### Arquivos de evidência preservados

- Timelines JSON: `timeline-sd21.json`, `timeline-buraco-como-sd21.json`, `timeline-farol-sd21.json`, `timeline-filas-sd21.json`
- Execuções JSON: `execucao-sd21.json`, `execucao-buraco-como.json`, `execucao-farol.json`, `execucao-filas.json`
- Quadros extraídos: `renders/smart-director/frames-auditoria/` (jogos-painel-5s.png, buraco-diagrama-11s.png, farol-diagrama-11s.png, filas-diagrama1-5s.png, filas-diagrama2-21s.png)

### Critérios SD-2.1 atendidos vs. etapas futuras

| Critério | Status SD-2.1 | Etapa futura |
|---|---|---|
| Tipografia cinética executada | ✅ | — |
| Cartões tipográficos sobre filmagem | ✅ | — |
| Painéis multi-assunto (panels) | ✅ | — |
| Diagramas executados pelo Remotion | ✅ | — |
| Texto ciente da imagem (safe zone) | ✅ | — |
| Dissolve motivado | ✅ (quando há mídia) | Match cut real (SD-3) |
| Wipe transition | ❌ | SD-3 |
| Pontuação explicável de tomada | ❌ | SD-3 |
| Revisor pós-render automático | ❌ | SD-4 |
| Mídia para temas abstratos | ❌ | Aquisição/geração (consentimento) |

### Conclusão para G3

Os quatro renders representam fielmente o que o SD-2.1 foi projetado para entregar. As lacunas são de **conteúdo** (falta de footage), não de **capacidade técnica**. O G3 pode prosseguir com revisão visual humana dos vídeos e quadros apresentados.

---

## Aethera Smart Director — SD-2 (2026-11-13), sem commit, G3 pendente

Objetivo: reduzir a distância entre o que o diretor planeja e o que o renderizador executa. Desenho e lições em
`docs/aethera/smart-director.md` (Estado do SD-2).

- [x] **Técnicas que saíram do fallback:** picture-in-picture (painéis `pip`), tipografia cinética (`kinetic`), revelação
  progressiva de linhas no cartão, dissolve motivado. `AETHERA_COMPOSITION_VERSION` = 4.
- [x] **Texto ciente da imagem:** grade 6×6 de bordas e de bordas persistentes (HUD/logo) por candidato; cartão e
  cinética no terço mais calmo, medidos na coluna do alinhamento. Cartões saíram do HUD de Silksong; o "SOZINHO" cinético
  saiu de cima da personagem (folha `renders/smart-director/kinetic-sd2.png`).
- [x] **Plano no fluxo do app:** migração `0120_aethera_editorial_plans`, `AetheraEditorialPlanRepository`,
  `createEditorialPlanService`, IPC `video:aethera-editorial-plan:{get,history,direct,approve,apply}` e painel "Plano
  editorial" no editor. Aprovação só por pessoa nomeada e ligada ao hash; aplicar gera nova versão da timeline.
  **Não verificado no app em execução** (coberto por testes de repositório, serviço e typecheck).
- [x] **Revisão pós-render v1** (`post-render-review.ts`, `renders/smart-director/review-render.mts`, `review-loop.mts`).
- [x] **Validação sem jogos** (`validacao-nao-jogos.json`): 5 roteiros, 33 decisões. Cinética, cartões, painéis e PiP
  executam como decidido; diagrama (7) e mapa/linha do tempo (2) = 27% das decisões continuam em fallback; as 9 tomadas
  únicas viram lacuna declarada porque esses temas não têm mídia (baixar exige consentimento).
- [x] **SD-1 → SD-2 na amostra de jogos** (mesmo plano v3, mesma narração): fallbacks 3 → 1 (só o diagrama); gráficos
  `panels 3 + title 4` → `panels 3 + title 4 + kinetic 2`; cortes 11 → 15; um dissolve real; nenhuma lacuna.
  **Revisão automática com os mesmos critérios** (`revisao-amostra-*.json`):

  | Amostra | pass | aviso | falha | texto da mídia na tela | imagem × fala rejeitada |
  |---|---|---|---|---|---|
  | SD-1 (`amostra-sd1-anterior.mp4`) | 31 | 7 | 8 | 4 (WET DREAM, MILITECH, cartela Elden Ring, ROASTED NOODLES) | 4 |
  | SD-2 r1 (`amostra-sd2-r1.mp4`) | 35 | 6 | 5 | 1 (cartela final Elden Ring) | 4 |
  | SD-2 r2 (`amostra-sd2-r2.mp4`, correção objetiva) | 36 | 5 | 5 | 0 | 5 |

  A técnica medida (duração, −17 LUFS, pico −1,7 dBTP, sem silêncio longo, 20 legendas sincronizadas) passou nas três.
  O ciclo escolheu r2. Custo real da correção: o cartão de 74bd:3 perdeu a filmagem limpa e ficou sobre degradê (lacuna
  declarada). As rejeições imagem × fala são de frases abstratas ("A pergunta é simples.") e variam entre execuções
  (3 de 15 vereditos mudaram sobre o mesmo vídeo); vão para revisão humana.
- [x] **Verificação:** `npx vitest run --no-file-parallelism` → 343 arquivos / 2552 testes; as 3 falhas restantes eram
  a lista de tabelas esperadas sem `aethera_editorial_plans`, corrigida e reexecutada (19/19). `npm run typecheck` sem
  erros. ESLint limpo nos arquivos do SD-2; os erros que restam no repositório (ex.: `AetheraEditorMode.tsx` setState em
  efeito, `content-operating-system.ts`, scripts antigos de `renders/aethera-e2|e3`) são anteriores.
- [ ] **Pendências reais:** diagrama/gráfico/mapa executáveis (maior lacuna em temas não-jogo); correção local de um
  corte sem replanejar a produção; *match cut* e *wipe*; o G3 continua humano e exige assistir ao vídeo inteiro.

## Aethera Smart Director — SD-1 (2026-11-13), sem commit

Auditoria, arquitetura e plano incremental em `docs/aethera/smart-director.md`. Diretor por intenção, sem preset por
categoria. O diretor antigo por presets (`aethera-director.ts`) só era chamado por testes e fica como legado.

- [x] **Contratos e planejador** (`shared/src/aethera-smart-director.ts`): leitura do roteiro, conceito de direção e uma
  decisão justificada por trecho (intenção, efeito, emoção, intensidade, composição, transição motivada, representação
  registro/ilustração/reconstrução, confiança, alertas). Catálogo de técnicas descritivo (o que comunica e quanto custa,
  nunca quando usar). Validador (trecho sem decisão, âncora fora da fala, painéis fora da ordem da fala, imagem de um
  assunto sobre a frase de outro). Versão com hash canônico; versão aprovada nunca muda (nova direção vira rascunho).
  `directionProfile`/`directionDistance` para revisão.
- [x] **Diretor de IA** (`orchestrator/src/aethera/smart-director.ts`): Claude pelo TaskEngine, roteiro inteiro com palavras
  numeradas, material declarado como é, nova tentativa com os problemas e nenhum plano inventado se o modelo falhar.
  **Correção v1→v2:** mostrar ao diretor o que o executor já fazia o levou a escolher por executabilidade, e os três roteiros
  de buraco negro viraram o mesmo vídeo tipográfico (distância de direção 0,035–0,15). Na v2 a executabilidade sai do
  prompt e fica com o planejador (fallback + lacuna registrada): distância de 0,232 a 0,571.
- [x] **Execução** (`applyEditorialPlan`): tomada única com o assunto e a descrição do diretor; continuar a imagem
  anterior; cartão do diretor sempre **sobre** filmagem limpa, sem texto próprio (nunca sobre fundo chapado); o cartão
  termina com a própria frase; multi-painel com a filmagem de cada assunto, revelado na pronúncia de cada nome. Painéis
  e frases que nomeiam um assunto têm prioridade sobre o material dele. Fallback que preserva a intenção sem repetir a
  legenda (tipografia cinética, diagrama, gráfico e mapa não executáveis mantêm a imagem e registram a lacuna).
- [x] **Composição `panels` no Remotion:** painéis independentes com máscara poligonal (diagonal, colunas, linhas, grade),
  revelação por *wipe* na palavra, assentamento suave, divisórias que se desenham, texto centrado na faixa visível do
  painel (`panelSpanAt`). A mídia dos painéis é servida e confinada como a de qualquer camada. A chave de cache dos
  segmentos passa a incluir `AETHERA_COMPOSITION_VERSION` (correção visual não reaproveita quadro antigo).
- [x] **Diretor real em 6 roteiros** (`renders/smart-director/planos-v1`, `-v2`, `-v3`): jogos; buraco negro "cair"
  (mundo ilustrativo, aproximação, tensão), "como funciona" (diagrama contínuo, *match cut*, PiP de escala),
  "descobertas" (linha do tempo, diagrama da rede de telescópios, sem foto falsa); farol (mistério → diagrama → emoção);
  filas, tema sem preset (diagramas com *match cut*). Planos v2 gravados como fixtures e verificados em
  `aethera-smart-director-decisions.test.ts`.
- [x] **Cyberpunk:** aquisição aprovada pelo usuário em 2026-11-13. "Cyberpunk 2077 — Official Gameplay Trailer"
  (canal oficial verificado, `media/aethera/cyberpunk-2077/trailer-bo8lx3hdu30.mp4`, 106,8 MB), baixado pela função de
  aquisição do Studio. Fonte avaliada como consistente (33 trechos analisados). A demonstração RTX e o gameplay com
  webcam continuam recusados. O arquivo ainda não está registrado no banco do app; entra no planejamento como asset
  extra do script.
- [x] **Amostra real** `renders/smart-director/amostra-sd1.mp4` (plano v3, narração D, Remotion do app): nenhuma lacuna,
  nenhuma tela de fundo chapado, cada jogo só quando é dele que se fala. A variante de capacidade com painéis diagonais
  fica em `variante-diagonal.mp4`. Folhas de contato: `contato-sd1.png`, `painéis-sd1.png`, `diagonal-sd1.png`.
- [x] Skill MotionVelix: nova `references/14-direcao-editorial.md` e seção 1.6 no `SKILL.md` (backup em
  `docs/backup-v2.8.0/`). O título "v2.8.0" foi mantido porque a tela de boas-vindas o verifica.
- [x] **Verificação:** `npx vitest run packages/shared packages/orchestrator packages/workspace apps/desktop/test
  --no-file-parallelism` → 298 arquivos / 2253 testes aprovados; `npm run typecheck` sem erros; ESLint dos arquivos do
  SD-1 limpo.
- [ ] **Pendências reais:** técnicas ainda não executáveis (PiP, tipografia cinética, diagrama, gráfico, mapa, imagem
  ilustrativa gerada) são planejadas e registradas, mas executadas como fallback, o que define o SD-2. A seleção de
  tomada usa ainda `natureHints` + descrição do diretor (SD-3: pontuação explicável). Não há revisor pós-render
  automático (SD-4): a revisão desta etapa foi feita por inspeção humana de quadros. O plano não é persistido no banco
  nem ligado a um estágio do app. Os roteiros sem mídia não foram renderizados. O G3 continua humano.

## Aethera Studio — AP-04 etapa 2 (gate editorial E1 integrado, 2026-11-12)

- [x] **E1 · Gate editorial no fluxo de render:** `recordEditorialPreCheck` gera o relatório editorial automático após os gates técnicos G1/G2, persistindo-o como artefato markdown (`producoes/{runId}/editorial/relatorio-v{version}.md`) antes da aprovação humana G3. O gate nunca aprova sozinho: produz `ready_for_human` quando todos os checks passam e mantém `pending` quando o storyboard não tem palavras medidas ou os gates estão desabilitados. Integração em `packages/orchestrator/src/velix-render-stage.ts`, typecheck e testes do render stage passando (4/4).
- [x] **E2 · Narração natural — respiro entre frases, validado no áudio real (2026-11-12).** Com um estilo de cadência,
  cada cena continua sendo **uma** requisição de TTS e só as pausas crescem: `planSentencePauses`
  (`shared/src/aethera-voice.ts`) acha os fins de frase nos silêncios do próprio bloco (cada pontuação interna, inclusive
  `:` e `,`, fica com o seu silêncio, em ordem) e `insertSilences` (`workspace/src/velix-audio.ts`) alarga cada um até
  `sentencePauseMs` (documentário 280 ms) preenchendo com o ruído de fundo do próprio bloco (nunca silêncio digital); o
  áudio falado não é cortado nem refeito. Arquivo derivado nomeado pelo próprio plano (`bloco-<chave>-respiro-<plano>.wav`).
  Pausas de cena/seção (600/900 ms) como antes. Manifesto: `sentencePauses { boundaries, matched, widened, durationMs }`.
  Sync grava os avisos `narration-sentence-pauses` (≥ 250 ms) e `narration-scene-pauses` (≥ 600 ms) medidos nas palavras.
  **Abordagem anterior descartada pela medição:** uma requisição por frase quebrava a entonação e o volume (saltos de
  2–9,6 semitons e 6,9 dB entre frases).
  - **Validação real (VoiceStudio 0.5.7 local, OmniVoice, Voz C `aethera-voz-dinamica`, velocidade 1,0, cenas 1–5 do
    storyboard v19 do run `7013e4fb`):** áudios em `renders/aethera-e2/` (A = bloco por cena sem respiro, B = frase por
    frase descartada, **C = entregue**). C: 44,5 s, −17,0 LUFS, LRA 2,6, pico −1,7 dBFS, variação entre blocos 1,5 dB
    (A 2,8; B 6,9); 11/11 fins de frase com ≥ 445 ms de pausa medida pela transcrição local (A: 5 de 9 abaixo de 250 ms);
    pausas de cena ≥ 929 ms; pausas inseridas no mesmo nível do silêncio natural (diferença ≤ 1,4 dB); falado + inserido =
    duração final exata. Relatórios: `medidas.txt`, `pausas-transcritas.txt`, `relatorio.json`.
  - **Achado:** a 1,0 a cena 3 fala a 206 ppm (as demais 163–169); o gate E1 bloqueia acima de 185. A faixa 145–170 pede
    ~0,85 nessa cena (override por produção), como já indicava a medição anterior. Não ajustado: velocidade é decisão de
    produção, e a amostra foi pedida a 1,0.
  - **Achado:** o OmniVoice não repete a mesma voz entre gerações com o mesmo seed (F0 mediano por cena variou 172–200 Hz
    entre A e C). Blocos reaproveitados pelo cache não mudam; regenerar uma cena pode mudar sua cor.
- [x] **E3 · Legendas confortáveis (2026-11-12).** `captionCues` (`shared/src/aethera-editorial.ts`) a partir dos tempos
  medidos: até 2 linhas de `captionLineCharsFor(formato)` (42 em 16:9) sem cortar palavra; quebra em fim de frase, pausa
  ≥ 300 ms e, numa frase longa, depois da vírgula; nenhuma linha/legenda terminando em palavra funcional; ≥ 1,2 s quando a
  próxima permite; fica na pausa seguinte até ler a ≤ 17 caracteres/s sem invadir a próxima (80 ms entre legendas);
  trecho curto sem fim de frase se junta ao seguinte ("Primeiro eixo: o mundo."); duas frases só se juntam quando a
  primeira seria um lampejo < 0,8 s, uma por linha. Nada entre legendas — nunca o parágrafo. `sceneCaptionCues`,
  `timelineCaptionCues` e `captionCuesSrt`: a composição Remotion (`CaptionLayer`: texto claro, sombra suave, sem caixa,
  tamanho fixo por formato, `captionPlacement: 'top'` já suportado no contrato) e o SRT exportado usam as **mesmas**
  legendas; no render pela timeline o FFmpeg não queima uma segunda cópia (sem palavras medidas, cai nas frases do sync
  como antes). O pré-check E1 usa as mesmas legendas por cena.
  - **Corrigido no sync (afetava a sincronia das legendas):** número de uma palavra só ("3" → "três") voltava a ser
    dígito e o alinhador pulava para a segunda ocorrência de "Três"; palavras não reconhecidas agora dividem o tempo entre
    as vizinhas (`sceneWords`) em vez de colapsar e criar pausas falsas.
  - **Amostra real:** `renders/aethera-e3/amostra-e3-voz-c-legendas.mp4` (44,5 s, composição Remotion do app sobre cortes
    dos trailers adquiridos, narração C), `legendas-e3.srt`, `verificacao-legendas.json`, quadros `quadro-*.png`. 16
    legendas: todas as palavras, sincronizadas com a 1ª palavra falada, 0 acima de 2 linhas/42 caracteres, 0 terminando em
    palavra funcional, 0 sobreposições, 0 acima de 6 s; 1 com 1,03 s ("Três jogos.", 10,7 c/s, a próxima frase começa
    logo); **4 acima de 17 c/s** (17,6–21,2) — limite da fala a 1,0, não da legenda: o gate E1 as bloqueia.
  - Bundle Remotion: `scripts/build-motion-bundle.mjs` ganhou `extensionAlias` (`.js` → `.ts`) para resolver os módulos
    compartilhados importados pela composição.
  - Evidência de testes: `npx vitest run packages/shared packages/orchestrator packages/workspace apps/desktop/test
    --no-file-parallelism` → 294 arquivos / 2216 testes aprovados (inclui narração e render com FFmpeg real); `npm run
    typecheck` sem erros; ESLint dos arquivos alterados limpo. Lint: corrigidos de passagem 2 `!` em `apps/desktop/src/main/index.ts`
    (revisão AP-10), um import não usado em `aethera-timeline-assistant.ts` e uma variável não usada em
    `velix-render-stage.test.ts`.
- [ ] **Validação editorial humana (G3):** o relatório E1 agora é gerado automaticamente, mas a aprovação editorial continua pendente de revisão humana sobre uma amostra real com mídia, narração e legendas. Decisões abertas D-E1…D-E4 (§16.3) permanecem sem resolução técnica.
- [x] **Decisões D-E1 a D-E4 registradas (2026-11-12):** D-E1 (trailer Cyberpunk) autorizada como mídia permitida — aquisição externa pendente de execução manual; D-E2 (velocidade 1.0) mantida no preset da Voz C, aplicável via VoiceStudio; D-E3 (afirmação FTC) removida do roteiro — instrução de prompt para produções futuras, não edição de código; D-E4 (tema grafite/tecnológico) já configurado como `productionThemeId: graphite` no gate editorial E1.

## Fase 51 — Void Personal Agent (execução autorizada, 2026-11-10)

- [x] **51.01 — contratos:** schemas Zod para intents read-only, ações mutáveis com confirmação obrigatória, estados de
  conectores e escopos mínimos; extensão built-in `personal-agent` registrada e compatível com o ciclo de extensões.
- [x] **51.02 — núcleo de infraestrutura:** migração aditiva `0097_personal_agent` com contas, cursores, deduplicação,
  automações, execuções e notificações; `IntegrationTokenStore` cifra por conta e não persiste quando `safeStorage` está
  indisponível. O estado da extensão permanece desligado por padrão.
- [x] **51.03/51.04:** adapters HTTP injetáveis para busca/leitura de metadados Gmail, envio explícito,
  listagem/criação/cancelamento de eventos da Agenda, sem persistir corpo de mensagem; OAuth PKCE, sincronização,
  ações confirmadas no broker e UI integrados. OAuth real continua pendência operacional externa.
- [x] **51.06/51.08 — núcleo:** scheduler determinístico por intervalo, deduplicação de eventos, central de notificações com
  prioridade, agrupamento, leitura e silêncio; exportados pelo orquestrador.
- [x] **51.07 — segurança do planner:** intents pessoais read-only viram planos tipados; conteúdo externo é delimitado como
  dado não confiável e não pode introduzir `mail.send` ou outra ferramenta mutável.
- [x] **Aprovação de ações:** `PersonalActionService` converte envio de e-mail e criação de evento em requests
  `confirm` do `ComputerActionBroker`, com prévia, expiração e fingerprint determinístico; nenhum adapter mutável é chamado
  diretamente pelo planner.
- [x] **Retomada pós-aprovação:** decisões do broker agora reconciliam o `personal_automation_run` que aguardava a ação,
  marcando-o como concluído ou falho/negado sem perder o vínculo persistido pelo `actionId`.
- [x] **Sincronização incremental — núcleo:** Gmail expõe `historyId`, Agenda expõe `nextSyncToken`, e
  `PersonalSyncRepository` persiste cursores e deduplica eventos por conta/recurso.
- [x] **Monitor de sincronização:** `PersonalSyncService` consome cursores por conta, emite notificações somente com
  metadados, deduplica eventos externos e roda no boot e a cada minuto enquanto o desktop está aberto; falhas isolam a
  conta e não derrubam o processo.
- [x] **Runtime de automações — núcleo:** `PersonalAutomationRuntime` recarrega regras persistidas a cada tick, grava
  estados de execução, avança `nextRunAt`, ignora `idempotencyKey` já concluídas e preserva `awaiting_approval` para ações
  mutáveis até a decisão humana.
- [x] **Ciclo de vida do scheduler:** `PersonalAutomationLoop` executa uma recuperação imediata no boot, agenda ticks
  serializados e cancela o timer no shutdown; o desktop agora carrega o repositório 0097 no boot, encaminha ações mutáveis
  ao broker e mantém o timer fora do processo após `will-quit`.
- [x] **Persistência do runtime:** `PersonalAutomationRepository` implementa a porta do runtime sobre
  `personal_automations` e `personal_automation_runs`, incluindo atualização de cursor, ação tipada e deduplicação
  transacional.
- [x] **Notificações persistentes:** `PersonalNotificationRepository` grava somente metadados, aplica deduplicação por
  `dedupeKey`, lista pendências e marca leitura; os canais IPC tipados já estão disponíveis para a central do renderer.
- [x] **51.05 — WhatsApp:** viabilidade encerrada em `docs/plans/phase-51-whatsapp-feasibility.md`; WhatsApp pessoal não é
  implementado. O canal aprovado é Companion Mobile/push ou e-mail, condicionado às credenciais e APIs oficiais.
- [x] **IPC/capabilities:** os canais `personal:*` estão classificados na capacidade `personal` e expostos somente pelo
  namespace `window.neuralbridge.personal`; testes de inventário e preload passam.
- [x] **Central visual inicial:** a tela `PersonalAgentPage` lista contas e notificações persistidas, oferece estados de
  carregamento/erro/vazio, marca notificações como lidas e mantém foco/nomes acessíveis nos controles.
- [x] **E2E da extensão:** `tests/e2e/personal-agent.spec.ts` valida instalação nova com extensão desligada, habilitação
  explícita, rota dedicada, estados vazios, contrato IPC de notificações e bloqueio de escrita até decisão humana (2/2).
- [x] **Estabilização direcionada:** 18 arquivos Vitest, 34/34 testes, E2E pessoal 1/1, typecheck global, build Electron
  e `git diff --check` aprovados nesta rodada.
- [x] **Lint:** ESLint global passou após corrigir imports de tipo, exclusão segura de tokens e fixtures sem `any` não
  justificado.
- [x] **Regressão global:** após adicionar setup Vitest não interativo para fixtures Git e registrar a saída de
  notificações como metadado app-owned, `npx vitest run --no-file-parallelism` passou 281/281 arquivos e 2172/2172 testes.
- [x] **Fase 51 encerrada:** todos os gates locais automatizáveis aprovados; OAuth Google real permanece explicitamente
  pendente por depender de credenciais/configuração externa autorizada.
- [x] **Ações pessoais no IPC:** envio de e-mail e criação de evento entram no `PersonalActionService` pelo main process e
  retornam somente o status da aprovação; `PersonalActionExecutor` recupera o token do cofre e chama o adapter somente
  depois de `allow`. A decisão (`allow/deny/cancel`) também tem canal IPC tipado.
- [x] **Contas e interface inicial:** `PersonalAccountManager` separa metadados sanitizados do cofre cifrado; a rota
  `#/personal-agent` fica oculta enquanto a extensão está desligada e mostra integração/privacidade quando habilitada.
  IPC sanitizado de listagem/desconexão está ligado ao main/preload; o botão agora importa o `client_secret.json`, abre o
  fluxo PKCE loopback, cifra o token, resolve o perfil Gmail e registra metadados em `personal_accounts` no SQLite. O
  corpo das mensagens continua fora da persistência.
- [x] Testes focados desta etapa: contratos, cofre, migração completa, adapters Gmail/Agenda, scheduler, notificações e
  injeção, operações dos adapters, política OAuth, contas, IPC, sincronização, runtime, aprovações e rota; 33 testes focados
  passaram nesta verificação. Typechecks desktop
  (Node/web) e
  orquestrador passaram.
- [ ] **Regressão global:** `npm run typecheck` e `npm run build` passaram. A suíte global continua não concluindo de
  forma confiável: há falhas fora da Fase 51 em `project-hierarchy`, `projects` e `git-history`, e até
  `--no-file-parallelism` permanece preso em fixtures Git/cherry-pick. A verificação focada da Fase 51 passou: 31 testes
  e todos os typechecks dos pacotes afetados.

## Fechamento da lista pendente da Fase 50 — M1, M2, Core e evidências (2026-11-10)

- [x] **M2 endurecido:** um banco SQLite aberto por outro processo na árvore legada (servidor MCP, Core standalone de
  versão anterior) agora **adia** a cópia, em vez de copiar e deixar esse processo gravando na pasta antiga; a detecção
  é uma sonda de rename no `-shm` (Windows nega enquanto o banco está aberto) e ignora sobras de fechamento limpo, que o
  SQLite e o Chromium deixam. Um processo que perde a corrida adota a cópia do vencedor; disco cheio remove o staging.
  Unidade 6/6 (com conexão SQLite real), E2E Electron 1/1, `safeStorage` real 1/1, empacotado 1/1.
- [x] **M1 — instalador "Singularity", mesma identidade:** `productName: Singularity`, `executableName: NeuralBridge`
  (a tarefa de logon do Core, atalhos e regras continuam apontando para `NeuralBridge.exe`), `appId` preservado, versão
  `0.1.59`, `dist/Singularity-Setup-0.1.59-x64.exe` (`verify-distribution` aprovado). Upgrade real nesta máquina a partir
  da instalação `NeuralBridge 0.1.58`: uma única entrada ("Singularity 0.1.59", mesma chave GUID), mesma pasta, atalhos
  "NeuralBridge" trocados por "Singularity"; rollback reinstalando 0.1.58 voltou ao estado inicial. O app não foi aberto
  e os dados não foram tocados. O executável empacotado com o nome novo migra os dados antes de usar `userData` (não
  abre numa pasta vazia).
- [x] **Inventário dinâmico (Task 1) e defeito encontrado:** `core-dynamic-inventory.spec.ts` dispara uma entrada real de
  cada grupo numa instalação de teste com o Core ativo. Achado: missões (e passos de workflow) **recuperados no boot**
  iam para o Desktop, porque a recuperação rodava antes de o Core conectar e o adaptador híbrido caía no fallback.
  Correção: `waitForCore` (espera o Core até o próprio timeout de prontidão; Core desligado/falho libera na hora) antes
  de `workflows.recover()` e `missionMode.recoverAll()`. Agora chat, Void, Workflow e Missão executam no processo do Core.
- [x] **CORE-13 Velix com evidência E2E:** estágio do caminho direto executa no Core com `velix/stage/<id>/attempt/<n>`,
  dois resumes simultâneos criam uma única tarefa, cancelamento passa pelo Core e `NB_CORE_TASKS=main` mantém o estágio
  no Desktop com a mesma referência (2/2).
- [x] **M4 rejeitada:** trocar o `appId` não traz ganho ao usuário e exigiria migrar atalhos, notificações, associação
  de arquivos e desinstalar a identidade antiga; M1 já entrega o nome visível. Reabrir só com motivo de loja/assinatura.
- [x] Testes empacotados do Companion/Singularity atualizados para a regra do COMP-01 (Companion desligado em instalação
  nova): representam uma instalação existente, como o helper `app.ts`.
- [ ] **Dependem do ambiente, não de código:** smoke Android (não há SDK/`adb`/emulador nesta máquina; cliente coberto por
  typecheck e 12 testes) e ativação do Paperclip 50.10 (precisa de um servidor Paperclip em execução e de credenciais
  para o principal `orchestrator`; o adaptador está pronto e opt-in).
- [ ] **Achados do ambiente, não alterados:** a tarefa de logon "Singularity Core" aponta para
  `%LOCALAPPDATA%\Programs\NeuralBridge\NeuralBridge.exe`, que não existe (resto do teste do CORE-08); e a instalação
  registrada (atalhos "NeuralBridge") fica numa pasta temporária `Temp\nb-installer-probe-*` de um teste antigo.

## Continuação autorizada — Paperclip, Mobile, Core e Void (2026-11-10)

- [x] 50.10: adaptador Paperclip isolado em `70d1593`; o Core continua como único executor e a ativação definitiva permanece separada do control plane.
- [x] MOB-01: scaffold Expo Android-first, DPoP P-256, SecureStore, cliente Core e rollback em `8c6fdbf`; a tela mobile agora pareia por código, cria tarefas read-only e exibe apenas dados reais do Core.
- [x] MOB-02: sessão com rotação, comandos de aprovação/continuação, busca RAG e push metadata-only em `77a1873`; a UI expõe aprovação, cancelamento, continuação e SSE de tarefas com retomada por `Last-Event-ID`, mantendo refresh periódico como fallback.
- [x] MOB-03: política offline sem fila, retry limitado e distribuição/rollback interno documentados em `17818af`.
- [x] CORE-09: Missões autônomas passaram pela ponte Core com `externalRef` e rollback `NB_CORE_TASKS=main` em `ea11aa5`.
- [x] CORE-12 parcial: a ação confirmada `project.edit_task` do Void usa o adaptador híbrido com `externalRef` estável `void/action/<actionId>`; capacidades locais permanecem no Desktop.
- [x] Velix parcial: o caminho direto de tarefas usa o adaptador híbrido e referências `velix/stage/<id>/attempt/<n>`; adapters estruturados, mídia e aprovações continuam no Desktop; 16/16 testes focados.
- [x] Wake word: `Void` primária e `Neura` alias configurável em `0c93d3e`; nenhum identificador interno foi renomeado.
- [x] M2 — cópia reversível local de `%APPDATA%\\NeuralBridge` para `%APPDATA%\\Singularity`, com hashes, staging, marcador e rollback para a origem; Electron, executável empacotado, `safeStorage` real e fallback de destino indisponível validados.
- [x] Verificação: typecheck global, lint global e suíte unitária completa (260 arquivos, 2.121 testes) passaram; E2E de extensões 6/6.
- [x] Limites desta etapa resolvidos no fechamento acima (M1 e upgrade testados com o instalador 0.1.58; M4 rejeitada); smoke Android continua dependente do ambiente.

## Fase 50 — Singularity, COMP-01 Companion como extensão independente (2026-11-10) — IMPLEMENTAÇÃO VALIDADA (`ea8e40e`)

- [x] Registro built-in idempotente para `companion` e `spotify`, persistido na tabela de extensões existente.
- [x] Instalação nova: Companion desabilitado; instalação existente: estado atual preservado; Spotify continua independente.
- [x] Gate do Companion destrói/recria o HUD sem reiniciar e o gate do Spotify cancela conexão/polling sem apagar tokens ou configuração.
- [x] Callback IPC de habilitar/desabilitar aplica as transições ao processo principal; Void, TaskEngine, Core, wake word e credenciais não foram alterados.
- [x] Testes focados: 60/60; E2E de extensões: 6/6 e E2E Companion + extensões anterior: 17/17; build, lint e typecheck completo passaram.
- [x] IPC do Companion agora falha fechado quando a extensão está desabilitada; unsubscribe continua disponível apenas para limpar inscrições existentes.
- [x] Regressão completa: 2103/2104; uma falha isolada em `velix-research-stage.test.ts` passou ao ser repetida sozinha e não toca os arquivos do COMP-01.
- [x] Rollback documentado: desabilitar remove o HUD e cancela polling; reabilitar restaura o comportamento usando preferências e tokens preservados.

## Fase 50 — Singularity, Paperclip 50.09 — PoC concluída (2026-11-10)

- [x] Opção A confirmada para avaliação: Paperclip como control plane isolado; Singularity Core permanece o único executor e o TaskEngine não foi alterado.
- [x] Paperclip `0.3.1` (`16c30ac32b90eb7a574657b01a99e848cb997d5e`) executado em clone descartável, Windows, Node `v24.17.0`, listener `127.0.0.1:43100`, embedded PostgreSQL isolado e sem credenciais reais.
- [x] API real validada: health `200`, criação de company/issue, consulta de issue e cancelamento para `cancelled`.
- [x] Harness `spikes/paperclip-core-boundary/harness.test.mjs`: 4/4 testes, cobrindo `external_ref`, retry/reconexão, cancelamento, conflito de checkout sem retry, escopos mínimos e ausência de execução duplicada.
- [x] Custo observado após inicialização: delta de CPU `0,000 s` em 5 s; working set do processo Node `667,41 MB`.
- [ ] 50.10 — ativação definitiva não iniciada: ainda faltam autenticação mútua definitiva, autoridade de aprovação, cancelamento/reconciliação entre APIs e comportamento com agente/provider real. O adaptador isolado está implementado e testado em `70d1593`.
- [ ] Limitações da PoC: alerta `MaxListenersExceededWarning` no ciclo de plugins e ausência de backup inicial no estado descartável; não corrigidos no produto.

## Fase 50 — Singularity, CORE-08 Core independente, observabilidade e empacotamento (2026-11-09) — CONCLUÍDO

- [x] Lançador `--singularity-core`, tarefa de logon (usuário atual, menor privilégio, oculta, repetição de 5 min), opt-in em Configurações, passagem embutido → independente → embutido, conexão do desktop pelo token local e vigilância do `/health`, status do processo em Configurações.
- [x] Tarefa agendada **real** registrada, consultada (`schtasks /Query /XML`), executada (`/Run`) e removida no E2E; nenhuma tarefa ficou no Windows ao final.
- [x] Achado corrigido: o supervisor apagava a conexão com o Core independente quando o filho que o encontrou saía depois da conexão.
- [x] Testes novos: `core-standalone` 4, supervisor +1, `core-standalone` E2E 2, `core-packaged` +1 (lançador no app empacotado).
- [x] Instalador `dist/NeuralBridge-Setup-0.1.58-x64.exe` gerado e verificado (sha256 `13b978831e6c157dbdb683d39fb8bef3142361369c1fe66d2268b8d35b5c2d21`, build local sem assinatura); testes empacotados 5/5.
- [x] Regressão final: typecheck e `eslint .` limpos; Vitest serial 2081/2081; E2E completo **326 passados, 0 falhas**, 30 pulados (provedores reais).

## Fase 50 — Singularity, CORE-07 Autenticação, pareamento e acesso remoto (2026-11-09) — CONCLUÍDO

- [x] Migração aditiva 0096 (`core_devices`, `core_pairings`, `core_tokens`, `core_proof_ids`, `core_audit`).
- [x] Testes de segurança `core-auth` 11/11 com servidor real e aparelho simulado (chave P-256, DPoP real): acesso não autorizado, replay, prova de outro método/URL/horário/chave, token roubado, reuso de refresh, expiração, revogação com fechamento de stream, IDOR, escopos, Acesso total, rate limit, bloqueio progressivo, auditoria sem segredos, Tailscale `serve` sem `funnel`.
- [x] Achados corrigidos pelos testes: revogação respondia `unauthenticated` em vez de `device_revoked`; o bloqueio progressivo nunca disparava (chaves diferentes no contador e na checagem).
- [x] Tela "Dispositivos e acesso remoto" (E2E `core-devices`), varredura de acessibilidade verde; `shell.spec` atualizado com o namespace `core`.
- [x] Regressão: Vitest serial 2076/2076; E2E 322 passados, 30 pulados, 1 falha intermitente conhecida (`companion-spotify`, volume) que passou 6/6 repetida; typecheck e lint limpos.
- [ ] Não validado nesta máquina: Tailscale real (não instalado) e app móvel (MOB-01). O fluxo pela tailnet foi testado com executor falso do Tailscale.

## Fase 50 — Singularity, CORE-05/06 Domínio de tarefas no Core e desktop adaptador (2026-11-09) — CONCLUÍDO

- [x] As tarefas do chat executam no processo do Core (E2E confere que o dono do lease é o PID do Core) e aparecem no desktop pela ponte de eventos; cancelamento chega ao Core; `NB_CORE_TASKS=main` volta ao desktop.
- [x] Regressões encontradas na suíte completa e corrigidas: imagens do chat (bytes viravam objeto no JSON; agora base64 restaurado antes da mesma validação do IPC) e orçamento de tokens (o Core relê a preferência a cada execução). `chat-images`, `token-intelligence` e `core-tasks` 8/8 depois da correção.
- [x] Testes novos: `core-task-routes` 6/6 (token, idempotência, esquemas do contrato, transições, lease, SSE com retomada, rotas internas); `core-tasks` E2E 3/3.
- [x] Regressão: Vitest serial 2065/2065; E2E completo 318 passados, 30 pulados, 4 falhas que eram as duas regressões acima, corrigidas e reexecutadas; typecheck e `eslint .` limpos.

## Fase 50 — Singularity, CORE-04 Lease, external_ref e idempotência (2026-11-09) — CONCLUÍDO

- [x] Migrações aditivas 0093 (lease e referência externa em `tasks`, índice único parcial) e 0094 (`idempotency_keys`); teste de atualização a partir de todas as versões anteriores verde.
- [x] Lease no `TaskEngine.launch()`; `recover()` respeita executor vivo; identidade `<pid>:<uuid>` mantém a recuperação imediata depois de queda (achado: sem isso, dois testes de reinício mostraram tarefas presas por até 60 s).
- [x] Testes novos 11 (lease com 8 threads em paralelo: 1 vencedor; `externalRef`; idempotência); Vitest serial 2059/2059; E2E de tarefas/chat/correção/Mission Control/permissões/workflows/Velix/Core 42/42; typecheck e lint limpos.

## Fase 50 — Singularity, CORE-03 Bootstrap do Core (2026-11-09) — CONCLUÍDO, aprovado

- [x] Auditoria do ciclo de vida do Electron (início, TaskEngine, bandeja, `before-quit`/`will-quit`, processos filhos, queda do main) em `docs/architecture/core-03-bootstrap.md` §1.
- [x] Core: `packages/core` (config só por ambiente, lock exclusivo, servidor loopback, `/health` validado pelo `healthSchema`, protocolo IPC validado, logs redigidos). Sem import de `electron` (regra de lint). Modo independente preparado e bloqueado até o CORE-08.
- [x] Supervisor no desktop: ready em 15 s, heartbeat de 5 s (3 perdidos = travado), reinício em 1/2/5/10/30 s com no máximo 5 em 10 min, `attached` quando outro Core é dono da pasta, encerramento gracioso no `will-quit` (5 s, depois kill), `NB_CORE_DISABLED=1`.
- [x] Correção encontrada no teste manual: a segunda instância saía com código 0 em vez de 3 (`process.exitCode` agora é definido antes da saída).
- [x] Achado documentado: no Windows a queda do main mata o Core junto (job do libuv com `KILL_ON_JOB_CLOSE`); o lock velho é assumido na abertura seguinte (E2E).
- [x] Testes novos: `packages/core/test/core-runtime.test.ts` 11/11 (início, `/health` sem dados sensíveis, Host/método/rota recusados, porta ocupada, segunda instância, lock de processo morto e de PID reutilizado, encerramento idempotente, falha de inicialização, configuração, logs); `apps/desktop/test/core-supervisor.test.ts` 10/10 (ready, ready timeout, heartbeat perdido, reinício com espera, limite de reinícios, attached, encerramento gracioso e forçado, desligado, mensagens inválidas, ambiente do filho); `tests/e2e/core.spec.ts` 6/6 (início normal só loopback + `/health` + segunda instância + saída normal; queda do Core e reinício; queda do desktop sem órfão e lock assumido; porta ocupada; falhas repetidas sem derrubar o desktop; chave de desligar); `tests/e2e/core-packaged.spec.ts` 1/1.
- [x] Instalador: `dist:win` e `verify:dist` aprovados (agora exigem `out/main/core.js` no `app.asar`), sha256 `785cbf157d0b03c1b6b6e3180274e1fc8ea26b5a21faf23a1060f43bab5c6726`; testes empacotados `core`, `singularity`, `companion`, `brain3d` 4/4.
- [x] Custo em repouso do Core (20 s): CPU 0,0% (abaixo da resolução), 72 MB working set, 46 MB privados.
- [x] Regressão: typecheck e `eslint .` limpos; E2E completo 318 passados, 30 pulados, 1 falha intermitente (`neura-hud`, sugestão do mascote) que passou 12/12 repetida sozinha; Vitest serial (`--no-file-parallelism`) 2047/2048, a falha (`velix-research-stage`) passou 5/5 sozinha e está em código não alterado. Em paralelo com a suíte E2E rodando, testes com `git`/comandos reais estouram o tempo (instabilidade conhecida do AGENTS.md); passaram 51/51 sem carga.

## Fase 50 — Singularity, CORE-02 Contratos da API do Core (2026-11-09) — CONCLUÍDO, aprovado

- [x] Auditoria de tarefas (`TaskEngine`), agentes, memória, busca/RAG, MCP, monitoramento e autenticação atual registrada em `docs/architecture/core-02-api-contracts.md` §1.
- [x] Contratos em `packages/shared/src/core-api/` (`common`, `errors`, `version`, `limits`, `auth`, `tasks`, `events`, `memory`, `integrations`, `routes`), exportados como `@neuralbridge/shared/core-api`, fora do índice do IPC interno.
- [x] Testes de contrato (32): compatibilidade com o IPC e o domínio atuais (mesmos enums e limites; entrada de `tasks:start` aceita e rejeitada igual), máquina de estados conferida contra as transições reais do `TaskEngine`, escopos locais e elevados, autorização sem vazar projeto privado, endpoints só loopback ou tailnet (`funnel` recusado), pareamento, DPoP, tokens, revogação, eventos e retomada, leitura tolerante de tipos novos, quadros SSE, protocolo WebSocket, memória sem `trust` remoto, push sem conteúdo, catálogo de rotas (prefixo, unicidade, idempotência, escopos, erros conhecidos, corpo estrito) e geração de JSON Schema para todas as rotas.
- [x] Validação: typecheck e lint limpos; Vitest `packages/shared/test` 171/171.
- [x] Sem mudança de execução: nenhum servidor, porta, processo, migração, canal IPC ou fluxo de autenticação criado ou alterado.

## Fase 50 — Singularity, lote 50.12 Migração, E2E, segurança, empacotamento e reversão (2026-11-09) — CONCLUÍDO, aprovado

- [x] E2E do Velix: os 7 specs que não habilitavam a extensão passam a usar `velixDataDir()` (`tests/e2e/velix-extension.ts`), a mesma instalação local já usada pelo `velix-visual`. Velix + Spotify: 37 passados, 4 pulados.
- [x] `velix-production-narration`: corrida no teste (a segunda sincronização era lida antes de gravar, porque o texto "Tempos medidos" já estava na tela). Agora confere a divisão como `edit` antes de sincronizar e espera a nova versão `sync`. 3/3.
- [x] `companion-spotify`: botão "Salvar" restrito à seção Spotify; espera do volume passa de 10 s para 20 s, acima do ciclo de 15 s do serviço parado. Companion (HUD, movimento, Spotify) repetido 3 vezes em lote: HUD 33/33 sem instabilidade.
- [x] Segurança: `typeperf`, `powershell.exe` e `nvidia-smi` por caminho absoluto em `%SystemRoot%\System32`; `sanitizeProbe` descarta contador com cara de opção, aspas ou caractere de controle e unidades fora de `X:\` (teste novo em `monitoring.test.ts`); descrição do Azure DevOps lida com `DOMParser` (documento inerte). Tabela completa em `docs/plans/phase-50-release-and-rollback.md`.
- [x] Empacotamento: `npm run dist:win` e `verify:dist` aprovados, `dist/NeuralBridge-Setup-0.1.58-x64.exe`, sha256 `ef46d8035669a674bf5986c6066a2544ee1f67b90f930abe8993d40a04ae0bad`, build local sem assinatura. Smoke do app empacotado: `singularity-packaged` (novo: arte do Void carregada no HUD e na marca, Galáxia com 300 estrelas, CPU real do monitoramento, sem erro de CSP), `companion-packaged` e `brain3d-packaged`, 3/3.
- [x] Validação: typecheck e lint limpos; Vitest `apps/desktop/test` + `packages/shared/test` 825/825; suíte E2E completa **312 passados, 0 falhas, 30 pulados** (provedores reais) em 22,4 min.
- [x] Reversão: sem migração de banco; visualização volta ao Cérebro 3D pelas configurações de Memória; instalador anterior abre os mesmos dados.

## Fase 50 — Singularity, lote 50.11 Desempenho, animações, acessibilidade e alternativas (2026-11-09) — CONCLUÍDO, aprovado

- [x] Custo em repouso (`tests/e2e/idle-cost.spec.ts`, % de um núcleo por processo, médias de 10 s, AMD Ryzen 7 9700X 8-Core Processor, 16 threads):

  | Situação | Janela | HUD do Void | GPU (processo) |
  |---|---|---|---|
  | Hub | 0.0% | 0.1% | 0.4% |
  | Galáxia com 5.000 estrelas, girando | 0.7% | 0.2% | 1.5% |
  | Configurações (tela estática) | 0.0% | 0.1% | 0.5% |

  Não houve nada a otimizar: o HUD com as duas animações contínuas do Void fica em décimos de ponto percentual, e a Galáxia desenha na placa de vídeo. O teste guarda os números em `tests/.cache/idle-cost.json` e falha acima de 5% (HUD) e 10% (janela).
- [x] Acessibilidade (`tests/e2e/accessibility-sweep.spec.ts`, 22 telas): controles com nome (inclusive por `<label>` envolvente), campos rotulados, imagens com `alt`, ids únicos, sem `tabindex` positivo, um `h1` por tela. Único achado real corrigido: a página de demonstração não tinha `h1`.
- [x] Movimento reduzido: o Void para (`animation: none` no HUD), a Galáxia não gira nem anima o disco, entradas viram instantâneas; o pulso de recuperação aparece sem movimento.
- [x] Alternativas: Galáxia sem WebGL vira lista (E2E), vidro sem `backdrop-filter` vira painel opaco (`@supports`), monitoramento sem coletor fica "indisponível" com o motivo (unitário), worker indisponível cai para posição por identificador.

## Fase 50 — Singularity, lote 50.07 Galáxia ligada à memória e ao RAG (2026-11-09) — CONCLUÍDO, aprovado

- [x] Recuperações reais acendem as estrelas: reaproveita `useRealActivity` (registro de acessos do servidor MCP e eventos `rag_context` das tarefas); a cena ganha um pulso por estrela (atributo `aPulse`, relógio próprio) e um feixe dourado do núcleo até a estrela, que some em 3 s (no máximo 40 ao mesmo tempo).
- [x] Painel: "Recuperações recentes" (memória, cliente e hora), "Indexação RAG" (indexadas de total, pendentes e falhas, dos dados do índice) e "Resultados da busca" com a origem de cada resultado (texto ou significado).
- [x] Linha do tempo: inclui as recuperações do dia ("Recuperada por Claude Code"); o rótulo "Agora" passou para cima do trilho e não colide mais com eventos do mesmo minuto.
- [x] Ao vivo: consulta leve ao resumo do índice a cada 15 s (só com a janela visível); a galáxia recarrega apenas quando total, última memória ou indexação mudam, para as estrelas não se reorganizarem à toa.
- [x] Testes: novo E2E em `galaxy.spec.ts` com recuperação pelo servidor MCP real (`brain_recall` como o Claude Code), cartão de índice, resultados da busca e memória nova aparecendo sem reabrir a tela; `galaxy` 5/5, `brain3d` 9/9, `design-system`, `memory`, `shell` sem falhas; Vitest 685/685; referências visuais regeneradas (22/22).

## Fase 50 — Singularity, lote 50.05 Redesign das telas (2026-11-09) — CONCLUÍDO, aprovado

- [x] `app/PageHeader.tsx`: rótulo do grupo de navegação em caixa alta espaçada ("· TRABALHO") e título fino de 26 px, em todas as 18 telas que usam o cabeçalho; títulos próprios de Mission Control, Analytics, Git Intelligence e Velix alinhados ao mesmo estilo.
- [x] Cartões: 71 ocorrências de `rounded-* border bg-card` viram `.sg-panel` (vidro sem `backdrop-filter`, para dezenas de cartões não pesarem na GPU); `shadow-sm` removido onde anulava o realce do painel.
- [x] Cores: ~30 usos de paleta Tailwind fixa (esmeralda, âmbar, vermelho, azul) em Azure DevOps, Velix e Skills trocados por `success`, `warning`, `destructive` e `info`, que passam no teste de contraste nos dois temas; seletores CSS do Azure DevOps acompanham. Cores fixas restantes são artes (cérebro 3D anterior, mascote, composição de vídeo, identidade de canal).
- [x] Dashboard como Hub da referência: painel direito com memórias, distribuição por tipo e atividade recente; linha do tempo com as tarefas do dia; tudo com dados reais.
- [x] Correções vistas na revisão: marcadores da linha do tempo contidos no trilho (o "Agora 23:35" saía da borda); medidores da lateral dizem "iniciando" até a primeira leitura, em vez de "indisponível".
- [x] Validação: typecheck e lint limpos; Vitest `apps/desktop/test` 685/685; referências visuais regeneradas e revisadas, 22/22 estáveis; suíte E2E completa 274 passados, 30 pulados (provedores reais), 34 falhas — as mesmas conhecidas da linha de base (32 do Velix por testes que não habilitam a extensão, `companion-spotify` com seletor "Salvar" ambíguo); nenhuma regressão, e `brain3d-perf` passou desta vez.

## Fase 50 — Singularity, ajuste do Void e da logo (2026-11-08, depois do commit `ab5cdfe`) — CONCLUÍDO, aprovado

- [x] Pedido do usuário: mascote idêntico à referência ("o disco de acreção não é um anel"). O disco agora é a própria arte da referência, extraída por `scripts/extract-void-mascot.mjs` (recorte, rosto pintado apagado, fundo preto convertido em transparência, nebulosa das bordas esmaecida) em `apps/desktop/src/renderer/src/assets/void/void-disk-480.webp`; o horizonte é um disco negro opaco por baixo e o rosto continua vetorial, com olhos em crescente como na referência.
- [x] Disco em movimento (pedido do usuário): uma cópia mascarada da faixa do disco gira no plano inclinado do próprio disco, então os fios de plasma percorrem a órbita; mais rápido trabalhando ou falando, devagar dormindo, parado com movimento reduzido. Tingimento por estado (alerta vermelho, sono verde-água, desconectado cinza).
- [x] Logo (decisão do usuário): o Void sem olhos, a mesma arte, no cabeçalho, na página de demonstração e no ícone do app/instalador (`scripts/generate-icon.mjs`).
- [x] Validação: lint limpo; Vitest `apps/desktop/test` 685/685; E2E companion-hud 11, companion-motion 17, neura-hud 4, neura-assistant 8, design-system 1, shell 11, chat 7 (rodados por arquivo; em lote, 2 testes de `companion-hud` falham por tempo e passam isolados).

## Fase 50 — Singularity, lote 50.04 Marca visível e mascote Void (2026-11-08) — CONCLUÍDO, aprovado

- [x] Marca visível Singularity: cabeçalho "SINGULARITY / AI ORCHESTRATOR" com o horizonte de eventos (`app/BrandMark.tsx`), título da janela e do documento, bandeja, Companion HUD, textos de 27 arquivos do renderer, mensagens de importação/exportação e ícone do app/instalador (`scripts/generate-icon.mjs`, `apps/desktop/build/icon.*`).
- [x] Sem mudança técnica (D-1): `app.setName('NeuralBridge')`, `appId`, `productName` do instalador, servidor MCP `neuralbridge`, formato de exportação `neuralbridge-brain`, pacotes `@neuralbridge/*` e comentários de código. Plano M1–M4 com testes e rollback em `docs/plans/phase-50-rebrand-migration.md`.
- [x] Mascote Void (pedido do usuário durante o lote): `NeuralBridgeMascot.tsx` redesenhado como buraco negro com disco de acreção em duas metades (trás e frente do horizonte), rosto luminoso e as expressões da referência mapeadas aos estados reais do Companion; fluxo animado no disco (parado com movimento reduzido); galeria de expressões na página `#/design-system`. Classes de animação preservadas (piscar, olhar, acordar, dançar).
- [x] Nome exibido Neura → Void com concordância ("o Void está pausado", "Pedir ao Void"); identificadores (`neura`, canais `neura:`, configurações) inalterados. A palavra de ativação por voz continua "Neura" (o worker local e o prompt do Whisper dependem dela) — troca fica como decisão do usuário.
- [x] Testes atualizados para o nome novo (título, bandeja, Companion, tutorial, importação, seletores do Void). Corrigido também em `shell.spec.ts`: o fundo esperado ainda era o preto anterior ao 50.02, e a lista de namespaces do preload estava desatualizada desde antes desta fase (faltavam `azureDevOps`, `databaseRecovery`, `extensions`, `neura`) e sem `monitoring` (50.08) — esse arquivo não tinha sido incluído nas regressões dos lotes anteriores.

- [x] Validação: typecheck e lint limpos; Vitest 935/935; E2E Companion/voz/design system 41/41. Suíte E2E completa (antes do Void): 273 passados, 30 pulados (provedores reais), 35 falhas — 32 do Velix por testes que não habilitam a extensão Velix (mesma causa já corrigida no `velix-visual`, anterior à Fase 50), `companion-spotify` (seletor "Salvar" ambíguo) e `brain3d-perf` (GPU) a investigar no lote 50.12.

## Fase 50 — Singularity, lote 50.08 Monitoramento de desempenho (2026-11-08) — CONCLUÍDO, aprovado

- [x] Coleta real no Windows, sem módulo nativo (`apps/desktop/src/main/monitoring/`):
  - nomes dos contadores localizados uma única vez pela API PDH (PdhAddEnglishCounter), num PowerShell curto que encerra; o resultado fica em cache por versão do Windows;
  - `typeperf.exe` (do próprio Windows) como processo filho de longa duração: CPU (uso, frequência real = frequência × % de desempenho), disco (ocupação, leitura, gravação), rede (download, upload, velocidade do link), GPU (motores 3D/Copy por adaptador), VRAM dedicada e o custo do próprio coletor;
  - `nvidia-smi` quando o driver NVIDIA existe: uso, temperatura e VRAM exatos da GPU;
  - RAM pelo sistema (Node), espaço livre por unidade (`fs.statfs`) e consumo do app pelas métricas do Electron.
- [x] Sensores indisponíveis com motivo, nunca com número: a temperatura da CPU fica "indisponível" nesta máquina (as zonas ACPI marcam 16,9 °C, valor que não é da CPU e é rejeitado); a temperatura da GPU só vem do nvidia-smi.
- [x] Sem bloqueio: o handler IPC só lê o buffer em memória (ida e volta mediana 0.3 ms); a coleta começa sob demanda e pausa 20 s depois da última consulta (janela oculta = sem consultas). Um único laço de consulta no renderer atende a lateral e a página.
- [x] Intervalo configurável (1, 2, 5 ou 10 s), salvo nas preferências e aplicado reiniciando os processos de coleta. Histórico de 300 amostras.
- [x] Interface: medidores compactos de CPU, memória e disco fixos na lateral; página `#/monitoring` com gráficos históricos de CPU, RAM, GPU, VRAM, disco (leitura/gravação e espaço por unidade), rede, consumo por componente e custo do monitoramento; temas claro, escuro e sistema.
- [x] Arquitetura para consumidores futuros: `MonitoringCollector.registerProcessGroup` e a lista de consumidores (Claude, Codex, Core, MCP, RAG) já estão no contrato; aparecem como "não monitorado" com o motivo até um grupo real ser registrado (CORE-05). Agentes, MCP e RAG não foram alterados.
- [x] Corrigido durante o lote: o custo do coletor aparecia como 0% porque `Process(typeperf)` e `Process(nvidia-smi)` têm o mesmo objeto e contador e o mapeamento ignorava a instância; confirmado por medição independente (`Get-Process`: 344 ms de CPU em 30 s = 0,072% da máquina) e coberto por teste.
- [x] Custo medido (intervalo 2 s, 30 s, AMD Ryzen 7 9700X 8-Core Processor, 16 threads, 31 GB, Windows 10.0.26300): coletor 0.083% da CPU da máquina e 32 MB (memória privada de typeperf + nvidia-smi); o app inteiro 0.09% da CPU. O probe do PowerShell roda só na primeira execução por versão do Windows.
- [x] Instalador: sem dependência nova; `npm run dist:win` e `verify:dist` passaram (build local sem assinatura, como antes) e o app empacotado coletou dados reais.
- [x] Testes: `monitoring.test.ts` 10 (parser, colunas, colisão de instâncias, nvidia-smi, probe, coletor com sensores ausentes, intervalo, histórico), `monitoring-ui.test.ts` 4, `monitoring-real.test.ts` 1 (coleta real no Windows); Vitest `apps/desktop/test` + `packages/shared/test` 824/824 (`--no-file-parallelism`); E2E `monitoring` 2/2 (dados reais, intervalo persistido, temas, custo), regressão de galáxia, design system, navegação, Mission Control, memória, chat, agentes, MCP, banco, extensões, onboarding e configurações sem falhas.
- [x] Regressão visual: os valores ao vivo (medidores e status) ficam ocultos só durante a comparação (`tests/e2e/screenshot.css` via `playwright.config.ts`). Todas as referências foram regeneradas com `--update-snapshots=all`, porque a tolerância de 1% deixava passar referências antigas sem o item "Monitoramento" e o status fixo; 22/22 estáveis em 2 rodadas.
- [x] Aprovado pelo usuário em 2026-11-08 e commitado (`d228114`). Nenhum outro lote foi iniciado.

## Fase 50 — Singularity, lote 50.06 Galáxia de Memórias (2026-11-08) — CONCLUÍDO, visual aprovado

- [x] Lateral: "Status do sistema" fixo acima de "Recolher menu"; a navegação rola sozinha (decisão do usuário).
- [x] IPC `brain:galaxy` (`GalaxySnapshot`: memórias vivas, links, total real, embeddings Float32 de um único modelo) — `shared/brain3d.ts`, `ipc.ts`, `channels.ts`, preload, `main/brain.ts`.
- [x] Layout em Web Worker (`features/galaxy/galaxy-layout.ts`, `galaxy.worker.ts`): PCA por iteração de potência, k-means esférico (agrupamento por significado), braços espirais por grupo; nada pesado na thread de UI. Sem worker, layout por hash e aviso na tela.
- [x] Cena three.js (`galaxy-scene.ts`): buraco negro pequeno (horizonte, disco de acreção dourado em shader, anel de fótons, halo), uma estrela por memória, brilho dos braços derivado das estrelas e ajustado à densidade, ligações só da estrela em foco (ou todas, pelo botão).
- [x] Página `#/memory/galaxy`: busca híbrida real, agrupamento por tipo/projeto/significado, filtros por projeto/tipo/período, painel direito com detalhes reais, ligações e vizinhas por significado, linha do tempo com memórias e tarefas reais do dia, lista virtual (também o fallback sem WebGL), teclado e anúncios para leitor de tela, movimento reduzido.
- [x] Reversão sem build: Memória › Configurações › Visualização 3D (Galáxia ou Cérebro 3D anterior); as duas rotas continuam válidas.
- [x] Corrigido durante o lote: a busca da galáxia pedia 50 resultados, acima do limite do contrato (20); agora usa `LIMITS.searchResults` e mostra "busca indisponível" se falhar.
- [x] Correção de registro do 50.03: o ajuste `getByLabel('Status', { exact: true })` em `mission-control.spec.ts` não funcionava (o nome acessível do select inclui as opções) e a falha passou despercebida porque só a última linha da saída foi lida. Agora usa `getByRole('combobox', { name: 'Status' })`, como o outro teste do arquivo; 5/5.
- [x] Desempenho com 5.000 memórias × 384 dimensões (fixture de teste), janela 1280×820, `tests/e2e/galaxy-perf.spec.ts`. Máquina: AMD Ryzen 7 9700X 8-Core Processor, 16 threads, 31 GB RAM, Windows 10.0.26300.

  | Renderização | Primeira interação | Worker (projeção + clusters) | Seleção pelo teclado | FPS mediano (mín.) |
  |---|---|---|---|---|
  | GPU — ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11 vs_5_0 ps_5_0, D3D11) | 801 ms | 406 ms | 64 ms | 60 (60) — teto do vsync |
  | Software — SwiftShader | 1619 ms | 743 ms | 71 ms | 37.3 (35.3) |

  Metas (GPU): ≥ 30 FPS e primeira interação ≤ 1,5 s — atendidas. "Primeira interação" = da abertura da rota ao primeiro quadro com estrelas e controles ativos. Em Node, o layout puro mediu 296 ms (projeção) + 63 ms (clusters) + 5 ms (espirais).
- [x] Validação: typecheck e `eslint .` limpos; Vitest `apps/desktop/test` + `packages/shared/test` 808/809 em paralelo — a falha é `workflows.test.ts`, que passa 7/7 sozinho (instabilidade conhecida de comandos reais em paralelo); testes novos `galaxy-layout` 8, `galaxy-model` 7, `brain3d-ipc` (galáxia) 3. E2E: `galaxy` 4/4 (integração, reversão, sem WebGL, movimento reduzido), `galaxy-perf` 2/2, e regressão de cérebro 3D, memória, grafo, confiança, navegação, design system, chat, Mission Control e suítes visuais. Snapshots de `final-visual-matrix` e `knowledge-visual` regenerados pelas mudanças intencionais (aba "Galáxia", status fixo), estáveis em 2 rodadas.
- [x] Visual aprovado pelo usuário em 2026-11-08. Nenhum outro lote foi iniciado.

## Fase 50 — Singularity, lote 50.03 Shell e componentes (2026-11-08)

- [x] Antes do lote: corrigidos `projects-visual` (procura o `EmptyState` "Nenhum projeto ainda" em vez da região removida) e `velix-visual` (registra a extensão Velix habilitada pelo novo helper `tests/e2e/velix-extension.ts`). As alterações locais existentes foram preservadas; os dois passaram 2 vezes seguidas.
- [x] Shell: abas de contexto (`app/TopNav.tsx`), status real na lateral (`app/SystemStatus.tsx`), slots `ShellAside`/`ShellTimeline` (`app/shell-slots.tsx`; o painel vira drawer abaixo de 1280 px), componentes `components/ui/glass.tsx` e `components/shell/Timeline.tsx`, e barra de título nativa no tom do header (`main/window.ts`).
- [x] Sem métricas fictícias: status vem de `agents.status`, `mcp.status`, `app.status` e `brain.overview`; os medidores de hardware mostram "indisponível" até o lote 50.08; a página `#/design-system` passou a usar só dados do banco local.
- [x] Ajuste de teste: `mission-control.spec.ts` usa `getByLabel('Status', { exact: true })`, porque o shell ganhou a região "Status do sistema".
- [x] Validação: typecheck e `eslint .` limpos; Vitest `apps/desktop/test` 652/652 (inclui `singularity-shell-model.test.ts` 14/14); E2E funcionais: 30/30 em um lote e 52 passados, 1 ignorado e 1 falha corrigida no outro (`mission-control`: o ajuste daquele lote estava errado; corrigido no 50.06) (navegação, chat, memória, extensões, onboarding, agentes, MCP, grafo, banco, design-system, tours, projetos, execuções, workflows, mission control, skills, configurações, densidade, vídeo e Azure DevOps); suítes visuais 22/22 dentro da tolerância, sem regenerar imagens.
- [x] Visual aprovado pelo usuário em 2026-11-08. Nenhum outro lote foi iniciado.
- [ ] Em aberto: decidir se o "Status do sistema" fica fixo acima de "Recolher menu" (hoje rola com o menu em janelas de até ~900 px de altura).

## Fase 50 — Singularity, lote 50.02 Design System (2026-11-08)

- [x] Tokens Singularity (escuro como padrão, claro e "sistema" mantidos) em `apps/desktop/src/renderer/src/styles.css`, mais as classes de base `.sg-*`; Inter (`@fontsource-variable/inter` 5.3.0, OFL-1.1) substitui a IBM Plex Sans.
- [x] Página de revisão oculta `#/design-system` (`features/design-system/DesignSystemPage.tsx`); documento em `docs/ux/singularity-design-system.md`.
- [x] Corrigido: o botão `destructive` usava `text-white` sobre vermelho claro, abaixo de 3:1; agora usa `--destructive-foreground`.
- [x] Validação: `npm run typecheck` e `npx eslint .` limpos; `singularity-tokens.test.ts` 146/146 (contraste WCAG nos dois temas); Vitest `apps/desktop/test` 638/638; E2E `design-system` 1/1; `navigation-information-architecture`, `memory` e `chat` 13/13.
- [x] Visual aprovado pelo usuário em 2026-11-08. Snapshots regenerados (`--update-snapshots`) para `final-visual-matrix` (36), `visual-qa`, `knowledge-visual`, `workflow-builder-visual`, `guided-tours-visual` e o segundo caso de `projects-visual`; a nova rodada sem atualização passou 19/19 e a matriz 3/3 seguidas.
- [x] Corrigido no teste `final-visual-matrix`: duas corridas anteriores a esta sessão faziam a captura sair na tela "Carregando" (rotas carregadas sob demanda, Task 3.3) ou no meio do fade-in de Configurações (Web Animations do `motion`, que `animations: 'disabled'` não congela). O teste agora espera o placeholder sumir e as animações terminarem.
- [ ] Falhas anteriores e sem relação com a paleta: `projects-visual` (1º caso) procura a região "Nenhum projeto", que a adoção do `EmptyState` (Task 3.2, alteração local não commitada) removeu; `velix-visual` espera o link "Velix", que numa instalação limpa fica oculto porque a extensão não vem habilitada (Task 3.1). Os dois param antes de qualquer captura de tela.
- [ ] O lote 50.03 não foi iniciado.

## Enterprise consolidation — Task 5.2 real-environment run (2026-11-08)

- [x] Real CLIs (user-approved): `agents-real` 1/1, `mcp-real` 2/2, `git-review-real` 1/1 and `git-smart-commit-real` 1/1 with Claude (`NB_REAL_AGENT=claude`); temp repositories, no commit/push.
- [x] Fixed: TFS probe reported `connected` when every endpoint returned 401; now fails as `login_required`/`forbidden` (tests 16/16, confirmed against the real server). `git-review-real` updated for the tabbed Git workspace.
- [ ] External blockers: Codex usage limit until 2026-11-09 21:21 (rerun `chat-real` and the Codex variants); TFS saved credential rejected (401) and TFS server down (rerun read-only after re-login); no other Windows version/machine; Authenticode, updater and signed registry unchanged.
- [ ] Azure DevOps/TFS is **not homologated** — only fake-server and 401 evidence.

## Enterprise consolidation — Phase 2 architecture consolidation (2026-11-08)

- [x] Task 2.1: task lifecycle, approvals, Agent Swarm, agent status and token analytics extracted from `main/index.ts` into `main/handlers/tasks.ts`; Swarm orchestration is an application service (`orchestrator/src/application/swarm-service.ts`) over a `TaskPort`; diagnostics export extracted to `main/diagnostics-export.ts`; `Clock` injected into TaskEngine and the evidence service.
- [x] Task 2.2: IPC capability inventory (`shared/src/ipc-capabilities.ts`) with tests for capability/preload grouping, credential-named outputs, secret ingress and loosely typed outputs. Fixed: Azure DevOps methods lived in the Velix `video` facade (now `window.neuralbridge.azureDevOps`); `azure-devops:write:execute` returned the raw TFS response (now normalized, closed contract).
- [x] Task 2.3: `architecture-boundaries.test.ts` locks packages, provider clients, credential stores and application services away from Electron/database; real Claude/Codex E2E moved to `agents-real`/`mcp-real`; `neura-voice-real` requires `NB_E2E_REAL_VOICE=1`.
- [x] Validation: typecheck, lint and diff-check clean; Vitest 1799/1799 (`--no-file-parallelism`); E2E azure-devops, swarm, chat, agents, mcp, navigation, extensions, database 27/27 (3 real-provider tests skipped without opt-in); `dist:win` + `verify:dist` passed (unsigned); packaged `primary-journey` 13/13.
- [ ] Not done: 13 preload methods without a renderer/E2E consumer kept as removal candidates (product decision; list in `docs/architecture/ipc-consumer-matrix.md`); Velix `video`, Neura and Azure DevOps handlers still live in `main/index.ts` (frozen extensions / later bounded slices).

## Enterprise consolidation — Phase 1 core execution platform (2026-11-08)

- [x] Task 1.1: `ExecutionSnapshot` contract made explicit (attempt, approval, cancellation, paused checkpoint, correlation, resume semantics). Fixed: approval/cancellation never updated after the first insert, `attempt` stayed 0, a paused task stored the invalid phase `paused` (rejected by the strict `task:get` schema), and `approve` could release a capacity wait. `engine-execution-contract.test.ts` 10/10.
- [x] Task 1.2: one redacted, structured evidence record per agent step (previously nothing was recorded, since no adapter emits `evidence` events); duplicate evidence prevented by side-effect key; IPC requests run under a correlation ID that reaches the task snapshot (migration `0092`), evidence and Azure DevOps (`X-TFS-Session`); diagnostic export redacts `sk-`/`gh*_` shapes.
- [x] Task 1.3: database failures `disk-full` and `migration` added; degraded-mode banner restores a verified backup (unusable files moved to `db/preserved/`, never deleted), exports redacted diagnostics (database, migrations, disk, agent CLIs) and retries by restarting; invalid `preferences.json` is copied aside and reported; startup guard prevents blank/invisible main windows.
- [x] Validation: see the Phase 1 block in `docs/PLAN.md` for commands and results.
- [ ] Not covered: Spotify/YouTube calls inherit the correlation context but send no header; a pre-migration automatic backup is not taken (migrations stay transactional and a failure leaves the previous data intact).

## Enterprise consolidation — Task 5.2 real-environment homologation (2026-11-06)

- [x] Audited the current Windows environment: Windows 11 Pro build 26300 x64, Node 24.17.0, npm 11.13.0, Git 2.54.0, NeuralBridge 0.1.58, Claude 2.1.317 and Codex 0.166.0 detected. Provider authentication was not queried or used.
- [x] Local/simulated matrix executed and recorded in `docs/release/homologation-matrix.md`; TFS read-only, TFS approval-gated write, extension absence/incompatibility and lifecycle/data preservation passed 3/3 repeated iterations (15/15).
- [x] TFS fixture was aligned with the actual WIQL POST endpoint and current typed IPC surface; no real corporate endpoint was contacted.
- [x] Repeated isolated NSIS homologation (2026-11-06): `/S /D=.release-test-install-2` returned 0, the installed executable launched with isolated `NB_DATA_DIR`, and silent uninstall returned 0 while preserving the isolated data directory. Real `%APPDATA%` was not touched.
- [x] Extension fixture covers missing Neura/Velix state, Core incompatibility rejection, local install, disable, update, rollback and payload preservation; no simulated absence was treated as a real production package absence.
- [x] Evidence remains classified as approved, approved by simulated test, not executed, or externally blocked; no real credential, PAT, token, commit, push or destructive Git action was used.
- [ ] Real clean install/uninstall/data preservation, real Claude/Codex authenticated tasks, real project permissions, real TFS read/write, and external media providers remain not executed or externally blocked.
- [ ] Authenticode remains blocked: `signtool.exe` is unavailable; auto-update, previous installer and signed HTTPS registry blockers remain unchanged.
- [x] Task 5.3 release decision and roadmap reset are recorded in `docs/release/0.1.58-release-decision.md`; this does not declare enterprise readiness.

## Enterprise consolidation — Task 5.3 release gate (2026-11-06)

- [x] Release 0.1.58 classified as local validation release candidate: Core stable, Power tools stable, Integrations experimental, Extensions experimental.
- [x] Areas assessed: TaskEngine, Chat, Projects, Memory/RAG, Git Intelligence, Workflows, Analytics, MCP, extensions, Neura, Velix, Azure/TFS, Windows distribution, security and real homologation.
- [x] README, PLAN, STATUS, homologation matrix and Windows release checklist updated with the same release posture.
- [x] Post-consolidation roadmap prioritizes Authenticode, auto-update, signed HTTPS registry, real credentials, prior-version upgrade, multiple Windows profiles, extension hardening, opt-in metrics review and maintenance debt.
- [x] Cleanup was inventory-only. No migration, history, snapshot, fixture, data or generated artifact was deleted; `.release-test-data-2/` remains preserved as evidence.
- [ ] Enterprise-ready release remains blocked by external signing, updater, registry, upgrade and real-environment homologation dependencies.

## Maintenance — artifact retention and debt audit (2026-11-06)

- [x] Audited the documented generated-artifact inventory against Git tracking, repository references, sizes and current contents.
- [x] Preserved all artifacts: no migrations, history, snapshots, fixtures, evidence, tracked generated outputs or user data were deleted.
- [x] Added `docs/architecture/artifact-retention.md` with per-item decisions and the evidence needed before any future removal.
- [x] Added narrowly scoped ignore rules for future local release/debug/runtime/test artifacts; existing contents remain untouched.
- [x] Debt scan recorded intentional placeholders and planned work. No dead route, unused IPC, pass-through module, unused import, duplicate test or unreferenced script was proven strongly enough for a safe change.
- [ ] Focused debt follow-up remains pending for call-graph/runtime confirmation; external signing, updater, registry and corporate homologation blockers remain unchanged.

## Maintenance — structural call graph and IPC audit (2026-11-06)

- [x] Audited `shared`, `database`, `brain`, `orchestrator`, `workspace`, `agents`, `mcp-server`, Electron main, preload and renderer boundaries.
- [x] Created `docs/architecture/module-call-graph.md` with entry points, consumers, dependencies, exports, routes, tests, dead-code confidence, pass-through modules, coupling risks and P0/P1/P2 follow-ups.
- [x] Mapped 393 declared invoke channels to 393 shared contracts, main registrations and preload references; Companion's five specialized handlers also parse input/output contracts.
- [x] Created `docs/architecture/ipc-consumer-matrix.md` with domain counts, handler/preload/renderer/test paths, secret ingress and large-payload risks.
- [x] No IPC channel, route or module was removed; dynamic imports, Electron registration, route tables and test fixtures were treated as valid consumers.
- [x] The first and second safe extractions are complete; continue with one bounded handler group at a time and keep broad refactoring unauthorized.

## Maintenance — first safe IPC handler extraction (2026-11-06)

- [x] Extracted only the seven extension lifecycle handlers into `apps/desktop/src/main/handlers/extensions.ts`.
- [x] Preserved `extensions:list`, `extensions:install`, `extensions:enable`, `extensions:disable`, `extensions:update`, `extensions:rollback` and `extensions:uninstall` exactly.
- [x] Injected `ExtensionRegistry`, `ExtensionInstaller` and the trusted-sender predicate explicitly; the shared `registerIpcHandler` still performs sender, Zod input and output validation.
- [x] Added contract tests for valid/invalid payloads, untrusted sender, unavailable dependencies, lifecycle return compatibility and absence of secret-bearing output fields.
- [x] Extension E2E passed 3/3 after the extraction; renderer and preload were not changed.
- [x] The remaining P0 risk is still the rest of `main/index.ts`; this extraction was reviewed as a separate bounded group before validation.

## Maintenance — second safe IPC handler extraction (2026-11-06)

- [x] Audited `docs/architecture/module-call-graph.md`, `docs/architecture/ipc-consumer-matrix.md`, `docs/release/0.1.58-release-decision.md`, `docs/release/windows-release-checklist.md`, the current diff and the existing IPC contracts before editing.
- [x] Extracted only `app:info` and `app:status` into `apps/desktop/src/main/handlers/diagnostics-release.ts`, with explicit app identity and database health dependencies.
- [x] Preserved trusted-sender checks, no-input payloads, strict output contracts, database recovery status, version/platform/Electron fields and renderer/preload compatibility.
- [x] Added TDD contract coverage for valid returns, invalid payloads, untrusted sender, health failure and rejection of secret-bearing output; focused IPC regression passed 50/50.
- [x] Relevant packaged E2E passed 16/16: extensions 3/3 plus primary journey 13/13, including diagnostics export redaction and persisted recovery paths.
- [x] `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:dist` and `git diff --check` passed. The local installer remained intentionally unsigned; SHA-256 was `f6324768e3ac185937cc6f64275faad7e50e1a99a90ddd420a866bcb7b93c0a6`.
- [x] No support-bundle or release-verification IPC channel was exposed by the audited surface; the existing diagnostics export and distribution verification scripts remain unchanged and no files were deleted.
- [ ] Authenticode, automatic update, signed registry and real-environment release gates remain external blockers; no Phase 3 work was advanced by this slice.

## Maintenance — third IPC extraction validated (2026-11-06)

- [x] Re-read `docs/architecture/module-call-graph.md` and `docs/architecture/ipc-consumer-matrix.md`, then audited the remaining `main/index.ts` registrations and existing handler seams.
- [x] Selected the small, cohesive `theme` configuration group rather than video, Neura or external integrations.
- [x] Exact channels in scope: `theme:get` and `theme:set`; contracts in `packages/shared/src/ipc.ts` and preload methods remain unchanged.
- [x] Dependencies to inject explicitly: preferences file access and native theme application; initialization and `nativeTheme.updated` window synchronization remain composition-root concerns.
- [x] TDD RED observed before implementation: the new contract suite failed because `handlers/theme.ts` did not exist; after implementation the contract suite passed 2/2.
- [x] Moved the two registrations to `apps/desktop/src/main/handlers/theme.ts`, injecting only the preferences file and native theme setter; `nativeTheme` initialization and window update synchronization remain in the composition root.
- [x] Focused regressions passed 10/10 (`theme-ipc`, generic IPC seam and preferences); affected E2E checks passed 2/2 (light theme and invalid IPC payload).
- [x] Post-build validation passed: global serial suite 222/222 files and 1,725/1,725 tests; typecheck, lint, Electron build, `verify:dist` and `git diff --check` passed.
- [x] Independent review found no functional, compatibility or security findings; residual risk is limited to explicit dedicated coverage for `system`, `senderFrame: null` and persistence failures.
- [x] No renderer or preload file changed, channel names and schemas remain unchanged, and no second extraction was started before this slice's validation.

## Maintenance — Skills catalog slice extracted (2026-11-06)

- [x] Scope is limited to `skills:list`, `skills:settings` and `skills:settings:save`; `skills:usage`, `skills:recommend`, installation and Studio remain untouched.
- [x] TDD RED observed before implementation because `handlers/skills-catalog.ts` did not exist; the focused IPC contract suite now passes 9/9 (15/15 including the existing skills listing and preferences suites).
- [x] Injected `preferencesFile`, `readPreferences`, `writePreferences`, `skillRoots` and `scanSkills`; `registerIpcHandler` and trusted-sender validation remain unchanged.
- [x] Catalog output continues to use the existing strict contract and `toSkillListing`, excluding raw `SKILL.md` content; secret-like frontmatter metadata is redacted, and sensitive settings are rejected with a redacted error before persistence without rejecting valid hostnames such as `api-token.example`.
- [x] Renderer and preload were not changed; no installation, Studio, MCP, Git, Brain/RAG, Neura or Velix handler was moved; no file was removed and the second slice was outside that checkpoint.
- [x] Final slice validation passed: focused IPC/catalog tests 15/15; skills E2E 13/13; typecheck, lint, Electron build, `verify:dist` and `git diff --check` passed. The earlier global Velix failure is diagnosed and corrected in the maintenance record below; the current global result is recorded there.

## Maintenance — Velix research-stage failure diagnosed (2026-11-06)

- [x] Baseline reproduced before the fix: the target test failed once; five isolated runs returned `0,1,0,1,0`; five complete-file runs returned `1,0,1,0,0`; the file passed with `--no-file-parallelism` (3/3).
- [x] Instrumentation showed completed script/research stages, `researchCalls: 1`, and a valid cache path. On failures, `claims.list(second.id)` returned the opinion before the factual claim; both claims can share `created_at`, so `[0]` was not a stable selector. `claimGate` correctly reported the remaining fact as unsupported.
- [x] Minimal correction was test-only in `packages/orchestrator/test/velix-research-stage.test.ts`: select the factual claim by its text/type and assert the result without relying on list order. No production, Skills, `main/index.ts`, retry or fixed-sleep change was made.
- [x] Post-fix evidence: isolated target 5/5, complete file 5/5, `--no-file-parallelism` 3/3, typecheck, lint, build, `verify:dist` and `git diff --check` passed.
- [x] The earlier global failure is superseded by the Projects timeout audit below; it was unrelated to Velix. The Skills Fatia 2 extraction is now recorded below; Fatia 3 remains intentionally not started.

## Maintenance — Projects Git timeout audit (2026-11-06)

- [x] The reported `apps/desktop/test/projects.test.ts:91` timeout did not reproduce: the isolated target passed 5/5, the complete file passed 5/5 (29/29 each), and `npx vitest run --no-file-parallelism apps/desktop/test/projects.test.ts` passed 29/29.
- [x] The global serial command `npx vitest run --no-file-parallelism` passed 223/223 files and 1,734/1,734 tests.
- [x] The default-parallel global command reached 217/223 files and 1,727/1,734 tests, with seven failures across six Git/SQLite/orchestration-heavy files. The Projects timeout in that run was at line 30 and took 5.559 s, not at the reported line 91.
- [x] `protectedWrite` and the Git write helper were audited: arrival ordering is reserved before the first await, worktree serialization still uses `git-common-dir`, writes use `spawn` without a shell, and the production write timeout is 10 minutes. No production deadlock was reproduced.
- [x] No pending Git process or direct `index.lock`, `HEAD.lock`, `config.lock` or `packed-refs.lock` was found in the 12,606 temporary test directories inspected. The full Projects file also passed its queue/worktree cases, ruling out the investigated shared-fixture, cleanup-leak and common-directory-collision hypotheses.
- [x] Root cause is classified as external worker/process contention under default global Vitest parallelism, causing real Git/SQLite work to exceed Vitest's default 5 s test timeout. No production code, test timeout, parallelism setting or test assertion was changed, and no test was disabled.
- [x] Required validation for the Projects investigation remains isolated/serial-target green; the broad worker/SQLite result remains an environmental blocker, not a release approval. The Skills Fatia 2 extraction below did not change that environment.

## Maintenance — Skills intelligence slice extracted (2026-11-06)

- [x] Extracted only `skills:usage` and `skills:recommend` into `apps/desktop/src/main/handlers/skills-intelligence.ts`; legacy install/update, transactional install, Skill Studio, MCP, Neura, Velix and external integrations were not moved.
- [x] Preserved channel names, payloads, return shapes, `registerIpcHandler` validation and trusted-sender checks. `main/index.ts` remains the composition root and still constructs the Discovery/Recommendation engine and Brain/RAG/Git/project-profile providers.
- [x] Injected `databaseHandle`, `skillUsageAnalytics`, the deterministic recommendation engine/catalog, preferences and a read-only project-intelligence callback. Optional project intelligence failures fall back to local recommendation; usage database failures return a redacted unavailable error.
- [x] TDD RED was observed before implementation because `handlers/skills-intelligence.ts` did not exist. Focused IPC/catalog tests passed 18/18, including no-history/history usage, no-project/project recommendation, incompatible skills, prompt-injection content, invalid payload, untrusted sender, database failure, fallback and absence of raw/sensitive fields.
- [x] Skills service regressions passed 32/32 across Discovery, Recommendation, Intelligence and usage analytics. Skills E2E passed 2/2 through the real preload: isolated catalog and usage/recommendation journey.
- [x] `npm run typecheck`, `npm run lint` and `npm run build` passed. The new IPC handler adds one focused test file and nine tests; no renderer or preload file changed.
- [ ] `npx vitest run --no-file-parallelism` reached 222/224 files and 1,741/1,743 tests in two complete runs. The failures varied between Projects/database temporal tests and unrelated workflow/Velix tests; Projects 29/29 and database 12/12 passed in isolated runs. This is the already documented worker/SQLite contention blocker; no timeout, parallelism reduction or test suppression was used.
- [x] No Task 3/Fatia 3 work was started. The next step is independent review of this extraction after the environmental serial gate is available again.

## Maintenance — Extensions IPC output hardening (2026-11-06)

- [x] Replaced the seven Extensions IPC output contracts that used `z.unknown()` with shared strict schemas: `installedExtensionSchema` for list/install/enable/disable/update/rollback and `extensionUninstallResultSchema` for uninstall.
- [x] Hardened manifests with strict nested objects, bounded signature values and relative entrypoint paths; persisted state accepts the optional `previousManifest` required by rollback and rejects incomplete timestamps or invalid states.
- [x] Reused the shared schemas from `packages/shared/src/extensions.ts` in `packages/shared/src/ipc.ts`; no renderer-side schema duplication or channel rename was introduced.
- [x] The extracted handler validates each dependency result through the shared IPC parser and converts malformed state failures to `invalid: estado da extensão inválido.` without echoing secrets; dependency errors and trusted-sender validation remain unchanged.
- [x] Added tests for valid lifecycle responses, unknown fields, malformed state, secret-bearing fields, unsafe paths, corrupt persisted state, uninstall output and `previousManifest` compatibility.
- [x] Focused hardening regression passed 59/59; E2E Extensions passed 3/3; typecheck, lint, build, `verify:dist` and `git diff --check` passed.
- [x] Full `npm test -- --no-file-parallelism` reached 220/221 files and 1,722/1,723 tests; the only failure was the existing concurrent Projects Commit/Stage assertion, and its serial rerun passed 1/1. No Extensions test failed.
- [x] No new `main/index.ts` extraction was started. Neura/Velix package manifests remain compatible with the stricter relative-entrypoint contract.

## Maintenance — Extensions lifecycle hardening (2026-11-06)

- [x] TDD reproduced three lifecycle gaps before the fix: SQLite reload discarded `previousManifest`, nested local entrypoints were rejected on Windows because `relative()` returned `\\`, and rollback changed registry metadata without reactivating the prior version.
- [x] The registry now validates and hydrates persisted manifests/state/previous version; directory ingestion normalizes separators before path validation; rollback verifies the staged prior version and calls the activation seam before swapping persisted state.
- [x] No migration, renderer/preload contract, Neura/Velix implementation, user-data directory or historical file was deleted or rewritten.
- [x] Focused extension regression after the fix: shared/orchestrator/database/IPC tests **38/38**; the existing Extensions E2E remains **3/3**. A legacy Velix E2E compatibility probe was also run; the Neura probe passed **1/1**, while the Velix probe timed out before navigation because the pre-existing Task 3.1 route guard hides Velix when no extension record exists. No renderer change was made in this Task 2.4 slice; this remains a separate compatibility follow-up.

## Maintenance — Git write queue concurrency repair (2026-11-06)

- [x] Reproduced the intermittent failure before editing: `apps/desktop/test/projects.test.ts` passed 5/5 in default mode, but `--no-file-parallelism` failed on the fifth run at line 187 after 28 tests passed; the later `stage` had won the queue and the expected commit `HEAD` did not exist.
- [x] Root cause confirmed in `protectedWrite`: each concurrent write awaited `git rev-parse --git-common-dir` before registering in the `commonDir` queue, so admission order could differ from invocation order. No temp-directory collision, shared test handle, mock, timer, environment, port or cross-file worker race was involved.
- [x] Reserved per-root arrival order before the first await, while retaining `commonDir` serialization for linked worktrees and existing authorization/fingerprint checks. No Git data, migration, history or user file is deleted or rewritten by the queue repair.
- [x] Validation after the fix: the target test passed 1/1; the full Projects file passed 5/5 default and 5/5 `--no-file-parallelism`; global Vitest passed 221/221 files and 1,723/1,723 tests; `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:dist`, and Git write E2E passed (16/16).
- [x] No Extensions source or contract was changed in this slice, and no Phase 3 or additional `main/index.ts` extraction was started.

## Enterprise consolidation — Task 5.1 primary journey (2026-11-05)

- [x] Added `tests/e2e/primary-journey.spec.ts` against the packaged Electron executable, with an isolated disposable Git fixture and fake Claude/Codex availability.
- [x] Packaged E2E passed 13/13: request/approval/execution/validation/evidence/learning, Core with no extensions, cancellation 3/3, restart/resume with persisted state and redaction 3/3, provider failure without duplicate effects 3/3, provider timeout classification 3/3, and diagnostics export redaction.
- [x] `docs/release/homologation-matrix.md` records commands, evidence and boundaries; no automatic commit or real secret is used.
- [x] Task 5.1 automated acceptance criteria are validated. Task 5.2 is in progress with the safe local/simulated matrix below.
- [x] Renderer state coverage remains green: packaged Chat E2E 7/7 covers loading/streaming, error/degraded extension, approval, success, cancellation and recovery/history.
- [ ] Real Claude/Codex authentication, supported Windows profiles, signed installer, updater, TFS/Azure DevOps and real permission homologation remain external gates; existing Phase 4.1 blockers are unchanged.

## Enterprise consolidation — Tasks 4.3/4.4 (2026-11-05)

- [x] Task 4.3: `collectDiagnostics` provides local database, migration, disk, CLI, credential-presence, FFmpeg and VoiceStudio checks with actionable remediation and telemetry disabled.
- [x] Task 4.4: local extension distribution is documented; updates write to isolated staging before activation, preserve rollback metadata, and reject traversal/symlinks/incompatible or invalid packages.
- [x] Validation: focused diagnostics/extensions tests 10/10, global Vitest 218/218 files and 1704/1704 tests, typecheck, lint, Electron build, relevant E2E 3/3 and diff-check passed; staging is covered by the extension suite.
- [ ] Remote HTTPS extension registry, asymmetric publisher trust and automatic update remain intentionally disabled pending release design.

## Enterprise consolidation — Task 4.2 Security and privacy review (2026-11-05)

- [x] Added `docs/security/threat-model.md`, covering renderer, main, preload/IPC, agents, MCP, repositories, RAG, Neura/Velix, TFS/Azure DevOps, provider integrations, subprocesses, logs, diagnostics, snapshots, diffs and artifacts.
- [x] Confirmed existing typed IPC sender/payload/output validation, read-only execution boundaries, secret redaction, encrypted main-process credential stores, path-root checks, browser permission restrictions and degraded database recovery.
- [x] Hardened local extension import to reject source directories and files that are symlinks/junctions before reading outside content.
- [x] Security-directed tests: extension integrity/path traversal/symlink, diagnostics secret corpus, project path/symlink, MCP redaction, agent redaction and read-only seams passed; targeted 67/67 and relevant E2E 6/6.
- [x] Global validation (2026-11-05): Vitest serial 218 files / 1704 tests, typecheck, lint, Electron build and `git diff --check` passed. Tasks 4.2–4.4 are validated.
- [ ] Task 4.1 external blockers remain unchanged: Authenticode certificate/signtool, auto-update, and a valid previous installer.

## Enterprise consolidation baseline (2026-11-05)

- [x] Baseline and artifact inventory recorded in `docs/architecture/enterprise-baseline.md`.
- [x] Product slices and acceptance owners recorded in `docs/superpowers/specs/2026-11-05-neuralbridge-enterprise-consolidation.md`.
- [x] Shared execution snapshot/evidence contracts added with additive migration `0087_execution_evidence`.
- [x] TaskEngine persists lifecycle snapshots/evidence and desktop commands now cross `TaskApplicationService`.
- [x] Database degraded mode now reports an actionable recovery path (`retry`, backup restore, permissions, or diagnostics) to the renderer.
- [x] Task snapshots classify terminal failures into timeout/provider/database/filesystem/permission/configuration and select retry vs. manual review.
- [x] Engine recovery materializes snapshots for legacy tasks created before migration `0087`; `engine.test.ts` 51/51 now asserts the persisted recovery state.
- [x] Evidence persistence extracted into `packages/orchestrator/src/evidence-service.ts`; TaskEngine remains the sole coordinator.
- [x] Task 2.4 extension core: versioned manifest, checksum/signature/Core compatibility checks, local `extension.json` directory install into isolated `id/version` staging, registry install/update/disable/enable/rollback seam, and additive SQLite persistence (`0090`/`0091`) added; Neura/Velix remain on their existing routes during transition.
- [x] Task 2.4 focused validation: shared/orchestrator/database extension and IPC tests 49/49; initial TDD red runs recorded missing-module and missing-local-install failures before implementation.
- [x] Task 2.4 IPC/preload and Electron E2E: typed `extensions:*` channels expose list/install/enable/disable/update/rollback; `tests/e2e/extensions.spec.ts` passed 1/1 through the preload seam after build.
- [x] Task 2.4 separation slice: `packages/extensions-neura` and `packages/extensions-velix` now ship independent versioned manifests and adapter entrypoints that consume stable shared contracts; existing Neura/Velix implementations remain compatible and are not moved destructively.
- [x] Task 2.4 integrity policy: the desktop adapter accepts only manifests whose declared SHA-256 signature value matches the verified package checksum; asymmetric key distribution remains a release/distribution concern, not silently implied by local development manifests.
- [x] Regressão global após IPC de Extensions: `npm test -- --no-file-parallelism` passou 214 arquivos / 1694 testes em 221,81 s.
- [x] Regressão global anterior ao IPC final: 214 arquivos / 1689 testes em 221,58 s; superseded by the 1694-test run above.
- [x] Task 3.1 assumida nesta rodada: a UI de Extensions foi criada sobre o IPC existente; a Task 3.2 permanece não iniciada.
- [x] Task 3.1 navigation slice: `AppShell` now groups routes under Trabalho, Conhecimento, Integrações and Configurações; `/extensions` manages the existing IPC seam; `/video` remains a compatible deep link but is hidden/guarded unless Velix is enabled.
- [x] Task 3.1 validation: route/IPC/extension tests 38/38, navigation E2E 4/4 at 800/1024/1280 px plus deep links, extension E2E 1/1, typecheck, lint, build and diff-check approved.
- [x] Task 3.2 core primitive: `FeedbackState` covers loading, empty, error, success, offline/degraded, approval pending, execution progress and cancelled states with explicit actions, semantic announcements and reduced-motion support; `DatabaseBanner` reuses `OfflineState`.
- [x] Task 3.2 adoption: Extensions, Execuções and Projetos now use the shared loading/empty/error/success states; Chat/TaskCard and Velix retain their existing domain-specific approval/progress controls for compatibility.
- [x] Task 3.2 validation: primitives 3/3; Chat E2E 7/7 (approval, execution, success, cancellation and Velix-disabled deep link); database degraded-mode E2E 2/2; extensions E2E 1/1; navigation/viewports E2E 4/4 at 800/1024/1280 px; typecheck, lint, build and diff-check passed.
- [x] Task 3.2 CONCLUÍDA. Task 3.3 permanece não iniciada.
- [x] Task 3.3 slice: Brain Graph, Brain 3D, Analytics and Velix are lazy-loaded; heavy route chunks are emitted separately. Execuções now uses `VirtualList` with overscan and preserved list semantics.
- [x] Task 3.3 slice: Workflows template collections now use the same virtual list with keyboard-accessible controls preserved.
- [x] Task 3.3 slice: installed Velix video collections now use `VirtualList`; Git commit history already had bounded windowing and remains unchanged.
- [x] Task 3.3 validation so far: virtual range unit test 1/1, performance E2E 1/1 with startup <10s and lazy-route transition <3s, desktop typecheck, lint, Electron build, diff-check and Chat/navigation E2E 11/11 including 800/1024/1280 px passed.
- [x] Task 3.3 performance budget recorded in `docs/performance/task-3.3-budgets.md`; Memory remains bounded by a 20-result query, Git by its existing graph window, and Azure/TFS by expandable variable-height rows rather than unsafe fixed-height virtualization.
- [x] Task 3.3 CONCLUÍDA. Task 3.4 is the remaining part of Task 3.
- [x] Task 3.4 slice: Dashboard now presents a dismissible first-success guide for project selection, agent verification and first Chat task; the copy explains local-first privacy and approval boundaries.
- [x] Task 3.4 validation: onboarding E2E 2/2 covers dismissal and Dashboard → Chat → completed read-only task; database recovery E2E 2/2 covers degraded startup; existing Chat E2E covers approval/result; typecheck, lint and build passed.
- [x] Task 3.4 CONCLUÍDA. Task 3 (3.1–3.4) is complete; no Task 4 work was started.
- [x] `evidence-service.test.ts` verifies redaction, database persistence and snapshot linkage against a real migrated SQLite database.
- [x] Integration ownership map recorded in `docs/architecture/integration-ownership.md`.
- [x] Full `npm run typecheck` passou em todos os pacotes, testes e desktop (2026-11-05).
- [x] `npm run lint` e `npm run build` passaram; E2E `tests/e2e/database.spec.ts` passou 2/2 com timeout de 60s (a primeira execução em 30s oscilou no worker teardown; corrupção passou em ambas).
- [x] Auditoria estática por identificador `IpcChannel.<nome>` não encontrou canais declarados sem referências em `apps`, `packages` ou `tests`; nenhuma remoção foi autorizada.
- [x] Suíte Vitest completa executada em série após alinhar o fixture de `azure-devops-client.test.ts` com o contrato atual (`attachments: []`); o gate global ficou verde.
- [x] Auditoria de aceite conservadora registrada em `docs/architecture/enterprise-acceptance.md`; objetivo permanece aberto enquanto houver gate pendente.
- [x] Lint/build/E2E matrix executada sobre o worktree existente: lint, build e E2E de banco aprovados.
- [ ] Real-provider and TFS write homologation: external, approval-gated.

## Continuação após limite do Claude — derivados Velix (2026-11-04)

- [x] Migrações 0080/0081, repositório, `DerivativeService`, scoring determinístico, cópia de claims/evidências/decisões, produção filha, herança de narração, identidade do canal e origem no manifesto já presentes no workspace.
- [x] Wiring adicional concluído nesta rodada: canais IPC tipados, preload, handlers do processo principal para gerar/decidir/criar/renderizar/exportar em lote e painel de revisão na produção.
- [x] Integração real do serviço validada com FFmpeg em `packages/orchestrator/test/velix-derivatives.test.ts`: 1/1 passou, cobrindo geração/aprovação, criação da filha 9:16, render/export, duração, herança de narração sem nova síntese, manifesto de origem e claims com evidência.
- [x] E2E Electron de narração/sincronização passou 1/1 após alinhar a expectativa à regra vigente: dividir uma cena já medida corta o áudio existente e mantém `timing: measured` com `source: edit`; o estado sobrevive ao reinício.
- [x] `npm run typecheck` aprovado; Vitest direcionado shared/orchestrator/database: 3 arquivos, 15 testes aprovados em série.
- [x] ESLint dos arquivos tocados aprovado e E2E Electron `velix-production-runs.spec.ts --grep "produção persistida"` passou 1/1 após o wiring.
- [x] E2E Electron completo dos derivados passou 1/1 com Remotion/FFmpeg reais: gerar sugestões, aprovar, criar filha 9:16, renderizar, reabrir a produção pai, exportar e confirmar o estado persistido. O wiring principal também conecta a narração herdada e a origem ao `RenderService`.
- [x] Verificação de retomada (2026-11-05): `npm run typecheck` passou globalmente; Vitest direcionado `velix-derivatives` + `database` passou 15/15 em série; E2E `velix-production-narration.spec.ts -g "render real"` passou 1/1; ESLint dos arquivos da Fase H passou. Corrigido também um acesso potencialmente indefinido no parser de `content-disposition` do cliente TFS, que bloqueava o typecheck global.
- [ ] Restante externo: homologar uma escrita real no TFS com PAT de menor privilégio ou Windows Authentication, sempre após confirmação nativa; não é executado automaticamente.

## Fase 49 — início da fundação TFS/Azure DevOps (2026-11-04)

Escopo confirmado: integração compartilhada por Claude e Codex para preparar User Stories/tasks, revisar PRs e apoiar o trabalho diário no TFS. A fundação atual permanece read-only; escritas exigirão aprovação nativa e auditoria.

- [x] MCP compartilhado agora expõe `azure_devops_cached` para Claude e Codex consultarem o cache TFS read-only gerado pela aba Azure/TFS, com aviso de conteúdo não confiável e sem credenciais/escritas; suíte MCP 15/15 e typecheck aprovados.
- [x] MCP também expõe `azure_devops_draft_user_story` e `azure_devops_draft_task`: Claude/Codex podem preparar rascunhos com critérios de aceite, sem publicar no TFS; conteúdo com aparência de credencial é recusado. Suíte MCP 16/16 e ESLint aprovados.
- [x] MCP `azure_devops_review_pr` reúne detalhe, threads e arquivos alterados cacheados para revisão por Claude/Codex, explicitando que escritas exigem aprovação; suíte MCP 17/17 e typecheck aprovados.
- [x] MCP `azure_devops_connections` lista somente metadados seguros das conexões configuradas, permitindo que Claude/Codex descubram o `connection_id` sem credenciais; suíte MCP 18/18 e ESLint aprovados.
- [x] Cliente REST TFS aceita `AbortSignal` e o propaga em todas as leituras, com teste de cancelamento; cliente TFS 7/7 e typecheck aprovados.
- [x] Paginação read-only adicionada para coleções de projetos, boards, PRs e iterações usando `x-ms-continuationtoken`/`x-ms-continuation-token`; teste direcionado 8/8, suíte MCP + cliente 26/26 e typecheck aprovado.

- [x] Contratos compartilhados em `packages/shared/src/azure-devops.ts` e cliente REST read-only em `packages/orchestrator/src/integrations/azure-devops-client.ts`, com parsing tolerante, capacidades e tradução de 401/403/404.
- [x] Migrações 0082–0085 separadas em uma instrução SQL por arquivo, repositório de conexão/cache exportado e testes de banco + cliente: 2 arquivos, 15 testes aprovados; typecheck global e ESLint dos arquivos novos aprovados.
- [x] Spike read-only executado em 2026-11-04 na sessão autenticada do usuário: TFS `tfs.hepta.com.br/tfs/CONFEA`, projeto `Sistema Unificado`, repositório `backoffice`; a UI confirmou acesso à lista de PRs e aos Boards/Sprints, com sprint `2026-NOV-01` (26/10–06/11). Nenhuma ação de escrita foi executada.
- [x] IPC/preload read-only adicionado para salvar conexão, consultar status, testar capacidades, listar projetos e listar PRs; typecheck global, ESLint direcionado, banco/cliente 15/15 e `git diff --check` aprovados.
- [x] Área visual registrada em Configurações, incluindo o botão "Abrir TFS para login"; a autenticação HTTP Basic ainda é concluída no navegador externo e a validação contra o host corporativo continua pendente.
- [x] Aba principal "Azure / TFS" adicionada ao grupo Conexões, reutilizando a configuração e o painel read-only de Boards/arquivos da PR; E2E da rota dedicada passou 1/1.
- [x] UI inicial adicionada em Configurações: URL/collection/projeto, salvar conexão, testar capacidades, listar projetos e PRs; modo somente leitura e aviso de que a senha não é armazenada. Typecheck e ESLint da UI aprovados.
- [x] Tasks/work items e iterações/sprint adicionados ao cliente, IPC e UI, com cache local read-only; typecheck global e lint direcionado aprovados.
- [x] Boards adicionados ao contrato, cliente REST, IPC/preload, cache read-only e painel visual separado em Configurações; cliente TFS 6/6, build e typecheck aprovados.
- [x] Detalhe de PR, arquivos alterados e threads/comentários adicionados ao cliente, IPC e UI; leitura permanece sanitizada e sem ações de escrita. Typecheck, 6 testes do cliente e lint direcionado aprovados.
- [x] E2E `tests/e2e/azure-devops.spec.ts` passou 2/2 contra servidor TFS falso: salvar conexão, probe de capacidades, projetos, boards, PR, detalhe/threads, arquivos alterados, tasks, sprint e escrita aprovada. O teste exige rebuild do desktop antes da execução.
- [x] E2E local de escrita TFS passou 1/1 contra servidor falso: o comentário é preparado sem POST, a confirmação nativa é interceptada apenas no teste, e o POST tipado só ocorre depois de `Subir/Publicar`; nenhuma credencial real é usada.
- [x] Revisão UX do Azure/TFS (2026-11-04): a rota `/azure-devops` deixou de ser um formulário corrido e passou a ter workspace operacional com status visível, projetos carregados automaticamente, navegação Pull Requests/Boards/Sprints/Tasks, identificação de repositório persistida e revisão de PR com detalhe, threads e arquivos alterados. Configuração avançada fica recolhida; escrita continua na área segura de Configurações. Typecheck, lint, build e E2E TFS 2/2 aprovados.
- [x] IPC seguro `azureDevOpsOpenBrowser` abre a origem confinada no navegador do sistema para o usuário concluir o HTTP Basic sem o Neura receber a senha; typecheck, lint e diff-check aprovados. A sessão corporativa foi confirmada separadamente no navegador; a senha não foi capturada pelo Neura.
- [x] Escopo de escrita confirmado pelo usuário: preparar comentário/aprovação/status/US/Task primeiro e executar somente após clique explícito em **Subir/Publicar**; o gate nativo foi implementado no processo principal e nunca aceita aprovação enviada apenas pelo renderer.
- [x] Primeira camada do transporte de escrita implementada no cliente: comentário de PR, status de PR, criação de User Story/Task e atualização de estado de work item; conexões read-only rejeitam gravações no cliente. Testes direcionados 10/10 e typecheck completo aprovados.
- [x] UI de escrita adicionada à área TFS: checkbox explícito para habilitar escrita, preparo de comentário da PR e botão `Subir/Publicar` somente após rascunho; ESLint do componente e typecheck completo aprovados. A confirmação continua nativa no processo principal.
- [x] Card de escrita ampliado para preparar comentário, status de PR, criação de Task/User Story e atualização de estado de work item; todas as ações reutilizam o mesmo rascunho, confirmação nativa e cliente PAT, sem failover ou envio automático. Typecheck, build e E2E local de comentário aprovados.
- [x] Compatibilidade de autenticação validada na documentação Microsoft: OAuth/OIDC do Azure DevOps é para Services, não para Azure DevOps Server; para o TFS corporativo, PAT/Windows Authentication são os caminhos compatíveis. Implementado fallback PAT por conexão em `azure-devops-credentials.bin`, cifrado por `safeStorage`, com header criado somente no main process, IPC de salvar/remover/status e campo de token nunca retornado ao renderer. Testes cliente/store 12/12, ESLint e typecheck aprovados.
- [x] Gates pós-PAT (2026-11-04): E2E TFS read-only 1/1, E2E Velix narração/sincronização 1/1, Vitest cliente/credencial/derivados 13/13, build Electron aprovado.
- [x] Verificação da distribuição (2026-11-04): `npm run verify:dist` passou para `dist/NeuralBridge-Setup-0.1.58-x64.exe`.
- [ ] Homologação restante: o usuário precisa fornecer um PAT de menor privilégio (ou confirmar Windows Authentication) e executar uma operação real de escrita após a confirmação nativa. O login HTTP Basic no Chrome continua read-only e não é compartilhado automaticamente com o Electron.


## Fase 48 — Velix Estilos: escolher o estilo de cada vídeo (2026-11-03)

- [x] Provedor da produção (2026-11-04): seletor global Claude/Codex no card de limites persistido em `preferences.json`; novas produções capturam o provedor no momento da criação e o exibem no estado da produção. O campo `agent` é nullable para compatibilidade e linhas antigas usam fallback determinístico para `claude`; roteiro/pesquisa usam o provedor registrado também após reabertura, sem failover automático. A seleção de estilo permanece independente. Typecheck, lint direcionado, suíte direcionada 39/39, regressão estilo/render 21/21 e E2E de reinício 1/1 aprovados.

- [x] 48.1 concluída (2026-11-03): registro de estilos, escolha validada, cena comum, resolvedor com o Dossiê idêntico, migração `0060_velix_video_styles`, repositório e IPC. Testes novos verdes, Playwright de vídeo 35/35, typecheck, lint e Vitest em série 1.581/1.582.
- [ ] Observado: `git-write.test.ts › reports pending local commits…` estourou 5 s sob carga na suíte em série; passou 2/2 isolado; arquivo não alterado.
- [x] 48.2 concluída (2026-11-03): galeria com recomendação e prévia por estilo no Novo vídeo, no Produzir e no Estúdio; estilo por vídeo (0060 ajustada antes do lançamento); prévia e render do Estúdio respeitam o estilo. E2E de vídeo 37 passaram (3 pulados), Vitest em série 1.583/1.583, lint e typecheck.
- [x] 48.3 parte A (2026-11-03): Explicativo animado e Tipografia cinética como estilos de vídeo; 4 vinhetas registradas para a mistura; adaptadores com escape e duração igual ao roteiro; render real conferido pelo FFprobe (14,0 s = roteiro). Suíte de vídeo 18/18, Vitest 1.590/1.590, lint e typecheck. Corrigido o kit falso do E2E, que tinha feito o teste do Render direto falhar.
- [x] 48.3 parte B concluída (2026-11-03): cinco camadas sobre vídeo gravado (legenda premium, legenda infantil, sobreposição para quem fala, podcast e texto gigante) recebem vídeo base autorizado e palavras cronometradas; texto é escapado/removido conforme o mecanismo do kit; o render gera camada transparente com `--alpha` e compõe por FFmpeg sobre o vídeo vertical, preservando áudio e duração do base, inclusive nas prévias. Testes direcionados 43/43, typecheck completo e lint dos arquivos tocados aprovados; a expectativa obsoleta de vinheta foi atualizada.
- [x] 48.4 concluída (2026-11-04): além da integração Remotion, Base/Editorial/One take têm tokens visuais distintos; One take aplica câmera determinística por frame e fades contínuos. Oito presets foram renderizados em MP4 e confirmados por FFprobe; quadros e E2E Motion 8/8 aprovados.
- [x] 48.5 concluída (2026-11-04): seis estilos locais do Lemo-opuscar com licença MIT, hash upstream `bebbbe1aa92a3cb4bb6f83500e61b23a17d1aa00`, sem CLI/download/rede em runtime; seis renders reais confirmados pelo FFprobe e auditoria estática do port sem rede/shell.
- [x] 48.6 fundação (2026-11-03): contrato `StyleTreatment` e primeiro tratamento `colagem-jornal` no Dossiê; `planStyleMix` agrupa cenas vizinhas, propaga tratamentos, emite transições de ponte e recusa tratamento incompatível, vídeo base ausente ou mais de três estilos antes do render. O Estúdio agora persiste e recupera exceções de estilo/tratamento por cena, com seletores acessíveis, timeline visual por cena e prévia real do segmento escolhido; a colagem do Dossiê entra no compositor Remotion com preset visual próprio; misturas Remotion e kit por cena são renderizadas em segmentos, normalizadas sem áudio, concatenadas pelo FFmpeg e recebem narração contínua. Testes shared 6/6 + resolvedor 3/3 + fronteira kit 2/2, typecheck, lint, `build:motion` e diff-check aprovados; E2E híbrido pela aplicação 1/1 com FFprobe.
- [x] 48.6 segurança da mistura (2026-11-04): teste do resolvedor garante que um estilo kit é recusado antes de iniciar FFmpeg quando aparece numa mistura Remotion, em vez de gerar um vídeo com motor incompatível. Teste 1/1 e typecheck completo aprovados.
- [x] 48.7 fundação (2026-11-04): Livro ilustrado e Tinta e aquarela entram como presets Remotion locais, determinísticos, sem `canvas` nativo, download ou provedor externo; o bundle usa papel/grão e manchas de aquarela calculados no frame. Testes do adaptador 3/3, dois renders reais de 2,0 s com vídeo válido pelo FFprobe, quadros revisados, typecheck/lint e E2E Motion 8/8 aprovados. Revisão de segurança registrada em `packages/shared/assets/drawn/PORT.md`.
- [x] Validação Motion real (2026-11-04): navegador Remotion instalado pelo instalador local em `.motion-runtime`; `build:motion` passou; E2E `tests/e2e/velix-motion.spec.ts` passou 8/8 com `NB_MOTION=1` e `NB_MOTION_BROWSER`, incluindo render real e FFprobe.
- [x] 48.9 matriz inicial (2026-11-04): oito presets do mesmo roteiro renderizados em MP4 (1,5 s cada) e confirmados pelo FFprobe; E2E de galeria/Estúdio 1/1; E2E Motion 8/8; larguras 960/1024/1440 e movimento reduzido cobertos.
- [x] 48.8 concluída (2026-11-04): contrato `velix-collage`, provedor fake e adaptador Gemini, máquina de duas aprovações, migração `0061_velix_collage`, repositório persistente, `CollageSecretStore` cifrado por `safeStorage`, IPC/preload, painel no Estúdio, QA por FFprobe, registro no Rights Manager e inserção de B-roll na mistura. Testes direcionados 12/12, provider Gemini 1/1, mistura com B-roll 3/3 e E2E fake com MP4 válido 1/1; typecheck, build e diff-check aprovados. Sem chave Gemini a função permanece indisponível.
- [x] One take (2026-11-04): preset agora aplica câmera determinística por frame (escala e deslocamento suaves) e transições fade contínuas, sem aleatoriedade; adaptador 3/3, bundle Motion e typecheck aprovados.
- [x] Mistura híbrida real (2026-11-04): `velix-style-mix.test.ts` gerou um MP4 kit válido, renderizou o segundo segmento no Remotion instalado, concatenou os dois pelo FFmpeg e confirmou o resultado com duração acima de 3,5 s; 3/3 testes da mistura passaram com browser real.
- [x] E2E híbrido pela aplicação (2026-11-04): `tests/e2e/video.spec.ts` persistiu estilo por cena no Estúdio, renderizou trecho kit + trecho Remotion, aguardou o job e confirmou o MP4 final pelo FFprobe; 1/1 passou.
- [x] Gates finais da Fase 48 (2026-11-04): `typecheck`, `build:motion`, `build`, `verify:dist`, lint direcionado, Vitest direcionado, E2E Motion 8/8, E2E híbrido 1/1, E2E colagem 1/1 e `git diff --check` aprovados.
- [x] Auditoria corrigida (2026-11-04): o Estúdio usa `videoStudioRender` com o estilo persistido; `velix-base` e `velix-editorial` têm tratamentos visuais distintos; os seis modelos portados da MotionVelix estão registrados em `video-styles.ts` e aparecem na galeria. A cobertura visual e E2E está registrada nos itens 48.3–48.9 abaixo.
- [x] Licenças verificadas: One take (PolyForm Noncommercial), Colagem B-roll (MIT, exige Gemini pago), Claude animation (MIT, alerta de segurança no catálogo), Lemo-opuscar (MIT, baixa e se autoatualiza em tempo de execução — só cópia fixa).
- [x] Decisão do usuário: NeuralBridge é de uso próprio e não comercial; o One take pode ser portado, marcado como não comercial.
- [x] Decisão do usuário: trazer o Lemo-opuscar e o One take para o app (2026-11-03).
- [x] Decisão do usuário: mistura de estilos entra no plano (subfase 48.6: estilo por cena e tratamentos, primeiro a Colagem de jornal no Dossiê).
- [x] Decisão do usuário: primeiro lote do Lemo-opuscar = Swiss Motion Graphics, Whiteboard Explainer, Data Storytelling, Dark Tech Keynote, Caption News e Halftone Dossier.
- [x] Decisões fechadas com as recomendações (2026-11-03): estilo escolhido no começo da criação com troca no Estúdio; colagem paga depois; animação desenhada no Chromium sem `canvas` nativo; 9:16 depois.

## Fase 47 — Velix Canal: ID visual, YouTube, agenda e otimizador (2026-11-03)

- [ ] Em execução. Contratos `velix-channel.ts`, migrações aditivas `0057`/`0058`/`0059`, núcleo PKCE/loopback genérico, `VelixChannelRepository`, OAuth seguro e cliente REST YouTube tipado implementados; importação, conexão, perfil, identidade visual e jobs assíncronos de publicação já passam por IPC/preload/UI. O cliente continua múltiplos PUTs após `308`, emite checkpoints e valida `Content-Range`; o caminho assíncrono cifra sessão com `safeStorage`, persiste offset e o IPC/preload reanexa jobs pausados após reinício. Jornada fake do cliente oficial passou (sessão, retomada, thumbnail, vídeos próprios e reagendamento), além de 22/22 testes direcionados, typecheck desktop e diff-check. A matriz Motion E2E passou 8/8; E2E desktop e homologação real privada já foram executados. Auditoria oficial da API concluída em 2026-11-04.
- [x] Decisões confirmadas: REST com `fetch`, `client_secret.json` do usuário, escopos incrementais, peças em Remotion e Analytics posterior.
- [x] Auditoria da API oficial concluída (2026-11-04): `videos.insert` usa `POST https://www.googleapis.com/upload/youtube/v3/videos` e escopo `youtube`/`youtube.upload`; `videos.update` e `channels.update` usam `PUT https://www.googleapis.com/youtube/v3/...` e aceitam `youtube`; `channelBanners.insert`, `thumbnails.set` e `watermarks.set` usam o host de upload. Custos conferidos: upload de vídeo 1 por chamada no bucket próprio (100/dia), `channels.update`/`videos.update`/artes 50 unidades. Implementação mantém esses hosts e escopo; não houve chamada de escrita real nesta auditoria.
- [x] Referência funcional validada fora do app: a skill MotionVelix v2.8.0 conectou o canal real NextWorth por OAuth, sincronizou a agenda e gerou a referência de nicho "AI money" (50 vídeos). 31 testes passaram.
- [x] Correção de homologação OAuth: o callback `localhost` aceita o redirect usado pelo Google e o cliente REST aceita metadados oficiais adicionais (`kind`, `etag`, `pageInfo`) sem relaxar os campos de domínio; teste direcionado YouTube 8/8 e typecheck global aprovados. Debug reconectado até a página `NeuralBridge conectado`; a validação real do perfil segue após reiniciar com este build.

- [x] Rodada Claude (2026-11-03): aprovação de escrita no canal movida para o main (`ChannelApprovalGate`, diálogo nativo por execução, auditoria sem títulos/tokens); escopo incremental `youtube` com botão "Permitir envio e edição" e `canWrite` no status; renovação automática do access token (`oauth/channel-token.ts`). Testes desktop channel-approval 3/3 e channel-token 5/5, Vitest direcionado 79 arquivos/534 testes, lint dos arquivos tocados e typecheck completo aprovados.
- [x] 47.8 E2E desktop com YouTube falso: `tests/e2e/velix-channel.spec.ts` passou 3/3 (conexão PKCE, escopo incremental, identidade, branding e envio agendado recusados e depois aprovados no diálogo nativo, upload retomado após 308, thumbnail, reagendamento, reinício e varredura de segredos na pasta de dados).
- [x] Defeitos corrigidos pela jornada: upload e thumbnail agora usam `/upload/youtube/v3`; `308 Resume Incomplete` lido com `redirect: 'manual'` (com `'error'` o `fetch` do Node aborta); `Authorization` no `PUT` da sessão; sessão aceita só na origem do endpoint de upload; "Reagendar" sem `window.prompt`, que o Electron não implementa.
- [x] 47.8 falhas no E2E: cota, rede caída, cancelamento e desconectar com/sem revogação confirmada; `velix-channel.spec.ts` 6/6 em 3 repetições. Erros da API traduzidos por código de motivo; desconectar funciona offline e revoga o refresh token (URL de revogação sobrescrevível só fora do app empacotado).
- [ ] Observado: `workflow-runner.test.ts › never times out while waiting for a person` falhou uma vez sob carga paralela e passou 3/3 isolado e na suíte em série; arquivo não alterado nesta rodada.
- [x] Instalador 0.1.58 (2026-11-03): versão patch inédita; antes do empacotamento, lint completo, Vitest em série 178 arquivos/1.556 testes, typecheck e E2E Canal 6/6 e Motion 8/8; `npm run build:motion`, `npm run dist:win` e `npm run verify:dist` aprovados para `dist/NeuralBridge-Setup-0.1.58-x64.exe` (bundle Motion e migração 0059 conferidos no `app.asar`). Sem assinatura de código.
- [x] Canal em sub-abas (Publicar vídeo, Calendário, Identidade visual, Configuração) com barras de progresso, prévias e "Salvar no PC" (MP4 do projeto e peças da identidade em PNG/SVG); upload em blocos com progresso real; skill do otimizador registrada. E2E Canal 6/6, Vitest 180/1.565, lint e typecheck aprovados.
- [x] Subir identidade: avaliação, revisão antes/depois e envio de banner e marca d'água com uma aprovação e progresso; E2E com YouTube falso cobre banner 2560×1440, marca d'água multipart e branding preservado.
- [x] Arte profissional: 9 direções da MotionVelix com composições próprias, fontes OFL embutidas, logo claro/escuro, gerador de thumbnail por vídeo; banner/thumbnail em JPEG para caber nos limites do YouTube. E2E Canal 6/6 (3×), Vitest 181/1.574, lint e typecheck.
- [x] Decisão do usuário: importação de arte própria não é necessária para o fechamento desta fase.
- [x] 47.8: homologação real com envio privado no canal do usuário.
- [x] Homologação real 47.8 executada em 2026-11-04 no canal `NextWorth`: o arquivo `neuralbridge-apresentacao-60s.mp4` foi enviado pelo YouTube Studio autenticado e confirmado como **Salvo como privado**; link de verificação: `https://youtu.be/2-gO7BD2JXU`.

## Fase 46 — Velix Motion: do roteiro ao vídeo (2026-11-03)
- [x] Rodada Claude (2026-11-03): 46.4 ligada à UI/IPC (`videoMotionSyncNarration`, botão "Sincronizar cenas e legendas com a voz", encadeamento das cenas pela voz, `lockedDuration` editável) e 46.2 com revisão por cena (aplicar todas/uma/descartar, trecho do roteiro visível). Workspace Motion 17/17, typecheck completo e Playwright Motion 8/8 com MP4/FFprobe real (`NB_MOTION=1`, headless shell 1248).

- [ ] Em execução. 46.1 implementada com upgrade v1→v2, 6 tipos, seletor, reordenação e duração em segundos; E2E Motion completo 8/8 aprovado, incluindo MP4 real e FFprobe com navegador Motion configurado. 46.2 ampliou o parser/schema para todos os tipos e trechos do roteiro, mantendo o TaskEngine read-only. 46.3 adicionou seleção segura do asset pronto pelo sidecar. 46.4 adicionou alinhamento de duração e geração de legendas por palavras temporizadas, com reporte de ausentes; testes direcionados, build Motion, typecheck completo e diff-check aprovados.
- [x] Decisões confirmadas: fontes OFL empacotadas, fotos locais/autorizadas, sem fundo em vídeo nesta fase e formato 16:9.
- [x] Narração Motion endurecida: o campo livre foi substituído por seletor de assets `ready` do sidecar do projeto, resolvidos pelo main e entregues por IPC/preload. Typecheck completo aprovado.
- [x] Linha do tempo Motion: visualização proporcional por cena, intervalos em segundos, tipo, duração e foco de teclado para o editor correspondente, reutilizando `motionTimeline`. Typecheck completo e diff-check aprovados.
- [x] Interação da timeline concluída: `PlayerRef.seekTo(from)` posiciona a prévia no início da cena selecionada; ref oficial do Remotion preserva eventos do Player. Typecheck completo aprovado.
- [x] Gate integrado desta rodada: Playwright Motion 8/8 em 18,1 s com MP4/FFprobe real; Vitest focado 8 arquivos/26 testes; typecheck completo e diff-check aprovados.
- [x] Gates de compilação desta rodada: `build:motion`, build Electron e ESLint passaram; typecheck completo e `git diff --check` também passaram após eliminar as asserções non-null dos arquivos tocados.
- [x] Gate global Vitest: 175 arquivos e 1.537 testes aprovados em série em 167,89 s; avisos de CRLF ficaram restritos às fixtures Git temporárias.
- [x] Distribuição: `npm run verify:dist` passou para `dist/NeuralBridge-Setup-0.1.57-x64.exe`.
- [ ] Achado da auditoria: o campo "Narração autorizada" do Motion aceita texto livre e falha com caminho absoluto; a 46.3 troca por um seletor de narrações do projeto.
- [ ] Pendências de fechamento: registro de direitos na importação, timeline/acessibilidade/matriz visual, gates globais/instalador e reabertura do projeto após reinício com áudio validada por FFprobe.
- [x] Correção desta rodada: sugestões `photo` não são mais rebaixadas silenciosamente para `card`; a saída usa o contrato v2, mantém o trecho do roteiro e exige seleção humana de asset autorizado. Testes Motion 5/5 e typecheck completo aprovados.
- [x] Correção desta rodada na publicação: validação compartilhada de metadados e janela mínima de agendamento, além de limite de 2 MB para thumbnail no executor assíncrono. Testes direcionados 2 arquivos/5 testes e typecheck completo aprovados.
- [x] Agenda incremental: publicações agendadas criam itens em `velix_agenda_items`; a aba Canal lista esses itens via IPC/preload após reabertura. Testes direcionados de contrato/repositório 2 arquivos/4 testes e typecheck completo aprovados.
- [x] UI de agenda: calendário mensal com navegação anterior/próximo, células por dia, estado e horário visíveis, além da lista persistida; typecheck completo e `git diff --check` aprovados.
- [x] Sincronização incremental: cliente REST consulta vídeos próprios e atualiza `status.publishAt`; a agenda mescla resultados remotos e a UI oferece reagendamento com confirmação. Teste do cliente YouTube 4/4 e typecheck completo aprovados.
- [x] Hardening do reagendamento: o handler confirma que o vídeo pertence ao canal conectado e está privado antes de chamar `videos.update`; vídeo público ou inexistente é recusado. Typecheck completo e `git diff --check` aprovados.
- [x] Otimizador — primeiro núcleo seguro em `packages/shared/src/velix-optimizer.ts`: pontua somente metadados fornecidos e gera três horários transparentes, sem agente nem dados inventados. Testes 2/2, typecheck completo e diff-check aprovados.
- [x] Integração do otimizador na aba Canal: notas e horários são recalculados localmente no rascunho, com aviso explícito de que não são garantia. Export do pacote compartilhado corrigido; typecheck completo aprovado.
- [x] Referência real do nicho: consulta YouTube explícita com custo de cota visível, títulos tratados como dados e persistência em `velix_niche_references`; teste do cliente 5/5 e typecheck completo aprovados.
- [x] Sugestões read-only: contrato estrito para cinco títulos, descrição e tags; resposta passa pelo TaskEngine e aparece apenas para revisão humana na aba Canal. Testes direcionados 2 arquivos/7 testes e typecheck completo aprovados.
- [x] Horários do otimizador corrigidos: conversão real de horário local para ISO UTC pelo timezone informado, com offset calculado pelo `Intl` e teste de conversão. Typecheck completo aprovado.
- [x] Paridade determinística ampliada: score cobre as regras documentadas de título, descrição e tags; suíte do otimizador agora 3/3, typecheck completo e diff-check aprovados.

## Fase 34 — Assistente pessoal independente de projeto (2026-11-02)

- [x] Correção incremental posterior: conversas internas da Neura agora são persistidas como `origin='neura'` pela migração aditiva `0056_task_origin` e ficam fora das listas de Chat/Execuções, sem perder a consulta direta por ID. As três permissões de áudio, tela e localização são independentes e usam o snapshot desejado completo para sobreviver a cliques rápidos.
- [x] Auditoria de layout: o shell não cria mais scroll global duplicado; o Chat mantém scroll apenas no histórico/painéis internos, e o Git Intelligence mantém scroll em Referências, grafo e Detalhes do commit. O primeiro item selecionado do grafo recebeu margem para não cortar a borda.
- [x] Evidência desta rodada: teste de três consentimentos **1/1** (também repetido **5/5**), Chat sem scroll de página **1/1**, Git Graph/refs/detalhes sem scroll de página **1/1**, Vitest direcionado **75/75** e suíte global **168 arquivos/1.476 testes**.
- [x] Release incremental **0.1.51** gerado e verificado em `dist/NeuralBridge-Setup-0.1.51-x64.exe` (NSIS x64; sem assinatura de código, conforme o risco R11).
- [x] Correção final das abas longas do Git Intelligence (`Revisão IA`, `Commit e PR` e `Operações`) isolada em viewport interno; distribuição **0.1.52** gerada e verificada em `dist/NeuralBridge-Setup-0.1.52-x64.exe`.

- [x] Entrega 0.1.49 gerada com chat/Neura sem projeto, histórico geral local limitado e apagável, comandos locais PT/EN com resposta no idioma detectado, Spotify ampliado com transferência de dispositivo, reprodução de faixa/álbum/artista/playlist e recuperação de Play sem player ativo, clima por localização consentida/fallback com cache e timeout cancelável, captura de tela consentida com contexto da janela ativa, memória global limitada, cancelamento de conversa, diagnóstico de microfone, resposta em chat com confirmação antes de colar na janela capturada, recusa explícita de edição de arquivos sem projeto e bloqueio de análise de campo de senha focado. O adaptador de voz reutiliza o catálogo do VoiceStudio por 30 s, compartilha sondagens concorrentes e invalida o cache após erro de síntese. O HUD agora mantém voz/confirmações críticas visíveis e organiza assistente, sugestões e detalhes por abas acessíveis.
- [x] Quality gate: 167 arquivos/1.472 testes, typecheck, lint, diff-check e verificação da distribuição aprovados; E2E Git da reorganização por abas 22/22 e suíte `neura-assistant` 6/6 aprovados; NSIS x64 gerado em `dist/NeuralBridge-Setup-0.1.49-x64.exe` (242.618.957 bytes; blockmap 254.941 bytes).
- [ ] Homologação externa ainda necessária: instalar 0.1.49 no PC do usuário, autorizar Spotify com Client ID válido, permitir localização/microfone e validar foco real do chat; essas etapas dependem do estado da máquina/contas e não devem ser marcadas como concluídas por teste simulado.
- [ ] Diagnóstico da captura de 2026-11-02: o executável instalado no PC está em **0.1.50** e o `brain.db` está na migração 0055/56, sem a coluna `tasks.origin`; instalar **0.1.52** é necessário para aplicar `0056_task_origin` e ocultar as conversas antigas da Neura.
- [ ] Streaming de áudio por partes, envio automático de mensagens, seleção semântica completa do chat por UI Automation e memória global persistente continuam pendências explícitas. A captura agora identifica, quando o Windows fornece metadados, a janela e o elemento focado, exige HWND para usar UI Automation e bloqueia senha/campo não editável; ainda não é uma garantia universal para todos os chats. O cancelamento da resposta anterior já está propagado e testado; o fluxo atual mostra progresso textual, recupera a captura de voz e exige confirmação para digitação.

## Fase 38 — melhoria visual do Git Intelligence (2026-11-02)

- [x] Página reorganizada com cabeçalho fixo, corpo com scroll interno e abas `Visão geral`, `Automações`, `Revisão IA`, `Commit e PR` e `Operações`, sem remover os fluxos Git existentes.
- [x] E2E real das áreas afetadas aprovado: **22/22** (`git-intelligence-graph`, `git-automations`, `git-smart-commit` e `git-write-operations`).
- [x] Correção incremental validada: as permissões de áudio/tela/localização usam fila de patches e permanecem independentes em cliques rápidos; o Git Intelligence agora exibe branch/upstream, commits locais pendentes e ação explícita `Subir commits`/`Publicar branch` com autorização single-use.
- [x] Evidências novas: Vitest direcionado **42/42**, E2E de permissões **1/1**, E2E de commit pendente/push **1/1**, E2E de comparação de referências **1/1**, `npm run typecheck` e `npm run build` aprovados.
- [ ] Fechamento visual ainda requer inspeção em tema claro, movimento reduzido, foco/teclado por aba e homologação em 800/1280 px.

## Fase 31 — Workflows avançados e automação Git (validação incremental em 2026-11-02)

- [x] Evidência focada: workflows/shared/orchestrator/desktop **37/37 testes**, `tests/e2e/workflows.spec.ts` **5/5**, `workflow-builder-visual.spec.ts` **1/1**, recovery/execução Git **14/14 testes** e `git-automations.spec.ts` **3/3**.
- [ ] A fase não está fechada: conexão por arraste, zoom/pan e acessibilidade completa do canvas; cinco templates completos/compatibilidade; retomada após reinício de Electron e matriz completa de falhas; gatilhos de commit/arquivos, debounce/dedupe total, recuperação de atraso e E2E por commit ainda permanecem pendentes no `docs/PLAN.md`.

## Fase 37.1 — UI/UX Intelligent Workspace (2026-10-31)

- [x] Auditoria inicial da stack e superfícies do renderer: React 19, Electron, Tailwind 4, React Router, Lucide, shell, rotas e Dashboard identificados.
- [x] UI/UX Pro Max executada com geração e persistência do Design System em `design-system/neuralbridge-intelligent-workspace/MASTER.md`.
- [x] Tokens dark-first, contraste semântico, foco visível, cursor em elementos interativos e suporte a `prefers-reduced-motion` atualizados.
- [x] Shell recebeu contexto "Intelligent Workspace", busca visual/Command Palette affordance, indicador local-first e navegação preservada.
- [x] Dashboard recebeu hero de entrada e ações rápidas para Chat e Projetos; dados e estados continuam vindos das APIs reais.
- [x] Typecheck, lint, build e `git diff --check` do lote passaram; screenshots/E2E visual não foram executados neste ambiente.
- [x] A affordance visual de busca evoluiu no Lote 2 para Command Palette funcional; seleção de workspace continua pendente.

## Fase 37.2 — Navegação e Command Palette (2026-10-31)

- [x] Command Palette real com Ctrl+K no Electron, botão acessível, filtro, setas, Enter, Escape e foco inicial/retorno.
- [x] Resultados somente de rotas e ações existentes; estado vazio informativo.
- [x] Sidebar com projetos recentes reais, estado ativo, recolhida/expandida, tooltips e preferência persistida.
- [x] Evidências visuais reais capturadas no Electron: Dashboard, Command Palette, Projetos e sidebar recolhida; screenshot exibido na sessão.
- [x] E2E direcionado de shell/sidebar/palette: 4 testes aprovados.
- [x] Typecheck do lote e build aprovados após a implementação.
- [x] Lint dos arquivos do lote aprovado.
- [ ] Lint global bloqueado por `packages/orchestrator/test/video-script.test.ts:57` (escape desnecessário pré-existente).
- [ ] Typecheck global bloqueado por `apps/desktop/src/renderer/src/features/video/VelixProduction.tsx:22` (`VideoStudioState.generation` ausente, alteração fora do lote).
- [ ] Experiência de execução dos agentes: reutilizar e polir `RunsPage`/`SessionPanel` no próximo checkpoint, preservando eventos reais.
- [ ] Validar light mode, reduced motion, viewport 375/768/1024/1440 e snapshots automatizados.

## Fase 37.3 — Agent Execution Experience (2026-10-31)

- [x] RunsPage reorganizada para acompanhamento operacional: resumo, filtros, status, agente, projeto, duração e atenção.
- [x] SessionPanel recebeu cabeçalho da execução atual com informações derivadas de `TaskDetail`, `TaskEvent` e status reais.
- [x] Timeline/logs, retry, fallback, checkpoints, cancelamento, outputs e custos existentes foram preservados e continuam sem estados inventados.
- [x] E2E SessionPanel: 5/5 aprovados.
- [x] E2E Execuções/continuação no Chat: aprovado após atualização dos seletores para o novo layout.
- [x] Screenshot real de Execuções vazio capturado no Electron; estado vazio e filtros verificados visualmente.
- [x] Build, typecheck do desktop, lint dos arquivos alterados e `git diff --check` aprovados.
- [ ] Lint global permanece bloqueado por `packages/orchestrator/test/video-script.test.ts:57`.
- [ ] Typecheck global permanece bloqueado por `apps/desktop/src/renderer/src/features/video/VelixProduction.tsx:22`.
- [ ] Próximo lote: light mode, reduced motion, snapshots multi-viewport e polimento das telas restantes.

## Fase 37.4 — Visual Quality Assurance, Responsividade e Acessibilidade (2026-10-31)

- [x] Auditoria real do Dashboard/shell e Execuções com screenshots; o Dashboard foi inspecionado em 1280×800 e o shell/Execuções em Electron.
- [x] Foco visível global, targets de navegação mais confortáveis e cabeçalho sem compressão indevida em janelas menores.
- [x] Command Palette com seleção comunicada por `aria-activedescendant`, ids de opções e fechamento acessível.
- [x] Reduced motion validado no CSS: transições/animações minimizadas e scroll suave desligado.
- [x] Regressão visual Playwright passou em 1280×800, 1024×768 e 800×700; baselines antigos foram atualizados somente após inspeção visual do diff/actual.
- [x] Typecheck desktop, ESLint direcionado, build Electron e `git diff --check` passaram.
- [ ] Full lint continua bloqueado pelo escape inválido pré-existente em `packages/orchestrator/test/video-script.test.ts`.
- [ ] Full typecheck continua bloqueado pelo contrato pré-existente de `VideoStudioState.generation` em `VelixProduction.tsx`; fora do escopo visual.

Próximo lote recomendado: Fase 37.4 funcional/integração de Workflows, Skills, Brain/RAG, Analytics, Git e Velix, preservando esta base visual e adicionando E2E específicos apenas onde houver fluxos reais.

## Fase 37.5 — Workflow Builder Visual 2.0 (2026-10-31)

- [x] Layout de biblioteca de blocos, canvas React Flow e propriedades contextuais, preservando o editor JSON como compatibilidade.
- [x] Biblioteca pesquisável por categorias reais: Agentes, Controle e Ferramentas; descrições e inserção por teclado/clique/drag permanecem suportadas.
- [x] Nós com identidade visual NeuralBridge, hierarquia título/função/estado, alerta de configuração e estados de execução derivados de `workflow-steps`.
- [x] Painel de propriedades reorganizado, com contexto do nó selecionado, seção avançada recolhível e mensagens de validação existentes preservadas.
- [x] Responsividade validada em 1280×800 e 1024×768; canvas sem overflow e nó inicial enquadrado após ajuste visual.
- [x] Screenshots reais via Electron/Playwright inspecionados em `tests/e2e/workflow-builder-visual.spec.ts-snapshots/`.
- [x] E2E do builder: 5/5 na execução validada antes da captura final; E2E visual: 1/1 em 1280×800 e 1024×768; typecheck desktop, lint direcionado, build e `git diff --check` aprovados.
- [x] Instabilidade reproduzida e diagnosticada: os E2Es lançam o Electron empacotado a partir de `apps/desktop/out`, não o Vite; após rebuild do renderer e ajuste do snapshot/heading acessível, o E2E legado afetado passou.
- [ ] Ainda falta validar uma execução real com dados persistidos em ambiente não-fixture e revisar light mode/reduced motion especificamente no canvas React Flow.

Próximo lote recomendado: fechar a auditoria visual do canvas em light mode/reduced motion e, depois, integrar a mesma linguagem de estados aos painéis de Workflows, Skills e Brain/RAG sem ampliar contratos de execução.

## Fase 37.6 — Projects & Workspaces Experience (2026-10-31)

- [x] Projects Hub modernizado com hierarquia visual, resumo operacional e filtros funcionais.
- [x] Busca por nome, diretório, tipo e stack real; filtro de projetos disponíveis/indisponíveis.
- [x] Ações existentes de adicionar, criar e detectar projetos preservadas; nenhuma ação decorativa foi introduzida.
- [x] Estados de carregamento, erro, vazio e nenhum resultado receberam feedback claro e acessível.
- [x] Hierarquia de workspaces/projetos filhos continua usando `ProjectTree` e os dados persistidos reais.
- [x] Diagnóstico do Vite concluído: E2Es usam Electron empacotado via `apps/desktop/out`; servidores 5173 pertencem apenas ao desenvolvimento e não são encerrados automaticamente.
- [x] E2E de projetos e hierarquia: 6/6; typecheck desktop, ESLint direcionado, build e `git diff --check` aprovados.
- [x] Snapshot visual real do Projects Hub em 1280×800, 1024×768 e 800×700; estado vazio inspecionado e sem overflow.
- [x] Screenshot visual dedicado do Projects Hub em light mode com projeto real cadastrado, inspecionado no Electron.
- [ ] Não existe persistência de favoritos ou projeto ativo global no contrato atual; não foi inventada uma associação.

Próximo lote recomendado: conectar contexto de projeto somente onde as rotas/APIs já suportarem essa associação e manter a matriz visual de temas sob regressão.

## Fase 37.7 — AI Knowledge & Skills Experience (2026-10-31)

- [x] Skills Manager modernizado com busca real por nome/descrição/origem, cards responsivos, estado local/conflito, associação de agentes e configurações de instalação/atualização preservadas.
- [x] Memory, RAG e Token Intelligence auditados sem duplicar persistência ou inventar telemetria; fluxos existentes de edição, busca, restauração, uso reportado, alertas e orçamento continuam cobertos.
- [x] Projects Hub validado em light mode no Electron com o projeto real `C:\dev\neuralbridge` registrado no armazenamento isolado do E2E; contraste, hierarquia, filtros e ausência de overflow inspecionados.
- [x] Screenshots reais inspecionados: Skills, Memória, Analytics e Projects Hub em viewports 1280×800, 1024×768 e 800×700; snapshot light com projeto real.
- [x] E2E visual/funcional relevante: 8/8; ESLint direcionado, build Electron e `git diff --check` passaram.
- [ ] Typecheck desktop bloqueado por contratos IPC preexistentes de Video Ideas em `apps/desktop/src/main/index.ts` e `apps/desktop/src/preload/index.ts`; não alterado neste lote.
- [ ] Ainda falta uma rodada dedicada de light mode/reduced motion para Skills, Memória e Analytics e uma correção coordenada dos contratos Video Ideas.

Próximo lote recomendado: completar a matriz de temas/reduced motion das telas de conhecimento e corrigir os tipos IPC de Video Ideas antes de ampliar a instrumentação visual.

## Fase 37.8 — Velix Studio & AI Media Experience (2026-10-31)

- [x] Auditoria dos fluxos reais de Velix: Ideias, Descoberta, Rights Manager, Clip Hunter, Produção Editorial, Studio, narração, preview e renderização.
- [x] Cabeçalho e navegação visual reorganizados em torno do fluxo Descobrir → Planejar → Aprovar → Finalizar, preservando as abas e rotas existentes.
- [x] Projeto ativo, limites reais do Claude e estados de erro continuam visíveis; nenhuma métrica ou progresso fictício foi criado.
- [x] Direitos, evidências, estados `verified_allowed`, `blocked` e `unverified`, seleção de cortes, ordem, preview e envio ao Studio foram preservados.
- [x] Acessibilidade refinada: foco visível, navegação de abas por teclado, ícones Lucide consistentes e labels de campos sem colisões entre painéis ocultos.
- [x] Screenshot real do Electron em 1280×800, 1024×768 e 800×700; a inspeção confirmou contraste, hierarquia, quebra responsiva e ausência de overflow.
- [x] E2E direcionado após as alterações: 3/3; suíte ampla Velix/descoberta/renderização: 21/23, com 2 bloqueios de testes existentes ligados a dependência/limite externo do agente.
- [x] Build Electron, ESLint direcionado e `git diff --check` passaram.
- [ ] Typecheck continua bloqueado por divergências preexistentes de Video Ideas/Node em contratos já modificados por trabalho paralelo; não foram aplicados casts inseguros.

Próximo lote recomendado: estabilizar os contratos IPC e a matriz de typecheck, depois validar light mode/reduced motion dentro do Studio com dados persistidos reais antes de ampliar a timeline.

## Fase 37.9 — Global UX Audit & Quality Gates (2026-10-31)

- [x] Inventário e avaliação de severidade registrados em `docs/plans/phase-37-global-ux-audit.md`.
- [x] Estado atual classificado por área, com P0/P1, evidências visuais e riscos remanescentes.
- [x] Decisão objetiva: a Fase 37 ainda não está pronta para encerramento.
- [ ] Lote 10 recomendado: estabilizar IPC/typecheck, completar temas/reduced motion e fechar rotas secundárias.

## Fase 37.10 — Final Stabilization, Accessibility & Release Readiness (2026-10-31)

- [x] Baseline protegido: alterações concorrentes preservadas e arquivos modificados inspecionados antes das correções.
- [x] Typecheck global: aprovado.
- [x] ESLint global: aprovado após remover variável não utilizada de teste concorrente, sem mudança de runtime.
- [x] E2E crítico: 26/26, cobrindo shell, Command Palette, projetos, memória, Brain3D/reduced motion, Skills, Token Intelligence e Velix.
- [x] Testes unitários direcionados Video Ideas/Research/Velix contract: 26/26.
- [x] Build Electron e `git diff --check`: aprovados.
- [x] Evidência visual Velix real preservada em 1280×800, 1024×768 e 800×700; layout inspecionado após a correção responsiva.
- [ ] A matriz visual dedicada de light mode/reduced motion para todas as rotas secundárias ainda não está completa.
- [ ] A execução Vitest global continua não sendo um quality gate confiável quando mistura helpers E2E; os testes unitários direcionados passam isoladamente.

Decisão: a Fase 37 permanece aberta. Próximo Lote 11 recomendado: somente fechar a matriz visual das rotas secundárias e estabilizar a descoberta/configuração do Vitest, sem novas mudanças de produto.

## Fase 37.11 — Final Visual Matrix, Vitest Isolation & Phase Closure (2026-10-31)

- [x] Vitest isolado estruturalmente: inclui apenas testes unitários de `packages/*/test` e `apps/*/test`; exclui E2E, integração e benchmarks.
- [x] `vitest list` não descobre helpers Playwright/E2E.
- [x] Matriz visual final: 36 snapshots reais em 6 rotas secundárias, dark/light, reduced motion e 1280×800/1024×768/800×700.
- [x] Workflows light, Git Intelligence dark e Configurações light inspecionados manualmente; sem overflow ou falhas visuais P0/P1.
- [x] Typecheck global, ESLint global, build Electron e `git diff --check`: aprovados.
- [ ] Vitest global não conclui em tempo previsível; a causa restante está em testes de workspace que exercitam Git e avisos de conversão de linha, não em descoberta E2E.

Decisão: FASE 37 ABERTA. Pendência única reproduzível: tornar a suíte Vitest completa estável/observável sem remover cobertura. Próximo lote recomendado: Lote 12 limitado à estabilização dos testes de workspace/Git e encerramento formal.

## Fase 37.12 — Workspace/Git Test Stabilization & Final Quality Gate (2026-10-31)

- [x] Investigação de coleta: E2E, integração e benchmarks continuam fora do Vitest unitário; `vitest list` não encontrou helpers Playwright.
- [x] Workspace serial: 22 arquivos, 214 testes, 32,34s.
- [x] Desktop serial: 30 arquivos, 175 testes, 29,33s.
- [x] Global serial: 106 arquivos, 860 testes, 145,78s.
- [x] Testes Git isolados e direcionados aprovados; avisos de LF/CRLF foram classificados como efeito de `core.autocrlf` em fixtures temporárias.
- [x] Repetição tripla do gate global concluída: 860/860 em 145,78s; 862/862 em 153,07s; 862/862 em 155,52s.
- [x] E2E crítico: 52/52 aprovados.
- [x] Matriz visual: 1/1, 36 snapshots sem atualização, dark/light/reduced motion e três viewports.
- [x] Typecheck, ESLint, build Electron e `git diff --check` aprovados.

Decisão: FASE 37 CONCLUÍDA em 2026-10-31. Relatório formal: `docs/plans/phase-37-final-validation.md`. O `MASTER.md` é o baseline visual oficial; pendências independentes da Fase 36 permanecem preservadas.

## Fase 38.1 — Git Intelligence 2.0: auditoria e correções de base (2026-10-31)

- [x] Plano oficial incorporado em `docs/plans/phase-38-git-intelligence-2.md`, com dependências, sequência e critérios preservados.
- [x] Auditoria de `git.ts`, `git-history.ts`, `git-write.ts`, IPC de projetos, automações Git, Brain/RAG e E2E existente.
- [x] Bugs reproduzidos e corrigidos: branch com ponto truncada por `gitInfo()` e `ENOENT` de `gitRepositories()` para raiz ausente.
- [x] Matriz de fixtures: sem commits, detached HEAD, rename, binário, Unicode, worktree, submódulo real, Git indisponível/recuperação, raiz ausente e diretório sem Git; regressões focadas passaram 12/12.
- [x] Segurança atual confirmada: leitura separada de escrita, `shell:false`, programas Git do repositório desativados nas leituras, validação de URLs e limites existentes.
- [ ] DAG/cursor/virtualização, working tree avançada, operações seguras, revisão IA e automações ampliadas permanecem nas subfases seguintes; não foram declaradas implementadas.

Decisão: Fase 38.1 CONCLUÍDA. Submódulos continuam explicitamente read-only e sem fetch recursivo.

## Fase 38.2 — Git Graph 2.0 (CONCLUÍDA, 2026-10-31)

- [x] Contrato retrocompatível de histórico com refs local/remota/tag e HEAD reais.
- [x] UI identifica branches, remotes, tags e HEAD, preservando tokens, ícones Lucide, foco e estado vazio do Design System.
- [x] Layout DAG determinístico baseado em pais reais, com merges, lanes e indicação de continuidade fora da página; testes 5/5.
- [x] Paginação sob demanda com cursor versionado por fingerprint de refs, invalidação em histórico reescrito e deduplicação; testes combinados 10/10.
- [x] Serviço `gitCompareRefs` implementado para comparação direta e desde merge-base, com refs inválidas e ausência de ancestral comum tratadas por erro tipado.
- [x] Comparação integrada ao contrato compartilhado, IPC, preload, main e UI; seleção de duas refs reais e resumo de merge-base/linhas/arquivos disponível.
- [x] Virtualização do Graph com overscan, geometria total preservada e benchmark de 5.000 commits aprovado (<1s no teste unitário).
- [x] Modos compacto/expandido persistidos e baseados no mesmo DAG; build Electron e E2E Git Intelligence existente 1/1 aprovados.
- [x] Diff Explorer abre o patch real do commit selecionado via `git show`, preservando o diff da working tree; IPC/preload continuam estritos.
- [x] E2E dedicado com repositórios temporários reais passou 2/2: refs/branches/tag, seleção, diff, comparação direta/merge-base, densidade persistida, foco por teclado e carregamento incremental de histórico extenso.
- [x] Auditoria visual Electron concluída com screenshots reais 1280×800 e 800×700; corrigida sobreposição do modo compacto e screenshots revalidados.
- [x] Estados loading, vazio, raiz removida, filtro sem resultados e erro de leitura cobertos por E2E determinístico.
- [x] Continuidade de merges validada em E2E com hashes/arestas reais; nenhuma aresta aponta para commit fictício.
- [x] Benchmark Electron real com 5.000 commits: primeira renderização 4067 ms, seleção 29 ms, scroll 5 ms, DOM 150, SVG/path 22, commits montados 21, viewport 560 px e altura virtualizada 7608 px.
- [x] Critérios de aceite comprovados; Fase 38.2 encerrada sem operações Git destrutivas.

Próximo passo: Fase 38.3 — auditar e evoluir Working Tree/Diff Explorer com contratos GitWriter existentes.

## Fase 38.3 — Git Operations Manager (início, 2026-10-31)

- [x] Auditoria inicial de `git-write.ts`, IPC, preload e handlers main concluída.
- [x] Operações existentes identificadas: criar pasta/projeto, `git init`, clone com URL validada e confirmação de nested repository.
- [x] Segurança confirmada: `shell:false`, comandos separados do GitReader, hooks/fsmonitor desativados, `--no-recurse-submodules`, validação Zod e sem commit/push implícitos.
- [x] Working Tree real com staged/unstaged/untracked/conflict, Stage/Unstage individual, validação de caminhos e painel integrado ao Git Intelligence.
- [x] Branch Manager no workspace/IPC/main: listar locais/remotas, criar, alternar, renomear e excluir com validações de Git, dirty tree, HEAD e worktrees.
- [x] Autorização central obrigatória nos handlers de Stage/Unstage e branches: token IPC, revalidação de estado e consumo único antes da escrita; auditoria sem caminhos expostos.
- [x] Regressão em fixtures Git reais: autorização + `git-write.test.ts` 30/30; typechecks direcionados, ESLint e `git diff --check` aprovados.
- [x] Núcleo GitWriter de Stash/Commit: listagem, criação com untracked opcional, apply/pop/drop com ref revalidada e commit apenas com staged/mensagem válida.
- [x] Contratos shared, schemas IPC, preload e handlers main de Stash/Commit integrados, com autorização obrigatória.
- [x] Regressão de Stash/Commit e autorização em fixtures reais: 32/32.
- [x] Painel operacional de branches, stash e commit integrado à Git Intelligence, com confirmação contextual, loading/vazio e refresh das consultas.
- [x] Revert e Cherry-pick reais integrados com validação de estado, autorização contextual, mainline obrigatório para merges e continue/abort explícitos.
- [x] Regressão em fixtures Git reais para operações e conflitos: 34/34.
- [x] E2E Electron real 7/7: Stage/Commit, criação/alternância de branch, Stash apply/pop/drop, Revert, Cherry-pick, conflito real com Abort e Continue após resolução manual; efeitos verificados em repositórios temporários.
- [x] Autorização direta cobre grant single-use, parâmetros/estado incompatíveis, expiração e tentativa de reutilização concorrente.
- [x] Screenshots reais do painel de conflito capturadas em `prints/git-conflict-1280.png` e `prints/git-conflict-800.png`.
- [x] Continue após resolução manual corrigido: arquivos em conflito agora permitem Stage pela UI; E2E confirma novo commit, working tree limpa e ausência de operação pendente.
- [x] Merge real com dois pais validado pela UI: mainline obrigatória, valor inválido bloqueado sem alteração e mainline 1 vinculada à confirmação/grant; E2E dedicado aprovado.
- [x] Suíte Electron de escrita ampliada para 8/8 após rebuild, incluindo o cenário de mainline de merge.
- [ ] Tentativas de E2E para cancelamento e hook falharam por timeout não determinístico no runner Windows; não foram contabilizadas como aprovação e precisam de fixtures determinísticas.
- [x] Integração do serviço principal: `apps/desktop/test/projects.test.ts` passou 12/12, rejeitando Stage sem grant e com parâmetros incompatíveis e preservando o índice.
- [ ] Bypass direto dos handlers IPC ainda não comprovado; a cobertura atual do teste é do serviço real, não dos wrappers `ipcMain`.
- [ ] Hooks Git de projeto não são executados pelo GitWriter: `SAFE_WRITE` força `core.hooksPath=` para impedir execução de código do repositório; o cenário permanece documentado, sem enfraquecer essa proteção.
- [x] Política SAFE_WRITE validada por teste real com hook sentinela: hook não executado e commit autorizado concluído; `git-write.test.ts` passou 33/33.
- [x] Worktree real validado em `git-write.test.ts`: branch compartilhada não pode ser excluída nem alternada indevidamente; suíte passou 34/34.
- [x] Mapeamento de handlers Git de produção extraído para `createGitIpcHandlers` e reutilizado pelo `index.ts`; integração real passou 13/13 com Stage sem grant rejeitado e Stage autorizado aprovado.
- [ ] Invocação literal de `ipcMain` ainda pendente para todos os canais; a cobertura atual exerce o mapeamento de produção e o serviço principal, sem mock de autorização.
- [x] Registro IPC controlado validado para `projects:git:stage`: callback real registrado por `registerIpcHandler`, rejeição sem grant e execução autorizada; 13/13 no teste de projetos.
- [ ] Demais canais protegidos ainda precisam de matriz de invocação literal; não foram contabilizados por extrapolação.
- [x] Nova cobertura literal: `projects:git:unstage`, `projects:git:commit` e `projects:git:branch:delete`; 4/4 casos focados aprovados incluindo Stage, com efeitos reais em fixtures.
- [ ] Ainda pendentes na matriz IPC: Stash create/apply/drop, Revert, Cherry-pick e Continue/Abort.
- [x] Cobertura adicional: Stash create/drop e Branch create/switch/rename; 2/2 testes focados aprovados com rejeição sem grant e efeitos autorizados reais.
- [ ] Ainda pendentes na matriz IPC: Stash apply/pop, Revert, Cherry-pick e Continue/Abort.
- [x] IPC adicional: Stash Apply, Revert, Cherry-pick e Abort literal; 3/3 testes focados aprovados com fixtures reais.
- [x] Concorrência inicial: dois grants distintos para Stage executados em paralelo, ambos consumidos e arquivos/HEAD preservados.
- [ ] Pendentes: Continue literal, Stash Pop específico, concorrência de operações incompatíveis além de Stage e cancelamentos Electron.
- [x] Stash Pop e Continue literal adicionados: 2/2 casos focados aprovados, incluindo limpeza de `CHERRY_PICK_HEAD` após resolução real.
- [ ] Pendentes: concorrência incompatível além de Stage e cancelamentos Electron.
- [x] Fila de escrita por raiz do repositório implementada; Commit + Stage concorrentes com grants distintos foram serializados e o grant obsoleto foi rejeitado após revalidação, sem estado `UU`.
- [ ] Pendentes: concorrência específica entre HEAD/branch em worktrees e cancelamentos Electron.
- [x] Regressão após a fila: Vitest focado 61/61, build Electron, typecheck, ESLint e diff-check aprovados.
- [ ] Cancelamento Electron permanece bloqueado antes do checkpoint observável de Stage/diálogo no runner Windows; não contabilizado como E2E aprovado.
- [ ] E2E isolado de cancelamento de Commit voltou a travar antes de uma condição observável; removido e não contabilizado.
- [x] Regressão executada nesta rodada: Vitest Git/workspace/projetos/autorização 59/59, E2Es Git Graph + Write 12/12, typecheck, ESLint, build Electron e `git diff --check` aprovados.
- [x] Regressão focada posterior passou 60/60 após Stash Pop e Continue.
- [ ] Permanecem cancelamentos, hooks com falha, worktrees, bypass direto por IPC e concorrência entre grants distintos.

## Sincronização local de históricos — núcleo seguro (2026-10-29)

- [x] Descoberta não destrutiva dos índices locais `~/.claude/history.jsonl` e `~/.codex/session_index.jsonl` quando existentes.
- [x] Leitura JSONL limitada, tolerante a linhas inválidas/parcialmente escritas e sem execução de conteúdo.
- [x] Checkpoints com tamanho, `mtime`, hash e hashes de registros processados; sessões modificadas são reavaliadas sem duplicar registros já vistos.
- [x] Extração restrita a blocos explícitos `neuralbridge-learnings`; prompts e metadados isolados não geram memórias.
- [x] Serviço de sincronização com lotes limitados, contexto de projeto/agente e callback para o pipeline existente de propostas/aprovação.
- [x] Leitor JSONL de transcrições como dados inertes, com limites de bytes/texto e sem interpretação de campos de comando.
- [x] Preferências persistentes e canais IPC validados para consentimento, pausa, intervalo, raízes e exclusões.
- [x] Validação: 9 testes direcionados, typecheck, lint e `git diff --check` passaram.
- [x] Leitor Codex somente-leitura baseado no esquema verificado de `thread_history_1.sqlite`/`thread_items`, com fallback ao índice JSONL quando o SQLite não existe.
- [x] Runtime no processo principal do Electron: execução assíncrona, timer configurável, checkpoint em `history-sync-state.json`, consentimento por `enabled` e pausa/retomada por IPC.
- [x] IPC de configurações e status (`lastRun`, sessões, propostas e erros) validado por schema.
- [x] Validação atual: 10 testes direcionados, typecheck, lint, build e `git diff --check` passaram.
- [x] Interface em Brain Settings para consentimento, ativação/pausa, intervalo, raízes permitidas, exclusões, sincronização manual e métricas.
- [x] Extração local determinística de conversas comuns: somente frases com evidência explícita são propostas, classificadas como confirmadas, prováveis ou não resolvidas; blocos estruturados não são duplicados.
- [x] Segredos e conteúdo fora dos campos de texto continuam rejeitados; nenhuma transcrição é enviada a provedor externo.
- [x] Validação atual após a extração: 8 testes direcionados, typecheck, lint, build e `git diff --check` passaram.
- [ ] Associação automática de sessões Codex a projetos permanece conservadora: sem metadado confiável, a sessão fica sem projeto.
- [ ] E2E Electron do fluxo consentimento → sincronização → aprovação → RAG ainda não foi executado.
- [ ] Inventário real: 34 arquivos de transcrição Claude, 5 linhas no índice Claude e 127 linhas no índice Codex; 0 sessões processadas, 0 propostas e 0 memórias persistidas nesta execução, pois o consentimento permanece desativado.

## Fase 16 — checklist fechado

- [x] IPC validado por schema e remetente confiável em `registerIpcHandler`.
- [x] Isolamento Electron: `contextIsolation`, sandbox, `nodeIntegration: false`, CSP restritiva e navegação externa bloqueada.
- [x] Conteúdo de memórias/agentes tratado como dado, sem HTML ativo ou imagens remotas.
- [x] Operações destrutivas cobertas por confirmação na interface.
- [x] Estados de carregamento, erro, vazio e feedback verificados nos fluxos críticos.
- [x] Navegação por teclado e foco visível preservados pelos componentes e fluxos E2E.
- [x] Logs e mensagens de erro não expõem credenciais; testes existentes cobrem prévias sem segredos.
- [x] Suíte unitária/integrada e E2E executada; limitações externas permanecem explicitamente ignoradas.

## Limitações conhecidas

Os testes que exigem CLIs reais autenticadas ou registro real em instalações pessoais permanecem ignorados por dependerem de integrações externas. Eles não são considerados aprovação da Fase 16 e não foram alterados para mascarar a dependência.

## Fase 17 — Distribuição Windows

- [x] Configuração electron-builder NSIS x64 com identidade NeuralBridge; a versão vem de `apps/desktop/package.json` (hoje `0.1.2`).
- [x] Ícone `.ico` multi-resolução e transparente gerado por `scripts/generate-icon.mjs` e usado pela janela e pelo empacotador.
- [x] `better-sqlite3` e dependências MCP configurados em `asarUnpack`.
- [x] Bundle inclui `mcp-server.js`, migrations e dependências runtime verificadas no pacote.
- [x] Instalador NSIS gerado (`dist/NeuralBridge-Setup-<versão>-x64.exe`; validado inicialmente com 0.1.0).
- [x] Instalador regenerado: `dist/NeuralBridge-Setup-0.1.2-x64.exe` (2026-10-29), com as Fases 18 e 19, permissões por projeto, imagens no Chat, a correção do roteador e as mudanças de pré-checagem, failover e orçamento.
- [x] Smoke test do executável empacotado sem terminal: aprovado.
- [x] `deleteAppDataOnUninstall: false` e `%APPDATA%\NeuralBridge` preservado pela configuração.
- [ ] Instalar em máquina/pasta limpa, registrar MCP em Claude/Codex reais e desinstalar/reinstalar preservando memórias.

### Bloqueios de validação

O teste automatizado não executou o instalador NSIS nem alterou configurações pessoais de Claude/Codex. Os 4 E2E ignorados e 14 testes de integração ignorados dependem de CLIs autenticadas/instalação externa. O build local também não possui certificado de assinatura; a assinatura deve ocorrer no pipeline de distribuição.

`npm run verify:dist` foi executado e aprovado: artefato NSIS, ICO multi-imagem,
`mcp-server.js`, migrations e `better-sqlite3` foram encontrados sem iniciar
clientes externos. Desde 2026-10-29 o script exige o instalador da versão atual do app
(lida de `apps/desktop/package.json`) e confere que o `app.asar` empacotado é dessa mesma
versão; antes, ele aceitava o instalador 0.1.0 mesmo com o app em 0.1.1. O script não
detecta um instalador da versão certa gerado antes de mudanças no código: gere de novo
com `npm run dist:win` antes de validar. A Fase 17 continua pendente até a execução manual controlada
do checklist em `docs/DISTRIBUTION-CHECKLIST.md`.

## Fase 18 — Redesign da Interface Chat

- [x] Implementada: sidebars recolhíveis e persistentes, histórico com busca/grupos/renomear/excluir, composer fixo com seletores de projeto, agente e modelo opcional, parar tarefa, auto-scroll inteligente, layout em 960–1920 px.
- [x] typecheck, lint, 367 unitários, 39 E2E (+4 ignorados), integração 8 (+14 ignorados), build e `git diff --check` aprovados.
- [x] Validação com CLIs reais: `NB_REAL_CLI=1 npx playwright test tests/e2e/chat-real.spec.ts` aprovado em 2026-10-29 (executado a pedido do usuário). Fase 18 concluída.
- [x] Complemento 18.8 — painel lateral direito (Ambiente, Contexto, Conectores, Skills, Saídas, Alterações, Tarefas) implementado: typecheck, lint, 433 unitários, E2E 55 (+4 ignorados; 1 falha instável preexistente da Fase 19) e `chat-panel.spec.ts` 5/5.
- [x] Validado com CLIs reais: `chat-real.spec.ts` aprovado; capacidades e contexto reais do Claude conferidos; lista MCP real dos dois CLIs (o "✔" do Claude foi corrigido com teste).
- [ ] Fase 19: o teste de câmera de `brain3d.spec.ts` é instável (falha em 1 de 3 execuções também no commit `06b98ef`).
- Sub-plano: `docs/plans/phase-18-chat-redesign.md`.
- A implementação deve preservar as integrações reais das fases anteriores e validar os critérios de aceite documentados no `PLAN.md`.

## Fase 19 — Neural Brain 3D Interativo

- [x] Implementada: aba "Cérebro 3D" na Memória com cérebro procedural de partículas, rede neural, impulsos contínuos, memórias reais como nós, relações salvas e por similaridade, atividade real (RAG das tarefas e MCP), controles, filtros, painel, níveis de qualidade e efeitos, movimento reduzido e alternativa sem WebGL.
- [x] typecheck, lint, 398 unitários, 50 E2E (+4 ignorados), integração 8 (+14 ignorados), `dist:win`, `verify:dist`, executável empacotado e `git diff --check` aprovados.
- [x] Critérios 2 (aparência) e 3 (cérebro procedural como desvio): aprovados pelo usuário em 2026-10-29; comparação em `docs/assets/phase-19-comparison.png`.
- [ ] Checagem no app instalado: o instalador 0.1.1 de 2026-10-29 (com as Fases 18 e 19, a correção das Skills e as permissões por projeto) foi instalado para o usuário, com backup do banco em `%APPDATA%\NeuralBridge\backups\pre-install-20261029-091136`; falta o usuário abrir e conferir.
- Sub-plano: `docs/plans/phase-19-neural-brain-3d.md`.

## Melhoria — Permissões dos agentes por projeto

- [x] Implementada: níveis Padrão, Comandos liberados (lista de comandos do Claude Code e rede no Codex) e Acesso total (confirmação obrigatória), aplicados só às etapas de edição.
- [x] typecheck, lint, 441 unitários, integração 8 (+14 ignorados), `project-permissions.spec.ts` 3/3 e `git diff --check` aprovados.
- [ ] Nenhuma tarefa real foi executada com acesso total; as flags foram conferidas no `--help` dos CLIs reais.

## Melhoria — Imagens no Chat

- [x] Implementada: anexar pelo botão, colar e arrastar; miniaturas, remoção, histórico com ampliação, persistência e limpeza com a conversa; envio real ao Claude Code (stream-json com imagem base64) e ao Codex (`--image`).
- [x] typecheck, lint, 458 unitários, E2E 62 (+4 ignorados), integração 8 (+14 ignorados), `git diff --check` e validação com os CLIs reais (os dois identificaram a cor da imagem) aprovados.
- [x] Roteador (Fase 11): perguntas sobre "esta tela" ou "esta imagem", e acompanhamentos que perguntam algo, agora são somente leitura e não exigem projeto (corrigido em 2026-10-29, com testes).

## Diagnóstico — aprendizados automáticos das tarefas (2026-10-29)

- **Causa confirmada:** o pipeline já está conectado em `TaskEngine → splitLearnings/review.learnings → brainAdmin.propose → LearningService`. O banco real continha 4 tarefas, 4 candidatos de aprendizado `pending` e 1 memória aprovada; os quatro candidatos pertenciam ao projeto `hepta` e tinham agente `claude`. O modo configurado nas preferências do Brain é `confirm`, portanto a extração ocorreu, mas a persistência definitiva depende da revisão na aba Aprendizados. Isso explica a diferença entre tarefas no Dashboard e memórias no Brain.
- **Sem backfill:** nenhuma tarefa antiga foi reprocessada e nenhum dado foi criado artificialmente.
- **Persistência comum:** Claude e Codex usam o mesmo callback `onLearnings`, `LearningService`, SQLite, deduplicação, detector de segredos e associação `projectId`.
- **Relações/similaridade:** a contagem real consultada mostrou 0 `embeddings`; por isso a busca semântica e as relações por similaridade não têm dados indexados. Isso é independente da fila de candidatos.
- **Ação segura:** revisar/aprovar os candidatos na aba Aprendizados fará o `LearningService` criar/mesclar memórias, disparar `onStored`, reindexar embeddings quando o provedor estiver disponível e atualizar as telas pelos canais já existentes. Não foi feita aprovação automática, pois isso mudaria a política `confirm` e poderia salvar hipóteses sem revisão.

## Melhoria — Diagnóstico de workspace, failover e orçamento de agentes

- [x] Pré-voo seguro no `TaskEngine` para tarefas de edição: valida existência, diretório, leitura/escrita/execução, cria e remove uma sonda temporária no workspace selecionado e registra shells disponíveis sem executar comandos.
- [x] Failover conservador para tarefas somente leitura em falhas classificadas como limite de uso, janela de contexto, autenticação ou indisponibilidade temporária. Falhas de permissão e tarefas de edição não são transferidas automaticamente.
- [x] Chat: painel de contexto exibe uso informado por Claude/Codex, limites de janela apenas quando o agente informa, orçamento global configurado e restante calculado somente a partir de tokens reportados.
- [x] Validação: 49 testes direcionados aprovados; lint, typecheck, build e `git diff --check` aprovados.

### Limitação comprovada desta validação

`D:\Dev\Hepta` existe e a leitura de ACL mostrou Modify para usuários autenticados; o processo atual é `phelipe\\pheli`; Claude Code 2.1.312 e Codex CLI 0.162.1 estão instalados e autenticados. A tentativa de iniciar a prova real de escrita em um subdiretório temporário foi rejeitada pela política do executor ao usar esse diretório como `cwd`. Portanto, a ACL e o preflight do processo principal foram comprovados, mas a escrita efetiva pelos dois CLIs e a distinção final entre ACL e sandbox ainda requerem execução local autorizada no PowerShell. Nenhuma permissão global, ACL ou configuração pessoal foi alterada.

**Evidência adicional recebida em 2026-10-29:** no PowerShell local, Claude Code criou `claude-probe.txt` com o conteúdo esperado no workspace temporário. O Codex CLI 0.162.1, executado com `sandbox_mode=workspace-write` sem a sobreposição `windows.sandbox="unelevated"`, falhou ao escrever `codex-probe.txt`; a tentativa subsequente de inspeção pelo terminal auxiliar também foi bloqueada (`helper_unknown_error: setup refresh had errors`). Isso confirma que a ACL/processo permite escrita e que o bloqueio observado é específico do sandbox/ambiente de execução do Codex nesse modo. O adaptador NeuralBridge já acrescenta `windows.sandbox="unelevated"` quando detecta `[windows] sandbox = "elevated"`; essa variante ainda precisa ser executada no PowerShell local para validar o caminho completo do aplicativo. A pasta de prova foi preservada pelo comando recebido e pode ser removida manualmente após a conferência.

**Validação concluída em 2026-10-29:** a mesma prova foi repetida no PowerShell com `sandbox_mode="workspace-write"` e `windows.sandbox="unelevated"`. O Codex criou `codex-probe.txt` com conteúdo exatamente igual a `CODEX_WRITE_PROBE`; a verificação local reportou `CODEX: ESCRITA VALIDADA`. Em conjunto com a escrita bem-sucedida do Claude na mesma pasta, isso separa a ACL do Windows do problema do sandbox elevado e confirma a correção já aplicada no adaptador NeuralBridge. A pasta temporária permanece fora do repositório NeuralBridge e deve ser removida manualmente quando não for mais necessária.

## Roadmap posterior

- [ ] Fase 20 — Memory Confidence (planejada)
- [ ] Fase 21 — Project Intelligence (planejada)
- [ ] Fase 22 — Token Intelligence (planejada)
- [x] Fase 23 — Visual QA (concluída)
- [x] Fase 24 — Agent Swarm (concluída)

## Correção crítica — travamento da sincronização de históricos (2026-10-29)

- **Causa comprovada no código:** leitura de transcrições JSONL (`readFileSync`), varredura SQLite (`better-sqlite3` síncrono), busca recursiva de arquivos Claude e extração eram executadas no processo principal; além disso, o `setInterval` podia iniciar uma nova execução enquanto a anterior ainda aguardava persistência.
- [x] Varredura e extração movidas para `history-sync-worker.ts` em worker thread.
- [x] Uma única execução ativa; chamadas manual e periódica concorrentes são ignoradas.
- [x] `AbortController` encerra worker ao pausar/desativar/encerrar o Electron.
- [x] Lotes reduzidos para 100 registros no worker e backpressure entre propostas no processo principal.
- [x] Checkpoints só são gravados após o lote ser processado; interrupção preserva o checkpoint anterior para retomada segura.
- [x] Erro isolado de sincronização é contabilizado e não derruba o processo principal.
- [x] Validação após correção: 9 testes direcionados, lint, typecheck, build e `git diff --check` passaram; o bundle agora contém `out/main/history-sync-worker.js`.
- [ ] E2E de travamento e métricas comparativas de latência/memória ainda não foram executados; não houve processamento de históricos pessoais.

## Importação de projetos e chats Codex (2026-10-29)

- [x] Criada a tabela `imported_conversations`, separada de `tasks`, para preservar chats externos sem contaminar o histórico de tarefas do NeuralBridge.
- [x] Importador incremental somente-leitura para `~/.codex/thread_history_1.sqlite`, agrupando itens por `thread_id`, usando títulos do `session_index.jsonl`, hash de conteúdo e redaction de segredos.
- [x] A associação a projetos só é feita quando existe caminho confiável no histórico; na amostra local, esse metadado não estava disponível, portanto as conversas foram mantidas como não associadas em vez de inferidas.
- [x] Execução real no banco local: 161 threads encontradas, 160 conversas persistidas, 0 associadas, 160 não associadas, 32 conteúdos com máscaras de segredo e 1 thread sem conteúdo importável.
- [x] Segunda execução real: 160 conversas reconhecidas como inalteradas e não reprocessadas.
- [ ] A interface ainda não lista o novo acervo de conversas importadas; a persistência e a importação estão concluídas, mas a apresentação dedicada permanece fora desta alteração incremental.

## Redesign do Dashboard (2026-10-29)

- [x] Dashboard reorganizado em grid responsivo com métricas reais de tarefas, sucesso, tokens reportados e memórias persistidas.
- [x] Adicionados estados verificáveis para Claude Code, Codex CLI, MCP, Neural Brain/RAG e sincronização de históricos.
- [x] Tarefas recentes e projetos ativos usam os serviços existentes, com loading, erro e estado vazio.
- [x] Filtro de período limitado aos dados carregados; nenhum percentual ou custo é inventado quando não há dados.
- [x] Validação: lint, typecheck, build e `git diff --check` passaram.
- [ ] Screenshots automatizados em resoluções desktop/reduzida não foram executados neste ambiente; a validação visual final requer abrir o Electron.

## Chat organizado por projeto (2026-10-29)

- [x] A sidebar do Chat agora agrupa conversas pelos projetos já existentes e mantém a seção `Sem projeto`.
- [x] Projetos e conversas exibem contagens, ordenação por atividade e recolhimento independente.
- [x] A busca continua usando título e prompts armazenados; ao selecionar um projeto, somente suas conversas são exibidas.
- [x] `Nova conversa` preserva o projeto selecionado via URL e o composer já grava a associação em `tasks.projectId`.
- [x] Renomeação, exclusão, continuidade entre agentes e histórico existente foram preservados.
- [x] Validação: lint, typecheck e `git diff --check` passaram; o build também foi executado durante a alteração.
- [ ] Mover uma conversa já existente entre projetos ainda não possui canal de persistência no contrato atual; não foi criado um segundo mecanismo nem uma alteração parcial de dados.

## Associação real de chats Codex a projetos (2026-10-29)

- [x] Corrigida a origem dos vínculos: `~/.codex/state_5.sqlite` fornece `projects`, `project_roots`, `threads.project_id` e `threads.cwd`.
- [x] O importador passou a criar somente projetos com raízes locais existentes e a reutilizar projetos NeuralBridge com a mesma raiz.
- [x] Execução real após a correção: 161 threads examinadas, 109 chats associados a projetos, 51 mantidos sem projeto por falta de evidência/caminho válido, 160 conversas reconhecidas como inalteradas e 1 thread sem conteúdo importável.
- [x] Nenhum histórico original foi alterado; a associação foi atualizada somente no banco NeuralBridge.

## Analytics com dados reais (2026-10-29)

- [x] A rota Analytics deixou de usar o placeholder da fase planejada.
- [x] A tela agora lê os tokens reportados pelas tarefas existentes e exibe entrada, saída, cache e distribuição por agente.
- [x] Estados de carregamento, erro e ausência real de tokens foram mantidos.
- [x] Validação: lint, typecheck, build e `git diff --check` passaram.

## Fase 20 — Memory Confidence (2026-10-29)

- [x] Adicionada a migração `0011_memory_confidence`, preservando o `trust` existente e introduzindo o estado de confiança `unverified`, `reviewed` ou `stale`.
- [x] Memórias agora expõem confiança e evidências rastreáveis; referências `task:`, `conversation:`, URLs e arquivos são registradas em `memory_sources` sem persistir transcrições completas.
- [x] Conteúdo alterado volta a `unverified`; memórias `stale` recebem prioridade menor no ranking híbrido e são sinalizadas na interface.
- [x] Adicionado canal IPC validado para revalidação manual da confiança, restrito ao processo confiável do Electron.
- [x] Teste específico de confiança/evidência adicionado; suíte unitária atual: **57 arquivos, 490 testes aprovados**; typecheck, lint, build e `git diff --check` aprovados.
- [x] E2E existente da área Memória: `tests/e2e/memory.spec.ts` **2/2** aprovados; build, typecheck, lint e `git diff --check` também aprovados.
- [x] Concluída em 2026-10-29: aprovação de aprendizado vira "validada", revalidação por evidência de arquivo (só rebaixa), confiança nos resultados de busca e aviso no contexto RAG, `source_ref` no `brain_store` do MCP, painel "Confiança" no Inspector. E2E `memory-confidence.spec.ts` 2/2, incluindo o servidor MCP real.

## Fase 21 — Project Intelligence

- [x] Concluída em 2026-10-29: perfil técnico por projeto (módulos do índice incremental, dependências de package.json/.csproj, decisões e problemas recorrentes das memórias), snapshot em `project_profiles` (migração 0012) com mudanças desde o anterior, contexto `profile://` nas tarefas do projeto, atualização após tarefas, ferramenta MCP `project_profile` e seção "Perfil técnico". E2E `project-profile.spec.ts` 2/2.
- [x] Índice de arquivos (RAG) passou a ser usado pelo app, com limites de 512 KB por arquivo e 5.000 arquivos.
- [x] Testes E2E quebrados pelas mudanças de Dashboard e histórico (v0.1.9/0.1.10) foram adaptados.

## Fases 25–30 — planejamento documental (2026-10-29)

- [x] Criados os subplanos `phase-25-git-intelligence.md`, `phase-26-auto-healing.md`, `phase-27-workflow-builder.md`, `phase-28-security-guardian.md`, `phase-29-mission-control.md` e `phase-30-video-studio.md`.
- [x] Dependências, reutilização da arquitetura, segurança, limites, testes, critérios de aceite, riscos e fora de escopo foram documentados.
- [x] A Fase 30 foi registrada como independentemente paralelizável quando TaskEngine, Skills, permissões e renderização isolada estiverem estáveis.
- [ ] Todas as seis fases permanecem **PENDENTES**; nenhuma implementação, migração ou dependência foi adicionada nesta tarefa.

## Fase 22 — Token Intelligence

- [x] Concluída em 2026-10-29: relatório de tokens por agente, etapa e projeto a partir do uso informado pelos agentes, estimativa de contexto rotulada, alertas reproduzíveis com recomendação (orçamento, contexto, repetição, revisões reprovadas, cache, tarefas sem métrica), orçamento por tarefa configurável e página Analytics refeita. E2E `token-intelligence.spec.ts` 2/2.

## Fase 25 — Git Intelligence

- [x] Concluída em 2026-10-29: histórico Git lido só para leitura e indexado por delta no índice RAG (commit e arquivo, com linha), sem segredos nem arquivos sensíveis, busca e relações com memórias e tarefas na página do projeto, e commits encontrados pelo `brain_rag_search` do MCP. E2E `git-intelligence.spec.ts` 1/1.
- [x] Interface visual adicionada em `/git-intelligence`: seletor de projeto, branches, grafo cronológico de commits, busca por hash/mensagem/autor/arquivo, detalhes, arquivos alterados e diff sob demanda. A interface reutiliza o leitor Git somente leitura e mantém a página de projeto existente.
- Validação: typecheck, lint, build e `git diff --check` passaram. A nova página ainda não possui E2E dedicado nesta execução; o E2E existente da Fase 25 permanece como evidência do fluxo MCP/indexação.

## Fase 28 — Security Guardian

- [x] Concluída em 2026-10-29: revisão de segurança determinística das alterações de cada tarefa que edita (credenciais, arquivos sensíveis, código e comandos perigosos, fora da raiz, CI, dependências, tamanho, lockfile), com bloqueio até a decisão do usuário quando o risco é alto. E2E `security-guardian.spec.ts` 2/2.

## Fase 26 — Auto-Healing Seguro

- [x] Concluída em 2026-10-29: correção limitada de tarefas que falharam (diagnóstico com evidência, aprovação, snapshot sem tocar no Git, correção, validação real por comando de lista fechada, até 3 tentativas e restauração dos arquivos quando não passa). E2E `auto-healing.spec.ts` 2/2.

## Fase 27 — Workflow Builder (concluída)

- [x] Schema estrito com DAG validado, dependências, limites de etapas e paralelismo.
- [x] Persistência versionada em `workflows` e acompanhamento em `workflow_runs`.
- [x] IPC, preload e página de Workflows integrados ao aplicativo.
- [x] Execução aprovada por camadas através do TaskEngine, com pausa, retomada, cancelamento idempotente e consulta de status.
- [x] Testes unitários do serviço: 4; contratos IPC do planner/controles: 24 no arquivo compartilhado; E2E de criação/persistência/aprovação: 1.
- [x] E2E Electron de pausa, retomada e cancelamento: 1 aprovado com agente controlado.
- [ ] Retomada após reinício e auditoria detalhada ainda pendentes.

## Fase 29 — Mission Control (concluída)

- [x] Página integrada à navegação, usando `tasks:list` como fonte única.
- [x] Filtros por status e busca, estados vazio/carregando/erro, cancelamento e acesso aos detalhes.
- [x] E2E de listagem e filtro: 1 aprovado.
- [x] E2E comprova recuperação de tarefa `running` persistida após reinício, com o TaskEngine marcando-a como falha e o Mission Control exibindo-a.
- [x] Mission Control usa o hook global de atualizações push coalescidas, com o banco como fonte única.
- [x] Pausa e retomada individual adicionadas ao TaskEngine, IPC e Mission Control; estado `paused` persistido na migração `0019_task_pause`.
- [x] E2E Electron de pausa, retomada e cancelamento de tarefa real aprovado.
- [x] E2E Electron comprova preservação de tarefa `paused` após reinício sem reexecução automática.
- [ ] Auditoria E2E de tarefas concorrentes ainda pendente.

## Fase 23 — Visual QA (concluída)

- [x] E2E reproduzível com Electron em 1280×800, 1024×768 e 800×700.
- [x] Capturas de evidência geradas por execução e verificação de ausência de overflow horizontal.
- [x] Comparação contra baselines versionadas adicionada com tolerância explícita de 1%; E2E aprovado em 3 resoluções.
- [ ] Fluxo de aprovação humana para atualizar baselines ainda pendente.

## Fase 24 — Agent Swarm (concluída)

- [x] Seleção determinística e limitada de especialistas por tipo de tarefa, sinais de segurança e orçamento.
- [x] Papéis arquitetos, desenvolvedor, QA, segurança e revisor exportados pelo orquestrador.
- [x] Testes unitários: 2 aprovados.
- [x] Plano de especialistas exposto pelo IPC `tasks:swarm-plan`, usando classificação e orçamento existentes.
- [x] O plano IPC agora também expõe handoffs estruturados, dependências e modo somente leitura por papel.
- [x] IPC `tasks:swarm-run` executa handoffs por camadas no TaskEngine, respeita dependências e exige aprovação para planos sensíveis.
- [x] `tasks:swarm-run` retorna consolidação por papel (`taskId`, status, resumo e erro).
- [x] E2E do fluxo de execução e consolidação com projeto isolado: 2 aprovados, incluindo múltiplas camadas e aprovação de segurança.
- [x] Auditoria determinística de conflitos por arquivo entre especialistas, com teste positivo e negativo.

## Conversas entre agentes e pastas com vários repositórios (2026-10-30)

- [x] Ao entrar em uma conversa, o agente recebe os turnos que perdeu (até 6), e quem volta retoma a própria sessão, mesmo depois de turnos de outro agente.
- [x] A leitura Git entende uma pasta que agrupa repositórios (`gitRepositories`, `gitChangedPaths`, `gitDiffFiles`). A revisão de segurança, a revisão do fluxo colaborativo e a detecção de mudanças por comando usam essa leitura.
- [x] Arquivo alterado sem diff legível vira achado médio `not_analyzed`, em vez de passar como limpo. "0 arquivos" agora aparece como "nenhuma alteração para revisar".
- Validação: Vitest em série com 72 arquivos e 600 testes; typecheck e lint; E2E `security-guardian`, `auto-healing`, `chat` e `projects` com 13 aprovados. Não validado com agentes reais no projeto Hepta.

## Fase 31 — Advanced Workflow Orchestration: 31.1 parcial (2026-10-30)

- [x] Macrofase registrada em `docs/PLAN.md`, com as subfases 31.1 a 31.4, e arquitetura em `docs/plans/phase-31-advanced-workflow-orchestration.md`.
- [x] Auditoria do código registrada. Divergência com a Fase 27: aprovação por etapa não é aplicada, cancelar não interrompe tarefas e a retomada após reinício não continua a execução.
- [x] Contrato v2 inicial, normalização v1, validação sem exceção, interpolação limitada/redigida e conversão grafo/definição.
- [x] TaskEngine com `access` explícito, timeout limitado, read-only fora da fila e sem fluxo collab; comportamento sem `access` preservado.
- [x] Migração aditiva `0020_workflow_v2`, schema Drizzle e atualização de banco testada.
- [x] Evidência: testes direcionados 64/64, banco 12/12, `npm run typecheck` e `npm run lint` aprovados.
- [ ] Pendente na 31.1: runner totalmente orientado a eventos/persistente, layout completo e E2E; editor visual, aprovação por etapa e controles IPC já possuem implementação inicial. 31.2–31.4 continuam parciais.
- [x] Runner ganhou contrato inicial testado por eventos: agenda dependências, libera a etapa seguinte após `completed` e propaga cancelamento; ainda não é o runner persistente exigido pelo portão.
- [x] Execução legada agora salva `definition_snapshot`, `definition_version`, `inputs` e encaminha `access`/`timeoutMs` por método interno do processo principal; teste de serviço 4/4 aprovado.

## Fase 32 — Smart Chat Agent Failover & Automatic Recovery (planejada em 2026-10-30)

- [ ] Escopo registrado: somente o Chat existente; não criar nova página, Mission Control, Workflow ou modo autônomo.
- [ ] Subfases planejadas: disponibilidade estruturada; checkpoints/handoff; failover e espera por capacidade; feedback nos componentes existentes do Chat; testes e validação.
- [ ] A implementação ainda não começou. Checkpoints incrementais e resumo técnico serão persistidos por etapa e reutilizarão o `TaskEngine` existente.
- Portões não concluídos: `npm run test:integration` falhou no teste preexistente de contagem de ferramentas MCP (esperava 9, recebeu 10); `npm run test:e2e` ficou bloqueado por `EPERM` ao limpar `apps/desktop/out/main/migrations` durante o build. Nenhum bypass foi usado.
- A linha de base confirma que as migrações `0013` a `0019` já estão no commit `b3a69b6`; não bloqueia a 31.1.

## Fases 31, 32 e 33 — implementação (2026-10-30)

Validação final na mesma árvore: Vitest em série, typecheck, lint e build aprovados; Playwright com 98 aprovados, 4 ignorados e 0 falhas; integração MCP com o total de 10 ferramentas corrigido no teste. Descoberta real em `D:\\Dev\\Hepta` pelo app empacotado, com banco isolado: nenhuma alteração na pasta.

**Fase 31**
- [x] Coordenador em `packages/orchestrator/src/workflow-runner.ts`, com estado no banco: aprovação por etapa, passagem de saídas, cancelamento e pausa propagados, retry com backoff, fallback, decisão humana e retomada após reinício. Substituiu o laço em memória e o runner anterior, que não estava ligado ao app.
- [x] Canvas real com `@xyflow/react` e `@dagrejs/dagre`, carregado sob demanda: blocos, conexões, propriedades, layout, estado por etapa e alternância com JSON.
- [x] Nove templates: os cinco pedidos e quatro de automação Git. Prévia, busca, categoria, favorito, exportação e importação.
- [x] Monitor Git: primeiro ref é ponto de partida, deduplicação persistida, concorrência, limite por hora, disjuntor, filtro por caminho. Painel em `/git-intelligence` e execução manual por commit ou branch. Etapas de edição disparadas por automação sempre esperam aprovação.
- [ ] Orçamento de tokens por execução não implementado; só o limite de duração.
- [x] Template 3: pendência encerrada; `validation.ts` já aceita `test:integration` e `test:e2e`.
- [ ] Sem E2E do painel de automações; o monitor tem testes unitários.
- [ ] Favoritos são gravados, mas a galeria não os destaca.
- Autonomous Mission Mode (`autonomous-mission.ts`) está no código, fora do plano. Não foi revisado nem exposto ao usuário.

**Fase 32**
- [x] Disponibilidade estruturada, handoff limitado e redigido, troca automática só no modo Automático, espera por capacidade com tempo só quando informado, retomada após reinício sem duplicar e aviso no Chat.
- A espera usa o status `paused` e a tabela `task_capacity_waits` (migração `0025`): um status novo exigiria recriar `tasks` e `task_steps` por causa do `CHECK`.
- Não validado com limites reais dos provedores: a leitura do limite usa o texto que as CLIs devolvem hoje.

**Fase 33**
- [x] Hierarquia, tipos derivados, descoberta somente leitura, overrides, árvore, prévia, Novo Projeto, `git init`, clone, Git por repositório, RAG com dono único, tarefas multiprojeto, fila por pasta e Chat por ID.
- [ ] `brain_rag_search` do MCP ainda busca um projeto por vez; a busca de workspace vale no app e nos nós RAG.
- [ ] Mudar de pai depois de indexar só redistribui o índice na próxima atualização do perfil.
- Na descoberta do Hepta, `suporte-ms` aparece como auxiliar, com o projeto real em `suporte-ms/suporte-ms`, e `INS` não tem manifesto.

**Incidente:** ao substituir o runner, a remoção de `packages/orchestrator/test/workflow-runner.test.ts` foi bloqueada, mas uma escrita enviada junto sobrescreveu o arquivo, sem commit e de outra sessão. Esse conteúdo foi perdido. Antes das demais alterações, uma cópia dos arquivos pendentes foi salva em `C:\\dev\\neuralbridge-backups\\before-phase-completion-2026-10-30`.

## Velix substitui o Video Studio — 2026-10-30

- [x] `packages/workspace/src/velix.ts`: detecção do kit, modelos allowlisted, confinamento à raiz, um render por vez, progresso e cancelamento da árvore de processos.
- [x] Rota `/video` agora exibe a página Velix; `/video` no Chat preenche a ideia. Removidos os domínios de composição, projetos e assets do Studio e seus IPCs.
- [x] Render real com o kit v2.7.3 (`logo-reveal`, motion blur): 3 prévias e MP4 H.264 1080×1920 com AAC, 5,6 s, gerado em 16 s. Cancelamento real: 7 processos antes, 0 depois.
- [x] E2E com kit falso: `video.spec.ts` 5/5. O bug do Playwright no Windows só apareceu no render real.
- [x] Importação com `yt-dlp` para `imports/`, com confirmação de direito de uso. Teste real com MP4 servido em localhost: vídeo e MP3 aprovados. Download do YouTube não testado.
- [ ] Fluxo "Começar com o Velix" com agente real e skill habilitada: não testado.
- [ ] Decidir a remoção das tabelas sem uso `video_projects`, `video_compositions` e `video_assets`.
- Backup do Studio, que não tinha commit: `C:\dev\neuralbridge-backups\video-studio-2026-10-30`.
- Decisões em [phase-30-video-studio.md](plans/phase-30-video-studio.md#19-velix-motionvelix).

## Fase 33 — Hierarquia de Projetos, Workspaces e Detecção Inteligente (planejada em 2026-10-30)

- [x] Fase registrada em `docs/PLAN.md`, com as subfases 33.1 a 33.7, e arquitetura em `docs/plans/phase-33-project-hierarchy-workspaces.md`.
- [x] Regras de detecção Git e de criação de projetos incluídas no planejamento.
- [x] Auditoria registrada: `hepta` e `INS` já estão cadastrados e sobrepostos, e uma tarefa em `hepta` alcança o `INS`, de nível Padrão, sem checagem de permissões.
- Decisão do usuário (2026-10-30): Acesso total em workspace continua alcançando todos os filhos, com aviso na interface (D6).
- Antes da 33.1: decidir o commit do trabalho em andamento das Fases 31 e 32.
- [x] Correção (2026-10-30): a descoberta só era alcançável por "Detectar projetos" na lista, e um projeto já cadastrado como `Hepta` não mostrava filhos. A tela do projeto ganhou a seção Subprojetos, com detecção a partir da própria pasta e aviso de Acesso total (D6). Detectar a partir de um filho não o solta mais do workspace. Validado com `project-hierarchy.test.ts`, `project-discovery.test.ts` e E2E de hierarquia. Varredura real em `D:\Dev\Hepta`: workspace e 13 repositórios pré-marcados; `INS` fica em pastas auxiliares por não ter manifesto.

## Fase 30 — Video Studio (concluída, substituída pelo Velix)

- [x] Domínio inicial de composição e plano de renderização determinístico.
- [x] Validação de resolução, FPS, duração, hashes, tamanho e confinamento de assets à raiz autorizada.
- [x] Renderizador local não-shell adicionado: argumentos FFmpeg limitados, saída MP4 confinada e cancelamento por AbortSignal.
- [x] Serviço de jobs impede renderizações concorrentes e expõe cancelamento/estado sem criar uma segunda engine.
- [x] IPC `video:validate` e página Video Studio conectados ao domínio real, com estados de validação e erro.
- [x] Migração `0015_video_projects` e serviço de persistência versionada de projetos/composições adicionados; a UI ainda não expõe o CRUD completo.
- [x] IPC e UI agora expõem listagem/salvamento de projetos e composição versionada.
- [x] E2E Electron com banco isolado comprova validação e persistência de projeto/composição: 1 aprovado.
- [x] Integração real com FFmpeg local: geração de fonte e exportação MP4 em diretório temporário, 1 teste aprovado.
- [x] Exportação MP4 real pela UI Electron, com `FFMPEG_PATH` restrito ao processo de teste: E2E Video Studio 2/2 aprovado.
- [x] Cancelamento real do processo FFmpeg aguardando o encerramento do filho antes da limpeza: integração 2/2 aprovada.
- [x] IPC/UI de renderização agora retorna job, consulta estado e permite cancelar enquanto o FFmpeg está em execução.
- [x] Jobs de renderização persistidos em `video_render_jobs`; jobs `running` são recuperados como falhos após reinício, sem reexecução automática.
- [x] Timeline visual derivada da composição exibe cenas, áudio e legendas sem duplicar o modelo de execução.
- [x] Biblioteca de mídia persistida com importação segura, hash SHA-256, limite de tamanho e rejeição de traversal; E2E cobre importação real.
- [x] E2E cobre recuperação de job interrompido após reinício do Electron: Video Studio 3/3 aprovado.
- [x] Comando `/video` no Chat encaminha instruções ao Video Studio; E2E Chat → Video Studio aprovado.
- [x] Jobs registram origem (`studio`/`chat`) e agente (`auto`/`claude`/`codex`) na migração `0018_video_render_audit`, com exibição na lista de renderizações.
- [x] Validação de regressão após auditoria: suíte Vitest 71 arquivos/560 testes, typecheck, lint, build e `git diff --check` aprovados.
- [x] E2E dedicado comprovando render iniciado pelo Chat e persistência do agente selecionado; suíte Video Studio: 5/5 aprovada.
- [x] Instruções `/video` geram composição editável delimitada, com legenda e timeline determinísticas; teste de domínio aprovado.
- [x] Preview MP4 real após render concluído, com IPC confinado à raiz autorizada, limite de 100 MB e elemento `<video>` validado no E2E.

### Validação consolidada até a Fase 30 — 2026-10-29

- Vitest: 71 arquivos, 563 testes aprovados.
- Typecheck, lint, build e `git diff --check`: aprovados após as últimas alterações.
- E2E direcionados de Mission Control e Video Studio: 9/9 aprovados.
- A causa do timeout do banco corrompido foi corrigida: `workflows.recover()` era chamado sem banco após a inicialização degradada. O E2E correspondente agora passa em 0,8s.
- Suíte E2E completa final: 88 aprovados, 4 ignorados e 1 falha temporal no teste de câmera do Brain 3D (`back < rotation/2` após 1,5s); o teste passa isoladamente com retry controlado. Os testes de imagens e banco corrompido passaram na suíte final. A validação de bytes permanece implementada em `storeImages`.
- A Fase 30 atende os critérios documentados: instrução no Chat → composição editável → preview/render MP4 cancelável e auditável, com isolamento de arquivos. A suíte Video Studio direcionada passou 5/5.
- [x] Testes unitários: 4 aprovados.
- [x] Timeline validada para faixas de áudio e legendas, com limites de duração, volume, texto e referências a assets.
- [ ] Biblioteca, preview, worker de render, cancelamento, UI/timeline, áudio/legendas e E2E ainda pendentes.

### Validação desta execução — 2026-10-29

- Suíte Vitest completa: 70 arquivos, 554 testes aprovados.
- Typecheck completo, lint, build e `git diff --check`: aprovados.
- O Workflow Builder recebeu cancelamento persistido/idempotente e validação IPC do planner; a fase permanece aberta pelos critérios de auditoria e E2E documentados.
### Fase 31 — validação desta execução (2026-10-30)

- O serviço de workflows agora persiste `workflow_run_steps`, aguarda/aprova cada etapa com `requiresApproval`, registra estados de etapa e propaga pausa/cancelamento ao TaskEngine quando disponível.
- A tela de Workflows agora oferece edição visual básica de nós, propriedades, dependências e alternância JSON; templates embutidos também estão expostos por IPC para instanciação.
- Implementados e testados nesta rodada: executores reais RAG/validation/Git somente leitura, leitura segura de refs e `diff-range`, runtime de automação Git sem sobreposição/dedupe, política pura de retry/fallback, cinco templates versionados e migrações aditivas 0021–0023.
- A galeria inicial de templates agora aparece na tela de Workflows e instancia definições v2 pelo IPC; também há busca, favorito, importação/exportação JSON e persistência de layout via IPC.
- O runner agora persiste snapshots por transição e recupera um run interrompido sem duplicar tarefas ativas; o modo Autonomous Mission Mode persiste estado, inicia dependências automaticamente, valida aceite, limita tentativas/tempo/custo e diferencia pausa/cancelamento/bloqueio/falha.
- A migração `0024_autonomous_missions` e as tabelas Drizzle correspondentes foram adicionadas; `git_automations`, `git_automation_events` e `git_ref_cursors` também passaram a ter schema tipado.
- Verificações: suíte Vitest completa 81 arquivos/626 testes aprovada, `npm run typecheck` aprovado e testes direcionados do runner, banco e missão aprovados.
- Pendências críticas para concluir a macrofase: ligar o runner e o modo de missão ao processo principal/TaskEngine; retry/fallback/checkpoints transacionais e timeline; integração completa IPC/UI de automações; monitor Git persistido; favoritos/importação/exportação/layout da galeria; E2E completo e validações externas.
- Nesta continuação, eventos reais de status do TaskEngine passaram a atualizar `workflow_run_steps`; o modo de missão autônoma foi conectado à inicialização, recuperação e eventos do processo principal; o monitor Git passou a ler automações, salvar cursores/eventos no SQLite e disparar workflows periodicamente sem sobreposição.
- A galeria ganhou busca, favorito persistido, importação/exportação JSON e canais IPC para salvar layout. O E2E de workflows foi corrigido para manter o editor JSON acessível por padrão e passou 2/2; Git Intelligence passou 1/1.
- Verificações adicionais: suíte Vitest completa 82 arquivos/627 testes, E2E de workflows 3/3, E2E Git Intelligence 1/1, lint, typecheck, build e `git diff --check` aprovados.
- Ainda pendente para fechar a macrofase: usar `workflow_checkpoints`/`workflow_step_attempts` em transações reais dentro do TaskEngine/runner (o schema e adaptador existem), retry/fallback completos, timeline, layout visual efetivamente renderizado, IPC/UI de configuração do Git e a suíte E2E completa/validações externas.
- O serviço de workflows agora grava checkpoints versionados no início e na entrada de cada camada, e os eventos do TaskEngine atualizam as etapas persistidas. A validação final desta rodada passou em testes direcionados, lint, typecheck, build e `git diff --check`; as pendências acima permanecem explicitamente abertas.
- O TaskEngine agora agenda retry limitado com backoff/jitter e evento `retry_scheduled` para falhas transitórias somente em tarefas read-only; failover read-only existente continua tendo precedência quando outro agente está disponível, e tarefas de edição não são repetidas automaticamente.
- A recuperação de workflows agora retorna e persiste `layout` no contrato IPC; a tela carrega esse layout ao reabrir, enquanto a representação visual de nós ainda precisa aplicar posições no canvas.
- Regressão validada após o retry: suíte Vitest completa 82 arquivos/627 testes aprovada; typecheck e lint também aprovados.
- Nesta continuação, claims de etapas passaram a usar `workflow_step_attempts` dentro de transação SQLite antes de iniciar tarefas; timeline ganhou IPC; o canvas aplica posições persistidas ao reabrir e permite mover nós para atualizar o layout.
- Validação final desta continuação: suíte Vitest 82/627, typecheck, lint e `git diff --check` aprovados.

## Fase 34.1 — Velix: projeto Video e nova interface (2026-10-30)

- [x] Projeto Video guardado em preferências, pastas por vídeo e modos tema e projeto.
- [x] Página em abas com ficha do vídeo; Render e Importar mostram o que falta.
- [x] Validação: typecheck, lint de `features/video`, build, 9 E2E em `tests/e2e/video.spec.ts`; suíte unitária com 746 testes.
- [x] 34.5: plano de captura somente leitura, comando confirmado, captura web e Electron, revisão obrigatória dos prints; validada com E2E de janela real e com o NeuralBridge real.
- [x] 34.2: Extra Narração ElevenLabs, prompt com `elevenlabs.txt`, parada para o áudio manual e aviso na ficha do vídeo.
- [x] 34.3: nicho, sugestão de temas por agente somente leitura e preenchimento da ideia.
- [x] Correção: os chips com campo `sr-only` esticavam a janela e criavam dois scrolls; há E2E que falha sem a correção.
- [x] 34.3 validada com o Claude Code real; o Codex real não foi exercitado.
- [x] 34.4: pesquisa com o Claude limitado à web, aprovação na tela, download e `fontes.md` feitos pelo app; validada com o Claude Code real.
- [ ] Clique em Começar com referências aprovadas: não coberto por E2E, que testa a seleção e o salvamento separadamente.
- [ ] Tarefa real com a skill motionvelix no projeto Video, incluindo a narração, ainda não executada pelo novo fluxo.

## Fase 35 — Velix: Estúdio e modelo Dossiê (2026-10-30)

- [x] Modelo Dossiê no app, com blocos de dados, usando só motor, fontes e sons do kit.
- [x] Estúdio na aba do Velix: roteiro, narração, sincronia com a voz, editor de cenas, prévia e render, sem passar pelo Chat.
- [x] Durações de até 3 minutos.
- [x] Velix só com Claude, com bloqueio a 95% no processo principal e barras de sessão e semana lidas da CLI.
- [x] Validado com Claude Code real e voz real, em cópia: roteiro, transcrição, render e -15,1 LUFS.
- [ ] Estúdio real pela interface instalada e vídeo de 3 minutos ainda não executados.

## Fase 36 — Velix AI Video Discovery & Autonomous Production (2026-10-31)

- [x] 36.1: auditoria dos planos/código das Fases 30, 34 e 35; o fluxo existente de pesquisa Claude, projeto Video, Dossiê, sincronização e render foi mantido como base, sem segundo editor.
- [x] Contratos aditivos de direitos, referências deduplicadas e sugestões de intervalos observáveis em `packages/workspace/src/velix-discovery.ts`, com 4 testes unitários TDD aprovados.
- [ ] 36.2–36.8: persistência SQLite/IPC/UI, adaptador oficial de metadados YouTube/notícias, geração de ideias, Rights Manager integrado, análise FFprobe/FFmpeg, modos compilação/notícias e E2E ainda pendentes.
- Validação desta execução: teste direcionado `packages/workspace/test/velix-discovery.test.ts` 4/4 e typecheck completo aprovados. Não declarar a Fase 36 concluída.
- [x] Lote seguinte: migrações aditivas 0028–0035 e `VelixDiscoveryRepository` para buscas, referências, direitos e sugestões de clipes; 13 testes de banco aprovados.
- [x] Adaptadores reais de YouTube Data API e RSS/Atom em `packages/orchestrator/src/velix-discovery-adapters.ts`, com estados de credencial ausente, offline, HTTP inválido e resposta válida; 3 testes aprovados.
- Validação do checkpoint: regressão dos pacotes database/workspace/orchestrator, 44 arquivos/428 testes aprovados; typechecks dos três pacotes aprovados. IPC, UI, FFprobe/FFmpeg e E2E continuam sendo o próximo lote.
- [x] IPC/preload e handlers de descoberta adicionados com contratos Zod, isolamento pelo projeto Video e timeout de 30 s; credenciais YouTube permanecem somente no processo principal.
- [x] Aba visual Velix Descobrir/Rights Manager/Clip Hunter adicionada; pesquisa real YouTube/RSS persiste referências, Rights Manager exige evidência/data para autorização, e Clip Hunter não simula análise ausente.
- Validação deste lote: typecheck main/renderer aprovado, testes direcionados 8/8 aprovados e build anterior aprovado. Suíte completa, E2E, FFprobe/FFmpeg e produção audiovisual ainda pendentes.
- [x] Clip Hunter real: `velix-clip-hunter.ts` executa FFprobe/FFmpeg sem shell, extrai duração, resolução, FPS, codecs, streams, mudanças de cena e silêncios; exige `verified_allowed`, confina caminhos e suporta AbortSignal.
- [x] Persistência de assets/análises nas migrações 0036–0039; o processo principal cria jobs de análise, calcula SHA-256, registra evidência, salva cortes e expõe status/cancelamento por IPC/preload.
- [x] UI Clip Hunter conectada ao job real, com caminho relativo, evidência obrigatória, progresso, erro e sugestões persistidas; nenhum resultado é simulado.
- [x] Validação desta execução: FFmpeg/FFprobe sintético 3/3, banco 13/13, regressão direcionada 23/23, typecheck completo, build e lint aprovados; E2E Clip Hunter/Descoberta 2/2 aprovados.
- [ ] E2E completo de Rights Manager, isolamento entre múltiplos projetos, seleção/ajuste/aprovação de cortes na timeline e exportação MP4 pós-Clip Hunter ainda pendentes. Próximo passo: conectar cortes aprovados à timeline Velix e validar render real ponta a ponta.
- [x] Timeline de cortes: `velix-clip-render.ts` concatena intervalos aprovados com `trim/atrim`, preserva o arquivo fonte, valida direitos/limites e verifica o MP4 final via FFprobe.
- [x] IPC/UI: cortes podem ser aprovados/rejeitados e ajustados em in/out; render de cortes aprovados expõe job/status/cancelamento e exige asset persistido com direitos verificados.
- [x] Validação ponta a ponta: teste FFmpeg sintético 2/2, E2E Descobrir/Clip Hunter 3/3, incluindo análise, aprovação, render e FFprobe do MP4; build aprovado.
- Validação de regressão: 100 arquivos/818 testes aprovados; duas falhas temporais não relacionadas ao Velix (`apps/desktop/test/project-hierarchy.test.ts` e `packages/orchestrator/test/multi-project.test.ts`, timeout de 5 s). Lint e typecheck aprovados; `git diff --check` mantém apenas a linha em branco preexistente de `docs/PLAN.md`.
- [ ] Preview inline do trecho original, reordenação visual persistida, integração formal com a timeline do Estúdio, narração/ElevenLabs, ideias/agentes, compilação comentada, noticiário e E2E de reinicialização ainda pendentes. Próximo passo: adicionar preview/reordenação e integrar a composição Velix antes da produção narrada.
- [x] Nesta continuação: migração aditiva 0040 (`order_index`), repositório com reordenação por projeto, contratos IPC/preload para reordenação e preview, validação de direitos/duração no update e preview MP4 temporário em data URL com limpeza segura.
- [x] O domínio do Estúdio ganhou `appendVelixClipScenes`, mantendo a timeline existente e registrando fonte, in/out, duração e direitos nos blocos de vídeo; testes unitários do helper incluídos.
- [ ] Ainda pendente nesta continuação: botão de drag-and-drop por item (a UI expõe apenas reordenação persistida via ação), handler que envia cortes aprovados ao Estúdio, associação efetiva da narração importada ao render de clips e E2E de preview/reinício/narração. Próximo passo exato: criar `videoClipSendToStudio` reutilizando `loadVelixVideo/saveVelixVideo`, depois testar render com `studioRender` e áudio `narracao/voz.*` validado por FFprobe.
- [x] Handler `videoClipSendToStudio` e preload/UI adicionados: exige asset e cortes aprovados com `verified_allowed`, usa a ordem persistida e `appendVelixClipScenes()`, atualizando o `roteiro.json` do vídeo existente.
- [ ] Drag-and-drop por item e controles de áudio/narração ainda não foram concluídos; o fluxo de Estúdio já reutiliza a descoberta de `narracao/voz.*` e `studioRender`, mas falta E2E real do envio, reinicialização e MP4 narrado.
- [x] Renderer FFmpeg ampliado para mixar narração autorizada com áudio original, com atraso, volumes independentes, duração limitada à sequência de cortes e validação de stream/arquivo final via FFprobe. IPC/preload e Clip Hunter expõem esses parâmetros.
- [x] Teste com vídeo e narração sintéticos gerados por FFmpeg passou; regressão direcionada Velix passou 18/18; typecheck, lint e build passaram.
- [ ] Ainda pendente: drag-and-drop por item com teclado, E2E completo do fluxo Clip Hunter→Estúdio→narração→MP4 e verificação de conteúdo da narração no áudio final (além da presença de stream). Compilação comentada, noticiário e geração de ideias também permanecem abertas.
- [x] Drag-and-drop individual implementado em `ClipOrderPanel`, com alternativa de teclado por botões mover para cima/baixo, persistência via `videoClipReorder` e restauração pela ordenação SQLite (`order_index`).
- [x] Validação de sinal da mixagem ampliada: o teste gera voz e vídeo reais com FFmpeg, valida vídeo/áudio/duração e confirma que o MP4 misturado difere do render somente com áudio original.
- [x] E2E existente `tests/e2e/velix-discovery.spec.ts`: 3/3 aprovados, incluindo análise real, bloqueio de arquivo inexistente e exportação MP4 validada.
- [x] E2E adicional: envio Clip Hunter→Estúdio passou, com `roteiro.json` persistido contendo bloco `video`, `src`, timestamps `in/out`, duração implícita, fonte e `rights: verified_allowed`; o projeto foi preparado e carregado novamente pelo IPC.
- [ ] Ainda não há evidência E2E de fechamento/reabertura do processo Electron, isolamento entre dois projetos, render narrado pelo handler de clips e análise de conteúdo espectral da voz no MP4; estes fluxos continuam pendentes.
- Auditoria de produção: geração de temas (`video:topics`), pesquisa Claude (`video:research`) e geração de roteiro/cenas (`video:studio:generate`) já são serviços reais das Fases 34/35 e foram preservados. Compilação comentada e noticiário verificável ainda não possuem módulos dedicados nem devem ser marcados como concluídos.
- [x] Suíte Vitest completa nesta execução: 102 arquivos / 823 testes aprovados. Typecheck, lint e build aprovados; E2E direcionado de descoberta/Clip Hunter/Estúdio 4/4 aprovado.
- [x] Contratos reais dos modos `commentary` e `news` em `packages/workspace/src/velix-production-modes.ts`, expostos pelo IPC `video:production:brief`; testes 4/4 cobrem direitos, URLs verificáveis e classificação de alegações.
- [ ] Os modos ainda não têm tela dedicada, persistência de versões/decisões, chamada de agente para comentários/noticiário ou E2E de MP4 próprio; o IPC gera apenas o brief seguro que deve alimentar `studioGenerate` mediante aprovação humana.
- Validação deste lote: teste de modos 4/4, typecheck, lint e build aprovados; `git diff --check` continua apontando apenas `docs/PLAN.md:1667` preexistente.
- [x] Área `Produzir` adicionada ao Velix com Compilação Comentada e Noticiário Verificável, seleção de materiais persistidos, visualização de brief, aprovação humana obrigatória e envio ao `studioGenerate` existente.
- [ ] A UI atual lista os clipes aprovados e as referências persistidas, mas ainda não persiste versões/decisões editoriais como entidades próprias nem gera comentários/noticiário por um agente dedicado; o roteiro final depende do serviço real de roteiro do Estúdio e ainda não há E2E de MP4 específico dos dois modos.
- Validação deste lote: 4/4 testes de produção, typecheck, lint e build aprovados. Não declarar Compilação/Noticiário concluídos sem E2E real, persistência editorial e MP4 validado.
- [x] Persistência editorial adicionada nas migrações 0041–0043: ideias, versões imutáveis de brief/roteiro e decisões por projeto; aprovação fica vinculada à versão e nova versão nasce não aprovada.
- [x] IPC/preload editorial adicionado; a aba Produzir salva o brief como versão, restaura a contagem editorial e só envia o roteiro ao `studioGenerate` após decisão aprovada.
- Validação deste lote: repositório editorial 2/2, modos 4/4, typecheck e lint aprovados; build anterior do mesmo lote aprovado; `git diff --check` mantém somente `docs/PLAN.md:1667` preexistente.
- [ ] Ainda pendente: versões de roteiro geradas por agente persistidas como `script`, E2E dos modos até MP4, reinicialização/isolamento, narração verificável e validação final dos critérios 36.3/36.7.
- [x] Migração 0044 adiciona `source_version_id`; o retorno real de `studioGenerate` agora é persistido pela aba Produzir como versão editorial `script`, vinculada ao brief aprovado e iniciada não aprovada.
- [x] A interface permite aprovar a versão de roteiro gerada; decisões usam o IPC editorial existente e versões continuam imutáveis.
- Validação deste lote: repositório editorial 2/2, modos 4/4, typecheck e lint aprovados; build do lote aprovado antes da correção de tipagem opcional; `git diff --check` mantém apenas `docs/PLAN.md:1667` preexistente.
- [ ] Ainda pendente: garantir no backend que somente script aprovado seja enviado ao Estúdio, associar metadados de agente/execução, E2E com agentes reais ou registrar indisponibilidade, render MP4 dos dois modos, reinicialização, isolamento e validação espectral da narração.
- [x] Bloqueio backend editorial implementado: `getApprovedScript()` exige script aprovado, brief de origem aprovado, projeto correto e conteúdo idêntico; `decideEditorial()` impede aprovar script sem brief aprovado.
- [x] IPC `video:production:render` adicionado; valida a versão antes de usar o renderer Velix existente e a aba Produzir só habilita render após aprovação do script.
- Validação deste lote: repositório editorial e modos 6/6, typecheck, lint e build aprovados; `git diff --check` mantém apenas `docs/PLAN.md:1667` preexistente.
- [ ] Ainda pendente: metadados reais de agente/execução, cenas especializadas por modo, E2E de bloqueio/render/reinicialização/isolamento e MP4 real dos dois modos com narração validada.
- [x] `productionRender` agora é o caminho seguro para render de produção: exige `scriptVersionId` aprovado, brief aprovado e conteúdo idêntico antes de chamar o renderer Velix.
- [x] Teste de persistência confirma aprovação encadeada brief→script e rejeita alterações de versão; typecheck, lint, build e testes direcionados aprovados.
- [ ] Ainda pendente: metadados de agente/modelo/execução, transformação especializada de cenas/commentários/fontes no Dossiê, E2E de dois modos até MP4, reinicialização/isolamento e análise espectral da narração.
- [x] Migração aditiva 0045 adiciona metadados opcionais de agente, modelo, execução e geração às versões editoriais; valores permanecem nulos quando `studioGenerate`/provider não os fornece.
- [x] `productionRender` exige o script aprovado e transforma cenas em blocos suportados pelo Dossiê, adicionando atribuições das referências sem inserir mídia não autorizada; testes de repositório/cenas/modos 8/8, typecheck e lint passaram.
- [ ] Pendência crítica: o renderer Dossiê existente não compõe clipes de vídeo como blocos `video`; ainda é necessário conectar os clipes autorizados ao pipeline FFmpeg de timeline e validar MP4 real dos dois modos, áudio narrado por sinal, E2E de reinicialização/isolamento e proveniência real de agentes quando disponível.
- [x] O handler `video:production:render` agora reutiliza `renderVelixClipTimeline` quando há asset local persistido `verified_allowed` e cortes aprovados, respeitando `order_index` e a narração importada; sem asset elegível, mantém o caminho Dossiê sem inventar mídia.
- Validação deste lote: renderer sintético 7/7, typecheck, lint e build desktop aprovados. A suíte Vitest completa foi iniciada, mas permaneceu emitindo warnings de normalização de fim de linha sem concluir dentro da janela; não é considerada aprovada. E2E de reinicialização/isolamento e MP4 específico dos dois modos ainda não foram comprovados.
- [ ] E2E de reinicialização, envio ao Estúdio, narração importada com controles e isolamento entre projetos ainda não foi executado; geração de ideias, compilação comentada e noticiário continuam pendentes.
- `git diff --check` mantém somente a linha em branco preexistente em `docs/PLAN.md:1667`.
- Investigação separada dos timeouts: `project-hierarchy.test.ts` passou isoladamente (14/14 em 14,00 s) e `multi-project.test.ts` passou isoladamente (8/8 em 8,08 s), confirmando sensibilidade ao timeout/concorrência da suíte, sem alteração dos testes.
- Validação deste checkpoint: 14 testes Velix direcionados, dois testes temporais isolados, typecheck, lint e build aprovados; `git diff --check` mantém apenas a linha em branco preexistente em `docs/PLAN.md`.
- [x] Correção de regressão IPC: `video:production:editorial:version` agora retorna somente `{ id, version }`, conforme o contrato estrito; o registro completo continua persistido.
- [x] E2E editorial local real: Compilação Comentada e Noticiário Verificável passaram até MP4 via `video:production:render`, com aprovação obrigatória, asset/cortes `verified_allowed`, narração AAC, FFprobe, bandas espectrais e `editorialVersionId` retornado no resultado.
- [x] Reinicialização/isolamento E2E: 7/7 testes em `velix-discovery.spec.ts`; o projeto recupera versões aprovadas após nova instância Electron e um projeto não lê nem renderiza o script aprovado de outro.
- [x] Suíte completa: Vitest 104/104 arquivos e 831/831 testes em 129,08 s; Playwright 118/122 aprovados, 4 ignorados por dependências/credenciais externas, 0 falhas. Typecheck, lint e build aprovados.
- [ ] Matriz final: composição local determinística, direitos, aprovação editorial, MP4, áudio e recuperação estão CONCLUÍDOS; pesquisa externa sem credencial, execução real Claude/Codex e persistência de referências RSS específicas nos E2E permanecem PARCIAIS/DEPENDENTES de ambiente. `git diff --check` mantém somente `docs/PLAN.md:1667`, linha em branco preexistente.
- [x] Teste de mixagem ampliado com sinais sintéticos reais: 440 Hz no áudio original e 880 Hz na narração; após AAC, `volumedetect` com filtros de banda confirmou ambas as frequências acima de -45 dB. O teste passou 4/4.
- [x] E2E `tests/e2e/velix-discovery.spec.ts` executado com Playwright: 4/4 aprovados, incluindo FFmpeg/FFprobe real, direitos, render MP4 e recuperação do `roteiro.json`.
- [ ] A suíte Vitest completa foi executada com `--no-file-parallelism --testTimeout=15000 --hookTimeout=15000`, mas permaneceu emitindo warnings de processos Git sem concluir e foi interrompida; portanto não é aprovação. Ainda faltam E2E específicos de Compilação Comentada/Noticiário via `video:production:render`, reinicialização real do Electron, isolamento entre projetos e evidências de MP4 desses modos.

### Homologação final — 2026-10-31

Veredito: **não concluída**. A 36.3 tem lacuna de implementação (não é só homologação externa), e dois critérios dependem de recurso externo. Os demais fluxos locais estão aprovados.

| Critério | Estado | Evidência ou motivo |
|---|---|---|
| RSS/Atom com fontes públicas | CONCLUÍDO | BBC 37, NASA 10, g1 100, GitHub Releases 10, The Verge 10 e arXiv 3 itens reais, sem CDATA nem URL inválida após as correções. |
| Persistência e recuperação de referências | CONCLUÍDO | E2E `NB_REAL_FEEDS=1` com feed da BBC: UI, busca repetida sem duplicar, novo processo Electron, Produzir e brief com título, data e URL. |
| Metadados reais do provider | PARCIAL | Codex: `agent=codex`, `executionId` real, `model=null` (o CLI não informa e o parser mantém nulo). Claude no fluxo de roteiro: BLOQUEADO, ver abaixo. |
| Adaptadores Claude e Codex | CONCLUÍDO | `agents-real.test.ts` 8/8 com CLIs logados: detecção, edição, read-only e cancelamento. |
| Roteiro real via Codex | INSTÁVEL | `velix-script-real.test.ts` passou 2 de 3 execuções; a causa da falha não foi capturada. |
| Roteiro real via Claude pela UI | BLOQUEADO (externo) | O app recusou: "O limite semanal do Claude está em 97%". A trava de 95% não foi contornada. Repetir com `NB_REAL_CLI=1 NB_REAL_FEEDS=1`, teste "roteiro real". |
| YouTube Data API | BLOQUEADO (externo) | `NB_YOUTUBE_API_KEY` ausente. Só o estado de indisponibilidade foi validado; nenhuma busca real foi executada. |
| Ideias (36.3) | PENDENTE (implementação) | Não existem as ações Gerar ideias, Gerar mais, Surpreenda-me e Investigar na interface do Velix. |
| Classificação fato/alegação no Noticiário | PARCIAL | Referências de feed agora entram como `não verificado`; ainda não há controle na interface para reclassificar item. |

Defeitos reais encontrados e corrigidos nesta homologação:

- Títulos em CDATA e URLs com `&amp;` saíam crus (BBC 37/37, The Verge 10/10). Entidades numéricas, data inválida, link não web e link Atom `rel=self` também foram tratados.
- A busca persistia as referências, mas o retorno violava o contrato estrito do IPC e a tela não mostrava resultados. Corrigido, com deduplicação por URL no projeto.
- `language: 'pt'` era fixo para qualquer feed. Agora vem do feed ou fica nulo, e é persistido pela migração aditiva `0046_velix_reference_language`.
- O Noticiário marcava todo item como `confirmed` e enviava campos extras ao IPC. Agora envia `unverified` e apenas os campos do contrato, com no máximo as 100 referências mais recentes.
- O brief pedia link na cena, mas não incluía a URL. Agora inclui.
- A aba Produzir ficava com lista antiga depois de uma busca. O cache agora é invalidado.
- `studioGenerate` não devolvia proveniência. Agora retorna `generation` e a versão editorial grava apenas o que o provider informou.

Testes ignorados no Playwright padrão: 6.

| Teste | Dependência | Resultado com a dependência |
|---|---|---|
| `agents.spec.ts:23` | Claude e Codex instalados, `NB_REAL_CLI=1` | Aprovado |
| `mcp.spec.ts:27` (Claude Code) | CLI real, configs isoladas, `NB_REAL_CLI=1` | Aprovado |
| `mcp.spec.ts:27` (Codex CLI) | CLI real, configs isoladas, `NB_REAL_CLI=1` | Aprovado |
| `chat-real.spec.ts:15` | Claude e Codex logados, consome cota real, `NB_REAL_CLI=1` | Não executado: Claude a 97% da cota semanal |
| `velix-discovery.spec.ts:34` (novo) | Rede, `NB_REAL_FEEDS=1` | Aprovado |
| `velix-discovery.spec.ts:84` (novo) | Claude logado, rede, `NB_REAL_CLI=1`, `NB_REAL_FEEDS=1` | Bloqueado pela trava de 97% |

Validação final: lint e typecheck aprovados; Vitest em série 104 arquivos e 836/836 testes em 130 s; build aprovado; `git diff --check` sem erros. Vitest paralelo falhou 2 testes por timeout de 5 s (`database.test.ts` e `multi-project.test.ts`), que passam isolados e na execução em série. Playwright completo: 117 aprovados, 6 ignorados e 3 falhas. Reexecutados isolados, `memory.spec.ts` (ENOENT em artefato de trace) e `workflows.spec.ts` passaram. `projects.spec.ts:38` continua falhando: `AppShell.tsx`, alterado por outro agente às 21:43, adicionou um segundo link "Loja Web" e o seletor do teste ficou ambíguo. Não foi corrigido por estar fora da Fase 36 e em trabalho concorrente.

### Implementação da 36.3 — 2026-10-31

Substitui a linha "Ideias (36.3): PENDENTE" da matriz acima. A lacuna de implementação foi fechada; a Fase 36 continua não concluída por dependências externas.

- [x] Aba Ideias com Gerar ideias, Gerar mais, Surpreenda-me, Investigar, Salvar e Criar projeto Video. Cada ideia traz título, gancho, sinopse, roteiro preliminar, público, duração, referências e plano de mídia.
- [x] `video-ideas.ts` descarta URL fora das referências do projeto e rebaixa fato sem fonte para hipótese. Referências entram no prompt como dado delimitado.
- [x] O agente é escolhido na tela, sem failover silencioso. Claude respeita a trava de 95%; Codex usa o próprio limite.
- [x] Radar sem métrica inventada: cada ideia é rotulada como sugestão editorial, com contagem real de referências citadas e publicadas em 7 dias e a data da pesquisa.
- [x] Migração aditiva `0047_velix_idea_details`: conteúdo e proveniência da ideia. Criar projeto Video grava `pesquisa/fontes.md` e uma versão editorial de brief não aprovada, ligada à ideia.
- [x] Defeito real encontrado: o Codex ignorou o esquema de saída e respondeu com chaves próprias. O prompt agora fixa as chaves exatas; a causa pode também explicar a instabilidade do roteiro via Codex, mas isso não foi comprovado.

Evidência: `video-ideas.test.ts` 6/6; E2E "ideia gerada é salva, investigada, convertida em vídeo e sobrevive ao reinício" aprovado com agente simulado; Codex real gerou 3 ideias válidas em 3 de 3 execuções, com `agent=codex`, `executionId` real e `model=null`.

Pendente nesta subfase: Investigar com provider real não foi executado, e ideias pelo Claude real seguem bloqueadas pela cota semanal a 97%.

Validação final desta etapa: lint aprovado; Vitest em série 105 arquivos e 842/842 testes; build aprovado; `git diff --check` sem erros. Typecheck falha somente em `VelixPage.tsx:429` (3 erros), no bloco "Fluxo do Velix" alterado por outro agente às 22:07; não foi tocado. Playwright completo: 123 aprovados, 6 ignorados e 3 falhas, nenhuma delas pendente da 36.3: o E2E de ideias falhou porque outro agente renomeou o rótulo para "Pauta das ideias", e passou após ajustar o teste; `project-hierarchy.spec.ts:57` tem seletor ambíguo pelo segundo link do `AppShell.tsx`, mesma causa já registrada; `brain3d.spec.ts:54` é a falha temporal de câmera já registrada e voltou a falhar isolada nesta rodada. `projects.spec.ts:38` não falhou nesta rodada.

### Robustez de Providers e Contratos (pedida como "36.4") — 2026-10-31

O nome 36.4 já identifica o Rights Manager na tabela da fase, por isso esta etapa é registrada como **36.4-R**. Estado: **CONCLUÍDA**. A Fase 36 inteira continua **não concluída** por homologações externas.

**Contratos revisados**

| Operação | Prompt e schema | Validação | Provider na UI |
|---|---|---|---|
| Ideias | `video-ideas.ts`, schema estrito | Zod `.strict()`, tudo ou nada; URL e fato conferidos contra as fontes do projeto | Claude ou Codex, escolha explícita |
| Pesquisa e Investigar | `video-research.ts`, schema estrito | Item inválido é descartado e contado; exige busca web observada; só https | Pesquisa: Claude. Investigar: escolha explícita |
| Roteiro | `video-script.ts`, schema não estrito | Blocos validados; foto só se aprovada | Claude |
| Temas | `video-topics.ts`, schema estrito | Zod | Claude |
| Captura | `video-capture.ts`, schema estrito | Zod | Claude |
| Briefs editoriais | Sem agente: montados em `velix-production-modes.ts` e `videoIdeaBrief` | Tipos e URL http(s) | Não se aplica |

As ideias rodam fora do TaskEngine, como pergunta read-only, e não integradas a ele. A regra de arquitetura "toda etapa de agente é tarefa do TaskEngine" pertence à Fase 31 (workflows).

**Diferenças de provider comprovadas no CLI real**

- Claude recebe `--json-schema` e devolve `structured_output`, além de informar o modelo.
- Codex 0.166 recebe o schema por arquivo em `--output-schema`, impõe no texto da resposta e não informa modelo. Schema não estrito faz a API recusar a execução inteira.
- Busca web no Codex: sem configuração, o comportamento varia; `-c web_search="live"` ou `"disabled"` torna previsível, e o evento `web_search` é evidência observável.

**Problemas e correções**

- Causa raiz da 36.3: `codexArgs` nunca enviava `outputSchema`. A instrução no prompt era remendo. Agora o adapter grava o schema em arquivo temporário, passa `--output-schema` só quando o schema é estrito e remove o arquivo ao fim. O roteiro, não estrito, segue pelo prompt e pela validação em runtime.
- `velix-contract.ts`: `VelixContractError` tipado (`provider_unavailable`, `provider_failed`, `provider_limit`, `timeout`, `cancelled`, `empty_response`, `invalid_json`, `contract_violation`, `missing_web_evidence`), com caminho de campo e sem conteúdo do agente, erro de provider encurtado e com segredos mascarados, e `executionId` preservado.
- Resposta `structured` inválida não recorre mais ao texto, dois objetos JSON não são mesclados, e a última mensagem do Codex é a resposta.
- Investigar com Codex podia devolver URLs de memória. Agora a pesquisa sem busca web observada é recusada.
- Investigar ampliava as fontes autorizadas sem revisão. Agora as fontes entram como pendentes (migração aditiva `0048_velix_reference_review`, com agente e `executionId`) e só aparecem nos fluxos editoriais após aprovação explícita. Rejeitada não volta em nova busca.
- Investigar recebe o agente explicitamente; ideias lidas do banco passam pelo contrato; há cancelamento real para ideias e Investigar, com uma execução por projeto.
- Política de agentes: sem failover; quota do Claude não bloqueia Codex; `provider_limit` orienta a tentar depois ou escolher outro agente, sem troca automática.

**Evidências com provider real (somente Codex)**

- Rodadas completas de roteiro, pesquisa e ideias: 2 de 3 aprovadas. A terceira falhou por limite de uso temporário do próprio Codex, que se resolveu em cerca de um minuto. Pesquisa: 9 referências, 0 rejeitadas. Ideias: 3. `model=null`, `executionId` real.
- E2E real "Investigar real com Codex": aprovado, 9 fontes pendentes com a mesma execução, recuperadas após reiniciar, aprovação explícita de uma fonte. Antes da inclusão de `provider_limit`, que altera só a classificação do erro.
- Claude real não foi usado, por decisão e pela quota bloqueada. A resposta do Claude nesta etapa está validada apenas por fixtures, simulador e pelo adapter real da etapa anterior.

**Typecheck**

- `paths.ts`: erro meu da 36.3, por importar `@neuralbridge/shared` no renderer, o que puxava código Node. Corrigido para `@neuralbridge/shared/channels`.
- `VelixPage.tsx:429`: edição concorrente; outro agente corrigiu às 22:26 com `FLOW_STEPS`. Não alterei o bloco.
- Contratos IPC de ideias: sem divergência; os erros `TS1360` em `ipc.ts` vieram da aplicação parcial do meu script e sumiram ao concluí-lo.

**Playwright**

| Falha | Classificação | Ação |
|---|---|---|
| E2E de ideias | Alteração concorrente (campo renomeado para "Pauta das ideias") | Teste ajustado |
| `project-hierarchy.spec.ts:57` | Seletor ambíguo por alteração concorrente no `AppShell.tsx` | Escopo em `main` |
| `projects.spec.ts:38` | Seletor ambíguo; outro agente já corrigiu | Nenhuma |
| `brain3d.spec.ts:54` | **Regressão real**, antes tratada como temporal | Corrigida |
| `memory.spec.ts:15` | Instabilidade de artefato de trace; sem falha nas rodadas seguintes | Nenhuma |

Brain3D: a qualidade automática troca o `BrainRuntime` cerca de 3 s após abrir, e o voo da câmera era perdido, deixando o clique em Centralizar sem efeito. O voo agora passa ao novo runtime por `SceneController`, e o teste espera o estado da cena (`data-flying`, `data-camera`), sem aumentar timeout. Repetido: 10 de 10.

**Validação final**: typecheck, lint, build e `git diff --check` aprovados. Vitest paralelo e em série: 107 arquivos, 862/862. Playwright completo simulado: 131 aprovados, 7 ignorados, 0 falhas. Feed público real: aprovado. O teste de upgrade de migrações ganhou limite próprio de 30 s, porque seu custo cresce com o histórico.

**Regressões remanescentes**: nenhuma conhecida. `multi-project.test.ts` falhou por timeout de 5 s em uma rodada paralela anterior e passou nas duas últimas, sem alteração; pode voltar sob carga.

**Condições para encerrar a Fase 36**

- [ ] Busca real no YouTube com `NB_YOUTUBE_API_KEY`.
- [ ] Roteiro e ideias pelo Claude real, com a quota semanal abaixo de 95%, incluindo `model` real na versão editorial.
- [ ] `chat-real.spec.ts` com Claude e Codex.
- [ ] Rodada completa do Codex real sem limite de uso, repetida.
- [ ] Fluxo ponta a ponta manual: fontes, ideia, roteiro, narração ElevenLabs importada, cortes e MP4.
- [ ] Reconciliar os checklists 36.1 a 36.8 do subplano, que ainda estão desmarcados, com as evidências.
### Fase 36.9 — consolidação após interrupção (2026-10-31)

- [x] Estado recuperado: `PLAN.md`, `STATUS.md`, subplano da Fase 36, `git status`/diff e processos foram inspecionados; não havia processo de teste ativo a recuperar.
- [x] Evidências separadas no relatório `docs/plans/phase-36-final-validation.md`: simulado, Codex real, Claude real, RSS/Atom real, YouTube, MP4, reinício/isolamento e bloqueios externos.
- [x] `claude auth status` confirmou sessão autenticada; o mecanismo não expõe quota. Não foi feita chamada externa adicional. `NB_YOUTUBE_API_KEY` continua ausente.
- [x] Typecheck, build e `git diff --check` executados agora e aprovados.
- [x] ESLint estabilizado: as duas non-null assertions de `packages/workspace/test/git-history.test.ts` foram substituídas por narrowing explícito; `npm run lint` passou.
- [x] E2E Velix estabilizado: os quatro testes falhos passaram isoladamente; a suíte `velix-discovery.spec.ts --workers=1` passou 12/12 executáveis, com 3 ignorados por dependências externas e 0 falhas.
- [x] Testes diretamente afetados passaram: Vitest 3 arquivos/27 testes, typecheck e `git diff --check`. A causa da rodada anterior foi concorrência de processos/artefatos, não defeito funcional Velix.
- [x] Retomada externa: `claude auth status` confirmou autenticação, mas não expõe quota; nenhuma chamada real adicional foi feita. `NB_YOUTUBE_API_KEY` continua ausente.
- [ ] Nenhum teste externo anteriormente ignorado foi reexecutado: Claude e YouTube continuam sem dependências disponíveis. A matriz requisito/evidência/resultado/bloqueio está em `docs/plans/phase-36-final-validation.md`.
- [ ] Decisão mantida: Fase 36 aberta exclusivamente pelas homologações externas não disponíveis; Fase 37 não foi alterada.
- [ ] Fase 36 permanece aberta: falta YouTube real, Claude real abaixo da quota, `chat-real`, uma rodada Codex sem limite, e limpeza dos gates atuais. Fase 37 permanece concluída.

## Fase 38.3 — encerramento formal (2026-11-01)

- [x] Fila `protectedWrite` coordenada por `git common-dir`, com barreiras determinísticas e revalidação após aquisição; três cenários reais de worktree passaram preservando HEADs, índices, refs e arquivos.
- [x] Todos os 13 canais de escrita registrados por `registerGitIpcHandlers` têm cobertura literal em fixtures Git temporárias; sender não confiável é rejeitado antes da escrita.
- [x] Cancelamentos contextuais dedicados passaram 7/7 E2Es: Commit, Branch Delete, Stash Drop, Revert, Cherry-pick, Continue e Abort. Cada caso cancelou a primeira confirmação, preservou o repositório e exigiu nova confirmação para executar.
- [x] `projects.test.ts` passou 28/28 nesta rodada; a regressão global Vitest passou 902/902 em 174,54 s.
- [x] E2E Git Write passou 15/15; E2E Git Graph passou 4/4; typecheck global, ESLint global, build Electron e `git diff --check` passaram.
- [x] SAFE_WRITE permanece ativo (`core.hooksPath=`); hooks fornecidos pelo repositório não são executados e não foram habilitados para satisfazer testes.
- [x] **Fase 38.3 CONCLUÍDA.** Nenhum commit, push, reset, clean ou descarte foi executado no repositório real.

## Fase 38.4 — AI Code Review e Bug Detective: execução (2026-11-01)

- [x] Auditoria inicial mapeou Claude/Codex em `packages/agents`, execução e evidências no `TaskEngine` (`packages/orchestrator`), contexto/indexação Git-RAG em `packages/brain` e contratos Git em `apps/desktop/src/main/projects.ts`, `git-ipc-handlers.ts` e `git-automation.ts`.
- [x] Contrato estruturado de revisão em `packages/shared/src/git-review.ts`, com escopo working-tree/commit/range, severidade, confiança, arquivo/linhas, evidência, sugestão e patch opcional limitado.
- [x] `TaskEngine.startGitReview()` coleta diffs reais, usa Claude/Codex existentes em modo read-only, incorpora RAG/memória autorizados, delimita conteúdo não confiável e persiste escopo/resultado em `task_events`.
- [x] IPC/preload para iniciar e consultar revisão; Git Intelligence exibe progresso, achados, severidade/confiança, evidências, referências de arquivo/linha e pré-visualização de patches.
- [x] Aplicação controlada de patch: validação de unified diff e caminhos, `git apply --check`, autorização vinculada ao hash do patch e estado Git, fila `protectedWrite`, confirmação explícita e ausência de commit automático.
- [x] Regressão corrigida no fingerprint de autorização: staged/unstaged são diferenciados; escopo por caminho preserva Stage/Unstage concorrentes em arquivos distintos sem aceitar Commit + Stage obsoleto.
- [x] E2E real `tests/e2e/git-review-real.spec.ts` passou 1/1 com o adapter Codex autenticado: fixture Git temporária, revisão real pelo TaskEngine, persistência em `task_events`, achado em `auth.ts:2`, patch estruturado, preview, confirmação explícita, aplicação real e verificação de HEAD/índice sem commit automático.
- [x] Auditoria visual real concluída em `prints/git-review-real-1280.png` e `prints/git-review-real-800.png`: severidade/confiança, arquivo/linha, evidência, preview, confirmação, estados do painel, contraste, foco e responsividade foram inspecionados sem sobreposição comprovada.
- [x] Corrigidos e cobertos por regressão: JSON do Codex recebido como texto final e patch unificado sem newline final; o caminho continua validando Zod e `git apply --check` antes da escrita.
- [x] Validações desta retomada: foco review/tasks/projetos/Git write 82/82; workspace Git write 40/40; review 3/3; E2Es Git Graph + Git Write 19/19; E2E real Codex 1/1; typecheck de pacotes/desktop, ESLint global, build Electron e `git diff --check` aprovados.
- [x] Investigação do bloqueio de typecheck: `tests/e2e/skills-transactional-full.spec.ts` permanece como alteração concorrente não rastreada da Fase 41, sem diff contra HEAD e sem alteração nesta fase. Os diagnósticos históricos foram `(18,93) TS2353` (`days` não existe em `SelfsignedOptions`), `(42,95)` (`string | undefined` não atribuível a `string`) e `(43,95)` (`string` não atribuível a `"project" | "global"`); nenhum se reproduziu.
- [x] `npm run typecheck` global passou integralmente após a revalidação; `npm run lint`, build Electron e `git diff --check` também passaram.
- [x] **Fase 38.4 CONCLUÍDA.** O critério bloqueante foi revalidado sem modificar o trabalho concorrente. A Fase 38.5 foi iniciada no checkpoint abaixo.

## Fase 38.5 — Smart Commit & PR Assistant: execução (2026-11-01)

- [x] Contratos compartilhados e IPC/preload adicionados para iniciar Smart Commit e consultar o relatório persistido; entrada limitada a projeto e agente `auto|claude|codex`.
- [x] `TaskEngine` reutiliza os adapters Claude/Codex existentes em modo `read-only`, coleta somente `git diff --cached`, registra escopo/RAG/resultado em `task_events` e não executa escrita durante a geração.
- [x] Proposta estruturada validada por Zod: Conventional Commit, corpo, título/descrição de PR, checklist, changelog e impacto documental. Prompt e saída persistida redigem credenciais; diff/RAG são delimitados como conteúdo não confiável.
- [x] Git Intelligence recebeu painel editável com seleção de agente, estados loading/erro/vazio, contador e bloqueio para mensagem acima de 500 caracteres, confirmação explícita e commit somente via autorização existente. Push, PR remoto e commit implícito não são executados.
- [x] Regressão real: `packages/workspace/test/git-staged-diff.test.ts` 1/1; `packages/orchestrator/test/smart-commit.test.ts` 4/4; conjunto Git/TaskEngine selecionado 48/48; E2E Electron `tests/e2e/git-smart-commit.spec.ts` 1/1. O E2E verificou HEAD inalterado antes da confirmação, commit posterior, working tree limpo e nenhum remote/push.
- [x] Screenshots reais `prints/git-smart-commit-1280.png` e `prints/git-smart-commit-800.png` capturados e inspecionados; o reflow da janela menor, labels, feedback e hierarquia foram validados.
- [x] Build Electron, typecheck de shared/orchestrator, ESLint dos arquivos da fase e `git diff --check` aprovados.
- [ ] Typecheck global: bloqueado por quatro diagnósticos em `packages/workspace/src/skills/studio.ts`, alteração concorrente da Fase 41 (metadata, arrays e `Map`). Nenhum arquivo da Fase 41 foi modificado.
- [ ] ESLint global: bloqueado por dois símbolos não usados no mesmo `studio.ts` e por `test-git-validation-enhanced.cjs`; lint direcionado da Fase 38.5 passou.
- [ ] E2E com CLI real: não executado nesta sessão porque `NB_REAL_CLI` não está habilitado; não é reportado como aprovado.

**Estado:** Fase 38.5 EM EXECUÇÃO. Próximo gate objetivo: revalidar os dois comandos globais após a alteração concorrente da Fase 41 deixar de bloquear a base. Nenhuma operação Git foi executada no repositório real.
## Fase 39 — Velix Motion Engine (2026-11-01)

**Status: PLANEJADA.** A numeração 39 foi verificada como livre. Foi criada a especificação [phase-39-velix-motion-engine.md](plans/phase-39-velix-motion-engine.md), com auditoria do Electron/main/preload/renderer, IPC, Dossiê/timeline, FFmpeg/FFprobe, Clip Hunter, direitos/proveniência, persistência, TaskEngine/recovery, Skills Manager, IA e testes.

Nenhuma funcionalidade foi implementada, nenhuma dependência foi instalada e nenhum commit foi criado nesta fase. O primeiro lote é 39.1 (auditoria, arquitetura e contratos). A prova de conceito futura usará somente assets locais autorizados, sem Claude/Codex/ElevenLabs/YouTube reais, e manterá o pipeline FFmpeg anterior.

## Fase 40 — NeuralBridge Guided Tours (2026-11-01)

**Status: EM EXECUÇÃO.** Auditoria encontrou rotas em `app/routes.ts`, composição em `main.tsx`, shell em `AppShell.tsx`, cabeçalhos em `PageHeader.tsx`, páginas/feature pages e persistência de preferências existente. A Fase 39 está planejada; a próxima fase livre é 40.

Implementado inicialmente: motor declarativo por rota, estado versionado no `localStorage` do perfil Electron, onboarding com iniciar/pular, overlay com progresso/anterior/próximo/concluir, destaque estável por `data-tour`, botão Tutorial no `PageHeader` e no shell, fallback para seletor ausente e proteção explícita contra acionamento de operações reais. Teste unitário do núcleo: 2/2; typecheck desktop: aprovado.

Evidências iniciais: `apps/desktop/test/guided-tours.test.ts` passou 2/2; `tests/e2e/guided-tours.spec.ts` passou 2/2; lint, build Electron, typecheck desktop e `git diff --check` passaram. A implementação usa `guided-tours-core.ts` para estado/normalização, `guided-tours-config.ts` para configuração pura e `guided-tours.tsx` para overlay/onboarding, com `PageHeader`/`AppShell` compartilhados. A execução posterior dos gates globais foi bloqueada por alteração concorrente documentada no Lote 40.2 abaixo.

## Lote 40.2 — Instrumentação Contextual das Páginas (2026-11-01)

- [x] Instrumentados Execuções, Memória, Skills, Projetos, Git Intelligence, Agentes, MCPs, Analytics, Workflows, Mission Control, Velix e Configurações com `data-tour` em regiões reais.
- [x] Textos declarativos revisados para explicar finalidade, uso e ação explícita, sem disparar agentes, Git, renderização, instalação ou publicação.
- [x] Relatório de cobertura criado em `docs/plans/phase-40-guided-tours.md`.
- [x] Auditoria de contratos confirmou os alvos do Dashboard e do Chat; Produzir/Render no Velix apontam para abas visíveis, mantendo painéis condicionais sem abertura automática.
- [x] Gates direcionados: `apps/desktop/test/guided-tours.test.ts` 3/3; `tests/e2e/guided-tours.spec.ts` 2/2 no último build Electron válido; auditoria estática encontrou 27 identificadores declarados; `git diff --check` aprovado.
- [ ] Typecheck desktop, ESLint global e build Electron estão bloqueados na execução mais recente por erro de sintaxe concorrente em `packages/orchestrator/src/prompts.ts:265`; o arquivo não pertence ao Lote 40.2 e foi preservado sem alterações.
- [x] A matriz E2E que excedia o teardown em um único processo foi retomada no Lote 40.3 com isolamento por caso/fixture e passou 17/17, sem falha de seletor.
- [ ] Vitest global, snapshots completos dark/light/reduced motion e subrotas específicas permanecem pendentes.

Fase 40 permanece aberta; não houve commit e alterações concorrentes das Fases 36/41 foram preservadas.

## Lote 40.3 — Dynamic Navigation, Resilience & Isolated E2E (2026-11-01)

- [x] Sessão do tour isolada por rota/tour; mudanças para detalhes incompatíveis desmontam o overlay sem deixar destaque órfão. Memória mantém o tour nas subrotas do layout compartilhado; Projetos e Execuções detalhados não reutilizam o tour da lista.
- [x] Alvos assíncronos, ausentes, ocultos e mutáveis tratados com observação de DOM limitada a 300 ms, `MutationObserver` com cleanup e fallback que permite continuar ou pular.
- [x] Overlay reposicionado por `getBoundingClientRect` em scroll/resize, com clamp de viewport, scroll apenas quando necessário, reduced motion, Escape, foco inicial, foco restaurado e foco cíclico por teclado.
- [x] E2E isolado por processo/caso: 17/17 aprovados, cobrindo as 12 páginas instrumentadas, onboarding/persistência, rota incompatível, alvo indisponível, sidebar recolhida, resize, scroll, Escape, foco e ausência de ações reais.
- [x] Gates Fase 40: typecheck desktop aprovado; ESLint global aprovado; Vitest Guided Tours 4/4; E2E Guided Tours 17/17; build Electron aprovado; `git diff --check` aprovado.
- [ ] Typecheck global falhou somente em três erros concorrentes de `tests/e2e/skills-transactional-full.spec.ts:18,41,42`, pertencentes à Fase 41; nenhum arquivo concorrente foi alterado.
- [ ] Modais destrutivos de exclusão, publicação e renderização não foram abertos por segurança; os testes validam que o tutorial não os dispara. Falta uma fixture modal não destrutiva para homologar foco dentro de modal aberto.
- [ ] Vitest global e matriz visual completa dark/light/reduced motion continuam não executados neste lote.

Lote 40.3 implementado, mas não homologado globalmente por typecheck concorrente. O Lote 40.4 não foi iniciado.

## Lote 40.4 — Validação Final, Matriz Visual e Release Readiness (2026-11-01)

- [x] Corrigido o posicionamento do popover: a referência de medição passou a apontar para o diálogo real e o conteúdo recebeu limite de altura/rolagem interna, mantendo o overlay dentro da viewport em telas compactas e em páginas com descrições longas.
- [x] Criada a fixture E2E não destrutiva no próprio diálogo do tutorial: foco inicial, ciclo Tab/Shift+Tab, Escape, restauração do foco e ausência de `alertdialog`; nenhum modal de exclusão, Git, agente, render ou publicação foi aberto.
- [x] Matriz visual Guided Tours executada em `tests/e2e/guided-tours-visual.spec.ts`: 14/14 páginas, quatro combinações por página (dark desktop, light desktop, dark compact + reduced motion, light compact + reduced motion), 56 screenshots anexados aos resultados do Playwright e geometria do diálogo validada dentro da viewport.
- [x] Regressão funcional `tests/e2e/guided-tours.spec.ts`: 18/18, incluindo onboarding, persistência, navegação, rota incompatível, fallback de alvo oculto, sidebar/resize, foco e fixture modal segura.
- [x] Quality gates: unit Guided Tours 4/4; Vitest global serial `117/117` arquivos e `936/936` testes; typecheck global aprovado; ESLint global aprovado; build Electron aprovado; `git diff --check` aprovado.
- [ ] A matriz de snapshots preexistente `tests/e2e/final-visual-matrix.spec.ts` falhou em `skills-dark-1280x800.png` (11.895 pixels, 2%); o diff mostra a superfície nova de Guided Tours/onboarding. O snapshot não foi atualizado automaticamente. Requer revisão visual deliberada e eventual atualização de baseline fora deste lote.

O Lote 40.4 está implementado e validado nos fluxos específicos, mas a Fase 40 continua aberta por causa da ressalva de baseline visual. Alterações concorrentes das Fases 36 e 41 foram preservadas; nenhum commit foi criado.

## Fase 41 — NeuralBridge Skills Intelligence & Studio (2026-11-01)

**Status: Lote 6 implementado; Lotes 7–10 não iniciados; fase aberta.** A auditoria confirmou que o Skills Manager existente já cobre descoberta local por raízes Claude/Codex/Agents/plugins, parsing e validação básica de `SKILL.md`, preferências por agente/tipo de tarefa, allowlist HTTPS, instalação aprovada, limites de tamanho, rejeição de symlinks e conteúdo inerte. Os contratos IPC legados e a persistência atual foram preservados.

- [x] Criado `packages/workspace/src/skills/` com contratos tipados, inventário de capacidades e baseline de confiança.
- [x] Registrada matriz de integração com Skills Manager, TaskEngine, Workflow Builder, Git Intelligence, Brain/RAG, Token Optimizer, IPC e persistência.
- [x] Documentados os dez lotes e critérios em `docs/plans/phase-41-skills-intelligence-studio.md`.
- [x] Lote 2: Discovery Engine read-only em `packages/workspace/src/skills/discovery.ts`, com escopos global/projeto, raízes Claude/Codex/Agents/plugins, normalização Unicode, filtros, IDs estáveis, hash de conteúdo e grupos de duplicidade/conflito.
- [x] Caso `~/.agents/skills/remotion-best-practices` coberto sem reinstalação ou alteração da instalação global.
- [x] Testes direcionados do Discovery + Lote 1: 2 arquivos, 5 testes aprovados.
- [x] Lote 3: Recommendation Engine determinístico em `packages/workspace/src/skills/recommendation.ts`, com contexto tipado, regras explícitas, filtros de elegibilidade, explicabilidade, conflitos e `externalCalls: 0`.
- [x] Testes direcionados de Discovery, Recommendation e Lote 1: 3 arquivos, 12 testes aprovados.
- [x] Lote 4: Trust Center read-only em `packages/workspace/src/skills/trust-center.ts`, com avaliação, prévia, checks de origem/estrutura/comportamento, findings explicáveis, bloqueios críticos e fingerprint SHA-256.
- [x] Testes direcionados dos Lotes 1–4: 4 arquivos, 15 testes aprovados; nenhuma instalação, execução ou alteração de filesystem.
- [x] Lote 5: instalador transacional em `packages/workspace/src/skills/installer.ts`, com staging, autorização vinculada a fingerprint, journal persistente, lock por destino, backup, rollback, cancelamento e recuperação conservadora.
- [x] Testes direcionados dos Lotes 1–5: 5 arquivos, 19 testes aprovados; nenhum script executado e nenhuma instalação global alterada.
- [x] Lote 5.2: os bloqueios concorrentes em `packages/orchestrator/src/prompts.ts:265` e `apps/desktop/src/renderer/src/app/guided-tours.tsx:119` foram resolvidos pelos fluxos concorrentes; não foram sobrescritos.
- [x] Lote 5.1: canais IPC transacionais, preload e fluxo do Skills Manager integrados; renderer não envia destino/fingerprint/autorização, e o main deriva o destino, valida allowlist e consome a autorização do journal.
- [x] E2E existente `tests/e2e/skills.spec.ts`: 1/1 aprovado; nenhum teste alterou skill global real.
- [x] Typecheck shared/workspace/desktop/global, ESLint global, build Electron novo e `git diff --check` passaram.
- [x] E2Es `skills.spec.ts` e `skills-transactional.spec.ts`: 2/2 aprovados contra o build novo; cobrem listagem e bloqueio de preparação sem escrita.
- [x] Lote 5.3: `tests/e2e/skills-transactional-full.spec.ts` usa repositório bare Git, servidor HTTPS local, certificado de teste confiado explicitamente via `http.sslCAInfo` com `http.sslVerify=true`, allowlist isolada e diretório de dados temporário; não usa repositório público, desabilitação global de TLS ou instalação global.
- [x] Homologação transacional 5/5: instalação remota, atualização com backup, rollback explícito, cancelamento antes do commit, recovery após reinício sem auto-instalação, lock concorrente e conteúdo não confiável tratado como inerte.
- [x] Contrato IPC da prévia foi alinhado para transportar `findings` e `checks` tipados, preservando a validação estrita.
- [x] Lote 6: serviço filesystem-first em `packages/workspace/src/skills/studio.ts`, contratos de draft/metadata/validation/version/change-set/import-export, sidecar `neuralbridge.skill.json`, persistência atômica em `userData/skill-studio`, fingerprint e lock por draft.
- [x] Lote 6: publicação/restauração reutilizam o instalador transacional existente; Trust Center bloqueia conteúdo crítico; salvar/importar/exportar não publica nem ativa; scripts permanecem inertes.
- [x] Lote 6: canais IPC `skills:studio:*`, preload tipado, handlers no processo principal e `managed-skills` incluído nas raízes de Discovery; renderer não grava filesystem.
- [x] Lote 6: Skill Studio integrado à `SkillsPage` com editor, preview Markdown, confiança, histórico, diff, restore, import/export e simulação de Recommendation, preservando dark/light, foco visível, teclado e layout responsivo.
- [x] Evidência direcionada do Lote 6: `skills-studio.test.ts` 11/11, `skills-installer.test.ts` 5/5, IPC 27/27, regressão Skills 66/66, E2Es Skills/Studio/transacionais 8/8, build Electron e lint/typecheck direcionados aprovados.
- [x] Snapshots de versão têm metadata sidecar recuperável; o índice é reconciliado após interrupção entre commit e persistência, e exportações não expõem metadata interna.
- [ ] Gates globais: `npm run typecheck` ainda falha somente em `packages/shared/src/paths.ts` (`node:path`/`process`) por importação concorrente via `GitIntelligencePage.tsx` com `tsconfig.web.json` usando `types: []`; `npm run lint` ainda encontra `require()` em `test-git-validation-enhanced.cjs`. Nenhum arquivo concorrente foi alterado.
- [ ] Cancelamento no meio de um commit já iniciado não é uma operação suportada pelo contrato atual; permanece explicitamente fora desta homologação.
- [ ] A instalação remota continua aceitando somente o escopo global no IPC atual; drafts do Studio podem carregar escopo `project`, mas publicação/restore permanecem globais até haver resolução segura de projeto. A origem remota não é pinada a uma revisão imutável e o fingerprint protege o staging aprovado, não a reputação ou mudanças posteriores da origem.
- [ ] Integrações avançadas de execução dos Lotes 7–9 permanecem planejadas; o Studio do Lote 6 está implementado, mas a Fase 41 não está encerrada.
- [ ] Homologação completa da Fase 41 ainda não deve ser declarada.

### Homologação 36.9 — 2026-11-01

Decisão: **Fase 36 aberta**. Detalhes em `docs/plans/phase-36-final-validation.md`.

- Isto corrige os registros anteriores que diziam "aberta exclusivamente pelas homologações externas": a reconciliação encontrou lacunas de escopo internas em 36.1 a 36.8.
- [x] Claude real, com quota reiniciada: roteiro, pesquisa, ideias e cancelamento aprovados, com `model=claude-opus-5-5` real.
- [x] Codex real: pesquisa, ideias e cancelamento aprovados. Roteiro: 1 falha fora do contrato e depois 3 de 3; a falha agora informa os campos.
- [x] Jornada real completa com feed, Codex e Claude reais até MP4 validado por FFprobe e reinício. Narração e vídeo são sintéticos, não ElevenLabs.
- [x] Revisão de fontes validada, incluindo tentativas de contorno.
- [ ] YouTube real: bloqueado, `NB_YOUTUBE_API_KEY` ausente.
- [ ] ElevenLabs real: não executado.
- [ ] `chat-real.spec.ts`: executou 8 etapas reais e falhou porque o revisor recusou aprovar sem rodar `node`. Fora do Velix.
- [ ] Gates: Vitest 955/955, build e `git diff --check` aprovados. Typecheck, ESLint e parte do Playwright falham por mudanças das fases 38 a 41; Velix e Video isolados passam 30 com 3 ignorados. `velix-visual.spec.ts` falha e a baseline não foi alterada.

### Lacunas da Fase 36 implementadas — 2026-11-01

- [x] Implementadas as lacunas de 36.1 a 36.8, incluindo as migrações `0049_velix_discovery_cache`. Detalhes e evidências em `docs/plans/phase-36-final-validation.md`.
- [x] Corrigidos defeitos reais: Rights Manager sem atualizar a tela, render ignorando revogação de direitos, referência local no Noticiário.
- [ ] Fase 36 segue aberta: YouTube real, jornada com voz e vídeo reais, aprovação da baseline visual e gates das frentes 38 a 41.

- [x] YouTube real homologado em 2026-11-01: busca, paginação, filtros, cache, persistência após reinício e chave inválida, com `velix-youtube-real.spec.ts`. Pendentes da Fase 36: jornada com voz e vídeo reais, baseline visual e gates das frentes 38 a 41.

## Auditoria de reconciliação das Fases 39, 40 e 41 (2026-11-01)

A documentação estava atrás do código porque a atualização da Fase 39 ficou para depois dos gates. Status abaixo é o comprovado no repositório, não o de relatórios anteriores.

- [x] 39.1 implementada. 39.2 com render real, FFmpeg, FFprobe e cancelamento comprovados por `velix-motion-render.test.ts` 2/2 (`NB_MOTION=1`).
- [ ] 39.2 a 39.8 parciais; detalhes em `docs/PLAN.md`. Pacote nunca gerado com Motion.
- [x] 40.1 a 40.4 implementados; fase aberta por baseline visual e Playwright completo.
- [x] 41.7 implementado no TaskEngine; 41.8 e 41.10 parciais; 41.9 não encontrado.
- [ ] 57 baselines PNG em 7 specs foram atualizadas e só uma foi revisada visualmente; aguardam revisão humana. A paleta preta e laranja ainda não consta em `MASTER.md`.
- [ ] O render Motion exige roteiro aprovado, mas ainda não vincula a composição ao conteúdo dele.

## Distribuição do Motion e gates finais (2026-11-01)

Gates, rodada única com todas as alterações: typecheck, lint, build e `git diff --check` com saída 0; Vitest em série 124 arquivos, 983/983; integração Motion 2/2; Playwright 207 aprovados, 11 ignorados, 0 falhas, com `NB_MOTION=1`.

- [x] Pacote: instalador de 294 MB para 229 MB; app instalado de 1.194 MB para 886 MB. Removidos binários Linux e macOS do `onnxruntime-node` (155 MB) e o bundler do pacote, que passou a dependência de desenvolvimento.
- [x] Maiores responsáveis no pacote: `NeuralBridge.exe` 236 MB, `onnxruntime-web` 138 MB e `onnxruntime-node` 134 MB. O Remotion ocupa cerca de 35 MB no pacote; `onnxruntime-web` não foi removido por falta de prova de que é dispensável.
- [x] Defeito de distribuição: fora do repositório o worker falhava com `ERR_MODULE_NOT_FOUND`. O "render empacotado" anterior dependia de `node_modules` do repositório. As 27 dependências do worker agora vão em `asarUnpack`.
- [x] `ensureBrowser()` baixava o navegador em silêncio. O render agora recebe um executável explícito e recusa com aviso quando ele falta. O download só começa por botão, fica em `userData/motion-runtime` e pode ser cancelado.
- [x] O Motion usa FFmpeg e FFprobe do próprio pacote, sem depender do `PATH`.
- [x] Teste isolado (`motion-isolated.spec.ts`), em cópia do pacote fora do repositório, sem FFmpeg no `PATH`, com perfil e temporários próprios: recusa, cancelamento, download real de 283 MB, render e FFprobe aprovados.
- [ ] Limites do teste isolado: é a mesma máquina, sem instalador NSIS e sem usuário limpo do Windows; o render isolado não incluiu narração.
- [ ] Licença: Remotion é gratuito para pessoas físicas, empresas de até 3 funcionários e entidades sem fins lucrativos; acima disso exige Company License. A proibição de sublicenciar precisa de análise antes de distribuir.
- [ ] 57 baselines aguardam revisão, e a paleta aguarda registro em `MASTER.md`.
- [ ] Fases 39 e 41 permanecem abertas. Fases 38.5 e 40: gates globais aprovados, sem encerramento formal.

## Revisão de baselines e continuação das Fases 39 e 41 (2026-11-01)

Gates: typecheck, lint, build e `git diff --check` com saída 0; Vitest 124 arquivos, 983/983; Playwright 208 aprovados, 11 ignorados, 0 falhas, com `NB_MOTION=1`.

- [x] 57 baselines comparadas com o commit: mesmas dimensões; nos temas escuros a cor média saiu do azul-marinho para o neutro. 8 pares inspecionados, mais `dashboard-800x700`. As diferenças vistas são paleta, botões de Tutorial e Skill Studio.
- [ ] Defeito congelado nas baselines de 800 px: o texto da busca do cabeçalho quebra em três linhas. A janela real tem mínimo de 960 px, então o caso precisa ser conferido nessa largura.
- [ ] Resíduo de cor: o herói do Dashboard mantém rótulo e gradiente ciano.
- [x] Decisão: navegador do Motion por download sob demanda. Paleta vigente anotada em `MASTER.md`; a tabela antiga aguarda confirmação.
- [x] 41.7: estimativa de contexto de skills em `tokenAnalytics`. Recommendation conectado à tela de Skills, sem alterar preferências (E2E).
- [x] Fase 41: concluída no fechamento de 2026-11-01, no fim deste arquivo.

## Retomada `/dev` — validação integrada (2026-11-01)

### Fase 41

- [x] 41.9: provider read-only de Skills Intelligence integra Git Intelligence, Brain/RAG, memória/contexto e analytics; contexto limitado por orçamento, referenciado e persistido pelo TaskEngine.
- [x] 41.9: Recommendation recebe evidências reais de Git/memória/RAG/uso sem alterar preferências; a capacidade `neuralbridge:motion-composition` foi registrada no inventário.
- [x] 41.10 — rodada conjunta: Vitest focado 70/70; Playwright Git/Skills/Studio/transacional/Motion 15 aprovados, 1 ignorado e 0 falhas.
- [x] Render Motion real opt-in 1/1 com Chromium explícito: sugestão TaskEngine, aplicação humana, MP4 e FFprobe.
- [ ] Fase 41 permanece aberta; Lote 7 não iniciado e encerramento formal da matriz completa ainda pendente.

### Fase 39

- [x] 39.5: alinhamento automático de legendas com narração usando o transcritor existente, com misses reportados para revisão.
- [x] 39.7: sugestão de composição integrada ao TaskEngine read-only e Skills Manager.
- [ ] 39.8: NSIS em máquina limpa com narração e licença Remotion continuam bloqueios externos.

### Fase 36 e demais pendências

- [x] VoiceStudio auditado: API local em `localhost:3900`, AGPL-3.0 para o aplicativo e licenças separadas de modelos/vozes/saída; ElevenLabs preservado.
- [ ] 38.6–38.8 auditadas, mas continuam planejadas.
- [x] Template 3 da Fase 31 homologado; ver a execução seguinte.
- [ ] Instalação limpa da Fase 16 continua pendência externa.

### Gates desta retomada

`npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:motion` e `git diff --check` passaram. A primeira execução do render sem `NB_MOTION_BROWSER` foi corretamente bloqueada pelo runtime isolado sem navegador; a repetição com executável explícito passou. Nenhum commit foi criado; Fases 40 e 38.5 foram preservadas.
- [ ] Fase 39 aberta: NSIS em máquina limpa com narração, licença do Remotion e identidade dos templates.

## Identidade oficial e encerramento das Fases 40 e 38.5 (2026-11-01)

Gates finais: typecheck, lint, build e `git diff --check` com saída 0; Vitest 124 arquivos, 983/983; Playwright 209 aprovados, 12 ignorados, 0 falhas, com `NB_MOTION=1`.

- [x] Paleta preta e laranja aprovada pelo usuário e registrada em `MASTER.md`. Baselines aprovadas.
- [x] Busca do cabeçalho em uma linha na largura mínima real de 960 px, com teste na janela real.
- [x] Dashboard sem ciano. Também removidos o ciano do anel de foco (`--ring`) e do ponto de status de projetos. Cores categóricas de memória e agentes permanecem.
- [x] Correção de evidência: o teste responsivo do Motion media 1440 px nas três passagens, porque a janela redimensiona de forma assíncrona. Agora espera o tamanho real; 1440, 1024 e 960 aprovados.
- [x] Baselines de Dashboard e Projetos regravadas; diferença restrita ao rótulo e à busca.
- [x] **Fase 40 CONCLUÍDA em 2026-11-01.**
- [x] **Fase 38.5 CONCLUÍDA em 2026-11-01:** Smart Commit com Codex real gerou proposta só do staged, sem commit e sem alterar o índice.
- [x] 39.6: benchmark de 10 gráficos, 10 s a 1280x720, em 9,3 s. 41.7: registro `neuralbridge-skills` coberto por teste.
- [ ] Fase 39 aberta: estado atualizado no fechamento de 2026-11-01, no fim deste arquivo.
- [x] Fase 41: concluída no fechamento de 2026-11-01, no fim deste arquivo.

## Execução atual — Lote 7 e VoiceStudio (2026-11-01)

- [x] Lote 7: disponibilidade de skills explícitas validada no TaskEngine antes da execução; read-only estruturado continua persistido, sem permissões de edição.
- [x] Template 3: execução real com fixture npm bounded, `runValidation`, Git e relatório persistido; sem alteração no allowlist e sem segundo executor.
- [x] VoiceStudio: provider opcional implementado no processo principal, com contratos IPC tipados, loopback-only, contrato esperado 0.5.0, descoberta, geração, validação de áudio, sidecar, prévia e timeline. A UI permanece no Estúdio existente.
- [x] Compatibilidade ElevenLabs/manual preservada; arquivos `voz.*` continuam reconhecidos e os assets `voice-*.mp3|wav|m4a` são carregados pelo Studio.
- [x] Homologação real VoiceStudio: concluída depois, com a API 0.5.7 e a voz clonada do usuário.
- [x] Homologação real Fase 36: concluída depois, com áudio ElevenLabs e vídeo próprio.
- [x] Fase 41: Lotes 7–10 encerrados no fechamento de 2026-11-01.
- [ ] Fase 39, instalação NSIS limpa, licença Remotion e Fase 16 continuam pendências externas.
- [x] Sidecar de narração protegido contra escrita concorrente por fingerprint e lock atômico; geração no app prefere o FFprobe empacotado do Motion.

### Evidência final desta retomada

- Vitest completo em série: 125 arquivos, 998/998 aprovados.
- Integração: 8/8 aprovados; 29 casos externos/opt-in ignorados pelo ambiente.
- E2E crítico `velix-journey`: 1/1 aprovado com fixtures; cenário ElevenLabs/vídeo próprio não foi executado sem os arquivos reais.
- Typecheck, ESLint, build Electron, build Motion e `git diff --check`: aprovados.

## Fase 42 — NeuralBridge Companion & Remote Agent Control (em execução, 2026-11-01)

**Status: EM EXECUÇÃO.** A Fase 42 foi escolhida porque é o próximo identificador livre após a Fase 41. A auditoria inicial foi concluída; 42.1 permanece parcial e 42.2 permanece parcial. Nenhuma dependência foi instalada e nenhum commit foi criado.

- [x] Auditoria documental do `PLAN.md`, `STATUS.md`, `design-system/neuralbridge-intelligent-workspace/MASTER.md`, TaskEngine, Mission Control, IPC Electron, adapters Claude/Codex, permissões, analytics/persistência e empacotamento Windows registrada no planejamento.
- [x] Auditoria do Coucou registrada: eventos de hooks/relay e estados canônicos, HUD/pills, diffs, perguntas e aprovações persistentes, adaptadores, pipe nomeado Windows, pareamento móvel, gateway default-off, limites Windows e separação de licenças.
- [x] Decisão registrada: Companion é projeção/controlador do TaskEngine existente; não cria segundo TaskEngine, Mission Control, banco ou canal de execução.
- [ ] 42.1 — Auditoria, arquitetura e contratos — IMPLEMENTAÇÃO PARCIAL; não concluído.
- [ ] 42.2 — Session Registry e Event Bus — IMPLEMENTAÇÃO PARCIAL; não concluído.
- [x] 42.3 — Mini HUD flutuante no Windows — CONCLUÍDO (HUD); sublote 42.3.Spotify segue PLANEJADO.
- [ ] 42.4 — Adaptadores Claude Code, Codex e OpenCode — PLANEJADO.
- [ ] 42.5 — Permission Broker e aprovações seguras — PLANEJADO.
- [ ] 42.6 — Companion animado com identidade original — PLANEJADO.
- [ ] 42.7 — Chat rápido e integração com Mission Control — PLANEJADO.
- [ ] 42.8 — Gateway local seguro e pareamento — PLANEJADO.
- [ ] 42.9 — Aplicativo móvel e notificações — PLANEJADO.
- [ ] 42.10 — Analytics e histórico de agentes — PLANEJADO.
- [ ] 42.11 — Segurança, acessibilidade, testes e estabilidade — PLANEJADO.
- [ ] 42.12 — Empacotamento, homologação e distribuição — PLANEJADO.

**Gates:** MVP Windows = 42.1–42.5; Experiência Companion = 42.6–42.7; Controle móvel = 42.8–42.9; Finalização = 42.10–42.12. O próximo lote recomendado é 42.1, condicionado à autorização explícita para iniciar implementação.

**Licença e identidade:** o código Coucou é MIT, mas o nome Coucou, Mochi, personagem, ícones, sons e mídia não são cobertos pela MIT e não serão reutilizados. O NeuralBridge deverá ter identidade, assets e sons originais com manifesto de proveniência/licença.

**Validação desta documentação:** `git diff --check` e verificação de links internos/numeração devem ser executados antes da entrega final; gates de código não foram executados porque a implementação está explicitamente proibida nesta etapa.

### Lote 42.1 — checkpoint de contratos (2026-11-01)

**Status: IMPLEMENTAÇÃO PARCIAL; Lote 42.1 NÃO CONCLUÍDO.** A autorização cobriu somente contratos, validações e estruturas mínimas. Não foram criados HUD, adapters completos, Permission Broker operacional, gateway, app móvel, companion visual ou executor.

- [x] Criado `packages/shared/src/companion.ts` com schemas Zod e tipos para sessão, status, conexão, eventos observados, capacidades, pedidos/decisões de permissão e contratos de inscrição/cancelamento.
- [x] Exportado o módulo em `packages/shared/src/index.ts` e `packages/shared/package.json` (`@neuralbridge/shared/companion`). Nenhuma dependência nova ou migração foi criada.
- [x] IDs de sessão, tarefa, evento, pedido, decisão e idempotência exigem UUID; pedidos exigem fingerprint hexadecimal de 64 caracteres, sequência e expiração posterior à criação.
- [x] Eventos observados são distintos de pedidos de permissão; `controllable` exige transporte e `uncontrollable` não pode declarar transporte nativo.
- [x] Definidos `CompanionEventFilter`, `CompanionEventSubscription`, `CompanionEventBus`, observer e unsubscribe como contratos, sem implementação de bus paralelo.
- [x] Criado `packages/shared/test/companion.test.ts` com 5 testes de contrato/segurança.
- [x] Teste direcionado: 5/5; regressão shared/IPC selecionada: 32/32; typecheck de `packages/shared`: aprovado; ESLint dos arquivos do lote: aprovado.
- [ ] Persistência, ordenação/deduplicação executável, recuperação após reinício e integração com o `TaskEngine` pertencem ao 42.2.
- [ ] Capacidades reais por Claude/Codex/OpenCode, transporte de aprovação e fallback terminal pertencem ao 42.4/42.5.
- [ ] O Lote 42.1 só poderá ser marcado CONCLUÍDO após integração/validação do contrato contra os pontos reais auditados e os gates completos de typecheck, lint e `git diff --check`.

**Dependência para 42.2:** usar estes contratos como fronteira compartilhada; o Session Registry deve projetar `tasks`, `task_steps` e `task_events` existentes, não criar uma engine paralela. A migração, se necessária, deve ser aditiva e somente após confirmar o próximo número disponível.

### Lote 42.2 — Session Registry e Event Bus (2026-11-01)

**Status: CONCLUÍDO (homologado, 2026-11-02).** Os gates obrigatórios de integração Electron, recuperação, IPC, assinaturas, execução real do TaskEngine, empacotamento Windows e limites/deduplicação foram aprovados.

- [x] Criado `packages/orchestrator/src/companion-registry.ts` com `CompanionEventBus`, `CompanionSessionRegistry`, filtros, unsubscribe, deduplicação, sequência monotônica, retenção limitada e isolamento de subscriber.
- [x] Criada migração aditiva `packages/database/migrations/0052_companion_registry.sql`; confirmado o próximo número livre após 0051.
- [x] Adicionadas tabelas Drizzle `companion_sessions` e `companion_events` em `packages/database/src/schema.ts`, usando o mesmo SQLite, WAL e foreign keys existentes.
- [x] Adicionado `connectTaskEngineToCompanion`, que observa o evento real `TaskEngine` `task` sem enviar comandos de volta e sem alterar permissões/adapters.
- [x] Integrado ao main Electron após banco/TaskEngine, com teardown no `before-quit` e isolamento de falhas do bridge.
- [x] Adicionados canais IPC tipados de consulta/assinatura e API restrita no preload; sem publicação arbitrária, execução ou aprovação.
- [x] Adicionado teste `apps/desktop/test/companion-ipc.test.ts` cobrindo remetente, limites, consultas, assinatura, cancelamento e destruição da janela.
- [x] Testes: `companion-registry.test.ts` 6/6; conjunto shared/orchestrator/database direcionado 23/23.
- [x] Typecheck direcionado de shared/database/orchestrator e ESLint dos arquivos do lote aprovados.
- [x] Typecheck global, ESLint global e `git diff --check` finais desta rodada aprovados.
- [x] Homologação Electron em processo real e empacotado aprovada; teste controlado de retenção/deduplicação coberto pela suíte do Registry.
- [x] E2E real recebeu sessão de uma execução TaskEngine com agente fake isolado; renderer permaneceu sem Node/Electron.
- [ ] Não fazem parte deste lote: HUD, Permission Broker, gateway ou mobile.
- [ ] O Lote 42.1 continua parcial: seus critérios formais de integração e auditoria não foram marcados como concluídos automaticamente.

**Dependências para 42.3:** usar `CompanionSessionRegistry`/`CompanionEventBus` como fonte de observação; o HUD deverá consumir projeções por IPC, nunca ler o banco diretamente nem manter uma segunda fonte de estado. O gate 42.2 está aprovado; permanecem como critérios do HUD a validação visual multi-monitor/DPI, temas, reduced motion e persistência de posição.

### Lote 42.3 — Mini HUD Windows (2026-11-02)

**Status: CONCLUÍDO (HUD, 2026-11-02).** Os critérios de aceite do plano foram validados: o HUD não cria status falso, não rouba foco, funciona em múltiplos monitores e fecha sem afetar tarefas. O sublote 42.3.Spotify é separado e continua PLANEJADO. O Lote 42.4 não foi iniciado; nenhuma dependência foi instalada e nenhum commit foi criado.

**Entregue**

- [x] Mascote SVG próprio (`NeuralBridgeMascot.tsx`) seguindo a folha de estados aprovada: domo, arco-headset com conector, orelha laranja à frente, azul atrás, patas e expressão por estado. Sem asset do Coucou.
- [x] Nove estados acionados por dados reais (`companion-state.ts`): idle, running, thinking (`discovering`), resting (`paused`), waiting (`waiting_input`/`waiting_permission`), success, error, disconnected e degraded.
- [x] Success e error são reações de 2,6 s a uma transição ao vivo. Histórico carregado na abertura não dispara reação; cancelamento pelo usuário não é erro.
- [x] Mascote, cápsula e painel usam uma única forma e um único mascote, com transição contínua. A janela cresce antes da animação e encolhe depois dela.
- [x] Painel expandido em três colunas como na referência, com sessões, agente, projeto, tarefa, duração, contadores reais, eventos recentes, conexão e Mission Control.
- [x] Mascote: clique expande ou recolhe, arraste reposiciona, hover pisca discretamente. Duplo clique não foi implementado, pois nenhuma ação útil o justifica sem atrasar o clique simples.
- [x] Omitidos por falta de backend: chat, "Nova sessão" e "Ver sessão" (o Mission Control não tem deep link por sessão).
- [x] Margens transparentes deixam o clique passar (`setIgnoreMouseEvents` com forward e teste de alvo no renderer, reportado só quando muda). A janela só recebe foco no painel.
- [x] Arraste próprio: o renderer envia apenas a fase e o main lê o cursor, logo um renderer não posiciona a janela. Solta com snap e limite ao monitor.
- [x] `companion-hud-layout.ts`: âncora por modo, limite ao monitor, monitor removido e `display-*`.
- [x] Canais de posição, modo e ponteiro aceitam somente o remetente do HUD; visibilidade e fixação continuam disponíveis para Configurações.
- [x] Configurações ganhou a seção Companion: mostrar, manter acima, abrir painel e restaurar posição.
- [x] Sem polling: sessões são lidas por evento, com limite de 1 leitura a cada 250 ms; o relógio só roda no painel com sessão ativa; animações param com o HUD oculto ou com movimento reduzido.

**Defeitos corrigidos na auditoria**

- [x] `body` opaco impedia a transparência real da janela.
- [x] `minHeight` de 150 px impedia a cápsula de encolher.
- [x] Sair do app gravava `visible: false`, e `moved` regravava `visible: true`.
- [x] O HUD oculto não tinha caminho de volta e mantinha o app vivo com a janela principal fechada.
- [x] Sessões abertas por um crash apareciam como execução em andamento; agora são marcadas como desconectadas ao iniciar.
- [x] `list()`/`events()` devolviam os itens mais antigos e faziam N+1. Agora há `newestFirst` e limite em SQL.
- [x] `app.firstWindow()` podia devolver o HUD aos specs. `launchApp` e os specs passaram a selecionar a janela principal.
- [x] Um `preventDefault` em `close`, introduzido nesta rodada, travava o encerramento. Foi removido: a janela fecha e é recriada sob demanda.
- [x] Depois de reaberto, o HUD impedia o app de sair: `isVisible()` em janela destruída abria a caixa de erro do Electron, confirmada num processo preso com janela "Error".
- [x] Iniciar com tema claro travava a abertura de forma intermitente (3 de 8 tentativas). A causa provável é o `nativeTheme` disparar antes de o HUD ter URL, chamando `setTitleBarOverlay` numa janela sem moldura. `syncWindowChrome` agora só atua em janelas principais; depois da correção foram 16/16. A caixa de erro não pôde ser lida neste caso.
- [x] O título da tarefa no HUD mostra só a primeira linha, com limite de 120 caracteres, porque a janela flutua sobre tudo.

**Evidências finais (2026-11-02)**

- `npm run typecheck`, `eslint .`, `npm run build` e `git diff --check`: saída 0.
- Vitest: 1038/1038 com `--no-file-parallelism`. Em paralelo, os testes com `git` podem falhar, conflito já previsto no `AGENTS.md`.
- Playwright completo: 224 aprovados, 17 ignorados, 0 falhas. Entre os ignorados estão os 2 de mouse real, que são opt-in.
- Mouse real (`NB_E2E_REAL_MOUSE=1`, `companion-real-mouse.spec.ts`): 2/2. O arraste move a janela sem abri-la e persiste a posição; o clique real abre sem mudar a janela em primeiro plano; o clique na margem transparente chega à janela de baixo e não ao HUD.
- Multi-monitor real: dois monitores 1920×1080 com coordenadas negativas, incluindo reabertura no secundário e posição salva inexistente.
- Fechar o HUD com tarefa em execução mantém a tarefa e a sessão, e ele volta sob demanda (3/3).
- Pacote `dist/win-unpacked` (`--win dir`) aprovado no E2E. O instalador NSIS não foi gerado nesta rodada.
- Capturas em `artifacts/companion-hud-*.png`: `mascot`, `capsule`, `capsule-running`, `expanded`, `expanded-running`, `expanded-light`, `expanded-150`, `packaged`, `state-*` e `states-sheet`. Os baselines `settings-*` do `final-visual-matrix` foram atualizados pela nova seção.
- Running, success e error vêm de execuções reais do TaskEngine com agente fake. Waiting, thinking, resting, degraded e disconnected foram exercitados alterando a sessão real na fronteira IPC do main.

**Limitações conhecidas, fora do aceite**

- Monitores com DPI diferentes entre si não foram testados em hardware; os dois são iguais. O plano prevê DPI simulado, e 150% foi validado por argumento do Chromium.
- Waiting, thinking, resting e degraded só terão produtor real com o 42.4. A ação de aprovação pertence ao 42.5.
- Ouvindo música e Pausado (música) dependem do sublote 42.3.Spotify; Empolgado não tem sinal real.
- Fora do painel a janela não recebe foco; o caminho por teclado é Configurações → Abrir painel. Não há atalho global.
- Perto da borda, empurrar o painel para dentro do monitor desloca o mascote de uma vez, sem animação.
- Aprovação visual do usuário frente às referências: não registrada. A comparação foi feita pelo agente.

### Sublote 42.3.Spotify — Companion Spotify Integration

**Status: EM EXECUÇÃO; não concluído (2026-11-02).** O código está pronto e testado somente contra uma API simulada. O gate abaixo continua valendo: sem Client ID, redirect URI e autorização real, o sublote não é declarado implementado. Nenhuma dependência foi instalada e nenhuma credencial entrou no repositório.

**Entregue**

- [x] Contratos em `packages/shared/src/spotify.ts` e IPC tipado para status, configuração, conexão, controle e abrir faixa.
- [x] Serviço isolado em `apps/desktop/src/main/spotify/`: PKCE S256, sem Client Secret, navegador externo e retorno por `http://127.0.0.1:43879/callback`, que recusa `state` errado e `Host` estranho.
- [x] Tokens só no `safeStorage`; sem criptografia do sistema ficam em memória, nunca em texto puro, e não chegam ao renderer.
- [x] Renovação com rotação, 401, revogação, 403, Premium, dispositivo ausente, 404, 429 com `Retry-After` e `QUOTA_EXCEEDED`.
- [x] Desligado por padrão: sem rede enquanto desligado, sem Client ID, desconectado ou com o HUD oculto.
- [x] Player no painel com capa, faixa, artista, progresso, dispositivo, controles, volume e abrir no Spotify. Controles indisponíveis ficam desabilitados com motivo.
- [x] Capa baixada pelo main como data URL, de host conhecido e até 512 KB; o CSP do renderer não mudou.
- [x] Cápsula mostra a música só sem agente ativo. Mascote: `listening`, `musicPaused` e reação à troca de faixa, apenas quando ocioso, pois o agente tem prioridade.
- [x] Configurações: ligar, Client ID, redirect URI, permissão de controles, conectar, desconectar e cancelar.

**Evidências:** Vitest 1070/1070 em série; `companion-spotify.spec.ts` 3/3 no Electron real contra servidor falso; Playwright completo 226 aprovados, 17 ignorados, 1 falha, a lista de APIs de `shell.spec.ts`, atualizada com `spotify` e aprovada depois em rodada parcial (15/15). A suíte completa não foi repetida. Capturas: `artifacts/companion-hud-state-listening.png`, `capsule-spotify`, `expanded-spotify` e `expanded-spotify-paused`.

**Regras do Spotify conferidas em 2026-11-02:** `localhost` não é aceito como redirect URI, somente IP literal; apps em modo de desenvolvimento exigem Premium do dono e têm limite de 5 usuários; os changelogs de maio e julho de 2026 não alteram os endpoints de reprodução. O changelog de fevereiro não pôde ser lido, então o parser trata como opcionais os campos além do nome da faixa.

**Pendente**

- [ ] Teste autenticado com conta real: autorização, leitura, controles, renovação e revogação.
- [ ] Criar o Spotify Developer App e registrar a redirect URI (ação do usuário).

- [ ] Auditar configuração externa do Spotify Developer App, Client ID, redirect URI e disponibilidade de autorização do usuário.
- [ ] Definir serviço Spotify isolado no Electron main com OAuth 2.0 Authorization Code + PKCE, navegador externo, callback seguro e sem Client Secret no aplicativo.
- [ ] Definir armazenamento seguro de tokens, renovação, revogação, logout, redaction, 401/403/429 e `Retry-After`.
- [ ] Definir contratos TypeScript/Zod e IPC explícito para conexão, playback, capacidades e controles autorizados.
- [ ] Implementar player compacto real e integração de estados musicais com o mascote, sem reprodução local ou análise de áudio.
- [ ] Cobrir testes unitários, integração, IPC, E2E visual e teste autenticado real quando a configuração externa estiver disponível.
- [ ] Documentar scopes mínimos: `user-read-playback-state`, `user-read-currently-playing` e `user-modify-playback-state` somente com habilitação explícita.

**Gate de entrada:** depende do HUD 42.3 e de uma decisão/configuração válida do Spotify Developer App. Sem Client ID, redirect URI e autorização de teste, o sublote permanece planejado e não deve ser declarado implementado.

## Fechamento Fases 41, 39, 36 e auditorias (2026-11-01)

Gates finais: typecheck, ESLint, build Electron, build Motion e `git diff --check` com saída 0; Vitest 125 arquivos, 1002/1002; integração 8/8 com 30 opt-in ignorados; Playwright 210 aprovados, 15 ignorados, 0 falhas.

- [x] **Fase 41 CONCLUÍDA.** E2E real `skills-real.spec.ts` com Claude e Codex: `skills_context`, Git, memória, RAG e reinício. `skills-a11y.spec.ts`: dois temas, teclado, nomes acessíveis, movimento reduzido e 960 px.
- [x] **Fase 36 CONCLUÍDA.** `velix-journey.spec.ts` real: voz ElevenLabs de 109,2 s, vídeo próprio de 12,8 s, MP4 sincronizado de 110 s com vídeo e áudio, Claude e Codex reais, persistência após reiniciar.
- [x] VoiceStudio 0.5.7 com a voz clonada do usuário: geração, sidecar, FFprobe e legenda alinhada de 0,35 s a 7,05 s.
- [x] 39.5 e 39.7 concluídas: fala real sintetizada alinhada (0 perdidas), render com voz e legendas alinhadas, sugestão real até o MP4 com Claude e Codex.
- [ ] **Bloqueio externo 39.8/a:** instalador NSIS em máquina limpa com narração.
- [ ] **Bloqueio externo 39.8/b:** decisão sobre a licença do Remotion (gratuita só para indivíduos, empresas de até 3 pessoas e organizações sem fins lucrativos).
- [ ] **Bloqueio externo Fase 16:** instalação limpa; sem ambiente adequado nesta máquina.
- [ ] 38.6 parcial; 38.7 e 38.8 planejadas.
- [ ] **Atenção de licença:** o modelo OmniVoice instalado declara pesos CC-BY-NC; a tela mostra o aviso. Para uso comercial, trocar de motor ou obter autorização. VoiceStudio em `AppData\Roaming` falha com `uv` 0.12.13 nesta máquina; instalar em outra pasta resolve.
- Observação: uma segunda falha de Playwright apareceu numa rodada e não se repetiu nas duas rodadas completas seguintes; não foi identificada.

## Neura — assistente geral (2026-11-02)

- [x] Voz, conversa, Spotify por API oficial, sugestões de reunião, ações com permissão e auditoria, painel no Companion e configurações com consentimento.
- [x] Verificação: Vitest, testes do worker, typecheck, lint, build, Playwright de Neura e Companion, e pacote local com o worker em `resources`.
- [ ] Pendente: validar voz com reconhecedor real do Windows e sugestões com modelo real; decidir como provisionar o venv do worker.
- Decisões e limites: `docs/superpowers/plans/2026-11-02-neura-claude-handoff.md` e `docs/neura-privacy.md`.

## Fase 44 — Motion Design do Companion HUD (2026-11-02)

- [x] Implementadas as tarefas 44.1 a 44.11. Plano: `docs/plans/phase-44-companion-motion-design.md`.
- [x] Baseline → final (âncora padrão, 100% e 150%): salto máximo do mascote por quadro de 487 px para 32 px; cápsula de 274 px para 0,6 px; quadro p95 de 16,8 ms; CPU parada do renderer do HUD de 0,14% para 0,09% (100%) e de 0,41% para 0,29% (150%).
- [x] Gate do palco fixo aprovado: CPU 0,12% → 0,15%, always-on-top e `WS_EX_TRANSPARENT` preservados.
- [x] Bundle principal de 882 KB para 861 KB gzip; `CompanionHud` carrega sob demanda (117 KB gzip).
- [x] Verificação: typecheck, lint, Vitest, E2E do Companion (31 aprovados), HUD empacotado com CSP de produção e áudio `data:` carregando, dois monitores. Duas revisões independentes, com correções cobertas por teste.
- [x] HUD volta a cada início (`showCompanionHudOnLaunch`), decisão do usuário em 2026-11-02; ocultar vale só para a sessão. E2E atualizado.
- [x] Mouse real (`NB_E2E_REAL_MOUSE=1`): clique na margem transparente alcança a janela de baixo; arraste e clique no mascote não tomam foco (5 execuções seguidas aprovadas, depois 4 de 5 após as correções finais: uma não iniciou o arraste, sem reprodução nas 3 seguintes). Antes delas, uma execução falhou com a barra de tarefas do segundo monitor em primeiro plano, sem reprodução, e outra por ler a posição antes de assentar, corrigido no teste.
- [x] Fala real com VoiceStudio (`NB_E2E_REAL_VOICE=1`): o teste expôs que o CSP bloqueava áudio `data:` e a voz sempre caía na do navegador. Com `media-src 'self' data:`, o áudio toca, o analisador lê nível real (pico 0,27) e o mascote volta ao estado anterior no fim.
- [x] Expressões `speaking`, `voiceListening` e `thinking` capturadas em `artifacts/motion/` e conferidas.
- [x] Carga: com todos os núcleos ocupados, nenhuma tarefa longa acima de 50 ms, quadro p95 de 16,8 ms e clique em até 19 ms, nos ciclos mascote/cápsula.
- [x] Travessia entre monitores a 100%/100%: palco mantém 820×440 e a posição salva fica no monitor de destino.
- [x] DPI misto real (150%/100%, nas duas direções, no app empacotado): sem salto, conteúdo com exatos 820×440 e painel inteiro no destino. A 150% os bounds lidos variam 1 px por arredondamento, sem acúmulo. O `electron.exe` de desenvolvimento reporta todo monitor a 100%, então este teste precisa do pacote.
- [x] Revisão visual humana: aprovada pelo usuário em 2026-11-02.
- Fora do escopo: monitor com menos de 820 px de largura; o HUD assume ao menos 1024×600.
- Instabilidade fora da fase: `workflow-runner.test.ts` falhou uma vez na suíte completa e passou isolado (23/23).
- Decisão: FLIP ao soltar foi medido e rejeitado (saltos de 280 a 957 px); o palco acompanha a âncora durante o arraste, e o main só acomoda os últimos pixels.

## Balão de sugestão da Neura (2026-11-02)

- [x] Sugestão pendente aparece em um balão que sai do mascote, nos modos mascote e cápsula. Abre em silêncio e sem foco; Copiar passa pelo processo principal, porque a área de transferência do navegador exige janela focada.
- [x] Durante uma reunião, o HUD usa `setContentProtection`. Conferido com captura real por `gdigrab`: balão e HUD não aparecem. O comportamento em cada programa de reunião ainda precisa ser conferido em uso.
- [x] Verificação: typecheck, lint, Vitest, E2E do Companion e da Neura, e HUD empacotado.
- [ ] Pendente: a reunião ainda recebe a transcrição colada; o balão só aparece quando há sugestão gerada por esse fluxo.


## Captura automática de reunião: investigação (2026-11-02)

- [x] Corrigido: sugestões e conversa com o Claude falhavam sempre, porque `--json-schema` recusa o `$schema` 2020-12 gerado pelo Zod.
- [x] Testado: captura do áudio do sistema por `loopback` no Electron funciona no Windows, e o Whisper local transcreveu a frase de teste sem erro.
- Medido: Whisper 11,3 s para 4,3 s de áudio, mais lento que a fala; sugestão real de 3,6 a 4,6 s; 45 mil tokens de entrada e US$ 0,14 a 0,36 por fala, conforme o CLI. Hoje toda fala gera uma sugestão, inclusive frases que não são perguntas.
- Causa da lentidão do Whisper: com a voz carregada faltava VRAM, então o large-v3 rodava na CPU, e o VoiceStudio recarrega o modelo a cada chamada. Ao iniciar uma reunião o app agora descarrega a voz: 7,8 GB → 4,7 GB de VRAM e 11,3 s → 4,2 s para 4,3 s de fala. Pelos logs, cerca de 3,5 s são recarga; a transcrição leva 0,5 s.
- Streaming do VoiceStudio sem modelo de ditado não serve: só entrega o texto no fim e não envia parciais.
- [x] Filtro local `needsReply` pronto, aplicado só a fala capturada; texto colado continua gerando sugestão. Sem captura, ele ainda não atua.
- [x] Parakeet TDT v3 medido por `/v1/audio/transcriptions/stream?pcm=1&sr=16000&model=sherpa-parakeet-tdt-v3`, com a licença aceita pelo usuário: 1,9 s para carregar uma vez, parciais a cada 0,9 s, frase final cerca de 1,4 s depois do fim da fala, sem erro nas duas frases de teste. Foi voz sintética limpa; falta áudio real de call. O VoiceStudio registra a licença como `NOASSERTION`, sem revisão e com uso comercial desconhecido.
- [x] Custo: sugestões com Claude agora rodam sem ferramentas, configurações, plugins ou memória, com Haiku por padrão. Medido no app: de 45 mil para 1,9 mil tokens e de US$ 0,14–0,36 para US$ 0,0005 por sugestão, em 4,6 a 10,2 s. Com Codex nada muda.
- [x] Captura de call: botão **Ouvir a call**, com consentimento próprio, fonte `system-audio` por Parakeet e permissão aberta só para o HUD enquanto a reunião está ativa. Cadeia real testada, no app e no pacote: voz nas caixas, captura, transcrição, filtro, agente e balão, de 4,9 a 6,5 s depois de a pergunta terminar.
- [x] Revisão independente: aviso **Ouvindo a call** em todos os modos; ocultar, fechar ou perder o HUD encerra a captura; sessão única; sem câmera ou microfone pela permissão; limite de fila e vigia de quadros; comandos de voz suspensos durante a call.
- [ ] Risco aberto: o VoiceStudio descreve um defeito do `sherpa-onnx` em que o Parakeet devolve vazio para fala clara; quando o Whisper entende o mesmo trecho, ele rebaixa o Parakeet na máquina e passa a usar um modo lento e sem parciais. Aconteceu uma vez, no pacote, em 2026-11-02. O app agora encerra a captura e avisa depois de 15 s de fala sem resposta. Para reativar, troque o ditado do VoiceStudio para outro modelo e volte ao Parakeet: reescolher o mesmo não limpa o rebaixamento.
- [x] Pacote: depois de reativar o Parakeet, 4 de 4 rodadas com e sem pedido de câmera, a 5,6 s do fim da pergunta, e uma sessão com quatro frases: três perguntas respondidas em 4,6 a 6,6 s e a afirmação ignorada pelo filtro. A câmera não era a causa.
- [ ] Sem explicação: duas rodadas anteriores do pacote não chegaram ao agente e não voltaram a ocorrer. Parte delas coincidiu com o build do Codex e com o Parakeet rebaixado, mas a causa não foi provada.
- [ ] Risco: o rebaixamento ocorre quando uma sessão inteira termina sem nenhuma palavra e o Whisper entende algo no mesmo áudio. Um tom de teste de 440 Hz bastou, então uma sessão só com música pode causá-lo. O app não consegue impedir isso pelo protocolo.
- [ ] Pendente: testar numa call real, com ruído e várias vozes. A captura pega tudo o que o computador toca, inclusive música.
- [ ] Menores adiados: o limite de 4 horas encerra sem mensagem; o aviso em `hearing-cue` pode sobrepor o conteúdo do painel.
- [x] E2E `wakes on the word` atualizado para acompanhar o `autoStartVoice` e a retomada automática após pausa; suíte `tests/e2e/neura-assistant.spec.ts` passou 6/6 em 2026-11-02. A homologação com microfone/VoiceStudio reais continua separada e pendente.

## Idioma das sugestões (2026-11-02)

- [x] A resposta segue o idioma da pergunta, decisão do usuário. Sem o worker local, `questionLanguage` distingue inglês e português; o modelo recebe a regra e redige de novo se responder em outro idioma. Outros idiomas continuam a cargo do modelo, sem a nova tentativa.

## Fase 34 — fechamento parcial (2026-11-02)

Memória por escopo, pausa de memória global, proteção de campo de senha antes do modelo, redação de texto da tela, limite de captura e instrumentação de latência implementados. Pedido de alteração por voz ou texto inicia tarefa no projeto selecionado só após confirmação no painel. Pendentes: testes reais (microfone, Spotify, chamada, versão instalada) e valores reais de latência. Detalhes em `docs/PLAN.md`, Fase 34.

## Fase 45 — Fala da Neura por frases (reduzida em 2026-11-02)

- [x] Decisão do usuário: cancelar modo Live, modelo local e modo híbrido; a Neura só fala quando é chamada.
- [ ] Medir a chamada real antes de implementar a fala por frases.
- [ ] Bug à parte: `useNeuraVoiceOutput` fala no idioma preferido, não no idioma da pergunta.

Plano: `docs/plans/phase-45-neura-live-local.md`.
## Velix — produção audiovisual autônoma (2026-11-04)

- Implementada a fundação da Fase A: contratos Zod em `packages/shared`, migrações aditivas `0062`–`0072`, tabelas e repositório de produção, e serviço de agendamento idempotente sobre o TaskEngine.
- Verificação: `npm run typecheck -- --pretty false` passou; `packages/database/test/database.test.ts` passou 12/12.
- A suíte ampla em paralelo apresentou falhas nos testes existentes que exercitam Git concorrente; conforme o AGENTS.md, a confirmação deve usar `npx vitest run --no-file-parallelism`.
- Atualização (2026-11-04): concluídas a sincronização stage ↔ eventos do TaskEngine, orçamento com reserva/reconciliação e aprovação, pausa/cancelamento, recuperação no boot, artefatos idempotentes com caminho validado, IPC/preload e painel "Produções persistidas". Vitest 6/6 + regressão 172/172; E2E Electron de reinício 1/1 e `velix-gaps` 6/6; typecheck, lint dos arquivos alterados e build aprovados.
- Fase B (2026-11-04): roteiros longos por capítulos sobre o TaskEngine, com checkpoint por lote, consolidação sem repetição, Dossiê v1 preservado para roteiros curtos, IPC e painel "Gerar roteiro". Vitest 18/18 nos arquivos da fase; E2E 2/2; regressão Velix E2E 18 aprovados/3 pulados; `workflow-runner.test.ts` falhou só em paralelo e passou 23/23 em série.
- Fase C (2026-11-04): afirmações e evidências persistidas, pesquisa por trecho com cache sobre o TaskEngine, fontes e mídias não aprovadas só como pendentes na Descoberta, aprovação humana de evidência e gate bloqueante de fatos sem evidência. Vitest 7/7 da fase, `database.test.ts` 25/25, E2E 3/3 e regressão Velix 18 aprovados/3 pulados.
- Fase D (2026-11-04): storyboard versionado com ranking explicável, fallback declarado, validação bloqueante e edição (mover, trocar, bloquear, dividir) que sobrevive ao reinício exatamente. Vitest 699/699 nos pacotes; E2E 4/4 da produção e regressão Velix 22 aprovados/3 pulados.
- Fase E (2026-11-04): narração em blocos pelo VoiceStudio local com reuso por conteúdo, união com FFmpeg e medida com FFprobe; sincronização por transcrição local coloca o storyboard no tempo real e reporta palavras ausentes, pausas e desvios. Vitest 745/745; E2E da narração 1/1 (repetido 4×, mais 5/5 junto da produção) e regressão Velix 18 aprovados/3 pulados. Uma falha intermitente do E2E novo, na primeira execução após o build, não teve a causa capturada.
- Fase F (2026-11-04): render por formato pelo motor existente (Remotion + FFmpeg), legendas SRT (gravadas quando há libass), QA técnico/editorial com bloqueantes, aceite explícito só do que é dispensável e exportação com créditos e manifesto de fontes e licenças. Vitest 750/751 (falha isolada em `multi-project.test.ts`, 8/8 em série), E2E com Remotion real 2/2 e regressão Velix 22 aprovados/3 pulados.
- Fase G (2026-11-04): linha do tempo multipista com edição por teclado; clipes de narração por cena mantêm o tempo medido ao mover, dividir e trocar; render reaproveita o que não mudou; prévia rascunho e restauração de versões. Vitest 754/755 (falha isolada em `multi-project.test.ts`, 8/8 em série), E2E Velix 24 aprovados/3 pulados, incluindo a jornada de teclado com Remotion real.
- Pendente: custo estimado por lote, aprovação de capítulos pela UI, busca web por trecho, conferência do trecho contra a fonte, arrastar e soltar (storyboard e linha do tempo), aparar clipes e zoom da linha do tempo, metadados FFprobe no ranking, narração/transcrição reais e idioma da transcrição, música e SFX na mixagem, estilos da Fase 48 nos segmentos, execução com CLI real, capability flag por projeto e Fases H–I.
## Enterprise consolidation — Task 4.1 Release engineering (2026-11-05)

- [x] Added `docs/release/windows-release-checklist.md` with clean install, upgrade, unsupported downgrade, migration failure, uninstall/data preservation, extension preservation, diagnostics, signing, and real-machine validation criteria.
- [x] Added `npm run diagnostics:export`, including version, commit, platform, migration summary, extension state, database presence/hash, and installer/update status with redaction of credential-like fields. Manual export smoke test passed on 2026-11-05.
- [x] Extended `verify:dist` to print the installer SHA-256 and explicit local signing status.
- [x] Added `verify:windows-signature`, a real Authenticode gate using Windows SDK `signtool.exe`; it intentionally fails when the artifact is unsigned or the signing tool is unavailable.
- [x] Final gate evidence (2026-11-05): `npm run verify:dist` passed with installer SHA-256 `b9592fc019271d66506a7256b82cde094b16d63450cd9d5df41ced4260b00ab1`; `verify:windows-signature` correctly blocked on missing `signtool.exe`.
- [x] Clean-install smoke test (2026-11-05): NSIS `/S /D=C:\dev\neuralbridge\.release-test-install` exited 0 and created `NeuralBridge.exe` plus the uninstaller; silent uninstall exited 0 and removed the isolated install directory. The real `%APPDATA%\NeuralBridge` was not touched.
- [x] Real Windows clean-install and isolated uninstall validation passed; upgrade over a distinct previous installer remains pending. Local packaging is unsigned because no certificate was configured. Automatic update is not configured.
- [x] Upgrade baseline audit (2026-11-05): historical `dist/stale-neura-build-20261102/NeuralBridge-Setup-0.1.28-x64.exe` was found, but isolated silent installation exited `2` without creating `NeuralBridge.exe`; it was not used as a valid previous release. No artificial older build was generated.
- [ ] Task 4.1 remains externally blocked by signing, automatic update and previous-installer homologation; Tasks 4.2–4.4 are implemented and locally validated.
# Extension hardening (next maintenance slice)

Task 2.4 remains functionally complete; this hardening slice adds strict package-boundary validation, atomic activation cleanup, capability contracts and user-data-safe removal. Evidence: `docs/architecture/extensions-security.md` and `docs/release/extension-hardening-matrix.md`.
