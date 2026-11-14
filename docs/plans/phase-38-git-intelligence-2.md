# Fase 38 — Git Intelligence 2.0

Plano oficial incorporado a partir de `NEURALBRIDGE_GIT_INTELLIGENCE_2_PLANO.md`. A implementação é incremental e preserva GitReader, Brain/RAG, TaskEngine, Workflow Builder, hierarquia de projetos e os contratos IPC existentes.

## Estado

| Subfase | Estado | Escopo |
|---|---|---|
| 38.1 | CONCLUÍDA | Auditoria, inventário, cenários Git e correção de bugs reproduzidos |
| 38.2 | CONCLUÍDA | Git Graph 2.0, DAG, refs, cursor e virtualização |
| 38.3 | CONCLUÍDA | Working Tree, Diff Explorer & Git Operations Manager |
| 38.4 | CONCLUÍDA | Code Review e Bug Detective com Claude/Codex via TaskEngine |
| 38.5 | CONCLUÍDA | Smart Commit e PR Assistant, sem push/commit implícito |
| 38.6 | PARCIAL | Automação Git e Workflow Builder, reutilizando Fase 31.4 |
| 38.7 | PLANEJADA | Memória, health, observabilidade e hardening |
| 38.8 | PLANEJADA | Distribuição e hardening final |

## 38.1 — Auditoria inicial

- `packages/workspace/src/git.ts`: leitura segura de status, refs, diffs e repositórios, com runner seguro e limites de diff.
- `packages/workspace/src/git-history.ts`: histórico local limitado, commits conhecidos, patches limitados e proteção contra programas configurados pelo repositório.
- `packages/workspace/src/git-write.ts`: escrita separada e explícita, URL de clone validada, hooks desativados e sem recurse de submódulos.
- `apps/desktop/src/main/projects.ts`, preload e renderer: indexação/search de histórico, relações com memória/tarefas e diff de projeto.
- `apps/desktop/src/main/git-automation.ts`: refs, cursores, deduplicação persistente e eventos já existentes da Fase 31.4.

Bug reproduzido e corrigido: `gitInfo()` truncava branches com ponto (`feature/cache.v2`). A expressão regular agora preserva o nome completo; regressão em `packages/workspace/test/git-history.test.ts` passou 3/3.

Segundo bug reproduzido e corrigido: `gitRepositories()` lançava `ENOENT` quando a raiz desaparecia ou não existia. A função agora retorna lista vazia, com regressão no cenário de worktree/missing root.

Matriz validada em fixtures: repositório sem commits, detached HEAD, rename, binário, caminho Unicode, worktree vinculado, raiz ausente e diretório sem Git. Submódulos permanecem somente leitura e não são recursivamente baixados; Git ausente é tratado como repositório indisponível pela camada existente.

Limitações confirmadas para as próximas subfases: limite padrão de 200 commits, somente branches locais, refs sem tags/DTO rico, ausência de DAG/cursor, diff por hunk e UI dedicada de operações.

## 38.2 — Git Graph 2.0 (início)

- O contrato `GitHistory` agora expõe, de forma retrocompatível, `refs` tipadas como local/remota/tag e `head`.
- `readGitHistory` consulta refs reais de branches, remotes e tags sem baixar ou alterar nada; repositório sem Git mantém o shape legado degradado.
- A página Git Intelligence exibe branches, remotes, tags e marcador HEAD usando o Design System existente, com estados vazios e foco nativo preservados.
- `git-graph.ts` calcula lanes e arestas determinísticas a partir dos pais reais; merges têm múltiplas arestas e pais fora da página são sinalizados como continuidade, nunca inventados.
- A UI renderiza as arestas reais em SVG sem substituir o botão acessível de seleção do commit.
- O histórico agora aceita cursor versionado com fingerprint SHA-256 das refs e hash do último commit; alteração de refs ou histórico reescrito invalida o cursor explicitamente. A UI carrega páginas sob demanda e deduplica commits.
- `gitCompareRefs` compara árvores diretamente ou desde o merge-base real, com validação de refs e resultado tipado de arquivos/status/estatísticas; não há fallback para ancestral inexistente.
- A comparação foi exposta por contrato compartilhado, schema IPC estrito, preload e `GitIntelligencePage`; a UI seleciona refs reais e mostra modo, merge-base, arquivos e linhas alteradas.
- O Graph agora virtualiza a janela visível com overscan mantendo a altura total e o layout DAG único; benchmark reproduzível de 5.000 commits passou em menos de 1s no teste unitário.
- Modos compacto/expandido compartilham o mesmo layout e dados e persistem a escolha em `localStorage`; a altura compacta foi alinhada à área clicável e metadados secundários são ocultados nesse modo para evitar sobreposição.
- O Diff Explorer abre o patch real do commit selecionado por `git show`, mantendo o contrato legado do diff da working tree.
- A leitura de páginas usa concorrência limitada de 8 chamadas Git e conserva a ordem de `rev-list`; o E2E de histórico extenso com 205 commits adicionais passou em 30,3 s ponta a ponta.
- E2E dedicado passou 2/2 com fixtures reais; screenshots Electron em 1280×800 e 800×700 foram inspecionados e a correção visual foi revalidada.
- Regressões de histórico, submódulo e Git indisponível passaram; typecheck shared/workspace e `git diff --check` passaram.

