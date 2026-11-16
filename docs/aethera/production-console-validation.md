# Console de Produção — validação funcional (2026-11-15)

Validação do terminal de produção do Aethera Studio (componente `ProductionConsoleAccordion` + serviço
`production-console.ts`), com execução real no Electron, CLIs reais e processo real de render. Nenhum teste, métrica
ou limite foi alterado para obter aprovação; o que falhou está registrado como falha.

## Ambiente

- Windows, Node 24, FFmpeg em `C:\ffmpeg\bin`.
- CLIs reais: Claude Code 2.1.325, Antigravity (`agy`) 1.5.9, Codex 0.166.0.
- Contas: **Antigravity com quota esgotada** (`429 RESOURCE_EXHAUSTED`, reset em ~126 h) e **Codex com limite de uso
  atingido**. Claude Code operante.
- App: `npm run build:aethera` + Electron via Playwright (`_electron`), perfil isolado (`APPDATA` em pasta temporária).

## 1. Produção real curta, com o terminal aberto

Execução (`tests/e2e/aethera-console-validation.spec.ts`, opt-in `AETHERA_CONSOLE_E2E=1`): prompt
"Os 3 chefes mais difíceis de Elden Ring e por que eles são tão punitivos", 10 s, `draft_540p`, 3 clipes reais
semeados via `seedMediaFiles`. Evidência: `artifacts/aethera-console-e2e/<timestamp>/`.

Resultado: **produção concluída** — estado `editor`, 100%, em 158 s, com render real por FFmpeg.

| Etapa | Evento | % |
|---|---|---|
| prompt | started/completed | 5 → 8 |
| interpretacao | started/completed | 8 → 18 |
| pesquisa | started/completed | 18 → 32 |
| roteiro | started/completed | 32 → 44 |
| decupagem | started/completed | 44 → 56 |
| aquisicao | started/completed | 56 → 62 |
| validacao_visual | started/completed | 62 |
| planejamento | started/completed | 62 → 74 |
| montagem | started/completed | 74 → 84 |
| audio_sfx_vfx | started/completed | 84 → 92 |
| previa | started/completed | 92 → 100 |
| editor | started | 100 |

Cada evento de etapa carrega etapa + percentual; toda linha de agente carrega o percentual corrente do job.

## 2. Fallback entre agentes (quota, autenticação, indisponibilidade)

- **Na produção real:** `antigravity-cli` falhou com `exit=3` (`429`, quota) → o console registrou `command_failed`
  com stderr real → `claude-cli` assumiu e concluiu a pesquisa em 54 s (`command_completed`, `exit=0`) → o roteiro
  também caiu para `claude-cli` (10 s). A produção **não travou**: seguiu para aquisição, montagem e render.
- **Cascata isolada (com quota):** `artifacts/aethera-console/<ts>/fallback-summary.json` — `agy` falha,
  `claude` conclui, `succeededWith: claude-cli`.
- **Sem nenhum agente disponível:** o console registra `warn` "Nenhum CLI de agente disponível" e a produção pausa
  com motivo explícito (`paused_pending_research`), sem inventar fatos.

## 3. Isolamento por job

`apps/aethera-desktop/test/console-isolation.test.ts` (processos reais, sem mocks de stream):

- dois jobs simultâneos → arquivos `job_A.log.jsonl` / `job_B.log.jsonl` separados, zero cruzamento de linhas
  (inclusive stdout/stderr), `projectId`/`jobId` corretos em 100% das entradas;
- duas execuções consecutivas do mesmo job → separadas por `runId` no mesmo histórico;
- histórico relido após reinício do serviço; `clear` de um job não toca no arquivo do outro.

Na app real, a aba do console é sempre filtrada por `projectId` e o rodapé mostra o job — com mais de um job na
janela de carregamento, o rodapé indica a contagem em vez de misturar.

## 4. Proteção de segredos

`apps/aethera-desktop/test/console-secrets.test.ts` — processo real escrevendo segredos em stdout, stderr,
argumentos e detalhes; verificado em **broadcast (renderer), list, TXT, JSON, JSONL em disco e histórico recarregado**:

- `sk-live-…`, `ghp_…`, `AKIA…`, `password=…`, `Bearer eyJ…` → `[REDACTED]` em todas as superfícies;
- **achado real e corrigido:** um segredo passado como **argumento separado** (`--password valor`) não era mascarado
  (só padrões com `chave=valor`). Agora `previewArguments()` mascara o valor seguinte a flags sensíveis
  (`--api-key`, `--token`, `--password`, `--secret`, `--authorization`, `--access-key`, `--private-key`) e a forma
  inline `--flag=valor`;
