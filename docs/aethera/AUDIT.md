# Aethera — AET-01 Auditoria técnica

Data: 2026-11-09. Escopo autorizado: **somente auditoria e planejamento**. Nenhum código foi alterado, nada foi
instalado, o Hypit não foi baixado nem executado. A prova de conceito (PoC) depende de autorização específica.

## 1. O que é o Velix hoje

O Velix é a aba de produção de vídeo do NeuralBridge/Singularity (rota `/video`, rótulo "Velix"), distribuída como a
extensão `velix` (`packages/extensions-velix`). Só a navegação depende da extensão; o domínio é composto sempre pelo
processo principal do desktop.

> Atenção ao nome: "Velix" também é o kit/skill **MotionVelix**, instalado pelo usuário em
> `~/.claude/skills/motionvelix` (`NB_VELIX_DIR`), que o app usa para renderizar templates. O Aethera renomeia a
> **aba/produto** do app. O kit externo é uma dependência com nome próprio e não é renomeado nesta frente.

### 1.1 Módulos (código real)

| Camada | Arquivos | Responsabilidade |
|---|---|---|
| Renderer | `apps/desktop/src/renderer/src/features/video/` (24 arquivos: `VelixPage`, `VelixStudio`, `VelixProduction`, `VelixMotion`, `VelixDiscovery`, `VelixIdeas`, `VelixChannel`, `Production*` — Runs, Storyboard, Narration, Timeline, Render, Evidence, Derivatives; `StyleGallery`, `CapturePanel`, `motion/`) | Telas de ideias, pesquisa, estúdio, produção por etapas, motion, canal do YouTube, estilos |
| Domínio compartilhado | `packages/shared/src/velix-*.ts` (14), `video-styles.ts`, `motion.ts` | Esquemas zod de produção, roteiro longo, evidências, storyboard, narração, sync, composição, timeline, derivados, canal, colagem, otimizador |
| Orquestração | `packages/orchestrator/src/velix-*.ts`, `video-*.ts` (≈4.500 linhas com o workspace) | `ProductionRunService` com etapas `briefing → research → script → storyboard → narration → sync → composition → render → quality → export`; cada etapa de agente é uma tarefa do `TaskEngine` |
| Workspace (mídia) | `packages/workspace/src/velix-*.ts` (18): audio, capture, clip-hunter, clip-render, discovery, dossiê, motion, narration, production-render, scenes, research, studio, styles | FFmpeg/FFprobe, captura, pesquisa, renderização por template, narração |
| Motion (Remotion) | `apps/desktop/motion/index.tsx`, `motion/render-worker.mjs`, `motion-bundle/` | Composições Remotion e o worker de render que roda fora do `app.asar` |
| Main | `apps/desktop/src/main/index.ts` (composição do `createVelixService`, `ProductionRunService`, canal do YouTube), `channel-*.ts`, `velix-capture-window.ts`, `gemini-collage-provider.ts` | Liga o domínio aos 151 canais IPC `video:*` |
| Banco | 33 tabelas: `video_projects`, `video_compositions`, `video_render_jobs`, `video_assets` e 29 `velix_*` (produções, etapas, artefatos, orçamentos, aprovações, qualidade, storyboards, derivados, estilos, publicações, canal, pesquisa, mídia e direitos) | Estado durável das produções |
| Testes | 66 arquivos com "velix" (Vitest e E2E, incluindo produção, narração, motion, canal, descoberta e visual) | Regressão |

### 1.2 Dependências

| Dependência | Versão/local | Uso | Observação |
|---|---|---|---|
| Remotion (`remotion`, `@remotion/player`, `@remotion/renderer`, `@remotion/bundler`) | 4.0.539 | Composição e render do Motion; `@remotion/compositor-win32-x64-msvc` traz FFmpeg/FFprobe | `asarUnpack` no instalador. A licença do Remotion exige licença de empresa acima de certo porte: **verificar antes da venda comercial** |
| FFmpeg/FFprobe | os do `@remotion/compositor-win32-x64-msvc` (`motionMediaTools`) ou `NB_FFMPEG` | Corte, concatenação, sondagem, montagem | Empacotado; não depende do PATH |
| Kit MotionVelix | `~/.claude/skills/motionvelix` (`engine/render.mjs`, `templates/`) | Render por template via `node` | Instalado pelo usuário |
| yt-dlp | instalação do usuário (`NB_PYTHON`…) | Download de referências autorizadas | Externo, pode faltar |
| VoiceStudio (local) | serviço local | Narração (vozes Kitten etc.) | Externo |
| YouTube Data API, Google OAuth | segredo `velix-channel-oauth.bin` (safeStorage) | Publicação no canal | Credencial preservada |
| Gemini | segredo `gemini-api-key.bin` | Colagens | Credencial preservada |
| Node | 24 (desenvolvimento); runtime do app = Electron 44 | — | — |

### 1.3 Dados, identificadores e configuração (preservar)