Evidências finais: E2E Graph 4/4, benchmark Electron 1/1 com 5.000 commits, DOM 150, SVG/path 22, 21 commits montados, primeira renderização 4067 ms, seleção 29 ms e scroll 5 ms. Loading, vazio, raiz removida, erro de leitura/filtro e merge/DAG foram exercitados com fixtures reais. A subfase está CONCLUÍDA.

## 38.3 — Working Tree & Diff Explorer (início)

Auditoria inicial: `git-write.ts` é o único módulo de escrita Git e já expõe init, criação de projeto e clone; IPC/main/preload validam intenções estruturadas. Working Tree e Branch Manager foram implementados com contratos para listar/criar/alternar/renomear/excluir branches. A autorização é obrigatória nos handlers de escrita. O núcleo Stash/Commit foi integrado a shared/IPC/preload/main e validado em fixtures reais 32/32; refs de stash são revalidadas e commits exigem índice staged. A Git Intelligence agora oferece o painel operacional de branches, stash e commit, usando os grants existentes e refresh das consultas. Ainda faltam revert, cherry-pick, recuperação de conflitos e E2Es dos fluxos de escrita.

Qualquer evolução deve manter `shell:false`, argumentos validados, `--end-of-options`, timeout/cancelamento, autorização no main, foco visível, teclado, contraste semântico e reduced motion conforme o Design System.

Atualização 38.3: Revert e Cherry-pick agora reutilizam o executor seguro do GitWriter, bloqueiam working tree/operação pendente, exigem autorização por commit e suportam recuperação explícita com `--continue`/`--abort`; commits de merge exigem mainline. Testes reais passaram 34/34. E2Es de escrita e auditoria visual final do painel de conflitos permanecem como critérios de encerramento.

E2E executado: `tests/e2e/git-write-operations.spec.ts` passou 7/7 e `git-intelligence-graph.spec.ts` passou 4/4. As fixtures reais cobrem Stage/Commit, branches, Stash, Revert, Cherry-pick, conflito pendente com Abort e Continue após resolução manual; as capturas do conflito foram geradas em 1280×800 e 800×700. A correção permitiu Stage explícito para arquivos `conflict` (`staged=true, unstaged=true`) e o Continue concluiu o commit real. Permanecem merges com mainline na UI, cancelamentos, hooks/worktrees, bypass IPC e concorrência.
### Checkpoint 38.3 — validação de mainline na UI (2026-11-01)

