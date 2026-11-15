# Plano de Arquitetura — Isolamento de Configurações e Módulos Aethera Studio

**Regra permanente do projeto:** *Infraestrutura compartilhada, configurações isoladas por aplicativo.*

1. **Separação por Identidade de Aplicativo (`appId`):**
   - `aethera` (`apps/aethera-desktop`) e `singularity` (`apps/desktop` / `apps/orchestrator-desktop`) compartilham infraestrutura técnica (provedores de IA, memória, serviços base), mas cada aplicativo expõe apenas suas próprias configurações e rotas.
   - `packages/desktop-shared/src/renderer/src/app/app-settings-isolation.ts` define `AETHERA_ALLOWED_SETTINGS_CATEGORIES` (10 categorias), `SINGULARITY_ONLY_SECTIONS` (`companion`, `spotify`, `devices`, `azure_devops`, `neura`, `semantic_search`) e `AETHERA_FORBIDDEN_ROUTES`.
2. **Configurações do Aethera Studio (`AetheraSettingsPage.tsx`):**
   - 10 categorias: Geral, YouTube, Twitch/IGDB, RAWG e fontes externas, Agentes e IA, Narração e Voice Studio, Produção audiovisual, Academy, Publicações e Segurança/credenciais.
   - Credenciais criptografadas via Electron `safeStorage`, mascaradas na interface e sem registro em logs.
3. **Tutoriais Interativos Contextuais (`SetupTutorialDrawer.tsx` & `settings-tutorials.ts`):**
   - Painel lateral declarativo com botão *"Como configurar"* nas integrações, links oficiais verificados (`https://`), progresso preservado sem gravar segredos, destaque do campo correspondente e teste real de conexão.
4. **Calendário Editorial Inteligente 2.0 & Escola de Storytelling:**
   - Calendário completo (`EditorialCalendarEngine`, `ContentCalendarPage.tsx`) integrado à Sala de Revisão, séries recorrentes e fuso horário IANA.
   - Escola de Storytelling Aethera (`storytelling-school.ts`) com currículo estruturado e backup/restauração da Academy.
5. **Channel Manager 2.0 (`ContentChannelSetupPage.tsx` & `content-operating-system.ts`):**
   - Separação entre configurações globais do estúdio, configurações por canal (`identityJson`, `editorialStrategyJson`, Brand Kit, estratégia editorial, templates de publicação, autonomia por etapa) e configurações por projeto.
   - Reutilização da infraestrutura OAuth do YouTube (`videoChannelOAuth*`, `videoChannelProfile`) sem duplicação de credenciais.
6. **Media Relevance Gate & Bloqueio Editorial (`media-relevance-gate.ts` & `visual-critic.ts`):**
   - Validação de aderência temática por entidades (obra, personagem, jogo, contexto), avaliando frames distribuídos ao longo do clipe (`sampleDistributedFrameTimestamps`) + metadados + transcrição + procedência, sem bloquear pessoas reais quando justificadas por entrevista/live-action/bastidores.
   - Isolamento de cache por projeto e entidades (`isCacheEntryCompatibleWithProject`) com fingerprints (`buildMediaFingerprint`).
   - Separação explícita entre `technicalRenderCompleted` e `editorialQualityApproved` no `evaluateRenderedVisualCritic`, bloqueando aprovação automática em incompatibilidades graves ou falha de cobertura.
7. **Media Coverage Planner & Anti-Repetition Engine (`media-coverage-planner.ts` & `MediaCoveragePanel.tsx`):**
   - Planejamento de cobertura por segmento (`planMediaCoverage`), nunca confundindo duração bruta de arquivo com cobertura editorial útil.
   - Expansão de consultas orientada ao roteiro (`expandScriptOrientedQueries`) e escalonamento dinâmico de buscas por duração (`cinema-pipeline.ts`).
   - Motor anti-repetição (`detectMediaRepetition`) cobrindo reuso excessivo, intervalos sobrepostos, colisão de fingerprint perceptual, loops disfarçados (crop/zoom/velocidade/filtro) e segmentos estáticos longos, respeitando repetição intencional justificada.
   - Gate pré-render pausando com `paused_pending_media` quando um vídeo longo não atinge cobertura mínima.
8. **AI Voice Director, Pronunciation Dictionary & Audio Quality Gate (`voice-director.ts`, `real-renderer.ts` & `VoiceDirectorPanel.tsx`):**
   - Direção de narração por segmento (`directNarrationSegments`) com preservação de pontuação, pausas naturais, intenção emocional e pré-processamento pt-BR sem truncamento em 3800 caracteres.
   - Dicionário de pronúncia com escopos (`channel`, `project`, `voice`, `language`, `global`) aplicado apenas na entrada do TTS (`applyPronunciationDictionary`), preservando o texto editorial intacto.
   - Cache por segmento (`voice_<cacheKey>.wav`), regeneração seletiva de trechos (`planTargetedSegmentRegeneration`), avaliação objetiva + marcação obrigatória de revisão auditiva humana (`AudioQualityGateReport.requiresHumanListeningCheck = true`) e registro de regras aprovadas na Academy (`recordApprovedPronunciationRule`).
9. **Recuperação Incremental & Otimização do Scene Grounding (`vision-router.ts`, `media-relevance-gate.ts` & `resilient-media-sources.ts`):**
   - **Roteamento inteligente por telemetria (`VisionRouter.prioritizedChain`):** mede latência, falhas e timeouts por provedor, aplicando cooldown em timeouts consecutivos e priorizando `antigravity` automaticamente quando `claude-gateway` falha/expira.
   - **Scene Grounding rigoroso (`media-relevance-gate.ts`):** `SCENE_GROUNDING_POLICY_VERSION = 'scene-grounding-v2'`, chave de cache de visão (`computeVisionDecisionCacheKey`) por `(sha256, timestampsSec, visualIntent, expectedEntities, modelVersion, policyVersion)`, promoção para `exact_match` somente com `score >= 0.65` e evidência comprovada, e eliminação de extrapolação `[0, durationSec]` quando não há frames comprovadores.
   - **Checkpoint atômico, triagem em duas etapas e retomada incremental (`resilient-media-sources.ts`):** escrita atômica (`.tmp` + `renameSync`) após descoberta, aquisição e verificação; `triageCandidateMetadata` para eliminar spam óbvio antes de download/visão (sem nunca aprovar mídia sozinha); priorização de cenas com `0s` primeiro e depois maiores lacunas; métricas de `observability` (`stageTimingsMs`, `cacheHits`, `triageEliminatedCount`, `skippedQueriesFromCheckpoint`, `reusedFilesFromCheckpoint`, `estimatedRemainingWork`).