- Pasta de dados `%APPDATA%\NeuralBridge` (D-1) e banco `db/brain.db`.
- Tabelas `video_*` e `velix_*` (33); colunas e enums não podem ser renomeados sem migração aditiva.
- Arquivos das produções dentro de cada projeto: `producoes/<runId>/…` (narração, render, timeline de sync).
- Preferências `velixProjectId`, `velixAgent`.
- Extensão `velix` (id no banco `extensions`), rota `/video`, canais IPC `video:*`, namespace `window.neuralbridge.video`.
- Variáveis `NB_VELIX_DIR`, `NB_FFMPEG`, `NB_YOUTUBE_*`, `NB_MOTION_DISABLED`.
- Segredos `velix-channel-oauth.bin`, `gemini-api-key.bin`.
- Referências ao nome: **911 linhas** com "velix" no código-fonte (a grande maioria são identificadores internos);
  **27 textos visíveis** com "Velix" no renderer; 66 arquivos de teste.

### 1.4 Contratos com o Singularity

- Cada etapa de agente da produção é uma tarefa do `TaskEngine` (lease do CORE-04: um executor por tarefa).
- Depois do CORE-06, o **grupo Velix continua executando no motor do desktop** (não no Core); as tarefas do chat
  rodam no Core. Não há execução duplicada graças ao lease.
- Não existe hoje uma API pública de produção no Core (`/api/v1` só tem tarefas, memória e dispositivos).

## 2. Hypit (documentação oficial, verificada em 2026-11-09)