- Ações de revert/cherry-pick para commits de merge exibem e validam a mainline; valores inválidos são rejeitados antes de emitir a operação.
- A mainline selecionada integra os parâmetros do grant e é encaminhada ao GitWriter existente, sem duplicar lógica Git.
- Fixture temporária com merge real de dois pais validada pelo E2E Electron `Merge history action requires an explicit valid mainline in the Electron UI` (1/1); suíte Git Write completa passou 8/8.
- Typecheck web, ESLint direcionado e `git diff --check` aprovados.
- Tentativas de E2E para cancelamento e hook foram interrompidas por timeout não determinístico no runner Windows; não são evidência de aprovação.
- Integração real do serviço principal passou 12/12 em `apps/desktop/test/projects.test.ts`, cobrindo rejeição de grant ausente/parâmetros incompatíveis. Essa evidência não substitui testes diretos dos handlers IPC, que permanecem pendentes.
- Auditoria confirmou que hooks de projeto são intencionalmente desabilitados pelo `SAFE_WRITE` (`core.hooksPath=`); não há bug a corrigir sem alterar uma decisão de segurança.
- Teste real de regressão confirmou a política: hook sentinela não executa sob SAFE_WRITE e o commit segue normalmente (33/33 no arquivo `git-write.test.ts`).
- Fixture real de worktree validada: branch em uso por outra árvore é protegida contra exclusão/alternância, mantendo HEADs consistentes (34/34).
- O mapeamento `createGitIpcHandlers` passou a ser compartilhado pelo registro real do `index.ts`; teste de integração passou 13/13. A invocação literal de `ipcMain` permanece pendente para não confundir a cobertura do mapeamento com cobertura do transporte Electron.
- `registerGitIpcHandlers` passou a ser o ponto único de registro e um `IpcMainLike` controlado exerceu literalmente o callback de Stage via `registerIpcHandler`; sem grant rejeita, com grant executa. Apenas Stage está evidenciado nesta rodada; os demais canais permanecem pendentes.
- Cobertura incremental adicional exerceu literalmente os callbacks de Unstage, Commit e Branch Delete, com rejeição sem grant e sucesso autorizado em repositórios temporários; 4/4 casos focados passaram. Stash, Revert, Cherry-pick e resolução continuam sem evidência literal.
- Stash create/drop e Branch create/switch/rename também foram invocados pelos callbacks registrados em produção; 2/2 testes focados passaram com efeitos reais e rejeição sem grant. Stash apply/pop, Revert, Cherry-pick e Continue/Abort seguem pendentes.
- Stash Apply, Revert, Cherry-pick e Abort foram adicionados à cobertura literal (3/3); dois grants distintos de Stage também foram executados em paralelo sem corrupção. Continue, Pop específico e cancelamentos Electron seguem pendentes; o cancelamento isolado travou no runner antes de produzir evidência e não foi contado.
- Regressão desta rodada passou 59/59 testes Vitest e 12/12 E2Es Git Graph/Write; typecheck, ESLint, build e diff-check aprovados. Pendências permanecem explicitamente abertas.
- Stash Pop e Continue foram adicionados à matriz literal (2/2), com conflito Git real resolvido e operação pendente limpa; suíte focada posterior passou 60/60. Restam concorrência incompatível e cancelamentos.
- `protectedWrite` recebeu fila por raiz do repositório. O teste Commit + Stage com grants distintos confirmou serialização e rejeição segura do grant obsoleto após revalidação, sem corrupção de HEAD/índice. Worktrees e cancelamentos continuam pendentes.
- Regressão após a fila passou 61/61 testes Vitest, build/typecheck/ESLint/diff-check; o E2E de cancelamento continua bloqueado antes do checkpoint de diálogo no runner Windows e não foi declarado aprovado.
- Pendências: cancelamentos dedicados, hook de commit com falha, worktrees, bypass direto dos handlers IPC e concorrência entre grants distintos.

### Encerramento 38.3 — Git Operations Manager (2026-11-01)

- `protectedWrite` passou a resolver `git common-dir` e a coordenar worktrees do mesmo repositório; a primeira operação é bloqueada por barreira de teste e a segunda só entra após a liberação, comprovando serialização real.
- Três fixtures de worktree passaram: rename de uma ref compartilhada com rejeição segura do grant obsoleto, alternância de dois HEADs independentes e branch switch concorrente com Stage em outro índice.
- Os 13 callbacks registrados em `registerGitIpcHandlers` foram exercitados literalmente em produção compartilhada, com rejeição sem grant, efeitos autorizados e preservação do estado. O sender não confiável também foi rejeitado antes de qualquer escrita.
- A investigação do runner Windows foi concluída: o travamento não era Electron/IPC, mas um locator que procurava `Stage` dentro da região errada; o painel Working tree fica fora de `Operações Git`. O diagnóstico instrumentado alcançou `fixture-ready`, `window-ready`, `project-open`, `stage-button`, confirmação nativa e preservação do Git.
- Sete cancelamentos E2E passaram em fixtures temporárias reais. O primeiro cancelamento não emitiu uma operação de escrita; a segunda tentativa exigiu nova confirmação e executou o Git real.
- Regressão: `projects.test.ts` 28/28; conjunto Git/workspace/projetos/autorização 65/65; global Vitest 902/902 em 174,54 s; Git Write 15/15; Git Graph 4/4; typecheck, lint, build e diff-check aprovados.

