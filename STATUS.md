# Status do Projeto — Aethera Studio & Singularity

**Última atualização:** 2026-11-14

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
  - **Verificação:** `packages/cinema/test/media-relevance-coverage-voice.test.ts` (`7/7` testes passando), `packages/cinema/test/editorial-integrity.test.ts` (`2/2`) e `apps/aethera-desktop/test/aethera-app.test.ts` (`3/3`).
  - **Limitação observada:** O servidor local do Voice Studio (`http://localhost:3900/health`) estava offline no momento da validação (`Impossível conectar-se ao servidor remoto`), portanto a síntese WAV real da palavra `"cabeça"` em pt-BR no Voice Studio fica pendente de execução com o serviço ativo.