- texto diagnóstico normal continua legível (sem falso positivo em massa).

## 5. Interface Electron

`tests/e2e/aethera-console-ui.spec.ts` (replay de um diretório de dados real produzido pela execução do item 1),
roteiro `/aethera/cinema` → seção "Console de Produção":

| Verificação | Resultado |
|---|---|
| Barra de progresso | largura `20%`, rótulo `20% · Pesquisa` |
| Linha do tempo de etapas | `✓` Prompt/Interpretação, `Ⅱ` Pesquisa (pausada), `○` restantes |
| Filtro por origem (Agente) | 46 → 42 linhas, somente `origin=agent` |
| Filtro por canal (stdout/stderr) | 34 linhas, apenas canais `stdout`/`stderr` |
| Busca + nível + etapa + período | filtros combinam; 142 ms na janela normal |
| Auto-scroll | liga/desliga de fato |
| Detalhes técnicos expansíveis | painel com evento/canal, origem, job, duração (e comando/exit/stderr quando existem) |
| Aba Erros | 3 linhas, todas `severity=error` |
| Exportação | 46 entradas (2.400 no cenário de carga) |
| Desempenho | histórico de 2.400 entradas (1,28 MB): abre em **180 ms** (janela de 600 linhas), filtro em **80 ms** |

Screenshots: `artifacts/aethera-console-ui/<ts>/*.png` (console aberto, filtro por agente, detalhes expandidos, aba
de erros, histórico grande).

Observação de integração: o componente vivia apenas em `App.tsx` (shell legado, não roteado). Foi movido para
`packages/desktop-shared/src/renderer/src/features/video/` e montado no `CinemaDirectorPanel` (rota `/aethera/cinema`,
tela real onde as produções escalonadas rodam). O arquivo antigo virou re-export para não quebrar imports. Em apps
cujo preload não expõe `cinemaConsole*` (o monolito `apps/desktop`), o componente se auto-oculta em vez de mostrar um
console vazio.

## 6. Testes pendentes de Cinema/FFmpeg e `resolvePendingMedia`

`npx vitest run packages/cinema` → **6 arquivos, 8 testes falhando** de 89, todos em render real:

| Arquivo | Falha | Natureza |
|---|---|---|
| `editorial-integrity.test.ts` | timeout 45 s + EPERM ao remover temp | ambiente (render FFmpeg lento nesta máquina + lock de arquivo no Windows) |
| `evolution-2.0.test.ts` (2) | timeout 30 s | ambiente |
| `media-relevance-coverage-voice.test.ts` | timeout 5 s | timeout apertado para render real |
| `nle-premiere-features.test.ts` | timeout 60 s | ambiente |
| `project-isolation-and-preview.test.ts` (2) | `ENOENT ... acq_1.png` + timeout 60 s | fixture: o acquire do teste grava um PNG de 25 bytes e o pipeline não o promove para a pasta isolada do projeto |
| `visual-critic-vision.test.ts` | timeout 40 s + EPERM | ambiente |

**Pré-existente, não regressão:** repetidos com o `cinema-pipeline.ts` original (`git stash`), os mesmos testes falham
igual (`ENOENT acq_1.png` e timeouts de 60 s). Nenhum desses arquivos exercita o console.

`staged-pipeline.test.ts` (`apps/aethera-desktop`) — "pausa em `paused_pending_media` e conclui após autorizar":

1. `resolvePendingMedia(..., allowProcedural)` marca o slot e **remove** o slot de `pendingMedia`, marcando
   `aquisicao` como concluída;
2. no resume, `computeIncrementalInvalidation` devolve `researchValid: false` sempre que **não existe dossiê**
   (`Boolean(previousDossier && !promptChanged)`), e o pipeline limpa `pesquisa/roteiro/decupagem/aquisicao/validacao_visual`
   — inclusive a autorização recém-dada;
3. a aquisição roda de novo, não encontra mídia e pausa outra vez com os mesmos 4 slots.

Além disso, `allowProcedural` nunca é lido em outro ponto do pipeline (grep: definição, input de resolução e o filtro).
Ou seja: a autorização de Motion Visual é um no-op quando não há dossiê. Reproduzido com o arquivo original (idêntico),
portanto **pré-existente**. Correções possíveis (fora do escopo desta validação, exigem decisão de produto):
persistir a autorização por slot (ex.: `proceduralAuthorizations` no job) e consumi-la na montagem; e não invalidar
estágios já concluídos quando a pesquisa simplesmente não existe.

## 7. Bloqueios reais

1. **Quota dos provedores externos:** Antigravity esgotado (429, ~126 h) e Codex no limite de uso. Só Claude Code
   respondeu. Todo o caminho de fallback foi exercitado por causa disso.