**Decisão:** 38.3 CONCLUÍDA. A política `SAFE_WRITE` continua deliberadamente com `core.hooksPath=`; hooks externos não fazem parte do contrato e não foram habilitados.

### 38.4 — AI Code Review e Bug Detective: execução (2026-11-01)

Auditoria de integração concluída: `ClaudeCliAdapter`/`CodexCliAdapter` e parsers reais em `packages/agents`; `TaskEngine`, aprovação, revisão, retry, snapshots e eventos em `packages/orchestrator/src/engine.ts`; `RagEngine`, contexto e índice de commits em `packages/brain`; GitReader/GitWriter, autorização, IPC e automações em `apps/desktop/src/main`. A implementação reutiliza esses pontos, mantém revisores read-only e persiste evidências pelo TaskEngine.

Implementado neste checkpoint: contrato `git-review.ts` e schemas IPC; prompt estruturado com diff/RAG delimitados como dados não confiáveis; `startGitReview()` para working tree, commit e range, com Claude/Codex existentes, RAG e eventos `task_events`; consulta IPC de tarefa/relatório; painel Git Intelligence com andamento, severidade/confiança, evidência, arquivo/linha e patch em preview.

Patch sugerido: `validateGitPatch()` bloqueia caminhos inseguros, NUL, formato inválido e payload acima de 80 KB; `gitApplyPatch()` confirma aplicabilidade com `git apply --check` e não faz stage/commit. Main vincula autorização ao hash SHA-256 do patch e ao fingerprint de estado Git, usa `protectedWrite`/`git common-dir`, e a UI só aplica após confirmação explícita. A correção adicional do fingerprint staged/unstaged foi coberta por regressão de concorrência.

Evidências desta retomada: o E2E opt-in `tests/e2e/git-review-real.spec.ts` executou o adapter real do Codex em uma fixture Git temporária e passou 1/1 em 13,4 s. O fluxo criou o relatório persistido, exibiu o achado de `auth.ts:2`, mostrou o patch, pediu confirmação explícita, aplicou o patch real, manteve o HEAD inalterado, deixou o índice sem staged changes e não criou commit. As capturas `prints/git-review-real-1280.png` e `prints/git-review-real-800.png` foram inspecionadas.

Durante essa execução foram corrigidos dois problemas comprovados: o `CodexCliAdapter` entrega JSON validado em `final text` e agora o TaskEngine faz o parse estruturado antes da validação Zod; e patches unificados válidos sem newline final agora são normalizados antes de `git apply --check`. Regressões cobrindo ambos os casos passaram.

Validações finais: suíte focada de review/tasks/projetos/Git write 82/82 em quatro arquivos; `packages/workspace/test/git-write.test.ts` 40/40; `packages/orchestrator/test/git-review.test.ts` 3/3; E2Es Electron Git Graph + Git Write 19/19; E2E real Codex 1/1; typecheck global (`npm run typecheck`) aprovado; `npm run lint` global, build Electron e `git diff --check` aprovados. Na execução anterior, o bloqueio isolado em `tests/e2e/skills-transactional-full.spec.ts` registrou: `(18,93) TS2353`, propriedade `days` não existente em `SelfsignedOptions`; `(42,95)`, valor `string | undefined` incompatível com `string`; e `(43,95)`, `string` incompatível com o literal union `"project" | "global"`. A investigação confirmou que o arquivo é alteração concorrente não rastreada da Fase 41; não foi modificado e nenhum dos três erros se reproduz na execução final.

**Decisão:** Fase 38.4 CONCLUÍDA. O provider real, persistência, achados, patch validado, autorização, aplicação explícita, auditoria visual e quality gates foram comprovados. A Fase 38.5 foi iniciada nesta execução.

### 38.5 — Smart Commit & PR Assistant: execução incremental (2026-11-01)

#### Auditoria e decisões

- O caminho oficial é `GitIntelligencePage` → preload/IPC → `tasks.ts` → `TaskEngine` → adapters Claude/Codex existentes. Não há segundo coordenador de agentes, segundo formato de workflow ou persistência paralela de PR.
- O escopo é somente o índice staged. Unstaged e untracked não entram no prompt nem na lista de arquivos, e o limite `DIFF_LIMIT` continua explícito.
- Geração é read-only. A escrita ficou no fluxo já existente `projects.authorize('commit')` → `protectedWrite` → `GitWriter`, depois de confirmação explícita. Não há push, criação de PR remoto ou commit durante a geração.
- Diff, contexto RAG e resposta de provider são dados não confiáveis: o prompt instrui a ignorar comandos; `redactSecrets` é aplicado ao prompt e a todos os campos antes de persistir o relatório.

