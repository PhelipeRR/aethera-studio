# Fase 40 — NeuralBridge Guided Tours: Lotes 40.2 a 40.4

**Data:** 2026-11-01  
**Status:** CONCLUÍDA em 2026-11-01; baselines aprovadas pelo usuário e gates globais aprovados.

## Auditoria e cobertura

O roteamento real está centralizado em `apps/desktop/src/renderer/src/app/routes.ts` e montado em `main.tsx`. `AppShell` envolve todas as rotas e fornece o botão global; `PageHeader` fornece o botão contextual às páginas que usam cabeçalho compartilhado. O Velix, Workflows, Mission Control e Git Intelligence possuem cabeçalhos próprios, por isso dependem do botão do shell. A configuração pura ficou em `guided-tours-config.ts`; o overlay permanece em `guided-tours.tsx` e o estado/normalização em `guided-tours-core.ts`.

| Página/rota | Etapas | Seletores estáveis instrumentados | Estado |
|---|---:|---|---|
| Dashboard `/` | 2 | `dashboard-actions`, `dashboard-metrics` | Preservado, instrumentado sem alterar fluxo |
| Chat `/chat` | 3 | `tour-chat-input`, `tour-chat-submit`, `chat-context` | Preservado, contexto cobre gatilho e painel condicional |
| Execuções `/runs` | 2 | `runs-list`, `runs-filters` | Instrumentado |
| Memória `/memory*` | 2 | `memory-search` na navegação/busca; `memory-create` no comando Nova memória | Instrumentado; subrotas específicas continuam com o layout |
| Skills `/skills` | 2 | `skills-settings`, `skills-list` | Instrumentado |
| Projetos `/projects` | 2 | `projects-list`, `projects-add` | Instrumentado; diálogos não são abertos pelo tour |
| Git Intelligence | 2 | `git-graph`, `git-actions` | Instrumentado |
| Agentes `/agents` | 1 | `agents-list` quando a consulta termina | Instrumentado com loading preservado |
| MCPs `/mcp` | 2 | `mcp-status`, `mcp-register` | Instrumentado; confirmação permanece manual |
| Analytics `/analytics` | 2 | `analytics-period`, `analytics-budget` | Instrumentado |
| Workflows `/workflows` | 2 | `workflows-list`, `workflows-run` | Instrumentado; o botão de execução nunca é clicado |
| Mission Control | 1 | `mission-list` no painel de filtros/monitoramento | Instrumentado |
| Velix `/video` | 3 | `velix-tabs`, `velix-editorial`, `velix-render` | Instrumentado em abas visíveis; painéis condicionais não são abertos |
| Configurações `/settings` | 1 | `settings-theme` | Instrumentado |

## Conteúdo contextual

Os textos estão declarados em `guided-tours-config.ts` e descrevem a finalidade operacional de cada área: filtrar execuções e revisar estados; buscar/criar memória; controlar skills e fontes; cadastrar raízes de projeto; ler histórico e proteger operações Git; verificar CLIs; registrar MCPs; interpretar tokens reportados; validar/rodar workflows; monitorar tarefas; aprovar fontes e render do Velix; e escolher o tema. Nenhuma etapa dispara o controle destacado.

## Condicionais e segurança

- Listas assíncronas recebem o atributo no contêiner persistente ou após carregamento; o overlay observa mutações por até 300 ms e mantém uma descrição navegável quando o alvo ainda não apareceu.
- Sidebar recolhida não remove os alvos; o botão global permanece acessível e o `data-tour-active` recebe foco visual sem depender de classes ou texto.
- Modais de confirmação, diálogos de arquivo, instalação, operações Git, execução de agentes e render não são abertos pelo tutorial; o próprio diálogo do tour é usado como fixture não destrutiva de foco.
- Seletores não usam classes, posição DOM, índices ou texto traduzido.
- O overlay limpa o destaque ao trocar de etapa/rota e permite fechar ou pular a qualquer momento.

## Testes e evidências

- Unitário do núcleo: `apps/desktop/test/guided-tours.test.ts` passou 4/4.
- E2E funcional: `tests/e2e/guided-tours.spec.ts` passou 18/18 em processos isolados, cobrindo onboarding, persistência, páginas, rota incompatível, alvo oculto, sidebar/resize, navegação, foco e fixture modal segura.
- E2E visual: `tests/e2e/guided-tours-visual.spec.ts` passou 14/14; cada página foi verificada em quatro combinações de tema, viewport e movimento reduzido, com 56 screenshots anexados aos resultados do Playwright e geometria do diálogo dentro da viewport.
- Vitest global serial passou 117/117 arquivos e 936/936 testes; typecheck global, ESLint global, build Electron e `git diff --check` passaram.

## Lote 40.3 — Dynamic Navigation, Resilience & Isolated E2E

### Subrotas e navegação

