# Aethera Studio — Auditoria de Redesign Visual & Funcional

## 1. Matriz Tela Atual → Tela Nova → Funcionalidades Preservadas

| Rota | Tela Anterior | Nova Tela Aethera Studio | Funcionalidades Preservadas & Novas |
| --- | --- | --- | --- |
| `/aethera` | `AetheraHomePage` | `AetheraStudioHome` | Herói cinematográfico, CTA **Criar Vídeo com IA**, Pipeline vertical, Projetos Ativos, Agentes Cinematográficos (Humor 35%), Qualidade & Pendências |
| `/aethera/projects` | Ausente / disperso | `AetheraProjectsPage` | Grade/lista de projetos com filtros por estado, busca, barras de progresso reais, criação de projeto e atalhos para Editor/Gerenciar |
| `/aethera/cinema` | `CinemaDirectorPanel` básico | `CinemaDirectorPanel` (Direção Criativa) | Briefing em linguagem natural, gênero/duração/formato, Humor 35% padrão, agentes ativos (RF-07), storyboard com Plano A/B, revisão por prompt e exportação OTIO |
| `/video` | `VelixPage` | `AetheraStudioEditor` + `/video/remotion` | Workspace NLE 4 zonas (Biblioteca, Preview, Inspetor Cor/Áudio/Velocidade, Timeline multifaixa V3/V1/A1/A2/A3 + Assistente IA recolhível) + acesso ao Estúdio Remotion completo |
| `/aethera/library` | `ContentLibraryPage` simples | `AetheraMediaLibraryPage` | Árvore de coleções por projeto, filtros por tipo, grade visual, inspetor lateral com SHA-256, origem e direitos de uso |
| `/agents` | `AgentsPage` genérica | `AetheraAgentsPage` | 9 papéis cinematográficos + **Orquestrador Aethera**, motores Claude/Codex em aba técnica secundária, fallback RF-07 com 1 agente |
| `/aethera/review` | Ausente | `AetheraReviewRoomPage` | Sala de revisão com cenas, player + mini timeline, Qualidade Geral SVG verificável (`@neuralbridge/cinema`), comentários com timestamp, revisão por prompt e aprovação final |
| `/aethera/queue` | `ContentQueuePage` | `ContentQueuePage` (tema Aethera) | Fila real de produções e renderizações |
| `/aethera/calendar` | `ContentCalendarPage` | `ContentCalendarPage` (tema Aethera) | Calendário editorial mensal/semanal preservado |
| `/aethera/channels/new` | `ContentChannelSetupPage` | `ContentChannelSetupPage` (tema Aethera) | OAuth YouTube, identidade visual e publicação preservados |
| `/settings` | `SettingsPage` | `SettingsPage` (tema Aethera) | Configurações preservadas |

## 2. Separação Visual do Singularity
- Substituído `AppShell` + `TopNav` (que exibia `Orquestrador`, `MCP`, `RAG`, `Memórias`) por `AetheraShell` + `aethera-theme.css` (`data-studio-theme="aethera"`).
- Nenhuma dependência de runtime adicionada em relação a `apps/desktop`.

## 3. Lacunas Técnicas & Pendências Explícitas
- **Renderização MP4 / FFmpeg local:** ações de edição na timeline do `AetheraStudioEditor` atualizam o IR e exportam OTIO JSON; a renderização final de vídeo MP4 depende do `Estúdio Remotion Avançado` (`/video/remotion`) ou FFmpeg instalado no ambiente.
- **Avaliação humana cega e mídia real externa:** métricas de qualidade na sala de revisão usam o motor determinístico `@neuralbridge/cinema` e os ativos/projetos reais do SQLite local; sem mídia externa real importada, o workspace exibe estados vazios ou sessões de direção sintéticas claramente identificadas.