#### Entregas

- `packages/shared/src/smart-commit.ts`: schemas de entrada, resposta do provider e relatório persistido, com Conventional Commit, limites de body/PR/checklist/changelog/documentação.
- `packages/workspace/src/git.ts`: `gitStagedDiff()` com `git diff --cached`, lista NUL-safe e truncamento existente.
- `packages/orchestrator/src/prompts.ts` e `engine.ts`: prompt estruturado, escolha de provider, RAG opcional, eventos `smart_commit_scope`/`smart_commit_result`, validação Zod e redaction de saída.
- `packages/shared/src/channels.ts`/`ipc.ts`, `apps/desktop/src/main/index.ts`, `tasks.ts` e preload: contratos de início/consulta.
- `apps/desktop/src/renderer/src/pages/GitIntelligencePage.tsx`: painel de proposta editável, agente selecionável, estados acessíveis, contador/limite de mensagem e confirmação antes do commit autorizado.
- `tests/e2e/fake-agent.mjs` e `tests/e2e/git-smart-commit.spec.ts`: adapter de fixture existente produz proposta estruturada; E2E verifica geração, edição, limite, confirmação, commit real em fixture e ausência de remote/push.

#### Evidências e matriz de aceite

| Critério | Evidência | Resultado |
|---|---|---|
| Conventional Commit a partir do staged real | `packages/workspace/test/git-staged-diff.test.ts` 1/1; `packages/orchestrator/test/smart-commit.test.ts` 4/4 | Aprovado |
| Proposta editável de commit/PR/checklist/changelog/documentação | `tests/e2e/git-smart-commit.spec.ts` 1/1; screenshots `prints/git-smart-commit-1280.png`/`800.png` | Aprovado |
| Sem segredos no prompt ou relatório persistido | regressões de redaction no `smart-commit.test.ts` | Aprovado |
| Nenhuma escrita implícita; commit somente após confirmação/autorização | E2E: HEAD e staged preservados antes do clique; HEAD alterado somente depois; `git remote` vazio | Aprovado |
| IPC/preload e persistência | contratos adicionados e exercitados pelo E2E; consulta de `task_events` no teste do engine | Implementado; suíte shared completa bloqueada por regressão concorrente fora da fase |
| Quality gates | build, tsc shared/orchestrator, ESLint direcionado, diff-check | Aprovado |
| Typecheck e lint globais | `packages/workspace/src/skills/studio.ts` e `test-git-validation-enhanced.cjs` concorrentes | Bloqueado externamente |
| Provider CLI real nesta sessão | `NB_REAL_CLI` não habilitado | Não executado; não declarado aprovado |

#### Estado

**38.5 CONCLUÍDA em 2026-11-01** (`git-smart-commit-real.spec.ts` com Codex real e gates globais aprovados). Registro anterior: A implementação principal e os testes de integração/Electron estão verdes. O encerramento depende de revalidar typecheck/lint globais depois que os arquivos concorrentes da Fase 41 deixarem de bloquear a base. Nenhuma alteração foi feita nesses arquivos concorrentes e nenhum commit/push foi criado.

## Auditoria das subfases 38.6–38.8 (2026-11-01)

- **38.6 — Git Automation & Workflow Builder:** parcial. `git-automation.ts` e o monitor da Fase 31.4 já entregam gatilhos, dedupe, limites, disjuntor e painel com E2E. Faltam nós de workflow com grants do GitWriter; o orquestrador não usa o GitWriter hoje.
- **38.7 — Git Memory, Health & Observability:** permanece planejada; a busca não encontrou código de health nem ligação do Git com a memória. Os serviços existentes de Brain/RAG, analytics e Git Intelligence já fornecem pontos de integração usados por Skills 41.9, mas isso não substitui a implementação e os critérios próprios desta subfase.
- **38.8 — Hardening final e distribuição:** permanece planejada. Ainda faltam a matriz de distribuição e a validação de instalação limpa; nenhum resultado de outra fase foi contado como encerramento de 38.8.

A auditoria foi somente de escopo e dependências. A Fase 38.5 foi preservada como concluída e não foi reimplementada.
