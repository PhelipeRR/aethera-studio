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
