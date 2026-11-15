# NeuralBridge — Plano de Implementação

## FASE CONCLUÍDA — Aethera Creative Studio (`CS-1` .. `CS-5`, 2026-11-15)

Plano em `docs/plans/aethera-creative-studio.md` implementado full-stack em `packages/creative-studio`, `packages/database` e `apps/aethera-desktop`:
- **CS-1 (CONCLUÍDA):** pacote `@neuralbridge/creative-studio` com schemas Zod versionados (`CreativeProjectDocument` v1), `AssetIngestionService` (armazenamento gerenciado + SHA-256 + paths portáveis), `BrandKitManager`, `SharpSvgCompositionEngine` + interface `ExternalImageAdapter`, `ExportService` (PNG/JPG/WebP/projeto editável/prévia animada + marca d'água idempotente em vídeo) e migração SQLite `0121_aethera_creative_studio.sql` (`AetheraCreativeStudioRepository`).
- **CS-2 (CONCLUÍDA):** `LayeredDocumentEditor` com histórico undo/redo, alinhamento (`safe-center`), máscaras, efeitos não destrutivos, dirty-tracking para auto-save e edição localizada por prompt (`packages/creative-studio/src/layered-editor.ts`).
- **CS-3 (CONCLUÍDA):** `VideoFrameAnalyzer` (extração real via `ffmpeg`/`ffprobe` + score de impacto), `CreativeOrchestrator` (4 motores com fallback RF-07 para 1 agente e fallback local), `QualityGateService` (auditoria bloqueante + scorecard heurístico) e **Thumbnail Lab** (3 variações A/B/C).
- **CS-4 (CONCLUÍDA):** integração full-stack no `apps/aethera-desktop` (`creative-studio-service.ts`, IPC `creative:*`, `preload/index.ts`, `CreativeStudioPanel.tsx` com os 4 criadores e prévias Desktop/Mobile/TV + recorte circular, gancho automático de thumbnail em `cinema:render-real-mp4` e inclusão no Backup Geral em `system-backup.ts`).
- **CS-5 (CONCLUÍDA):** suíte E2E com exemplos reais (`cs5-e2e-real-examples.test.ts`: Cyberpunk 2077 gameplay frames, banner gamer futurista, avatar mascote tecnológico, marca d'água transparente e aplicação idempotente em vídeo, persistência SQLite e reedição de projeto `.aethera-creative.json`), `typecheck` e `build:aethera`.
- **CS-6 (CONCLUÍDA — Inteligência Visual Profissional):** `LocalPythonAiAdapter` (`stabilityai/sdxl-turbo` na RTX 4060 Ti 8 GB com fallback CPU + `rembg` `u2net` para segmentação semântica real) + `ProviderChainImageAdapter`, composição cinematográfica (`directionalLight`, `rimLightColor` por silhueta alfa, `depthBlur`, `dropShadow`, `outerGlow`), edição localizada por prompt (`aumente o personagem`, `troque o fundo`, `deixe o título mais impactante`, `adicione iluminação neon`) e evidências visuais reais em `artifacts/creative-studio-cs6/` (`cs6-real-ai-e2e.test.ts`). Aprovação estética final manual pelo usuário.
- **CS-7 (CONCLUÍDA — Correção Visual, Diferenciação, Creative Director Agent e Identidade Persistente):** segmentação semântica adaptativa (`segment-adaptive` avaliando `birefnet-portrait` vs `isnet-general-use` por métricas reais de máscara, preservando fios de cabelo e bordas), composição sem duplicação (fundo limpo gerado por IA ou desfocado quando não há fundo distinto, nunca clonando o sujeito atrás do próprio recorte), tipografia responsiva (`fitTextToBox` com auto-escala + `TEXT_INTERNAL_OVERFLOW` e `TEXT_SUBJECT_OVERLAP` no `QualityGateService`), Thumbnail Lab com 3 direções realmente distintas (`A — Impacto`, `B — Tecnologia`, `C — Cinematográfica`), `CreativeDirectorAgent` pré-render integrado ao `CreativeOrchestrator` e `CompositionPlanner`, identidade persistente no `BrandKit` (`mascotAssetId`, `assetManifest`, `registerIdentityAsset`) reutilizada entre thumbnail, banner (`2560×1440`), avatar (`800×800`) e marca d'água (`150×150`), prévia em tamanho de celular (`224×126`) no `CreativeStudioPanel.tsx`, e evidências visuais regeneradas em `artifacts/creative-studio-cs7/`. Aprovação estética final e validação interativa da GUI Electron pelo usuário.

## FASE CONCLUÍDA — Aethera Cinema AI (`CINEMA-00` .. `CINEMA-10`, 2026-11-13)

Implementação full-stack do motor cinematográfico determinístico em `packages/cinema` (`@neuralbridge/cinema`) integrado ao `apps/aethera-desktop` (`cinema:*` IPC e `CinemaDirectorPanel` em `/aethera/cinema`):
- **Timeline IR & OTIO (`CINEMA-01`):** `RationalTime`, `CanonicalTimeline`, exportação `Timeline.1`, fingerprinting incremental e sanitização anti-prompt-injection.
- **Direção & Comédia (`CINEMA-02`, `CINEMA-10`):** `CreativeBrief`, `StyleBible`, `NarrativeBeat`, `ShotPlan` (Plano A/B + `mediaGaps`), humor padrão `cinematic_subtle_humor` (`35%`) com bloqueio automático em cenas sensíveis e desativação limpa em `0%`.
- **Edição, VFX, Cor & Som (`CINEMA-03`..`CINEMA-05`):** trim frame-accurate, ripple, J/L cuts, speed ramp, reframe HUD-safe, undo/redo transacional, catálogo VFX com fallback, Rec.709/LUT provenance e stems EBU R128 (`-14`/`-12.5` LUFS).
- **QC Multi-pass, Reparo & Benchmarks (`CINEMA-00`, `CINEMA-07`..`CINEMA-09`):** `IssueLedger`, ensemble independente, reparo incremental (`budget <= 3`), Release Gates e suíte de 12 cenários (`8` dev / `4` holdout). Documentação detalhada em `docs/aethera/cinema/`.

## FASE ATIVA — SEP-2026-01: Separação do Singularity Ecosystem (SEP-01..SEP-09 CONCLUÍDAS em 2026-11-13)

Plano de separação em três aplicativos independentes (**Singularity Orchestrator**, **Aethera Studio** e **Void**), mantendo `apps/desktop` operacional durante toda a migração:
- **SEP-01 (Auditoria e baseline):** CONCLUÍDA em `docs/architecture/SEP-2026-01-BASELINE.md`.
- **SEP-02 (Contratos e limites):** CONCLUÍDA em `packages/integration-contracts/` e `docs/architecture/ADR-SEP-02-CONTRACTS.md` (contratos versionados, compatibilidade `N/N-1`, matriz de propriedade de dados, tokens com escopo/revogação, stubs isolados e preservação do fallback multiagente RF-07).
- **SEP-03 (Singularity Orchestrator):** CONCLUÍDA em `apps/orchestrator-desktop/` (SQLite privado `orchestrator-core.db`, build `electron-vite` e testes isolados).
- **SEP-04 (Aethera Studio):** CONCLUÍDA em `apps/aethera-desktop/` (SQLite privado `aethera-studio.db`, pipeline/calendário/RF-07, build `electron-vite` e testes isolados).
- **SEP-05 (Void):** CONCLUÍDA em `apps/void-desktop/` (SQLite privado `void-assistant.db`, notificações/assistente/RF-07, build `electron-vite` e testes isolados).
- **SEP-06 (Conexões opcionais):** CONCLUÍDA em `packages/integration-contracts/src/pairing-manager.ts` e IPC `integration:*` nos 3 apps (descoberta, pareamento com escopos, reconexão, fallback local e revogação).
- **SEP-07 (Identidades e instaladores):** `electron-builder.yml` distintos e scripts `build:*` / `dist:win:*` configurados no `package.json`; empacotamento NSIS (`dist:win:*`) pendente apenas de execução em ambiente com rede/cache do Electron (`github.com`).
- **SEP-07.5 (Reorganização e limpeza segura):** CONCLUÍDA em `docs/migration/CLEANUP-REPORT.md` (`0` imports cruzados entre os 3 apps; monolito `apps/desktop` preservado).
- **SEP-08 (Migração, rollback, auditoria e E2E):** CONCLUÍDA em `packages/integration-contracts/src/migration.ts`, `tooling/migrations/migrate-ecosystem.mjs`, `docs/migration/MIGRATION-AND-ROLLBACK.md` e `docs/architecture/SEP-08-FUNCTIONAL-PARITY.md`.
- **SEP-09 (Paridade visual e funcional nos 3 apps):** CONCLUÍDA em `apps/{orchestrator,aethera,void}-desktop` reutilizando UI real e handlers IPC reais por domínio (`docs/architecture/SEP-09-FUNCTIONAL-MIGRATION.md`).
- **Próximas etapas operacionais:** empacotamento NSIS local (`dist:win:*`) e validação visual GUI/OAuth com credenciais reais do usuário antes de decidir pela remoção futura de `apps/desktop`.

## FASE ANTERIOR — Fase 51: Void Personal Agent (`VOID-PA-01`) — CONCLUÍDA em 2026-11-10

Assistente pessoal do Void: Gmail, Google Agenda, WhatsApp (sujeito a viabilidade), monitoramento, automações,
orquestração por Claude/Codex, notificações e interface. Plano, auditoria de reuso, lotes 51.01–51.10 e decisões
pendentes (D-PA-1 a D-PA-7) em `docs/plans/phase-51-void-personal-agent.md`. Execução autorizada explicitamente pelo
usuário em 2026-11-10; sem commit ou push automático.

**Progresso:** lotes 51.01–51.10 concluídos no escopo automatizável. Adapters Gmail/Agenda, política OAuth, contas, IPC,
fluxo PKCE, sincronização incremental, runtime persistente, aprovação/retomada de ações, notificações, viabilidade
WhatsApp, interface e estabilização foram integrados e testados. OAuth real do Google permanece pendência operacional
externa, sem credenciais fictícias.

## PLANO ATIVO — Fase 50: Singularity (2026-11-08)

**Status: EXECUTADA NO ESCOPO AUTORIZADO em 2026-11-10.** Briefing de referência: `docs/plans/singularity-master-plan.md`.

**Continuação técnica em 2026-11-10:** o adaptador isolado Paperclip 50.10 (`70d1593`) e MOB-01–03
(`8c6fdbf`, `77a1873`, `17818af`), CORE-09–11 (`ea11aa5`, `20eb89a`, `ee470e4`), M3 (`dd8af53`) e wake word Void
(`0c93d3e`) foram entregues separadamente. **Fechamento da lista no mesmo dia:** M2 (com banco aberto adiando a cópia),
M1 (instalador "Singularity" 0.1.59, upgrade e rollback testados de verdade), CORE-12 e CORE-13 com evidência E2E, o
inventário dinâmico de todos os grupos (que achou e corrigiu a recuperação de boot caindo no Desktop) e **M4 rejeitada**.
Dependem só do ambiente: smoke Android em aparelho (sem SDK nesta máquina) e ativação do Paperclip contra um servidor
real com credenciais. Detalhes em `docs/STATUS.md`.

A partir de 2026-11-08 este é o único plano em vigor para o sistema. Tudo abaixo desta seção (a consolidação
enterprise de 2026-11-05 e as Fases 1–49) fica **substituído** e é mantido apenas como histórico e evidência;
não deve ser usado para decidir a próxima fase. Capacidades já entregues continuam valendo e devem ser
preservadas (dados, projetos, memórias, agentes, integrações, credenciais e histórico).

Escopo do Singularity (resumo do briefing):

- Evoluir o NeuralBridge para **Singularity — AI Orchestrator**: identidade visual (verde-petróleo, vidro preto,
  dourado), design system e redesign das telas.
- **Galáxia de Memórias** no lugar do cérebro 3D: cada estrela é uma memória real, com buraco negro central.
- **Monitoramento e observabilidade** com dados reais (CPU, RAM, GPU/VRAM, disco, rede, agentes, MCP, RAG,
  TaskEngine).
- **Renomeação segura** NeuralBridge → Singularity, marca visível primeiro, migração versionada para o resto.
- **Paperclip**: auditoria e decisão A/B/C/D (integrar, incorporar, fundir, não integrar) antes de qualquer
  código; implementação só com aprovação explícita.
- **Trilha transversal Core + Mobile**: extrair um Singularity Core Node.js independente do Electron e, depois,
  um Companion Mobile em React Native/Expo.

Lotes (numeração final a confirmar na auditoria):

| Lote | Entrega | Depende de |
|---|---|---|
| 50.01 | Auditoria do NeuralBridge e inventário de contratos/dados | — |
| 50.02 | Design system Singularity e identidade | 50.01 |
| 50.03 | Infraestrutura de tema e componentes compartilhados | 50.02 |
| 50.04 | Rebranding visível e plano de migração técnica | 50.01–50.03 |
| 50.05 | Redesign do dashboard, navegação e telas | 50.03 |
| 50.06 | Motor visual da Galáxia de Memórias | 50.01, 50.03 |
| 50.07 | Galáxia ligada à memória real e ao RAG | 50.06 |
| 50.08 | Monitoramento de hardware e observabilidade | 50.01, 50.03 |
| 50.09 | Paperclip: auditoria, decisão A/B/C/D e PoC isolada | 50.01, CORE-01 |
| 50.10 | Paperclip: implementação opcional aprovada | 50.09 + aprovação explícita |
| 50.11 | Performance, animações, acessibilidade e fallback | 50.05–50.10 |
| 50.12 | Migração, E2E, segurança, empacotamento e rollback | todos os lotes |
| CORE-01…08 | Core Node.js: auditoria/ADR, contratos, serviço, extração, TaskEngine/agentes/MCP/RAG, adaptador desktop, auth/dispositivos, observabilidade/empacotamento | ver briefing §11.9 |
| MOB-01…03 | Companion Mobile: MVP, push/aprovações/voz/RAG, testes e distribuição | CORE-07 |

Referência visual oficial (2026-11-08): `docs/assets/singularity/reference-memory-galaxy.webp`. É o alvo de
layout e estética dos lotes 50.02–50.08:

- **Topo:** logo "SINGULARITY / AI ORCHESTRATOR" com anel dourado; abas Orquestrador, Agentes, MCP, RAG,
  Memórias, Projetos; busca, notificações e configurações à direita. A aba ativa tem brilho dourado.
- **Lateral esquerda:** Hub, Orquestrador, Agentes, MCP (Ferramentas), RAG (Conhecimento), Memórias (Galáxia),
  Projetos, Tarefas, Execuções, Monitoramento. Abaixo, "Status do sistema" (agentes, MCP, RAG, total de
  memórias) e barras compactas de CPU, Memória e Disco (RAG) — o painel compacto do lote 50.08.
- **Centro:** Galáxia de Memórias com buraco negro e disco de acreção dourado. Nós de agrupamento em órbita
  (Projetos, Desenvolvimento, Documentação, RAG, Agentes, MCP) com contagens. O card de memória selecionada
  mostra título, tags, resumo, data e ações (abrir, editar, mais).
- **Lateral direita:** total de memórias, rosca "Distribuição por contexto", "Atividade recente" e o botão
  "Adicionar memória".
- **Rodapé:** linha do tempo do dia com eventos (sync, indexação RAG, execuções, MCP) e o marcador "AGORA".
- **Paleta:** fundo verde-petróleo quase preto, painéis de vidro escuro com borda fina, dourado para destaque,
  texto claro quente, tipografia fina com títulos espaçados.

Os números da imagem são ilustrativos. Na implementação, todo número vem de dado real, e amostragem ou
agregação aparece indicada (briefing §3.3 e §4).

Regras da fase:

- **Auditoria 50.01 + CORE-01: CONCLUÍDA em 2026-11-08 (somente leitura)** em
  `docs/plans/phase-50-singularity-audit.md`. Principais achados: o domínio já está fora do Electron, já que nenhum
  pacote importa `electron`; não existe monitoramento de hardware; o grafo 3D tem limite de 5.000 memórias; a pasta
  `%APPDATA%\NeuralBridge` guarda o banco e a chave dos segredos `safeStorage`, então renomeá-la é crítico.
- **Decisões D-1 a D-9: APROVADAS em 2026-11-08**, com ajustes em D-6, D-7 e D-8 (Core pronto para rodar
  independente; `safeStorage` mantido e migração reversível; Tailscale primeiro, com pareamento, revogação e
  notificações). Registro em `docs/plans/phase-50-singularity-audit.md` §5.
- **Lotes 50.02, 50.03 e 50.06: CONCLUÍDOS**, detalhados em `docs/plans/phase-50-singularity-lots.md`; commits existentes e preservados.
- **ADR CORE-01: PROPOSTO**, em `docs/architecture/adr-core-01-singularity-core.md`. Cobre Core embutido e
  independente, dono único da execução (lease em `tasks`), API `/api/v1` com WebSocket, segredos S0–S3,
  Tailscale `serve` só no loopback e a fronteira com o Paperclip (`external_ref`, execução sempre no Core).
- **Lote 50.02 — Design System: CONCLUÍDO em 2026-11-08, visual aprovado pelo usuário.** Tokens, Inter, classes
  `.sg-*` e a página `#/design-system`. Documento em `docs/ux/singularity-design-system.md`; evidência em
  `docs/STATUS.md`. Snapshots E2E visuais atualizados para a nova paleta.
- **Lote 50.03 — Shell e componentes: CONCLUÍDO em 2026-11-08, visual aprovado pelo usuário.** Abas de contexto
  no topo (atalhos para rotas existentes), barra lateral recolhível com "Status do sistema" real (agentes, MCP,
  banco, memórias), painel contextual direito e linha do tempo opcionais por página (slots), componentes de vidro
  em `components/ui/glass.tsx` e barra de título nativa no tom do header. Detalhes em
  `docs/ux/singularity-design-system.md` §Shell; evidência em `docs/STATUS.md`.
- **Lote 50.06 — Galáxia de Memórias: CONCLUÍDO em 2026-11-08, visual aprovado pelo usuário.** Rota `#/memory/galaxy`,
  layout por embeddings em Web Worker, buraco negro com disco de acreção dourado, painel de detalhes, linha do tempo real,
  lista/fallback e reversão para o cérebro 3D em Memória › Configurações. Com 5.000 memórias: primeira interação
  801 ms e 60 FPS na GPU (1619 ms e 37.3 FPS em software). Evidência em `docs/STATUS.md`.
- **Lote 50.08 — Monitoramento de desempenho: CONCLUÍDO em 2026-11-08, aprovado pelo usuário (commit `d228114`).** Coleta real do
  Windows (typeperf, PDH, nvidia-smi, Node, Electron), sem módulo nativo; medidores na lateral e página `#/monitoring`
  com histórico; consumidores futuros previstos no contrato. Evidência em `docs/STATUS.md`.
- **Trilha visual — finalização autorizada em 2026-11-08** (lotes 50.04, 50.05, 50.07, 50.11 e 50.12, um commit por
  lote, com aprovação visual entre eles). Paperclip (50.09/50.10), CORE e MOB ficam para fases próprias.
- **Lote 50.04 — Marca visível: CONCLUÍDO em 2026-11-08, aprovado pelo usuário.** Nome, cabeçalho, título,
  bandeja, Companion, textos e ícone passam a Singularity; o mascote passa a ser o Void (buraco negro com rosto,
  referência `docs/assets/singularity/reference-void-mascot.webp`) e o assistente Neura é exibido como Void; pasta de dados, `appId`, instalador, nome MCP e pacotes ficam
  como estão (D-1). Plano de migração técnica M1–M4 em `docs/plans/phase-50-rebrand-migration.md`.
- **Lote 50.05 — Redesign das telas: CONCLUÍDO em 2026-11-09, aprovado pelo usuário.** Cabeçalho de página no padrão
  Singularity (rótulo do grupo, título fino), 71 cartões em vidro (`.sg-panel`, sem desfoque para não pesar), paleta fixa
  trocada por tokens semânticos, títulos próprios alinhados (Mission Control, Analytics, Git Intelligence, Velix) e
  Dashboard como Hub (painel direito e linha do tempo com dados reais).
- **Lote 50.07 — Galáxia ligada à memória e ao RAG: CONCLUÍDO em 2026-11-09, aprovado pelo usuário.** Recuperações
  reais (chamadas MCP dos agentes e contexto RAG das tarefas) acendem a estrela com um feixe vindo do núcleo, aparecem no
  painel e na linha do tempo; a galáxia recarrega sozinha quando o banco muda; cartão de indexação RAG; resultados da
  busca com a origem (texto ou significado).
- **Lote 50.11 — Desempenho, animações, acessibilidade e alternativas: CONCLUÍDO em 2026-11-09, aprovado pelo
  usuário.** Custo em repouso medido (HUD do Void, Hub e Galáxia com 5.000 estrelas abaixo de 1% de um núcleo),
  varredura de acessibilidade em 22 telas e alternativas conferidas; viram testes permanentes.
- **Lote 50.12 — Migração, E2E, segurança, empacotamento e reversão: CONCLUÍDO em 2026-11-09, aprovado pelo usuário.**
  A validação final registrou 328 E2E passados e 30 pulados por provedores reais; uma falha intermitente do teste do
  Neura passou 3/3 isoladamente. O monitoramento inicia `typeperf`, PowerShell e `nvidia-smi` por caminho absoluto e
  trata o cache do probe como entrada não confiável; instalador 0.1.58 gerado e verificado, com smoke test do app
  empacotado (Void, Galáxia, monitoramento). Notas de migração, segurança e reversão em
  `docs/plans/phase-50-release-and-rollback.md`.
- **Trilha visual da Fase 50 concluída em 2026-11-09, encerramento aprovado pelo usuário.**
- **CORE-02 — Contratos da API do Singularity Core: CONCLUÍDO em 2026-11-09, aprovado pelo usuário.** Só
  documentação, esquemas zod, tipos e testes de contrato (`packages/shared/src/core-api`, subcaminho
  `@neuralbridge/shared/core-api`): API `/api/v1` com 33 rotas, 16 tipos de evento, WebSocket `singularity.v1` e SSE
  somente leitura, escopos, pareamento com chave P-256 e DPoP, revogação, idempotência, executor único por lease,
  memória/busca/indexação, adaptador isolado de orquestrador e acesso privado do mobile. Nenhum servidor, processo,
  migração ou fluxo de autenticação foi criado ou alterado. Arquitetura e decisões em
  `docs/architecture/core-02-api-contracts.md`.
- **CORE-03 — Bootstrap do Singularity Core: CONCLUÍDO em 2026-11-09, aprovado pelo usuário.** Pacote
  `packages/core` (`out/main/core.js`), processo filho supervisionado pelo Electron com `ELECTRON_RUN_AS_NODE=1`,
  `GET /api/v1/health` do contrato CORE-02 só em `127.0.0.1` (porta dinâmica, recusa Host estranho), `core.lock` de
  instância única, ready/heartbeat/encerramento gracioso, reinício com espera crescente e limite (5 em 10 min), logs
  JSON redigidos e chave `NB_CORE_DISABLED=1`. TaskEngine, agentes, memória, RAG e MCP não foram tocados; o desktop
  continua o único executor. Arquitetura, ciclo de vida (fechar a janela × sair × Core independente) e riscos em
  `docs/architecture/core-03-bootstrap.md`.
- **CORE-04 a CORE-08 autorizados em 2026-11-09** ("continue a implementação até o último core"): commit por lote sem
  parar entre eles, sem push; segredos ficam no S0 (sem migrar credenciais); o CORE-08 pode registrar uma tarefa
  agendada temporária no Windows para teste, removida no fim.
- **CORE-04 — Lease, `external_ref` e idempotência: CONCLUÍDO em 2026-11-09.** Migrações aditivas 0093/0094, lease
  por tarefa no `launch()` do TaskEngine (um executor por tarefa, provado com 8 threads), recuperação que respeita
  executor vivo, `externalRef` sem duplicar e `IdempotencyStore`. Detalhes em
  `docs/architecture/core-04-lease-idempotency.md`.
- **CORE-05 — Domínio de tarefas no Core: CONCLUÍDO em 2026-11-09.** Composição única do TaskEngine
  (`task-composition.ts`) usada pelo desktop e pelo Core; host do Core no app (`core-host`) com as rotas públicas de
  tarefas do contrato (idempotência, transições, envelope de erro), SSE com retomada e rotas internas do adaptador;
  token do desktop só pelo canal IPC; migração aditiva 0095 (`tasks.access`).
- **CORE-06 — Desktop como adaptador (grupo de tarefas): CONCLUÍDO em 2026-11-09.** Chat, continuação, correção,
  revisão Git, smart commit e swarm executam no Core; comandos vão a quem segura o lease; leituras locais; eventos do
  Core reemitidos no desktop. Workflows, missões e automações Git foram migrados por CORE-09–11; Void/Neura está
  parcial em CORE-12 e Velix continua no desktop. Reversão: `NB_CORE_TASKS=main`. Detalhes em
  `docs/architecture/core-05-06-task-domain.md`.
- **CORE-07 — Autenticação, pareamento, revogação e acesso remoto: CONCLUÍDO em 2026-11-09.** Pareamento com
  confirmação no desktop, chave P-256 + DPoP, tokens com hash e refresh rotativo com detecção de reuso, escopos e
  concessão por projeto (sem IDOR), rate limit e bloqueio progressivo, auditoria sem segredos, revogação imediata que
  fecha streams, Tailscale `serve` (nunca `funnel`) desligado por padrão, tela "Dispositivos e acesso remoto".
  Segredos ficam no S0 (decisão do usuário). Detalhes em `docs/architecture/core-07-auth-remote.md`.
- **CORE-08 — Core independente no logon, observabilidade e empacotamento: CONCLUÍDO em 2026-11-09.** Lançador
  `--singularity-core` (Node puro, desanexado, sem janela), tarefa de logon do usuário com menor privilégio e repetição
  de 5 min (opt-in em Configurações), passagem do Core embutido para o independente e volta, desktop conectado pelo
  token local, status do processo em Configurações, lançador validado no app empacotado. Detalhes em
  `docs/architecture/core-08-standalone.md`. **Trilha CORE concluída (CORE-01 a CORE-08).**
- **COMP-01 — Companion como módulo à parte: IMPLEMENTADO E VALIDADO em 2026-11-10 (`ea8e40e`).**
  Manifestos built-in `companion`/`spotify` usam o registro existente; o gate do HUD e o gate do Spotify são
  independentes, a instalação nova deixa o Companion desligado e uma instalação existente preserva o estado. Sem
  alteração no Core, TaskEngine, wake word ou credenciais. Plano e rollback em
  `docs/plans/companion-extension.md`.
- **Frente Aethera — Rebranding do Velix e integração com Hypit (AET-01 a AET-09), criada em 2026-11-09.** O Velix
  evolui para "Aethera — AI Cinematic Studio", preservando projetos, dados, credenciais e o Remotion; o Hypit entra
  como motor opcional por adaptador desacoplado. **AET-01 (auditoria e planejamento) CONCLUÍDA e aprovada em
  2026-11-09**, com a PoC do Hypit no Windows concluída. **AET-02 (rebranding seguro) CONCLUÍDA e aprovada
  em 2026-11-09**: só textos visíveis, nenhum identificador ou dado alterado. Documentos em `docs/aethera/`.
- **Paperclip 50.09 — PoC CONCLUÍDA em 2026-11-10, aprovada para avaliação.** Paperclip `0.3.1` foi executado em
  clone descartável, loopback e embedded PostgreSQL isolado. O ciclo real de control plane (health, company, issue,
  consulta e cancelamento) passou; o harness de fronteira Core passou 4/4. A opção A foi confirmada: Paperclip como
  control plane isolado e Singularity Core como único executor. O adaptador de fronteira 50.10 existe e está testado,
  mas a ativação definitiva continua pendente de autenticação e reconciliação com Paperclip real.
- **CORE-12 — Void/Neura parcial:** a ação confirmada `project.edit_task` atravessa o adaptador híbrido com `externalRef` estável; voz, UI Automation, tela, conversa, RAG e Spotify permanecem no Desktop até contratos próprios. Evidência em `docs/architecture/core-12-void-task-adapter.md`.
- **M1, M2, CORE-12, CORE-13 e inventário dinâmico: CONCLUÍDOS em 2026-11-10; M4 rejeitada.** Continua fora, por
  desenho: capacidades estruturadas do Velix (`runStructuredReadOnly`) e voz/tela/UI Automation/Spotify do Void ficam no
  Desktop até existir contrato Core próprio. Dependem do ambiente: smoke Android e ativação do Paperclip 50.10.
- Cada lote precisa de objetivo, escopo, dependências, arquivos prováveis, riscos, critérios de aceite, testes,
  migração e rollback antes de ser implementado.
- Aprovação humana obrigatória antes de iniciar qualquer implementação, antes da PoC Paperclip e antes do lote 50.10.
- A auditoria do código prevalece sobre as hipóteses do briefing.

## Enterprise consolidation (2026-11-05) — SUBSTITUÍDO pelo plano Singularity

**Phase 5.2 — Real-environment homologation: EXECUTADA em 2026-11-08 até o limite do ambiente.** Real CLI
detection, MCP registration, AI Code Review and Smart Commit passed with real providers; a TFS probe defect was
fixed. Remaining items are external blockers (Codex quota, TFS credential/outage, other Windows machines,
signing/updater/registry) recorded in `docs/release/homologation-matrix.md`. The release posture is unchanged:
local validation release, not enterprise-ready.

**Phase 2 — Architecture consolidation: CONCLUÍDA em 2026-11-08** (Tasks 2.1–2.3; details in the consolidation plan and `docs/STATUS.md`).
Validation: typecheck, lint and `git diff --check` clean; Vitest 1799/1799 (`--no-file-parallelism`); E2E
azure-devops, swarm, chat, agents, mcp, navigation, extensions and database 27/27 (3 real-provider tests skipped
without opt-in); `dist:win` + `verify:dist` passed (unsigned); packaged `primary-journey` 13/13.

**Phase 1 — Core execution platform: CONCLUÍDA em 2026-11-08** (Tasks 1.1–1.3; details in the consolidation plan and `docs/STATUS.md`).
Validation: `npm run typecheck` and `npm run lint` passed; `git diff --check` clean;
`engine-execution-contract.test.ts` 10/10; orchestrator + shared + IPC handle/diagnostics suites 757/757
(`--no-file-parallelism`); database 19/19 including migration-failure and classification tests; desktop
recovery, preferences and startup-guard tests passed; full parallel Vitest run 1765/1777 with 12 git/timeout
failures that all pass sequentially (113/113, the known parallel-git limitation); E2E `chat` + `extensions` +
`database` 17/17 (including backup restore, diagnostics export and invalid preferences); `npm run dist:win`
and `npm run verify:dist` passed (unsigned, as before) and the packaged `primary-journey` passed 13/13.
New migration: `0092_execution_snapshot_correlation` (additive column).


The active consolidation plan is `docs/superpowers/plans/2026-11-05-neuralbridge-enterprise-consolidation.md`.
Phase 0 baseline and the initial Phase 1–2 contracts are tracked in
`docs/architecture/enterprise-baseline.md` and the companion specification.

Task 2.4 extension platform core is implemented and validated in the current
worktree; its renderer management surface is delivered in Task 3.1. Phase 4
Tasks 4.2–4.4 are implemented and locally validated; Task 4.1 remains
externally blocked only on signing, updater infrastructure and a valid prior
installer for upgrade homologation.

Task 3.1 is now in progress: navigation uses Trabalho, Conhecimento,
Integrações and Configurações; `/extensions` is a Core-owned management route;
legacy deep links remain registered; Neura/Velix visibility is derived from
the typed extension preload state.
Task 3.2 state language is implemented as a reusable feedback primitive with
semantic announcements, action affordances, progress, reduced-motion support,
and DatabaseBanner integration. Extensions, Execuções and Projetos adopt the
primitive; domain-specific Chat/TaskCard and Velix feedback remains compatible.
Unit, page-flow E2E, degraded-mode E2E, viewport, typecheck, lint, build and
diff-check validation passed. Task 3.3 remains not started.
Task 3.3 is complete: heavy Brain/Graph/Analytics/Velix routes are
lazy-loaded, and the Execuções surface uses a dependency-free virtual list with
overscan. Workflows templates and the installed Velix video collection now use the same virtual list, and the E2E
performance probe enforces startup/route-transition budgets. Build output
confirms separate route chunks; remaining work is the broader list-surface
matrix and measured budgets on representative hardware.
Task 3.4 is complete: the Dashboard first-success guide links project and
agent checks to Chat, and E2E proves a completed read-only first task.
New Neura/Velix capability work remains frozen behind extension contracts until
the core release gates pass.

Task 5.1 is implemented and validated against `dist/win-unpacked/NeuralBridge.exe`:
the primary journey covers approval, execution, validation, evidence, learning,
Core operation without installed extensions, cancellation, restart/resume and
provider failure. Cancellation, restart and failure each pass in three isolated
runs; timeout classification and diagnostics export are also covered. Real-provider homologation, signing and updater validation remain outside
this gate. Existing packaged Chat E2E remains green for loading, error,
approval, success, cancellation and recovery/history states; Task 5.2 is now
in progress.

Task 5.2 is now documented and partially executed on the available Windows
workstation. Local/simulated TFS and extension scenarios passed in three
iterations and the environment inventory is recorded in
`docs/release/homologation-matrix.md`. Real credentials, corporate TFS,
clean-install/uninstall, signed installer and external media services were not
used or claimed as approved. Task 5.3 remains blocked until those scenarios can
run in an approved disposable environment.

Task 5.3 release gate and roadmap reset are documented in
`docs/release/0.1.58-release-decision.md`. The consolidation is closed as a
local validation release decision, not as an enterprise-ready release:
Core/Power tools are stable for the validated scope, integrations and
extensions remain experimental, and distribution/real homologation are
blocked external. No cleanup deletion was authorized.

Artifact cleanup audit is recorded in `docs/architecture/artifact-retention.md`.
All listed artifacts were classified without deletion; tracked evidence,
migrations, fixtures, snapshots, history and user data remain preserved.
The next maintenance slice is limited to safe ignore rules and evidence
documentation. No broad debt refactor is authorized from static scans alone.

The structural debt audit is recorded in `docs/architecture/module-call-graph.md`
and `docs/architecture/ipc-consumer-matrix.md`. No removal was made. The
prioritized follow-up starts with extracting a typed handler group from the
Electron main composition root, then adding generated IPC consumer coverage;
the existing channel contracts and preload compatibility remain frozen.

First extraction validated: the seven extension lifecycle registrations now
live in `apps/desktop/src/main/handlers/extensions.ts`; `main/index.ts` keeps
composition and injects the registry, installer and trusted-sender predicate.
No channel, contract, payload or renderer API changed.

Second safe extraction validated (2026-11-06): the read-only `app:info` and
`app:status` registrations now live in
`apps/desktop/src/main/handlers/diagnostics-release.ts`; the composition root
injects app identity and database health providers. Sender validation, input
and output Zod contracts, payloads, redaction boundary and return values are
unchanged. `scripts/export-diagnostics.mjs` and
`scripts/verify-distribution.mjs` remain CLI-only entrypoints because no
diagnostics, support-bundle or release-verification IPC channels are exposed;
no duplicate IPC API was invented. Contract tests passed 50/50, relevant
packaged E2E passed 16/16, and typecheck, lint, build, `verify:dist` and
`git diff --check` passed. This slice did not advance the Phase 3 scope.

Third extraction validated (2026-11-06): the bounded `theme` configuration
group now lives in `apps/desktop/src/main/handlers/theme.ts`. Its exact
channels are `theme:get` and `theme:set`; the existing shared contracts and
preload facade remain unchanged. The group is intentionally limited to
preference persistence and native theme application, with no database, network,
video, Neura or external-integration dependency. Contract tests were RED before
the module existed and are now green (2/2); the affected E2E checks passed 2/2.
No second extraction was started.

Skills catalog slice implemented (2026-11-06): only `skills:list`,
`skills:settings` and `skills:settings:save` move to
`apps/desktop/src/main/handlers/skills-catalog.ts`. The handler injects the
preferences file/read-write functions, skill roots and scanner; `skills:usage`,
`skills:recommend`, installation and Skill Studio remain in the composition
root. Contract tests were RED before the module existed and now cover trusted
senders, invalid payloads, empty/valid catalogs, absent/corrupt preferences,
safe persistence, redacted sensitive input and redacted frontmatter metadata. Renderer and preload remain
unchanged; the second slice was outside that checkpoint.

Skills intelligence slice implemented (2026-11-06): `skills:usage` and
`skills:recommend` now register through
`apps/desktop/src/main/handlers/skills-intelligence.ts`. TDD RED was observed
before the module existed; the focused IPC contract now covers empty and
persisted usage, no-project/project recommendation, incompatible skills,
prompt-injection content, database failure, fallback, invalid payload and
untrusted sender. The handler injects the database handle, usage analytics,
recommendation engine/catalog, preferences and a read-only project-intelligence
callback; Brain/RAG, Git and project-profile construction remain in the
composition root. The returned recommendation shape is unchanged and excludes
raw skill content, evidence, paths and internal fields. Optional project
intelligence failures fall back to local deterministic recommendation without
installing, enabling or executing a skill.

Validation: focused IPC/catalog 18/18; Skills Discovery/Recommendation/
Intelligence/usage plus IPC 32/32; Skills E2E 2/2; typecheck, lint and Electron
build passed. The post-slice serial Vitest command discovered 224 files and
1,743 tests (one new file and nine tests); two complete runs reached 222/224
files and 1,741/1,743 tests, with different unrelated temporal/resource
failures. Projects passed 29/29 and database migration tests 12/12 in isolated
runs. The existing worker/SQLite contention remains an external blocker; no
timeout, global parallelism or test was changed. Fatia 3 was not started.

Velix research-stage test diagnosis (2026-11-06): the failure at
`packages/orchestrator/test/velix-research-stage.test.ts:116` was caused by a
test assumption that `claims.list(second.id)[0]` was always the factual claim.
The two claims can share the database `created_at` timestamp, so their order
is not guaranteed. Instrumented failures showed the stage completed,
`researchCalls` was `1`, and the opinion was first; the gate correctly stayed
blocked because the factual claim still had candidate evidence. The minimal
test-only fix locates the factual claim by its text/type and removes the order
assumption. No production, Skills, `main/index.ts`, retry or sleep change was
made. Post-fix evidence: isolated target 5/5, complete file 5/5 and
`--no-file-parallelism` 3/3. The global run reached 222/223 files and
1,733/1,734 tests; the Velix file passed and the unrelated
`apps/desktop/test/projects.test.ts` timeout was audited in the follow-up below.

Projects timeout follow-up (2026-11-06): the reported
`apps/desktop/test/projects.test.ts:91` timeout did not reproduce after the
Velix correction. The target passed in isolation 5/5, the complete file passed
5/5 (29/29 each), and the file passed with `--no-file-parallelism` (29/29).
The global serial command `npx vitest run --no-file-parallelism` passed 223/223
files and 1,734/1,734 tests. The default-parallel global command reached
217/223 files and 1,727/1,734 tests, with seven failures across six unrelated
Git/SQLite/orchestration-heavy files; the Projects timeout in that run was at
line 30 and took 5.559 s, not at line 91. No pending Git process or direct
`index.lock`, `HEAD.lock`, `config.lock` or `packed-refs.lock` was found in the
12,606 temporary test directories inspected. The queue/worktree tests passed
in the complete Projects file, so there is no evidence of a production queue
deadlock, shared fixture, cleanup leak or Git common-directory collision.
The cause is classified as external worker/process contention under the
default global Vitest parallelism, allowing real Git/SQLite work to exceed the
default 5 s test timeout. No production code, test timeout, parallelism
setting or test assertion was changed; no Phase 3 work was started. The Skills
Fatia 2 extraction is recorded above.

Extensions IPC output hardening (2026-11-06): the seven lifecycle channels now
reuse strict schemas from `packages/shared/src/extensions.ts`. Installed
states accept only the versioned manifest, enabled/disabled state, non-empty
timestamps and an optional `previousManifest` for rollback; uninstall accepts
only `{ removed: true }`. Unknown fields, unsafe entrypoint paths, malformed
state and secret-bearing response fields are rejected with a generic redacted
error. No channel, input payload or renderer API changed, and no further
`main/index.ts` extraction was started.
The focused regression is green; the global Vitest run reached 220/221 files
and 1,722/1,723 tests with one concurrent Git queue assertion in the existing
Projects suite, while a serial rerun of that test passed 1/1. The cause was
confirmed as nondeterministic queue admission: concurrent writes resolved
`git-common-dir` before entering the repository queue, so the later `stage`
could win over the earlier `commit`. `protectedWrite` now reserves per-root
arrival order before its first await while preserving the shared `commonDir`
queue for worktrees. After the fix, the Projects file passed 5/5 in both
default and `--no-file-parallelism` modes, the global suite passed 221/221
files and 1,723/1,723 tests, and the relevant Git E2E passed 16/16.

Task 2.4 lifecycle hardening (2026-11-06): TDD reproduced and fixed three
compatibility gaps in the already implemented extension platform: SQLite
reload now hydrates `previousManifest`, local directory ingestion normalizes
nested paths before Windows validation, and rollback verifies the staged prior
version and reactivates it before swapping registry state. No migration,
renderer/preload contract, user-data directory or historical file was removed.
The Extensions E2E remains green (3/3); the Neura compatibility probe passed
1/1. A legacy Velix probe timed out before navigation because the pre-existing
Task 3.1 route guard hides Velix without a persisted extension record; that
renderer follow-up was not changed while keeping this Task 2.4 slice bounded.

> **Para agentes executores:** use superpowers:subagent-driven-development ou superpowers:executing-plans, fase por fase. Os passos usam checkbox (`- [ ]`). Antes de executar uma fase marcada com **[sub-plano]**, gere o plano detalhado em TDD só daquela fase (writing-plans), com base nas decisões fixadas aqui.

**Objetivo:** app desktop Windows (Electron) que orquestra Claude Code e Codex CLI, com memória persistente compartilhada (Neural Brain) exposta por um servidor MCP stdio independente.

**Arquitetura:** monorepo npm workspaces. O processo principal do Electron é o único que executa CLIs; o renderer só fala por IPC validado com Zod. O Neural Brain é uma biblioteca (`packages/brain`) usada por dois hosts: o processo principal do Electron e o processo do servidor MCP — ambos sobre o mesmo arquivo SQLite (WAL). O servidor MCP empacotado roda no runtime do Electron (`ELECTRON_RUN_AS_NODE=1`), então o usuário final não precisa de Node; os testes rodam no Node do sistema (better-sqlite3 13 é N-API — comprovado no spike S1).

**Stack:** Electron 44.9.3 · electron-vite 6 · Vite 8 · React 19 · TypeScript 6.0.x · Tailwind 4 · shadcn/ui · Lucide · Zustand 5 · TanStack Query 5 · better-sqlite3 13 · Drizzle ORM 0.45 + drizzle-kit · Zod 4 · @modelcontextprotocol/sdk 1.32 · @huggingface/transformers 4 (embeddings ONNX locais) · Cytoscape.js 3 · Vitest 5 · Playwright 1.64 (`_electron`) · electron-builder 26 (NSIS).

**Spec:** [docs/SPEC.MD](SPEC.MD)

## Fase 49 — Integração TFS/Azure DevOps

**Status: EM EXECUÇÃO (2026-11-04).** Plano detalhado: `docs/superpowers/plans/2026-11-04-tfs-azure-devops-integration.md`. Especificação: `docs/superpowers/specs/2026-11-04-tfs-azure-devops-integration-design.md`.

**Objetivo:** oferecer uma integração compartilhada por Claude e Codex para o trabalho diário no TFS corporativo: consultar projetos, tasks, boards e sprints; preparar User Stories/tasks; revisar Pull Requests; e executar escritas somente após aprovação humana. A área visual deve ser limpa, usando API REST como fonte principal e sessão do navegador como fallback de autenticação/compatibilidade.

- [ ] 49.1 — Spike read-only de descoberta de API, versão e autenticação HTTP Basic/PAT; contratos tipados e capacidades registradas. **Avanço:** host corporativo confirmado em sessão autenticada, com acesso read-only à lista de PRs e Boards/Sprint. Documentação Microsoft confirmou que OAuth/OIDC é para Azure DevOps Services; no Azure DevOps Server/TFS, PAT ou Windows Authentication são compatíveis. A homologação direta de todos os endpoints REST ainda permanece pendente.
- [ ] 49.2 — Cliente REST tolerante, paginado, cancelável e com redaction; PRs, diffs, comentários, tasks, boards e sprint. **Avanço:** cliente read-only cobre projetos, PRs, detalhe/threads, arquivos alterados, work items, boards e iterações, com cache persistido, `AbortSignal` e continuação por `x-ms-continuationtoken`; paginação foi coberta por teste unitário. Permanecem fora deste item as escritas.
- [x] 49.3 — Fallback de sessão do navegador com origem confinada, sem coleta ou persistência de senha; abertura do host corporativo e conclusão do login ficam no navegador externo.
- [x] 49.4 — Persistência aditiva, cache stale-while-revalidate, sincronização retomável e credenciais cifradas. Conexões/cache persistem em 0082–0085; PAT opcional é persistido por conexão fora do banco em arquivo cifrado por `safeStorage`, com save/clear/status via IPC sem retorno do token ao renderer. Teste de store e typecheck aprovados.
- [x] 49.5 — IPC/preload seguro e área Azure DevOps somente leitura com visão geral, PRs, Boards/Sprint, tasks, arquivos alterados e Configuração; a rota dedicada `/azure-devops` agora usa um workspace operacional com status, projetos automáticos, navegação por contexto e revisão de PR no próprio painel. E2E fake 2/2 aprovado; escritas continuam fora do workspace read-only e exigem o gate de Configurações.
- [x] 49.5a — Contexto TFS read-only compartilhado com Claude e Codex pelo MCP `azure_devops_cached`; somente dados previamente carregados pelo usuário entram no contexto, com redaction/aviso de conteúdo não confiável e sem ações de escrita.
- [x] 49.5b — MCP `azure_devops_draft_user_story` e `azure_devops_draft_task` prepara rascunhos revisáveis com critérios de aceite, sem criar work items e com rejeição de credenciais.
- [x] 49.5c — MCP `azure_devops_review_pr` monta o pacote read-only de revisão (detalhe, threads e changes) para Claude/Codex, sem comentário/aprovação/edição.
- [x] 49.5d — MCP `azure_devops_connections` permite descobrir conexões TFS por metadados não sensíveis antes de consultar o cache ou revisar uma PR.
- [ ] 49.6 — Escritas confirmadas pelo usuário: comentário, status de PR, criação de User Story/task e atualização de task agora estão disponíveis no card de escrita; a operação é preparada primeiro e só executada após confirmação nativa no botão **Subir/Publicar**, nunca automaticamente. Implementação, gate nativo, cliente de escrita e PAT cifrado estão prontos; falta homologar uma escrita real com credencial do usuário. A conexão continua read-only até o usuário habilitar escrita.
- [ ] 49.7 — Fake server e E2E ponta a ponta aprovados, com auditoria de segredos e gates locais; além do cenário read-only, o fluxo local de escrita de comentário passou 1/1 (preparo sem POST → confirmação nativa → POST tipado). A homologação direta no TFS corporativo permanece pendente.

**Nota de execução:** a continuação atual é da Fase 47/48 (derivados Velix) após o limite semanal do Claude. A jornada visual de derivados foi validada no Electron com Remotion/FFmpeg reais (geração, aprovação, criação filha, render, reabertura e exportação persistida). A fundação read-only da Fase 49 já está implementada e validada contra fake server; a sessão corporativa foi confirmada visualmente sem escrita, enquanto a homologação direta de uma escrita REST permanece externa.

### Checkpoint de interface e assistente — 2026-11-02

- [x] Consentimentos de áudio, visualização de tela e localização tratados como checkboxes independentes, com fila de atualização baseada no snapshot desejado para permitir os três marcados ao mesmo tempo.
- [x] Scroll revisado: shell sem scroll global duplicado; Chat com scroll no conteúdo interno; Git Intelligence com scroll isolado em Referências, grafo e Detalhes do commit, abas longas com viewport próprio e margem no item selecionado.
- [x] Conversas internas da Neura separadas das conversas do usuário por `tasks.origin`, com migração aditiva `0056_task_origin` e filtro preservando o acesso direto aos detalhes.
- [x] Validação E2E, Vitest global, lint, typecheck, build e diff-check aprovados; distribuição `0.1.51` gerada em `dist/NeuralBridge-Setup-0.1.51-x64.exe`.
- [x] Correção final das abas longas do Git Intelligence mantém `Revisão IA`, `Commit e PR` e `Operações` em viewport interno; distribuição incrementada `0.1.52` gerada em `dist/NeuralBridge-Setup-0.1.52-x64.exe`.

---

## 0. Ambiente inspecionado (2026-10-28)

| Item | Encontrado | Implicação |
|---|---|---|
| SO / HW | Windows 11 Pro, Ryzen 7 9700X, 31 GB RAM, RTX 4060 Ti 8 GB, 164 GB livres em C: | Embeddings em CPU são suficientes; GPU (DirectML) fica opcional. |
| Node / npm | Node 24.17.0, npm 11.13.0. Sem pnpm/yarn/bun | **npm workspaces** (sem ferramenta nova). |
| Compilador nativo | Visual Studio Build Tools 2026, Python 3.14 | `electron-rebuild` do better-sqlite3 deve funcionar; validar no spike (Python 3.14 + node-gyp é ponto de atenção). |
| Claude Code | 2.1.312, `~/.local/bin/claude`, logado via claude.ai (assinatura) | Headless: `claude -p --output-format stream-json --verbose`, `--permission-mode`, `--allowedTools/--disallowedTools`, `--mcp-config --strict-mcp-config`, `--json-schema`, `--session-id`/`--resume`, `--max-budget-usd`, `--add-dir`, `--bare`. |
| Codex CLI | 0.162.1 (npm global), logado via ChatGPT | Headless: `codex exec --json`, `-s/--sandbox`, `-C`, `-m`, `--output-schema`, `-o`, `--ephemeral`, `--skip-git-repo-check`, `codex exec resume`. |
| MCP já configurado | Claude: context7, playwright, Claude Docs (claude.ai). Codex: `node_repl` em `~/.codex/config.toml` | Registro do NeuralBridge via `claude mcp add -s user …` e `codex mcp add …` — nunca editar os arquivos à mão sem backup. |
| Skills | Claude: `~/.claude/skills` (superpowers, frontend-design, ui-ux-pro-max, impeccable, playwright/remotion/vercel best practices, web-design-guidelines, caveman, claude-codex-orchestrator…) + plugins em `~/.claude/plugins`. Codex: `~/.codex/skills`, `~/.agents/skills` | Skills Manager precisa varrer os três locais. |
| Git | Repo sem commits; branch renomeada de `master` para `main`. `gh` não instalado. | Sem PRs via `gh`. |
| Arquivo da spec | `docs/SPEC.MD` (maiúsculas) | Git diferencia caixa; manter o nome ou renomear de forma explícita. |

**Versões:** Electron 45.0/45.1 e @huggingface/transformers 4.3.2 saíram em 27/10/2026 (ontem). Fixar a **última versão com pelo menos 2 semanas** no momento da instalação (Electron 44.9.x; transformers 4.3.x anterior). TypeScript 7 (port em Go) ainda não é seguro com o tooling → fixar **6.0.x**. Drizzle 1.0 está em RC → ficar no 0.45.x.
**Exceção por segurança (Fase 0):** Electron ≤ 44.9.0 tem alerta alto (GHSA-jr5w-w6x2-84p9, certificados eMudhra) → usar **44.9.3**; zod < 4.6.6 tem alerta alto → usar **4.6.7**. Correção de segurança vence a regra das 2 semanas. Fixados: better-sqlite3 13.0.3, @huggingface/transformers 4.3.1, @modelcontextprotocol/sdk 1.32.1.

---

## 1. Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | **ABI de módulo nativo**: better-sqlite3 usa a API do V8 e precisa ser compilado para o Electron; o mesmo binário não carrega no Node 24 do sistema (testes, servidor MCP). | Testes ou MCP quebram em runtime. | **Resolvido no S1:** better-sqlite3 13 é N-API com prebuild win32-x64; o mesmo binário carrega no Node 24, no Electron-as-node e no main do Electron, sem rebuild. Resta validar o empacotamento (`asarUnpack`) na Fase 17. |
| R2 | **Formato de saída dos CLIs muda entre versões** (eventos stream-json do Claude, JSONL do Codex). | Parser quebra silenciosamente após update do CLI. | Parser tolerante (Zod com `passthrough`, eventos desconhecidos viram `raw`), fixtures gravadas das versões instaladas, verificação de versão mínima e alerta na UI. |
| R3 | **Aprovação no meio da execução**: em modo headless não há prompt interativo. | Estado "Aguardando aprovação" sem mecanismo real. | Aprovação **antes** da execução (plano + escopo de arquivos + modo de permissão). Durante a execução: Claude com `--permission-mode` restrito + `--allowedTools`; Codex com `--sandbox workspace-write`. Ação fora do escopo = falha reportada, não prompt. **S2/S4:** Claude `plan` bloqueia até ferramentas MCP de escrita; `default` + `--allowedTools` executa só o liberado. Codex `exec` recusa ferramentas MCP sem `mcp_servers.<nome>.default_tools_approval_mode="approve"` (valores: auto, prompt, writes, approve) + `enabled_tools`. |
| R4 | **Escrita concorrente no SQLite**: Electron + N processos MCP (um por sessão de cliente) no mesmo arquivo. | `SQLITE_BUSY`, corrupção de FTS/links. | WAL, `busy_timeout=5000`, transações curtas, toda escrita de memória em uma transação (memória + FTS + links + versão). Teste com 3 processos escrevendo em paralelo. |
| R5 | **Modelo de embeddings**: download (~120 MB) do Hugging Face, RAM por processo, tempo de carga. Cada processo MCP carregando o modelo multiplica RAM. | Lentidão, falha offline. | Modelo carregado sob demanda e descarregado após inatividade; escrita grava `embedding_status='pending'` e o vetor é calculado de forma assíncrona; busca cai para FTS-only se o modelo não estiver disponível (exigência da spec). Download só com consentimento (A6). **S3:** 130 MB em disco, carga 0,5 s com cache, ~1–2 ms por consulta, **~310 MB de RAM por processo** com o modelo carregado. |
| R6 | **Custo/tokens em assinatura**: Claude (claude.ai) e Codex (ChatGPT) não cobram por token. `total_cost_usd` do Claude é preço equivalente de API. | Métricas de custo enganosas. | Exibir tokens reportados pelo provedor; custo como "Indisponível (assinatura)" por padrão, ou "equivalente API (estimado)" se o usuário ativar. Toda estimativa rotulada como tal. |
| R7 | **Consumo da cota do usuário em testes reais** de CLI. | Testes caros/lentos, limite de uso. | Testes reais atrás de `NB_REAL_CLI=1`, prompts mínimos em repositório temporário; CI padrão usa fixtures gravadas (não é mock da versão final — é teste de parser). |
| R8 | **Edição concorrente dos mesmos arquivos** por Claude e Codex: não dá para saber de antemão quais arquivos um CLI vai tocar. | Conflitos e corrupção de trabalho. | Mutex de escrita por projeto (um agente escrevendo por vez); agentes de revisão rodam em modo somente leitura (`--permission-mode plan` / `--sandbox read-only`). Diff via `git` antes/depois de cada etapa. |
| R9 | **Injeção de prompt via memória**: memória recuperada é texto de terceiros entrando no contexto do agente. | Agente executa instrução plantada. | Memórias vão no handoff dentro de bloco delimitado e rotulado como dados não confiáveis; campo `trust` (unverified/reviewed); memórias `unverified` nunca entram em contexto de tarefas destrutivas sem confirmação. |
| R10 | **Escopo**: a spec descreve dois produtos (orquestrador + Neural Brain) com ~15 subsistemas. | Nada fica realmente pronto. | Ordem da seção 11 (cérebro primeiro); cada fase entrega algo executável e testado; corte explícito de "não-objetivos v1" (seção 4). |
| R11 | **Instalador sem assinatura de código** → aviso do SmartScreen. | Fricção na instalação. | Documentar; assinatura fica fora do v1 (sem certificado). |
| R12 | **Registro MCP no app empacotado**: o comando precisa apontar para o exe instalado com `ELECTRON_RUN_AS_NODE=1` e um script fora do asar. | MCP não sobe após instalar ou após update (caminho muda). | Script MCP em `app.asar.unpacked`/`resources`; tela MCP gera o comando a partir do caminho real; botão "reparar registro" após update. Teste E2E do instalador. |
| R13 | **Saída Windows dos CLIs**: `codex` é shim npm (`.cmd`); `spawn` sem shell não executa `.cmd`. | Detecção falha ou exige `shell:true` (proibido com dados não confiáveis). | **Resolvido no S2:** Claude = `~/.local/bin/claude.exe` nativo; Codex = `node <npm>/node_modules/@openai/codex/bin/codex.js` com `shell:false` (o launcher oficial monta o ambiente do `codex.exe`). `stdin: 'ignore'` (senão o Codex espera entrada). Caminho com espaço e acento funcionou. |
| R14 | **Sandbox elevado do Codex** (`[windows] sandbox = "elevated"` no config do usuário, compartilhado com o app Codex desktop) falha quando iniciado por outro processo: `helper_unknown_error`. | Codex não consegue escrever arquivos via NeuralBridge. | Detectar o valor no config; passar `-c windows.sandbox="unelevated"` **por invocação** (comprovado no S2), sem alterar o config. Mostrar ao usuário que o isolamento é menor que o `elevated`; reavaliar se `elevated` funcionar após o setup oficial do Codex. |
| R15 | **Piso de tokens do Claude**: toda sessão `-p` carrega hooks, skills, plugins e CLAUDE.md globais (~45k tokens de cache num "ok"). `--bare` exige API key e não funciona com login claude.ai. | O TokenOptimizer não controla a maior parte do consumo; economia "estimada" pode enganar. | Medir o piso por execução (`usage` do evento `result`) e mostrar separado do contexto que o NeuralBridge injeta. Na Fase 14, investigar flags documentadas na versão instalada para reduzir o carregamento, sem desligar configurações do usuário sem pedir. |

---

## 2. Ambiguidades da spec e decisão proposta

Marcadas **[confirmado]** as decididas pelo usuário (ver seção 10); as demais são decisões minhas, revisáveis.

| # | Ambiguidade | Proposta |
|---|---|---|
| A1 **[confirmado]** | Dois conjuntos de ferramentas MCP: `memory_*` (seção 8) e `brain_*` (Neural Brain). Mesma função, nomes diferentes. | Canônico: `brain_store`, `brain_recall`, `brain_search`, `brain_list`, `brain_delete`, `brain_links`, `brain_context` + `orchestrator_status`, `task_status`. Sem aliases `memory_*` (duplicam a lista de ferramentas = mais tokens em todo cliente). |
| A2 | `memory_link` existe, mas `brain_links` só consulta. Como links são criados? | Links vêm de `[[Título]]` no conteúdo (parse a cada store) **e** de `links: [{target, relation}]` opcional em `brain_store`. Nós pendentes = alvo não resolvido, resolvidos automaticamente quando a memória com aquele título surgir. |
| A3 **[confirmado]** | Isolamento por projeto no MCP: como o servidor sabe qual projeto o cliente está usando? O que é "projeto privado"? | Servidor stdio recebe `--project <id>` ou deduz pelo `cwd` (match com projetos cadastrados). Escopos: `project` (padrão) e `global`. Projeto marcado `private` só é visível para chamadas com aquele projeto. Sem projeto identificado → apenas `global`. |
| A4 | "Proteger o MCP contra acesso remoto." | Transporte só stdio no v1 (sem porta de rede). Se HTTP for adicionado depois: bind `127.0.0.1` + token. |
| A5 **[confirmado]** | Arquitetura de processos do cérebro: cada processo MCP acessa o SQLite direto, ou um daemon único possui banco e modelo e os MCP são proxies finos? | Recomendo **acesso direto + WAL** (mais simples, funciona sem daemon, atende "independente da janela"). Daemon só se R4/R5 se mostrarem problema na prática. |
| A6 **[confirmado: download no 1º uso]** | Modelo de embeddings multilíngue em CPU. | `Xenova/multilingual-e5-small` quantizado (384 dim, ~120 MB, PT/EN bons). Alternativa mais forte e pesada: `bge-m3` (~570 MB). Distribuição: download no primeiro uso com consentimento (instalador menor) **ou** empacotado. |
| A7 | Armazenamento de vetores: sqlite-vec (0.1.9, pré-1.0) ou BLOB. | BLOB `Float32` em tabela `embeddings` + similaridade em JS (força bruta é < 50 ms até ~50k memórias). Interface `VectorIndex` permite trocar por sqlite-vec depois. |
| A8 | Grafo: React Flow ou Cytoscape. | **Cytoscape.js**: layouts de força, caminho mais curto (dijkstra/A*) nativo, desempenho com milhares de nós. React Flow é melhor para diagramas editáveis, que não é o caso. |
| A9 | Aprendizado automático sem gastar tokens extras. | Pedir ao agente, na mesma execução, um bloco estruturado de aprendizados via `--json-schema` (Claude) / `--output-schema` (Codex). Extração → classificação → dedupe (FTS + cosseno > 0,9) → filtro de segredos → fila de aprovação conforme o modo (manual / com confirmação / categorias autorizadas). |
| A10 | "Aguardando aprovação" e tarefas destrutivas. | Ver R3. Destrutivo = plano que cita delete/drop/force/reset/migração, ou fora do escopo de arquivos declarado → exige confirmação na UI antes de executar. |
| A11 | Skills: "instalar de repositórios confiáveis" — quais? | Allowlist configurável (inicial: repositórios de origem das skills já instaladas). Instalação = clone para pasta temporária, exibir SKILL.md + lista de scripts, aprovação explícita, cópia. Nada é executado. Ativar/desativar só onde o cliente suporta (ex.: plugins Claude). |
| A12 | "Continuar execução antiga a partir do contexto salvo". | Guardar `session_id` de cada agente; continuar via `claude -p --resume <id>` / `codex exec resume <id>`; se a sessão expirou, novo handoff a partir do resumo salvo. |
| A13 | Roteador "considera histórico de sucesso" e "custo". | v1: regras determinísticas em JSON configurável (tipo de tarefa por palavras-chave PT/EN + tamanho do contexto + disponibilidade). Taxa de sucesso por (agente, tipo) entra como desempate quando houver ≥ 5 amostras. |
| A14 | "Inspirado no AI Brain sem copiar". | Paridade conceitual com as 5 operações públicas (store/recall/search/list/delete); consultar a documentação pública só para nomes/semântica, sem reutilizar código. |
| A15 | Estrutura de testes `tests/unit` e `tests/integration` na raiz. | Unitários e integração ficam ao lado de cada pacote (`packages/*/test`), E2E em `tests/e2e`. Justificativa: cada pacote testável isoladamente e executor de tarefa vê só seus arquivos. |

---

## 3. Restrições globais (valem para toda fase)

- Windows 10/11 x64 é o único alvo do v1.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` no renderer, CSP restritiva, bloqueio de `will-navigate`/`window.open` externos (abrir no navegador do sistema só para URLs http(s) aprovadas).
- Renderer nunca envia comando ou argumento de processo; envia **intenções** (`task.start {prompt, projectId, mode}`) validadas por Zod no main.
- `child_process.spawn` sempre com `shell: false`, argumentos em array, `cwd` validado como diretório de projeto cadastrado.
- Nenhum mock na versão final; dados de dashboard só vêm do banco; sem dado → "Indisponível".
- Logs passam por um redator (tokens, chaves, `Authorization`, padrões de segredo) antes de gravar.
- Dados do usuário em `%APPDATA%\NeuralBridge` (`db/`, `models/`, `backups/`, `logs/`), resolvidos por função compartilhada `resolveDataDir()` usada por Electron e pelo MCP (o MCP não tem `app.getPath`). Override por `NB_DATA_DIR` (testes).
- Configurações externas (`~/.claude.json`, `~/.codex/config.toml`) só via CLIs oficiais (`claude mcp add`, `codex mcp add`); se tiver que editar, backup antes.
- Limites padrão: iterações colaborativas = 3, timeout por etapa = 15 min, memórias por contexto = 8, tokens de contexto de memória = 2.000. Todos configuráveis.
- Commits pequenos por tarefa; testes da fase passando antes do commit final da fase.

## 4. Não-objetivos do v1

macOS/Linux; sincronização em nuvem; servidor MCP HTTP; classificador de roteamento por IA (só a interface preparada); assinatura de código; auto-update; multiusuário.

## 5. Review Focus (falhas prováveis que nenhuma fase cobre por padrão)

1. **CLI ausente, desatualizado ou deslogado** no meio do uso → adaptador marca `unavailable`, UI mostra motivo e como corrigir, tarefa não fica presa em "Executando". (Teste na Fase 7.)
2. **Projeto com caminho com espaços/acentos/unicode** (`C:\Users\Joao\Meus Projetos\ação`) → spawn, validação de caminho e `cwd` funcionam. (Teste na Fase 7 e 10.)
3. **Banco bloqueado/corrompido ou disco cheio** → app abre em modo degradado com aviso, nunca tela branca; backup restaurável. (Teste na Fase 2 e 13.)
4. **Saída enorme ou binária do CLI** (MB de log) → UI não trava (virtualização + limite de buffer), log completo vai para arquivo. (Teste na Fase 7.)
5. **Cancelamento** durante execução → árvore de processos inteira morre no Windows (`taskkill /T /F` no PID), estado final `Cancelado`, mutex do projeto liberado. (Teste na Fase 7 e 11.)

---

## 6. Estrutura de pastas

```
neuralbridge/
  package.json                # npm workspaces, scripts raiz
  apps/desktop/               # electron-vite
    electron.vite.config.ts   # entradas main: index.ts + mcp-server.ts
    src/main/                 # janela, IPC handlers, serviços (únicos com acesso a processo/FS)
    src/preload/index.ts      # contextBridge mínimo e tipado
    src/renderer/             # React: app/, components/ui (shadcn), features/<feature>/, stores/
    electron-builder.yml
  packages/
    shared/      # schemas Zod, tipos, contratos IPC, resolveDataDir, redactor
    database/    # schema Drizzle, migrações, openDatabase() com pragmas
    brain/       # MemoryService, links, FTS, embeddings, hybrid search, ContextBuilder, LearningExtractor, backup
    mcp-server/  # createMcpServer(brain, scope) + entrada stdio
    agents/      # ProcessRunner, ClaudeCliAdapter, CodexCliAdapter, parsers
    orchestrator/# Router, TaskEngine, TokenOptimizer, ProjectLock
    workspace/   # detecção de projetos/stack/git, Skills Manager, registro MCP nos clientes
  tests/e2e/     # Playwright _electron
  scripts/       # record-cli-fixtures.mjs (grava e redige saídas reais dos CLIs)
  docs/
```

## 7. Contratos centrais (fixados aqui, usados por várias fases)

```ts
// packages/shared
type MemoryType = 'decision'|'code_pattern'|'project_context'|'bug_fix'|'learning'|'preference'|'documentation'|'execution_summary';
type Trust = 'unverified'|'reviewed'|'rejected';
interface Memory { id: string /* ULID */; title: string; content: string /* markdown */; type: MemoryType;
  projectId: string|null /* null = global */; tags: string[]; source: { kind: 'user'|'claude'|'codex'|'mcp'|'extractor'; ref?: string };
  trust: Trust; version: number; createdAt: string; updatedAt: string; }
type TaskStatus = 'pending'|'planning'|'running'|'awaiting_approval'|'validating'|'completed'|'failed'|'cancelled';
type AgentId = 'claude'|'codex';
type RunMode = 'auto'|'claude'|'codex'|'collab';

// packages/brain
interface BrainService {
  store(input: StoreInput, scope: Scope): Memory;            // cria ou atualiza (por id ou título+projeto)
  recall(idOrTitle: string, scope: Scope): MemoryWithLinks|null;
  search(q: SearchQuery, scope: Scope): Promise<SearchHit[]>; // híbrido; mode: 'fts'|'semantic'|'hybrid'
  list(f: ListFilter, scope: Scope): Page<MemorySummary>;
  delete(id: string, scope: Scope, opts?: { hard?: boolean }): void;
  links(id: string, scope: Scope): { outgoing: Link[]; backlinks: Link[]; pending: string[] };
  context(req: ContextRequest, scope: Scope): Promise<ContextPack>; // respeita budget, retorna refs usadas
}
interface Scope { projectId: string|null; includeGlobal: boolean }

// packages/agents
interface AgentAdapter {
  id: AgentId;
  detect(): Promise<AgentStatus>;  // installed, path, version, authenticated, features[]
  run(req: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>; // eventos normalizados
}
type AgentEvent = { kind: 'text'|'tool'|'file_change'|'usage'|'error'|'raw'|'done'; at: string; data: unknown };

// packages/orchestrator
interface HandoffPackage { taskId: string; objective: string; context: string; memoryRefs: string[];
  allowedPaths: string[]; acceptance: string[]; limits: { timeoutMs: number; readOnly: boolean }; expected: string; }
```

---

## 8. Fases

Cada fase termina com app executável, testes da fase verdes e commit. Ordem segue a seção 11 da spec (cérebro primeiro), com spikes antes para derrubar R1/R2/R13 cedo.

### Fase 34 — Assistente pessoal independente de projeto

Esta fase consolida os pedidos do usuário para que o chat e a Neura funcionem como um assistente geral, sem projeto obrigatório, mantendo projetos apenas como contexto adicional e autorização para ações em arquivos.

**Objetivo:** oferecer uma conversa geral persistente e rápida, comandos locais independentes, integração completa com Spotify, clima por localização autorizada e voz PT/EN com recuperação automática.

**Estado atual verificado:** `TaskEngineConversation` já aceita `projectId: null` em modo somente leitura; o Chat já expõe “Sem projeto”; comandos de hora/data e vários comandos do Spotify já foram adicionados; a versão instalada precisa sempre ser incrementada antes de cada novo instalador.

**Progresso desta execução (2026-11-02):** controle seguro de abertura de Spotify, Teams, Configurações, Bloco de Notas e Calculadora implementado e testado; intent PT/EN para descrição da tela implementado; captura Windows consentida e temporária conectada ao agente read-only sem projeto; imagens agora são encaminhadas pelo `TaskEngine` estruturado; histórico geral sem projeto passou a persistir seis trocas locais e apagáveis; clima PT/EN conectado ao provedor Open-Meteo com localização do Electron somente após consentimento, cache de cinco minutos e fallback stale identificado; memória global limitada é adicionada à conversa como dado; falhas de captura reabrem a voz automaticamente e o beep retoma `AudioContext`; Spotify ganhou transferência de dispositivo por nome, recuperação de Play sem player ativo e reprodução explícita de faixa, álbum, artista e playlist após busca oficial; fluxo “responder este chat” agora captura a tela, inclui aplicativo/título, HWND e, quando disponível, metadados do elemento focado via UI Automation apenas para restaurar o foco local, prepara prévia e exige confirmação antes de colar, validando que a janela ainda existe e recusando campo de senha/não editável; uma solicitação de edição de arquivo sem projeto é recusada localmente com orientação para selecionar um projeto; comandos locais de hora/data/clima/tela usam o idioma detectado; captura de tela com campo de senha focado não é enviada ao modelo; o HUD mostra o microfone, último frame e pico do sinal sem persistir áudio; o adaptador TTS reutiliza o catálogo do VoiceStudio por 30 s, compartilha sondagens concorrentes e invalida o cache depois de falha de síntese; o HUD mantém voz/confirmações críticas visíveis e organiza assistente, sugestões e detalhes por abas acessíveis.

**Validação desta execução (2026-11-02):** suíte `npm test -- --no-file-parallelism --reporter=dot`: **167 arquivos / 1.472 testes aprovados**; `npm run typecheck`, `npm run lint`, `git diff --check`, `npm run dist:win` e `npm run verify:dist` foram aprovados. E2E direcionado das abas: 1/1 aprovado; a suíte `neura-assistant` passou **6/6**, cobrindo texto sem provider, reunião em inglês, confirmação, abas, wake + comando e pausa/retomada automática. A validação Git da reorganização por abas passou **22/22 E2E**. Instalador entregue: `C:\dev\neuralbridge\dist\NeuralBridge-Setup-0.1.49-x64.exe` (**242.618.957 bytes; blockmap 254.941 bytes**), gerado após a persistência limitada do chat geral, o diagnóstico de microfone, a recuperação de Play sem player ativo, o contexto da janela ativa, o cache/fallback/timeout do clima, o roteamento explícito para faixa/álbum/artista/playlist, a restauração segura do HWND capturado, a seleção limitada do elemento focado via UI Automation, a recusa determinística de edição sem projeto, respostas determinísticas no idioma detectado, a proteção contra análise de campo de senha, o cache de catálogo do TTS e a organização do HUD por abas.

#### 34.1 — Contrato de conversa global e chat sem projeto

**Arquivos prováveis:** `packages/orchestrator/src/neura-conversation.ts`, `apps/desktop/src/main/neura-runtime.ts`, `apps/desktop/src/main/tasks.ts`, `apps/desktop/src/renderer/src/features/tasks/ChatPage.tsx`, testes correspondentes.

- [x] Garantir que conversa geral use `projectId: null`, `access: 'read-only'` e não falhe por ausência de projeto.
- [x] Manter histórico curto da conversa fora do projeto, com limite de seis trocas e persistência local apagável.
- [x] Roteiar automaticamente: conversa geral → agente global; código/arquivos/tarefa → projeto selecionado; sem projeto, explicar que a ação exige contexto em vez de falhar silenciosamente.
- [x] Exibir no chat a separação entre “Conversa geral” e “Contexto do projeto”.
- [x] Testar perguntas gerais, troca de projeto, projeto inexistente e tentativa de edição sem projeto.

**Aceite:** abrir `/chat` sem projeto, enviar “olá”, perguntas gerais e perguntas em inglês retorna resposta; nenhuma chamada exige criar ou selecionar projeto; uma solicitação de alteração de arquivo é recusada com explicação clara.

#### 34.2 — Roteador de comandos globais e baixa latência

**Arquivos prováveis:** `packages/orchestrator/src/neura-intents.ts`, `packages/orchestrator/src/neura-orchestrator.ts`, `packages/orchestrator/test/neura-orchestrator.test.ts`.

- [x] Completar intents PT/EN para hora, data, clima, Spotify, abrir aplicativo e controles básicos; `parseNeuraIntent` cobre as variações e a suíte do orquestrador valida as rotas locais/Spotify.
- [x] Executar intents determinísticos localmente, sem TaskEngine, CLI ou modelo remoto.
- [x] Retornar resposta textual e evento de voz imediatamente após a ação, sem aguardar o agente geral; integrações externas exibem progresso antes da resposta final.
- [x] Adicionar testes para variações de pontuação, acentos, “Neora”, inglês e frases de acompanhamento após o bip.

**Aceite:** comandos locais respondem em até 500 ms em condições normais; uma falha do agente não impede hora, clima ou Spotify de funcionar.

#### 34.3 — Voz robusta e recuperação do microfone

**Arquivos prováveis:** `apps/desktop/src/renderer/src/features/neura/useVoiceCapture.ts`, `packages/orchestrator/src/neura-voice-gateway.ts`, `apps/desktop/src/main/voicestudio-streaming-provider.ts`, `apps/desktop/src/main/neura-runtime.ts`.

- [x] Preservar o bip de wake antes do comando e separar visualmente `wakeDetected`, transcrição e resposta.
- [x] Detectar `AudioContext` suspenso, ausência de frames e erro de permissão; encerrar a sessão falsa e reabrir a captura sem reiniciar o computador.
- [x] Exibir no HUD o microfone efetivamente usado, estado da captura, último frame e pico do sinal; o motivo de falha continua no estado do provider.
- [x] Não descartar silenciosamente idioma inválido; normalizar `auto` para idioma aceito pelo pipeline.
- [ ] Testar com provider/microfone reais wake-only, follow-up, silêncio, erro do provider e recuperação após 5 segundos sem frames; o E2E fake cobriu wake + comando e pausa/retomada em `neura-assistant.spec.ts` (6/6).

**Aceite:** “Neura” produz bip; “Neura, que horas são?” produz resposta; se a captura parar, o HUD não permanece falsamente em “Ouvindo”.

#### 34.4 — Spotify completo

**Arquivos prováveis:** `packages/shared/src/spotify.ts`, `packages/orchestrator/src/integrations/spotify-adapter.ts`, `apps/desktop/src/main/spotify/service.ts`, `packages/orchestrator/src/neura-intents.ts`, testes de adapter/orquestrador.

- [x] Cobrir play/resume, pause, próxima/anterior, volume, busca e reprodução de faixa/álbum/artista/playlist; tipos de coleção são escolhidos pela intenção e executados pela URI retornada na busca oficial.
- [x] Cobrir playlists salvas, músicas curtidas, artistas seguidos, estado atual, dispositivos disponíveis e transferência de dispositivo por voz.
- [x] Para toda frase roteada como Spotify, chamar exclusivamente o adapter/API do Spotify; não encaminhar ao agente geral.
- [x] Tratar token expirado, ausência de dispositivo, Premium, controles desativados, rate limit, rede, resposta inválida e conexão revogada com mensagem acionável; escopos ausentes ainda dependem de reconexão explícita.
- [ ] Validar o fluxo de reconexão e solicitar somente os escopos necessários.
- [ ] Testar comandos PT/EN e confirmar que “play” funciona mesmo quando o Spotify já está aberto sem playback ativo.

**Aceite:** “Neura, dá play”, “pause Spotify”, “next track” e “quais são minhas playlists?” executam ou informam claramente o bloqueio real.

#### 34.5 — Clima e localização do Windows

**Arquivos prováveis:** `packages/shared/src/weather.ts`, `packages/orchestrator/src/weather-service.ts`, `apps/desktop/src/main/location-service.ts`, preload/IPC e telas de configurações.

- [x] Solicitar localização somente com consentimento explícito do usuário.
- [x] Usar localização do Windows/Electron quando disponível e oferecer cidade fixa como fallback.
- [x] Consultar um provedor de clima com timeout e estado offline; não enviar áudio ao provedor; usar cache de cinco minutos e devolver dado stale identificado quando o provedor estiver temporariamente indisponível; manter fallback de cidade fixa.
- [x] Adicionar intents PT/EN para “como está o tempo?” e weather forecast.
- [x] Mostrar fonte, horário da atualização e localização usada na resposta do chat/voz.
- [x] Testar permissão negada, localização indisponível, timeout cancelável, cache/stale e resposta em português/inglês (`weather-service.test.ts` 4/4 e `location-service.test.ts` na suíte completa).

**Aceite:** sem projeto, “Neura, como está o tempo?” responde usando localização autorizada ou pede/configura um local fallback.

#### 34.6 — Memória global e contexto opcional

**Arquivos prováveis:** `packages/brain/src/brain-service.ts`, `packages/orchestrator/src/neura-conversation.ts`, `apps/desktop/src/renderer/src/features/neura/NeuraSettingsSection.tsx`, testes de brain/orquestrador.

- [x] Classificar memórias como globais ou específicas de projeto.
- [x] Incluir memórias globais em conversa geral apenas dentro de um limite de itens/caracteres e rotuladas como dados.
- [x] Incluir memória do projeto somente quando o projeto estiver selecionado ou for explicitamente mencionado.
- [x] Permitir apagar/pausar memória global separadamente do histórico de sugestões.
- [x] Testar isolamento entre projetos e visibilidade controlada de memórias globais.

**Aceite:** a Neura lembra preferências globais sem vazar regras ou arquivos de outro projeto.

#### 34.7 — Interface, scroll e organização

**Arquivos prováveis:** componentes/páginas do chat, HUD e estilos correspondentes.

- [ ] Remover scroll global da tela principal quando o conteúdo exceder a altura.
- [x] Aplicar scroll interno nos cards longos e listas extensas.
- [x] Separar conjuntos grandes de controles por abas; voz e confirmações críticas permanecem visíveis para não esconder ações urgentes.
- [ ] Adicionar pesquisa em playlists, histórico, memórias e eventos quando a lista justificar.
- [ ] Validar teclado, labels, foco, leitor de tela e viewport pequeno com Playwright.

**Aceite:** a tela não cria scroll duplo acidental; cards longos rolam internamente; listas grandes continuam utilizáveis sem estourar o layout.

#### 34.8 — Releases, diagnóstico e instalação

**Arquivos prováveis:** `package.json`, `apps/desktop/package.json`, `package-lock.json`, `scripts/`, `docs/STATUS.md`, `docs/PLAN.md`.

- [x] Incrementar a versão patch antes de cada `npm run dist:win` (esta execução gerou `0.1.49`; a próxima entrega deverá usar `0.1.50`).
- [x] Rodar typecheck, testes focados, E2E da Neura (6/6), build e instalador NSIS antes de entregar.
- [x] Conferir que o nome do instalador corresponde à versão declarada nos manifests.
- [x] Registrar no plano os comandos, resultados, bloqueios e caminho absoluto do instalador.
- [ ] Nunca declarar “corrigido” enquanto o comportamento não for validado na versão instalada.

**Aceite:** cada entrega gera um instalador com número novo, testes registrados e instrução clara para fechar a versão antiga antes de instalar.

#### 34.9 — Controle seguro do computador

**Arquivos prováveis:** `packages/shared/src/computer.ts`, `packages/orchestrator/src/computer-intents.ts`, `apps/desktop/src/main/computer-launcher.ts`, `packages/orchestrator/src/computer-action-broker.ts`, preload/IPC e testes E2E.

- [x] Expandir o catálogo de ações seguras: abrir programas permitidos e colar uma resposta confirmada na janela identificada na captura, validando/restaurando o HWND no Windows e, quando disponível, refocando o elemento editável identificado por UI Automation; sem HWND o fluxo agora bloqueia para não cair na janela anterior; fechar/focar janela e navegação explícita continuam pendentes.
- [x] Manter allowlist de aplicativos e exigir confirmação para ações com risco de perda, envio, exclusão ou alteração persistente.
- [x] Nunca transformar texto livre do agente diretamente em comando de shell; toda ação deve ser uma intenção tipada, validada e auditada.
- [x] Retornar confirmação objetiva: ação executada, ação bloqueada, aplicativo não encontrado ou confirmação necessária.
- [ ] Testar caminhos com espaços/acentos, aplicativo ausente, repetição, cancelamento e tentativa de comando fora da allowlist.

**Aceite:** “abra o Spotify”, “abra o bloco de notas” e ações permitidas funcionam sem projeto; ações perigosas não são executadas sem confirmação explícita.

#### 34.10 — Percepção da tela e resposta em aplicativos

**Arquivos prováveis:** `apps/desktop/src/main/screen-observer.ts`, `apps/desktop/src/main/accessibility-bridge.ts`, `packages/shared/src/screen.ts`, `packages/orchestrator/src/screen-intents.ts`, preload/IPC e testes E2E.

- [x] Capturar uma imagem da tela somente após consentimento de “ver a tela”, com indicador de processamento enquanto a captura estiver ativa.
- [x] Preferir a árvore de acessibilidade/UI Automation para obter metadados do elemento focado quando o Windows os fornece; manter screenshot/OCR como fonte complementar quando a árvore não for suficiente. A seleção semântica universal do chat ainda está pendente.
- [x] Responder “o que está aparecendo na minha tela?” com resumo do conteúdo visível, aplicativo ativo e confiança/limitações; a captura agora acrescenta metadado limitado da janela ativa e o prompt separa texto legível de inferência.
- [x] Criar fluxo “responder este chat”: capturar a tela, redigir resposta, mostrar prévia e somente colar após confirmação; a janela é validada por HWND e o campo focado pode ser refocado por UI Automation, mas seleção fina universal e envio explícito continuam pendentes.
- [x] Limitar dados enviados ao agente, redigir tokens/senhas e bloquear captura de campos marcados como senha.
- [ ] Testar permissão negada, múltiplos monitores, DPI, janela minimizada, campo não editável, chat sem foco e confirmação de envio.

**Aceite:** a Neura consegue descrever a tela sob consentimento e preparar/digitar uma resposta no chat correto sem enviar texto para a janela errada; envio externo exige confirmação configurável.

#### 34.11 — Respostas rápidas e conversas complexas

**Arquivos prováveis:** `packages/orchestrator/src/neura-router.ts`, `packages/orchestrator/src/neura-conversation.ts`, `packages/orchestrator/src/streaming-response.ts`, `apps/desktop/src/renderer/src/features/neura/` e testes.

- [x] Classificar localmente comandos determinísticos, perguntas gerais e tarefas complexas antes de chamar modelo; o roteador fechado de `parseNeuraIntent` mantém ações fora do TaskEngine e deixa apenas conversa/tarefas complexas para o agente.
- [x] Para pergunta geral, encaminhar eventos de texto do provider em streaming ao estado da Neura; reprodução de áudio por partes ainda pendente.
- [x] Para tarefas complexas, mostrar imediatamente estado “processando” no estado compartilhado/HUD, sem esperar o resultado final para atualizar a UI; streaming de texto/áudio por partes continua pendente.
- [x] Cancelar resposta anterior quando o usuário interromper ou emitir nova wake word.
- [x] Medir tempo até primeiro texto, primeiro áudio, conclusão e erro; não declarar “imediato” sem medição.
- [ ] Testar latência, cancelamento, provider lento, provider indisponível, resposta em PT/EN e histórico sem projeto.

**Evidência (2026-11-02):** `npx vitest run --no-file-parallelism`: 1489/1489; typecheck, lint e build limpos; `neura-assistant.spec.ts` + `companion-motion.spec.ts`: 22/22. Numa rodada anterior, com 3 repetições, o teste de abas estourou o tempo uma vez, sem causa fechada. O fluxo de `project.edit_task` tem testes unitários, sem E2E nem execução real de agente.

- Memória: `NeuraMemoryScope` lê só globais e o projeto selecionado; `globalMemoryEnabled` pausa as globais sem tocar nelas nem no histórico de sugestões; a exclusão continua no Brain.
- Tela: `prepareChatReply` agora recusa campo de senha **antes** do modelo (antes a captura já tinha sido enviada); título de janela e nome de campo passam por `maskSecrets`; capturas acima de 20 MB são recusadas.
- Latência: instrumentado, sem valor real coletado. `timing` vai na resposta (primeiro texto, total, erro) e aparece no título do chat; primeiro áudio só em log do renderer (`neura.voice.first_audio_ms`), e não cobre a voz de fallback do navegador.
- Roteamento: decisão do usuário em 2026-11-02, permitir com confirmação. Pedido de alteração com projeto selecionado vira a ação auditada `project.edit_task`, presa ao projeto do pedido; a tarefa só começa ao aprovar no painel, com as permissões do projeto e sem commit, push, checkout ou merge. Fala nunca aprova.
- Abertos com motivo: aplicativo ausente, provider lento e os testes reais de microfone, Spotify, DPI e versão instalada ainda não foram executados.

**Aceite:** comandos locais respondem em até 500 ms; conversa geral mostra o primeiro trecho assim que o provider entregar; tarefas longas exibem progresso e podem ser interrompidas.

### Ordem recomendada de execução da Fase 34

1. [ ] 34.1 Contrato global e chat sem projeto.
2. [ ] 34.2 Roteador rápido de comandos.
3. [ ] 34.3 Voz e recuperação do microfone.
4. [ ] 34.4 Spotify completo.
5. [ ] 34.5 Clima/localização.
6. [ ] 34.6 Memória global.
7. [ ] 34.7 Interface e organização visual.
8. [ ] 34.8 Testes finais e instalador versionado.
9. [ ] 34.9 Controle seguro do computador.
10. [ ] 34.10 Percepção da tela e resposta em aplicativos.
11. [ ] 34.11 Streaming e respostas complexas.

**Definição de pronto da Fase 34:** chat e Neura funcionam sem projeto; comandos locais não dependem de agente remoto; Spotify, clima, voz, controle do PC e percepção da tela têm estados de erro/consentimento visíveis; respostas gerais e complexas têm streaming ou progresso; PT/EN são aceitos; listas longas usam scroll interno/abas/pesquisa; testes unitários, integração, E2E e build passam; o instalador entregue possui versão patch inédita.

### Fase 0 — Spikes de viabilidade (descartáveis)

**Status: concluída em 2026-10-28 — todos os spikes passaram. Resultados em [spikes.md](spikes.md).**

- [x] **S1 — Runtime único:** projeto mínimo electron-vite + better-sqlite3 rebuild para Electron 44; abrir DB, criar tabela FTS5, inserir/buscar; rodar o mesmo código via `ELECTRON_RUN_AS_NODE=1 electron script.mjs` e via Vitest com `scripts/vitest-electron.mjs`.
- [x] **S2 — CLIs headless:** gravar em `packages/agents/test/fixtures/` a saída real de `claude -p "diga ok" --output-format stream-json --verbose` e `codex exec --json "diga ok"` num diretório temporário; confirmar campos de uso de tokens, `session_id`, como resolver `codex` sem shell (R13), e o comportamento de cancelamento (kill da árvore).
- [x] **S3 — Embeddings:** carregar `multilingual-e5-small` via transformers.js dentro de Electron-as-node; medir tempo de carga, RAM e latência por embedding.
- [x] **S4 — MCP:** servidor stdio mínimo com 1 ferramenta, registrado em Claude e Codex com escopo temporário, chamado de cada cliente; remover registro ao final. (Feito sem registro persistente: `--mcp-config` no Claude e `-c mcp_servers.*` no Codex.)

**Critérios de aceite:** relatório curto em `docs/spikes.md` com resultado de cada spike, comandos exatos usados e versões. Qualquer spike falho → revisar a decisão afetada (R1 plano B, A6 outro modelo) **antes** da Fase 1. Código dos spikes não é reaproveitado.

### Fase 1 — Monorepo e casca do app

Workspaces, TS 6 strict, ESLint, electron-vite com main/preload/renderer, Tailwind 4 + shadcn/ui, tema escuro padrão e claro, sidebar com as rotas da spec (páginas vazias com empty state real, não números falsos), configuração de segurança do Electron.
**Testes:** unitário do allowlist de navegação; E2E Playwright: app abre, sidebar navega entre todas as rotas, `window.require`/`process` indefinidos no renderer.
**Aceite:** `npm run dev` abre a janela; `npm test` e `npm run test:e2e` verdes; CSP presente no HTML servido.

**Status: concluída em 2026-10-28.** 20 testes unitários + 9 E2E verdes; typecheck e lint limpos; dev server serve o renderer com CSP de dev. Decisões tomadas na fase:
- Roteamento com `react-router` 8 (`createHashRouter`); tema via `nativeTheme.themeSource` → `prefers-color-scheme`, persistido em `%APPDATA%\NeuralBridge\preferences.json` (passa para a tabela `settings` na Fase 2).
- CSP como `<meta>` injetada no build (`buildCsp`), estrita em produção; dev libera só `unsafe-inline` em script e `ws://localhost`.
- Componentes shadcn copiados à mão (Button, RadioGroup): a CLI 4.21.4 não resolveu o alias `@/lib/utils` neste monorepo e queria instalar um pacote `cn` inexistente no projeto.
- Tipografia IBM Plex Sans/Mono empacotada (sem fontes remotas, compatível com a CSP).
- E2E lança a pasta do app (não o `out/main/index.js`) para nome/versão resolverem como no app empacotado, e usa `colorScheme: null` porque o Playwright emula tema claro por padrão.

### Fase 2 — Banco e migrações

`packages/database`: schema Drizzle para `projects`, `memories`, `memory_versions`, `tags`, `memory_tags`, `links` (com `target_title` para pendentes), `embeddings`, `sources`, `access_log`, `tasks`, `task_steps`, `task_events`, `settings`. FTS5 `memories_fts` (external content) com triggers. FKs `ON DELETE CASCADE`. `openDatabase(path)` aplica pragmas (WAL, foreign_keys, busy_timeout) e migrações.
**Testes:** migração em banco vazio e em banco da versão anterior; FK impede link órfão; trigger mantém FTS sincronizado em insert/update/delete; DB corrompido → erro tipado `DatabaseUnavailable` (Review Focus 3).
**Aceite:** banco criado em `%APPDATA%\NeuralBridge\db\brain.db` no primeiro start; reinício preserva dados.

**Status: concluída em 2026-10-28.** 34 testes unitários (12 do banco) + 11 E2E verdes. Decisões tomadas na fase:
- `memories` tem `seq INTEGER PRIMARY KEY` como rowid estável do FTS (VACUUM pode renumerar rowids implícitos — há teste) e `id` texto único para a API.
- Migração `0001` escrita à mão: FTS5 + triggers e o índice único de título vivo por projeto (`coalesce(project_id,'')`, `lower(title)`, `WHERE deleted_at IS NULL`). Motivo: drizzle-kit 0.31.11 parte expressões com vírgula em SQL inválido. Novas migrações: `npm run generate -w @neuralbridge/database`; SQL customizado com `drizzle-kit generate --custom`.
- "Fontes" virou `memory_sources` (evidências: arquivo, URL, tarefa); a origem da memória fica em `memories.source_kind/source_ref`. "Decisões arquiteturais" são memórias `type = 'decision'`, sem tabela própria.
- Vocabulários (tipos de memória, trust, status de tarefa…) em `@neuralbridge/shared/domain`, usados pelo schema como `CHECK`.
- Banco indisponível → `DatabaseUnavailableError` com `reason` (`corrupt`/`locked`/`io`/`unknown`); o app abre em modo degradado com aviso e o caminho do arquivo.
- O tema continua em `preferences.json` de propósito (a janela precisa dele mesmo com o banco indisponível) — substitui a nota da Fase 1 sobre movê-lo para `settings`.
- As migrações são copiadas para `out/main/migrations` no build; o empacotamento (Fase 17) deve incluí-las.
- `npm audit`: 4 alertas moderados do esbuild antigo dentro do `drizzle-kit` (só desenvolvimento; afeta o dev server do esbuild, que não usamos). Aceito; revisar quando sair drizzle-kit sem `@esbuild-kit`.

### Fase 3 — Núcleo do Neural Brain (store/recall/list/delete/links) [sub-plano]

`BrainService` sem busca: store com versionamento (nova linha em `memory_versions` a cada update), parse de `[[Título]]`, resolução de pendentes, backlinks, escopo de projeto, delete soft/hard, `access_log`.
**Testes:** criar/atualizar gera versão; `[[X]]` antes de X existir vira pendente e resolve quando X é criada; backlinks corretos; memória de projeto A invisível com scope B; global visível com `includeGlobal`; hard delete remove FTS, links e embeddings.
**Aceite:** todos os testes verdes rodando sob Electron-as-node.

**Status: concluída em 2026-10-28.** Sub-plano e regras em [plans/phase-3-brain-core.md](plans/phase-3-brain-core.md). Pacote `packages/brain` (`BrainService`, escopos, ULID, wikilinks) + contratos Zod em `@neuralbridge/shared` (`brain.ts`). 39 testes do cérebro; suíte total 73 unitários + 11 E2E. Testes rodam no Node (o S1 mostrou que o binário N-API é o mesmo do Electron). Decisão relevante: escritas em `BEGIN IMMEDIATE` para serializar processos concorrentes (ver regra 8 do sub-plano).

### Fase 4 — Servidor MCP independente [sub-plano]

`packages/mcp-server`: ferramentas `brain_store/recall/search(fts por enquanto)/list/delete/links` com schemas Zod; `orchestrator_status`/`task_status` lendo `tasks`. Entrada stdio empacotada como segunda entrada main; escopo via `--project`/`cwd` (A3). Conteúdo retornado marcado como dado não confiável.
**Testes:** cliente MCP do SDK em processo filho chama cada ferramenta; argumentos inválidos → erro MCP, não crash; isolamento entre projetos; 3 processos escrevendo em paralelo sem `SQLITE_BUSY` (R4).
**Aceite:** `electron out/main/mcp-server.js` (com `ELECTRON_RUN_AS_NODE=1`) sobe sem a janela aberta e responde `tools/list`.

**Status: concluída em 2026-10-28.** Sub-plano em [plans/phase-4-mcp-server.md](plans/phase-4-mcp-server.md). 8 ferramentas; 14 testes em processo + 5 de processo real (`npm run test:integration`); suíte total 92 unitários, 11 E2E, 5 integração. Decisões: sem exclusão definitiva via MCP; agentes usam `global: true` em vez de escolher projeto; toda saída com dados vem com aviso de "dado não confiável"; ator derivado do `clientInfo.name`. Busca FTS provisória em `BrainService.search` (sem stemming: "migração" não casa "migrações" — resolve na Fase 6). O typecheck agora cobre `tests/`.

### Fase 5 — Registro e prova Claude ↔ Codex via MCP

`packages/workspace/mcp-registration`: gera e aplica (com confirmação) `claude mcp add -s user neuralbridge -- <exe> <script>` e `codex mcp add neuralbridge -- …` com env `ELECTRON_RUN_AS_NODE=1`; detecta registro existente; remove.
**Testes (`NB_REAL_CLI=1`):** `claude -p` instruído a chamar `brain_store` com título único; `codex exec` instruído a chamar `brain_recall` desse título; asserção no conteúdo retornado e na linha do banco.
**Aceite:** critérios 1, 2 e 8 da seção 10 do Neural Brain comprovados por teste real, com log do teste anexado em `docs/spikes.md`.

**Status: concluída em 2026-10-28.** Critérios 1, 2 e 8 comprovados com Claude Code 2.1.312 e Codex 0.162.1 reais (evidências em [spikes.md](spikes.md#fase-5--prova-real-claude-code--codex-2026-10-28)). Entregue:
- `packages/workspace`: localização dos CLIs sem shell (`claude.exe`; Codex npm via `node bin/codex.js`), registro/detecção/reparo/remoção pelos comandos oficiais, backup do arquivo de configuração do cliente antes de qualquer mudança.
- Página **MCPs**: comando do servidor, status por cliente (não instalado / não registrado / registrado / caminho desatualizado), Registrar/Atualizar/Remover com diálogo de confirmação mostrando o comando e o arquivo afetado, comandos equivalentes para copiar. Permissão do navegador liberada só para `clipboard-sanitized-write` na página do app.
- Testes: 18 unitários do registro; 2 de integração com os CLIs reais em configs isoladas; 2 E2E do fluxo pela UI (`NB_REAL_CLI=1`); prova Claude → Codex → Claude (`tests/integration/real-clients.test.ts`). O E2E sempre aponta `CLAUDE_CONFIG_DIR`/`CODEX_HOME` para pastas temporárias.
- **Seu `~/.claude.json` e `~/.codex/config.toml` não foram alterados.** O registro real é uma ação sua, pela página MCPs.
- Testes que usam os CLIs reais: `NB_REAL_CLI=1 npm run test:integration` e `NB_REAL_CLI=1 npm run test:e2e`.

### Fase 6 — Busca textual e semântica híbrida [sub-plano]

FTS5 com bm25 + filtros (projeto, tags, tipo, título); `EmbeddingProvider` (transformers.js, lazy load, unload após 10 min ocioso), fila `pending` de embeddings, `VectorIndex` em BLOB; RRF (k=60) combinando FTS e cosseno; fallback FTS-only com flag `degraded: true` no resultado.
**Testes:** conjunto de relevância fixo (~30 memórias PT/EN, 10 consultas com resposta esperada no top-3) para FTS, semântica e híbrida — híbrida ≥ melhor das duas; modelo ausente → resultados FTS + `degraded`; acentos/caixa ignorados na FTS (`unicode61 remove_diacritics 2`).
**Aceite:** `brain_search` no MCP usa modo híbrido; critérios 3 e 4 do Neural Brain.

**Status: concluída em 2026-10-28.** Critérios 3 e 4 comprovados. Sub-plano e números em [plans/phase-6-hybrid-search.md](plans/phase-6-hybrid-search.md). Relevância com o modelo real (top-3, 10 consultas PT/EN): **FTS 8/10, semântica 8/10, híbrida 9/10**. Decisões medidas na fase:
- Stopwords PT/EN removidas da consulta FTS e palavras de 1–2 letras sem prefixo: `"de"*`/`"no"*` casavam quase tudo e derrubavam a fusão.
- e5-small concentra similaridades em 0,80–0,90 (uma consulta sem relação chegou a 0,847): piso `minSimilarity = 0.75` só remove o claramente alheio, e o lado semântico entra na fusão com no máximo 10 candidatos.
- Falha conhecida e registrada: "onde guardar chaves e segredos" → "Secrets management" (o modelo pequeno ranqueia outras acima). Modelo maior (bge-m3) seria o próximo passo se isso importar na prática.
- Download só com consentimento (Configurações → Busca semântica); servidores MCP nunca baixam e seguem a chave `semantic_search` a cada chamada.
- Bug de concorrência achado por teste e corrigido: pedido de indexação perdido entre o fim do laço e a limpeza do `IndexScheduler`.
- Empacotamento (Fase 17): `@huggingface/transformers` é carregado por `import()` em tempo de execução e traz `onnxruntime-node` e `sharp` (nativos) — incluir no instalador.
- Testes com o modelo real: `NB_EMBEDDINGS=1 npm run test:integration` (modelo em `tests/.cache/models` ou `NB_MODELS_DIR`).

### Fase 7 — Adaptadores Claude e Codex [sub-plano]

`ProcessRunner` (spawn sem shell, timeout, AbortSignal, kill de árvore, buffer limitado + arquivo de log, redator); `ClaudeCliAdapter` e `CodexCliAdapter` (detect: caminho, versão, auth via `claude auth status` / `codex login status`, features; run: args montados a partir de `AgentRunRequest`, parsers dos fixtures da Fase 0).
**Testes:** parsers contra fixtures; evento desconhecido → `raw`; CLI inexistente → `installed:false`; deslogado → `authenticated:false`; timeout e cancelamento matam o processo filho (verificar PID morto); caminho com espaço/acento; saída de 50 MB não estoura memória. Real (`NB_REAL_CLI=1`): uma tarefa trivial em repositório temporário por agente.
**Aceite:** Dashboard mostra status real dos dois CLIs; critérios "detectar", "tarefa real com Claude", "tarefa real com Codex".

**Status: concluída em 2026-10-28.** Sub-plano em [plans/phase-7-agent-adapters.md](plans/phase-7-agent-adapters.md). Critérios "detectar", "tarefa real com Claude" e "tarefa real com Codex" comprovados (`tests/integration/agents-real.test.ts`, `NB_REAL_CLI=1`): edição real, somente leitura sem escrita, cancelamento sem processos restantes. Review Focus 1, 2, 4 e 5 cobertos por testes. Achados da fase:
- **Prompt sempre pelo stdin** (`claude -p`, `codex exec -`), verificado nas versões instaladas: sem limite de ~32 KB da linha de comando.
- **`codex exec resume` não aceita `-s`/`-C`**: sandbox via `-c sandbox_mode=…` para os dois casos; pasta = `cwd` do processo.
- **`codex login status` escreve no stderr** e sinaliza com o código de saída (0/1). O primeiro CLI falso escrevia no stdout e escondia o bug; o E2E com os CLIs reais o revelou. Fake corrigido para imitar o real.
- **Claude nega escrita sem falhar o run** (`is_error: false` + `permission_denials`): o parser emite `permission_denied` e só reporta `file_change` depois de um `tool_result` sem erro.
- **Teste de kill da árvore precisava de neto `detached`**: o Node põe os filhos num job object e eles morreriam de qualquer jeito; o CLI falso agora imita um neto de CLI nativo, e o teste falha sem `taskkill /T`.
- `claude auth status` traz e-mail e organização: só `loggedIn` e `authMethod` são lidos.
- Fixtures reais redigidas por `scripts/record-cli-fixtures.mjs` (sem usuário, pasta pessoal, skills, plugins ou hooks).

### Fase 7.5 — Neural RAG Engine [sub-plano]

Fase adicional entre os adaptadores e a UI. Começa pendente mesmo reutilizando componentes das Fases 2, 3, 4 e 6; o histórico dessas fases permanece intacto.

1. **Modelagem de documentos e chunks:** aceite: contratos e migração cobrem projeto, caminho, hash, linhas, versão e estado.
2. **Pipeline de ingestão:** aceite: descoberta, .gitignore e exclusão de sensíveis são aplicados antes da persistência.
3. **Indexação incremental:** aceite: execução idempotente, hash evita reprocessamento e remoções eliminam obsoletos.
4. **Chunking semântico:** aceite: Markdown/documentação têm limites determinísticos, títulos e linhas verificáveis.
5. **Chunking orientado a símbolos:** aceite: fixtures de C# e TypeScript preservam classes, funções, interfaces e métodos.
6. **Integração com embeddings existentes:** aceite: reutiliza provider/vector index, sem download implícito, com fallback FTS-only.
7. **Pesquisa híbrida unificada:** aceite: FTS5 + semântica + RRF combinam sem duplicação.
8. **Ranking, deduplicação e filtros:** aceite: projeto, tipo e origem filtram sem vazamento entre projetos.
9. **Recuperação contextual:** aceite: contexto respeita orçamento do Token Optimizer e inclui referências verificáveis.
10. **Integração com MCP:** aceite: Claude/Codex usam os contratos existentes; payload inválido não causa crash.
11. **Integração com Token Optimizer:** aceite: tokens recuperados e piso do provedor são contabilizados separadamente.
12. **Testes automatizados e benchmarks:** aceite: Recall@K, Precision@K, MRR, latência e tokens são reproduzíveis com e sem semântica.

Detalhamento TDD em [plans/phase-7-5-rag-engine.md](plans/phase-7-5-rag-engine.md).

**Status: concluída em 2026-10-28.** Todos os critérios da Fase 7.5 foram comprovados. Entregue: migrações 0004/0005; ingestão incremental por hash; exclusão de arquivos sensíveis; chunking determinístico para Markdown/C#/TypeScript; FTS5 de chunks; embeddings locais; integração semântica opcional ao HybridSearch; contexto limitado/deduplicado com referências; integração do TaskEngine via contextProvider e evento rag_context; ferramenta MCP brain_rag_search; proteção contra traversal; rejeição de junction/symlink externo; isolamento entre projetos; remoção de chunks obsoletos. O benchmark reproduzível em tests/benchmarks/rag-benchmark.test.ts passou com dataset de 3 documentos: indexação 5,9167 ms, FTS recall 1/precision 0,3333/MRR 1, semântica recall 1/precision 0,3333/MRR 1, híbrida recall 1/precision 0,3333/MRR 1, latência p50 0,2839 ms/p95 0,9547 ms e 264 tokens estimados de contexto; resultado em tests/benchmarks/latest-results.json. O teste MCP independente tests/integration/rag-mcp-process.test.ts passou com bundle de produção e SDK oficial. Os testes RAG/segurança/contexto/Brain/Database/MCP passaram, o typecheck passou, e a validação direta no Windows confirmou 19/19 testes do orquestrador aprovados. A proteção contra prompt injection foi validada especificamente como delimitação e tratamento de dados não confiáveis, sem alegar resistência absoluta do agente. Não houve economia de tokens declarada.

### Fase 8 — Shell de UI do cérebro: Explorer, Inspector, Overview

IPC tipado (`brain.*`), TanStack Query, Memory Explorer (busca híbrida, filtros, editor Markdown, histórico de versões, links/backlinks), Memory Inspector, Brain Overview (contagens reais, últimas memórias, status MCP).
**Testes:** unitário dos handlers IPC rejeitando payload inválido; E2E: criar, editar, ver versão anterior, excluir memória; Overview reflete contagem do banco.
**Aceite:** critério 7 do Neural Brain. Passar `impeccable`/`web-design-guidelines` nas telas antes de fechar a fase.

**Status: concluída em 2026-10-28.** Critério 7 comprovado por E2E (criar, editar, ver versão, restaurar, resolver link, buscar, filtrar, excluir definitivamente, conferindo o banco ao final). Entregue: serviço `main/brain.ts` (o app age como o usuário, vê projetos privados), 9 canais `brain:*` validados com Zod na entrada e na saída (gravação com as mesmas regras do MCP), páginas Visão geral, Explorar (filtros na URL), detalhe com links/citações/histórico e editor com pré-visualização. Decisões e achados:
- **Conteúdo de memória é tratado como não confiável na UI**: sem HTML (react-markdown), imagens remotas viram texto, links externos não navegam; teste E2E com conteúdo hostil.
- **Marcadores de destaque**: o app usa caracteres de controle (`\u0002`/`\u0003`) nos trechos da busca, porque `[ ]` colide com `[[links]]`; o MCP continua com `[ ]`.
- **Bug achado pelo E2E**: excluir mostrava "não existe" em vez de voltar ao Explorar — a invalidação aguardada desmontava a página antes do callback de navegação. Corrigido removendo a consulta da memória excluída e invalidando o resto sem aguardar.
- **Auditoria `web-design-guidelines`** aplicada: envio não fica desabilitado por erro (mostra o erro e foca o campo), aviso antes de sair com alterações não salvas (e o descarte confirmado não pergunta duas vezes — bug achado no E2E), `aria-live` com a contagem de resultados, `autocomplete="off"`, quebra de títulos e palavras longas.
- Restaurar uma versão cria uma versão nova (o histórico nunca é reescrito).

### Fase 9 — Brain Graph

Cytoscape: nós por memória (cor por tipo, forma tracejada para pendentes), arestas direcionadas, zoom/pan/drag, busca, filtros projeto/tags, agrupamento por tipo (compound nodes), painel lateral, navegação, caminho mais curto entre dois nós destacado.
**Testes:** unitário do conversor banco → elementos do grafo (pendentes, backlinks); E2E: grafo renderiza N nós reais, clicar abre painel, selecionar dois nós destaca caminho.
**Aceite:** critérios 5 e 6 do Neural Brain; 2.000 nós interativos sem travar (medir).

**Status: concluída em 2026-10-28.** Critérios 5 e 6 comprovados por E2E com dados reais do banco. Aba **Grafo** na Memória: nós por tipo (cores por tema), pendentes tracejados, arestas direcionadas, zoom/pan/arrastar, filtros por projeto e tag (na URL), agrupamento por tipo, painel lateral com vizinhos, caminho mais curto e "Criar esta memória" para nós pendentes. Medição com 2.000 memórias (`tests/e2e/graph.spec.ts`, `@slow`):

| Layout | Tempo de layout | Zoom / enquadrar / arrastar |
|---|---|---|
| `cose` (padrão do Cytoscape) | **37.486 ms** com a interface travada | 83 / 87 / 231 ms |
| `fcose` (adotado; modo `draft` acima de 600 nós) | **259 ms** | 83 / 71 / 216 ms |

Decisões e achados:
- **`cytoscape-fcose` 2.2.0** (iVis-at-Bilkent, mesmos autores do `cose`) entrou por causa da medição acima; o teste falha se o layout passar de 3 s.
- **Acessibilidade**: o canvas não é legível por leitor de tela, então tudo que ele mostra também está no painel (encontrar memória, vizinhos, caminho, legenda), operável por teclado; é também o que o E2E usa.
- O Cytoscape força `position: relative` no contêiner — o dimensionamento fica num wrapper (bug achado no E2E: canvas com altura 0). O grafo acompanha o tamanho real (`ResizeObserver`) e enquadra na primeira medição.
- Snapshot do grafo limitado a 5.000 memórias mais recentes (`GRAPH_LIMIT`), com aviso quando há mais.
- Com agrupamento por tipo, caixas de tipos muito interligados podem se sobrepor parcialmente (comportamento do layout com nós compostos).

### Fase 10 — Projetos

Adicionar diretório (diálogo nativo), detectar stack (`*.csproj`/`*.sln`, `package.json` com next/nuxt/vue/react/remotion, `drizzle`/`prisma`/strings de conexão SQL Server/Postgres), Git (branch, status), arquivos relevantes, regras e agente preferido por projeto, diff (`git diff`) por execução.
**Testes:** fixtures de projetos de cada stack; caminho fora dos projetos cadastrados rejeitado pelo validador de caminho (inclusive `..`, junction e caminho UNC).
**Aceite:** projeto adicionado aparece com stack correta; nenhuma escrita em disco do projeto nesta fase.

**Status: concluída em 2026-10-28.** Os dois critérios comprovados: stack correta para .NET/ASP.NET Core/EF Core/SQL Server, Npgsql/PostgreSQL, Next.js/TypeScript/Drizzle/Postgres, Nuxt/Vue, Remotion e Prisma/SQL Server; e a pasta do projeto termina **byte a byte idêntica** (inclusive `.git`) depois de adicionar, inspecionar, ver diffs, configurar e remover (`tests/e2e/projects.spec.ts`). Entregue: `workspace/{stack,git,project-paths,project-files}.ts`, migração `0002` (agente preferido, regras, stack, data de detecção), serviço `main/projects.ts` com 10 canais `projects:*`, páginas Projetos e detalhe (diálogo nativo de pasta). Decisões e achados:
- **Git em repositório não confiável executa comandos**: comprovado nesta máquina (`core.fsmonitor`, `diff.external` e `textconv` rodaram com git puro). Toda chamada desliga os três e usa `--no-optional-locks` (o `status` não reescreve o índice); teste com o "repositório malicioso" e mutação confirmam.
- **Validação de caminho**: absoluto, local (sem UNC/dispositivo), existente, pasta, nem disco inteiro, nem pasta do usuário, nem pastas do sistema; caminho canônico com junções resolvidas. `isInsideProject` resolve `..`, caixa e junções (link interno apontando para fora é fora).
- **Arquivos sensíveis** (`.env*` exceto modelos, chaves, `appsettings*.json`, `.npmrc`, credenciais) nunca são lidos, listados nem mostrados; a detecção de banco usa só manifestos, nunca strings de conexão.
- **Id legível** a partir do nome da pasta (`loja-acao-api`), único, usado em `--project` do MCP.
- **Bug achado no E2E**: a confirmação de remoção usava a contagem de memórias em cache e podia dizer "não tem memórias" quando havia. Agora conta no momento do clique (`projects:impact`).
- O "diff por execução" do plano fica para a Fase 11, sobre esta mesma função (`gitDiff`) — aqui o diff é do estado atual da pasta.

### Fase 11 — Orquestrador e motor de tarefas [sub-plano]

`Router` (regras JSON, modo manual sobrepõe), `TaskEngine` (máquina de estados da seção 12, persistência de steps/eventos, `ProjectLock`, retomada), modo colaborativo (Claude planeja com `--json-schema` → Codex executa com `allowedPaths` → Claude revisa read-only → no máximo N correções), limites de iteração/timeout/orçamento, aprovação prévia para destrutivas (A10).
**Testes:** tabela de roteamento (cada exemplo da spec → agente esperado); trivial → um agente; limite de iterações respeitado; dois runs no mesmo projeto serializam; cancelamento em cada estado; retomada usa `session_id`. Real: um fluxo colaborativo completo em repositório temporário.
**Aceite:** critérios "tarefa colaborativa", "registrar histórico", "permitir cancelamento".

**Status: concluída em 2026-10-28.** Os três critérios comprovados. Sub-plano em [plans/phase-11-orchestrator.md](plans/phase-11-orchestrator.md). Pacote `packages/orchestrator` (roteador, risco, prompts, `TaskEngine`); 49 testes com adaptadores falsos, banco e Git reais. Prova real (`tests/integration/orchestrator-real.test.ts`): **Claude planejou, Codex implementou (`math.js` e `math.test.js`), Claude revisou e aprovou em 64 s**, com estados `planning → running → validating → completed`, etapas, tokens, arquivos alterados e diff registrados. Achados:
- **`--json-schema` do Claude** devolve o JSON em `result.structured_output` (verificado na 2.1.312); o evento `result` dos adaptadores ganhou `structured`.
- **Diff da revisão precisava incluir arquivos novos**: `git diff HEAD` não mostra não rastreados, e o revisor teria visto uma implementação incompleta. `gitDiff(..., { includeUntracked: true })` monta "new file" sem tocar no índice; sensíveis e binários ficam de fora.
- **Cancelamento durante a preparação** (enquanto o `git status` roda): o motor agora confere de novo antes de chamar o agente, que nem chega a iniciar.
- **Revisor sem poder rodar testes**: na prova real o Claude tentou `node math.test.js`, foi bloqueado (somente leitura) e aprovou lendo o código. A revisão agora pode rodar comandos de teste/build e Git de leitura, nunca editar.
- **Ferramentas do Claude ao editar**: arquivos + só comandos de teste/build/Git de leitura (sem `node`/shell livre), porque o Claude não tem sandbox no Windows.
- **Memória dentro das tarefas funciona**: na prova real o Codex usou `brain_search` e `brain_store` sozinho.
- Custo base (R15) visível: a maior parte da entrada do Claude veio de cache (85k de 128k no plano).
- A UI (chat, execuções, aprovar/cancelar pela tela) é a Fase 12; o motor já está no app e marca como interrompidas as tarefas abertas num fechamento anterior.

### Fase 12 — Chat e Execuções

Chat (multilinha, projeto, modos auto/claude/codex/collab, Markdown + código, progresso em tempo real por streaming IPC, agente ativo, arquivos alterados, cancelar), histórico de conversas, página Execuções (lista, detalhe, continuar).
**Testes:** E2E com execução real atrás de `NB_REAL_CLI=1`; sem a flag, E2E cobre UI até o ponto de spawn usando um adaptador de teste injetado só no modo de teste (nunca no build de produção — garantido por teste de build).
**Aceite:** fluxo da seção 1 da spec executável de ponta a ponta pela UI.

**Status: concluída em 2026-10-28.** Aceite comprovado com os CLIs reais pela UI (`tests/e2e/chat-real.spec.ts`, `NB_REAL_CLI=1`): **pedido digitado no Chat, modo colaborativo, Claude planejou, Codex criou `soma.js`, Claude revisou e aprovou em 46 s**, com plano, etapas e arquivos na tela. Decisões e achados:
- **Agente de teste sem código de teste no app**: em vez de um adaptador injetado, `NB_CLAUDE_CLI` / `NB_CODEX_CLI` apontam para outro executável (caminho absoluto existente, ou JSON `[exe, ...args]`; qualquer outra coisa é ignorada). O E2E usa `tests/e2e/fake-agent.mjs`, que fala os formatos reais (`stream-json`, `exec --json`, `--json-schema`), então adaptadores, parsers, runner, motor, IPC e telas rodam sem alteração. Um teste confere que o build não contém o agente falso.
- **Ao vivo sem duplicar estado**: o processo principal só avisa "a tarefa X mudou" (`tasks:changed`); as telas releem do banco, agrupando rajadas (150 ms). Eventos de depuração (`raw`, `done`, `session`, `usage`, `result`) ficam no banco, fora da tela e do IPC.
- **Aprovação só pela tela**: o IPC de início recusa `approved`; tarefas destrutivas sempre param em "Aguardando aprovação" até o clique.
- **Conversas** = cadeia de continuações (`parentTaskId`); continuar reaproveita projeto, modo e a sessão de cada agente. Execuções: lista com filtros (situação, projeto, agente, texto), detalhe com tokens/custo informados e "Continuar no chat". Dashboard mostra as tarefas recentes.
- Pedido misto ("explique e conserte") sem projeto falha com "Para alterar arquivos, escolha um projeto." — comportamento correto do roteador, coberto no E2E da aprovação com um pedido só de leitura.
- Totais: 307 testes unitários, 26 E2E (+4 reais pulados sem a flag), integração 5 (+14 pulados).

### Fase 13 — Aprendizado controlado, backup e retenção

`LearningExtractor` (A9), detector de segredos (padrões conhecidos + entropia), fila de aprovação na UI, modos manual/confirmação/categorias; backup automático (`VACUUM INTO` agendado + retenção), restauração, export JSON e Markdown, exclusão definitiva; Brain Settings.
**Testes:** segredo no aprendizado é bloqueado; duplicata vira merge sugerido; backup → apagar banco → restaurar → contagens e links idênticos; export/import ida e volta.
**Aceite:** critérios 10 e 11 do Neural Brain.

**Implementação parcial (2026-10-29):** serviços reais, IPC, hooks, fila de aprendizados, configurações do Brain, backups, restauração, retenção, exportação/importação e telas foram encontrados e preservados. As rotas `/memory/learning` e `/memory/settings` foram conectadas ao BrainLayout; aprovação e descarte de propostas exigem o fluxo previsto, e a aplicação de retenção agora também exige confirmação destrutiva. Foi criado `tests/e2e/phase13.spec.ts` cobrindo aprendizado, persistência de configurações, backup/restauração e retenção com banco temporário isolado.

**Validação executada:** testes direcionados passaram (4 arquivos, 26 testes); build passou; `git diff --check` passou. No PowerShell Windows, `npm run test:e2e -- tests/e2e/phase13.spec.ts` executou os 3 testes novos com **3 aprovados**: aprendizado (aprovação e descarte com confirmação), configurações/retensão (persistência e confirmação destrutiva) e backup/restauração (banco temporário isolado, verificação direta do banco após restauração). A suíte E2E anterior reportou 26 aprovados e 4 ignorados; somada ao spec da Fase 13, a cobertura comprovada é de 29 aprovados e 4 ignorados, em execuções separadas. O lint geral ainda reporta 4 erros fora do fluxo funcional desta fase (regra `react-hooks/set-state-in-effect` em `BrainSettingsPage.tsx`, dois `no-explicit-any` em `packages/brain/src/rag-engine.ts` e import `spawn` não usado em `tests/integration/rag-mcp-process.test.ts`); isso permanece como dívida de qualidade registrada, não como falha dos critérios funcionais da Fase 13.

**Status: concluída funcionalmente.** Os critérios da Fase 13 estão comprovados por testes unitários, build e E2E local com Electron funcional. A correção de qualidade posterior também deixou `npm run lint` limpo.

### Fase 14 — Token Optimizer [sub-plano]

`ContextBuilder`/`brain_context`: palavras-chave → busca híbrida → top-K → dedupe → compressão estruturada (objetivo, restrições, arquivos, aceite, decisões, erros) → corte por orçamento (estimador `chars/4` rotulado "estimado") → `memoryRefs`. Dedupe entre etapas da mesma tarefa (hash do contexto já enviado). Analytics: tokens reportados × estimados por agente/tarefa; custo conforme R6; comparação individual × colaborativa só com amostras reais.
**Testes:** orçamento nunca excedido; memórias irrelevantes não entram; mesmas refs não reenviadas na etapa 2; métrica sem dado → "Indisponível".
**Aceite:** critério 9 do Neural Brain; Analytics só com dados do banco.

  **Implementação concluída (2026-10-29):** o contrato de contexto limitado foi integrado ao fluxo real do `TaskEngine` através do `HybridSearch` existente. `buildMemoryContext` adapta resultados de memória para referências verificáveis (`memory://<id>`), deduplica por referência e aplica o orçamento estimado `chars/4`; o engine registra referências e tokens estimados no evento `rag_context`, e o contexto é delimitado como dado não confiável. A migração `0006_token_analytics` persiste, separadamente, tokens estimados de contexto e uso reportado por provedor/agente/etapa; `tokenAnalyticsForTask` lê somente esses dados persistidos, preservando `null` para custo não reportado. Testes direcionados do Brain, Database e Orchestrator passaram (33 testes nesta validação); lint, typecheck e `git diff --check` passaram.

  **Status: concluída.** O critério 9 do Neural Brain está coberto por orçamento, deduplicação, referências e persistência separada de estimativas versus métricas reais. Custos não são inferidos quando o provedor não informa valor. Próxima fase prevista: Fase 15 — Skills Manager e Agentes.

### Fase 15 — Skills Manager e Agentes

Varredura de `~/.claude/skills`, plugins Claude, `~/.codex/skills`, `~/.agents/skills`; visualizar SKILL.md (renderizado como dado, sem executar), conflitos (mesmo nome em locais diferentes), compatibilidade (frontmatter válido), associação skill ↔ tipo de tarefa (usada pelo Router), instalação/atualização via allowlist (A11). Página Agentes com status e preferências.
**Testes:** fixtures de diretórios de skills; SKILL.md com frontmatter inválido sinalizado; instalação exige aprovação e não executa scripts.
**Aceite:** skills instaladas listadas corretamente nesta máquina.

**Implementação em andamento (2026-10-29):** criado o núcleo real de descoberta e validação em `packages/workspace/src/skills.ts`, com varredura dos diretórios Claude/Codex/Agents/plugins, leitura de `SKILL.md` somente como dado, validação de frontmatter, conflitos por nome, detecção de scripts sem execução, rejeição de caminhos fora da raiz permitida e instalação condicionada a aprovação explícita. A listagem foi integrada ao IPC validado por schema e à página Skills; a página exibe estados de carregamento/erro/vazio, conflitos e scripts detectados. Testes de segurança/fixtures: 4 testes da skill manager; conjunto relevante (skills, adapters e navegação): 3 arquivos, 22 testes aprovados. Lint, typecheck, build e `git diff --check` passaram.

**Continuação (2026-10-29):** adicionada validação de origem remota HTTPS por allowlist de host, seleção de skills por tipo de tarefa/agente no Router, persistência atômica de `SkillSettings` e teste E2E isolado da página Skills. Testes adicionais de origem, persistência, preferências e Router foram criados; nesta validação, 40 testes passaram.

**Continuação (2026-10-29):** `SkillSettings` foi incorporado às preferências reais do aplicativo com gravação atômica, canais IPC `skills:settings`/`skills:settings:save` validados por schema e controle de habilitação na página Skills. Persistência e recuperação foram testadas após reabertura do arquivo de preferências. Lint, typecheck e `git diff --check` passaram.

**Integração real (2026-10-29):** a criação do `TaskEngine` agora carrega as preferências persistidas, passa associações ao Router, lê somente skills válidas e habilitadas, limita o conteúdo pelo orçamento restante após o RAG, delimita o conteúdo como não confiável e registra `skills_context` com referências `skill://...` e tokens estimados. Build, lint e typecheck passaram.
**Interface concluída (2026-10-29):** a página Skills agora edita habilitação, agentes associados, tipos de tarefa e hosts HTTPS autorizados, salvando pelo IPC validado e recuperando as alterações das preferências.
**Testes adicionais (2026-10-29):** adicionada integração do `TaskEngine` que comprova seleção por agente/tipo, exclusão de skill desabilitada, inclusão no prompt e auditoria `skills_context`. Também foi criado o núcleo de download HTTPS de um manifesto isolado, com aprovação, allowlist, redirect manual, timeout/tamanho e staging atômico.
**Suporte de repositório (2026-10-29):** adicionado `installRemoteSkillRepository`, que usa clone Git raso sem submódulos, staging temporário, validação de manifesto, limites por arquivo/quantidade, rejeição de symlinks e troca com backup/rollback. O transporte ainda não está exposto por IPC/UI.
**Fechamento de integração (2026-10-29):** os canais IPC `skills:install`/`skills:update` foram adicionados com schema estrito, revalidação da allowlist no processo principal e destino isolado em `managed-skills`; a página Skills exibe confirmação, estado ocupado e feedback de sucesso/erro. Lint, typecheck, build, teste unitário remoto e E2E da página passaram.
**E2E remoto parcial (2026-10-29):** criado `tests/e2e/skills-remote.spec.ts`; rejeição de host não allowlisted e cancelamento antes da operação passaram (**2/2**). O teste inicialmente solicitado apontava para um arquivo inexistente; o spec agora existe e o comando reproduzível funciona.
**Validação final bloqueada (2026-10-29):** Git está disponível (`git version 2.54.0.windows.1`), mas não há `openssl` nem certificado CA confiável/servidor HTTPS-Git controlado no ambiente. Não foi possível publicar uma fonte HTTPS válida sem instalar certificado, usar bypass TLS ou depender de repositório externo; nenhuma dessas alternativas foi usada. Os fluxos reais de instalação, atualização e rollback permanecem não comprovados.
**Fixture HTTPS controlada (2026-10-29):** adicionada dependência de desenvolvimento `selfsigned` e `tests/integration/skills-https.test.ts`, que gera CA/certificado apenas em diretório temporário, publica um repositório Git descartável por HTTPS local, configura `http.sslBackend=openssl`/`http.sslCAInfo` somente no processo Git, instala v1, atualiza para v2 e confirma que uma falha posterior preserva v2. Resultado: **1/1 integração HTTPS aprovada**. E2E remoto de rejeição/cancelamento: **2/2 aprovados**. Lint, typecheck, build e `git diff --check` passaram.

**Validação E2E final (2026-10-29):** o Playwright iniciou Electron com `NB_DATA_DIR` temporário e `GIT_SSL_CAINFO`/configuração Git por processo apontando para a CA temporária; instalação real v1, atualização v2, falha controlada, preservação da versão anterior e ausência de diretórios parciais passaram. Resultado: `tests/e2e/skills-remote.spec.ts` **3/3**; lint, typecheck, build e `git diff --check` passaram. A fixture e os diretórios de teste foram encerrados/removidos, sem alteração de certificados globais ou skills pessoais.

**Status: concluída.** A validação cobriu instalação, atualização e rollback pela interface Electron com HTTPS/Git controlado, aprovação explícita, isolamento de dados e confiança TLS restrita ao processo de teste. E2E UI remoto: **3/3**; integração HTTPS direta: **1/1**; lint/typecheck/build/diff-check passaram.

**Pendências:** nenhuma dentro dos critérios de aceite da Fase 15. Próxima fase: Fase 16 — Qualidade e segurança.
**Integração adicional:** o `TaskEngine` agora aceita preferências de skills e um provedor de conteúdo limitado, adiciona o conteúdo selecionado ao prompt com delimitação explícita de não confiável e registra o evento `skills_context` com identificadores e tokens estimados. Nota de 2026-10-29: superado pela "Integração real" acima; o app passa as preferências e o provedor de conteúdo ao motor em `apps/desktop/src/main/index.ts`.

### Fase 16 — Qualidade e segurança

Auditoria IPC (todo canal com schema), CSP, navegação, logs sem segredo (teste que procura tokens nos logs após execução real), acessibilidade (teclado, foco, contraste — axe no Playwright), atalhos de teclado, estados de erro/carregamento, Review Focus 1–5 revisados.
**Aceite:** suíte completa verde; lista de pendências honesta em `docs/STATUS.md`.

**Status: concluída (2026-10-29).** A auditoria confirmou validação uniforme de IPC e remetentes confiáveis, isolamento Electron, CSP restritiva, bloqueio de navegação externa e conteúdo não confiável delimitado. Os fluxos E2E cobrem estados de carregamento/erro/vazio, confirmação destrutiva, persistência, foco e navegação por teclado; a correção desta fase removeu um remount que apagava o feedback de salvamento das configurações. Suíte unitária: **356/356**. E2E: **37 testes, 32 aprovados, 4 ignorados por integrações externas, 1 teste inicialmente corrigido e aprovado isoladamente**; build, lint, typecheck e `git diff --check` foram executados. Evidências e limitações estão em `docs/STATUS.md`.

### Fase 17 — Distribuição Windows

electron-builder NSIS x64, ícone, nome e versão, `asarUnpack` para módulos nativos, script MCP e modelo (se A6 = empacotado); garantir no pacote as dependências que o bundle `mcp-server.js` ainda carrega por `require` (`zod`, `better-sqlite3`, subcaminhos de `ajv`/`ajv-formats` vindos do SDK MCP) e a pasta `migrations`; dados em `%APPDATA%` preservados entre reinstalações; logs locais; reparo do registro MCP após update; README de instalação e conexão MCP.
**Testes:** instalar em pasta limpa → abrir sem terminal → MCP registrado responde em Claude e Codex → desinstalar/reinstalar mantém memórias.
**Aceite:** todos os critérios da seção 18 da spec e da seção 10 do Neural Brain marcados com evidência; pendências dependentes de autenticação/serviço externo listadas.

**Implementação parcial (2026-10-29):** adicionados `electron-builder`, configuração NSIS x64, ícone reproduzível, `asarUnpack` para `better-sqlite3`/MCP, bundle de migrations e comando `npm run dist:win`. O instalador `dist/NeuralBridge-Setup-0.1.0-x64.exe` foi gerado; o executável empacotado abriu no smoke test sem terminal. Unitários: **356/356**; integração: **8 aprovados, 14 ignorados**; E2E: **33 aprovados, 4 ignorados**; lint, typecheck, build e `git diff --check` passaram. Evidências e pendências estão em `docs/STATUS.md` e instruções em `docs/DISTRIBUTION.md`.

**Status:** CONCLUÍDA por decisão do usuário em 2026-11-02. O instalador NSIS foi gerado e instalado pelo usuário, e a versão empacotada abriu no Windows. A validação formal em máquina/pasta limpa, registro MCP real em Claude/Codex e reinstalação com preservação de memórias continuam como ressalvas de homologação, não como bloqueio da entrega atual.

**Validação final preparada (2026-10-29):** criado `docs/DISTRIBUTION-CHECKLIST.md` com comandos PowerShell para VM/conta de teste e `npm run verify:dist`, que passou verificando o instalador, ICO, bundle MCP, migrations e módulo nativo sem tocar em dados pessoais. A fase permanece pendente até evidência manual de instalação/desinstalação, ícones visuais, MCP real e persistência entre reinstalações.

### Fase 18 — Redesign da Interface Chat (Codex-like UX) [sub-plano]

**Status: CONCLUÍDA em 2026-10-29, incluindo o complemento 18.8; validada com Claude Code e Codex reais.** Esta fase documenta exclusivamente o redesign da experiência de Chat, preservando a identidade visual do NeuralBridge e todas as integrações existentes. O objetivo é substituir o formulário antigo por uma experiência contínua de conversação com sidebar principal recolhível, histórico secundário recolhível, área central de mensagens e composer fixo no rodapé.

**Escopo fechado:**

- 18.1 — Estrutura de layout e sidebars: sidebar principal recolhível e persistente, histórico pesquisável, agrupamento temporal, conversa ativa, renomeação, exclusão confirmada e rolagem independente.
- 18.2 — Composer fixo e seletores compactos: textarea expansível, Enter/Shift+Enter, envio, carregamento/interrupção, projeto, agente e modelo/versão somente quando suportado.
- 18.3 — Histórico e gerenciamento de conversas: novas conversas, reabertura, persistência, pesquisa e estado vazio sem o formulário antigo.
- 18.4 — Mensagens, execução e estados: mensagens cronológicas, atividades do TaskEngine, estados de execução, erros, auto-scroll inteligente e continuidade.
- 18.5 — Integração de modelos/agentes: preservar roteamento automático, Claude Code, Codex CLI, modo colaborativo, Brain, RAG, eventos e persistência reais.
- 18.6 — Responsividade e refinamento visual: tema escuro, acessibilidade, teclado, transições, diferentes resoluções Electron e ausência de sobreposição/rolagem horizontal.
- 18.7 — Testes e validação final: testes relevantes da interface e integrações, lint, typecheck, build e `git diff --check`.
- 18.8 — Painel lateral direito de contexto, skills e execução (complemento, **concluído**): quarta coluna recolhível e independente (drawer em janelas pequenas) com as seções Ambiente, Contexto, Conectores, Skills, Saídas, Alterações e Tarefas em segundo plano, todas a partir de dados reais (TaskEngine, adaptadores, gerenciamento MCP, Skills Manager, projetos, Git e preferências existentes). A seção Skills diferencia Disponível, Carregada, Utilizada, Falha e Indisponível, exige evidência estruturada para "Utilizada" e registra o histórico como eventos de tarefa. Levantamento das lacunas de telemetria de cada CLI, 11 tarefas (18.8.1–18.8.11) e critérios próprios no sub-plano.

**Critérios de aceite:**

1. Sidebar principal recolhível e persistente, com navegação funcional e tooltips no modo recolhido.
2. Histórico secundário recolhível, pesquisável, agrupado, persistente e funcional.
3. Composer fixo no rodapé, sem formulário no topo e sem ocultar mensagens.
4. Seletores reais de projeto, agente e modelo/versão suportado integrados ao composer.
5. Histórico persistente e pesquisável, incluindo renomeação, exclusão confirmada e reabertura.
6. Mensagens, atividades e estados de execução corretos, com auto-scroll inteligente.
7. Estado vazio centralizado com “Em que vamos trabalhar?” e composer no rodapé.
8. Layout responsivo em diferentes resoluções do Electron, sem sobreposição.
9. TaskEngine, roteamento, histórico, projetos, Claude Code, Codex CLI, modo colaborativo, Brain, RAG e eventos preservados por integrações reais.
10. Testes relevantes, lint, typecheck, build e `git diff --check` aprovados.
11. Complemento 18.8: painel direito independente e persistido; ambiente, branch, contexto, conectores, saídas, alterações e tarefas reais; seção Skills integrada ao Skills Manager, distinguindo skills disponíveis das efetivamente utilizadas, com evidência, agente, execução e histórico, e limitações de telemetria tratadas sem inventar dados; Chat utilizável com as três barras abertas em diferentes tamanhos de janela (detalhe no sub-plano).

A fase só poderá ser marcada como concluída após validação real de todos os critérios. A implementação futura deve inspecionar o estado existente, seguir TDD quando aplicável, evitar mocks em produção, validar a interface real do Electron e registrar evidências comprovadas. Melhorias fora deste escopo não fazem parte da fase.

**Resultados registrados em 2026-10-29** (commit `d08ad78`, feito a pedido do usuário):

- `npm run typecheck`: aprovado. `npx eslint .`: aprovado. `git diff --check`: aprovado.
- `npx vitest run`: 42 arquivos, 367 testes aprovados (novos: `apps/desktop/test/chat-model.test.ts`, conversas em `apps/desktop/test/tasks.test.ts`, modelo em `packages/orchestrator/test/engine.test.ts`, contrato em `packages/shared/test/ipc.test.ts`).
- `npm run test:e2e` (inclui build): 39 aprovados, 4 ignorados (dependem de CLIs reais autenticadas). Novo `tests/e2e/chat-layout.spec.ts`: sidebars recolhíveis persistidas após reinício e tooltips; estado vazio e composer no rodapé; Enter/Shift+Enter; parar tarefa; modelo opcional; renomear, pesquisar, reabrir e excluir com confirmação; layout em 960×600, 1280×820 e 1920×1080 sem rolagem horizontal nem sobreposição.
- `npm run test:integration`: 8 aprovados, 14 ignorados (CLIs reais/instalação externa).
- Dois E2E de `shell.spec.ts` já falhavam no HEAD `72d9595` (versão 0.1.1 e texto "Fase 14" removidos em `12d2558`); foram alinhados ao produto atual sem afrouxar o que verificam (versão lida do `package.json` do app; resumo honesto do Analytics).

**Decisões:**

- Título e modelo da conversa são colunas novas de `tasks` (migração `0007_conversation_title_model`, só `ALTER TABLE`), sem armazenamento paralelo; excluir uma conversa apaga suas tarefas, com etapas, eventos e registros de tokens por cascata, e é recusado enquanto houver tarefa ativa.
- Modelo: os CLIs não listam modelos, então nada é inventado. O campo é opcional, só para agente explícito (Claude Code ou Codex CLI), validado (`^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$`, nunca uma opção de CLI) e sugere apenas modelos relatados pelos CLIs em sessões anteriores ou pedidos antes. A conversa mantém o modelo ao continuar. Nos modos automático e colaborativo, cada CLI usa o modelo configurado e a interface informa isso.
- Preferências de layout (menu e histórico recolhidos) ficam no armazenamento local da janela, com fallback seguro quando indisponível.

**Pendente para concluir:** critério 9 com CLIs reais. O subplano proíbe executar o Claude Code durante esta implementação; a preservação das integrações foi validada pelo agente falso que fala os formatos reais (`tests/e2e/fake-agent.mjs`) e pelos testes do motor, mas `NB_REAL_CLI=1 npx playwright test tests/e2e/chat-real.spec.ts` (já adaptado ao novo composer) ainda precisa ser executado por você.

**Validação com CLIs reais em 2026-10-29** (a pedido do usuário, com as sessões dele, sem gravar configuração dos CLIs):

- `NB_REAL_CLI=1 npx playwright test tests/e2e/chat-real.spec.ts`: **aprovado**. A tarefa colaborativa digitada no Chat foi planejada, implementada, revisada e concluída com `soma.js`, usando Claude Code 2.1.312 e Codex 0.162.1 reais. O critério 9 está comprovado.
- Checagem temporária do painel (spec descartado depois):
  - Uma pergunta real ao Claude Code gerou os eventos `capabilities` (servidor `neuralbridge` "connected" e 59 skills da sessão) e `context` (41.731 tokens numa janela de 1.000.000). Nenhuma skill foi invocada nessa execução, então "Utilizada" não apareceu, como deve ser. O formato da chamada `Skill` segue conferido pela transcrição real.
  - `mcp:servers` com a configuração real revelou um defeito: o Claude Code imprime "✔ Connected" (U+2714) e servidores do claude.ai por URL. Corrigido com teste (`mcp-servers.test.ts`, marcas reais e URL como transporte http).
  - Na checagem seguinte: context7, playwright, neuralbridge e claude.ai Claude Docs "Conectado"; claude.ai Canva "Precisa de login"; no Codex, codex_app "Desativado" e os demais "conexão não verificada".
- Depois da correção: typecheck e lint aprovados, **434** testes unitários, `chat-panel` + `chat-layout` 11/11, `git diff --check` aprovado.

**Complemento 18.8 — resultados registrados em 2026-10-29** (sem commit, conforme AGENTS.md):

- `npm run typecheck` e `npx eslint .`: aprovados. `git diff --check`: aprovado.
- `npx vitest run`: 50 arquivos, **433 testes** aprovados. Novos: `apps/desktop/test/chat-panel-model.test.ts` (estados das skills, contexto, conectores, saídas, contagens Git, tempo decorrido), `apps/desktop/test/outputs.test.ts`, `packages/workspace/test/mcp-servers.test.ts`, e casos em `packages/agents/test/parsers.test.ts` (skill, capacidades e contexto do Claude sobre a fixture real; leitura de SKILL.md e ausência de contexto no Codex), `packages/workspace/test/projects.test.ts` (`gitLineStats`), `apps/desktop/test/mcp.test.ts` (`servers`) e `packages/shared/test/ipc.test.ts` (contratos novos).
- `npm run test:e2e` (com build): **55 aprovados, 4 ignorados** (CLIs reais) e 1 falha em `brain3d.spec.ts` › "rotate, zoom, pan, keyboard and reset" (Fase 19, ver abaixo). Depois do último ajuste, `chat-panel`, `chat-layout`, `chat` e `brain3d` rodaram de novo: **26/26**. O novo `tests/e2e/chat-panel.spec.ts` (5 testes) cobre:
  - painel e seções persistidos após reinício e redimensionamento por teclado;
  - skill do Claude Utilizada e Falha, com agente, execução, evidência e contexto 130/200.000;
  - servidores MCP dos dois CLIs, sem segredos, e envio de mensagens com as três barras abertas;
  - Codex em projeto Git: skill Carregada, contexto Indisponível, saída `nota.txt`, contagens iguais ao `git status` e recusas de caminho fora do projeto e de `.cmd`;
  - tarefas em segundo plano com cancelamento, e o drawer em 960×600.
- **Teste instável preexistente (Fase 19, não alterado):** a volta do "Centralizar" no teste de câmera do cérebro 3D falha de forma intermitente, com diferença ≈0,21 contra o limite ≈0,12. Nas mesmas condições, o commit `06b98ef` (sem esta fase, numa worktree temporária já removida) falhou 1 de 3, e a árvore atual também 1 de 3. Fica como pendência da Fase 19.
- `npm run test:integration`: 8 aprovados, 14 ignorados.

**Decisões do 18.8:**

- **Formatos reais:**
  - Contexto do Claude: `usage.iterations` (última chamada) e `modelUsage[modelo].contextWindow`, da fixture real `claude-text.jsonl` (2.1.312).
  - Chamada de skill: `tool_use` `Skill` com `input.skill`, e `tool_result` "Launching skill: …", conferida numa transcrição real.
  - `codex mcp list --json`: conferido numa execução real (0.162.1), imprimindo só a estrutura das chaves.
  - Texto de `claude mcp list`: não conferido, porque o sub-plano proíbe executar o Claude Code. O parser ignora linhas desconhecidas e marca estados não reconhecidos como desconhecidos.
- **Eventos:** `skill` (`loaded|used|failed` com evidência), `context` e `capabilities` (servidores MCP e skills do `system/init`) são `AgentEvent`s gravados pelo TaskEngine como os demais, com a mesma redação de segredos. O `session` continua oculto, e o TaskCard ignora esses tipos (são do painel). Não houve tabela, IPC agregado nem índice novos: o histórico sai do `tasks:thread`, que já lê por `task_id`.
- **Estados das skills** (texto da resposta e um `Read` do Claude, registrado na chamada e não no sucesso, nunca promovem estado):
  - Utilizada: só com uma chamada `Skill` concluída sem erro;
  - Falha: chamada com erro;
  - Carregada: leitura bem-sucedida de `SKILL.md` pelo Codex, ou injeção pelo NeuralBridge (`skills_context`);
  - Disponível: skills oferecidas pela sessão do Claude;
  - Indisponível: skills instaladas do Codex, cujo uso o CLI não informa.
- **Segurança:**
  - `mcp:servers` devolve só nome, transporte, estado e detalhe. Comando, argumentos, URL e ambiente são descartados no parser, e um campo extra é rejeitado pelo esquema estrito.
  - `tasks:output-file` só aceita caminhos dentro do projeto da tarefa e existentes. Tipos que o Windows executaria só são revelados na pasta, nunca abertos (`canOpenOutput`).
- **Layout:** abaixo de 1440 px o painel vira drawer. Com menu, histórico e painel lado a lado a 1280 px, o Chat ficava com cerca de 430 px. O drawer começa fechado nessa largura, sem afetar a preferência da janela larga.
- **Conectores sob demanda:** a seção começa recolhida porque `claude mcp list` inicia cada servidor para checar a conexão. O resultado fica 5 minutos em cache, e há o botão "Verificar".

**Observação fora do escopo:** o roteador da Fase 11 classifica um acompanhamento curto sem palavras-chave (ex.: "E quando ele pede aprovação?") como tarefa trivial com edição; sem projeto, o motor recusa ("Para alterar arquivos, escolha um projeto."). Comportamento preexistente, não alterado nesta fase. **Corrigido em 2026-10-29** a pedido do usuário (`packages/orchestrator/src/router.ts`). Um pedido sem nada a criar ou alterar, e que não seja de planejamento ou arquitetura, passa a ser pergunta (somente leitura) quando tem verbo de análise ou pergunta algo: termina em "?" ou começa com palavra interrogativa ("o que", "qual", "e quando", "why"…). Exemplos: "Explique esta tela", "O que tem de errado nesta imagem?" e "E quando ele pede aprovação?". Pedidos de fazer algo na interface continuam como edição: "Crie uma tela igual a esta imagem" e "Pode corrigir o botão desta tela?". Testes em `packages/orchestrator/test/router.test.ts`. Verificação: typecheck, lint, 471 unitários, E2E 62 (+4 ignorados) e `git diff --check` aprovados.

### Fase 19 — Neural Brain 3D Interativo, Visualização de Memórias e Atividade Neural Animada [sub-plano]

**Status: concluída em 2026-10-29** (critérios 2 e 3 aprovados pelo usuário); resta só a checagem no app instalado. Sub-plano completo em [plans/phase-19-neural-brain-3d.md](plans/phase-19-neural-brain-3d.md). Acrescenta à página Memória um cérebro tridimensional de partículas luminosas (azul, ciano, branco e violeta) sobre fundo escuro, com conexões neurais e impulsos elétricos contínuos, ligado ao conhecimento real: memórias como nós selecionáveis, relações persistidas e de similaridade rastreáveis, e recuperações reais de Claude Code e Codex acendendo os nós correspondentes. O grafo 2D da Fase 9 permanece como alternativa acessível.

**Escopo fechado (entregas):**

- 19.1 — Infraestrutura 3D: three.js, React Three Fiber, Drei e bloom em pedaço carregado sob demanda; detecção e perda de WebGL com alternativa 2D; descarte de recursos; pausa quando oculto; compatibilidade com a CSP e o app empacotado.
- 19.2 — Modelo cerebral e partículas: nuvem de pontos pré-processada de malha com licença confirmada (plano B procedural registrado como desvio), regiões anatômicas, paleta e profundidade.
- 19.3 — Rede neural visual: conexões decorativas por região, separadas das relações reais e não clicáveis.
- 19.4 — Impulsos animados (prioridade visual): simulador puro e determinístico de nascimento, percurso pelas arestas, ramificação, ativação e dissipação; atividade ambiente discreta rotulada como ilustrativa.
- 19.5 — Câmera: órbita 360°, zoom com limites, deslocamento, reset, foco animado, rotação automática que pausa na interação, atalhos de teclado.
- 19.6 — Memórias reais: nós em `InstancedMesh` com posição estável por projeto/tipo/id, seleção, busca, filtros, painel de detalhes e atualização após mudanças.
- 19.7 — Conexões semânticas: links persistidos e similaridade calculada por embeddings (distintas, desligável, top-k e limiar), destaque da seleção e limite por nível de detalhe.
- 19.8 — Atividade real: `rag_context` das tarefas e `access_log` (inclusive clientes MCP externos) acendem só as memórias envolvidas, com painel de atividade.
- 19.9 — Interface: controles, filtros, contadores, alternância 3D/2D, estados de carregamento, vazio, erro e WebGL indisponível.
- 19.10 — Desempenho e acessibilidade: níveis de qualidade e intensidade, movimento reduzido, alternativa acessível, metas medidas de fps e vazamento.
- 19.11 — Validação final: unitários, integração, E2E, lint, typecheck, build, `dist:win`, `verify:dist` estendido, `git diff --check` e verificação no app instalado.

**Mudanças mínimas previstas fora do renderer (aditivas, com schema estrito):** `brain:graph3d` (memórias e links para a cena), `brain:similarity` (arestas calculadas ou indisponibilidade com motivo) e `brain:activity { since }` (leitura de `access_log`, consultada só com a página visível, porque o MCP externo não avisa o app). Sem tabelas novas; índice em `access_log(at)` só se a medição pedir.

**Critérios de aceite (23, cada um com evidência registrada):**

1. Cérebro realmente tridimensional.
2. Aparência alinhada à imagem de referência (a imagem precisa ser salva em `docs/assets/phase-19-reference.png`).
3. Geometria cerebral reconhecível, com origem e licença do modelo registradas.
4. Partículas e conexões luminosas tridimensionais.
5. Impulsos luminosos contínuos.
6. Impulsos percorrendo conexões visíveis.
7. Sinais simultâneos em direções diferentes.
8. Propagação e ramificação dos impulsos.
9. Ativação e dissipação dos nós.
10. Rotação, zoom, deslocamento e reset funcionando.
11. Nós interativos representando memórias reais.
12. Seleção com informações corretas.
13. Conexões semânticas justificáveis e rastreáveis.
14. Recuperações RAG reais destacando as memórias correspondentes.
15. Atividade ambiente distinguível da real.
16. Animações fluidas durante a navegação.
17. Controle da intensidade dos efeitos pelo usuário.
18. Preferência de movimento reduzido respeitada.
19. Visualização atual (grafo 2D) acessível.
20. Desempenho e estados de erro tratados.
21. Funcionamento no Electron empacotado.
22. Integrações existentes funcionais.
23. Testes e verificações de qualidade aprovados.

**Dependências técnicas:** Fases 3, 6, 7.5, 9, 14 e 18; novas dependências `three`, `@react-three/fiber` (linha compatível com React 19), `@react-three/drei` e pós-processamento de bloom, fixadas na implementação; modelo cerebral com licença confirmada; imagem de referência fornecida pelo usuário.

**Riscos principais:** licença do modelo, CSP bloqueando carregadores (`blob:`, WASM, workers), GPU fraca ou renderização por software, E2E com WebGL instável, poucas memórias reais, similaridade indisponível sem busca semântica, atraso na atividade de clientes MCP externos, tamanho do bundle e vazamento de recursos WebGL. Mitigações no sub-plano.

A fase só poderá ser marcada como concluída após evidência real de todos os critérios; itens que dependem do usuário (referência visual, aprovação estética, licença) permanecem pendentes até essa evidência existir.

**Resultados registrados em 2026-10-29** (sem commit, conforme AGENTS.md):

- **Verificações:** `npm run typecheck`, `npx eslint .` e `git diff --check` aprovados. `npx vitest run`: 47 arquivos, **398 testes** aprovados (novos: `apps/desktop/test/brain3d-anatomy|impulses|model|ipc.test.ts`, 31 testes). `npm run test:e2e` (com build): **50 aprovados**, 4 ignorados (CLIs reais); depois do ajuste final de cores, `tests/e2e/brain3d.spec.ts` rodou de novo: **9/9**. `npm run test:integration`: 8 aprovados, 14 ignorados. `npm run dist:win` e `npm run verify:dist` (estendido para exigir o pedaço `BrainCanvas` no pacote) aprovados; `tests/e2e/brain3d-packaged.spec.ts` abriu o **executável empacotado** (`dist/win-unpacked`, dados isolados) e renderizou a cena sob a CSP de produção sem erros no console: **1/1**.
- **Desempenho** (`tests/e2e/brain3d-perf.spec.ts`, 1280×820, 200 memórias, rotação e impulsos ativos, mediana de 10 amostras): GPU NVIDIA RTX 4060 Ti (ANGLE/D3D11) — Baixa, Média e Alta a **60 fps** (limite do vsync); renderização por software (SwiftShader, sem GPU) — Baixa **74**, Média **69**, Alta **63** fps. 5.000 memórias: cena continua animando e a busca responde (E2E).
- **Evidências visuais:** `docs/assets/phase-19-reference.png` (sua imagem), `docs/assets/phase-19-comparison.png` (referência × app, mesma vista sagital), `docs/assets/phase-19-app-side|front|top|page.png`.

**Critérios (23):** 1, 4–21 e 22–23 com evidência (ver o checklist do sub-plano). **2 e 3 aprovados pelo usuário em 2026-10-29:** a aparência (critério 2), sobre `docs/assets/phase-19-comparison.png`; o cérebro procedural (critério 3), plano B do sub-plano aceito no lugar do modelo com licença externa.

**Decisões e desvios:**

- **Cérebro procedural** (`features/brain3d/anatomy.ts`): hemisférios com sulcos, fissura longitudinal, lobos temporais, cerebelo e tronco, por funções de distância com sinal. Nenhum ativo de terceiros (não baixei modelo externo sem autorização). Amostragem uniforme da superfície, determinística, gerada em fatias para não travar a janela, sem worker (evita depender da CSP).
- **Sem Drei e sem pós-processamento:** os controles de órbita vêm de `three/examples`; o brilho vem de pontos com mistura aditiva que preserva o alfa do canvas (a mistura aditiva padrão apagava o fundo). Drei traria dependências com acesso à rede (`detect-gpu`). Licenças em `docs/THIRD-PARTY.md`.
- **Arquitetura:** toda a lógica three.js fica em `scene-runtime.ts` (classe fora do React, exigida pelas regras do React Compiler); o simulador de impulsos (`impulses.ts`) é puro e testado sem WebGL; o pedaço 3D é carregado só ao abrir a aba "Cérebro 3D".
- **Seleção por proximidade na tela** (raio de 12 px em vez de raycasting), para nós pequenos continuarem fáceis de clicar; arrastar não seleciona.
- **Atividade real:** `rag_context` das tarefas (ao vivo por `tasks:changed`) e `access_log` de clientes `mcp:*` (consultado a cada 2 s só com a página visível). As linhas `electron` ficam de fora (são buscas do usuário ou o próprio contexto da tarefa). Não foi preciso índice novo em `access_log`.
- **Sem WebGL:** o Electron ignora `--disable-webgl`; o teste usa `--disable-gpu --disable-software-rasterizer`, que remove o WebGL de verdade.
- O R3F 9.8.2 emite o aviso de depreciação `THREE.Clock` do three 0.186 (interno da biblioteca, sem efeito).

**Pendente:** a checagem no app instalado. O instalador 0.1.1 de 2026-10-29 foi instalado para o usuário (backup do banco em `%APPDATA%\NeuralBridge\backups\pre-install-20261029-091136`); falta abrir o app e conferir a aba "Cérebro 3D".

### Melhoria — Permissões dos agentes por projeto (2026-10-29, fora das fases)

**Status: implementada a pedido do usuário** ("permissão total para não ficar dando erro de permissão em rodar bash"). Antes, os níveis eram fixos no código: o Claude Code tinha só leitura, edição e alguns comandos de teste e build; o Codex rodava na sandbox `workspace-write` sem rede.

**O que existe agora:** um nível por projeto, em Projetos → Configurações → "Permissões dos agentes" (colunas `permission_level` e `allowed_commands`, migração `0008_project_permissions`, só `ALTER TABLE`). O nível vale **só para as etapas que editam arquivos**; análise, planejamento e revisão continuam somente leitura em qualquer nível.

| Nível | Claude Code | Codex |
|---|---|---|
| Padrão (default) | como antes: leitura, edição e os comandos de verificação (`npm test`, `dotnet build`, `git diff`…) | `sandbox_mode="workspace-write"`, sem rede |
| Comandos liberados | + `Bash(<prefixo>:*)` para cada comando da lista do usuário (até 30; só palavras, sem `&&`, `;`, `|`, `$` ou curingas, validado na tela, no IPC e no motor) | + `-c sandbox_workspace_write.network_access=true` |
| Acesso total | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` (no lugar do `sandbox_mode`) |

- As flags foram conferidas no `--help` real do Claude Code 2.1.312 e do Codex 0.162.1, e a chave `sandbox_workspace_write.network_access` no binário do Codex 0.162.1. Nenhuma tarefa real foi executada com acesso total.
- O acesso total só é aplicado depois de uma confirmação, que explica o risco de prompt injection. O Chat avisa abaixo do composer ("Acesso total neste projeto…"), e o painel Ambiente mostra o nível.
- Cada tarefa com nível acima do padrão grava o evento `access` (nível e comandos), para auditoria.

**Resultados registrados em 2026-10-29** (sem commit, conforme AGENTS.md):

- `npm run typecheck`, `npx eslint .` e `git diff --check`: aprovados.
- `npx vitest run`: 50 arquivos, **441 testes** aprovados. Novos casos:
  - `packages/agents/test/adapters.test.ts`: flags por nível; somente leitura nunca recebe bypass;
  - `packages/orchestrator/test/engine.test.ts`: os três níveis, com análise e revisão somente leitura;
  - `apps/desktop/test/projects.test.ts`: padrão e persistência;
  - `packages/shared/test/ipc.test.ts`: níveis e comandos que encadeiam ou ampliam são recusados.
- `npm run test:integration`: 8 aprovados, 14 ignorados.
- Novo `tests/e2e/project-permissions.spec.ts`: **3/3**. Cobre:
  - escolha na página, com recusa de comando inválido, cancelamento da confirmação e persistência após reinício;
  - a linha de comando real recebida pelo agente falso em cada nível, com a análise sem permissões extras;
  - o aviso no Chat e o nível no painel.
- `npm run test:e2e` (com build): **59 aprovados**, 4 ignorados (CLIs reais), nenhuma falha (o teste de câmera instável da Fase 19 passou nesta execução).

### Melhoria — Imagens no Chat (2026-10-29, fora das fases)

**Status: implementada a pedido do usuário** ("não consigo colar imagem no chat, para referências").

**O que existe agora:**

- **Composer:** anexar pelo botão de imagem, colar com Ctrl+V ou arrastar e soltar. Até 6 imagens por mensagem, com miniaturas e botão de remover antes de enviar. O texto continua obrigatório.
- **Histórico:** as imagens aparecem acima da mensagem do usuário; clicar amplia (diálogo acessível, Esc fecha). Continuam lá depois de reiniciar o app.
- **Persistência:** cada mensagem grava suas imagens numa pasta própria em `<dados>/attachments/<uuid>/<n>.<ext>`, fora do projeto (não aparecem no Git). A tarefa guarda `images` (migração `0009_task_images`, só `ALTER TABLE`). Excluir a conversa apaga as imagens dela.
- **Envio aos agentes, em todas as etapas da tarefa** (plano, implementação, revisão e correção):
  - **Claude Code:** `--input-format stream-json` com uma mensagem `user` contendo o texto e cada imagem como bloco `image` base64. Só quando há imagens; sem elas, nada muda.
  - **Codex:** um `--image=<arquivo>` por imagem, em `exec` e em `exec resume`.
  - Uma continuação manda só as imagens dela, não as das mensagens anteriores.
- **Segurança e validação:**
  - Formatos PNG, JPEG, GIF e WebP, reconhecidos pelos primeiros bytes no processo principal (nunca SVG, que pode carregar script). Máximo de 5 MB por imagem (o limite da API do Claude para uma imagem) e 6 por mensagem.
  - O nome escolhido pelo usuário serve só para exibição; o arquivo recebe nome do app.
  - O IPC aceita apenas bytes (`Uint8Array`), nunca caminhos. A leitura de volta só funciona dentro da pasta de anexos e devolve data URL, que a CSP já permitia (`img-src data:`).
  - Uma mensagem com uma imagem inválida é recusada inteira, sem tarefa criada e sem arquivo deixado para trás. A janela avisa antes o que é recusável pelo tipo declarado e pelo tamanho.

**Resultados registrados em 2026-10-29** (sem commit, conforme AGENTS.md):

- **Formato conferido com os CLIs reais antes de implementar:** `claude -p --input-format stream-json` (2.1.312) e `codex exec --image=` (0.162.1) descreveram uma imagem de teste vermelha como "Vermelho".
- **Validação real depois de implementar,** com um spec temporário (removido) usando as sessões do usuário: a mesma imagem anexada pelo app chegou ao Claude Code e ao Codex reais, e os dois responderam "Vermelho" (2/2).
- `npm run typecheck`, `npx eslint .` e `git diff --check`: aprovados.
- `npx vitest run`: 52 arquivos, **458 testes** aprovados. Novos:
  - `apps/desktop/test/attachments.test.ts`: tipo pelos bytes, SVG e executável recusados, nomes, limites, nada sobra ao recusar, leitura e remoção só dentro da pasta;
  - `apps/desktop/test/chat-images.test.ts`: triagem na janela;
  - casos em `packages/agents/test/adapters.test.ts` (linha de comando e stdin de cada CLI), `packages/orchestrator/test/engine.test.ts` (todas as etapas, persistência, continuação), `apps/desktop/test/tasks.test.ts` (armazenar, enviar, ler de volta, recusar, apagar com a conversa) e `packages/shared/test/ipc.test.ts` (bytes, limites, sem caminho na saída).
- `npm run test:e2e` (com build): **62 aprovados**, 4 ignorados (CLIs reais). Novo `tests/e2e/chat-images.spec.ts` (3 testes, estável em 2 repetições):
  - botão, colar, arrastar e remover; o agente falso confirma 3 imagens (png, png, jpeg); histórico, ampliação, persistência após reinício e limpeza ao excluir;
  - Codex com `--image` na execução e na continuação, sem nada novo no projeto;
  - recusas de SVG, da 7ª imagem e de um texto renomeado para .png, e o IPC recusando um caminho.
- `npm run test:integration`: 8 aprovados, 14 ignorados.

**Limitações:**

- **Roteador:** pedidos como "Explique esta tela" ou "O que tem de errado nesta imagem?" eram classificados como edição e, sem projeto, recusados. **Corrigido em 2026-10-29**: agora são perguntas, respondidas em modo somente leitura (ver a observação da Fase 18).
- **Custo:** imagens contam como tokens de entrada em cada etapa da tarefa; no modo colaborativo, cada etapa as recebe de novo.
- **Detalhes de cada CLI:**
  - Não há conversão nem redução de imagens; o limite de 5 MB vale para os dois CLIs.
  - Animações GIF chegam como o CLI as entender.
  - O app não verifica se o modelo escolhido aceita imagens.

---

## 9. Mapa spec → fase

| Spec | Fase |
|---|---|
| 1 Objetivo / fluxo único | 11, 12 |
| 3 Interface (Dashboard, Chat…) | 1, 7, 8, 12, 14 |
| 4 Orquestrador / colaborativo | 11 |
| 5 Adaptadores | 0, 7 |
| 6 Token Optimizer | 14 |
| 7 / Brain §1–3 Memória, busca | 2, 3, 6 |
| Neural RAG Engine | 7.5 |
| 8 / Brain §6 MCP | 4, 5 |
| Brain §4 Grafo | 9, 19 |
| Brain §5 Aprendizado | 13 |
| Brain §8 Páginas do cérebro | 8, 9, 13, 19 |
| 9 Skills | 15 |
| 10 Projetos | 10 |
| 11 / Brain §9 Segurança | 1, 4, 7, 16 |
| 12 Histórico | 11, 12 |
| 13 UI/UX | 1, 8, 9, 16 |
| 15 Testes | todas |
| 16 Empacotamento | 17 |

## 10. Decisões confirmadas pelo usuário (2026-10-28)

1. **A1** — Apenas `brain_*` + `orchestrator_status`/`task_status`; sem aliases `memory_*`.
2. **A3** — Escopo por `--project`/`cwd`, com `global` compartilhado; flag `private` por projeto conforme descrito.
3. **A5** — Acesso direto ao SQLite por processo (WAL); daemon só se R4/R5 se manifestarem.
4. **A6** — `multilingual-e5-small` quantizado, baixado no primeiro uso com consentimento (não empacotado).
5. **Git** — Branch principal `main`; spec mantém o nome `docs/SPEC.MD`.
6. **Permissões (2026-10-29)** — Nível por projeto: padrão restrito; "Comandos liberados" e "Acesso total" só por escolha explícita do usuário, o total com confirmação; somente em etapas de edição.

## Roadmap posterior — novas fases planejadas

As fases abaixo seguem a ordem recomendada. Status: 20, 21, 22, 25, 28 e 26 concluídas em 2026-10-29; as demais seguem em ordem.

| Fase | Funcionalidade | Dependências principais |
|---|---|---|
| 20 | [Memory Confidence](plans/phase-20-memory-confidence.md) | Brain, LearningService, RAG |
| 21 | [Project Intelligence](plans/phase-21-project-intelligence.md) | Projetos, RAG, Memory Confidence |
| 22 | [Token Intelligence](plans/phase-22-token-intelligence.md) | Token Optimizer, eventos reais |
| 23 | [Visual QA](plans/phase-23-visual-qa.md) | Playwright, permissões de projeto |
| 24 | [Agent Swarm](plans/phase-24-agent-swarm.md) | TaskEngine, permissões, tokens, contexto |
| 25 | [Git Intelligence](plans/phase-25-git-intelligence.md) | Memory Confidence, Project Intelligence, Git, RAG |
| 26 | [Auto-Healing Seguro](plans/phase-26-auto-healing.md) | Memory Confidence, Project Intelligence, Token Intelligence, permissões, TaskEngine |
| 27 | [Workflow Builder](plans/phase-27-workflow-builder.md) | TaskEngine, orquestração, permissões, tokens |
| 28 | [Security Guardian](plans/phase-28-security-guardian.md) | Qualidade e segurança, permissões, análise de alterações |
| 29 | [Mission Control](plans/phase-29-mission-control.md) | TaskEngine, estados persistidos, Token Intelligence |
| 30 | [NeuralBridge Video Studio, substituído pelo Velix](plans/phase-30-video-studio.md) | TaskEngine, Skills, permissões, kit MotionVelix instalado pelo usuário, FFmpeg |
| 31 | [Advanced Workflow Orchestration](plans/phase-31-advanced-workflow-orchestration.md) | Workflow Builder (27), Git Intelligence (25), TaskEngine, permissões, RAG, Skills, Auto-Healing (26), Guardian (28) |
| 32 | [Smart Chat Agent Failover & Automatic Recovery](plans/phase-32-smart-chat-agent-failover.md) | Chat, TaskEngine, adaptadores Claude/Codex, persistência de tarefas e IPC |
| 33 | [Hierarquia de Projetos, Workspaces e Detecção Inteligente](plans/phase-33-project-hierarchy-workspaces.md) | Projetos, permissões, Project Intelligence, Git Intelligence, RAG, Chat, TaskEngine |
| 34 | [Velix: projeto Video, narração, temas, pesquisa e prints](plans/phase-34-velix-video-project.md) | Velix, Projetos, TaskEngine, permissões |
| 35 | [Velix: Estúdio e modelo Dossiê](plans/phase-35-velix-studio-dossie.md) | Velix, Fase 34, adaptador Claude |
| 36 | [Velix: AI Video Discovery & Autonomous Production](plans/phase-36-velix-ai-video-discovery.md) | Velix, Fases 34–35, TaskEngine, agentes, pesquisa autorizada, FFmpeg/Remotion, permissões |

**Fase 20 — Memory Confidence: CONCLUÍDA em 2026-10-29.** Iniciada por outra sessão e concluída nesta, sem commit, conforme AGENTS.md.

- **Dados:** a confiança (`unverified/reviewed/stale`, migração `0011`) fica separada de `trust`. As evidências `file/url/task/conversation` vão para `memory_sources`.
- **Revisão:** só o usuário valida, pelo Inspector ou ao aprovar um aprendizado, que é a revisão humana do fluxo; `trust` continua dizendo quem escreveu. Texto alterado volta a `unverified`. Nada que um agente escreve eleva a confiança.
- **Revalidação** (`brain:revalidate`, `apps/desktop/src/main/evidence.ts`): confere as evidências de arquivo dentro da pasta do projeto. Um arquivo que sumiu, ou que mudou depois da memória, a torna `stale`. A checagem nunca promove a confiança, e caminhos fora do projeto não são consultados.
- **RAG e MCP:**
  - na busca híbrida, uma memória `stale` pesa ¼ e aparece com `confidence` nos resultados;
  - no contexto de tarefa, ela chega com o aviso "memória desatualizada: confirme antes de usar";
  - o `brain_store` do MCP aceita `source_ref` (evidência, sem validar), com a mesma checagem de segredos.
- **Interface:** painel "Confiança" no Inspector com estado, evidências, "Marcar como validada", "Marcar como desatualizada" e "Conferir evidências". O Explorer sinaliza memórias validadas ou desatualizadas, e o campo `trust` do editor passou a se chamar "Revisão".
- **Testes:**
  - `packages/brain/test/memory-confidence.test.ts` (5);
  - aprovação de aprendizado em `learning.test.ts`;
  - `apps/desktop/test/evidence.test.ts` (3) e revalidação em `apps/desktop/test/brain.test.ts`;
  - MCP real com `InMemoryTransport` (2);
  - E2E `tests/e2e/memory-confidence.spec.ts` (2), com um agente gravando pelo **servidor MCP real** e a busca MCP vendo `stale`.

**Fase 21 — Project Intelligence: CONCLUÍDA em 2026-10-29** (sem commit).

- **Indexação incremental:** a indexação de arquivos do RAG (`RagEngine.indexProject`, por hash) já existia, mas o app nunca a chamava; agora ela é a base do perfil, sem uma segunda indexação. Ganhou limites: 512 KB por arquivo e 5.000 arquivos. Acima do limite de arquivos, nada é removido do índice e o perfil avisa.
- **Perfil** (`packages/brain/src/project-profile.ts`), reproduzível, isolado por projeto e com cada parte ligada à sua origem:
  - módulos, a partir do índice (`apps/web`, `packages/core`, `src`…), com símbolos;
  - dependências, de `package.json` e `.csproj` (`packages/workspace/src/dependencies.ts`), sem seguir links e sem pastas geradas;
  - decisões e problemas recorrentes (tags repetidas em correções de bug), a partir das memórias do projeto, com a confiança.
- **Persistência:** o snapshot fica em `project_profiles` (migração `0012`), com `changes` dizendo o que mudou desde o anterior.
- **Integração:**
  - **Contexto da tarefa:** o perfil vai como `profile://<id>`, com até ¼ do orçamento, antes das memórias e só nas tarefas daquele projeto.
  - **Atualização automática:** uma tarefa concluída num projeto que já tem perfil o reconstrói por delta, em segundo plano, uma vez por projeto.
  - **MCP:** a ferramenta `project_profile` só lê o perfil do projeto do escopo; o escopo global é recusado.
  - **Tela:** seção "Perfil técnico" na página do projeto (gerar/atualizar, índice, mudanças, módulos, dependências com origem, decisões e problemas com link para as memórias).
- **Migração `0012` escrita à mão:** as migrações `0010`/`0011` tinham sido criadas sem snapshot, e o `drizzle-kit` repetia mudanças já aplicadas. O snapshot `0012` agora reflete o esquema inteiro.
- **Testes:**
  - `project-profile.test.ts` (4), `dependencies.test.ts` (2), limites em `rag-engine.test.ts`;
  - `apps/desktop/test/projects.test.ts` (perfil, delta, execução única);
  - contrato IPC e MCP (2);
  - E2E `tests/e2e/project-profile.spec.ts` (2), com geração, delta, contexto só no projeto certo, atualização após tarefa e MCP real.

**Testes E2E da outra sessão adaptados (sem afrouxar):** os commits v0.1.9/0.1.10 mudaram o Dashboard e o histórico, que agora é agrupado por projeto, sem atualizar os testes.
- Os itens de "Saúde do sistema" viraram uma lista acessível (`aria-label` por integração), e o `agents.spec.ts` lê esse estado ali.
- Os seletores `getByLabel('Projeto')` passaram a usar `exact`, e as contagens de conversas olham só os itens de lista.
- Os testes que cadastram projeto pelo IPC recarregam a página: o Dashboard agora guarda a lista de projetos em cache por 5 s.

**Fase 22 — Token Intelligence: CONCLUÍDA em 2026-10-29** (sem commit).

- **Agregador** `packages/orchestrator/src/token-intelligence.ts`: usa só o que o motor já grava, sem tabela nova.
  - Tokens informados pelo provedor por etapa (`token_analytics`, `provider-result`).
  - Estimativa de contexto do NeuralBridge (`neuralbridge-context`), sempre rotulada como estimativa.
  - Eventos `token_budget`, `context` e `review_rejected`.
  - Quebras por agente, etapa e projeto, contadas por etapa (o Analytics antigo contava a tarefa inteira para cada agente). Taxa de cache. Tarefas sem métrica contadas à parte, nunca preenchidas.
- **Alertas reproduzíveis**, cada um com recomendação e link para as execuções:
  - orçamento ≥ 80% (crítico ao estourar);
  - janela de contexto ≥ 80%;
  - mesmo pedido 3 ou mais vezes no período, indicando laço ou retrabalho;
  - 2 ou mais revisões reprovadas;
  - cache abaixo de 10% com 500 mil tokens de entrada ou mais;
  - tarefas concluídas sem métrica.
- **Orçamento por tarefa configurável:** `tokenBudget` nas preferências (padrão 2.000.000), aplicado às próximas tarefas por `TaskEngine.setTokenBudget`, sem reiniciar.
- **IPC** `analytics:tokens`, `analytics:budget` e `analytics:budget:save`, com esquemas estritos.
- **Página Analytics** refeita: período, totais, cache, estimativa rotulada, alertas e recomendações, quebras e orçamento. Preços não são calculados.
- **Testes:**
  - `packages/orchestrator/test/token-intelligence.test.ts` (3) e `setTokenBudget` no motor;
  - E2E `tests/e2e/token-intelligence.spec.ts` (2);
  - `shell.spec.ts` adaptado: Analytics deixou de ser página "Ainda não disponível", e a ponte do renderer passou a listar `analytics`, `historySync` e `importedConversations`, todas só com `invoke` validado.

**Fase 25 — Git Intelligence: CONCLUÍDA em 2026-10-29** (sem commit).

**Evolução visual pós-fase (2026-10-29):** página independente `Git Intelligence` adicionada ao menu principal, com grafo cronológico dos commits reais, seleção de projeto, branches, busca local, detalhes, arquivos alterados e diff somente leitura. O novo canal `projects:git:history` reutiliza `readGitHistory`; não há checkout, reset, push, rebase ou escrita no repositório. Typecheck, lint, build e `git diff --check` passaram; E2E visual dedicado permanece como validação posterior.

- **Leitor** `packages/workspace/src/git-history.ts`: lê, só para leitura, os commits de todas as branches locais (`rev-list --topo-order --branches`, `git show` com `-M`), pelo mesmo executor seguro (sem hooks, fsmonitor, diff externo ou textconv).
  - Guarda só o nome do autor, nunca o e-mail.
  - Corta o diff em 16 KB por arquivo e lê no máximo 200 commits novos por execução.
  - Os tipos ficam em `shared`.
- **Indexação** `packages/brain/src/git-index.ts`: reaproveita o índice RAG, sem segunda busca nem segundos embeddings.
  - Um documento por commit (`git://<hash>`) e um por arquivo alterado (`git://<hash>/<arquivo>`), com a linha do primeiro trecho.
  - Incremental pelo hash; a limpeza do índice de arquivos não apaga esses documentos.
  - Linhas com possível segredo são trocadas por "[linha removida: possível segredo]", e o diff de arquivos sensíveis é omitido.
  - O `RagEngine` ganhou `upsertDocument`.
- **Busca e relações:** `searchGitHistory` (só o projeto) e `commitRelations`, que lista as memórias com evidência nos arquivos do commit e as tarefas que mexeram neles até 3 dias antes ou depois.
- **Integração:**
  - IPC `projects:git:index|search|relations` (o hash é validado e `HEAD`, nomes de branch ou opções são recusados);
  - seção "Histórico Git" no projeto (indexar, buscar, abrir o trecho e as relações);
  - o `brain_rag_search` do MCP passa a encontrar commits, com referência `git://<commit>/<arquivo>:<linha>`.
- **Testes:**
  - `packages/workspace/test/git-history.test.ts` (3, incluindo a prova de que hooks e programas configurados não rodam);
  - `packages/brain/test/git-index.test.ts` (3);
  - `apps/desktop/test/projects.test.ts`, contrato IPC;
  - E2E `tests/e2e/git-intelligence.spec.ts` (1, com o MCP real).

**Fase 28 — Security Guardian: CONCLUÍDA em 2026-10-29** (sem commit).

- **Revisor** `packages/orchestrator/src/guardian.ts`: puro e determinístico, sobre o diff das alterações **desta tarefa** (arquivos que as etapas registraram), os comandos que os agentes rodaram e os caminhos alterados fora do projeto.
  - **Alto:** credencial em linha adicionada (detectada pelo `redactSecrets` dos agentes; a evidência nunca repete o valor), arquivo sensível, código perigoso (`eval`, `new Function`, `Invoke-Expression`, TLS desligado, `chmod 777`), comando perigoso executado (`rm -rf /`, `push --force`, `reset --hard`, `curl | sh`, `format`, `del /s`, `sudo`, `--no-verify`) e alteração fora da raiz.
  - **Médio:** pipeline de CI, dependência nova ou alterada (`package.json`, `.csproj`), alteração com mais de 40 arquivos ou 3.000 linhas.
  - **Baixo:** lockfile, e diff cortado marcado como "não analisado".
- **Bloqueio no TaskEngine**, ao concluir uma tarefa que editou (no colaborativo, depois da aprovação do revisor):
  - o resultado é gravado como evento `guardian`;
  - com risco alto, a tarefa fica "Aguardando aprovação" pelo mesmo mecanismo dos pedidos destrutivos;
  - aceitar grava `guardian_accepted` e conclui;
  - rejeitar encerra a tarefa como cancelada, com o motivo e os arquivos mantidos para revisão no Git (sem correção automática);
  - risco médio ou baixo só informa.
- **Defeito encontrado e corrigido pelo E2E:** a primeira versão revisava o diff inteiro da pasta, e uma credencial deixada por uma tarefa rejeitada bloqueava a tarefa seguinte. Agora só os arquivos da própria tarefa entram, com teste.
- **Limitações:**
  - Um arquivo que já estava alterado antes da tarefa e que o agente altera de novo não entra no conjunto da tarefa, porque a comparação é feita antes e depois.
  - Vulnerabilidades de dependências não são consultadas (exigiria rede ou base local).
- **Interface:** no TaskCard, "Revisão de segurança" com os achados por severidade, botões "Aceitar alterações" e "Rejeitar" quando há bloqueio, e "nada encontrado" quando passa.
- **Testes:**
  - `packages/orchestrator/test/guardian.test.ts` (5);
  - 4 casos no motor, incluindo o de alterações preexistentes;
  - E2E `tests/e2e/security-guardian.spec.ts` (2), com o agente falso gravando uma credencial (palavra SEGREDO).

**Fase 26 — Auto-Healing Seguro: CONCLUÍDA em 2026-10-29** (sem commit).

- **Ciclo limitado** `TaskEngine.heal(tarefaQueFalhou)`, sem segundo orquestrador. A correção é uma nova tarefa da mesma conversa, na fila do projeto.
  1. **Diagnóstico** só leitura, a partir da evidência registrada: o erro da tarefa, os comandos que saíram com código diferente de 0, os eventos de erro, as validações de correções anteriores que falharam e as memórias do projeto. A proposta estruturada (`HEAL_SCHEMA`) traz diagnóstico, evidências, plano, arquivos e comando de validação.
  2. **Sem evidência, ou com comando fora da lista, o ciclo para** e nada é alterado.
  3. **Aprovação do usuário**, pelo mesmo "Aguardando aprovação".
  4. **Snapshot** da árvore de trabalho (`packages/workspace/src/snapshot.ts`): o conteúdo dos arquivos já alterados fica guardado em memória; nada é escrito no Git (sem stash, commit ou branch).
  5. **Correção** pelo agente de edição, seguida da **validação executada pelo próprio NeuralBridge** (`packages/workspace/src/validation.ts`): só `npm|pnpm|yarn test`, `run build|lint|typecheck` ou `dotnet test|build`, na pasta do projeto, com tempo limite que encerra a árvore de processos e saída limitada.
  6. **Limites:** até 3 tentativas, parando antes quando a mesma falha se repete. Se não passar, ou se for cancelado, os arquivos tocados voltam ao snapshot (`changedSince` compara conteúdo, e assim também o arquivo que o usuário já tinha editado volta). Se passar, segue para a conclusão normal, incluindo a revisão de segurança da Fase 28.
- **Defeitos encontrados pelos testes e corrigidos:**
  - a restauração ignorava arquivos já editados antes da correção, porque o motor compara antes e depois pela lista de alterados do Git;
  - a evidência de uma correção que falhou não incluía as validações, então uma nova tentativa parava "sem evidência".
- **Interface:** "Diagnosticar e corrigir" em tarefas de projeto que falharam. O cartão da correção mostra o diagnóstico com as evidências, os botões "Aplicar correção" e "Não aplicar", as tentativas com a saída e os arquivos restaurados. IPC `tasks:heal`.
- **Limitação:** a restauração trata arquivos de texto; arquivos binários alterados por uma correção não são restaurados byte a byte.
- **Testes:**
  - `snapshot.test.ts` (4) e `validation.test.ts` (3, com `npm` real);
  - 4 casos no motor;
  - E2E `tests/e2e/auto-healing.spec.ts` (2), com `npm test` real como validação.

**Verificação (2026-10-29):** typecheck, lint e `git diff --check` aprovados; `npx vitest run` com **66 arquivos, 542 testes**.

**Fase 27 — Workflow Builder: CONCLUÍDA em 2026-10-29.** Schema e DAG validados; definições e execuções versionadas no SQLite; IPC/preload/UI integrados; execução aprovada por camadas no TaskEngine; pausa, retomada, cancelamento idempotente e recuperação após reinício persistidas. O contrato IPC do planner e os controles de execução têm validação estrita. Testes unitários do serviço e E2E de criação/aprovação, execução por camadas, pausa/retomada/cancelamento aprovados.

**Fase 29 — Mission Control: CONCLUÍDA em 2026-10-29.** Página derivada de `tasks:list`, filtros por status/agente/projeto/busca, cancelamento, detalhes e atualização por `tasks:onChanged`; pausa/retomada individual usa o TaskEngine existente, estado `paused` persistido na migração `0019_task_pause` e E2E Electron aprovado. E2E comprova preservação após reinício e acompanhamento de duas tarefas independentes até estados terminais.

**Fase 23 — Visual QA: CONCLUÍDA em 2026-10-29.** E2E Electron em três resoluções com verificação de overflow horizontal e comparação contra três baselines versionadas, com animações desativadas e tolerância explícita de 1% de pixels. O fluxo reproduzível gera evidências e não confunde comparação visual com aceite funcional; aprovação automática de baseline permanece fora do escopo documentado.

**Fase 24 — Agent Swarm: CONCLUÍDA em 2026-10-29.** Seleção determinística de especialistas, limites, aprovação para segurança e handoffs expostos pelo IPC com dependências explícitas e modo somente leitura. Execução em camadas inicia os handoffs pelo TaskEngine existente, aguarda cada camada e retorna resultados consolidados por papel. Auditoria determinística de conflitos por arquivo adicionada ao orquestrador, com testes positivo e negativo. E2E real do `tasks:swarm-run` com projeto e agentes controlados, incluindo plano sensível com aprovação e múltiplas camadas: 2/2 aprovados.

**Fase 30 — Video Studio: CONCLUÍDA em 2026-10-29.** Validação de composição/assets, biblioteca persistida com hash e limites, timeline com áudio/legendas, plano determinístico, renderizador não-shell com jobs/cancelamento/recuperação, persistência versionada de projetos/composições/jobs e IPC/UI de validação/salvamento/exportação conectados ao domínio real; comando `/video` do Chat encaminha instruções ao Studio e gera composição editável delimitada sem executar o texto. A auditoria de origem e agente é persistida por job e exibida na UI. Preview MP4 real é servido somente após render concluído, por IPC confinado à raiz autorizada e com limite de tamanho. E2E dedicado Chat → render com `origem chat · agente codex`, composição/preview e recuperação: aprovado.

Ordem recomendada: **20 → 21 → 22 → 25 → 28 → 26 → 27 → 29 → 24**. A Fase 23 pode avançar em paralelo após permissões e artefatos. A Fase 30 pode avançar independentemente das Fases 25–29 quando TaskEngine, Skills, permissões e renderização isolada estiverem estáveis.

---

## Fase 31 — Advanced Workflow Orchestration

**Nome completo:** Advanced Workflow Orchestration — Visual Builder, Templates, Autonomous Execution & Git Automation.

**Status da macrofase:** EM ANDAMENTO — 31.1–31.4 parcialmente implementadas. O runner e o modo de missão agora recebem eventos reais do processo principal, o monitor Git persiste cursores/eventos e a galeria possui canais de favorito/importação/exportação/layout; ainda faltam retry/fallback/checkpoints transacionais completos no TaskEngine, layout visual persistido no editor, E2E completo e validações externas.

**Arquitetura, contratos e auditoria do código:** [phase-31-advanced-workflow-orchestration.md](plans/phase-31-advanced-workflow-orchestration.md). As referências "A1 a A15" abaixo apontam para a auditoria da seção 1 desse documento; "D1 a D12", para as decisões da seção 3.

**Numeração:** a última fase planejada e concluída é a 30. As subfases seguem o precedente da Fase 7.5.

| Subfase | Nome | Depende de | Status |
|---|---|---|---|
| 31.1 | Visual Workflow Builder | Fases 25 a 28 | PARCIALMENTE IMPLEMENTADA |
| 31.2 | Workflow Templates Library | 31.1 | PARCIALMENTE IMPLEMENTADA |
| 31.3 | Autonomous Execution & Recovery | 31.1; usa 31.2 nos testes de fluxo | PARCIALMENTE IMPLEMENTADA |
| 31.4 | Git Intelligence Automation | 31.1, 31.2, 31.3 | PARCIALMENTE IMPLEMENTADA |

**Ordem obrigatória:** 31.1 → 31.2 → 31.3 → 31.4. A 31.1 também corrige o contrato de execução, porque as demais dependem dele: sem aprovação por etapa, acesso explícito e passagem de saídas, os templates não seriam reais; sem recuperação, automações sem supervisão não seriam seguras.

### Riscos da macrofase

| ID | Risco | Mitigação |
|---|---|---|
| RW1 | **Etapa "somente leitura" editar em projeto com Acesso total** (A5): uma revisão ou automação rodaria sem checagem de permissões. | `access` explícito com precedência sobre o roteador, entregue na 31.1 antes de qualquer template. Teste no motor e E2E. |
| RW2 | **Reexecutar etapa com efeito colateral** ao repetir ou retomar. | `claim` transacional, comparação com snapshot e decisão humana quando algo mudou. |
| RW3 | **Laço de automação**: um workflow altera arquivos, o que dispara outro workflow. | Exclusão de mudanças do próprio workflow, limites por hora e disjuntor. |
| RW4 | **Injeção de prompt** por mensagem de commit, diff, saída de etapa ou template importado. | Conteúdo entre delimitadores como dado não confiável; template importado passa pela validação do compilador e nunca aprova nada sozinho. |
| RW5 | **Custo sem supervisão** em execuções longas. | Orçamento por execução, limite de duração e parada com relatório. |
| RW6 | **Quebrar workflows existentes** com o schema `strictObject`. | `normalizeWorkflow` da v1 para a v2 e testes com fixture de definição v1. |
| RW7 | **Mudança grande sem histórico**: o trabalho das Fases 22 a 30, incluindo migrações `0013` a `0019`, já está no commit `b3a69b6`; alterações atuais permanecem não commitadas por decisão do usuário. | Agentes não fazem commit por conta própria. |
| RW8 | **Paralelismo menor que o esperado** por causa da fila por projeto (A7). | Semântica documentada e estado "em fila" visível. |
| RW9 | **Peso do canvas** no renderer. | Carregamento sob demanda da rota e medição do pacote. |
| RW10 | **Drizzle sem snapshot** em migrações antigas, como ocorreu nas `0010`/`0011`. | Conferir o snapshot antes de gerar a `0020`; escrever a migração à mão se necessário, como na `0012`. |

### Protocolo de execução

**Ao receber "Implemente a próxima subfase pendente do PLAN.md":**

1. Ler `AGENTS.md`, `docs/PLAN.md` e o documento de arquitetura da Fase 31.
2. Identificar a primeira subfase cujo status não seja CONCLUÍDA.
3. Verificar o estado real do código; não confiar só nos checklists.
4. Confirmar que as dependências estão CONCLUÍDAS. Se não estiverem, parar e informar.
5. Elaborar o plano de implementação da subfase (writing-plans), em TDD.
6. Implementar a subfase.
7. Executar testes.
8. Corrigir regressões introduzidas.
9. Validar cada critério de aceite.
10. Atualizar o status e os checklists no `docs/PLAN.md`, com evidência.
11. Registrar os arquivos modificados.
12. Documentar pendências e bloqueios em `docs/STATUS.md`.
13. Apresentar o resumo da entrega.

Não avançar para a subfase seguinte com falha crítica não resolvida na atual.

**Ao receber "Implemente a fase Advanced Workflow Orchestration":** executar as subfases em ordem, cumprindo o protocolo acima em cada uma. Parar nos pontos de aprovação obrigatória abaixo.

**Ao receber "Continue a implementação de onde parou":** ler `docs/STATUS.md` e os checklists, conferir o código e retomar a primeira tarefa aberta da subfase em andamento.

**Pontos de aprovação obrigatória:** instalar dependência fora da lista da seção 12 do documento de arquitetura; ampliar a lista de comandos de `validation.ts`; qualquer alteração destrutiva em dados; `git push`, deploy ou publicação; alterar a política do Acesso total; incluir provedor Git remoto.

### Definição de pronto

Uma subfase só recebe CONCLUÍDA quando:

- a implementação está integrada ao código real;
- os critérios de aceite foram atendidos, cada um com evidência;
- nenhum mock substitui funcionalidade de produção;
- os testes relevantes foram executados;
- não há regressão crítica conhecida introduzida;
- lint, typecheck e build foram validados;
- a documentação está atualizada;
- os resultados estão registrados em `docs/STATUS.md`.

Se uma validação não puder ser executada, registrar validação pendente, motivo, impacto e ação necessária. Interface pronta não é funcionalidade operacional: um nó sem execução real continua como "Planejado". A Vitest deve ser validada com `--no-file-parallelism` quando houver falha em testes que usam `git`, porque esses testes estouram o tempo sob carga nesta máquina.

---

### Fase 31.1 — Visual Workflow Builder

**1. Objetivo.** Transformar a página de Workflows, hoje um textarea de JSON, em um editor visual profissional, inspirado em ferramentas como n8n, e dar ao contrato de execução o que falta para o editor ser verdadeiro.

**2. Contexto técnico.** `WorkflowsPage.tsx` edita JSON e `workflows.ts` executa por camadas com polling. O schema `strictObject` tem uma versão só. Há seis lacunas que impediriam um editor honesto: A1, A3, A4, A5, A6 e A8.

**3. Escopo funcional.**

- [ ] Canvas com arraste de nós, conexões, zoom, pan, minimap e grid.
- [x] Criar, editar, duplicar e excluir nós (E2E visual do builder).
- [ ] Seleção múltipla, atalhos de teclado e layout automático.
- [ ] Indicadores de validação no nó e na conexão.
- [x] Indicadores reais de execução por nó.
- [x] Salvar e recuperar o layout.
- [x] Catálogo de nós conforme a seção 5 da arquitetura; etapas nativas têm gramática fechada e não executam texto livre.
- [x] Painel de propriedades: nome, identificador, agente, prompt, modo, acesso, dependências, aprovação, timeout e campos do tipo de nó. Retry e fallback ficam configuráveis conforme a política disponível.
- [x] Alternância entre editor visual e JSON, sem perda.
- [ ] Declaração de entradas do workflow.

**4. Escopo técnico.**

- [x] Schema v2 e `normalizeWorkflow` (testes compartilhados 6/6).
- [x] Compilador/conversor de workflow: grafo → definição, definição → grafo, ciclos, dependências, preservação de identificadores e metadados (`workflows.test.ts` 6/6 e `workflow-graph.test.ts` 1/1).
- [x] `workflow-runner` no pacote `orchestrator` (D2, D3), reagindo a eventos do motor. Snapshots, recuperação por run e atualização de passos por eventos reais do TaskEngine estão testados; o serviço legado ainda conserva polling como compatibilidade.
- [ ] `access` em `StartInput`, com precedência sobre roteador e promoção do Acesso total (A5).
- [ ] Tarefas `read-only` explícitas fora da fila do projeto (D8).
- [x] Aprovação por etapa pelo mecanismo existente de `awaiting_approval`, sem prazo fixo (A1, A6).
- [x] Pausar e cancelar propagados às tarefas (A3).
- [x] Interpolação e passagem de saídas (A4).
- [x] Snapshot da definição na execução (A8).

**5. Arquivos e módulos envolvidos.**

- Alterar: `packages/shared/src/workflows.ts`, `packages/shared/src/channels.ts`, `packages/shared/src/ipc.ts`, `packages/shared/src/tasks.ts`, `packages/orchestrator/src/engine.ts`, `apps/desktop/src/main/workflows.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/src/features/workflows/WorkflowsPage.tsx`, `packages/database/src/schema.ts`.
- Criar: `packages/orchestrator/src/workflow-runner.ts`, `packages/shared/src/workflow-graph.ts`, `apps/desktop/src/renderer/src/features/workflows/builder/`, migração `0020_workflow_v2`.

**6. Dependências.** Fases 27, 25 a 28 e TaskEngine. Pacotes `@xyflow/react` e `@dagrejs/dagre`, instalados só nesta subfase.

**7. Contratos e integrações.** Seções 4 e 5 da arquitetura. IPC novos: `workflows:validate`, `workflows:layout:save`, `workflows:approve-step`, `workflows:run-detail`, além do evento `workflows:changed`. `workflows:run` passa a aceitar `inputs`. Tudo validado por Zod e sem caminho, comando ou argumento vindo do renderer.

**8. Modelo de dados.** Migração `0020` (seção 6 da arquitetura). Aditiva, com definições v1 preservadas.

**9. Estratégia de implementação.**

1. Fixture v1, `normalizeWorkflow` e schema v2.
2. `access` em `StartInput`, com testes do motor (RW1).
3. Migração `0020`.
4. `workflow-runner` com aprovação, cancelamento, saídas e snapshot, ainda na tela atual.
5. Compilador de grafo, puro e testado.
6. Canvas, paleta, painel e validação.
7. Alternância com JSON e layout.
8. Estado de execução no canvas.

Ordem deliberada: o contrato fica correto antes da interface.

**10. Segurança.** Acesso explícito (D6). Confirmação de execução mostra agentes, acessos e etapas de edição, e avisa quando o projeto está em Acesso total. Nome ou prompt de workflow nunca alteram autorização. O conteúdo de saídas é dado não confiável (D10). Nada de `eval` (D9).

**11. Tratamento de erros.** Grafo inválido mostra o erro no nó e bloqueia a execução, sem bloquear o salvamento de rascunho. Definição corrompida abre no JSON com a mensagem. Etapa falha encerra a execução com a etapa identificada; as demais do mesmo nível são canceladas. JSON inválido não apaga o estado do canvas.

**12. Testes.**

- [x] Unitários: normalização v1, compilador ida e volta, ciclos, dependência inválida, interpolação, referência fora das dependências.
- [x] Motor: `read-only` em projeto Acesso total não edita nem usa `--dangerously-skip-permissions`; `edit` mantém o comportamento.
- [x] Integração do `workflow-runner`: aprovação, rejeição, cancelamento propagado, pausa, saída entre etapas e ordem.
- [ ] Contratos IPC.
- [x] E2E: criar por arraste, configurar, salvar, reabrir, alternar com JSON, executar com o agente falso e ver os estados (`workflows.spec.ts` 5/5 e builder visual 1/1); conexão por arraste e cobertura de zoom/pan continuam pendentes.
- [ ] E2E: workflow v1 existente abre e executa.
- [ ] Acessibilidade: operar nós pelo teclado.

**13. Critérios de aceite.**

- [x] Criar workflow sem editar JSON.
- [x] Adicionar agentes arrastando blocos.
- [ ] Conectar etapas visualmente.
- [x] Configurar propriedades.
- [ ] Validar dependências e ciclos.
- [x] Salvar e reabrir workflows.
- [x] Preservar workflows existentes.
- [x] Alternar entre editor visual e JSON.
- [x] Executar pelo TaskEngine.
- [x] Exibir estados reais de execução.
- [x] Testes unitários, integração e E2E aprovados nos cenários cobertos.
- [x] Etapa `read-only` não altera arquivos em projeto com Acesso total.
- [x] Aprovação por etapa funciona e não expira por prazo fixo.
- [x] Cancelar uma execução interrompe suas tarefas.

**14. Riscos.** RW1, RW6, RW7, RW8, RW9, RW10. Também: divergência entre canvas e JSON, mitigada por uma só fonte de verdade (D4).

**15. Entregáveis.** Schema v2, compilador, coordenador, editor visual, migração, IPC, testes, licenças em `docs/THIRD-PARTY.md` e documentação.

**16. Status.** PARCIALMENTE IMPLEMENTADA — editor, contratos, runner e E2Es principais estão ativos; conexão por arraste, zoom/pan, inputs e acessibilidade completa do canvas ainda exigem cobertura específica.

---

### Fase 31.2 — Workflow Templates Library

**1. Objetivo.** Criar uma biblioteca de workflows reutilizáveis para iniciar automações complexas com poucos cliques.

**2. Contexto técnico.** Com a 31.1 pronta, um template é uma definição v2 versionada com entradas. Faltam executores nativos de RAG, validação e Git de leitura, necessários para etapas reais.

**3. Escopo funcional.**

- [x] Galeria, busca por nome e filtro por categoria.
- [x] Favoritos persistidos via IPC.
- [ ] Preview visual, descrição e requisitos.
- [ ] Criar workflow a partir de template e personalizar no editor.
- [ ] Duplicar.
- [x] Exportar e importar JSON validado pelo compilador via IPC.
- [ ] Versionamento e aviso de nova versão.
- [ ] Validação de compatibilidade com o projeto e agentes disponíveis.
- [ ] Template 1 — Bug Fix Pipeline.
- [ ] Template 2 — Feature Development Pipeline.
- [x] Template 3 — Automated QA Pipeline (homologado com fixture npm real; `validation.ts` já aceitava os comandos).
- [ ] Template 4 — Pull Request Review.
- [ ] Template 5 — Documentation Generator.

| Template | Etapas e tipo de nó | Dependências a registrar |
|---|---|---|
| Bug Fix Pipeline | 1 entrada `bug`; 2 `rag`; 3 agente leitura (causa raiz); 4 agente leitura (plano); 5 `approval` opcional; 6 agente edição; 7 `validation`; 8 agente leitura (revisão); 9 agente leitura (relatório) | Executores `rag` e `validation` |
| Feature Development Pipeline | 1 agente leitura; 2 `rag`; 3 agente leitura; 4 agente edição; 5 agente leitura; 6 `validation`; 7 agente leitura (critérios); 8 agente leitura (descrição de PR) | Idem |
| Automated QA Pipeline | 1 `git` diff; 2 agente leitura; 3 `validation` unitários; 4 `validation` integração; 5 `validation` E2E; 6 agente leitura; 7 agente leitura (relatório) | **Aprovação para ampliar `validation.ts`** com `test:integration` e `test:e2e`. Sem ela, as etapas 4 e 5 ficam desabilitadas e o template declara isso. |
| Pull Request Review | 1 `git` diff; 2 agente leitura; 3 `rag`; 4 a 6 agentes leitura em paralelo (riscos, segurança, qualidade); 7 agente leitura | Diff local até a 31.4. Comentários ficam no relatório, sem publicar no provedor. |
| Documentation Generator | 1 agente leitura; 2 `rag` e `project_profile`; 3 agente leitura; 4 agente leitura (rascunho); 5 agente leitura (consistência); 6 `approval`; 7 agente edição restrita a Markdown | Limite por caminho na etapa 7: o Guardian revisa e a etapa reprova se tocar fora de `*.md`. |

**4. Escopo técnico.**

- [x] Executores nativos `rag`, `validation` e `git` de leitura no `workflow-runner` (adaptador puro testado; ligação de produção ainda usa o serviço legado).
- [x] Templates embutidos como dados versionados no repositório, validados por teste.
- [x] Importação com validação do compilador e sem confiança no arquivo.
- [ ] Vínculo do workflow com a origem do template.

**5. Arquivos e módulos envolvidos.**

- Alterar: `packages/shared/src/workflows.ts`, `packages/orchestrator/src/workflow-runner.ts`, `apps/desktop/src/main/workflows.ts`, `packages/shared/src/channels.ts`, `packages/shared/src/ipc.ts`, `apps/desktop/src/preload/index.ts`, `packages/workspace/src/validation.ts` (somente com aprovação).
- Criar: `packages/shared/src/workflow-templates/`, `apps/desktop/src/renderer/src/features/workflows/templates/`, migração `0021_workflow_templates`.

**6. Dependências.** 31.1 parcialmente implementada. RagEngine, `validation.ts`, leitor Git e `project_profile`.

**7. Contratos e integrações.** `WorkflowTemplate = { id, version, name, category, description, requirements, definition }`. IPC: `workflows:templates:list|get|favorite|import|export|instantiate`. Os dois últimos passam por diálogo do processo principal, sem caminho vindo do renderer.

**8. Modelo de dados.** Migração `0021`. Templates embutidos não ficam no banco; só favoritos, importados e o vínculo.

**9. Estratégia de implementação.**

1. Executores nativos, com testes.
2. Contrato e teste "todo template embutido compila".
3. Os cinco templates.
4. Migração e IPC.
5. Galeria, preview e criação.
6. Importação e exportação.
7. Execução dos cinco com o agente falso.

**10. Segurança.** Template importado nunca marca aprovação, nunca concede acesso e passa pelo mesmo compilador. Tamanho limitado. Exportação sem `projectId` e sem saídas de execução. Requisitos não atendidos desabilitam a criação com a razão.

**11. Tratamento de erros.** Template incompatível mostra o que falta. Arquivo inválido é recusado por inteiro. Atualizar um template nunca altera workflows já criados.

**12. Testes.**

- [ ] Unitários: compilação dos cinco, compatibilidade, importação inválida, migração de versão.
- [ ] Integração: cada executor nativo e cada template do início ao fim com o agente falso.
- [ ] E2E: buscar, filtrar, favoritar, ver preview, criar, personalizar, salvar, executar, exportar e importar.

**13. Critérios de aceite.**

- [ ] Biblioteca acessível pela interface.
- [ ] Cinco templates funcionais.
- [ ] Preview antes da utilização.
- [ ] Criação a partir de template.
- [ ] Personalização no editor visual.
- [ ] Persistência correta.
- [ ] Validação de compatibilidade.
- [ ] Testes automatizados.

**14. Riscos.** RW1, RW4. Também: template dar falsa impressão de cobertura, mitigada por requisitos explícitos e etapas desabilitadas com o motivo.

**15. Entregáveis.** Executores nativos, cinco templates, galeria, importação e exportação, migração, IPC e testes.

**16. Status.** PARCIALMENTE IMPLEMENTADA — galeria, busca, favoritos, import/export e templates versionados estão ativos; cinco templates completos, compatibilidade, vínculo de origem e execução ponta a ponta de todos ainda exigem cobertura.

---

### Fase 31.3 — Autonomous Execution & Recovery

**1. Objetivo.** Executar workflows longos com tolerância a falhas, recuperação de contexto e continuidade segura.

**2. Contexto técnico.** Existe troca de agente limitada (A9), sem retry, e a retomada após reinício não funciona (A2). `TaskEngine.recover` marca tarefas como falhas, e as sessões ficam salvas (A10). `snapshot.ts` compara e restaura arquivos. O coordenador da 31.1 já guarda estado no banco, então retomar é continuar da mesma função (D3).

**3. Escopo funcional.**

- [x] Política de retry por workflow e por etapa: erros temporários, timeout, rate limit, HTTP 429, HTTP 529, provedor indisponível e rede (política e testes unitários).
- [x] Backoff exponencial, jitter, máximo de tentativas, limite de tempo, cancelamento e registro.
- [x] Fallback Claude ↔ Codex com provedor primário e secundário, regras, disponibilidade, capacidades, transferência de contexto, artefatos e motivo registrado.
- [x] Checkpoints persistentes.
- [ ] Retomada conforme a matriz da seção 10 da arquitetura.
- [ ] Nós Retry, Fallback e Condition saem de "Planejado".
- [x] Limite de tokens e de duração por execução.
- [x] Timeline, logs por etapa, tentativas, trocas de provedor, checkpoints, tempo, tokens, custo estimado, erros classificados e histórico de recuperação.

**4. Escopo técnico.**

- [x] `classifyAgentFailure` com os novos tipos e leitura de `Retry-After` quando houver.
- [x] `recovery-policy.ts`, puro: `(falha, etapa, tentativa, árvore mudou?) → repetir | trocar | parar | pedir decisão`.
- [x] Integração da regra de efeito colateral com `snapshot.ts`.
- [ ] Unificação da troca de agente atual com a nova política, sem perder o comportamento do Chat.
- [ ] Retomada na inicialização, em segundo plano, sem bloquear a janela.
- [x] Prevenção de duplicidade com `claim` transacional.
- [x] `capabilities` por adaptador.

**5. Arquivos e módulos envolvidos.**

- Alterar: `packages/orchestrator/src/failover.ts`, `packages/orchestrator/src/engine.ts`, `packages/orchestrator/src/workflow-runner.ts`, `packages/agents/src/agent.ts`, `apps/desktop/src/main/workflows.ts`, `apps/desktop/src/main/tasks.ts`, `apps/desktop/src/renderer/src/features/workflows/`, `apps/desktop/src/renderer/src/features/mission-control/`.
- Criar: `packages/orchestrator/src/recovery-policy.ts`, `packages/orchestrator/src/workflow-checkpoints.ts`, migração `0022_workflow_recovery`.

**6. Dependências.** 31.1 parcialmente implementada. Os templates da 31.2 servem de cenário nos testes.

**7. Contratos e integrações.** Seção 9 da arquitetura. IPC: `workflows:resume-decision`, `workflows:timeline`. Evento de tarefa `retry_scheduled`. Mission Control exibe os novos estados.

**8. Modelo de dados.** Migração `0022`: checkpoints com ID da execução, ID do workflow, versão, etapa atual, concluídas, pendentes, resultados, artefatos, provedor, aprovação, tentativas e metadados de recuperação. Saídas passam pelo redator. Tokens e credenciais não são gravados.

**9. Estratégia de implementação.**

1. Classificação e política pura, com tabela de testes.
2. Retry no coordenador, com relógio injetável.
3. Regra de efeito colateral.
4. Fallback com capacidades.
5. Migração e checkpoints.
6. Retomada e matriz.
7. Nó Condition e estado `skipped`.
8. Observabilidade na interface.

**10. Segurança.** Não repetir ação com efeito colateral sem garantia. Fallback nunca escala permissão nem repete edição se a árvore mudou. Retomada de etapa de edição exige confirmação. Credenciais nunca entram em checkpoints. Espera é cancelável.

**11. Tratamento de erros.** Fim das tentativas leva a `failed` com a classificação e a última causa. Falha ao gravar checkpoint interrompe a execução, em vez de seguir sem proteção. Checkpoint incompatível pede decisão. Banco indisponível na inicialização não inicia retomadas.

**12. Testes.**

- [x] Unitários: tabela de classificação, backoff com jitter determinístico, cada célula das tabelas de política.
- [ ] Integração com o TaskEngine: 429, 529, timeout e rede simulados no agente falso, com retry, fallback e parada.
- [ ] Efeito colateral: edição parcial nunca repete sozinha.
- [ ] Recuperação: reiniciar o Electron no meio de etapa de leitura, de edição e de aprovação.
- [ ] Duplicidade: duas retomadas simultâneas iniciam uma só tarefa.
- [x] E2E: timeline e cancelamento durante a espera; decisão de retomada após reinício permanece pendente.
- [ ] Regressão: troca de agente no Chat continua como antes.

**13. Critérios de aceite.**

- [x] Retry configurável.
- [x] Backoff exponencial com jitter.
- [x] Fallback seguro Claude/Codex.
- [x] Checkpoints persistidos.
- [ ] Retomada após reinicialização.
- [ ] Prevenção de execução duplicada.
- [ ] Preservação do contexto.
- [x] Observabilidade.
- [x] Testes de falha e recuperação nos cenários cobertos.
- [x] Testes de integração com TaskEngine nos cenários cobertos.

**14. Riscos.** RW2, RW5. Também: assumir equivalência entre Claude e Codex, mitigada por `capabilities`; e sessão expirada ao retomar, com recuo para contexto reconstruído a partir das saídas.

**15. Entregáveis.** Política de recuperação, coordenador retomável, checkpoints, migração, observabilidade, testes de falha e documentação atualizada, inclusive correção do texto da Fase 27 sobre recuperação.

**16. Status.** PARCIALMENTE IMPLEMENTADA — retry, backoff, fallback, checkpoints, limites, prevenção de duplicidade e observabilidade estão ativos; restart real do Electron durante leitura/edição/aprovação e matriz completa de retomada ainda exigem homologação.

---

### Fase 31.4 — Git Intelligence Automation

**1. Objetivo.** Integrar o Workflow Builder ao Git Intelligence para disparar análises, revisões e testes a partir de commits, branches e alterações.

**2. Contexto técnico.** O leitor Git é seguro e somente leitura, mas só lê branches locais (A12). Não há observador (A11). A página `/git-intelligence` lista branches, commits e arquivos. O app só roda aberto (D12).

**3. Escopo funcional.**

- [ ] Gatilhos: novo commit, atualização de branch, alteração de arquivos, arquivos específicos, diff entre branches, novas alterações locais.
- [x] Execução manual a partir de commit e de branch, na página Git Intelligence (branch validada no E2E).
- [x] Configuração de automação por projeto, com escolha do workflow.
- [ ] Automação Commit Review.
- [ ] Automação Branch Quality Check.
- [ ] Automação Automated Regression Analysis.
- [ ] Automação Documentation Impact Analysis.
- [ ] Relatórios associados ao repositório e ao commit.
- [ ] Histórico de eventos e motivo de cada disparo ou descarte.

| Automação | Gatilho padrão | Acesso | Observação |
|---|---|---|---|
| Commit Review | Novo commit | Leitura | Etapas 1 a 5 do pedido, com `diff-range` |
| Branch Quality Check | Manual por branch | Leitura e `validation` | Base configurável |
| Automated Regression Analysis | Alteração de arquivos | Leitura e `validation` | Seleção de testes usa `project_profile`; se a seleção for incerta, roda a suíte configurada |
| Documentation Impact Analysis | Mudança relevante | Leitura; edição só após `approval` | Reaproveita o Template 5 |

**4. Escopo técnico.**

- [x] `readGitRefs` e `gitDiffRange`, reaproveitando `gitRun`, com validação de refs e `--end-of-options`.
- [x] Monitor periódico assíncrono no processo principal, por projeto, sem sobreposição de ciclos, com cursores persistidos.
- [ ] Debounce, deduplicação, concorrência, limites e disjuntor.
- [ ] Recuperação do atraso ao abrir o app, com lote limitado.
- [ ] Contexto do gatilho como entradas do workflow.

**5. Arquivos e módulos envolvidos.**

- Alterar: `packages/workspace/src/git.ts`, `packages/workspace/src/git-history.ts`, `apps/desktop/src/main/projects.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/src/pages/GitIntelligencePage.tsx`, `packages/shared/src/projects.ts`, `packages/shared/src/channels.ts`, `packages/shared/src/ipc.ts`.
- Criar: `apps/desktop/src/main/git-automation.ts`, `packages/orchestrator/src/git-triggers.ts`, `packages/shared/src/workflow-templates/git/`, `apps/desktop/src/renderer/src/features/workflows/automations/`, migração `0023_git_automations`.

**6. Dependências.** 31.1, 31.2 e 31.3 parcialmente implementadas. Automação sem recuperação segura está vetada.

**7. Contratos e integrações.** Seção 11 da arquitetura. IPC: `workflows:automations:list|save|delete|toggle|events`, `workflows:run-from-git`. Reaproveita projetos cadastrados, branches, histórico, detalhes de commit, arquivos e busca, sem duplicar lógica. Eventos remotos de PR ficam fora: dependem de decidir provedor, credencial e autorização.

**8. Modelo de dados.** Migração `0023`, com índice único em `dedupe_key`.

**9. Estratégia de implementação.**

1. Leitura de refs e intervalo, com testes de injeção.
2. Filtro puro de gatilhos e deduplicação.
3. Migração.
4. Monitor com limites.
5. Disparo pelo coordenador.
6. Execução manual na página Git.
7. Quatro automações.
8. Interface de configuração e histórico.

**10. Segurança.**

- Allowlist: automação desligada por padrão, por projeto, só em repositório cadastrado.
- Automações rodam `read-only` com precedência sobre o Acesso total (D7).
- Debounce, deduplicação por commit ou evento, concorrência limitada por projeto, limite por hora e disjuntor.
- Prevenção de laços (seção 11 da arquitetura).
- Mensagens, diffs e nomes de branch são dados não confiáveis. Nome de branch nunca vira argumento sem validação.
- Sem commit, push, checkout ou merge. Sem hooks, como no leitor atual.
- Aprovação humana para operações sensíveis. Toda decisão fica auditada.

**11. Tratamento de erros.** Repositório ausente ou inválido suspende aquela automação e avisa. Histórico reescrito cria evento marcado, sem repetir análises antigas. Atraso grande processa só o mais recente e registra o descarte. Falhas repetidas acionam o disjuntor.

**12. Testes.**

- [x] Unitários: filtros, dedupe, limites e disjuntor; globs/debounce completos ainda precisam de matriz adicional.
- [ ] Segurança: ref maliciosa, opção disfarçada de branch, commit com injeção de prompt.
- [ ] Integração com fixture Git: novo commit, branch nova, force-push, muitos commits e alterações locais.
- [ ] Laço: alteração do próprio workflow não dispara outro.
- [ ] Desempenho: o ciclo do monitor não bloqueia o processo principal.
- [x] E2E: configurar, disparar, ver estado e executar manualmente por branch (`git-automations.spec.ts` 3/3); fluxo manual por commit permanece pendente.

**13. Critérios de aceite.**

- [x] Git Intelligence integrado ao Workflow Builder.
- [x] Seleção de workflow por evento.
- [x] Gatilhos funcionais nos cenários de branch cobertos.
- [x] Execução manual por branch; commit ainda pendente.
- [ ] Detecção de alterações.
- [ ] Deduplicação de eventos.
- [ ] Controle de concorrência.
- [x] Execução pelo TaskEngine.
- [x] Relatórios/estado associados ao repositório nos cenários cobertos.
- [x] Testes unitários, integração e E2E dos cenários cobertos.

**14. Riscos.** RW3, RW4, RW5. Também: custo de varrer muitos repositórios, mitigado por intervalo configurável e comparação só de refs.

**15. Entregáveis.** Leitura de refs, monitor, automações, interface, histórico, migração, testes e documentação.

**16. Status.** PARCIALMENTE IMPLEMENTADA — monitor, configuração por projeto, execução por branch e integração ao TaskEngine estão ativos; gatilhos completos de commit/arquivos, dedupe/debounce total, recuperação de atraso e matriz E2E por commit ainda estão pendentes.


---

## Fase 33 — Hierarquia de Projetos, Workspaces e Detecção Inteligente

**Status da macrofase:** CONCLUÍDA em 2026-10-30, com as ressalvas de `docs/STATUS.md`. Migrações `0026_project_hierarchy`.

**Objetivo.** Cadastrar uma pasta que contém vários projetos, como `D:\Dev\Hepta`, reconhecer automaticamente os projetos reais e suas tecnologias, e trabalhar tanto com o workspace completo quanto com cada projeto.

**Arquitetura, auditoria e contratos:** [phase-33-project-hierarchy-workspaces.md](plans/phase-33-project-hierarchy-workspaces.md). As referências "H1 a H15" apontam para a auditoria e "D1 a D13" para as decisões desse documento.

**Numeração:** as Fases 31 e 32 já existem. As subfases seguem o padrão 33.N.

| Subfase | Nome | Depende de | Status |
|---|---|---|---|
| 33.1 | Modelo, migração e hierarquia | Projetos, Fase 21 | CONCLUÍDA |
| 33.2 | Descoberta e classificação | 33.1 | CONCLUÍDA |
| 33.3 | Interface hierárquica e prévia | 33.1, 33.2 | CONCLUÍDA |
| 33.4 | Novo Projeto, Git init e clone | 33.1, 33.3 | CONCLUÍDA |
| 33.5 | Git Intelligence hierárquico | 33.1, 33.2 | CONCLUÍDA |
| 33.6 | RAG por projeto e workspace | 33.1 | CONCLUÍDA |
| 33.7 | Chat e TaskEngine multiprojeto | 33.1, 33.5, 33.6 | CONCLUÍDA |

**Ordem obrigatória:** 33.1 → 33.2 → 33.3 → 33.4 → 33.5 → 33.6 → 33.7.

**Relação com outras fases:** a Fase 33 não depende funcionalmente da 31 nem da 32, mas altera os mesmos arquivos (`engine.ts`, `git.ts`, `main/index.ts`). Antes de iniciar, confirmar o commit do trabalho em andamento e o próximo número de migração.

### Riscos da fase

| ID | Risco | Mitigação |
|---|---|---|
| RH1 | **Alcance do Acesso total** (H3): por decisão do usuário, tarefa em workspace com Acesso total alcança todos os filhos, inclusive os de nível Padrão, e um prompt malicioso teria o mesmo alcance. | Aviso na confirmação, no Chat e na árvore; sem herança nos demais casos (D6). |
| RH2 | **Perder índice** ao redistribuir o RAG (H7). | Reindexar filhos antes de limpar o workspace. |
| RH3 | **Falso positivo** em backups e cópias. | Pontuação negativa, prévia obrigatória e overrides. |
| RH4 | **Varredura lenta** em pastas grandes. | Caminhada assíncrona, limites, cancelamento e modo incremental. |
| RH5 | **`git clone` malicioso**: transporte perigoso, hooks ou opções injetadas. | Regras da seção 7 da arquitetura. |
| RH6 | **Repositório aninhado acidental.** | Confirmação explícita e recusa em pasta com repositório válido. |
| RH7 | **Conflito com o trabalho das Fases 31 e 32.** | Integrar ao estado real; não reverter trabalho alheio. |
| RH8 | **Quebrar projetos existentes.** | Migração aditiva, IDs preservados e vínculos só por confirmação. |

### Protocolo de execução

**Ao receber "Implemente a Fase 33" ou "Implemente a próxima subfase pendente da Fase 33":** ler `AGENTS.md`, este plano, `docs/STATUS.md` e o documento de arquitetura; verificar o código real; executar a primeira subfase pendente em TDD; rodar os testes relevantes; corrigir regressões; atualizar status e checklists com evidência; registrar pendências em `docs/STATUS.md`. Seguir até concluir ou encontrar um bloqueio real documentado. Não declarar a fase concluída com funcionalidade pendente.

**Pontos de aprovação obrigatória:** dependência nova; alteração destrutiva de dados; `git push`; commit automático.

**Definição de pronto:** a mesma da Fase 31.

---

### Fase 33.1 — Modelo, migração e hierarquia

**Objetivo.** Estender `projects` para hierarquia, sem afetar projetos atuais.

**Tarefas.**

- [x] Migração `0025_project_hierarchy`, aditiva (seção 4 da arquitetura).
- [x] Tipos derivados: Standalone, Workspace, Child e Nested Workspace (D1).
- [x] Serviço de hierarquia: árvore, mover, desvincular, proteção contra ciclos e profundidade.
- [x] Separar "desvincular" de "excluir". Nenhum dos dois apaga arquivos físicos.
- [x] Excluir workspace promove os filhos, sem cascata.
- [x] IPC `projects:tree`, `projects:move`, `projects:unlink`, com Zod.

**Arquivos.** `packages/database/src/schema.ts`, `packages/shared/src/projects.ts`, `packages/shared/src/channels.ts`, `packages/shared/src/ipc.ts`, `apps/desktop/src/main/projects.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`.

**Testes.**

- [x] Migração de banco real preserva IDs, configurações, histórico, vínculos e referências.
- [x] Persistência da hierarquia.
- [x] Ciclos recusados.
- [x] Projetos independentes continuam funcionando.

**Critérios de aceite.**

- [x] Um projeto pode conter vários projetos.
- [x] Projetos existentes continuam funcionando.

**Status.** CONCLUÍDA.

---

### Fase 33.2 — Descoberta e classificação

**Objetivo.** Serviço determinístico e somente leitura que encontra projetos e explica cada classificação.

**Tarefas.**

- [x] Caminhada assíncrona com limites configuráveis de profundidade, quantidade e duração.
- [x] Cancelamento e progresso.
- [x] Detectores extensíveis: JavaScript/TypeScript, .NET, Java/Kotlin, Python, Rust e Go (seção 5 da arquitetura).
- [x] Validação Git com `git rev-parse`: `.git` como pasta ou arquivo, raiz real, worktree e submódulo. `.git` validado é a evidência principal.
- [x] Monorepos e subprojetos sem `.git`, por manifesto.
- [x] Classificação `CONFIRMED_PROJECT`, `PROBABLE_PROJECT`, `WORKSPACE`, `AUXILIARY_DIRECTORY` e `UNKNOWN`, com pontuação e justificativas verificáveis.
- [x] Overrides persistentes, respeitados em novas varreduras.
- [x] Deduplicação por caminho canônico e detecção incremental.
- [x] Workspace com ou sem Git próprio; repositórios internos sempre identificados.
- [x] Symlinks, junctions e reparse points não seguidos.
- [x] Diretórios inacessíveis registrados sem abortar.
- [x] Nunca criar repositório, instalar, compilar ou executar código.

**Arquivos.** Criar `packages/workspace/src/project-discovery.ts` e `packages/workspace/src/project-detectors.ts`; alterar `packages/workspace/src/index.ts` e reaproveitar `detectStack`.

**Testes.**

- [x] Projeto independente.
- [x] Workspace com vários projetos.
- [x] Workspace com pastas auxiliares.
- [x] Projeto aninhado.
- [x] Monorepo JavaScript.
- [x] Solução .NET com vários projetos.
- [x] Pastas sem manifesto.
- [x] Diretórios auxiliares com manifestos acidentais.
- [x] Descoberta de pastas `.git`.
- [x] Descoberta de arquivos `.git` de worktrees.
- [x] Projetos Git aninhados.
- [x] Workspace sem Git próprio e workspace com Git próprio.
- [x] Pasta `.git` inválida, como a do Hepta (H4).
- [x] Correção manual respeitada.
- [x] Revarredura sem duplicidades.
- [x] Symlinks e junctions.
- [x] Diretórios inacessíveis.
- [x] Cancelamento de varredura.

**Critérios de aceite.**

- [x] O NeuralBridge identifica automaticamente os projetos reais.
- [x] Diretórios auxiliares não são cadastrados por padrão.
- [x] Nenhum arquivo é alterado durante a descoberta.

**Status.** CONCLUÍDA.

---

### Fase 33.3 — Interface hierárquica e prévia

**Objetivo.** Estender a página Projetos com árvore e prévia de descoberta, sem criar página nova.

**Tarefas.**

- [x] Árvore com expandir e recolher.
- [x] Ícone por tecnologia, tipo, caminho e quantidade de filhos.
- [x] Pesquisa em toda a hierarquia.
- [x] Filtros por tecnologia e classificação.
- [x] Seleção múltipla.
- [x] Reexecutar detecção.
- [x] Adicionar projeto manualmente.
- [x] Mover para outro workspace e remover vínculo.
- [x] Ação "Detectar projetos dentro desta pasta" ao cadastrar.
- [x] Ícone Git, branch atual e indicação de projeto sem Git.
- [x] Inicializar Git em projeto existente, com confirmação.
- [x] Prévia: confirmar todos, selecionar alguns, marcar pasta como projeto ou auxiliar, alterar tipo, corrigir hierarquia e ver as evidências.
- [x] Nada é cadastrado sem confirmação.

**Arquivos.** `apps/desktop/src/renderer/src/features/projects/ProjectsPage.tsx`, `apps/desktop/src/renderer/src/features/projects/api.ts`; criar componentes em `features/projects/`.

**Testes.**

- [x] E2E de cadastro, descoberta, confirmação e navegação hierárquica.
- [x] Teclado e leitores de tela na árvore.
- [x] Busca e filtros.

**Critérios de aceite.**

- [x] O usuário pode cadastrar `D:\Dev\Hepta` como workspace.
- [x] A interface apresenta a hierarquia corretamente.
- [x] O usuário pode corrigir a detecção.

**Status.** CONCLUÍDA.

---

### Fase 33.4 — Novo Projeto, Git init e clone

**Objetivo.** Criar projetos pelo NeuralBridge, com repositório Git automático.

**Tarefas.**

- [x] "Novo Projeto": criar independente, criar dentro de workspace, vincular existente e clonar repositório.
- [x] Nome, diretório, workspace pai opcional e estrutura inicial (`README.md`, `.gitignore`).
- [x] `git init` automático em projeto novo.
- [x] `.gitignore` adequado à tecnologia, preservando arquivo existente.
- [x] Cadastro automático e integração com Chat, RAG e Git Intelligence.
- [x] Confirmação explícita antes de `git init` dentro de repositório existente.
- [x] Recusa de `git init` em pasta com repositório válido.
- [x] Clone seguro (seção 7 da arquitetura), com progresso e cancelamento.

**Arquivos.** Criar `packages/workspace/src/git-write.ts` e `packages/workspace/src/project-scaffold.ts`; alterar `apps/desktop/src/main/projects.ts`, IPC e `features/projects/`.

**Testes.**

- [x] Criação de projeto com `git init`.
- [x] Tentativa de criação dentro de repositório existente.
- [x] Clonagem de repositório, com remoto local de fixture.
- [x] URLs e opções maliciosas recusadas.
- [x] Prevenção de duplicidades.
- [x] Preservação de repositórios existentes.
- [x] E2E de criação dentro de workspace.

**Critérios de aceite.**

- [x] O repositório é criado sem exigir `git init` manual.
- [x] Nenhum repositório aninhado é criado sem confirmação.

**Status.** CONCLUÍDA.

---

### Fase 33.5 — Git Intelligence hierárquico

**Objetivo.** Tratar repositório próprio, compartilhado ou ausente, sem operações duplicadas.

**Tarefas.**

- [x] Tabela `git_repositories` e Git root real de cada projeto.
- [x] Commits indexados uma vez por repositório (D9).
- [x] Filtros de caminho para projetos no mesmo repositório.
- [x] Página `/git-intelligence` com seleção hierárquica.
- [x] `gitRepositories` passa a respeitar a hierarquia cadastrada (H5).
- [x] Integrar com a automação Git da Fase 31.4, se já estiver disponível.

**Arquivos.** `apps/desktop/src/main/projects.ts`, `packages/workspace/src/git.ts`, `packages/brain/src/git-index.ts`, `apps/desktop/src/renderer/src/pages/GitIntelligencePage.tsx`.

**Testes.**

- [x] Vários projetos no mesmo Git root.
- [x] Projetos com repositórios independentes.
- [x] Integração com Git Intelligence.

**Critérios de aceite.**

- [x] Git Intelligence reconhece a hierarquia.
- [x] Nenhuma pasta é presumida como repositório.

**Status.** CONCLUÍDA.

---

### Fase 33.6 — RAG por projeto e workspace

**Objetivo.** Indexar nos dois níveis, sem duplicar.

**Tarefas.**

- [x] Dono único por arquivo (D8).
- [x] Projeto de origem em cada chunk e referências corretas.
- [x] Busca por projeto e entre projetos.
- [x] Respeitar exclusões e arquivos sensíveis.
- [x] Atualização incremental.
- [x] Redistribuição segura do índice existente (seção 10 da arquitetura).
- [x] Isolamento de projetos privados.

**Arquivos.** `packages/brain/src/rag-engine.ts`, `apps/desktop/src/main/projects.ts`, Project Intelligence, `brain_rag_search` do MCP.

**Testes.**

- [x] Integração com RAG: indexar, buscar nos dois níveis e sem duplicidade.
- [x] Redistribuição sem janela sem índice.
- [x] Projeto privado não vaza pelo workspace.

**Critérios de aceite.**

- [x] RAG reconhece a hierarquia.

**Status.** CONCLUÍDA.

---

### Fase 33.7 — Chat e TaskEngine multiprojeto

**Objetivo.** Trabalhar em vários projetos do workspace sem misturar contextos nem ampliar permissões.

**Tarefas.**

- [x] Seleção hierárquica de projeto e de participantes da execução.
- [x] Histórico do Chat por ID, em árvore (H10).
- [x] Resolver projetos citados no pedido, como "backoffice e suporte-ms".
- [x] Contexto com caminhos e dependências dos projetos.
- [x] Origem de cada arquivo identificada na resposta e no diff.
- [x] Permissões conforme D6: Acesso total do workspace alcança os filhos; nos demais casos, sem herança.
- [x] Aviso de alcance na confirmação do Acesso total, no Chat e na árvore de projetos.
- [x] Fila por raiz física (D7).
- [x] Correção automática funcionando em filho do workspace (H14).

**Arquivos.** `packages/shared/src/tasks.ts`, `packages/orchestrator/src/engine.ts`, `packages/orchestrator/src/prompts.ts`, `packages/agents/src/claude-adapter.ts`, adaptador do Codex, `apps/desktop/src/main/tasks.ts`, `apps/desktop/src/renderer/src/features/tasks/ChatPage.tsx`.

**Testes.**

- [x] Integração com Chat.
- [x] Tarefa em filho de nível Padrão usa só o nível dele e não altera outro filho.
- [x] Tarefa em workspace com Acesso total roda sem checagem e alcança os filhos, mantendo o nível gravado em cada um.
- [x] Workspace sem Acesso total não amplia a escrita em nenhum filho.
- [x] O nível de um filho nunca sobe para o workspace.
- [x] Duas tarefas sobrepostas ficam em fila.
- [x] Projetos independentes mantêm o comportamento atual.
- [x] E2E: analisar a integração entre dois filhos.

**Critérios de aceite.**

- [x] Chat reconhece a hierarquia.
- [x] Permissões seguem a decisão D6, com o alcance do Acesso total visível ao usuário.

**Status.** CONCLUÍDA.

---

### Critérios de aceite da Fase 33

- [x] Um projeto pode conter vários projetos.
- [x] O usuário pode cadastrar `D:\Dev\Hepta` como workspace.
- [x] O NeuralBridge identifica automaticamente os projetos reais.
- [x] Diretórios auxiliares não são cadastrados como projetos por padrão.
- [x] A interface apresenta a hierarquia corretamente.
- [x] O usuário pode corrigir a detecção.
- [x] Projetos existentes continuam funcionando.
- [x] Chat, RAG e Git Intelligence reconhecem a hierarquia.
- [x] O repositório Git de novos projetos é criado automaticamente.
- [x] Nenhum repositório é criado na descoberta nem aninhado sem confirmação.
- [x] Os testes estão aprovados.
- [x] Build e typecheck estão aprovados.
- [x] `docs/PLAN.md` e `docs/STATUS.md` estão atualizados.

---

## Fase 36 — Velix AI Video Discovery & Autonomous Production

**Status:** CONCLUÍDA em 2026-11-01 — jornada real com voz ElevenLabs e vídeo próprio aprovada; YouTube, Claude, Codex e VoiceStudio reais homologados (ver `docs/plans/phase-36-final-validation.md`). Cota real e HTTP 429 do YouTube seguem cobertos só por simulação.

**Subplano:** [phase-36-velix-ai-video-discovery.md](plans/phase-36-velix-ai-video-discovery.md).

**Objetivo.** Evoluir o Velix para descobrir temas e referências reais por nicho, sugerir pautas originais, analisar arquivos de mídia cuja edição seja autorizada e produzir vídeos narrados, compilados e noticiários com revisão humana. Aproveitar o projeto Video, o Estúdio, o modelo Dossiê, o TaskEngine e os recursos de edição/renderização existentes, sem criar um segundo Video Studio.

**Dependências e compatibilidade.** Antes de programar, auditar a implementação real das Fases 30, 34 e 35, seus subplanos, contratos IPC, persistência, permissões e renderização. Preservar os modelos e rotas existentes. Se alguma dependência ainda não existir, registrar o bloqueio e implementar somente as etapas independentes; não declarar o fluxo ponta a ponta concluído.

**Subfases planejadas:**

| Subfase | Entrega | Critério de aceite resumido | Estado |
|---|---|---|---|
| 36.1 | Auditoria e contratos | Inventário do Velix, APIs e modelos existentes; plano de migração compatível | [ ] |
| 36.2 | Descoberta e fontes | Pesquisa real com metadados, URLs, proveniência, cache, limites e erros | [ ] |
| 36.3 | Radar de tendências e ideias | Sugestões fundamentadas, salváveis e convertíveis em projeto Video | [ ] Implementada; falta Investigar e geração com provider real pelo Claude |
| 36.4 | Rights Manager | Licença, evidência, atribuição e bloqueio de mídia não autorizada | [ ] |
| 36.5 | Clip Hunter | Análise e seleção de intervalos em arquivos locais autorizados | [ ] |
| 36.6 | Produção assistida/autônoma | Roteiro, narração ElevenLabs, sincronização, timeline, preview e MP4 | [ ] |
| 36.7 | Modos Notícias e Compilações | Fontes verificáveis, ranking comentado e montagem editorial original | [ ] |
| 36.8 | UX, testes E2E e documentação | Fluxos reais, falhas, cancelamento, performance e regressão | [ ] |
| 36.4-R | Robustez de providers e contratos | Contratos validados, política explícita de agentes e fontes de agente sob revisão humana | [x] |
| 36.9 | Homologação externa e encerramento | Jornada real com ElevenLabs de 109,2 s e vídeo próprio: MP4 de 110 s com áudio, FFprobe e persistência após reiniciar | [x] |
| 36.10 | VoiceStudio local (provider opcional) | Auditoria, adapter loopback e homologação real contra a API 0.5.7 com voz clonada do usuário; ElevenLabs preservado. Modelo OmniVoice é CC-BY-NC: uso comercial restrito | [x] |

**Regras essenciais.** Pesquisa no YouTube por interfaces oficiais autorizadas; referências não concedem direito de download ou reutilização. Não contornar DRM, restrições técnicas ou termos de plataformas. Materiais de terceiros só entram na montagem automática após licença/autorização documentada; exceções legais dependem de revisão humana e não são presumidas pelo agente. Conteúdo de páginas, vídeos e transcrições é dado não confiável, nunca instrução para executar comandos. Notícias devem ter fonte, data e distinção entre fatos e alegações. Sem métricas de tendências inventadas ou resultados de pesquisa simulados.

**Aceite da macrofase.** Em projeto Velix real: pesquisar fontes, selecionar uma ideia, gerar roteiro original e texto de narração, importar áudio, importar clipes autorizados, sugerir e revisar cortes, compor timeline, gerar preview e exportar MP4 válido. Registrar licenças e fontes e demonstrar E2E de falha/cancelamento/offline. Testes, lint, typecheck, build e `git diff --check` aprovados. Atualizar `docs/STATUS.md` somente com evidência de implementação. **Não criar commits automaticamente.**

## Fase 37 — NeuralBridge Intelligent Workspace UI/UX

**Status:** CONCLUÍDA em 2026-10-31 — homologação final registrada em `docs/plans/phase-37-final-validation.md`.

**Objetivo.** Modernizar a experiência desktop com uma linguagem visual própria, dark-first e acessível, preservando rotas, contratos IPC, estados reais e compatibilidade das funcionalidades existentes.

**Subfases:**

| Subfase | Entrega | Estado |
|---|---|---|
| 37.1 | Auditoria, Design System persistido, tokens, shell, navegação e Dashboard | CONCLUÍDA |
| 37.2 | Projetos/workspaces e contexto de projeto | EM EXECUÇÃO |
| 37.3 | Execuções, timeline de agentes, logs e recuperação | CONCLUÍDA |
| 37.4 | Workflows, Skills, Brain/RAG, Analytics, Git e Velix | PLANEJADA |
| 37.5 | Acessibilidade, responsividade, screenshots e regressão E2E | PLANEJADA |
| 37.6 | Workflow Builder Visual 2.0 | EM EXECUÇÃO |
| 37.7 | Projects & Workspaces Experience | EM EXECUÇÃO |
| 37.8 | AI Knowledge & Skills Experience | EM EXECUÇÃO |
| 37.9 | Velix Studio & AI Media Experience | EM EXECUÇÃO |
| 37.10 | Final Stabilization, Accessibility & Release Readiness | EM EXECUÇÃO |
| 37.11 | Final Visual Matrix, Vitest Isolation & Phase Closure | EM EXECUÇÃO |
| 37.12 | Workspace/Git Test Stabilization & Final Quality Gate | CONCLUÍDA |

**Evidência 37.1.** A skill UI/UX Pro Max foi executada com `--design-system --persist`, gerando `design-system/neuralbridge-intelligent-workspace/MASTER.md`. A stack real é React 19 + Electron + Tailwind CSS 4 + React Router + Lucide. O primeiro lote altera apenas tokens de UI, shell e dashboard; nenhuma lógica de negócio ou contrato IPC é alterado.

**Checkpoint 37.2 (2026-10-31).** Implementada Command Palette funcional em `Ctrl+K`, botão do shell e navegação por setas/Enter/Escape, com foco inicial e retorno de foco. Sidebar mantém grupos, estado ativo, recolhimento persistido, tooltips e projetos recentes vindos de `projects.list()`. Validação visual real via Electron: Dashboard 1280×820, Command Palette aberta, Projetos 1280×820 e sidebar recolhida; dark mode observado. E2E direcionado `shell.spec.ts`: 4/4 passaram. Light mode, reduced motion e screenshots automatizados multi-viewport permanecem pendentes.

**Checkpoint 37.3 (2026-10-31).** RunsPage recebeu lista operacional com resumo real de concluídas/ativas/falhas, agente, projeto, duração, horário e destaque de atenção para falha/aprovação. SessionPanel recebeu cabeçalho de execução atual com pedido, status, agentes e última atividade derivada dos eventos persistidos. A timeline detalhada, logs, retry/fallback, checkpoints, cancelamento e outputs existentes continuam em `TaskCard`, `panel-model` e contratos reais, sem telemetria inventada. E2E de SessionPanel: 5/5; fluxo de Execuções: aprovado; typecheck desktop, lint dos arquivos e build: aprovados. Screenshot real de Execuções vazio capturado no Electron; dados não foram simulados.

**Checkpoint 37.4 (2026-10-31).** Lote 4 concluído: auditoria visual real do Dashboard/shell e Execuções no Electron, com captura Playwright real do Dashboard; shell recebeu foco visível global, alvos de interação mais confortáveis e cabeçalho responsivo para janelas estreitas. Command Palette recebeu `aria-activedescendant`, ids de opção estáveis e alvo de fechamento de 36px. `prefers-reduced-motion` mantém feedback sem movimento contínuo e desliga scroll suave. Regressão visual multi-viewport passou após atualização deliberada dos baselines legados, inspecionados antes da atualização: 1280×800, 1024×768 e 800×700, sem overflow horizontal. Typecheck desktop, lint direcionado, build Electron e `git diff --check` passaram. O Lote 4 não altera rotas, lógica de negócio ou telemetria.

**Checkpoint 37.5 (2026-10-31).** Lote 5 implementado incrementalmente sobre o builder existente: `WorkflowsPage` agora organiza biblioteca, canvas e propriedades contextuais; `BlockPalette` ganhou busca, categorias, descrições e inserção acessível; `WorkflowCanvas` ganhou nós com hierarquia visual, ícones, estados reais, alertas de configuração, conexões e controles preservados. Em viewports menores, a composição adapta-se para manter o canvas legível. Nenhum tipo de nó, contrato IPC, persistência, workflow-graph ou integração TaskEngine foi substituído. E2E existente do builder: 5/5; novo E2E visual Electron: 1/1 em 1280×800 e 1024×768, sem overflow; snapshots inspecionados após captura real. Typecheck/lint direcionados, build e `git diff --check` aprovados. O diagnóstico de Vite foi fechado: os E2Es usam Electron empacotado a partir de `apps/desktop/out`; após rebuild, o E2E legado afetado passou.

**Checkpoint 37.6 (2026-10-31).** Lote 6 avançou o Projects Hub sem duplicar gerenciamento: busca por nome, caminho, tipo e stack; filtro de disponibilidade; resumo de projetos cadastrados/disponíveis/a revisar; estados de loading, erro, vazio e busca sem resultado; hierarquia `ProjectTree` e ações existentes preservadas. Os seletores E2E foram escopados ao `main` para evitar colisão legítima com projetos recentes da sidebar e links de memórias. O diagnóstico de testes confirmou que `tests/e2e/app.ts` lança Electron a partir de `apps/desktop/out`; processos Vite em 5173 são somente dev servers paralelos e não devem ser encerrados indiscriminadamente. E2E de projetos e hierarquia: 6/6; E2E visual do Projects Hub: 1/1 em 1280×800, 1024×768 e 800×700; typecheck desktop, lint direcionado, build e `git diff --check` aprovados.

**Checkpoint 37.7 (2026-10-31).** Lote 7 refinou a experiência de conhecimento sem criar serviços ou métricas fictícias: Skills recebeu busca, cards responsivos, origem local, conflito/estado inválido, associações reais de agentes e configurações existentes; Memory, RAG e Token Intelligence foram preservados e validados nos fluxos existentes. O Projects Hub foi validado em light mode com `C:\dev\neuralbridge` registrado no ambiente Electron isolado. Evidências visuais reais: 9 snapshots responsivos de Skills/Memória/Analytics (1280×800, 1024×768, 800×700) e Projects Hub dark multi-viewport + light mode com projeto real. E2E relevante: 8/8; lint direcionado, build e `git diff --check` aprovados. O typecheck permanece bloqueado por IPC preexistente de Video Ideas (`videoIdeaList`, `videoIdeaGenerate`, `videoIdeaSave`, `videoIdeaInvestigate`, `videoIdeaConvert`) em `src/main/index.ts`/`src/preload/index.ts`, fora do escopo deste lote.

**Checkpoint 37.8 (2026-10-31).** Lote 8 modernizou incrementalmente a composição do Velix sem substituir o pipeline FFmpeg/FFprobe, o armazenamento editorial, o Clip Hunter ou as validações de direitos: o cabeçalho agora explicita o estúdio e o projeto; o fluxo Descobrir → Planejar → Aprovar → Finalizar recebeu uma navegação visual; abas e painéis mantêm foco e navegação por teclado; o Clip Hunter usa ícone vetorial e alvos mais claros; o campo secundário de Ideias foi desambiguado para acessibilidade. E2E visual real do Electron: 3/3 viewports (1280×800, 1024×768, 800×700), com snapshots inspecionados. Fluxos Velix/descoberta/renderização: 21/23 passaram na execução ampla; 2 testes existentes foram bloqueados por dependência/limite externo do agente, enquanto os casos direcionados após a correção de acessibilidade passaram 3/3. Build, lint direcionado e `git diff --check` passaram. Typecheck segue bloqueado por divergência ambiental/IPC preexistente em Video Ideas e tipos Node, sem casts inseguros ou enfraquecimento de contratos.

**Checkpoint 37.9 (2026-10-31).** A auditoria global está registrada em `docs/plans/phase-37-global-ux-audit.md`, com inventário de rotas, severidades, evidências, riscos e recomendação de Lote 10. A avaliação não encerra a fase: permanecem bloqueios de typecheck e lacunas de validação de temas/reduced motion e rotas secundárias.

**Checkpoint 37.10 (2026-10-31).** O baseline foi refeito com `git status`/`git diff` preservados. O typecheck global agora passa após tipar explicitamente os passos visuais Lucide do Velix; o lint global passou após corrigir um `_removed` não utilizado em teste concorrente, sem alterar runtime. Os E2Es críticos passaram 26/26, incluindo reduced motion no Brain3D, shell/Command Palette, projetos, memória, Skills, Analytics/Token e Velix. Os testes unitários direcionados de Video Ideas, Video Research e contrato Velix passaram 26/26. Build Electron e `git diff --check` passaram. A Fase 37 ainda não é encerrada: faltam uma matriz visual completa de light/reduced motion nas rotas secundárias e uma execução Vitest global estável sem o conjunto legado que permanece propenso a travamento quando misturado a helpers E2E.

**Checkpoint 37.11 (2026-10-31).** O Vitest passou a declarar exclusões explícitas para `tests/e2e`, `tests/integration` e `tests/benchmarks`, preservando o include de `packages/*/test` e `apps/*/test`; `vitest list` não lista helpers Playwright. A matriz visual determinística `tests/e2e/final-visual-matrix.spec.ts` passou 1/1 com 36 snapshots reais: Workflows, Skills, Memória, Analytics, Git Intelligence e Configurações em dark/light, reduced motion e 1280×800/1024×768/800×700. Typecheck global, ESLint global, build Electron e `git diff --check` passaram. O comando Vitest global ainda não conclui em tempo previsível por testes de workspace que exercitam operações Git e emitem avisos de conversão de linha; testes unitários direcionados continuam aprovados. A fase permanece aberta.

**Checkpoint 37.12 (2026-10-31).** A investigação confirmou que a suíte global não estava travada: com `--no-file-parallelism --maxWorkers=1`, Workspace passou 22 arquivos/214 testes em 32,34s, Desktop passou 30/175 em 29,33s e a suíte completa passou 106 arquivos/860 testes em 145,78s. Os testes Git individuais também passaram; os avisos repetidos são `core.autocrlf` do Git em fixtures temporárias, sem falha de teste. A exclusão explícita de E2E/integração/benchmarks permanece em `vitest.config.ts`. Como a execução global dura mais de dois minutos, não foi repetida três vezes nesta rodada; a fase permanece aberta até uma repetição estável do gate completo e confirmação final de todos os E2Es/build.

**Encerramento 37 (2026-10-31).** Homologação final em `docs/plans/phase-37-final-validation.md`: três execuções globais aprovadas (860/860 em 145,78s; 862/862 em 153,07s; 862/862 em 155,52s), com a alteração concorrente de cobertura registrada; E2E crítico 52/52; matriz visual 1/1 com 36 snapshots sem atualização; typecheck, ESLint, build Electron e `git diff --check` aprovados. O `MASTER.md` permanece o baseline visual oficial. Pendências da Fase 36 foram preservadas como independentes.

**Critérios de aceite.** Cada subfase deve ter testes relevantes, typecheck, lint, build e `git diff --check` aprovados; validação visual só será declarada quando houver execução/screenshot real disponível. Não usar progresso ou estados simulados.

## Fase 39 — Velix Motion Engine

**Status:** EM EXECUÇÃO — auditada em 2026-11-01; não concluída. Dependências Remotion 4.0.539 instaladas com aprovação do usuário. Licença: gratuita para pessoas físicas, empresas com até 3 funcionários e entidades sem fins lucrativos; acima disso exige Company License. Distribuição dentro do app segue como gate de 39.8. Subplano: [phase-39-velix-motion-engine.md](plans/phase-39-velix-motion-engine.md).

39.1 Auditoria, arquitetura e contratos — IMPLEMENTADA (`motion.ts`, `velix-motion.ts`, migração 0050)
39.2 Integração mínima Remotion e render isolado — IMPLEMENTADA: render real, FFmpeg, FFprobe, cancelamento, flag `NB_MOTION_DISABLED` e manifesto com hash do roteiro e da composição
39.3 Preview integrado ao Velix — IMPLEMENTADA: Player, editor, movimento reduzido e larguras reais do app (1440, 1024 e o mínimo de 960)
39.4 Biblioteca de templates e identidade visual — IMPLEMENTADA: dois templates versionados na identidade oficial preta e laranja
39.5 Legendas cinematográficas — IMPLEMENTADA: SRT, JSON, validação, ajuste manual e alinhamento automático com a voz real (nomes separados e palavras mal ouvidas, com confiança registrada)
39.6 Motion graphics e infográficos — IMPLEMENTADA: barras e número com fonte obrigatória; 10 gráficos, 10 s a 1280x720, renderizados em 9,3 s
39.7 Composição assistida por Claude/Codex — IMPLEMENTADA: passa pelo TaskEngine read-only, respeita a trava de quota do Claude, registra o modelo informado e é capacidade do Skills Manager; aplicação continua humana; Claude e Codex reais até o MP4
39.8 Exportação híbrida e homologação — PARCIAL: render comprovado em cópia do pacote fora do repositório. Bloqueios externos separados: (a) instalador NSIS em máquina limpa com narração; (b) decisão sobre a licença do Remotion

Regra de execução: 39.1 → 39.8, sem instalar dependências antes do planejamento/contratos, sem substituir FFmpeg, preservando Fases 36/37 e sem marcar nós como concluídos sem evidência real.

## Fase 40 — NeuralBridge Guided Tours

**Status:** CONCLUÍDA em 2026-11-01. Subplano: implementação incremental no motor compartilhado `apps/desktop/src/renderer/src/app/guided-tours.tsx` e configuração declarativa por rota.

| Lote | Entrega | Estado |
|---|---|---|
| 40.1 | Motor compartilhado, onboarding, persistência versionada e acessibilidade | CONCLUÍDO com testes direcionados |
| 40.2 | Acionador compartilhado e tutoriais contextuais por rota | IMPLEMENTADO, evidência ampliada em 40.3 |
| 40.3 | Elementos assíncronos, subrotas, sidebar/modal e casos ausentes | CONCLUÍDO; typecheck global aprovado |
| 40.4 | Validação final, matriz visual, regressão e prontidão de release | CONCLUÍDO; baselines aprovadas pelo usuário e gates globais aprovados |

Critérios de aceite: toda rota principal tem configuração declarativa específica; botão Tutorial é acessível e compartilhado; iniciar/pular/concluir/reiniciar e persistência por versão funcionam; passos ausentes não bloqueiam; mudanças de rota não mantêm destaque inválido; tutorial não executa ações reais; dark/light/reduced motion/responsividade/teclado são preservados; unit, Vitest, Playwright, typecheck, lint, build e `git diff --check` têm evidência.

**Checkpoint 40.3 (2026-11-01).** O overlay passou a manter etapas declarativas durante loading, exibir fallback para alvo ausente/oculto, observar mutações com timeout limitado e cleanup, reposicionar em scroll/resize, tratar viewport parcial, Escape, foco e reduced motion. Sessões incompatíveis são desmontadas na troca de rota; Memória mantém o tour no layout compartilhado, enquanto detalhes de Projetos e Execuções não exibem o tour da lista. E2E isolado passou 17/17, incluindo as 12 páginas, rota incompatível, alvo indisponível, sidebar, resize, foco e nenhuma ação real. Typecheck desktop, ESLint global, build Electron, unitários 4/4 e `git diff --check` passaram. O typecheck global permanece bloqueado por três erros concorrentes em `tests/e2e/skills-transactional-full.spec.ts` (Fase 41); a Fase 40 continua aberta e 40.4 não foi iniciado.

**Checkpoint 40.4 (2026-11-01).** A validação específica foi executada em build Electron novo: `tests/e2e/guided-tours.spec.ts` passou 18/18, incluindo a fixture modal segura; `tests/e2e/guided-tours-visual.spec.ts` passou 14/14, cobrindo Dashboard, Chat, Execuções, Memória, Skills, Projetos, Git Intelligence, Agentes, MCPs, Analytics, Workflows, Mission Control, Velix e Configurações em dark/light, desktop/compact e reduced motion; Vitest serial passou 117/117 arquivos e 936/936 testes; unitário Guided Tours passou 4/4; ESLint global, typecheck global, build Electron e `git diff --check` passaram. A matriz de snapshots preexistente (`final-visual-matrix.spec.ts`) encontrou diferença em `skills-dark-1280x800.png` causada por UI de Guided Tours/onboarding; nenhum snapshot foi atualizado automaticamente. A Fase 40 permanece aberta até a revisão deliberada desse baseline visual.

## Fase 41 — NeuralBridge Skills Intelligence & Studio

**Status:** CONCLUÍDA em 2026-11-01. Especificação: [phase-41-skills-intelligence-studio.md](plans/phase-41-skills-intelligence-studio.md). Design: [skills-intelligence-studio-design.md](superpowers/specs/2026-11-01-skills-intelligence-studio-design.md). Design do Lote 6: [skill-studio-lot-6-design.md](superpowers/specs/2026-11-01-skill-studio-lot-6-design.md). Plano incremental: [skill-studio-lot-6.md](superpowers/plans/2026-11-01-skill-studio-lot-6.md).

**Arquitetura escolhida:** novo submódulo `packages/workspace/src/skills/`, mantendo `skills.ts` como fachada operacional compatível. O submódulo reúne contratos, inteligência incremental e o serviço filesystem-first do Studio; não cria motor paralelo e reutiliza o instalador, Trust Center, Discovery e Recommendation existentes.

| Lote | Entrega | Estado |
|---|---|---|
| 41.1 | Auditoria, contratos, inventário, confiança e matriz de integração | IMPLEMENTADO |
| 41.2 | Discovery Engine local/global/projeto e fontes remotas autorizadas | CONCLUÍDO com testes direcionados |
| 41.3 | Recommendation Engine determinístico e contextual | CONCLUÍDO com testes direcionados |
| 41.4 | Security & Trust Center | CONCLUÍDO com testes direcionados |
| 41.5 | Instalação, atualização, backup e rollback | IMPLEMENTADO; homologação concluída no Lote 5.3 |
| 41.5.1 | Integração IPC, Skills Manager, autorização contextual e E2E | IMPLEMENTADO; fluxo transacional integrado |
| 41.5.2 | Estabilização dos bloqueios concorrentes e homologação do instalador | IMPLEMENTADO; bloqueios concorrentes resolvidos e gates globais aprovados |
| 41.5.3 | Homologação E2E transacional completa com fixtures locais | IMPLEMENTADO; 5/5 E2Es direcionados aprovados |
| 41.6 | Skill Studio visual/Markdown | IMPLEMENTADO; gates direcionados aprovados |
| 41.7 | Integração com TaskEngine e Token Optimizer | IMPLEMENTADO: contexto limitado pelo orçamento e estimativa registrada em `tokenAnalytics` (`neuralbridge-skills`) |
| 41.8 | Integração com Workflow Builder | IMPLEMENTADO: `skillIds` e `requiredSkillIds` na tela e no runner, com E2E de etapa bloqueada |
| 41.9 | Git Intelligence, memória, RAG e analytics | CONCLUÍDO: `skills_context` com Git e memória comprovado com Claude e Codex reais; evento `skills_skipped`; preferências valem sem reiniciar |
| 41.10 | UX, E2E, acessibilidade, estabilidade e homologação | CONCLUÍDO: agentes reais, reinício, teclado, nomes acessíveis, temas, movimento reduzido, largura mínima de 960 px e gates finais |

**Checkpoint 41.6 (2026-11-01).** O Skill Studio foi integrado sem refatoração integral de `skills.ts`. `packages/workspace/src/skills/studio.ts` persiste drafts, sidecars e snapshots em `userData/skill-studio` com escrita atômica, fingerprint canônico, lock por draft e rejeição de conflito externo; publicação/restauração reutilizam o instalador transacional global existente. A `SkillsPage` ganhou editor de metadata/instruções, preview, Trust Center, histórico, diff, restore, import/export de diretórios e simulação read-only de Recommendation. `managed-skills` entrou nas raízes existentes para refletir publicação no Discovery, sem alterar Claude Code/Codex.

Evidência do lote: `skills-studio.test.ts` 11/11, `skills-installer.test.ts` 5/5 e IPC 27/27; regressão direcionada dos módulos de Skills 66/66; E2Es Skills/Studio/transacionais 8/8; build Electron, lint direcionado, typecheck de shared/workspace/desktop-node direcionados e `git diff --check` aprovados. O Studio também reconcilia snapshots com metadata sidecar após interrupção entre commit e índice de versões, e exportações removem essa metadata interna. A suíte Vitest completa chegou a 952/955 em 120 arquivos; os três timeouts de Git/projeto/queue passaram 51/51 em rerun serial com timeout de 15s. O typecheck global continua bloqueado pela alteração concorrente que importa a entrada raiz de `@neuralbridge/shared` em `apps/desktop/src/renderer/src/pages/GitIntelligencePage.tsx`, fazendo `tsconfig.web.json` com `types: []` diagnosticar `node:path`/`process` em `packages/shared/src/paths.ts`; o lint global continua bloqueado por `test-git-validation-enhanced.cjs`, alteração concorrente não rastreada com `require()` proibido. Nenhum desses arquivos foi alterado.

## Fase 38 — Git Intelligence 2.0

**Status:** 38.3, 38.4 e 38.5 CONCLUÍDAS em 2026-11-01. Subplano: [phase-38-git-intelligence-2.md](plans/phase-38-git-intelligence-2.md).

**Dependências:** Fases 25, 31.4, 33.5, TaskEngine, Workflow Builder e Brain/RAG. Evoluir a estação Git local-first sem substituir Git, sem operações destrutivas implícitas e sem duplicar persistência.

| Subfase | Entrega | Estado |
|---|---|---|
| 38.1 | Auditoria, inventário e correções reproduzidas | CONCLUÍDA |
| 38.2 | Git Graph 2.0 | CONCLUÍDA |
| 38.3 | Working Tree, Diff Explorer & Git Operations Manager | CONCLUÍDA |
| 38.4 | AI Code Review & Bug Detective | CONCLUÍDA |
| 38.5 | Smart Commit & PR Assistant | CONCLUÍDA: gates globais e E2E com Codex real aprovados |
| 38.6 | Git Automation & Workflow Builder | PARCIAL: gatilhos, dedupe, limites, disjuntor, painel e E2E vieram da Fase 31.4; faltam nós de workflow com grants do GitWriter |
| 38.7 | Git Memory, Health & Observability + hardening | PLANEJADA: auditoria não encontrou código de health nem ligação do Git com a memória |
| 38.8 | Hardening final e distribuição | PLANEJADA: depende da validação em máquina limpa |

### Plano de melhoria visual — Git Intelligence

**Status:** IMPLEMENTADA PARCIALMENTE. A proposta foi registrada em 2026-11-02 a partir da revisão visual da tela e começou a ser aplicada nesta execução. A página agora mantém cabeçalho fixo, elimina o scroll global do conteúdo, usa scroll interno no corpo e no card de arquivos e separa as áreas extensas em abas contextuais (`Visão geral`, `Automações`, `Revisão IA`, `Commit e PR` e `Operações`). Esta frente é somente de UI/UX; preserva os contratos IPC, os serviços Git e a persistência existentes.

**Objetivo:** transformar a página em um cockpit Git local-first, com histórico como foco principal, sem scroll global, conteúdo secundário separado por abas e pesquisa contextual apenas onde houver listas extensas.

**Decisões fixadas:**

- A página inteira usa a altura disponível e não possui scroll vertical global.
- O grafo, listas, working tree e diff possuem scroll interno em seus próprios cards.
- A aba inicial é `Histórico`.
- Ferramentas secundárias ficam em abas: `Working tree`, `Branches`, `Stash`, `Comparar`, `Revisão IA` e `Automações`.
- Pesquisas são contextuais: commits por hash/mensagem/autor/arquivo; branches e tags por nome; working tree por caminho/status; stash por referência/descrição; revisão IA por severidade/arquivo/confiança.
- Não adicionar pesquisa a listas pequenas; evitar inputs redundantes.
- Manter `data-tour` e os fluxos atuais de seleção, stage, commit, branches, stash, comparação e revisão.

**Validação da implementação inicial (2026-11-02):** `git-intelligence-graph.spec.ts`, `git-automations.spec.ts`, `git-smart-commit.spec.ts` e `git-write-operations.spec.ts` passaram em conjunto **22/22 E2E** após a adaptação dos seletores para as abas. Permanecem para o fechamento visual: revisão em tema claro, movimento reduzido, auditoria de foco/teclado por aba e inspeção final em 800/1280 px.

**Correção de fluxo (2026-11-02):** a atualização das permissões da Neura passou a serializar patches IPC, eliminando a sobrescrita de consentimentos quando três caixas são marcadas rapidamente. O Git Intelligence ganhou leitura local de branch/upstream, contagem à frente/atrás, lista de commits ainda não publicados e push manual protegido por grant e confirmação; não há push implícito ao criar um commit. Vitest direcionado passou 42/42; E2E de permissões, sincronização/push e comparação passou 1/1 cada; `npm run typecheck` e `npm run build` passaram.

**Escopo de implementação:**

- reorganizar `apps/desktop/src/renderer/src/pages/GitIntelligencePage.tsx` em componentes visuais menores, sem alterar a lógica de dados;
- criar shell com altura fixa, `min-height: 0` e `overflow: hidden` no nível da página;
- manter sidebar de referências, histórico central e detalhes do commit em painéis com scroll interno;
- mover operações secundárias para navegação por tabs acessível por teclado;
- adicionar resumo no cabeçalho para projeto, branch atual, working tree e quantidade de commits;
- preservar estado vazio, loading, erro, seleção e diff real;
- atualizar os seletores do guided tour somente se a nova composição exigir.

**Ordem:**

- [x] Extrair o shell e os painéis de referências, histórico e detalhes do commit.
- [x] Bloquear o scroll global e validar scroll interno em 1280×800, 1024×768 e janela estreita.
- [x] Criar as tabs de ferramentas sem remover nenhuma operação existente.
- [ ] Adicionar pesquisas contextuais e filtros rápidos do histórico.
- [ ] Ajustar hierarquia visual, contraste, foco, estados de loading/erro e `prefers-reduced-motion`.
- [ ] Atualizar ou preservar guided tours e acessibilidade dos controles.
- [ ] Validar typecheck, E2Es de Git Intelligence, Git Review e Smart Commit, além da inspeção visual.

**Critérios de aceite:**

- [ ] A página não rola; somente cards com conteúdo longo rolam.
- [ ] Nenhuma funcionalidade Git existente desaparece ou muda de contrato.
- [ ] Ferramentas secundárias não ficam todas expostas simultaneamente.
- [ ] O commit selecionado continua acessível enquanto o usuário navega pelas tabs.
- [ ] Pesquisas aparecem apenas em listas que justificam filtragem.
- [ ] Tabs funcionam com teclado e possuem estado acessível.
- [ ] Typecheck e testes E2E relevantes passam.

**Validação planejada:** `npm run typecheck --workspace @neuralbridge/desktop`; `npx playwright test tests/e2e/git-intelligence-graph.spec.ts`; `npx playwright test tests/e2e/git-review-real.spec.ts`; `npx playwright test tests/e2e/git-smart-commit.spec.ts`.

**Checkpoint 38.1 (2026-10-31).** Auditoria real registrada no subplano. A matriz de fixtures cobriu repositório sem commits, detached HEAD, rename, binário, Unicode, worktree, raiz ausente e diretório sem Git. Foram corrigidos dois bugs reproduzidos: truncamento de branch com ponto em `gitInfo()` e `ENOENT` de `gitRepositories()` para raiz ausente. Regressão focada passou 10/10; lint/typecheck direcionados e `git diff --check` aprovados. Submódulos permanecem read-only sem download recursivo. Limitações de histórico, refs, DAG/cursor e UI dedicada permanecem planejadas.

**Checkpoint 38.2 (2026-10-31).** Além do núcleo anterior, o Diff Explorer agora abre o patch real do commit selecionado via `git show`, sem alterar o diff da working tree. Loading, repositório vazio, raiz removida, filtro sem resultados e erro de leitura têm estados distintos e acessíveis. E2E dedicado passou 4/4 na suíte Git Graph e o benchmark Electron passou 1/1 com fixture Git fast-import de 5.000 commits: primeira renderização 4067 ms, seleção 29 ms, scroll 5 ms, 150 elementos DOM, 22 elementos SVG/path e 21 commits montados para viewport de 560 px; a altura virtualizada foi 7608 px. O E2E de merge confirmou arestas somente entre hashes presentes e ausência de continuidade falsa. Screenshots Electron reais foram capturados e inspecionados em 1280×800 e 800×700; foi corrigida a sobreposição visual do modo compacto. Vitest focado passou 17/17, typechecks shared/workspace/desktop, ESLint, build Electron e `git diff --check` passaram. Fase 38.2 CONCLUÍDA; relatório de benchmark: `docs/plans/phase-38.2-renderer-benchmark.md`. A Fase 38.3 foi iniciada com auditoria dos contratos GitWriter.

**Checkpoint 38.3 (2026-10-31).** A autorização tornou-se obrigatória para Stage/Unstage, branches, Stash e Commit: IPC exige token, o renderer pede confirmação antes de emitir grant, o main revalida estado e consome grant de uso único antes de executar. O núcleo real de Stash/Commit está integrado a shared, schemas IPC, handlers main e preload: listar, criar com untracked opcional, aplicar, pop, drop e commit somente com índice staged e mensagem válida; refs de stash são revalidadas antes de cada operação. Testes reais passaram 32/32; typecheck, lint e `git diff --check` passaram. UI completa de Stash/Commit/branches, revert, cherry-pick e recuperação de conflitos ainda permanecem pendentes.

Atualização do checkpoint: o painel operacional de branches, stash e commit foi integrado à Git Intelligence com confirmação contextual, grants específicos, estados vazios e atualização das consultas. Revert, cherry-pick, recuperação de conflitos e E2Es dos fluxos de escrita permanecem pendentes.

Nova atualização: Revert e Cherry-pick foram integrados ao workspace, IPC, preload, main e Git Intelligence. Commits de merge exigem mainline explícito; working tree sujo e operações pendentes bloqueiam novas ações; continue/abort usam ações explícitas. Fixtures reais passaram 34/34 após correção do formato `--continue/--abort`. Permanecem pendentes os E2Es Electron/Playwright dos fluxos de escrita e a validação visual completa do painel de conflitos.

Validação E2E: a suíte `tests/e2e/git-write-operations.spec.ts` passou 7/7 e a suíte Git Graph passou 4/4, usando repositórios temporários reais. Foram comprovados Stage/Commit, branches, Stash apply/pop/drop, Revert, Cherry-pick, conflito real com painel, Abort seguro e Continue após resolução manual. A causa do bloqueio foi corrigida na UI: arquivos `conflict` chegam como `staged=true, unstaged=true` e agora exibem Stage para concluir a resolução. Screenshots 1280×800/800×700 permanecem registradas. A Fase 38.3 continua aberta até cobrir merges com mainline na UI, cancelamentos e cenários IPC/worktree/hooks/concorrência.

Matriz de aceite (checkpoint): Stage/Unstage — workspace + E2E — aprovado; Branch Manager — workspace + E2E — aprovado; Stash — workspace + E2E — aprovado; Commit — workspace + E2E — aprovado; autorização single-use/expiração/parâmetros — testes diretos — aprovado; Revert/Cherry-pick simples — workspace + E2E — aprovado; conflito real, Abort e Continue após resolução manual — workspace + E2E + screenshots — aprovado; merges com mainline na UI — aprovado no E2E dedicado; cancelamentos, hooks, worktrees, bypass IPC e concorrência — pendentes.

Atualização do checkpoint: a UI de operações de histórico agora exige mainline explícita para commits de merge, valida valores fora do intervalo sem tocar no repositório e vincula o valor ao grant. E2E Electron real `Merge history action requires an explicit valid mainline in the Electron UI` passou 1/1 em fixture temporária com merge de dois pais; a suíte Git Write passou 8/8 após rebuild Electron. Typecheck web, ESLint da página e `git diff --check` passaram. Tentativas de E2E para cancelamento e hook foram revertidas por timeout não determinístico no runner Windows e não são consideradas evidência; a Fase 38.3 permanece aberta pelos cenários de cancelamento, hook com falha, worktree, bypass direto dos handlers e concorrência entre grants distintos.

Checkpoint adicional: teste de integração real `apps/desktop/test/projects.test.ts` passou 12/12, incluindo rejeição de Stage sem grant e com parâmetros incompatíveis no limite do serviço principal, com índice preservado. Essa evidência não é declarada como teste direto dos handlers IPC; os handlers continuam wrappers registrados em `apps/desktop/src/main/index.ts` e precisam de harness específico para invocação real.

Auditoria de hooks: `packages/workspace/src/git-write.ts` mantém `core.hooksPath=` em `SAFE_WRITE` por decisão de segurança, impedindo a execução de código fornecido pelo repositório. O cenário de hook pre-commit não é aplicável ao GitWriter atual e não foi contado como aprovado; alterar essa política exigiria decisão de segurança fora do escopo desta validação.

Validação da política de hooks: o teste real `does not execute repository hooks under the SAFE_WRITE policy` passou dentro de `packages/workspace/test/git-write.test.ts` (33/33). Um hook sentinela que falharia não executou e o commit autorizado seguiu; execução de hooks continua explicitamente fora do contrato SAFE_WRITE.

Worktrees: fixture Git real com `git worktree add` passou em `git-write.test.ts` (34/34); exclusão e alternância para branch usada por outra worktree foram rejeitadas, com HEAD preservado nas duas árvores.

Handlers IPC: extraído `createGitIpcHandlers` para o mapeamento de produção usado pelo `index.ts`, sem duplicar autorização. Teste de integração `invokes the production Git IPC handler mapping against the real project service` passou em `apps/desktop/test/projects.test.ts`; a suíte do arquivo passou 13/13, cobrindo Stage sem grant e Stage autorizado via o mesmo mapeamento. Ainda não há harness que inicialize `ipcMain` real para todos os canais.

Atualização IPC: `registerGitIpcHandlers` agora encapsula o mesmo registro `registerIpcHandler` usado pelo Electron Main. Um teste controlado de `IpcMainLike` invocou literalmente o callback registrado de `projects:git:stage`; payload válido sem grant foi rejeitado e grant válido executou Stage. `projects.test.ts` passou 13/13. A cobertura literal dos demais canais ainda não foi declarada.

Cobertura incremental IPC: callbacks registrados de `projects:git:unstage`, `projects:git:commit` e `projects:git:branch:delete` foram invocados literalmente. Cada caso rejeitou token ausente sem alterar o estado e executou com grant válido em fixture temporária; o teste focado executou 4 casos (Stage + os três novos) e passou 4/4. Stash, revert, cherry-pick e resolve continuam pendentes.

Nova cobertura IPC: callbacks literais de `projects:git:stash:create`, `projects:git:stash:drop`, `projects:git:branch:create`, `projects:git:branch:switch` e `projects:git:branch:rename` passaram em 2/2 testes focados. Stash e branches rejeitam token ausente, preservam o estado e executam com grants válidos em fixtures reais. Revert, Cherry-pick e Continue/Abort permanecem pendentes.

Fechamento da matriz IPC: Stash Apply, Revert, Cherry-pick e Operation Resolve/Abort foram exercitados literalmente em 3/3 casos novos; além disso, dois grants distintos foram consumidos em paralelo para Stage, preservando ambos os arquivos staged e o HEAD. A matriz cobre todos os handlers de escrita registrados, exceto Continue e Stash Pop ainda não testados em caminho específico. O E2E de cancelamento de Commit foi tentado com trace implícito, mas travou antes de uma condição observável e foi removido sem ser contado como aprovado.

Regressão desta execução: 3 arquivos Vitest passaram, totalizando 59/59 testes; Git Graph + Git Write passaram 12/12 E2Es; typecheck, ESLint, build Electron e `git diff --check` passaram. A cobertura IPC nova é real para Stash Apply, Revert, Cherry-pick e Abort; Continue, Pop específico, concorrência de operações incompatíveis e cancelamentos permanecem abertos.

Atualização: Stash Pop e Continue foram validados por callbacks IPC literais em 2/2 casos focados, com conflito real, limpeza do estado pendente e efeitos Git verificados. A regressão focada atual passou 60/60 testes. Permanecem concorrência incompatível e cancelamentos contextuais.

Frente A avançou com correção real: `protectedWrite` agora serializa escritas por raiz do repositório e revalida o fingerprint dentro da seção crítica. O teste Commit + Stage com dois grants distintos comprovou uma operação concluída e a outra rejeitada por autorização obsoleta, sem corrupção de HEAD/índice; passou 1/1. Concorrência específica de HEAD/branch entre worktrees ainda precisa de fixture dedicada.

Regressão após a fila: build Electron aprovado; Vitest Git/workspace/projetos/autorização passou 61/61; typecheck, ESLint e `git diff --check` passaram. A Frente B continua bloqueada no runner Windows: o teste de Commit cancellation trava antes do checkpoint de Stage/diálogo mesmo após o harness não interativo; não é contado como E2E.

### Encerramento da Fase 38.3 — Git Operations Manager (2026-11-01)

A Fase 38.3 foi encerrada após validação incremental real. O `protectedWrite` agora usa `git rev-parse --git-common-dir` como identidade canônica da fila, serializando operações de worktrees do mesmo repositório e revalidando autorização somente depois da aquisição da seção crítica. O wrapper de produção `registerGitIpcHandlers` possui cobertura literal dos 13 canais de escrita registrados, incluindo sender não confiável bloqueado antes da escrita.

Evidências desta rodada:

- `apps/desktop/test/projects.test.ts`: 28/28; inclui rename de refs compartilhadas, dois HEADs independentes em worktrees, branch switch concorrente com Stage, barreiras determinísticas e bypass de sender rejeitado.
- Regressão Git/workspace/projetos/autorização: 65/65 antes da última alteração somente de tipo; suíte global posterior: 902/902 em 174,54 s.
- `tests/e2e/git-write-operations.spec.ts`: 15/15, com Commit, Branch Delete, Stash Drop, Revert, Cherry-pick, Continue e Abort cancelados na primeira confirmação, estado Git preservado e segunda confirmação executando a operação real.
- `tests/e2e/git-intelligence-graph.spec.ts`: 4/4; typecheck global, `npm run lint`, build Electron e `git diff --check` aprovados. O ajuste de contrato `mainline?: number | undefined` também foi validado pelo typecheck global final.

Matriz final de aceite: Stage/Unstage — aprovado; branches e worktrees — aprovado; Stash/Commit — aprovado; Revert/Cherry-pick e mainline — aprovado; Continue/Abort e conflitos reais — aprovado; autorização single-use, estado obsoleto, sender não confiável e concorrência — aprovado; cancelamentos contextuais — aprovado; SAFE_WRITE/hooks — aprovado como política de não execução de hooks. Não houve operação Git destrutiva, commit ou push no repositório real.

**Decisão:** Fase 38.3 CONCLUÍDA. As notas históricas anteriores que mencionavam cancelamentos, worktrees ou IPC pendentes foram supersedidas por esta matriz final; hooks de projeto continuam intencionalmente fora do contrato por `core.hooksPath=`.

### Início da Fase 38.4 — AI Code Review e Bug Detective (2026-11-01)

O kickoff foi iniciado sem criar uma arquitetura paralela. A auditoria encontrou: adaptadores reais em `packages/agents/src/claude-adapter.ts` e `codex-adapter.ts`; execução, aprovação, revisão e evidências persistidas em `packages/orchestrator/src/engine.ts`; contexto e indexação Git/RAG em `packages/brain/src/git-index.ts`, `rag-engine.ts` e `rag-context.ts`; e leitura/diff/operações Git centralizadas em `apps/desktop/src/main/projects.ts`, `git-ipc-handlers.ts` e `git-automation.ts`. A implementação reutiliza esses contratos, mantém revisores read-only, registra evidências no TaskEngine e consulta Brain/RAG sem duplicar memória ou serviço de agentes.

Checkpoint 38.4 — revisão e patches sugeridos (2026-11-01): contratos Zod para escopo, severidade, confiança, achados e relatório foram adicionados em `packages/shared/src/git-review.ts`; `TaskEngine.startGitReview()` coleta diffs reais de working tree/commit/range, redige secrets, delimita diff/contexto RAG como conteúdo não confiável, executa Claude/Codex em modo read-only e persiste `git_review_scope`/`git_review_result` em `task_events`. IPC/main/preload expõem início e consulta do relatório, e `GitIntelligencePage` exibe andamento, achados, evidências, arquivo/linha e patch em pré-visualização.

O fluxo de patch sugerido foi concluído de forma controlada: `validateGitPatch()` rejeita formato ausente, NUL, tamanho excessivo, caminhos absolutos e traversal; `gitApplyPatch()` executa `git apply --check` antes de aplicar e nunca faz stage/commit. A autorização é contextual por SHA-256 do patch, estado Git atual e operação `apply-patch`, usando o mesmo `protectedWrite`/fila por `git common-dir`; a UI exige confirmação explícita, invalida o working tree e mostra feedback, sem commit automático. Um bug comprovado no fingerprint de autorização foi corrigido: staged/unstaged agora são diferenciados, com escopo por caminho somente em Stage/Unstage para preservar Stage concorrente em arquivos distintos.

Evidências desta retomada: `tests/e2e/git-review-real.spec.ts` passou 1/1 em 13,4 s usando o adapter real do Codex e uma fixture Git temporária. O fluxo completo persistiu o relatório em `task_events`, exibiu o achado e o patch no Electron, pediu autorização explícita, aplicou o patch real, manteve HEAD e índice corretos e não criou commit. As capturas `prints/git-review-real-1280.png` e `prints/git-review-real-800.png` foram capturadas e inspecionadas. As regressões do TaskEngine cobrem JSON do Codex entregue como texto final; as regressões Git cobrem patch unificado sem newline final, normalizado antes de `git apply --check`.

Validações finais: foco review/tasks/projetos/Git write 82/82; workspace Git write 40/40; review 3/3; E2Es Electron Git Graph + Git Write 19/19; E2E real Codex 1/1; `npm run typecheck` global, `npm run lint`, build Electron e `git diff --check` aprovados. O bloqueio anterior registrou em `tests/e2e/skills-transactional-full.spec.ts` os diagnósticos `(18,93) TS2353` (`days` não existe em `SelfsignedOptions`), `(42,95)` (`string | undefined` não atribuível a `string`) e `(43,95)` (`string` não atribuível a `"project" | "global"`). A investigação confirmou que o arquivo é alteração concorrente não rastreada da Fase 41; não foi modificada e os três erros não se reproduziram.

**Decisão final 38.4:** CONCLUÍDA em 2026-11-01. O fluxo real de provider, revisão, persistência, patch, autorização, aplicação explícita e auditoria visual está comprovado. A Fase 38.5 foi iniciada incrementalmente nesta execução, sem alterar o trabalho concorrente.

### Fase 38.5 — Smart Commit & PR Assistant: execução (2026-11-01)

Auditoria: o fluxo reutiliza `TaskEngine`, `ClaudeCliAdapter`/`CodexCliAdapter`, `gitStagedDiff()`, RAG/context provider, `task_events`, IPC/preload existentes e `GitAuthorizationService`/`protectedWrite` para a única escrita explícita de commit. Não foi criado um serviço paralelo de agentes, persistência de PR ou integração remota.

Implementado: contrato Zod em `packages/shared/src/smart-commit.ts`; canais, schemas IPC, main, preload e consulta persistida de relatório; coleta exclusiva do índice staged (sem incluir working tree ou untracked); prompt read-only que trata diff e RAG como conteúdo não confiável; seleção Auto/Claude/Codex; proposta estruturada de Conventional Commit, corpo editável, título/descrição de PR, checklist, changelog e impacto documental; redaction de secrets tanto no prompt quanto na proposta antes de `task_events`; limite explícito de 500 caracteres alinhado ao GitWriter; confirmação contextual antes de autorizar/commit; nenhum push, PR ou commit durante a geração.

Evidências visuais: `prints/git-smart-commit-1280.png` e `prints/git-smart-commit-800.png` foram capturadas no Electron e inspecionadas. O painel mantém labels associados, feedback de loading/erro/sucesso, foco nativo, layout de duas colunas com reflow em janela menor, tokens do NeuralBridge e controles sem ícones soltos.

Matriz incremental de aceite: diff staged real e exclusão de unstaged/untracked — aprovado por `packages/workspace/test/git-staged-diff.test.ts` (1/1); proposta estruturada, modo read-only, RAG/evento e persistência — aprovado por `packages/orchestrator/test/smart-commit.test.ts` (4/4); contratos IPC — implementados e cobertos no teste compartilhado, mas a suíte compartilhada atual está bloqueada por duas falhas concorrentes pré-existentes em Skill Studio/ref traversal; secrets no prompt e na saída persistida — aprovado por regressões do TaskEngine; edição, limite, confirmação, commit real e ausência de push/PR — aprovado por `tests/e2e/git-smart-commit.spec.ts` (1/1) em fixture temporária; build Electron — aprovado; ESLint dos arquivos da fase — aprovado; `git diff --check` — aprovado.

Regressão ampla selecionada (`smart-commit`, `git-review`, `git-staged-diff`, `git-write`): 48/48. `npx tsc -p packages/shared/tsconfig.json` e `npx tsc -p packages/orchestrator/tsconfig.json` passaram. `npm run typecheck` global permanece bloqueado sem alteração nesta fase por `packages/workspace/src/skills/studio.ts` (Fase 41 concorrente: metadata/arrays/Map); `npm run lint` global permanece bloqueado por esse arquivo e por `test-git-validation-enhanced.cjs`. O build Electron e o lint direcionado passaram; nenhum desses arquivos foi modificado.

**Decisão 38.5 neste checkpoint:** EM EXECUÇÃO. A implementação funcional principal está integrada e validada, mas a fase não é marcada como concluída enquanto os quality gates globais concorrentes não forem revalidados. Próxima ação: reexecutar typecheck/lint globais quando Fase 41 liberar a base, e então fechar a matriz sem declarar resultados não executados. O E2E com CLI real não foi executado porque `NB_REAL_CLI` não está habilitado nesta sessão; o E2E determinístico usa o adapter real da aplicação apontado para fixture de agente, sem substituir o TaskEngine/IPC/Git.

## Atualização de execução — 2026-11-01

### Fase 41 — Skills Manager

- **41.9 IMPLEMENTADA nesta retomada:** `createSkillIntelligenceProvider` integra Git Intelligence, Brain/RAG, memória/contexto e analytics de uso em modo read-only, com orçamento, referências e delimitação de conteúdo não confiável. Recommendation e TaskEngine consomem os serviços existentes; `skills.ts` e os contratos legados foram preservados.
- **41.10 (registro histórico):** ver o fechamento de 2026-11-01 no fim deste arquivo.

### Fase 39 — Velix

- **39.5:** alinhamento automático de legendas com narração integrado ao transcritor existente, IPC/preload/UI e direitos.
- **39.7:** sugestão de composição integrada ao TaskEngine read-only e registrada como capacidade no Skills Manager; aplicação continua humana.
- **39.8 permanece parcial:** NSIS em máquina limpa com narração e análise jurídica da licença Remotion continuam bloqueios externos.

### Fase 36 e auditorias

- VoiceStudio auditado: API 0.5 em `localhost:3900`, aplicativo AGPL-3.0 e licenças separadas para modelos/vozes/saída. Implementação e homologação registradas abaixo.
- 38.6–38.8 foram auditadas e continuam planejadas; 38.5 foi preservada como concluída e não reimplementada.
- Template 3 da Fase 31: pendência encerrada; a alegação sobre `validation.ts` estava desatualizada.
- A validação de instalação limpa da Fase 16 continua pendência externa; não há máquina limpa NSIS disponível nesta sessão.

## Fase 42 — NeuralBridge Companion & Remote Agent Control

**Status:** EM EXECUÇÃO (2026-11-01). A numeração 42 foi verificada como livre após a Fase 41. Os Lotes 42.1 e 42.2 estão parcialmente implementados; nenhum lote foi concluído formalmente. Um subplano TDD separado deverá ser criado para os próximos lotes quando necessário.

### Auditoria e decisões arquiteturais

O NeuralBridge Companion será uma superfície flutuante opcional do Electron para Windows, apoiada pelo TaskEngine existente e pelo Mission Control, não uma segunda engine nem uma nova fonte de verdade. O estado persistido continua em `tasks`, `task_steps`, `task_events`, sessões, permissões e analytics existentes; o Companion recebe projeções bounded e comandos validados por IPC. A separação é explícita: observação (eventos e HUD), controle (pausar/retomar/cancelar/chat) e autorização (Permission Broker com decisão humana) são contratos distintos.

O baseline atual já fornece `packages/orchestrator`/TaskEngine com estados, steps, eventos, retomada e `ProjectLock`; `packages/agents` tem `ProcessRunner`, parsers e adaptadores Claude/Codex; `packages/shared` tem contratos Zod, canais IPC e eventos tipados; Mission Control consulta o mesmo banco; Analytics lê uso persistido; o Electron main é o único executor de CLIs; `electron-builder.yml` empacota NSIS x64, `asarUnpack`, MCP/migrations e dados em `%APPDATA%`. OpenCode ainda não é um adaptador registrado no baseline e deve entrar como capacidade opcional, sem presumir que oferece controle síncrono.

O estudo de Coucou informa, sem copiar implementação ou identidade: sessões ao vivo por eventos de hooks/relay; estados canônicos (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `StopFailure`, `SessionEnd`); pills/HUD; diffs e ticker; cards de aprovação que permanecem até decisão; perguntas estruturadas; adaptadores para Claude Code, Codex e OpenCode; pipe nomeado por usuário no Windows; pareamento móvel por QR e certificado pinado; gateway desligado por padrão; Android com autenticação local e expiração de pedidos. O código é MIT, mas “Coucou”, “Mochi”, personagem, ícones, sons e mídia permanecem protegidos e não serão reutilizados. A experiência Windows do Coucou também evidencia SmartScreen sem assinatura, múltiplos monitores e conflitos de atalhos AltGr como riscos de produto, não como dependências a copiar.

**Objetivo:** acompanhar sessões reais, mostrar um HUD discreto e permitir somente ações que o agente e o contrato de autorização suportem; preparar controle móvel seguro sem expor o TaskEngine diretamente na rede.

**Não objetivos/anti-objetivos:** não criar segundo TaskEngine, Mission Control, banco ou canal de execução; não transformar parsing de terminal em contrato primário; não conceder aprovação externa quando o agente não possui correlação/ack seguro; não instalar hooks de terceiros destrutivamente; não usar serviços pagos ou gateway remoto obrigatório; não copiar Mochi, sons, mídia, nomes ou identidade visual.

**Plano de entrega e gates:** MVP Windows = 42.1–42.5; Experiência Companion = 42.6–42.7; Controle móvel = 42.8–42.9; Finalização = 42.10–42.12. Gate A exige contratos, matriz de capacidades e migração/recuperação aprovadas antes do HUD. Gate B exige observação real, correlação de sessão e Permission Broker seguro antes de chat/companion. Gate C exige TLS, pareamento, revogação, gateway opt-in e testes de ameaça antes de qualquer app móvel. Gate D exige analytics reconciliado, acessibilidade, testes de reinício e distribuição Windows antes de homologação. Nenhum gate autoriza commit/push/checkout/merge automático.

**Contratos transversais:** tipos TypeScript/Zod para `AgentSession`, `CanonicalAgentEvent`, `SessionProjection`, `PermissionRequest`, `ApprovalDecision`, `CompanionCommand`, `MobilePairing`, `RemoteConnection` e `CapabilityMatrix`; IDs ULID, `sessionId` + `taskId` + `requestId` obrigatórios, `schemaVersion`, sequência monotônica, timestamp do produtor e `correlationId`; decisões single-use, TTL curto, nonce, fingerprint do pedido e vínculo à sessão/projeto; redaction antes de persistir/renderizar; idempotência por `eventId`/`decisionId`; recuperação sempre a partir do banco/event log.

### 42.1 — Auditoria, arquitetura e contratos

- **Objetivo:** fechar inventário de TaskEngine, Mission Control, IPC, agentes, permissões, analytics, banco, Electron e packaging; definir limites do Companion e matriz de capacidades por agente.
- **Estado inicial:** componentes existentes e persistidos; não existe Companion/Session Registry/Permission Broker móvel.
- **Dependências:** Fases 11, 16, 17, 22, 29, 31, 32, 33, 38.6–38.8 e 41; conclusão formal das pendências não é pré-requisito para documentar, mas falhas abertas viram gates.
- **Arquivos/módulos:** `docs/PLAN.md`, `docs/STATUS.md`, `packages/shared/src/{agents,channels,ipc}.ts`, `packages/orchestrator`, `packages/agents`, `apps/desktop/src/main`, `electron-builder.yml`, `MASTER.md`.
- **Contratos:** `AgentCapabilityMatrix`, eventos canônicos, versionamento IPC, política de compatibilidade v1 e threat model.
- **Tarefas:** mapear fontes de evento e lacunas; classificar observação/controle/autorização; registrar capacidades Claude/Codex/OpenCode; decidir hooks opt-in com backup/merge preservado; definir limites de payload, retenção e recuperação.
- **Testes:** testes de schemas, compatibilidade de eventos desconhecidos, matriz de capacidades e revisão de threat model.
- **Aceite:** arquitetura aprovada sem segundo engine; todos os lotes têm dependência/rollback/evidência; nenhuma funcionalidade marcada implementada.
- **Riscos/rollback:** escopo excessivo e contratos incompatíveis; rollback é remover a especificação da fase sem alterar runtime.
- **Evidências:** inventário assinado por caminho/linha, diagrama de fluxo, matriz de capacidades, threat model e decisão de não duplicação.

**Implementação do Lote 42.1 (2026-11-01):** contratos mínimos foram adicionados em `packages/shared/src/companion.ts` e exportados pela entrada principal e pelo subpath `@neuralbridge/shared/companion`. O contrato separa `CompanionEvent` observado de `CompanionPermissionRequest` controlável; a permissão só pode ser marcada `controllable` quando há transporte (`native` ou `hook`), enquanto `terminal`/`none` permanece fallback não controlável. `CompanionSession` exige associação inequívoca entre `sessionId`, `taskId`, agente e projeto; IDs são UUID; pedidos têm fingerprint SHA-256, sequência, expiração posterior à criação e decisões com `requestId`, `sessionId` e `idempotencyKey`.

**Contratos efetivamente definidos:** `CompanionSession`, `CompanionSessionStatus`, `CompanionEvent`, `CompanionAgentCapabilities`, `CompanionPermissionRequest`, `CompanionPermissionDecision`, `CompanionConnectionState`, `CompanionEventFilter`, `CompanionEventSubscription`, `CompanionEventBus`, `CompanionEventObserver` e `CompanionUnsubscribe`. A ordenação futura usa `sequence` por sessão e `receivedAt` como observabilidade; deduplicação futura usa `eventId`/`requestId`/`idempotencyKey`; o módulo não persiste nem executa, portanto não cria estado paralelo. Recuperação e replay contra banco/eventos continuam responsabilidade dos Lotes 42.2 e 42.5.

**Testes do lote:** `packages/shared/test/companion.test.ts` cobre identidade, status, evento observado, pedido não controlável, expiração, fingerprint, decisão replay-safe, capacidades e filtros limitados. A validação desta execução passou no teste direcionado (5/5) e na regressão IPC/shared selecionada (32/32). Pendências: integrar o contrato ao Event Bus/TaskEngine, validar capacidades reais dos adapters, persistir projeções, criar IPC de observação e implementar o Permission Broker; nenhuma dessas pendências está marcada como concluída.

### 42.2 — Session Registry e Event Bus

- **Objetivo:** registrar sessões reais e distribuir eventos estruturados, persistidos e idempotentes.
- **Estado inicial:** sessões e eventos existem dentro do TaskEngine; não há projeção unificada para agentes externos.
- **Dependências:** 42.1, TaskEngine, banco/migrações existentes, adapters/parsers.
- **Arquivos/módulos:** `packages/shared/src/agents.ts`, `packages/orchestrator/src`, `packages/database`, `apps/desktop/src/main`.
- **Contratos:** `CompanionSessionRegistry`, `CompanionEventBus`, `CompanionEvent`, cursor/sequence e `CompanionSession`.
- **Tarefas:** migração aditiva somente após confirmar próximo número; ingestão com dedupe; ordenação tolerante; replay bounded; recovery após reinício; nenhum estado somente em memória.
- **Testes:** unidade de dedupe/ordenação, integração SQLite/WAL/restart e E2E com eventos reais/fixtures redigidas.
- **Aceite:** uma sessão aparece uma vez, sobrevive a restart e não mistura projetos/agentes; eventos desconhecidos são preservados como `raw` seguro.
- **Riscos/rollback:** duplicação e crescimento de log; feature flag desliga projeção sem apagar eventos.
- **Evidências:** migration, fixtures, métricas de latência/volume e relatório de restart/replay.

**Implementação do Lote 42.2 (2026-11-01):** `packages/orchestrator/src/companion-registry.ts` implementa `CompanionEventBus` não bloqueante e `CompanionSessionRegistry` persistido no SQLite existente. A migração aditiva `0052_companion_registry.sql` cria `companion_sessions` e `companion_events`, com índices por tarefa/projeto e índice único por sessão/sequência. O Registry valida que a tarefa existe, mantém `projectId` real (inclusive `null` quando a tarefa não possui projeto), rejeita conflito de sessão, deduplica `eventId`, rejeita sequência atrasada, limita retenção por sessão e recupera após reabrir o mesmo banco.

O bridge `connectTaskEngineToCompanion` observa o `TaskEngine` já existente via `engine.on('task')`, aprende o agente pelo evento de step, resolve o projeto pela tarefa e projeta somente eventos observacionais redigidos. Não envia comandos ao engine, não altera permissões e não cria execução/provider fictício. Subscribers recebem eventos via `queueMicrotask`; falhas são encaminhadas a `onSubscriberError` e não interrompem publicação nem TaskEngine. O 42.2 não implementa IPC, HUD, Permission Broker ou gateway.

**Evidências:** `packages/orchestrator/test/companion-registry.test.ts` cobre deduplicação, sequência atrasada, filtros, cancelamento, subscriber com falha, retenção, registro idempotente, restart SQLite, desconexão e bridge TaskEngine. Rodada direcionada shared/orchestrator/database: 23/23. Pendências: ligar o bridge no processo principal real, expor observação por IPC quando o HUD for autorizado, validar carga/retention em produção e concluir os critérios formais do 42.1 separadamente.

**Integração Electron do 42.2 (homologada em 2026-11-02):** `apps/desktop/src/main/companion-ipc.ts` registra `companion:sessions`, `companion:session`, `companion:events`, `companion:subscribe` e `companion:unsubscribe`; `apps/desktop/src/main/index.ts` inicializa/desliga a instância junto ao TaskEngine e banco; `apps/desktop/src/preload/index.ts` expõe apenas a API Companion via `contextBridge`. Consultas são limitadas/paginadas, assinaturas pertencem à janela remetente e são removidas em `destroyed`; não existe canal de publicação, execução ou aprovação. Testes Electron reais, execução TaskEngine isolada e empacotamento NSIS foram aprovados.

### 42.3 — Mini HUD flutuante no Windows

**Redesign com mascote original (2026-11-02):** o HUD virou um companion de área de trabalho com uma única forma que transita entre mascote, cápsula e painel, seguindo a folha de estados aprovada. `NeuralBridgeMascot.tsx` traz o SVG próprio e `companion-state.ts` a lógica pura de estados; `useCompanionFeed.ts` lê o Registry por evento, sem polling; `useHudPointer.ts` faz arraste e clique através das margens; `companion-hud-layout.ts` e `CompanionHudController` tratam âncora, monitores, DPI, foco e ciclo de vida da janela. **Decisões:** o main lê o cursor, de modo que o renderer só informa a fase do arraste; `close` nunca é bloqueado, e a janela é recriada sob demanda; success e error são reações a transições ao vivo; estados de música e "Empolgado" ficam fora até existir sinal real. **Status: CONCLUÍDO (HUD, 2026-11-02);** evidências e limitações em `docs/STATUS.md`, Lote 42.3. O sublote 42.3.Spotify é separado e segue planejado.

- **Objetivo:** exibir status, sessão focada, aprovação pendente e atalho para Mission Control em janela always-on-top controlável.
- **Estado inicial:** janelas Electron e Mission Control existentes; nenhum overlay Companion.
- **Dependências:** 42.1–42.2, `MASTER.md`, Guided Tours/UX existentes, packaging Fase 17.
- **Arquivos/módulos:** `apps/desktop/src/main`, preload/IPC, `renderer/src/features`, design system e `electron-builder.yml`.
- **Contratos:** `companion:state`, `companion:focus`, `companion:setVisibility`, sem comandos de processo no renderer.
- **Tarefas:** janela transparente/sem foco por padrão; snap por monitor; DPI/tema/reduced motion; hover/keyboard acessíveis; fallback para Mission Control; limites de texto e redaction.
- **Testes:** Playwright multi-viewport/monitor simulado, dark/light/reduced motion, teclado/foco, DPI e janela ausente.
- **Aceite:** HUD não cria status falso, não rouba foco indevidamente, funciona em múltiplos monitores e fecha sem afetar tarefas.
- **Riscos/rollback:** problemas de z-order/DPI; flag desliga a janela e mantém Mission Control.
- **Evidências:** screenshots aprovadas, matriz de viewport, logs de criação/destruição e teste de não-interferência.

### 42.3.Spotify — Companion Spotify Integration

**Status: EM EXECUÇÃO (2026-11-02).** Código em `apps/desktop/src/main/spotify/`, testado somente contra API simulada; falta o teste autenticado real. Decisões: retorno fixo em `http://127.0.0.1:43879/callback`, capa como data URL pelo main sem alterar o CSP, polling de 5 s tocando e 15 s pausado só com o HUD visível. Detalhes em `docs/STATUS.md`.

- **Objetivo:** adicionar uma integração Spotify opcional, real e isolada ao Companion, preservando o mascote original, o HUD flutuante e a separação entre observação de agentes e controles de música.
- **Estado inicial:** HUD 42.3 concluído, com modos mascote/cápsula/expandido e IPC Companion existente; nenhuma autenticação Spotify ou credencial de terceiro está implementada.
- **Dependências:** 42.2 concluído; 42.3 para superfície visual; Electron main/preload/IPC; preferências protegidas; documentação de distribuição; configuração externa de Spotify Developer App.
- **Arquivos/módulos envolvidos:** novo serviço isolado em `apps/desktop/src/main`; contratos em `packages/shared`; handlers/preload Spotify; `CompanionHud.tsx`, `NeuralBridgeMascot.tsx`, janela e preferências do HUD; testes unitários/integrados/E2E.
- **Contratos/interfaces:** `SpotifyConnectionState`, `SpotifyPlaybackState`, `SpotifyDevice`, `SpotifyControlCapability`, `SpotifyOAuthPkceSession`, `SpotifyError`, `SpotifyRateLimit`, além de IPC explícito para conectar, desconectar, consultar playback, controlar playback quando autorizado e abrir no Spotify.
- **Autenticação:** OAuth 2.0 Authorization Code com PKCE, navegador externo e callback seguro compatível com Electron; sem Client Secret embutido; `state`, verifier, redirect URI e scopes mínimos validados.
- **Scopes:** `user-read-playback-state` e `user-read-currently-playing`; `user-modify-playback-state` somente após habilitação explícita de controles pelo usuário.
- **Persistência/segurança:** tokens somente no armazenamento seguro do sistema operacional; nunca em logs, renderer ou preferências em texto puro; tratar expiração, revogação, logout, 401/403/429 e `Retry-After` sem vazar credenciais.
- **Player:** capa, faixa, artista, progresso real, dispositivo, play/pause, anterior/próxima, volume quando suportado e abrir no Spotify; controles indisponíveis devem ficar desabilitados com motivo explícito; não reproduzir áudio localmente.
- **Mascote:** estado musical discreto (`playing`, `paused`, `changed`, `disconnected`, `error`) combinado com o estado prioritário do agente; nenhuma análise/captura de áudio; reduced motion obrigatório.
- **Integração:** cache e atualização moderada condicionados à visibilidade do HUD e aos limites da API; sem polling quando desconectado/desabilitado; não alterar TaskEngine, Session Registry, Event Bus ou Permission Broker.
- **Testes:** PKCE/state/callback, renovação, desconexão, conta sem suporte a controle, ausência de dispositivo, 401/403/429, Retry-After, reconexão, IPC, renderer isolado, HUD nos três modos, reduced motion, funcionamento sem Spotify e testes com conta Spotify autenticada somente quando configuração externa estiver disponível.
- **Aceite:** conexão e desconexão funcionam sem credenciais no repositório; playback exibido corresponde à API; controles respeitam capacidades; erros/rate limits são comunicados sem loop agressivo; mascote reage somente a metadados/estados reais; TaskEngine não sofre interferência.
- **Riscos/rollback:** mudanças de API, limites, ausência de Premium/dispositivo e callback bloqueado; desligar a integração por preferência/feature flag remove o player sem afetar o Companion ou agentes.
- **Evidências:** relatório de auditoria, configuração documentada do Developer App, testes PKCE/IPC, capturas reais dos modos com e sem Spotify, logs redigidos de 401/403/429, e teste autenticado quando o usuário fornecer configuração válida.
- **Gate:** não marcar concluído sem teste autenticado real; se Client ID/redirect URI/autorização não estiverem disponíveis, registrar a pendência e aguardar dados do usuário.

### 42.4 — Adaptadores Claude Code, Codex e OpenCode

- **Objetivo:** normalizar sinais reais dos três agentes e declarar limites de controle.
- **Estado inicial:** Claude/Codex possuem adapters e fixtures; OpenCode não tem adapter canônico no baseline.
- **Dependências:** 42.1–42.2, `packages/agents`, CLIs/plugins oficiais e política de hooks.
- **Arquivos/módulos:** `packages/agents/src`, `packages/agents/test`, `packages/shared/src/agents.ts`, `packages/workspace` para instalação opt-in.
- **Contratos:** `AgentAdapter`, `CapabilityMatrix`, `HookInstallPlan`, `PermissionTransport` e `OpenCodePluginAdapter` opcional.
- **Tarefas:** preferir stream/eventos/hooks; suportar arquivos com espaços/Unicode e cancelamento Windows; instalar/mesclar sem apagar hooks originais; detectar ausência/deslogado/incompatível; nunca prometer aprovação externa sem ack.
- **Testes:** fixtures por versão, parser fuzz, adapter real opt-in, hook merge/backup/rollback e E2E de sessão desconectada.
- **Aceite:** eventos reais chegam ao Registry; CLI ausente/deslogado termina em estado explícito; OpenCode degradado para observação quando necessário.
- **Riscos/rollback:** mudanças de schema/CLI e hooks quebrados; desativar integração e restaurar backup, preservando configuração do usuário.
- **Evidências:** matriz por agente/versão, logs redigidos, fixtures e prova de configuração original preservada.

### 42.5 — Permission Broker e aprovações seguras

- **Objetivo:** transportar solicitações reais e decisões humanas, somente quando o agente suporta correlação segura.
- **Estado inicial:** permissões prévias no TaskEngine e limites por projeto; não existe broker externo com nonce/TTL.
- **Dependências:** 42.1–42.4, Fases 16/28/31, permissões de projeto/workspace.
- **Arquivos/módulos:** `packages/shared`, `packages/orchestrator`, `packages/agents`, main/IPC, banco.
- **Contratos:** `PermissionRequest` com `requestId`, `sessionId`, escopo, resumo, fingerprint, `expiresAt`; `ApprovalDecision` single-use com ator, motivo e resultado; `PermissionBroker` fail-closed.
- **Tarefas:** correlação exata; expiração; replay protection; separação read-only/controle/autorização; confirmação humana para escrita/destrutiva; fila ordenada; fallback “responder no terminal”; nunca auto-aprovar pedido de agente não suportado.
- **Testes:** unidade de replay/TTL/mismatch, integração de concorrência/restart, E2E Claude/Codex reais opt-in e casos OpenCode sem aprovação.
- **Aceite:** decisão errada/expirada/duplicada é rejeitada; pedido permanece até resposta/expiração; nenhuma ação ocorre sem evidência de decisão válida.
- **Riscos/rollback:** aprovação para sessão errada ou privilégio excessivo; desligar controle remoto preservando observação e terminal.
- **Evidências:** trilha de auditoria, testes negativos, threat model atualizado e demonstração real de Allow/Deny/terminal fallback.

### 42.6 — Companion animado com identidade original

- **Objetivo:** adicionar personalidade visual original e opcional, sem copiar Coucou/Mochi ou seus assets.
- **Estado inicial:** identidade oficial NeuralBridge em `MASTER.md`; sem personagem/sons próprios aprovados.
- **Dependências:** 42.3–42.5, design system, acessibilidade e licença de assets.
- **Arquivos/módulos:** `design-system`, `renderer/src/features/companion`, `MASTER.md`, recursos licenciados pelo projeto.
- **Contratos:** `CompanionState`, `MotionPolicy`, `SoundPolicy`, `AssetManifest` com licença/proveniência.
- **Tarefas:** conceito original; estados idle/working/waiting/error/done; reduced motion; mute; fallback sem animação; não usar nome, forma, sons, screenshots ou mídia de Coucou.
- **Testes:** snapshot/licença/proveniência, acessibilidade, reduced motion, CPU idle, mute e fallback sem assets.
- **Aceite:** identidade aprovada e original; Companion é decorativo e não altera autorização/execução.
- **Riscos/rollback:** confusão de marca, custo de CPU/licença; remover assets/animação deixando HUD textual funcional.
- **Evidências:** ficha de identidade, manifestos, screenshots e matriz de movimento/áudio.

### 42.7 — Chat rápido e integração com Mission Control

- **Objetivo:** permitir consultar uma sessão e enviar intenção de continuação pelo fluxo existente, sem duplicar conversa/TaskEngine.
- **Estado inicial:** Chat/Mission Control já operam sobre tarefas persistidas; Companion ainda não tem entrada.
- **Dependências:** 42.2–42.6, Fases 12/29/31/32.
- **Arquivos/módulos:** canais/preload, páginas Chat/Mission Control, `TaskEngine.continue`, analytics/eventos.
- **Contratos:** `CompanionChatIntent`, `SessionContinuation`, `TaskEngineCommandResult` com idempotency key.
- **Tarefas:** deep-link para tarefa; enviar prompt como intenção; preservar projeto/modo/permissão; mostrar estado pendente/erro; sem edição direta de arquivos nem canal paralelo.
- **Testes:** unidade de autorização/escopo, integração de continuação após restart e E2E de chat/mission control/HUD.
- **Aceite:** toda mensagem cria evento/tarefa existente e é visível no Mission Control; nenhuma execução fica somente no Companion.
- **Riscos/rollback:** comandos fora da sessão e duplicação; desabilitar composer e manter link read-only.
- **Evidências:** timeline antes/depois, IDs correlacionados e E2E de idempotência.

### 42.8 — Gateway local seguro e pareamento

- **Objetivo:** oferecer canal local opt-in para telefone sem expor TaskEngine diretamente.
- **Estado inicial:** v1 local-first sem servidor HTTP remoto obrigatório; MCP é stdio; não há pareamento móvel NeuralBridge.
- **Dependências:** 42.2, 42.5, 42.7, Fases 16/17.
- **Arquivos/módulos:** `packages/shared`, main/gateway, secure storage Windows Credential Manager, packaging.
- **Contratos:** `PairingCode`, `DeviceIdentity`, `TlsChannel`, `RevocationList`, `RemoteProjection`; somente endpoints de projeção/decisão.
- **Tarefas:** gateway desligado por padrão; bind local/LAN explícito; TLS mutual/pinned certificate; QR de uso único; credenciais no armazenamento seguro; revogar dispositivo; rate limit; não aceitar comandos arbitrários; bloquear replay.
- **Testes:** threat model, TLS negativo, pairing expiry/revocation, fuzz de payload, restart e descoberta de porta não exposta por padrão.
- **Aceite:** sem listener por default; pareamento autenticado e revogável; TaskEngine nunca fica acessível diretamente.
- **Riscos/rollback:** exposição LAN/MITM/credencial vazada; kill switch remove listener e invalida sessões.
- **Evidências:** scan local, logs de bind, testes criptográficos e auditoria de secrets.

### 42.9 — Aplicativo móvel e notificações

- **Objetivo:** acompanhar sessões e responder aprovações compatíveis pelo celular, com autenticação forte e degradação segura.
- **Estado inicial:** nenhum app NeuralBridge; gateway é futuro e opt-in.
- **Dependências:** Gate C/42.8, 42.5, decisões de plataforma e licenças de SDK.
- **Arquivos/módulos:** novo app móvel a definir, protocolo compartilhado, gateway e documentação de pareamento.
- **Contratos:** `MobileSessionView`, `MobileApprovalAction`, `NotificationIntent`, versão de protocolo e capability negotiation.
- **Tarefas:** Android primeiro ou decisão explícita de plataforma; notificações sem segredo; Allow exige biometria/PIN; TTL; “abrir no desktop” para comandos grandes; offline/sem rede; sem enviar chaves de provider ao telefone.
- **Testes:** integração real em dispositivo, expiração/biometria, perda de rede, revogação, acessibilidade e notificações duplicadas.
- **Aceite:** celular só mostra projeção autorizada e decisões aceitas pelo Broker; falha de link não altera tarefa.
- **Riscos/rollback:** roubo de aparelho/notificação enganosa; revogar dispositivo e desativar app sem perda do desktop.
- **Evidências:** matriz de protocolo, teste em aparelho, logs sem conteúdo sensível e revisão de privacidade.

### 42.10 — Analytics e histórico de agentes

- **Objetivo:** enriquecer histórico com sessões, tempos, aprovações e resultados sem duplicar token analytics.
- **Estado inicial:** analytics de tokens e eventos já persistidos; Mission Control deriva consultas.
- **Dependências:** 42.2–42.9, Fase 22 e retenção/backup.
- **Arquivos/módulos:** `packages/orchestrator/src/analytics.ts`, database queries/migration se indispensável, Analytics UI/Mission Control.
- **Contratos:** agregações por `sessionId/taskId/agent/project`, origem e qualidade do evento; sem custo inventado.
- **Tarefas:** reconciliar eventos fora de ordem; retenção; exportação redigida; separar uso reportado de estimativa; indicadores de aprovação externa e fallback terminal.
- **Testes:** agregação idempotente, restart, retenção, isolamento por projeto e visualizações com dados reais/ausentes.
- **Aceite:** números derivam do banco e reconciliação explica lacunas; nenhuma métrica simulada.
- **Riscos/rollback:** PII/volume; feature flag de agregados e purge reversível via backup.
- **Evidências:** consultas, benchmark, amostras redigidas e screenshots de estados vazios.

### 42.11 — Segurança, acessibilidade, testes e estabilidade

- **Objetivo:** fechar hardening transversal para Windows e móvel.
- **Estado inicial:** políticas Electron, redaction, permissões e testes existentes; novas superfícies ainda não cobertas.
- **Dependências:** todos os lotes anteriores e Fases 16/28/31/37.
- **Arquivos/módulos:** shared schemas, main/preload, companion, gateway, mobile, testes unit/integration/E2E.
- **Contratos:** checklist de threat model, SLO de recovery, política de logs/segredos, WCAG/keyboard/reduced motion.
- **Tarefas:** revisão de IPC sender/origin; fuzz; matriz multi-monitor/DPI/tema; carga de eventos; kill/restart; acessibilidade; verificação de hooks e permissões; não executar conteúdo recebido do agente/telefone.
- **Testes:** unit, integração, Playwright Electron, dispositivo, carga bounded e regressão completa sem desativar testes.
- **Aceite:** gates sem falha crítica; restart/replay/revocation provados; no path de autorização inseguro; baseline visual aprovada.
- **Riscos/rollback:** regressão de desktop e bloqueios externos; desligar Companion/mobile sem alterar TaskEngine/Mission Control.
- **Evidências:** relatório de segurança, matriz de testes, traces/screenshots e logs de recuperação.

### 42.12 — Empacotamento, homologação e distribuição

- **Objetivo:** distribuir a experiência Windows com instalador e migração seguros.
- **Estado inicial:** NSIS x64, `asarUnpack`, MCP/migrations e pendências de máquina limpa/assinatura da Fase 17.
- **Dependências:** 42.1–42.11, Fase 17 e decisão de licença/assets.
- **Arquivos/módulos:** `apps/desktop/electron-builder.yml`, scripts de build/verify, `%APPDATA%\NeuralBridge`, documentação de instalação.
- **Contratos:** versão de protocolo/migração, feature flags, rollback de atualização, manifesto de assets/licenças e health check.
- **Tarefas:** empacotar HUD/recursos sem segredos; preservar banco; gateway default-off após update; reparar hooks/configs sem sobrescrever; SmartScreen/assinatura; uninstall sem apagar dados sem consentimento.
- **Testes:** build isolado, NSIS em máquina limpa, upgrade/downgrade suportado, smoke sem CLIs, MCP preservado, múltiplos monitores e rollback.
- **Aceite:** instalador abre em máquina limpa; Companion opcional; dados e configurações preservados; checklist de licença e segurança aprovado.
- **Riscos/rollback:** SmartScreen, asar/native modules, migração incompleta; pacote anterior e backup restaurável, com kill switch para HUD/gateway.
- **Evidências:** hashes, relatório do instalador, logs de migração, matriz de versões e homologação assinada.

### Dependências com fases existentes e definição de pronto

Fase 42 depende conceitualmente de TaskEngine/Fases 11 e 31, permissões/Fases 16 e 28, analytics/Fase 22, Mission Control/Fase 29, hierarquia/Fase 33, Electron/NSIS/Fase 17, UI/MASTER/Fase 37, Git/Skills quando houver contexto de projeto (Fases 38 e 41), e Chat/recuperação (Fases 12 e 32). Ela deve reutilizar esses contratos e pode começar pela auditoria mesmo com fases abertas; gates de implementação bloqueiam somente o ponto afetado. Não deve duplicar `tasks`, `task_events`, `tokenAnalytics`, Mission Control ou execução de CLIs.

**Definição de pronto da fase:** os 12 lotes implementados e validados na ordem; MVP Windows real com eventos e aprovações suportadas; experiência Companion sem identidade derivada de Coucou; gateway móvel desligado por padrão e comprovadamente protegido; analytics reconciliado; testes unitários, integração, E2E, acessibilidade, restart, segurança e instalador aprovados; documentação de licenças e rollback completa. Até lá, todos os lotes permanecem **PLANEJADOS**.

Os gates desta retomada (`npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:motion` e `git diff --check`) passaram. Nenhum commit foi criado e as Fases 40 e 38.5 não foram reimplementadas.

## Fase 43 — Modernização Arquitetural, Resiliência e Observabilidade do NeuralBridge

**Status:** PLANEJADA — NÃO INICIADA (2026-11-02). Esta fase consolida a auditoria arquitetural de 01/11/2026 e prepara a base para execução autônoma prolongada, recuperação após reinício, workflows retomáveis, contratos IPC consistentes, modularização incremental e diagnóstico operacional. Nesta fase de planejamento nenhum runtime é alterado.

### Justificativa e diagnóstico validado

**Problemas confirmados no código atual:** `apps/desktop/src/main/index.ts` concentra composição, lifecycle e aproximadamente 100 handlers; `packages/orchestrator/src/engine.ts` concentra múltiplas políticas do TaskEngine; canais, schemas, preload e handlers IPC são mantidos em superfícies separadas; o contrato Zod atual não cobre `app:mission-control`, bloqueando `npm run typecheck`; jobs de vídeo/discovery/motion ainda possuem estado operacional em `Map` no processo principal; barrels de `workspace` e `orchestrator` reexportam vários domínios; `packages/database/src/schema.ts` concentra mais de 40 tabelas; telas renderer grandes concentram consulta, estado e apresentação.

**Problemas relatados na auditoria que ainda exigem confirmação por lote:** perda ou recuperação incompleta de jobs após restart; ausência de paridade completa entre fiação de produção, preload e contrato; acoplamento circular efetivo entre domínios; regressões de performance nas telas grandes; cobertura insuficiente de falhas reais de providers/IPC. Cada item deverá ser reproduzido antes de receber o status de defeito.

**Melhorias propostas, ainda não implementadas:** registry IPC como fonte de verdade; registradores de IPC por domínio; políticas isoláveis do TaskEngine; modelo persistente de jobs e reconciliação; observabilidade correlacionada; entrypoints explícitos e schema lógico por domínio; decomposição incremental do renderer; matriz de caos e restart.

**Não objetivos:** não criar segundo TaskEngine, executor paralelo, microserviços, novo banco ou novo sistema de workflows; não renumerar fases; não substituir contratos públicos silenciosamente; não remover funcionalidades existentes; não executar ações de Git, agentes ou aprovações automaticamente.

### Dependências e sequência

A sequência recomendada é **43.1 → 43.2 → 43.3 → 43.4 → 43.5 → 43.6 → 43.7 → 43.8**. A fase reutiliza contratos e evidências das Fases 11, 12, 14, 16, 17, 22, 28, 29, 31, 32, 33, 37, 38, 39, 40, 41 e 42. Em especial: TaskEngine/workflows das Fases 11/31/32; permissões e segurança das Fases 16/28/42; analytics da Fase 22; Mission Control da Fase 29; hierarquia da Fase 33; UI e Design System da Fase 37; Git da Fase 38; Skills da Fase 41. A Fase 42 permanece dependente dos mesmos contratos e não deve ser duplicada. A migração de cada lote deve confirmar o próximo número existente e ser aditiva.

### 43.1 — Estabilização e contratos IPC [P0]

- **Objetivo:** estabelecer uma fonte de verdade verificável para canais, schemas, preload, handlers e permissões Electron.
- **Diagnóstico/evidências:** `packages/shared/src/channels.ts`, `packages/shared/src/ipc.ts`, `apps/desktop/src/preload/index.ts` e `apps/desktop/src/main/index.ts` são superfícies sincronizadas; o typecheck atual acusa ausência de `app:mission-control` em `ipcContract`.
- **Escopo técnico/arquivos:** `packages/shared/src/{channels,ipc}.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main`, `apps/desktop/test`, `packages/shared/test`; avaliar registry tipada, validação de entrada/saída, sender/origin e geração somente se não alterar a compatibilidade.
- **Dependências/riscos:** Fases 11, 16, 31, 37, 38, 41 e 42; risco de quebrar consumidores v1 ou registrar listener duplicado.
- **Estratégia/rollback:** corrigir primeiro o contrato confirmado, capturar baseline de canais, migrar por domínio e manter aliases compatíveis; reverter somente a registry/adapter do lote sem apagar canais ou dados.
- **Testes/aceite:** schemas de todos os endpoints; parity test da fiação real; sender não confiável bloqueado; `app:mission-control` coberto; consumidores existentes passam. **Aceite:** todo endpoint possui contrato verificável e inconsistências falham no teste.
- **DoD:** typecheck/lint/testes focados/build passam; matriz channels/preload/handlers registrada; nenhum comportamento de execução alterado.

### 43.2 — Modularização do Electron Main Process [P0]

- **Objetivo:** reduzir acoplamento mantendo um único composition root e lifecycle.
- **Diagnóstico/evidências:** `apps/desktop/src/main/index.ts` mistura inicialização de banco, serviços, janelas, timers e handlers de Brain, Git, Workflows, Skills, Velix, Tasks e Companion.
- **Escopo técnico/arquivos:** `apps/desktop/src/main/index.ts` e novos módulos `main/ipc/` por domínio; contexto compartilhado tipado para dependências, `dispose` e trusted sender; manter integração com `companion-ipc.ts`, `git-ipc-handlers.ts` e `tasks.ts`.
- **Dependências/riscos:** 43.1, Fases 17, 31, 38, 41 e 42; risco de inicialização duplicada, ordem incorreta e listeners órfãos.
- **Estratégia/rollback:** extrair um domínio por vez, comparando lista de canais/listeners antes e depois; feature flags não são substitutas de wiring correto; rollback remove apenas o registrador extraído e restaura a chamada do composition root.
- **Testes/aceite:** testes de registro/dispose por domínio, contagem de listeners, lifecycle e E2E crítico. **Aceite:** handlers modularizados, um único composition root, sem listeners duplicados ou alteração funcional.
- **DoD:** todos os domínios escolhidos têm módulo próprio, dependências explícitas, testes e diff revisado.

### 43.3 — Evolução arquitetural do TaskEngine [P0]

- **Objetivo:** manter o TaskEngine como coordenador e tornar políticas isoláveis/testáveis.
- **Diagnóstico/evidências:** `packages/orchestrator/src/engine.ts` concentra lifecycle, execução, retry, failover, recovery/healing, capacity, aprovação, cancelamento, fila e recuperação.
- **Escopo técnico/arquivos:** `packages/orchestrator/src/engine.ts` e módulos de policy/ports; preservar eventos, checkpoints, aprovações, `AgentAdapter`, Claude Code, Codex CLI e contratos existentes.
- **Dependências/riscos:** 43.1, Fases 11, 31, 32 e 42; risco de criar segundo mecanismo de execução ou mudar semântica de retry.
- **Estratégia/rollback:** aplicar o deletion test e extrair somente políticas com seam real; manter facade do TaskEngine; cada extração deve ter comparação de eventos e estados do baseline; rollback por adapter/facade.
- **Testes/aceite:** unidade de cada política, equivalência de eventos/outputs, retry/failover/cancelamento/aprovação e integração com providers. **Aceite:** comportamento funcional equivalente e políticas testáveis sem duplicar executor.
- **DoD:** coordenador menor, interfaces estreitas, testes verdes e matriz de equivalência documentada.

### 43.4 — Persistência e recuperação de jobs [P0]

- **Objetivo:** garantir continuidade segura após crash/restart sem duplicar efeitos colaterais.
- **Diagnóstico/evidências:** o banco já possui tabelas de tasks/workflows/jobs específicos, enquanto o processo principal mantém jobs de discovery/clip/motion em `Map`; a reconciliação comum ainda precisa ser comprovada.
- **Escopo técnico/arquivos:** `packages/database/src/schema.ts`, migrações aditivas, repositories de jobs, `packages/orchestrator/src/workflow-runner.ts`, `apps/desktop/src/main` e testes. Validar antes os estados existentes contra `pending`, `queued`, `running`, `completed`, `paused`, `waiting_approval`, `retrying`, `failed`, `cancelled`, `interrupted`, `recovering`.
- **Dependências/riscos:** 43.3, Fases 2, 11, 31, 32, 33, 39 e 42; risco de repetir escrita externa ou perder aprovação/checkpoint.
- **Estratégia/rollback:** migração aditiva, máquina de estados explícita, idempotency keys, orphan scan bounded e registry de processos ativos separado; rollback por feature flag/migração compatível, sem apagar histórico.
- **Testes/aceite:** restart, crash, job órfão, replay, checkpoint, aprovação pendente, cancelamento, concorrência e falha de persistência. **Aceite:** restart não perde estado, não duplica tarefa e não repete efeito inseguro.
- **DoD:** estados e transições documentados, migration/repository/reconciliation testados, rollback demonstrado.

### 43.5 — Observabilidade e diagnóstico [P1]

- **Objetivo:** rastrear tarefa/workflow/agente/provider do início ao resultado sem expor segredos.
- **Diagnóstico/evidências:** analytics, eventos e Mission Control já existem, mas a auditoria propõe verificar correlação completa, tempo por etapa, retry/failover, filas e handlers IPC sem duplicar painéis.
- **Escopo técnico/arquivos:** `packages/shared` para IDs/eventos, `packages/database` para persistência se indispensável, `packages/orchestrator/src/analytics.ts`, TaskEngine, Mission Control e logs do main/preload.
- **Dependências/riscos:** 43.1–43.4, Fases 22, 29, 31, 37 e 42; risco de PII, custo de armazenamento e métricas inventadas.
- **Estratégia/rollback:** correlation ID obrigatório, logs estruturados redigidos, retenção bounded e agregações derivadas do banco; desligar apenas projeções novas, preservando eventos existentes.
- **Testes/aceite:** rastreio ponta a ponta, redaction, eventos fora de ordem, retenção, custo/token estimado distinguido de uso reportado e diagnóstico de fila. **Aceite:** uma execução é investigável desde criação até resultado.
- **DoD:** schema/versionamento, consultas, indicadores e relatório de volume/latência documentados; Mission Control reutilizado quando suficiente.

### 43.6 — Modularização dos domínios e persistência [P1]

- **Objetivo:** tornar dependências e seams de domínio explícitos sem introduzir microserviços.
- **Diagnóstico/evidências:** barrels de `packages/workspace/src/index.ts` e `packages/orchestrator/src/index.ts` reexportam domínios distintos; `packages/database/src/schema.ts` concentra memória, projetos, tasks, Git, Skills, Companion e Velix.
- **Escopo técnico/arquivos:** entrypoints por domínio, imports consumidores, schema lógico por domínio, repositories específicos e testes de compatibilidade; manter banco compartilhado e migrações aditivas.
- **Dependências/riscos:** 43.1–43.5, Fases 2, 31, 33, 38, 41 e 42; risco de import quebrado e dependência circular escondida.
- **Estratégia/rollback:** mapear grafo antes, migrar imports incrementalmente e manter exports de compatibilidade durante a transição; rollback por entrypoint sem alterar persistência.
- **Testes/aceite:** typecheck de todos os packages, testes de consumidores, detecção de ciclos e migrações em banco existente. **Aceite:** dependências explícitas sem quebra de imports, dados ou migrations.
- **DoD:** grafo comparativo, entrypoints documentados, barrels reduzidos somente onde há ganho real.

### 43.7 — Renderer, UI/UX e performance [P1]

- **Objetivo:** reduzir concentração de lógica e manter a identidade visual aprovada.
- **Diagnóstico/evidências:** `GitIntelligencePage.tsx`, `ChatPage.tsx`, `VelixPage.tsx` e `SessionPanel.tsx` são telas grandes; o Design System em `design-system/neuralbridge-intelligent-workspace/MASTER.md` define preto/laranja, foco, reduced motion e responsividade.
- **Escopo técnico/arquivos:** telas grandes, hooks/view-models quando justificáveis, componentes reutilizáveis, React Query/Zustand, E2E visual/funcional e matriz 375/768/1024/1440; preservar estados reais e sem métricas fictícias.
- **Dependências/riscos:** 43.1–43.6, Fases 37, 40 e 42; risco de regressão visual, renderizações extras e perda de feedback de execução.
- **Estratégia/rollback:** uma tela por vez, medir antes/depois, manter snapshots aprovados somente após inspeção e reverter por tela sem alterar contratos IPC.
- **Testes/aceite:** performance medida, loading/empty/error, teclado, contraste, foco, reduced motion, dark/light e viewports. **Aceite:** nenhuma regressão visual/funcional e ganho demonstrado por medição.
- **DoD:** E2E/snapshots revisados, métricas comparáveis e checklist UI/UX concluído.

### 43.8 — Resiliência, testes e validação final [P0]

- **Objetivo:** provar estabilidade sob falhas reais e fechar os gates da fase.
- **Diagnóstico/evidências:** existem testes unitários, integração e E2E, mas crash/restart de Electron, encerramento de CLIs, falha IPC, checkpoint e concorrência precisam de cenários reproduzíveis por lote.
- **Escopo técnico/arquivos:** suites `packages/*/test`, `apps/desktop/test`, `tests/integration`, `tests/e2e`, harness de fault injection bounded e documentação de incidentes; não desativar testes nem usar bypass.
- **Dependências/riscos:** 43.1–43.7 e Fases 16, 17, 31, 37, 38, 41 e 42; risco de testes flakey e efeitos externos não isolados.
- **Estratégia/rollback:** fixtures e processos controlados, `--no-file-parallelism` quando necessário, cenários opt-in para CLIs reais, flag para fault injection; rollback remove somente harness/testes novos.
- **Testes/aceite:** crash/restart, provider timeout, IPC failure, retry cancellation, checkpoint failure, connectivity loss, persistence failure, pending approval e concorrência. **Aceite:** cenários críticos reproduzíveis, documentados e verdes.
- **DoD:** unit/integration/E2E, segurança, acessibilidade, build, typecheck, lint, `git diff --check` e matriz de restart aprovados; nenhuma falha crítica aberta.

### Checklist de execução da Fase 43

- [ ] Confirmar baseline e separar alterações concorrentes antes de cada lote.
- [ ] Revalidar problemas da auditoria no código atual antes de classificá-los como defeitos.
- [ ] Executar lotes na ordem 43.1–43.8, sem marcar lote por intenção ou tela sem execução real.
- [ ] Registrar evidências, bloqueios ambientais e rollback em `docs/STATUS.md` durante implementação.
- [ ] Preservar compatibilidade v1, IDs, histórico, memória, RAG, Git, Skills, workflows e Companion.
- [ ] Não criar TaskEngine, executor, banco, workflow engine ou canal paralelo.
- [ ] Parar para decisão humana nos pontos de aprovação obrigatória de segurança, migração e controle de agentes.

### Definição de pronto da Fase 43

A fase só poderá ser concluída quando os oito lotes forem implementados e validados na ordem; todos os endpoints tiverem contrato e parity test; o Electron main continuar com um único composition root; o TaskEngine continuar sendo o único coordenador; jobs e checkpoints sobreviverem a restart sem duplicação insegura; observabilidade rastrear execuções com redaction; imports/schema por domínio reduzirem acoplamento real; renderer mantiver a identidade e a matriz UI aprovada; e os testes de falha, build, typecheck, lint, segurança, acessibilidade e rollback estiverem aprovados. Até então, a fase permanece **PLANEJADA — NÃO INICIADA**.

## Fase 44 — Motion Design do Companion HUD

**Status:** IMPLEMENTADA (2026-11-02), revisão visual aprovada e DPI misto real validado. Plano em `docs/plans/phase-44-companion-motion-design.md`; resultados e pendências em `docs/STATUS.md`.

**Diagnóstico:** a causa dominante das transições secas é nativa, não de CSS. `boundsForMode` move a origem da janela ao mudar de modo perto da borda da tela, e por isso o mascote teleporta (cerca de 660 × 290 px ao abrir o painel na âncora padrão). Somam-se resize e React não atômicos, conteúdo desmontado sem saída, transições CSS sem física em propriedades de layout, e expressões trocadas por substituição. A confirmação em tela é a Tarefa 1.

**Decisões aprovadas pelo usuário em 2026-11-02:** janela como palco fixo de 820×440 (fallback: janela justa + FLIP, conforme gate da Tarefa 1); espelhamento horizontal de cápsula e painel quando o mascote fica à direita; dependência `motion` 14.9.0, restrita ao Companion. `companionHud.x/y` segue como âncora do mascote; a execução acrescentou `companionHud.align`, aditivo e com padrão.

- [x] 44.1 — Baseline e gate do palco fixo.
- [x] 44.2 — Palco fixo no processo principal.
- [x] 44.3 — Linguagem de movimento (tokens e alvos).
- [x] 44.4 — Forma única, expansão e contração.
- [x] 44.5 — Arraste com elasticidade.
- [x] 44.6 — Mascote vivo.
- [x] 44.7 — Fala sincronizada com sinal real.
- [x] 44.8 — Microinterações e troca de sessão.
- [x] 44.9 — Spotify.
- [x] 44.10 — Abrir configurações sem piscar.
- [x] 44.11 — Validação no Electron real e fechamento.

**Definição de pronto:** critérios de aceite do plano atendidos, com evidências antes/depois da gravação no Electron real e empacotado.

## Execução do plano Fase 41 / VoiceStudio / Fase 36 (2026-11-01)

- **Fase 41 — Lote 7 iniciado:** o TaskEngine agora rejeita skills explicitamente solicitadas que não estejam disponíveis antes de iniciar o agente, em tarefas normais e capacidades estruturadas read-only. A validação é opcional no contrato para preservar integrações legadas; o processo principal a conecta ao inventário real.
- **Template 3 da Fase 31 homologado localmente:** `automated-qa` executou `git diff`, `npm test`, `npm run test:integration` e `npm run test:e2e` através do executor nativo, usando fixture npm real e persistindo o relatório. Não foi criado executor paralelo.
- **VoiceStudio implementado como provider opcional:** contratos compartilhados, adapter loopback-only para API 0.5.0, descoberta de modelos/vozes, geração, FFprobe, sidecar atômico, prévia, timeline e integração IPC/preload/UI no Estúdio. ElevenLabs/manual foi preservado.
- **Fase 36:** a jornada ganhou variáveis condicionais `NB_ELEVENLABS_AUDIO`, `NB_ELEVENLABS_TEXT` e `NB_VELIX_OWN_VIDEO` para validação com áudio ElevenLabs e vídeo próprio. Essa rodada não pôde executar o cenário real porque os arquivos não foram fornecidos.
- **Bloqueios externos preservados:** VoiceStudio não respondeu em `localhost:3900`; instalação NSIS limpa, licença Remotion e validação real da Fase 16 continuam pendentes. Fases 40 e 38.5 não foram refeitas.
- **Proteção adicional:** o sidecar de narração usa fingerprint otimista e lock atômico; uma escrita concorrente falha sem substituir o arquivo. A validação de áudio usa o FFprobe empacotado do compositor quando disponível, mantendo `NB_FFPROBE`/PATH como fallback controlado.

### Evidência final desta retomada

- Vitest completo em série: 125 arquivos, 998/998 testes aprovados.
- Integração: 4 arquivos, 8/8 testes aprovados; 29 testes opt-in/external skipped.
- E2E crítico Velix: 1/1 aprovado com fixtures controladas; a jornada real continua condicionada às variáveis de mídia documentadas.
- Gates após o hardening: typecheck, ESLint, build Electron, build Motion e `git diff --check` aprovados.

## Fechamento Fases 41, 39, 36 e auditorias (2026-11-01)

- **Fase 41 CONCLUÍDA:** skill real habilitada chegou ao agente com `skills_context` (fontes Git e memória), a resposta usou a memória via RAG, e tudo persistiu após reiniciar, com Claude e com Codex reais.
- **Fase 36 CONCLUÍDA:** jornada real com ElevenLabs e vídeo próprio aprovada, usando o kit Velix real. VoiceStudio real com a voz clonada do usuário: narração de 7,2 s em cerca de 4 s, sidecar, FFprobe e alinhamento.
- **Fase 39 ABERTA:** só restam dois bloqueios externos, registrados separadamente: NSIS em máquina limpa com narração e decisão sobre a licença do Remotion.
- **Defeitos corrigidos nesta rodada:** sugestão Motion contornava a trava de quota do Claude; `model` sempre nulo; skill explícita descartada sem rastro; preferências só valiam após reiniciar; adapter VoiceStudio incompatível com a API real (versão, modelos e vozes) e limite de 30 s na geração; alinhador falhava com nomes separados e palavras mal ouvidas.
- **38.6 parcial; 38.7 e 38.8 planejadas.** Fase 16: instalação limpa segue pendência externa, sem máquina adequada.
- **Gates:** typecheck, ESLint, build Electron, build Motion e `git diff --check` com saída 0; Vitest 125 arquivos, 1002/1002; integração 8/8 com 30 opt-in ignorados; Playwright 210 aprovados, 15 ignorados, 0 falhas.

## Auditoria transversal das fases — 2026-11-02 (atualizada)

- **Gates executados nesta auditoria:** typecheck completo aprovado; lint aprovado; build Electron aprovado; Vitest completo aprovado com **167 arquivos e 1.472 testes**; E2E Git da reorganização por abas aprovado com **22/22**.
- **Fase 17:** marcada como concluída por decisão do usuário; instalador NSIS foi gerado e instalado no Windows. Homologação formal em máquina limpa e MCP real permanecem ressalvas documentadas.
- **Fase 31:** 31.2 é biblioteca de templates; 31.3 é retry/fallback/checkpoint/retomada; 31.4 é automação ligada ao Git. As quatro subfases permanecem parciais até que cada critério restante tenha evidência correspondente.
- **Fase 34:** implementação local avançada e validada por testes; a homologação real de voz, Spotify, localização, captura de tela e chat no PC do usuário permanece externa. A próxima entrega instalável desta rodada é a 0.1.49.
- **Fase 38 — melhoria visual:** implementação inicial de abas e scroll interno validada em 22/22 E2E; a auditoria visual e acessibilidade final continuam abertas.
- **Fases 37.4/37.5, 38.6/38.7/38.8, 39.8, 42 e 43:** permanecem abertas ou parciais conforme seus próprios critérios; o gate automatizado não prova homologação externa, UX visual, Spotify autenticado, máquina limpa, licença ou controle real de janelas.
- **Regra de fechamento:** somente marcar uma fase como concluída quando implementação, testes específicos e evidência operacional estiverem registrados; bloqueios externos ficam separados em `docs/STATUS.md`.

## Fase 45 — Fala da Neura por frases

**Status: PLANEJADA (2026-11-02).** Plano: `docs/plans/phase-45-neura-live-local.md`.

**Cancelado por decisão do usuário:** modo Live, modelo local e modo híbrido. Claude e Codex continuam raciocinando, e a Neura só fala quando é chamada.

**Objetivo:** em respostas com mais de uma frase, começar a falar depois de gerar o áudio da primeira, em vez de esperar o áudio inteiro. Só implementar se a medição real mostrar que o áudio pesa na espera.

- [ ] Medir tempo do agente, geração do áudio e início da fala em uma chamada real.
- [ ] Implementar a fala por frases, com fila ordenada e cancelamento por nova chamada.
- [ ] Validar com testes e registrar o resultado.

## Fase 46 — Velix Motion: do roteiro ao vídeo

**Status: PLANEJADA (2026-11-03).** Plano: `docs/plans/phase-46-velix-motion-autopilot.md`. Depende da Fase 39 (Motion Engine) e da Fase 36.10 (VoiceStudio).

**Objetivo:** transformar o roteiro aprovado em um vídeo motion revisável: cenas geradas automaticamente e ligadas ao trecho do roteiro, troca do tipo de cada cena, narração gerada na própria aba Motion, cenas e legendas sincronizadas com a voz, fundo do vídeo, fotos e fontes.

**Pontos de aprovação antes de 46.1:** fontes (só empacotadas OFL ou também import local), origem das fotos (só locais/autorizadas ou banco de imagens), fundo em vídeo nesta fase, formato 9:16 nesta fase.

- [x] 46.1 — Contrato v2 aditivo implementado: upgrade em memória de v1, conversão entre os 6 tipos, seletor de tipo, reordenação e duração em segundos; testes direcionados, typecheck desktop e E2E Motion completo 8/8 aprovados.
- [ ] 46.2 — Contrato/parser ampliados para os 6 tipos e `segment` obrigatório no schema de saída; o parser agora preserva `photo` como cena v2 e a saída IPC valida cenas v2. Testes Motion direcionados 5/5 e typecheck completo aprovados. UI de aplicar/regenerar por cena, cobertura completa de fixtures e E2E com provider fake ainda pendentes. **2026-11-03 (Claude):** revisão por cena na aba Motion — botão "Gerar motions do roteiro", lista com tipo e trecho do roteiro, "Aplicar todas", "Aplicar" por cena e "Descartar"; E2E Motion 8/8 com o novo fluxo. "Regenerar esta cena" e rodada real com Claude/Codex continuam pendentes.
- [ ] 46.3 — Helper `selectNarrationAsset` implementado sobre o sidecar, recusando caminho/asset de outro projeto; Motion agora consulta apenas assets `ready` do sidecar por IPC/preload e oferece seletor de narração relativa, sem caminho livre. Typecheck completo aprovado. Geração na própria aba, prévia com áudio e E2E VoiceStudio ainda pendentes.
- [ ] 46.4 — Helpers determinísticos `alignMotionScenes` e `generateMotionCaptions` implementados: ajustam cenas, geram legendas a partir de palavras temporizadas e reportam trechos ausentes; testes Motion 12/12. Integração IPC/UI e áudio ainda pendentes. **2026-11-03 (Claude):** integração concluída — `transcribeVelixMotionVoice`/`syncVelixMotionNarration` no workspace, IPC `videoMotionSyncNarration` (direitos do áudio exigidos, roteiro aprovado lido no main, duração do asset do sidecar) e botão "Sincronizar cenas e legendas com a voz"; cenas sincronizadas ficam encadeadas (a primeira absorve o silêncio inicial, a última vai até o fim do áudio), `lockedDuration` editável na cena e trechos não ouvidos listados para revisão. Testes workspace 17/17 (encadeamento e sincronização com transcritor falso), typecheck completo e E2E Motion 8/8. Falta E2E da sincronização com kit falso e conferência por FFprobe/quadros na jornada real.
- [ ] 46.5 — Renderizador aplica fundo sólido/gradiente do contrato v2, fallback preto para v1 e fundo por cena; cena `photo` usa assetRef, escurecimento e movimento reduzido. Helpers de contraste AA adicionados e painel de estilo (fonte, destaque e fundo sólido) conectado ao draft; typecheck desktop aprovado. E2E completo 8/8 inclui render real; resolução confinada de assets e integração visual final ainda pendentes.
- [ ] 46.6 — Cena `photo`, resolução confinada, validação PNG/JPEG, fontes allow-list e manifesto v2 de licenças implementados; manifesto agora é visível no editor Motion. Testes Motion 15/15 e typecheck desktop aprovados. Registro de direitos na importação ainda pendente.
- [ ] 46.7 — Linha do tempo visual agora reutiliza `motionTimeline`, mostra cada cena com intervalo/duração/tipo, posiciona o Player Remotion no frame inicial ao clicar e permite foco por teclado na cena correspondente; sem segundo estado de execução. Typecheck completo aprovado. Ainda faltam axe/larguras/reduced-motion e matriz visual.
- [ ] 46.8 — Jornada real ponta a ponta, gates globais e instalador. Bundle Motion e build Electron construídos; o diagnóstico identificou caminho obsoleto do navegador (`chromium_headless_shell-1194`) e confirmou o executável instalado `chromium_headless_shell-1248`. Com `NB_MOTION=1` e o caminho real, a suíte E2E Motion completa passou 8/8 em 18,8 s, incluindo MP4 real, FFprobe, responsividade 1440/1024/960 e reduced motion. Lint, typecheck, diff-check, Vitest global em série (175 arquivos/1.539 testes, 187,87 s) e `verify:dist` do instalador `dist/NeuralBridge-Setup-0.1.57-x64.exe` também passaram; ainda pende homologação YouTube.

**Definição de pronto:** a jornada da 46.8 gera MP4 com áudio, duração igual à da narração e cenas sincronizadas, comprovado por FFprobe e reabertura após reiniciar; projetos v1 continuam abrindo e renderizando.

## Fase 47 — Velix Canal: ID visual, YouTube, agenda e otimizador

**Status: PLANEJADA (2026-11-03).** Plano: `docs/plans/phase-47-velix-channel.md`. Depende das Fases 36 (Discovery/Rights), 39 (Motion Engine) e 46 (vídeo final). Reaproveita o padrão OAuth/`safeStorage` do Spotify. A referência funcional é a skill MotionVelix v2.8.0 (portada para TypeScript, sem chamar a CLI Python).

**Objetivo:** nova aba **Canal** no Velix com:
- ID visual extraída do canal ou criada do zero (3 direções pelo nicho ou pela descrição) e peças nas medidas do YouTube;
- conexão OAuth do próprio usuário, com token criptografado;
- banner, marca d'água e descrição do canal pela API;
- publicação e agendamento do MP4 do Velix por tarefa do TaskEngine retomável;
- calendário de agendados e planejados;
- otimizador de título, descrição, tags e horário com dados reais do nicho.

Cada escrita no canal exige aprovação humana de uso único.

**Pontos de aprovação antes de 47.1:**
- REST com `fetch` ou o pacote `googleapis`;
- cliente OAuth do usuário ou do NeuralBridge;
- escopos incrementais (`youtube.readonly` → `youtube`);
- peças em Remotion ou HTML/Playwright;
- Analytics do próprio canal nesta fase ou depois.

- [ ] 47.1 — Contrato `velix-channel.ts`, migrações aditivas `0057`/`0058`, núcleo PKCE/loopback genérico, `VelixChannelRepository` e cliente REST YouTube tipado implementados; importação segura, conexão PKCE, perfil autenticado e estado OAuth passam por IPC/preload e a aba Canal já consulta o perfil real. O callback aceita `localhost`/`127.0.0.1` e os schemas toleram metadados oficiais (`kind`, `etag`, `pageInfo`); testes YouTube 8/8 e typecheck global aprovados. Ainda pendem branding, publicação e agenda.
- [ ] 47.2 — Gerador determinístico de três direções criadas pelo nicho e editor na aba Canal adicionados; cada direção pode ser selecionada e aprovada, persistida no `VelixChannelRepository` e recuperada após reinício, com timestamp de aprovação. Validação AA 4,5:1 ocorre no contrato e no IPC; a aprovação agora gera SVGs locais de banner, marca d'água e thumbnail, com dimensões e SHA-256 no manifesto. Typecheck completo e testes shared/database 3/3. Extração real, nove direções e acabamento visual das peças ainda pendentes. **2026-11-03 (Claude):** peças reais e editor — `velix-brand-pieces.ts` gera banner 2560×1440 (nome, frase e símbolo dentro da área segura 1546×423), foto de perfil 800×800, logo 1800×600 transparente, marca d'água 150×150 e thumbnail base 1280×720, com texto escapado; o mesmo SVG alimenta a prévia ao vivo e os arquivos de `channel-assets/`. A aba Identidade visual mostra as 3 direções já como banner, permite editar nome, frase, iniciais, símbolo, fontes e as três cores (com aviso de contraste < 4,5:1), marca as áreas seguras do banner e salva cada peça no PC em PNG no tamanho exato ou em SVG. Extração da identidade de um canal existente e nove direções continuam pendentes. **Modelos profissionais (2026-11-03, Claude):** portadas as 9 direções da skill MotionVelix (`mv_marca.py`: premium, fintech, crescimento, cyber, energia, neon, clean, quente, suave) com escolha por nicho, paletas de 6 cores e símbolos da skill; cada direção tem composição própria (moldura e medalha, gráfico, barras, circuito, faixas e nome fantasma, anéis neon, blocos, arcos, formas suaves) com brilho e granulado, sempre fora da área segura. Fontes OFL embutidas nos SVGs (`packages/shared/assets/brand-fonts`, `scripts/generate-brand-fonts.mjs`): Inter, Anton, Archivo Black, Bebas Neue, Instrument Serif, Space Grotesk, Fredoka, JetBrains Mono. Princípios das skills Canvas Design (sem sobreposição), SVG Logo Designer (logo para fundo escuro e para fundo claro, `<title>` acessível) e Collateral Design (hierarquia num olhar) aplicados; a quente trocou o terracota clichê por páprica. Editor ganhou seletor de Estilo. Banner e thumbnail sobem como JPEG (o granulado passava de 6 MB em PNG; achado pelo E2E). Gerador de thumbnail por vídeo na aba Publicar, no visual aprovado, com prévia, Salvar no PC e uso direto no envio.
- [ ] 47.3 — Parser estrito de `client_secret.json`, URL PKCE incremental, troca de código, refresh, revogação e `OAuthSecretStore` criptografado adicionados; importação via UI, IPC e armazenamento seguro validados por typecheck/testes. Conexão loopback, persistência de tokens, desconexão/revogação e estado na aba Canal agora estão ligados; ainda pendem perfil do canal e operações de publicação. **2026-11-03 (Claude):** corrigidos dois bloqueios da homologação — a conexão pedia só `youtube.readonly` e nenhuma escrita funcionaria no canal real; agora há ampliação incremental ("Permitir envio e edição" → `youtube`) e o status expõe `canWrite`. O access token passa a ser renovado automaticamente (`channelAccessToken`, `expires_at` absoluto, escopo concedido preservado), e escritas sem escopo falham antes da chamada com `scope_required`. Testes `channel-token` 5/5.
- [ ] 47.4 — Perfil autenticado e aplicação de `brandingSettings` agora usam REST oficial, IPC protegido e confirmação explícita de uso único; a UI exibe o payload antes da escrita. Geração de identidade, banner/marca d'água e E2E ainda pendentes. **2026-11-03 (Claude):** a aprovação deixou de depender do `confirmed: true` enviado pelo renderer — `ChannelApprovalGate` no main abre o diálogo nativo com resumo montado a partir da entrada validada, a cada execução (envio, retomada, reagendamento após checar dono/privacidade, branding), e registra só ação e resultado. Testes `channel-approval` 3/3. **2026-11-03 (Claude):** "Avaliar e subir para o canal" na Identidade visual: avaliação determinística (contraste do texto, do símbolo e do destaque, tamanho do nome no celular, frase, iniciais), lista "O que vai mudar no canal" com antes/depois e caixas (banner, marca d'água com posição, descrição, palavras-chave) e botão "Subir para o YouTube" com uma aprovação nativa listando as mudanças e barra de progresso por etapa. Usa `channelBanners.insert` + `channels.update` (bannerExternalUrl, mesclando o branding atual) e `watermarks.set` multipart; PNGs validados no main (assinatura, 16:9 ≥2048×1152 e ≤6 MB; marca ≤800×800 e ≤1 MB) e guardados em `channel-assets/`. Foto de perfil e nome seguem pelo Studio (limite da API). E2E Canal 6/6, Vitest 181/1.572 e lint aprovados. Pendente: a arte gerada é um modelo simples (símbolo + texto); falta importar arte própria e/ou modelos melhores.
- [ ] 47.5 — Cliente REST implementa sessão resumable real (`POST` de sessão + `PUT` de bytes) com `AbortSignal`, thumbnail via `thumbnails.set`, e a aba Canal valida confinamento dos arquivos, exige confirmação, envia com privacidade escolhida e suporta horário futuro. Jobs de publicação têm migrações `0058`/`0059`, estados persistidos, progresso, checkpoint cifrado, recuperação como `paused` sem descarte do checkpoint, falha registrada, status e cancelamento IPC; endpoint assíncrono retorna o ID antes do upload e a UI permite cancelar durante a execução. Validação compartilhada cobre título, descrição, tags, agendamento mínimo de 15 minutos e thumbnail de até 2 MB. A camada HTTP continua múltiplos PUTs após `308`, emite checkpoints e valida `Content-Range` (cliente 7/7); IPC/preload agora reanexam job pausado, decifram o checkpoint somente no processo principal e retomam o restante do arquivo. Falta validar E2E YouTube falso.
- [ ] 47.6 — Publicações persistidas agora são expostas por IPC e listadas na aba Canal após upload/reabertura, incluindo estado e horário agendado; publicações agendadas também criam itens persistidos em `velix_agenda_items`, expostos por IPC/preload em um calendário mensal acessível com navegação de mês. Cliente REST agora lê vídeos próprios e suporta `videos.update`; a agenda mescla itens remotos e a UI permite reagendar com confirmação única. O handler consulta o estado atual, recusa vídeo inexistente ou público e só então atualiza. Typecheck completo e cliente YouTube 4/4 aprovados. Ainda falta validar a jornada E2E com servidor falso.
- [ ] 47.7 — Núcleo determinístico em `velix-optimizer.ts` está ligado à aba Canal: notas observáveis cobrem tamanho, palavra-chave inteira/no início, número, gatilho, caixa alta, primeiros 150 caracteres, hashtags, capítulos, CTA e limite de tags; três horários transparentes em dias distintos aparecem no rascunho. A aba também consulta `search.list` sob ação explícita, informa custo de 100 unidades, persiste títulos/resultados sanitizados em `velix_niche_references` e não usa a busca como instrução. Sugestões de cinco títulos/descrição/tags passam pelo TaskEngine `runStructuredReadOnly`, contrato estrito e revisão humana, sem persistir ou publicar automaticamente. Horários convertem wall-clock para UTC usando o timezone real informado. Cliente YouTube 5/5, otimizador 3/3 e typecheck completo aprovados. Ainda falta paridade completa da skill.
- [ ] 47.8 — E2E com YouTube falso, homologação real com envio privado, matriz visual e gates globais. Jornada fake do cliente oficial passou em `velix-youtube-fake-journey.test.ts` (sessão, 308/retomada, thumbnail, vídeos próprios e reagendamento); a rodada direcionada banco/orquestrador/executor passou 4/4 arquivos e 22/22 testes, com lint e diff-check aprovados. A contagem global anterior (175/175 arquivos, 1.539/1.539 testes) foi anterior ao novo fixture; ainda falta a jornada desktop contra servidor fake e a homologação real privada. **2026-11-03 (Claude):** jornada desktop contra YouTube falso local aprovada em `tests/e2e/velix-channel.spec.ts` (3/3 repetições): importar `client_secret.json`, conectar só leitura com PKCE verificado, ampliar para `youtube`, gerar e aprovar a identidade, branding recusado no diálogo nativo sem nenhuma escrita e depois aplicado preservando descrição/palavras-chave, envio agendado recusado e depois aprovado com PUT meio recebido + retomada pelo `Content-Range`, thumbnail, `publishAt` em UTC, reagendamento com nova aprovação, reinício sem novo OAuth com agenda e publicação relidas, e nenhum segredo em texto no renderer nem em arquivo da pasta de dados. A jornada revelou e corrigiu três defeitos que quebrariam o canal real: bytes iam para `/youtube/v3` em vez de `/upload/youtube/v3` (vídeo e thumbnail); o `308 Resume Incomplete` virava erro de rede no `fetch` com `redirect: 'error'`; e o `PUT` da sessão saía sem `Authorization`. Também: sessão de upload só aceita na origem do endpoint de upload, endpoints sobrescrevíveis só fora do app empacotado e só https/loopback, "Reagendar" sem `window.prompt` (não existe no Electron) e agenda exposta como região. Cliente YouTube 11/11 (inclui 308 com `fetch` real), Vitest direcionado 121 arquivos/1.058 testes, Motion E2E 8/8, typecheck e lint aprovados. **Falhas (2026-11-03, Claude):** segundo cenário em `velix-channel.spec.ts` cobre cota esgotada (`quotaExceeded` → mensagem traduzida, sem o texto livre do Google), conexão derrubada (`network: sem conexão`), upload travado cancelado pela pessoa (job `cancelled`, requisição fechada, nenhum vídeo criado) e desconectar com e sem o Google respondendo; a suíte passou 6/6 em 3 repetições. O cliente agora traduz `quotaExceeded`, `uploadLimitExceeded`, `accessNotConfigured`, `insufficientPermissions`, canal inexistente e 401; desconectar apaga o token local antes de revogar (funciona offline), revoga o refresh token e mostra o link de revogação manual quando o Google não confirma. Cliente YouTube 12/12, Vitest em série 121 arquivos/1.059 testes, typecheck e lint aprovados. Pendente: homologação real com envio privado. **Sub-abas (2026-11-03, Claude):** o Canal foi dividido em Publicar vídeo (lista dos MP4 do projeto, prévia, Salvar no PC, otimizador e envio com barra de porcentagem real por bytes), Calendário (agenda, reagendar e histórico), Identidade visual e Configuração (conexão, guia e branding avançado); abre em Configuração enquanto não há conexão. Upload agora vai em blocos de 8 MiB com `Content-Range` total, e cada bloco confirmado atualiza o progresso e o checkpoint. Corrigida a skill `neuralbridge:velix-channel-optimizer`, que não estava registrada e fazia "Sugerir títulos" falhar. E2E do Canal 6/6 (3 repetições) cobrindo as sub-abas, prévia e salvar vídeo, PNG 2560×1440 salvo, barra em 100%; Vitest em série 180 arquivos/1.565 testes e lint aprovados.

**Definição de pronto:** num canal real, conectar, criar e aprovar a ID visual, aplicar o banner, otimizar e enviar um vídeo privado agendado e vê-lo na agenda depois de reiniciar. Nenhum segredo fora do armazenamento criptografado. As abas existentes do Velix e a Discovery sem regressão.

## Fase 48 — Velix Estilos: escolher o estilo de cada vídeo

- [x] Provedor de produção (2026-11-04): seletor global Claude/Codex persistido no card de limites; novas produções registram o agente escolhido, retomadas usam o valor original, linhas legadas usam `claude` como fallback determinístico e não há troca automática por falha. A seleção de estilo e o fluxo `videoProductionRunRender` permanecem independentes. Evidência: migration `0086_velix_production_agent`, testes direcionados 39/39 e typecheck completo.

**Status: PLANEJADA (2026-11-03).** Plano: `docs/plans/phase-48-velix-video-styles.md`. Depende das Fases 36 (produção e Rights Manager), 39/46 (Motion) e 47 (nicho do canal).

**Objetivo:** o fluxo Produzir → Estúdio deixa de renderizar sempre o Dossiê, e os estilos podem ser misturados (estilo por cena e tratamentos, como colagem de jornal no Dossiê). A pessoa escolhe o estilo de cada vídeo numa galeria, com prévia de quadros reais gerados com o próprio roteiro, e pode trocar o estilo no Estúdio sem refazer o roteiro. Todos os estilos seguem o mesmo contrato: roteiro aprovado → cenas comuns → adaptador do estilo → render → FFprobe.

**Famílias de estilo:** Dossiê (padrão), os 11 modelos da MotionVelix (6 já expostos + texto gigante, podcast, legendas premium/infantil, sobreposição para quem fala na câmera), Remotion (Motion em cenas), One take (portado, PolyForm Noncommercial), estilos do Lemo-opuscar (MIT, cópia fixa) e animação desenhada (claude-animation, MIT, depois da revisão de segurança). A colagem com IA (Gemini, pago) é opcional.

**Decisões:**
- [x] Uso comercial: o NeuralBridge é de uso próprio e não será vendido (2026-11-03); o One take pode ser portado e fica marcado como não comercial.
- [x] Onde escolher o estilo: no começo da criação, com troca no Estúdio (2026-11-03).
- [x] Trazer o Lemo-opuscar e o One take (aprovado pelo usuário em 2026-11-03).
- [x] Mistura de estilos no plano: estilo por cena e tratamentos (pedido do usuário em 2026-11-03).
- [x] Primeiro lote do Lemo-opuscar (2026-11-03): Swiss Motion Graphics, Whiteboard Explainer, Data Storytelling, Dark Tech Keynote, Caption News e Halftone Dossier. Os demais em lotes seguintes.
- [x] Colagem com IA paga: depois (2026-11-03).
- [x] Animação desenhada portada para o Chromium, sem `canvas` nativo (2026-11-03).
- [x] Formato 9:16: depois (2026-11-03).

- [x] 48.1 — CONCLUÍDA (2026-11-03). `packages/shared/src/video-styles.ts`: registro validado por zod (família, motor, versão, licença com `noncommercial`, requisitos, formatos, custo, tratamentos), escolha de estilo validada (estilo/versão/tratamento conhecidos, estilo por cena, no máximo 3 estilos) e `commonScript`, a leitura neutra do roteiro aprovado (que no fluxo de produção já é o JSON do Dossiê). `resolveStyleRender` (workspace) devolve para o Dossiê o mesmo template e **a mesma string de dados** de antes, provado em teste. Migração aditiva `0060_velix_video_styles` (tabela por projeto em vez de coluna, porque não existe tabela de produção) e `VelixStyleRepository`; IPC/preload `videoStyles`, `videoStyleLoad`, `videoStyleSave`; o render de produção passa pelo registro. Evidência: testes novos de contrato, resolvedor e repositório (incluindo cascata e escolha obsoleta lida como nenhuma); `database.test.ts` com banco novo e upgrade de todas as migrações anteriores; Playwright de vídeo 35/35 (3 pulados por exigirem rede/CLIs reais); typecheck e lint completos; Vitest em série 1.581/1.582 — a falha foi `git-write.test.ts` (não alterado), estouro de 5 s sob carga, que passou 2/2 isolado. O render do Estúdio por nome continua fixo no Dossiê até a troca de estilo da 48.2.
- [x] 48.2 — CONCLUÍDA (2026-11-03). Galeria "Estilo do vídeo" (`StyleGallery`): cartões com finalidade, família, custo, licença não comercial e requisitos (estilos sem o que precisam ficam desabilitados com o motivo), recomendação pelo texto do vídeo (`recommendVideoStyles`) e prévia de 3 quadros com o roteiro da pessoa (`videoStylePreview`, mesmo render do estilo). Entra no Novo vídeo (antes de gerar o roteiro; a escolha é gravada para o vídeo criado), no Produzir (gravada antes do render) e no Estúdio (troca sem refazer o roteiro). O estilo agora é **por vídeo**: a `0060` (ainda não lançada) foi ajustada para a chave projeto + vídeo, com o padrão do projeto como reserva; a prévia e o render do Estúdio passam a usar o estilo do vídeo. E2E novo (escolher, ver a prévia, reiniciar e manter) e suíte de vídeo 37 passaram (3 pulados por exigirem rede/CLIs reais); Vitest em série 1.583/1.583; lint e typecheck completos. Enquanto a 48.3 não chega, o registro tem só o Dossiê.
- [x] 48.3 — CONCLUÍDA (2026-11-03). Parte A: adaptadores roteiro → dados (`velix-style-adapters.ts`) com escape do texto para os campos que o kit monta por `innerHTML` (texto puro nos de `textContent`), duração total igual à do roteiro e fonte visível sem rótulo duplicado. Parte B: cinco camadas sobre vídeo gravado (legenda premium, legenda infantil, sobreposição para quem fala, podcast e texto gigante), com vídeo base autorizado, palavras cronometradas, texto seguro, render transparente com `--alpha` e composição FFmpeg que preserva áudio e duração do base, inclusive na prévia. Registro com o **tipo** de cada estilo e exigência de base/transcrição; testes direcionados 43/43, typecheck completo e lint dos arquivos tocados aprovados. Evidência anterior da Parte A: render real pelo motor do kit a partir do mesmo roteiro — explicativo 14,0 s e tipografia 14,0 s (= roteiro), logo reveal 5,6 s, todos 1080×1920 com áudio pelo FFprobe; quadros revisados das 7 peças; E2E de seleção/prévia/render no Estúdio.
- [x] 48.4 concluída (2026-11-04): Base/Editorial/One take têm visuais distintos no bundle; One take usa câmera determinística por frame e fades contínuos. Oito presets foram renderizados em MP4/FFprobe, com E2E Motion 8/8.
- [x] 48.5 concluída (2026-11-04): seis estilos locais, licença MIT e hash upstream `bebbbe1aa92a3cb4bb6f83500e61b23a17d1aa00` registrados; renders reais FFprobe válidos e auditoria estática sem rede/shell no port.
- [x] 48.6 fundação (2026-11-03): contrato `StyleTreatment` e primeiro tratamento `colagem-jornal` no Dossiê; `planStyleMix` agrupa cenas vizinhas, propaga tratamentos, emite transições de ponte e recusa tratamento incompatível, vídeo base ausente ou mais de três estilos antes do render. O Estúdio agora persiste e recupera exceções de estilo/tratamento por cena, com seletores acessíveis, timeline visual por cena e prévia real do segmento escolhido; a colagem do Dossiê já entra no compositor Remotion com preset visual próprio; misturas Remotion e kit por cena são renderizadas, normalizadas sem áudio, concatenadas pelo FFmpeg e recebem narração contínua. Testes shared 6/6 + resolvedor 3/3 + fronteira kit 2/2, typecheck desktop, lint, `build:motion` e diff-check aprovados; E2E híbrido pela aplicação 1/1 com FFprobe.
- [x] 48.4 — Motion em cenas no fluxo principal (modelos realmente diferentes) e estilo One take.
- [x] 48.5 — Estilos portados do Lemo-opuscar, sem download em tempo de execução.
- [x] 48.6 — Mistura de estilos: pontos de encaixe no Dossiê, tratamento "Colagem de jornal", estilo por cena montado pelo FFmpeg com áudio contínuo e limite de 3 estilos.
- [x] 48.7 — Animação desenhada (Livro ilustrado, Tinta e aquarela) após revisão de segurança.
- [x] 48.7 fundação (2026-11-04): Livro ilustrado e Tinta e aquarela entram no catálogo como presets Remotion locais, determinísticos, sem `canvas` nativo, download ou provedor externo; composição com papel/grão, pincel e aquarela é compartilhada pelo bundle Motion. Teste do adaptador 3/3, render real dos dois MP4s (2,0 s cada, vídeo válido pelo FFprobe), quadros revisados, typecheck/lint e E2E Motion 8/8 aprovados. Revisão de segurança registrada em `packages/shared/assets/drawn/PORT.md`.
- [x] 48.8 — CONCLUÍDA (2026-11-04): colagem editorial opcional com Gemini configurado pelo usuário e chave cifrada via `safeStorage`; estimativa antes da geração; duas aprovações independentes (metáfora e quadro); geração de still/MP4 com QA por FFprobe; mídia registrada no Rights Manager e B-roll inserido entre cenas na mistura. Vitest direcionado 12/12, E2E provider fake com MP4 válido 1/1, typecheck, build e diff-check aprovados. Sem chave Gemini, a função permanece indisponível e não gera/cobra nada.
- [x] 48.9 — Jornada real com pelo menos 8 estilos e uma mistura, matriz visual, E2E e gates.
- [x] 48.9 fundação de jornada (2026-11-04): o mesmo roteiro foi renderizado em oito presets Remotion (`base`, `editorial`, `one-take`, Swiss, Whiteboard, Data, Dark Tech e Caption News), todos com 1,5 s e vídeo confirmado pelo FFprobe; E2E da galeria/Estúdio (seleção, 3 quadros, render e reinício) passou 1/1; E2E Motion completo passou 8/8; matriz responsiva 960/1024/1440 e movimento reduzido passaram; teste de integração renderizou um segmento kit real + segmento Remotion real e confirmou concatenação/FFprobe; E2E pela aplicação da mistura kit + Remotion passou 1/1 com MP4 acima de 3,5 s. Revisão formal 48.7 registrada.

**Definição de pronto:** o mesmo roteiro vira vídeos com caras realmente diferentes em pelo menos 8 estilos escolhidos na galeria e num vídeo misturado (Dossiê com Colagem de jornal e 3 estilos por cena), cada um com prévia e FFprobe; a escolha sobrevive ao reinício; projetos atuais seguem no Dossiê; nenhum código externo é baixado em tempo de execução.
## Velix — produção audiovisual autônoma

- [x] Fase A inicial: contratos versionados de briefing/formato, cálculo puro de palavras, persistência aditiva de runs, stages, artifacts, budgets, approvals e quality reports, além de `ProductionRunService` sobre o `TaskEngine`.
- [x] Fase A — execução persistida (2026-11-04): `ProductionRunService` sincroniza cada etapa com os eventos de status do TaskEngine (concluída/falhou/cancelada/pausada), reserva orçamento antes de iniciar e reconcilia o custo real ao terminar, segura em `awaiting_approval` (sem iniciar tarefa) o que excede o orçamento até aprovação/rejeição registrada, cancela/pausa a produção inteira e, no boot após `TaskEngine.recover()`, devolve etapas interrompidas para `pending` (mesma etapa, mesmo `outputArtifactIds`) para `resume` reexecutar sem duplicar. Artefatos são idempotentes por etapa + hash e com caminho relativo validado (sem traversal, drive, UNC ou esquema). Relatório de qualidade calcula `exportable` pelos checks bloqueantes. IPC `video:production-run:*` + evento de mudança, preload e painel "Produções persistidas" na aba Produzir (criar briefing com formato/duração/ritmo/orçamento e meta de palavras, etapas, custo previsto/real/reservado, pausar/retomar/cancelar, aprovar/rejeitar custo). Evidência: Vitest `velix-production.test.ts` 6/6 (TaskEngine real + FakeAdapter, reinício simulado sem duplicar etapa/artefato), regressão database/shared/engine 172/172, E2E Electron `velix-production-runs.spec.ts` 1/1 (criar pela UI → reiniciar → etapa interrompida volta como Pendente → cancelar) e `velix-gaps.spec.ts` 6/6, typecheck global, ESLint dos arquivos alterados e build.
- [ ] Fase A — pendências: adaptadores concretos por etapa (roteiro, pesquisa, narração, render…) que gravem artefatos e progresso parcial; agendamento de etapas pela UI depende desses adaptadores (Fases B–F). Capability flag por projeto (seção 14 do plano) ainda não existe.
- [x] Fase B — formatos e roteiros longos (2026-11-04): catálogo de tipos de produção (`PRODUCTION_TYPES`, 7 tipos com tom, estrutura e ritmo) e de formatos (`VIDEO_FORMATS`); meta de palavras por duração/ritmo; `planChapters` divide a meta em capítulos equilibrados (700 palavras por chamada, bem abaixo do limite de 12.000 caracteres); janela de contexto por capítulo (resumo canônico, entidades, termos, fatos, decisões de estilo, resumos anteriores, final do capítulo anterior, beats atuais e próximos); `consolidateChapters` remove frases repetidas (normalizadas, ≥ 6 palavras) dos capítulos seguintes, nunca reescreve capítulo aprovado (reporta `locked_repetition`) e reporta capítulo faltante, duplicado ou fora da meta. O `ProductionRunService` ganhou etapas por adaptador: rodam em segundo plano, cada lote é uma capacidade estruturada read-only do TaskEngine, o estado é salvo a cada lote, pausa/cancelamento param no limite do lote (sem gravar artefato depois disso) e reinício/falha retomam do próximo capítulo. O adaptador `script` mantém o Dossiê v1 (mesmo prompt e parser de `video-script.ts`) até 2.000 palavras; acima disso usa esboço + capítulos + consolidação e grava `producoes/<run>/roteiro/{esboco,capitulo-NN,roteiro}.json`. Fontes do roteiro: referências aprovadas da descoberta, tratadas como dados. IPC `video:production-run:script` e `script-read`; o painel ganhou tipo de produção, previsão de capítulos, "Gerar roteiro", progresso real e resumo do roteiro consolidado. Evidência: Vitest `velix-long-script` 7/7, `velix-script-stage` 5/5 (3.200 palavras em 6 tarefas do TaskEngine; reinício no meio sem reenviar lotes prontos nem duplicar artefatos; lote fora do contrato mantém capítulos e conclui no retry; pausa e retomada; Dossiê v1 curto), `velix-production` 6/6; shared/database/orchestrator 684/685 em paralelo, com a falha isolada em `workflow-runner.test.ts` aprovada 23/23 em `--no-file-parallelism` (não relacionada); E2E `velix-production-runs` 2/2 (roteiro de 3.190 palavras em 5 capítulos pela UI, 1 repetição removida, reaberto após reiniciar), `velix-gaps` + `velix-discovery` 18 aprovados e 3 pulados (exigem rede/CLI reais); typecheck global, ESLint dos arquivos alterados e build.
- [ ] Fase B — pendências: estimativa de custo por lote (hoje a etapa usa a estimativa informada, 0 por padrão) e aprovação/bloqueio de capítulos pela UI (o contrato `lockedChapters` já existe no IPC). Execução com agente real não foi feita nesta sessão (`NB_REAL_CLI` desligado).
- [x] Fase C — evidências e pesquisa audiovisual (2026-11-04): migrações aditivas `0073`–`0077` (`velix_editorial_claims`, `velix_claim_evidence`, `velix_research_cache` e índices únicos); `VelixClaimRepository` idempotente por run + texto normalizado e por afirmação + URL, sem reabrir decisões humanas; contratos em `velix-evidence.ts` (tipos fato/opinião/estimativa/previsão, classificação evidência/descoberta/mídia candidata/inutilizável, URLs só http(s), `claimGate` e check bloqueante `claims-supported`). O adaptador `research` lê o roteiro do run, verifica cada capítulo (ou trechos de ~400 palavras no Dossiê) por uma capacidade read-only do TaskEngine contra as referências já aprovadas na Descoberta, com cache por trecho + conjunto de fontes e checkpoint por trecho. Evidência que cita fonte não aprovada vira "descoberta" e a URL entra na Descoberta como referência pendente; mídia sugerida também entra só como pendente, sem direitos; só evidência de referência aprovada pode ser aprovada, e só por uma pessoa. Fato sem evidência aprovada mantém o relatório de qualidade não exportável; reclassificar como opinião/estimativa/previsão é decisão do usuário e fica registrada (`kindSource: user`). Cada decisão grava um novo relatório de qualidade. IPC `research`, `claims`, `evidence-decide`, `claim-kind`; painel "Evidências" com situação do gate, "encontrada, não autorizada" separado de "referência aprovada", aprovar/rejeitar e tipo por afirmação. Evidência: Vitest `velix-evidence` 4/4 e `velix-research-stage` 3/3 (TaskEngine real; cache entre produções; reclassificação; recusa sem roteiro), `database.test.ts` 25/25 com as tabelas novas; shared + orchestrator 666/667 em paralelo, com a única falha em `workflow-runner.test.ts` (não relacionada; 23/23 em `--no-file-parallelism`); E2E `velix-production-runs` 3/3 (pesquisa pela UI após reinício, 2 candidatos pendentes, 0 direitos criados, gate passa só após aprovação) e `velix-gaps` + `velix-discovery` 18 aprovados/3 pulados; typecheck global, ESLint e build.
- [ ] Fase C — pendências: busca web por trecho (hoje a pesquisa só usa referências aprovadas e o conhecimento do agente, sem `webSearch`); o trecho de evidência é informado pelo agente e não é conferido contra o texto da fonte; o gate ainda não é aplicado ao render/exportação da produção (isso entra nas Fases F/I, que consomem o relatório de qualidade).
- [x] Fase D — storyboard e seleção de mídia (2026-11-04): contratos em `velix-storyboard.ts` (cena com tempos, afirmações ligadas, objetivo visual, tipo, termos de busca, visual = mídia autorizada | fallback declarado | nenhum, texto na tela, transição, câmera, bloqueio e revisão); geração determinística por frases (~20 palavras por cena, nunca atravessando capítulo) com tempos estimados pelo ritmo, reprocessados a cada edição; ranking puro e explicável (relevância, qualidade, proporção, duração, atualidade, diversidade e consistência) em que só `verified_allowed` vigente é elegível — o restante aparece como encontrado; sem mídia adequada, fallback explícito (tipografia, documento, animação; gráfico só com afirmação sustentada). Validação bloqueante: intervalo, sobreposição, cena sem visual, mídia sem direitos vigentes, texto fora da área segura e fato sem evidência aprovada. Edições: atualizar, mover, trocar, bloquear/desbloquear e dividir (a narração nunca é dita duas vezes); cena bloqueada só aceita desbloqueio e é preservada na nova seleção. Persistência: migrações `0078`–`0079` (`velix_storyboards`) com versões imutáveis e concorrência otimista por `baseVersion`; **decisão registrada:** em vez das tabelas sugeridas `velix_storyboard_scenes` e `velix_media_selection`, cada versão guarda o storyboard normalizado inteiro, o que dá restauração exata e histórico atômico — a seleção (mídia, score e motivo) fica dentro da cena. Etapa `storyboard` sem agente (não chama CLI), idempotente após reinício para o mesmo roteiro; `StoryboardService` para ler, ordenar candidatos, editar e reescolher. IPC `storyboard`, `storyboard:get|candidates|edit|reselect`; painel com cenas, situação, pendências, mover para cima/baixo (alternativa por teclado ao arrastar, com anúncio da posição), dividir, bloquear, texto na tela e troca de mídia com candidatos ordenados e fallbacks. Evidência: Vitest `velix-storyboard` 5/5 e `velix-storyboard-stage` 2/2 (editar/mover/trocar/bloquear, conflito de versão, reabrir o banco e recuperar estado idêntico, direito revogado tornando o storyboard não renderizável, reescolha preservando cena bloqueada); shared/database/orchestrator 699/699; E2E `velix-production-runs` 4/4 (storyboard pela UI, mídia pendente desabilitada, reinício com `storyboardGet` idêntico) e regressão Velix 22 aprovados/3 pulados; typecheck global, ESLint e build.
- [ ] Fase D — pendências: arrastar e soltar (hoje há botões e anúncio de posição); objetivo visual e termos de busca são heurísticos (sem agente); dimensões e duração das mídias ainda não vêm da análise FFprobe (o ranking usa valores neutros); o download de mídia autorizada continua fora desta fase.
- [x] Fase E — narração longa e sincronização (2026-11-04): contratos puros em `velix-sync.ts` (blocos de TTS sem partir cena e abaixo do limite do VoiceStudio, manifesto de continuidade com modelo/voz/idioma/velocidade e duração de cada bloco, alinhamento de palavras com janela que tolera palavra extra ou perdida, cenas no tempo real contíguas de 0 até a duração medida, frases temporizadas, relatório de palavras ausentes, cena não reconhecida, pausas longas, desvio da estimativa e cobertura mínima de 90%). Etapa `narration`: fala o storyboard mais recente pelo VoiceStudio local com o mesmo modelo e voz, exige as 4 revisões de licença + confirmação, guarda cada bloco por conteúdo (texto + modelo + voz + idioma + velocidade), então reinício ou nova narração só falam o bloco que mudou; une com FFmpeg (filtro concat, WAV 48 kHz mono) e mede com FFprobe (`velix-audio.ts` em `workspace`). Etapa `sync`: transcreve a narração pelo transcritor local do kit, alinha, grava nova versão do storyboard `source: sync`, `timing: measured`, e um `timeline-vNNN.json` com palavras, frases e relatório; registra checks de qualidade (`narration-sync` bloqueante, pausas e desvio). Edição que só muda visual/texto na tela/bloqueio mantém o tempo medido; mover/dividir volta a "estimado"; se o que é falado mudou, a sincronização recusa (`stale`) até nova narração. IPC `voices`, `narration`, `sync`, `narration-get`; painel "Narração e sincronização" com modelo, voz, revisões de licença, geração, aviso de narração desatualizada e relatório; storyboard indica tempos medidos ou estimados. Evidência: Vitest `velix-sync` 4/4 e `velix-narration-stage` 1/1 com FFmpeg/FFprobe reais (2+ blocos, duração unida ≈ soma, cenas contíguas até a duração medida, edição visual mantém medido, mover deixa a narração desatualizada, nova narração fala só 1 bloco); shared/database/orchestrator + testes Velix do workspace 745/745; E2E Electron `velix-production-narration` 1/1 (VoiceStudio falso por HTTP com WAV real, transcritor falso do kit, sincronização 100%, dividir cena e ressincronizar, reinício com storyboard idêntico) repetido 4× e junto de `velix-production-runs` (5/5); regressão Velix 18 aprovados/3 pulados; typecheck global, ESLint e build. Na primeira execução logo após o build, o E2E novo falhou uma vez sem a causa capturada (saída filtrada); não se reproduziu em 9 execuções seguintes — registrado como intermitência a observar.
- [ ] Fase E — pendências: narração e transcrição reais (VoiceStudio e `transcrever.py` com Whisper) não foram executados nesta sessão; prévia de áudio na interface; a transcrição em pt fixo (`--idioma pt`) ainda não segue o idioma do briefing; custo de TTS é zero por ser local, sem estimativa para provedores pagos.
- [x] Fase F — compositor por formato e QA (2026-11-04): `velix-composition.ts` monta o plano de render a partir do storyboard medido — cenas com fallback viram segmentos Remotion (MotionProject v2, até 30 cenas e metade do limite de quadros por segmento) e cada mídia local autorizada vira segmento FFmpeg (cobre o quadro do formato); limites de quadro calculados uma vez por fronteira, sem deriva da narração; recusa render com tempos estimados, mídia sem arquivo local ou sem direito vigente. Legendas SRT a partir das frases medidas (até 2 linhas dentro da largura segura), gravadas no vídeo quando o FFmpeg tem libass (o FFmpeg do Remotion não tem: as legendas saem como SRT e o check `captions-burned` vira aviso). QA mínimo do plano: arquivo, resolução, proporção, FPS, áudio, duração ±250 ms da narração medida, silêncio ≥ 3 s, legendas, área segura, cenas vazias/duplicadas, direitos vigentes, afirmações sem evidência e orçamento; bloqueantes decidem `exportable`. Aprovação explícita com motivo só para itens dispensáveis — arquivo, resolução, proporção, áudio, direitos e afirmações nunca são dispensados. Etapas `render` (segmentos por conteúdo: segmento inalterado não é renderizado de novo; manifesto com versões do motor, storyboard e narração) e `export` (copia MP4 + SRT, `creditos.txt` do Rights Manager e `fontes-e-licencas.json` com mídias, direitos e afirmações com fonte aprovada; recusa render não exportável); `RenderService` para lista, nova verificação e aceite. `refreshRun` passou a considerar só a tentativa mais recente de cada etapa ao marcar a produção como falha. FFmpeg em `workspace/velix-production-render.ts` restrito aos filtros do FFmpeg empacotado (scale, crop, format, concat), com `-aspect` para SAR 1:1 (o scale gerava 10240:10239 e o concat recusava) e erros com as linhas relevantes do stderr. IPC `render`, `renders`, `render-recheck`, `quality-approve`, `export`; painel "Render e qualidade". Evidência: Vitest `velix-composition` 5/5 e `velix-render-stage` 1/1 com FFmpeg/FFprobe reais (16:9 e 9:16 com tamanho, 30 fps e AAC corretos, legendas gravadas com o FFmpeg completo, reuso de todos os segmentos no re-render, direito revogado bloqueando exportação e não dispensável, área segura aceita com motivo, exportação com créditos e manifesto, produção concluída); orquestrador da produção 18/18; pacotes 750/751 em paralelo com a única falha em `multi-project.test.ts` (não alterado; 8/8 em `--no-file-parallelism`); E2E Electron com **Remotion real** e o FFmpeg do app: render 16:9 e 9:16 com todos os bloqueantes verdes, duração ±250 ms da narração, SRT ao lado, exportação e reinício (2/2 no spec de narração/render); regressão Velix 22 aprovados/3 pulados; typecheck global, ESLint e build.
- [ ] Fase F — pendências: trilha musical e SFX ainda não entram na mixagem da produção; vídeo de mídia remota autorizada precisa ser importado como arquivo local antes do render (não há download automático); a escolha de estilo da Fase 48 ainda não se aplica aos segmentos da produção (usa o template `velix-base`); a cena de gráfico usa cartão, sem barras numéricas.
- [x] Fase G — editor de linha do tempo (2026-11-04): **decisão:** depois da sincronização, cada cena recebe o seu próprio clipe da narração medida (corte FFmpeg amostra a amostra, palavras com tempo relativo ao clipe) guardado na própria cena do storyboard; com isso mover cenas recalcula o relógio pelas durações dos clipes e continua `measured` (chave de narração refeita), dividir corta o clipe no meio do silêncio entre duas palavras (`clipSplitPoint`, via porta de áudio do `StoryboardService`) e trocar o visual não toca o áudio — sem nova síntese nem nova transcrição. O render, quando a ordem mudou, remonta a narração juntando os clipes (manifesto e timeline derivados das palavras dos clipes) e reaproveita todo segmento cujo conteúdo não mudou; restaurar uma versão renderizada antes reaproveita 100% dos segmentos. Checkpoints: toda edição é versão; `restore` grava a versão escolhida como nova (`source: restore`), sem reescrever histórico. Prévia rascunho: mesmo relógio e mesmo motor em um terço do tamanho (mín. 320 px), artefato `render-draft`, nunca verificado nem exportável, enviado à interface como `data:` até 64 MB. Modelo puro `buildTimeline` com faixas Narração, Vídeo, Imagens, Gráficos, Texto, Legendas, Música e Efeitos (as duas últimas declaradas como planejadas) e marcadores de direitos, fato sem evidência, qualidade, bloqueio e tempo estimado na própria cena. Painel "Linha do tempo": faixa Cenas como `listbox` por teclado (setas escolhem, Alt+setas movem, S divide, L bloqueia, Home/End), anúncio por `aria-live`, detalhes da cena selecionada, prévia rascunho no próprio painel e histórico de versões com restauração. IPC `storyboard:restore|history`, `draft`, `draft-preview`; `storyboard:edit` passou a ser assíncrono. Evidência: Vitest `velix-timeline` 3/3 e `velix-timeline-editing` 1/1 com FFmpeg/FFprobe reais (clipes somam exatamente a narração; mover/dividir/trocar mantêm o tempo medido e o QA exportável; restaurar reaproveita todos os segmentos com as mesmas chaves; rascunho 640x360 fora da lista de exportação; nenhuma nova síntese ou transcrição); orquestrador da produção 10/10 nas suítes afetadas; pacotes 754/755 com a falha isolada em `multi-project.test.ts` (8/8 em série); E2E Electron com Remotion real: dividir com S, mover com Alt+→, bloquear com L, prévia rascunho, render final exportável, contagem de TTS e transcrição inalterada e restauração da versão 2 (1/1); E2E Velix 24 aprovados/3 pulados; typecheck global, ESLint e build.
- [ ] Fase G — pendências: arrastar e soltar na linha do tempo (o teclado e os botões cobrem a edição); faixas de Música e Efeitos sem material (planejadas); cortar/aparar o início e o fim de um clipe; zoom da linha do tempo para produções longas.
- [x] Fase H — Shorts e derivados (2026-11-05): contratos em `velix-derivatives.ts` geram candidatos determinísticos a partir de cenas medidas, com gancho, contexto mínimo, pontuação, motivo e claims herdados; só aprovação humana cria uma produção filha. Migrações `0080`–`0081` persistem candidatos, decisão, origem, intervalo, versão do storyboard e vínculo pai/filha; claims, evidências e decisões são copiados sem reabrir gates. A filha herda a narração por clipes, identidade aprovada do canal e manifesto de origem, renderiza em `youtube-short`/`instagram-reels`/`tiktok`, mantém créditos e fontes, e só exporta após QA bloqueante verde. IPC/preload e painel `ProductionDerivatives` cobrem gerar, aprovar/rejeitar, criar, renderizar em lote, exportar em lote e reabrir estado. Evidência: Vitest direcionado shared/database/orchestrator 15/15 em série; E2E Electron com Remotion/FFmpeg reais 1/1 para gerar sugestões, aprovar, criar filha 9:16, renderizar, reabrir, exportar e confirmar persistência; typecheck global, ESLint dos arquivos tocados e build aprovados.
- [ ] Fase I — acabamento/autonomia e gates finais: permanece planejada em `docs/plans/velix-autonomous-audiovisual-production.md`.

## Aethera Smart Director — SD-2.2 → SD-4 e Autonomia Total de Mídia (2026-11-13)

- [x] **SD-2.2 — Integração Contextual de SFX:** `packages/shared/src/aethera-sfx-classifier.ts` (18 regras, 7 categorias, 35 WAVs MotionVelix), `scripts/render-plan-sd22.mts` e 4 renders validados (`buraco-como`, `farol`, `filas`, `jogos`).
- [x] **Autonomia total de mídia (D-AP-18):** `selectAutonomousMediaCandidates` (`media-hunter.ts`) e `resolveMediaGapsAutonomously` (`autonomous-media.ts`) sem bloqueio por consentimento humano.
- [x] **SD-2.3 — Música e mixagem cinematográfica:** `packages/shared/src/aethera-music-director.ts` (prompt ACE-Step contextual, seleção em biblioteca e ducking adaptativo por densidade de SFX) + `alimiter`/`loudnorm` EBU R128 em `aethera-audio-render.ts`.
- [x] **SD-2.4 — VFX cinematográficos:** `VfxOverlay` (`particles`, `volumetric_light`, `optical_distortion`) e `color_grading` no `AetheraTimelineComposition.tsx` (`AETHERA_COMPOSITION_VERSION = 7`).
- [x] **SD-3 — Transições e pontuação explicável:** `wipeTransitionClipPath`, `match_cut` e `scoreShotExplainable` (`aethera-timeline-composition.ts`).
- [x] **SD-4 — Correção local pós-render:** `applyLocalCutCorrections` (`post-render-review.ts`) corrigindo cortes sem replanejar a produção.
- [ ] **G3 — Avaliação audiovisual final:** gate humano pendente.

# Extension hardening follow-up

- [x] Strict manifest, payload, path, symlink and capability validation.
- [x] Atomic activation failure cleanup and user-data-safe removal.
- [x] Unit/integration coverage for corruption, traversal, undeclared files, activation failure and restart state.
- [ ] External registry, asymmetric signing, auto-update and Authenticode integration.