2. **Limite de 90 s por tentativa de pesquisa (intermitente):** medido com o prompt real de pesquisa
   (`apps/aethera-desktop/test/console-real-latency.test.ts`, opt-in `AETHERA_CONSOLE_REAL=1`):
   `agy` 5,7 s (falha), **`claude` 39,7 s (sucesso, 9.972 caracteres de JSON válido)**, `codex` 3,6 s (falha).
   Em 3 de 5 execuções completas do app o Claude passou de 90 s e foi morto (registrado como `command_failed`,
   "tempo limite de 90s excedido"), pausando a produção em `paused_pending_research`; nas outras 2 (incluindo a
   execução registrada no item 1, 54 s) a produção concluiu. Não é bug do console nem da cascata — é o teto de 90 s
   sendo apertado para um modelo que raciocina. Recomendação: tornar o limite configurável por etapa (ou elevar a
   pesquisa para ~180 s) e manter o evento `command_failed` como está, que já expõe o motivo.
   **Resolvido em 2026-11-16 (execução longa supervisionada):** pesquisa e roteiro não têm mais tempo total fixo.
   O supervisor de `captureCommand` encerra o agente só após 10 min sem progresso real (configurável em
   Configurações → Agentes e IA; repetições sem conteúdo novo não contam como progresso e silêncio dentro da janela
   não é travamento), com limite máximo opcional (desativado por padrão), heartbeat `agent_heartbeat` no console
   (tempo decorrido, último evento, estado), fallback imediato em erro definitivo de autenticação/quota/configuração,
   resultado intermediário válido preservado em travamento confirmado, e encerramento da árvore de processos em
   cancelamento, falha e saída do app. Testes: `apps/aethera-desktop/test/agent-long-run-supervision.test.ts`.
3. **Pipeline genérico:** prompts sem obra/entidades reais produzem dossiê inválido e a produção pausa em
   `paused_pending_research` (comportamento correto de "não inventar fatos").

## 8. Console individual por produção (`jobId`) e Console Geral

Problema de arquitetura corrigido: o console era indexado por `projectId`, mas um projeto pode ter várias produções
e várias tentativas. Agora a identidade da execução é **`jobId` + `attempt`**; o `projectId` só diz em qual
workspace o job escreve.

### Cadeia de identificação

| Camada | Antes | Agora |
|---|---|---|
| Pipeline (`cinema-pipeline.ts`) | job identificado pelo `projectId` | `StagedProductionJob.jobId` único (`job_<ts>_<rand>`, ou o enviado pelo renderer) e `attempt` (+1 a cada retomada); jobs antigos usam o `projectId` como `jobId` |
| Progresso (`onProgress` → `recordPipelineSnapshot`) | tracker por projeto | tracker por `jobId`; emite `job_started` (por tentativa), `job_completed`, `job_failed`, `job_paused`, `job_cancelled`; liga o projeto ao job enquanto ele roda e solta ao terminar |
| Agentes Claude/Codex/Antigravity, pesquisa, roteiro, mídia, narração, render | `jobId: projectId` em cada chamada | emitem só com `projectId`; o serviço roteia para o job vinculado (e, depois de cancelado, para o último job do projeto) |
| Thumbnails (`creative-studio-service.ts`) | todas no job fixo `creative-studio` | cada execução é um job `thumb_…` (kind `thumbnail`) via `AsyncLocalStorage`; chamadas aninhadas ficam no mesmo job |
| Persistência (`production-console.ts`) | `<projectId>.log.jsonl` | `<jobId>.log.jsonl` + `jobs-index.json` (projeto, tipo, título, tentativa); `seq` monotônico continua após reinício |
| IPC/preload | `projectId` | `cinema:console-list/facets/export/clear` por `jobId` (aceita `projectId` só para logs antigos); novos `cinema:console-jobs`, `cinema:console-list-all`, `cinema:console-export-all` |
| UI (`ProductionConsoleAccordion`, mesmo componente) | um console abaixo da lista | `jobId=…` → console individual dentro do card de cada produção; `scope="all"` → Console Geral com filtros por job, status, agente e etapa; Creative Studio usa `scope="all" kind="thumbnail"` |

Outros pontos corrigidos durante a revisão:

- **Tela de produções:** o listener de progresso trocava o "job atual" (barra, cancelar/retomar) para qualquer
  produção que emitisse evento — percentuais de produções simultâneas se sobrescreviam. Agora só o job em foco
  atualiza a área de foco; cada card atualiza só a si mesmo. O botão de iniciar deixou de ficar bloqueado enquanto
  uma produção roda (o renderer gera o `jobId` antes de iniciar).
