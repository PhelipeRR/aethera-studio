# Aethera — Plano por fase

Regras: cada fase exige autorização antes de começar; nada de commit/push sem autorização; registrar decisões, limites
e testes em `docs/aethera/STATUS.md`. Complexidade: P (dias), M (1–2 semanas), G (várias semanas) — estimativa de
esforço de engenharia, não de prazo.

| Fase | Objetivo | Arquivos principais | Complexidade | Testes | Rollback |
|---|---|---|---|---|---|
| **AET-01** | Auditoria e plano (esta) | `docs/aethera/*` | P | — | Documento |
| **PoC Hypit** — **concluída** | Provar Hypit no Windows, isolado | pasta temporária fora do repo | P | `doctor`, `check`, `plan`, `pricing --json`, `build`, `get`, `cancel`, `status --json`, RAM/CPU — **todos passaram** (`POC-HYPIT.md`) | Feito: cache e processos removidos |
| **AET-02** Rebranding seguro | "Velix" → "Aethera" só no que o usuário vê | `renderer/src/app/routes.ts` (rótulo/descrição), `features/video/*.tsx` (27 textos), `extensions-velix` (nome exibido), `docs` de usuário, títulos de janela e notificações em `main/index.ts`, `velix-capture-window.ts` | P–M | Varredura de texto visível sem "Velix", visuais atualizados, E2E do Velix inteiros, abertura de projetos e produções antigas | Reverter textos; IDs nunca mudaram |
| **AET-03** Identidade visual | Preto, violeta espacial, dourado sutil, vidro escuro; logo/ícone; splash; dashboard; navegação; ultrawide; movimento reduzido | `features/video/*`, novos componentes em `features/aethera/`, tokens próprios em `styles.css` (escopo da aba), ativos em `assets/aethera/` | M–G | Contraste WCAG, varredura de acessibilidade, visuais em 3 larguras e ultrawide, custo em repouso, `prefers-reduced-motion` | Tokens com escopo; desligar a nova casca |
| **AET-04** Motores | `VideoEngine`, registro, "Auto", motor de origem por produção | `packages/shared/src/aethera-engine.ts` (contratos), `packages/orchestrator/src/aethera/engine-registry.ts`, adaptadores Remotion e kit extraídos de `velix-render-stage.ts`/`velix-production-render.ts`; migração aditiva `engine` em `velix_production_runs` | M | Contratos (zod), seleção Auto, produções antigas com o motor original, render Remotion idêntico ao atual | Registro com só Remotion; coluna ignorada |
| **AET-05** Hypit | Adaptador pela CLI (JSON estável: `pricing --json`, `status --json`, `result.json`), opcional, isolado, com custo e consentimento; o adaptador gera o projeto Hypit pronto (package.json marcado, perfil, componentes compilados) | `packages/workspace/src/hypit-cli.ts`, `orchestrator/src/aethera/hypit-engine.ts`, tela de configuração do motor | M (PoC confirmou o Windows) | Fakes de CLI com saídas gravadas, produção completa real com Hypit, falhas de dependência, cancelamento, segurança (argumentos, caminhos, sem shell), privacidade | Motor desligado; nada do Hypit no instalador |
| **AET-06** Editor e timeline | Multitrilha, prévia, áudio, narração, legendas, efeitos, transições, autosave, recuperação | `ProductionTimeline.tsx`, `ProductionStoryboard.tsx`, `velix-timeline.ts`, `velix-composition.ts` (evolução, não reescrita) | G | Edição, autosave, recuperação após queda, desempenho com muitas cenas | Editor atual continua acessível |
| **AET-07** Agentes | Fluxo tema → pesquisa → roteiro → cenas → recursos → motor → prévia → render, com intervenção humana | `ProductionRunService` (já tem as etapas), aprovações (`velix_production_approvals`) | M | Fluxo completo com agentes falsos, aprovações em cada etapa, registro de fontes e custos, recusa de comandos vindos de prompt/arquivo | Etapas existentes inalteradas |
| **AET-08** Templates e escala | 9 templates, 3 formatos, versões (idioma/roteiro/narração/proporção), fila de render com concorrência limitada | `video-styles.ts`, `velix-derivatives.ts`, nova fila em `orchestrator/src/aethera/render-queue.ts` | M | Fila sob carga (CPU/GPU/RAM com o monitoramento real), versões derivadas | Fila com concorrência 1 |
| **AET-09** Qualidade e entrega | Toda a bateria pedida + uma produção completa por motor + instalador | testes e docs | M | Unidade, integração, E2E, migração, abertura de projetos Velix, render Remotion e Hypit, cancelamento/recuperação, dependências ausentes, segurança, desempenho, instalador | Documentação de rollback |

## Decisões do usuário (2026-11-09)

1. **O app não será vendido nem fornecido a terceiros com fins comerciais.** O Hypit pode ser usado sob a Hypit Open
   Source License como ferramenta da própria organização; mesmo assim ele não é empacotado: o usuário instala o
   Hypit e o app o detecta. Atribuição do Hypit mantida nas telas de resultados.