- Memória: `/memory`, `/memory/explore` e `/memory/:id` mantêm o tour do `BrainLayout`, sem trocar o conteúdo por instruções de outra área.
- Projetos e Execuções: as rotas de detalhe (`/projects/:id`, `/runs/:id`) não exibem o tour da lista; a troca encerra a sessão ativa.
- Workflows: a tela de edição visual permanece na mesma rota; o alvo de execução é tratado como condicional.
- Velix: abas Produzir/Render são alvos visíveis; painéis `hidden` não são abertos pelo tutorial.
- Configurações, Analytics, MCPs, Agentes, Skills, Git Intelligence e Mission Control foram executados como casos isolados de rota principal.

### Resiliência implementada

- Cada sessão é montada com chave de rota/tour e desmontada ao sair do escopo compatível.
- O alvo atual permanece declarativo mesmo durante loading; o tutorial aguarda no máximo 300 ms antes de mostrar fallback.
- `MutationObserver` observa filhos e atributos relevantes, com desconexão e timeout no cleanup.
- Alvos ocultos/ausentes exibem mensagem explícita e permitem Próximo, Concluir, Pular ou Escape.
- O popover usa o retângulo real do alvo, reposiciona em scroll/resize e limita coordenadas ao viewport.
- O foco é levado ao diálogo, Tab fica contido, Escape encerra e o foco anterior é restaurado quando o elemento ainda existe.
- Modais destrutivos de exclusão, publicação e renderização não são abertos pelo tutorial nem pelos E2Es; a fixture não destrutiva do diálogo do tour valida o comportamento modal sem executar operações de produto.

### Matriz E2E isolada

| Grupo | Casos | Resultado |
|---|---:|---|
| Onboarding, persistência e Chat | 2 | 2/2 |
| Execuções, Memória, Skills, Projetos, Git Intelligence, Agentes, MCPs, Analytics, Workflows, Mission Control, Velix e Configurações | 12 | 12/12 |
| Rota incompatível, alvo indisponível, sidebar/resize/scroll/foco | 3 | 3/3 |
| Diálogo seguro: foco cíclico, Escape e restauração | 1 | 1/1 |
| Total | 18 | 18/18 |

Nenhum caso clicou em agente, Git, workflow, render, publicação, exclusão ou instalação. O cleanup por processo isolado resolveu o timeout observado na matriz anterior em um único Electron.

### Gates e limitações

- Aprovados: typecheck global, ESLint global, Vitest Guided Tours 4/4, Vitest serial 117/117 arquivos e 936/936 testes, E2E funcional 18/18, E2E visual 14/14, build Electron e `git diff --check`.
- A matriz de snapshots preexistente `tests/e2e/final-visual-matrix.spec.ts` falhou em `skills-dark-1280x800.png` com 11.895 pixels diferentes (2%). A inspeção do diff mostra a superfície nova de Tutorial/onboarding; nenhum snapshot foi atualizado automaticamente.

## Pendências

O Lote 40.4 está implementado. A Fase 40 permanece aberta até revisão deliberada do baseline visual preexistente; essa revisão não foi feita automaticamente para evitar aceitar uma alteração visual sem aprovação.

## Lote 40.4 — Validação Final, Matriz Visual e Release Readiness

### Escopo executado

- Corrigida a medição do popover em `apps/desktop/src/renderer/src/app/guided-tours.tsx`, ligando a referência de posicionamento ao diálogo real e limitando sua altura ao viewport com rolagem interna.
- Adicionada a cobertura modal segura em `tests/e2e/guided-tours.spec.ts`; não houve abertura de confirmações destrutivas nem acionamento de agentes, Git, renderização ou publicação.
- Adicionada a matriz visual em `tests/e2e/guided-tours-visual.spec.ts`, sem dependências novas e sem atualização automática de snapshots.

### Matriz visual

| Modo | Viewport | Movimento | Páginas | Resultado |
|---|---:|---|---:|---|
| Dark | 1280×800 | normal | 14 | 14/14 |
| Light | 1280×800 | normal | 14 | 14/14 |
| Dark | 800×700 | reduzido | 14 | 14/14 |
| Light | 800×700 | reduzido | 14 | 14/14 |

Páginas cobertas: Dashboard, Chat, Execuções, Memória, Skills, Projetos, Git Intelligence, Agentes, MCPs, Analytics, Workflows, Mission Control, Velix e Configurações. O artefato visual anexado ao Playwright contém 56 screenshots; a matriz preexistente de snapshots foi apenas verificada.

### Critérios de aceite e rollback

- Fluxos Guided Tours, fallback, foco, rota e segurança: aprovados.
- Qualidade de código, testes globais, typecheck, lint, build e diff: aprovados.
- Baseline visual geral: pendente de revisão humana; o rollback do lote é reversível removendo apenas a nova especificação visual/teste e a correção de layout do overlay, sem tocar nas páginas instrumentadas ou no motor declarativo anterior.