- **Cancelamento:** cancelar durante a pesquisa virava `paused_pending_research` (a pesquisa abortada voltava vazia e
  o pipeline "pausava" por cima do `cancelled`). Agora a execução cancelada só pode gravar `cancelled`.
- **Retomada:** a execução antiga, ao terminar de desenrolar, apagava o `AbortController` da nova (o próximo cancelar
  não funcionava) e podia sobrescrever o arquivo do job. Agora cada projeto tem dono (`jobId`+`attempt`) e escritas
  de execuções substituídas são descartadas.
- **Limpar/exportar:** sempre por job. No Console Geral, "Limpar" só fica ativo com um job selecionado.
- **Histórico longo:** o console carregava as 600 linhas **mais antigas**; agora carrega a cauda (`tail`).
- **Reconexão:** a carga do histórico mescla (sem duplicar) com as linhas que chegam ao vivo durante a carga.

### Testes

- `apps/aethera-desktop/test/console-concurrency.test.ts` — 4 produções simultâneas (sucesso, falha com `exit=3`,
  pausa→retomada com `stage_retry` na tentativa 2, cancelada no meio) + uma 2ª produção do mesmo projeto, com
  processos Node reais escrevendo stdout/stderr e logs emitidos só com `projectId`. Verifica isolamento (0 linhas
  estranhas por job, inclusive A × A2 do mesmo projeto e a linha tardia do job cancelado), percentuais e status
  independentes, ordenação (`seq` estrito por job, comando → streams → resultado por execução, Console Geral em
  ordem global e intercalado), filtros do geral por job/status, reconexão da UI (histórico + fila ao vivo = log
  completo sem duplicatas), persistência após reinício e `clear` de um job sem afetar os demais. 3/3 execuções
  seguidas verdes.
- `apps/aethera-desktop/test/staged-pipeline-jobs.test.ts` — `jobId` único por produção, `attempt` na retomada,
  cancelar durante a pesquisa termina em `cancelled`, cancelar a tentativa 2 funciona, nova produção do mesmo projeto
  não é sobrescrita pela anterior.
- `production-stage-tracker.test.ts` e `production-console-view.test.ts` ganharam casos de `job_*`, chave por `jobId`,
  merge sem duplicatas e resumo de jobs.

### Validação visual no Electron

`tests/e2e/aethera-console-jobs.spec.ts` (opt-in `AETHERA_CONSOLE_JOBS_E2E=1`): três produções reais iniciadas ao
mesmo tempo pela ponte do app, cada uma com seu `jobId`; abre os três consoles durante a execução, cancela C enquanto
A e B seguem, retoma C (tentativa 2), sai da tela e volta, e no fim valida o Console Geral (chips por job, filtro
por job). Evidências em `artifacts/aethera-console-jobs/<timestamp>/`.

## Como reproduzir

```bash
# 1. Produção real no Electron (CLIs reais, render real)
AETHERA_CONSOLE_E2E=1 npx playwright test tests/e2e/aethera-console-validation.spec.ts

# 2. Interface do console sobre um diretório de dados real
AETHERA_CONSOLE_UI_E2E="<...>/AppData/Roaming/AetheraStudio" npx playwright test tests/e2e/aethera-console-ui.spec.ts
AETHERA_CONSOLE_UI_E2E="<...>" AETHERA_CONSOLE_UI_SEED=1 npx playwright test tests/e2e/aethera-console-ui.spec.ts  # carga

# 3. Fallback e latência reais
AETHERA_CONSOLE_REAL=1 npx vitest run apps/aethera-desktop/test/console-real-agents.test.ts
AETHERA_CONSOLE_REAL=1 npx vitest run apps/aethera-desktop/test/console-real-latency.test.ts

# 4. Isolamento, segredos e unidade do console
npx vitest run apps/aethera-desktop/test/console-isolation.test.ts apps/aethera-desktop/test/console-secrets.test.ts \
  apps/aethera-desktop/test/production-console*.test.ts apps/aethera-desktop/test/production-agent-runner.test.ts \
  apps/aethera-desktop/test/production-stage-tracker.test.ts

# 5. Consoles por produção: concorrência, identidade do job no pipeline e três produções reais no Electron
npx vitest run apps/aethera-desktop/test/console-concurrency.test.ts apps/aethera-desktop/test/staged-pipeline-jobs.test.ts
npm run build:aethera
AETHERA_CONSOLE_JOBS_E2E=1 AETHERA_CONSOLE_JOBS_REAL_HOME=1 npx playwright test tests/e2e/aethera-console-jobs.spec.ts
```