2. **PoC isolada do Hypit autorizada.**
3. **O kit MotionVelix mantém o nome.**
4. **Licença comercial do Remotion: não se aplica** (sem comercialização). Rever se isso mudar.

## Decisões que dependiam do usuário (histórico)

1. **Distribuição comercial com Hypit**: o app vai ser vendido ou fornecido a terceiros? Se sim, ou o Hypit fica
   como instalação do próprio usuário (recomendado) ou é preciso autorização escrita da Hypit.AI.
2. **Autorizar a PoC isolada do Hypit** (instala `@hypit/hypit` numa pasta temporária, sem credenciais).
3. **Escopo do nome**: o kit MotionVelix (skill externa) mantém o nome? (recomendado: sim, é outro produto).
4. **Licença do Remotion** para uso comercial: confirmar o enquadramento antes de distribuir.

## Ordem recomendada

AET-02 → AET-03 → AET-04 → AET-05 → AET-07 → AET-06 → AET-08 → AET-09. A PoC provou o Hypit no Windows para render
local; provedores externos e programas Python ficam para validar dentro do AET-05, com consentimento.

## Aethera Autonomous Studio (programa AS) — arquitetura aprovada em 2026-11-10

Plano consolidado: `docs/plans/aethera-autonomous-studio.md` (decisões D-AS-1…6, arquitetura, contratos, testes,
benchmark B-1, riscos e pré-requisitos). AS-01 concluída (documentação). Cada fase seguinte exige autorização própria.

| Fase | Objetivo | Depende de | Estimativa | Estado |
|---|---|---|---|---|
| AS-01 | Auditoria, decisões, contratos | — | — | Concluída |
| AS-02 | Fundação: contratos em código, etapas aditivas, checkpoint por item, VisionRouter, cenário de referência | P1–P6 | 3–4 d | Concluída; commit AS-02 |
| AS-03 | Game Research (IGDB → web → RAWG) | AS-02 | 4–6 d | Concluída; pesquisa real executada no Aethera |
| AS-04 | Media Acquisition (YouTube, oficiais, local, yt-dlp; retomada, dedupe, proveniência) | AS-02, AS-03 | 6–9 d | Descoberta real concluída; aquisição aguarda revisão das fontes |
| AS-05 | Visual Intelligence + benchmark B-1 (Codex, locais, externos) | AS-04 | 8–12 d | Concluída a fundação automatizada; commit AS-05; homologação B-1 real pendente |
| AS-06 | Semantic Scene Matching (frase ↔ trecho com timestamps) | AS-05 | 5–7 d | Concluída; commit AS-06; calibração real permanece pendente |
| AS-07 | Ranking Templates (Remotion) | AS-03 | 4–6 d | Concluída; commit AS-07; validação visual determinística sintética concluída |
| AS-08 | Semantic Editing (linguagem natural → operações no storyboard) | AS-06 | 5–8 d | Concluída; commit AS-08; validação com agente/mídia reais permanece externa |
| AS-09 | Quality Director ampliado | AS-06, AS-07 | 4–6 d | Concluída; commit AS-09; homologação com mídia real permanece externa |
| AS-10 | Validação com 3 jogos reais e métricas (gate do 1º release) | AS-03…09 | 2–3 d | Em execução; pesquisa IGDB e descoberta de mídia reais concluídas, aquisição/labels/render/QA ainda bloqueados |
| AS-11 | Shorts, memória criativa, AutoPilot — só com lacuna comprovada | AS-10 | sob demanda | Não autorizada |

## Evolução Funcional NLE & Qualidade Verificável (2026-11-13)

| Etapa | Escopo | Estado |
| :--- | :--- | :--- |
| **NLE-01** | Editor NLE real (`AetheraStudioEditor.tsx`): preview canvas ao vivo + `<video>` via `aethera-media://`, régua temporal, playhead/scrubbing, zoom, snap magnético, drag de clipes, thumbnails e waveforms reais, undo/redo, persistência e renderização MP4 refletindo edições. | Concluída e validada em E2E Electron |
| **NLE-02** | Produção cinematográfica (`CinemaDirectorPanel.tsx`): sincronia automática de duração do prompt (ex.: `12 minutos` → `720s`), storyboard visual com duração/câmera/áudio e gate explícito de aprovação antes do Editor. | Concluída e validada em E2E Electron |
| **NLE-03** | Qualidade verificável (`AetheraReviewRoomPage.tsx`, `real-media-probe.ts`): separação explícita entre estimativa de planejamento e auditoria real FFprobe/ebur128/blackdetect no MP4 final. | Concluída e validada em E2E Electron |
| **NLE-04** | Fluxo Biblioteca & Agentes (`AetheraMediaLibraryPage.tsx`, `AetheraAgentsPage.tsx`): importação/drag-and-drop com thumbnail e waveform, preview `<video>`/`<img>`/`<audio>` e distinção entre motores disponíveis e agentes em execução. | Concluída |
| **CINEMA-REAL-01** | Produção Audiovisual Real (`Elden Ring` & `Hollow Knight: Silksong`, 60.6s, 10 cenas): clipes reais limpos com procedência registrada, narração SAPI PT-BR, ducking, SFX, VFX, humor 35%, comparativo Antes (`v1`) vs Depois (`v2`), sonda `scdet`/`silencedetect` e importação E2E no Electron. | Concluída e auditada (`REAL-GAMEPLAY-SHOWCASE-AUDIT.md`) |


