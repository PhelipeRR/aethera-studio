# Status do Projeto — Aethera Studio & Singularity

**Última atualização:** 2026-11-15

## Entregas Concluídas e Verificadas

- **Integridade Editorial (Aethera Studio):** `EditorialScript` como fonte única de verdade, checkpoint por blocos, fallback transparente (`paused_pending_script`) e verificação de consistência com TTS e legendas (`packages/cinema/test/editorial-integrity.test.ts`).
- **Escola de Storytelling Aethera & Backup:** 4 módulos curriculares (Pixar in a Box, Story Structure, Lessons from the Screenplay e Identidade Aethera Games) ingeridos e validados na Academy viva (`79` técnicas extraídas/validadas), benchmark Antes vs. Depois (`22/70` -> `58/70`) e botões **Fazer Backup** / **Restaurar Backup** (`academy-store.json` + `evolution-store.json`).
- **Calendário Editorial Inteligente 2.0:** `EditorialCalendarEngine` + UI interativa com visualizações Mês/Semana/Agenda, drag-and-drop com confirmação e rollback, portão da Sala de Revisão, séries recorrentes, fuso horário IANA + DST e planejamento IA (`packages/cinema/test/editorial-calendar-engine.test.ts`).
- **Isolamento de Configurações & Tutoriais Interativos:**
  - `AetheraSettingsPage.tsx` com 10 categorias exclusivas do Aethera Studio (removendo Companion, Dispositivos e Azure DevOps do Aethera e mantendo-os no Singularity).
  - `SetupTutorialDrawer.tsx` + `settings-tutorials.ts` com tutoriais guiados e teste real de conexão (`apps/aethera-desktop/test/settings-isolation-and-tutorials.test.ts`).
- **Channel Manager 2.0:**
  - Gerenciador completo em abas (`ContentChannelSetupPage.tsx`), conexão OAuth real com YouTube + importação de metadados/avatar/banner, Brand Kit visual com prévia ao vivo, estratégia editorial, templates de publicação + prévia, matriz de autonomia por etapa e CRUD completo (`contentChannelsList`, `contentChannelCreate`, `contentChannelUpdate`, `contentChannelDelete`).
  - Testes de migração de legado, isolamento entre canais, permissões de publicação automática e persistência (`packages/database/test/channel-manager-v2.test.ts`).
- **Media Relevance Gate, Media Coverage Planner & AI Voice Director (2026-11-14):**
  - **Causa raiz auditada:** `cinema-pipeline.ts` limitava `extractSceneQueriesFromPrompt(job.prompt, 4)` para qualquer duração e passava apenas `basename(m.uri)` (`slot_N.mp4`) ao matcher, enquanto `aethera-ipc.ts` selecionava `results[slotIndex % results.length]` sem validação visual/entidade; `real-renderer.ts` truncava a narração em `3800` caracteres em uma única chamada HTTP ao Voice Studio (`http://localhost:3900/v1/audio/speech`) sem direção de prosódia, dicionário de pronúncia ou cache por segmento.
  - **Entregas implementadas:** `media-relevance-gate.ts`, `media-coverage-planner.ts`, `voice-director.ts`, bloqueio editorial no `visual-critic.ts` (`technicalRenderCompleted` vs. `editorialQualityApproved`), síntese segmentada + concatenação FFmpeg no `real-renderer.ts`, integração de gate pré-render (`paused_pending_media`) no `cinema-pipeline.ts` e painéis `MediaCoveragePanel.tsx` e `VoiceDirectorPanel.tsx` no `CinemaDirectorPanel.tsx`.
  - **Verificação:** `packages/cinema/test/media-relevance-coverage-voice.test.ts` (`12/12` testes passando, incluindo correspondência narrativa-visual: `exact_match`, `contextual_support`, `universe_only_coincidence` e `unverified_metadata_only`), `packages/cinema/test/editorial-integrity.test.ts` (`2/2`) e `apps/aethera-desktop/test/aethera-app.test.ts` (`3/3`), além de `typecheck` completos de `@neuralbridge/aethera-desktop` e `@neuralbridge/desktop`.
  - **Validação prática ao vivo (2026-11-14):**
    - **Voice Studio (`0.5.7`, `cuda`, voz `9190edfa`):** WAVs reais gerados para `"cabeça"` e comparação de pronúncia (`pronuncia_original_9190edfa.wav` `4,362 s` vs. `pronuncia_corrigida_9190edfa.wav` `4,502 s` com dicionário sem alterar o texto editorial).
    - **Aquisição autônoma auditada (10 min Dragon Ball Z):** prazo rígido `45.000 ms` respeitado (`elapsedMs: 45.003 ms`, `stoppedReason: "deadline_exceeded"`), filtro de `.svg` e downloads > 420 s, deduplicação por SHA-256 (`2` duplicatas descartadas), aprovação contextual de `"DBZ Vegeta fica muito irado !"` (`same_universe_context`), `4` ativos únicos aprovados com procedência/intervalos úteis (`61%` de cobertura) e envio exclusivo das `4` lacunas não resolvidas para a Sala de Revisão (`AetheraReviewRoomPage.tsx`).
    - **Limitações conhecidas:** `youtube_data_api` sem chave OAuth/API configurada foi ignorada (`skipped_no_auth`), e em sessões sem cookies do YouTube o `yt-dlp` pode sofrer bloqueio anti-bot (`blocked_auth_or_antibot`), exigindo fontes alternativas ou resolução humana na Sala de Revisão. A aprovação editorial final permanece bloqueada até audição e revisão humana.