Fonte: [hypit-ai/hypit](https://github.com/hypit-ai/hypit), `package.json`, `LICENSE`, `docs/quickstart.md`,
`docs/guide/runtime.md`, `docs/quickstart/run.md`.

| Item | Fato verificado | Não documentado / a confirmar na PoC |
|---|---|---|
| O que é | Sistema para agentes (Claude Code, Codex) criarem vídeos: clonar um vídeo de referência, partir de templates ou de um prompt. Linguagem própria **SVML** (`.svml` autores, `.svs` receitas, `.svrun` execuções), compilador e runtime | Detalhes do SDK (só citado em guias de migração) |
| Pacote | `@hypit/hypit` 0.3.2, `bin: hypit` (`bin/hypit.mjs`), monorepo pnpm 10.33, TypeScript 5.9 | Estabilidade da API entre versões 0.x (há guias de migração 0.3 e 0.3.1) |
| Requisitos | Node **>= 22.15**; Chromium headless (Puppeteer) para render; FFmpeg (tópico do repositório); `uv`/Python só para programas locais (WhisperX, OpenCV); `koffi` (FFI nativo) | Suporte a **Windows** (nenhuma menção; existe um script `hypit` sem extensão), GPU, versões de FFmpeg/Chromium |
| Instalação | `npx skills add hypit-ai/hypit -g` (skill); o agente prepara o executável; `npm view @hypit/hypit@latest version` | Instalação silenciosa sem agente |
| CLI | `hypit runtime init/use/up/status/logs/down`, `programs up/status/down`, `doctor`, `paths`, `auth status/login`, `check <.svml>`, `plan <.svrun>`, `pricing <.svrun> --json`, `build <.svrun> --follow [--title]`, `status <id> --watch [--max-wait-ms]`, `inspect`, `get <id> --output … --to …`, `history`, `builds`, `cancel <id>`; flags `--project`, `--runtime`, `--asset-root`, `--package-root`, `--endpoint` | Códigos de saída; formato JSON do progresso |
| Execução | Um **Worker** próprio executa os builds (fechar o terminal não cancela); `cancel` é melhor esforço para tarefas remotas; build falho não é retomado (reuso explícito em novo build) | Comportamento do Worker como processo filho de outro app |
| Saída | `.hypit/results/<UTC-data>/<build-id>/result.json` + `files/` + `values/`; exportação explícita com `get … --to output/final.mp4`; projeto em arquivos comuns, editável no **Studio** do Hypit | Esquema do `result.json` |
| Serviços externos | Modelos opcionais: HypiHub (serviço hospedado), Seedance, GPT Image, WhisperX, Google Video Intelligence, YOLO; parceiros (Monid, HiAPI, Pollo, BeatAPI, Sume); chaves próprias via Providers; custo por vídeo dos exemplos ≈ US$ 1,07–1,15; `pricing --json` estima | Quais etapas exigem rede em um workflow "sem modelos" |
| Licença | **Hypit Open Source License** = Apache 2.0 com condições | — |

### 2.1 Licença (impacto direto no desenho)

- **Permite**: uso comercial pela própria organização, inclusive como backend interno de render e trabalho para
  clientes; rodar na própria infraestrutura; implantação single-tenant; fork e modificação publicados sob a mesma licença
  e sem fins comerciais. Os vídeos gerados pertencem ao usuário.
- **Proíbe sem autorização escrita da Hypit.AI**: vender, licenciar ou **distribuir empacotado** com produto fornecido a
  terceiros com fins comerciais; oferecer como serviço hospedado, gerenciado ou SaaS, ou operar ambiente
  **multi-tenant** (dois ou mais terceiros com workspaces separados, mesmo grátis).
- **Exige**: manter nome, logo e copyright do Hypit nas superfícies de usuário que mostram componentes dele (CLI,
  relatórios de execução, manifests, telas derivadas).
- **Consequência**: o Aethera **não deve embutir o Hypit no instalador**. O desenho recomendado é detectar um Hypit
  instalado pelo próprio usuário (como já fazemos com o kit MotionVelix e o yt-dlp), exibir a atribuição do Hypit onde
  houver saídas dele e nunca operar o Hypit para terceiros (pareamento remoto do Core não pode virar acesso
  multi-tenant ao Hypit). Distribuição comercial com Hypit embutido exige autorização escrita: **decisão do usuário**.

## 3. Matriz de compatibilidade

| Requisito | Velix/app hoje | Hypit | Compatível? |
|---|---|---|---|
| Node | Electron 44 (Node do Electron) e Node 24 no desenvolvimento | >= 22.15 | Sim, se rodar como processo externo com Node do usuário ou do Electron (`ELECTRON_RUN_AS_NODE`), **a validar** |
| Gerenciador de pacotes | npm workspaces | pnpm 10.33 (monorepo próprio) | Sem conflito se o Hypit ficar fora do `node_modules` do app (recomendado) |
| FFmpeg | empacotado com o Remotion | precisa de FFmpeg | Provável reuso via PATH/flag; **a validar** |
| Chromium | Remotion usa Chromium próprio; Electron tem o seu | Puppeteer/Chromium headless | Funcional como processos separados; custo de RAM com muitos renders paralelos (exemplo do Hypit cita 64 processos) |
| Python | yt-dlp do usuário | `uv` para WhisperX/OpenCV locais (opcional) | Opcional |
| Windows | suportado (app e instalador) | não documentado pela fonte oficial | **Sim, verificado na PoC** (render local HTML + FFmpeg, `koffi` pré-compilado win32_x64, Chrome Headless Shell win64) — `POC-HYPIT.md` |
| Formato de projeto | `video_compositions` (JSON próprio), produções em `velix_*`, composições Remotion | SVML/`.svrun`, resultados em `.hypit/` | **Não equivalentes** (o próprio pedido já prevê isso) |
| Execução | `TaskEngine` com lease; render worker Remotion | Worker próprio do Hypit | Risco de dois orquestradores: o Aethera deve tratar o Hypit como **motor de render**, não como orquestrador |

## 4. Matriz de riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Licença impede distribuir o Hypit embutido | Alta | Alto | Não embutir; detectar instalação do usuário; atribuição; decisão comercial do usuário |
| R2 | Hypit não roda no Windows | ~~Média~~ **Baixa** | Alto | **PoC passou** (instalação, doctor, check, plan, pricing, build, export, cancel, encerramento); continua sem teste: provedores externos e programas Python |
| R3 | Rebranding quebrar projetos/IDs (911 referências) | Média | Alto | AET-02 só muda texto visível; IDs, tabelas, canais e pastas ficam; teste de abertura de projetos Velix |
| R4 | Dois orquestradores (Hypit Worker + TaskEngine) | Média | Médio | Hypit só como motor de render chamado por uma etapa do `ProductionRunService`; o Worker do Hypit é detalhe interno do motor |
| R5 | Envio de mídia privada a serviços externos (HypiHub, provedores) | Média | Alto | Consentimento explícito por produção; `plan`/`pricing` antes do `build`; Providers desligados por padrão |
| R6 | Custo de API inesperado | Média | Médio | `hypit pricing --json` obrigatório antes de executar; orçamento por produção (`velix_production_budgets` já existe) |
| R7 | Consumo de CPU/RAM com Chromium paralelo | Média | Médio | Fila de render com limite de concorrência (AET-08) e monitoramento real (lote 50.08) |
| R8 | API do Hypit instável (0.x) | Alta | Médio | Adaptador fino sobre a CLI com versão mínima e verificação `hypit version --check`; testes de contrato com saídas gravadas |
| R9 | Licença do Remotion para uso comercial | Média | Médio | Verificar e registrar antes de distribuição comercial |
| R10 | Edição bidirecional SVML ↔ timeline inviável | Alta | Médio | AET-06 promete só o que o Hypit expõe (abrir no Studio do Hypit, reexecutar); sem conversão bidirecional sem prova |
| R11 | Comandos arbitrários vindos de prompts/arquivos SVML | Média | Alto | Argumentos fixos, caminhos validados dentro do projeto, sem shell, `--asset-root` só em pastas autorizadas |

## 5. PoC (autorizada e executada em 2026-11-09 — resultados em `POC-HYPIT.md`)

Em pasta isolada fora do repositório e fora da pasta de dados: instalar `@hypit/hypit` com o Node do usuário; rodar
`hypit doctor`, `hypit check` e `hypit plan` em um exemplo oficial; um `build` local sem modelos externos; medir tempo,
RAM e CPU; confirmar Windows, saída `result.json` e cancelamento. Nenhuma credencial, nenhum envio de mídia privada.
