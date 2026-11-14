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