Pré-requisito central: nenhuma mudança de runtime antes de o Content OS (migrações 0098–0103) estar estabilizado e em commit.


---

## Auditoria de Integração & Validação Real — Evolution 2.0 (Etapas A, B, C) — 2026-11-14

Matriz de maturidade após auditoria e correções de integração no pipeline principal (`apps/aethera-desktop/src/main/cinema-pipeline.ts` e `aethera-ipc.ts`):

| Funcionalidade | Implementada | Integrada no Pipeline | Testada (Vitest) | Validada em Render Real (FFmpeg) | Lacunas / Notas |
| --- | --- | --- | --- | --- | --- |
| **Etapa A1: Detecção objetiva (`blackdetect`, `silencedetect`, `freezedetect`)** | Sim | Sim (`renderRealCinemaMp4` + `cinema:probe-real-mp4`) | Sim | Sim | Filtra fades de borda (`<= 1.2s`/`1.5s`) e pausas dramáticas (`<= 2.2s`) ou intervalos intencionais (`intentionalRanges`). |
| **Etapa A2: Cache incremental por cena (`segmentCacheDir`)** | Sim | Sim (`projectPaths.tempDir/segment-cache`) | Sim | Sim (3 cenas, edita cena 2 -> `cacheHits: 2`, `reRenderedScenes: 1`) | Hash `sha1` inclui `sourceUri`, `sourceStat` (`mtimeMs`, `size`), `dur`, `speed`, `trimIn/Out`, `vf`, `fontOption`, `effects`, `beatSummary/Stage`, `previewQuality`, `useNvenc`, `fps`. Escrita atômica `.tmp` + `renameSync` e limpeza de `.tmp` órfãos. |
| **Etapa B: Edição semântica (`matchNarrationSegmentsToMedia`)** | Sim | Sim (`cinema-pipeline.ts` etapa `planejamento`) | Sim | Parcial (validada com descritores; aguarda mais testes com mídia real variada no desktop) | Correlaciona `pkg.direction.narrativeBeats` aos clipes `v1` quando `acquiredMedia.length > 0`. |
| **Etapa C1: Academy Production Learning (`production-learning.ts`)** | Sim | Sim (`cinema-pipeline.ts` aplica `resolveLearnedSceneConstraints`) | Sim | Parcial (validada em `evolution-2.0.test.ts` + hook no pipeline) | Regras aprendidas (`avoidHudOverlap`) injetam `hide_title` antes da montagem/render. |
| **Etapa C2: AI Visual Critic (`evaluateRenderedVisualCritic`)** | Sim | Sim (`cinema-pipeline.ts` etapa `previa`) | Sim | Sim (extração real de frames + modo provedor e modo degradado) | Quando `deps.analyzeFrameWithAI` não é injetado pelo runtime, opera em modo degradado determinístico (frames + FFmpeg anomalies + regras Academy). |
| **Etapa C3: Supervisor Autônomo (`runAutonomousSupervisorPass`)** | Sim | Sim (`cinema-pipeline.ts` etapa `previa` com re-render incremental) | Sim | Parcial (guarda anti-loop `maxAttempts: 2` + `previousActionSignatures` testada; aprovação visual final manual) | Escalona para `escalate_to_user` se repetir assinatura de reparo ou atingir `maxAttempts`. |

### AI Visual Critic com Visão Real & Reparos Direcionados — 2026-11-14

- **Provedor real reutilizado (sem duplicação):** `apps/aethera-desktop/src/main/aethera-ipc.ts` conecta `analyzeFrameWithAI` ao `VisionRouter` + `createVisionProviders` + `createTaskEngineVisionProvider` (`@neuralbridge/orchestrator`), com fallback automático `['claude', 'codex', 'local-siglip', 'local-vlm', 'ffmpeg-heuristics']`, operando com 1 único provedor ou em modo degradado.
- **Critérios avaliados (`packages/cinema/src/qc/visual-critic.ts`):** composição, HUD (`hide_lower_third`), legendas/tipografia (`adjust_typography`), repetição visual (`swap_duplicate_clip`), correspondência narração-imagem (`retry_media_research`), VFX (`adjust_vfx`) e SFX (`adjust_sfx`).
- **Reparos direcionados & cache incremental:** `cinema-pipeline.ts` aplica reparos somente nas cenas em `rerenderSceneIds`, preserva cenas aprovadas e reutiliza `segmentCacheDir`, com segunda passagem anti-loop (`maxAttempts: 2`, `escalate_to_user`).