- **Recuperação Incremental & Otimização do Scene Grounding (2026-11-15):**
  - **Entregas implementadas:**
    - `VisionRouter` (`packages/orchestrator/src/aethera/vision-router.ts`): telemetria de latência/timeouts (`getProviderTelemetry`) e ordenação dinâmica (`prioritizedChain`) priorizando `antigravity` após timeouts de `claude-gateway`.
    - `media-relevance-gate.ts`: `SCENE_GROUNDING_POLICY_VERSION = 'scene-grounding-v2'`, `computeVisionDecisionCacheKey`, gate estrito de `exact_match` (`score >= 0.65` + evidência visual), e remoção de extrapolação `[0, durationSec]` sem frames comprovadores.
    - `resilient-media-sources.ts`: `triageCandidateMetadata` (triagem barata pré-download que nunca aprova sozinha), checkpoint atômico com `visionCacheEntries`, retomada incremental ignorando cenas já cobertas e consultas concluídas, priorização de lacunas (`0s` primeiro) e `observability`.
  - **Verificação automatizada:**
    - `packages/orchestrator/test/aethera-vision-router.test.ts`: `11/11` aprovados.
    - `packages/cinema/test/media-relevance-coverage-voice.test.ts`: `19/19` aprovados.
    - `npm run build:aethera`: concluído com êxito (`exit 0`).
  - **Validação E2E real (12 cenas Cyberpunk 2077, `requireVisualVerification: true`):**
    - **Pass 1 (`maxDurationMs=180000`, `maxRounds=1`):** `stoppedReason: deadline_exceeded`, `12` consultas, `38` candidatos, `4` baixados, `1` aprovado (`coverageRatio: 0.07`), `triageEliminatedCount: 1`, fallback automático `claude-gateway` -> `antigravity`.
    - **Pass 2 (retomada no mesmo checkpoint, `maxDurationMs=300000`, `maxRounds=2`):** `resumedFromCheckpoint: true`, `skippedQueriesFromCheckpoint: 11`, `reusedFilesFromCheckpoint: 4`, `acquiredFilesCount: 11`, `approvedForAssemblyCount: 6`, `coverageRatio: 0.35` (`gatePassed: false`), preservando dependências de SFX (`hud_pulse`, `whoosh_transition`) e VFX (`subtle_vignette`, `lower_third_accent`) por cena.
    - **Lacuna remanescente observada:** `6` cenas com `0s`, `4` cenas parciais (`missingDurationSec: 466.27s`) devido a limite de orçamento por execução e latência/timeouts de CLI multimodal em concorrência.
- **Anime Source Adapters — `trace.moe` & `Sakugabooru` (2026-11-15):**
  - **Validação técnica real ao vivo:**
    - `https://api.trace.moe/me` (`200 OK`, `ratelimit-limit: 100`, `concurrency: 1`) e `POST /search?anilistInfo&cutBorders` validados com fallback e cache em disco.
    - `https://www.sakugabooru.com/post.json?limit=2&tags=dragon_ball_z` (`200 OK`), `tag.json` (`200 OK`) e `HEAD /data/673378fc55b02f4476a7363cf11eeca4.mp4` (`200 OK`, `video/mp4`, `10.3 MB`, `Accept-Ranges: bytes`) confirmados operacionais.
  - **Entregas implementadas:**
    - `packages/cinema/src/analysis/anime-source-adapters.ts`: `AnimeProvenanceAdapter`, `TraceMoeProvenanceAdapter`, `AnimeMediaSourceAdapter`, `SakugabooruSourceAdapter` e `isAnimeSubjectOrGenre`.
    - `packages/cinema/src/qc/media-relevance-gate.ts`: integração de `animeProvenance` para enriquecer metadados/episódio e rejeitar obras incorretas (`wrong_anime_or_entity`), preservando a obrigatoriedade do `VisionRouter`.
    - `packages/cinema/src/analysis/resilient-media-sources.ts`: fonte `'sakugabooru'` isolada estritamente para tópicos de anime (sem impactar jogos).
    - `packages/creative-studio/src/video-frame-analyzer.ts` & `apps/aethera-desktop/src/main/creative-studio-service.ts`: `FrameProvenanceResolver` conectado ao `TraceMoeProvenanceAdapter` com cache persistente em `creative-studio/trace-moe-cache.json`.
  - **Verificação:** `packages/cinema/test/anime-source-adapters.test.ts` + `media-relevance-coverage-voice.test.ts` (`22/22` aprovados) e validação ao vivo de `SakugabooruSourceAdapter` + `TraceMoeProvenanceAdapter` (incluindo cache hit em disco).
