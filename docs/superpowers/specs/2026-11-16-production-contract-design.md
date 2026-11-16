# Aethera Studio Production Contract Design

## Intent

Transformar um briefing audiovisual livre em um contrato de produção versionado, verificável e rastreável. O contrato deve impedir que requisitos explícitos desapareçam entre interpretação, pesquisa, roteiro, decupagem, aquisição de mídia, composição, render e revisão.

O contrato atende principalmente ao fluxo usado pela tela `CinemaDirectorPanel` e pelo `StagedCinemaPipeline`, preservando os serviços editoriais, de mídia, de render e de auditoria existentes.

## Goals

- Extrair requisitos objetivos e subjetivos do briefing sem substituir o texto original.
- Representar cada requisito com origem, prioridade, estado, evidência e justificativa.
- Tratar controles estruturados da interface como valores de produção, registrando conflitos com o briefing em vez de sobrescrever escolhas manuais.
- Persistir o contrato e seu histórico junto do job, permitindo retomada e auditoria após reinício.
- Propagar um snapshot do contrato para agentes e estágios relevantes.
- Validar automaticamente duração, formato, resolução, capítulos, mídia, sincronização, loudness e exportação quando houver medições.
- Avaliar critérios subjetivos com evidências e revisão humana, sem converter score em garantia absoluta.
- Reaproveitar a invalidação e os planos de recuperação existentes para reprocessar somente dependências afetadas.
- Exibir conformidade na interface e permitir que revisões por linguagem natural alterem apenas os artefatos dependentes.

## Non-goals

- Criar um segundo motor de produção ou substituir `StagedCinemaPipeline`.
- Garantir qualidade estética subjetiva apenas por uma pontuação automática.
- Conceder direitos autorais a mídias de terceiros.
- Simular pesquisa, aquisição, visão computacional ou render quando um adaptador real não estiver disponível.
- Reescrever a pipeline moderna baseada em `ProductionRunService` neste lote; o contrato terá um adaptador futuro possível, mas o fluxo Aethera/Cinema é a superfície de entrega desta implementação.

## Anti-goals

- Não descartar o prompt original.
- Não substituir silenciosamente controles alterados manualmente.
- Não marcar um requisito como atendido apenas porque um estágio terminou.
- Não transformar mídia contextual, fallback gráfico ou opinião editorial em prova factual.
- Não repetir tentativas de pesquisa ou reparo indefinidamente.

## Current architecture and gaps

- `packages/cinema/src/editorial/research-and-decupagem.ts` já interpreta tema, domínio, ranking, duração, idioma e referência.
- `packages/cinema/src/editorial/editorial-audit.ts` já liga fonte, fato, bloco de roteiro, cena, consulta, mídia, evidência visual e posicionamento.
- `apps/aethera-desktop/src/main/cinema-pipeline.ts` já persiste jobs, checkpoints, invalidação incremental, recuperação editorial e estados de mídia pendente.
- `packages/cinema/src/qc` já mede problemas técnicos, repetição, cobertura, humor e gates de release.
- `CinemaDirectorPanel` já envia prompt, gênero, formato, duração, humor, perfil de render, voz e idioma, mas a sincronização de duração ainda sobrescreve uma escolha manual e não apresenta conflitos.
- O job não possui uma entidade única que reúna requisitos, critérios de aceite e evidências. O contrato preencherá essa lacuna sem duplicar os dossiês e auditorias existentes.

## Approaches considered

### UI-only compiler

Compilar o briefing apenas no renderer e enviar campos prontos. É simples, mas não acompanha pesquisas, cenas ou renders persistidos; falha no critério de rastreabilidade.

### Parallel production engine

Criar um novo coordenador orientado pelo contrato. Daria controle centralizado, mas duplicaria a pipeline existente, aumentaria risco de incompatibilidade e violaria a decisão arquitetural de não criar motor paralelo.

### Shared contract integrated into the existing pipeline — chosen

Adicionar tipos e funções puras em `packages/cinema`, anexar o contrato versionado ao `StagedProductionJob` e ao `CinemaProductionPackage`, e usar os dados existentes como evidência. A UI apenas coleta decisões e apresenta conformidade; o main process continua sendo a fonte de verdade e a pipeline atual continua executando trabalho real.

## Contract model

`ProductionContract` será serializável e terá:

- `schemaVersion`: versão do formato do contrato.
- `contractId`, `projectId`, `revision`, `createdAt`, `updatedAt`.
- `sourcePrompt` e `sourcePromptHash`.
- `interpretation`: snapshot de `PromptInterpretation`.
- `controls`: valores efetivos de gênero, formato, duração, humor, perfil de render, idioma e voz.
- `manualOverrides`: alterações feitas pelo usuário após a extração, com valor anterior, novo valor e origem.
- `requirements`: requisitos individuais com `id`, `category`, `label`, `sourceText`, `value`, `priority`, `status`, `dependencies`, `evidence` e `justification`.
- `acceptanceCriteria`: critérios mensuráveis ou subjetivos, com método de verificação e condição de aprovação.
- `conflicts`: conflitos entre briefing e controles, nunca resolvidos silenciosamente.
- `recovery`: tentativas limitadas por requisito/artefato e próxima ação sugerida.

### Lifecycle decisions

- O contrato pertence à execução (`StagedProductionJob`/`jobId`), não ao `projectId` global. Jobs sucessivos no mesmo projeto têm contratos independentes, embora possam reutilizar artefatos por meio da invalidação existente.
- `current` é o snapshot ativo e `history` contém snapshots imutáveis por revisão. Evidências e estados são atualizados por uma nova revisão, nunca por mutação retroativa de uma revisão já observada.
- Cada requisito recebe um ID estável derivado de categoria, intenção normalizada e escopo. Se a intenção permanece a mesma, a revisão reaproveita o ID; se a dependência ou a intenção muda, o requisito é invalidado e recebe uma nova versão de conteúdo.
- O main process é o único escritor de contrato, evidências e recuperação. Agentes e adaptadores retornam resultados; não escrevem diretamente no job.
- Um resultado tardio carrega `contractRevision` e só pode registrar evidência naquela revisão. Se não for a revisão atual, fica obsoleto para conformidade e não satisfaz requisitos atuais.
- Jobs antigos sem contrato são atualizados de forma preguiçosa ao carregar ou retomar, com uma revisão de migração que preserva o prompt, checkpoints, mídias e auditorias anteriores.
- `satisfied`, `adapted` e `needs_human_review` não são equivalentes: critérios objetivos bloqueiam exportação quando não satisfeitos; adaptação exige justificativa; avaliação subjetiva precisa de evidência e decisão humana antes de ser considerada aprovada.
- O orçamento de recuperação é contado por requisito e revisão. Cada tentativa deve ter assinatura de entrada diferente; ao esgotar o limite, o requisito vira `blocked` ou `needs_human_review` com próxima ação explícita.

Statuses distinguish `extracted`, `in_progress`, `satisfied`, `adapted`, `pending`, `needs_human_review`, `not_met` and `blocked`. A subjective score is evidence only; its status remains pending or human-reviewed until the configured criterion is satisfied.

## Synchronization rules

1. Parse the prompt into a candidate contract.
2. Initialize controls from parsed values only when the UI value has not been manually changed.
3. If the prompt and a manual control disagree, retain the manual control, create a conflict, and expose the conflict in the UI.
4. A later prompt edit creates a new contract revision and invalidates only requirements whose source text or dependency changed.
5. A manual control edit creates a new revision without mutating `sourcePrompt`.

## Pipeline integration

- Prompt/interpretation: create or update the contract and record extraction evidence.
- Research: pass a contract summary and record source/fact evidence against research requirements.
- Script: pass relevant requirements, enforce requested ranking count and language in the generated JSON, and record script evidence.
- Decupagem/storyboard: attach requirement IDs to scene-level audit records and use the existing semantic repair mechanism.
- Acquisition/visual validation: carry contract identity/version in provider context; map approved, contextual and pending media to scene requirements.
- Composition/render: attach the contract snapshot to the package, pass effective controls to existing render/style/sound services, and record measured output evidence.
- QC/preview: evaluate the contract after technical and editorial checks; block export when a blocking measurable criterion is not satisfied.
- Revision: create a revision, compute existing incremental invalidation, and re-run only affected stages while preserving approved artifacts.

Provider availability remains independent. The existing agent fallback chain may use Claude, Codex or another configured provider; no stage may claim success if no provider or real adapter produced its artifact.

## Compliance view

The Aethera production panel will show:

- contract revision and source prompt hash;
- counts for satisfied, adapted, pending, human review, not met and blocked requirements;
- each requirement's evidence and stage;
- conflicts and the control that currently wins;
- recovery attempts and next action;
- blocking criteria preventing export.

The view is read from persisted job state and is available after restart. Existing media coverage and editorial audit panels remain intact and are linked from the contract requirement rows instead of duplicated.

## Recovery policy

Each recoverable failure has a finite budget. A media failure may try an alternate query and a second valid interval, then use a clearly labeled explanatory graphic when allowed, or pause for human media review. Script/provider failures use the existing provider cascade and pause after exhaustion. No retry loop may reuse the same attempt signature without a new input or provider.

## Limitations documented by design

- A natural-language prompt cannot prove artistic quality, factual truth, or legal permission by itself.
- Exact chapter timing depends on measured narration and available media; the contract reports deviations instead of silently stretching footage.
- Loudness and resolution are verifiable only after a real render/probe.
- A provider can reject a request or be unavailable; the contract marks the affected requirement pending/blocked and records the reason.
- The modern database-backed `ProductionRunService` remains compatible but is not converted to this contract in the first implementation slice.

## Acceptance evidence

- Unit tests cover extraction, manual conflict preservation, revision/invalidation, objective compliance and finite recovery.
- Integration tests start a staged pipeline with real deterministic adapters and assert contract persistence/propagation without faking research or render output.
- E2E tests exercise prompt synchronization, conflict display, compliance status, revision action and preservation of approved artifacts.
- Typecheck, focused Vitest suites, full Vitest and the relevant Aethera build are run before completion; any environment-blocked command is reported with its evidence.
