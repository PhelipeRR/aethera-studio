# Fase 41 — NeuralBridge Skills Intelligence & Studio

## Objetivo

Evoluir o Skills Manager em uma camada local-first de descoberta, recomendação, avaliação de confiança, instalação controlada, Skill Studio e integração rastreável com tarefas e workflows, sem duplicar TaskEngine, Workflow Builder, Git Intelligence ou Brain/RAG.

## Arquitetura

O legado `packages/workspace/src/skills.ts` permanece como fachada operacional. O novo submódulo `packages/workspace/src/skills/` contém contratos, inventário e políticas incrementais; lotes futuros poderão adicionar serviços de discovery, recommendation, trust, installation e studio sem alterar IPC existente. Conteúdo de skills é sempre dado não confiável, e toda execução continua proibida por padrão.

## Lotes

1. **Auditoria e contratos** — inventário real, contratos tipados, confiança inicial e matriz de integração; sem migração de comportamento.
2. **Discovery Engine** — descoberta local/global/projeto e fontes remotas autorizadas, com deduplicação e versões.
3. **Recommendation Engine** — regras determinísticas por tarefa, stack, agente, workflow, preferências e histórico.
4. **Security & Trust Center** — checks de origem, manifesto, dependências, scripts, permissões, integridade e riscos.
5. **Instalação, atualização e rollback** — operações transacionais, preview, backup, cancelamento e recuperação.
6. **Skill Studio** — editor visual/Markdown, validação, versionamento, importação/exportação e arquivos auxiliares.
7. **Integração TaskEngine** — contexto mínimo, autorização, rastreabilidade e consumo estimado sem inventar tokens.
8. **Integração Workflow Builder** — skills por workflow/agente/etapa, obrigatórias/opcionais e validação de dependências.
9. **Git Intelligence, memória e analytics** — guardrails Git preservados, preferências não sensíveis, histórico e métricas verificáveis.
10. **UX, E2E, estabilidade e homologação** — catálogo, trust center, studio, acessibilidade, temas, reduced motion, reinício e gates finais.

## Contratos do Lote 1

Os contratos estão em `packages/workspace/src/skills/contracts.ts`: agentes, origens, capacidades, checks de confiança, sumário de confiança, matriz de integração e auditoria da fase. `inventory.ts` registra evidências e decisões; `trust.ts` fornece somente a baseline declarativa, sem instalar, recomendar ou executar conteúdo.

## Lote 2 — Discovery Engine implementado

`discovery.ts` oferece `createSkillDiscoveryEngine`, `discover`, `list` e `get`, além dos construtores de raízes globais e de projeto. O motor reutiliza `scanSkills` como leitor legado, opera somente em modo read-only e não altera IPC, preferências ou instalação.

Diretórios suportados quando explicitamente configurados:

- Globais: `.claude/skills`, `.claude/plugins`, `.codex/skills` e `.agents/skills`.
- Por projeto: `<projeto>/.claude/skills`, `<projeto>/.codex/skills` e `<projeto>/.agents/skills`.
- O caso `~/.agents/skills/remotion-best-practices` é coberto pelo construtor global.

Normalização: busca NFKD case-insensitive; escopo, projeto e agentes são inferidos somente pela raiz configurada; versão, categoria e atualização permanecem `null`/indisponíveis quando não declaradas. O hash SHA-256 do conteúdo sustenta comparação determinística, sem expor o conteúdo ao catálogo externo.

Duplicidades são preservadas. Grupos são identificados por mesmo nome normalizado ou mesmo caminho; conflito é marcado quando o mesmo nome possui hashes diferentes. Não há precedência silenciosa: a consulta retorna todas as alternativas e não declara uma skill como ativa.

Segurança: raízes inexistentes ou inacessíveis são ignoradas; raízes symlink não são seguidas; nenhum script, hook, comando ou dependência é executado; o `SKILL.md` continua sendo dado não confiável. Limites de leitura e validações profundas do conteúdo remoto permanecem no fluxo existente e serão ampliados no Lote 4.

## Lote 3 — Recommendation Engine implementado

`recommendation.ts` expõe `RecommendationContext`, `SkillRecommendation`, `RecommendationResult` e `createSkillRecommendationEngine`. A única entrada de candidatos é `DiscoveredSkill[]` fornecida pelo Discovery Engine; não há varredura paralela, chamada externa, instalação ou ativação.

Algoritmo determinístico, versão `41.3-deterministic-1`:

- +12 para regras de vídeo/Remotion, React/UI, Playwright/testes ou Git/revisão quando há evidência no inventário e no contexto.
- +12 para MCP; +10 para workflows/planejamento, segurança ou documentos; +8 para refatoração/qualidade.
- +2 por termo compartilhado, limitado a +8.
- +6 quando o nome corresponde ao `taskType`.
- +5 quando uma `SkillPreference` habilitada corresponde ao contexto.

O resultado é um score ordinal (`ordinal-rule-score`), nunca uma probabilidade. Skills incompatíveis com o agente, de outro projeto, desabilitadas, não selecionadas explicitamente ou inválidas são excluídas com motivo. Conflitos não são resolvidos silenciosamente: alternativas permanecem visíveis, recebem aviso e exigem confirmação.

## Lote 4 — Security & Trust Center implementado

`trust-center.ts` expõe `createTrustCenter().assess()` e `.preview()`. A avaliação é read-only, produz fingerprint SHA-256 do conjunto de arquivos, origem normalizada, escopo, versão das regras, evidência por arquivo, checks e decisão explícita. A prévia informa destino, arquivos, tamanhos, bloqueios e avisos sem copiar, sobrescrever ou criar backup.

Checks operacionais: origem HTTPS/allowlist, manifesto `SKILL.md`, limites individuais/agregados/de arquivos/profundidade, symlinks, caminhos inseguros, extensões executáveis, licença indisponível e heurísticas de shell, instalação de dependências, downloads, credenciais, Git destrutivo e prompt injection. Heurísticas são marcadas como atenção e não provam execução. Bloqueios críticos incluem origem remota não allowlisted, manifesto ausente, symlink, path inseguro e limites excedidos.

Limites padrão: 512 KiB por arquivo, 5 MiB agregado, 200 arquivos e profundidade 8. A análise não certifica segurança, não avalia reputação e não vira autorização permanente; o Lote 5 deverá revalidar o fingerprint antes da instalação.

## Lote 5 — Transactional Skills Installer implementado

`installer.ts` expõe `createTransactionalSkillInstaller({ journalRoot })` com `prepare`, `commit`, `cancel`, `rollback`, `recover` e `readJournal`. A preparação copia a origem para staging isolado, executa o Trust Center, gera fingerprint/prévia e persiste estado `awaiting_approval`; nenhum destino é alterado antes do commit.

Estados suportados: `prepared`, `awaiting_approval`, `staging`, `validated`, `committing`, `completed`, `rolling_back`, `rolled_back`, `failed`, `cancelled` e `recovery_required`. A autorização contém operação, origem, destino, escopo, agente, fingerprint, resumo e referência de versão; é validada contra o journal e removida após uso.

Antes da gravação, origem e staging são reavaliados e o fingerprint relativo (caminho relativo + tamanho + hash por arquivo) precisa coincidir. O destino possui lockfile exclusivo para concorrência entre processos. Atualizações renomeiam a instalação anterior para backup antes de mover o staging; o backup é mantido para rollback explícito. Falhas ambíguas ficam `recovery_required` e nunca iniciam instalação automaticamente após reinício.

Compatibilidade: os canais legados de instalação/atualização continuam disponíveis sem alteração de contrato; os canais transacionais novos carregam a intenção mínima e mantêm fingerprint, destino e autorização de uso único no processo principal/journal. `skills.ts` não foi refatorado integralmente.

## Lote 5.1 — Integração IPC e homologação

O processo principal agora expõe canais transacionais separados dos legados: preparar, prévia, confirmar, status, cancelar, rollback, histórico e recovery. O renderer envia somente intenção, URL, skillId, escopo e agente; o main valida allowlist, deriva o destino gerenciado, mantém a autorização no journal e consome-a no commit. O Skills Manager usa preparar → prévia → confirmação → commit, mantendo os métodos legados disponíveis.

Rollback é criado no main a partir do journal, nunca a partir de fingerprint enviado pelo renderer. A integração IPC atual suporta o escopo global gerenciado; escopo por projeto permanece rejeitado explicitamente até haver resolução segura do projeto no contrato de UI. O fluxo remoto usa `git clone --no-recurse-submodules --no-tags` com URL HTTPS allowlisted e nenhum hook/script da skill é executado.

Evidência: contratos IPC e testes dos Lotes 1–5 passaram; `tests/e2e/skills.spec.ts` passou 1/1. Os bloqueios concorrentes foram posteriormente resolvidos sem intervenção neste lote; a rodada nova passou typecheck global, ESLint global, build Electron e `git diff --check`. Os E2Es `skills.spec.ts` e `skills-transactional.spec.ts` passaram 2/2 contra o build recém-gerado. O segundo valida bloqueio de preparação por host não allowlisted e ausência de escrita em `managed-skills`.

Naquele checkpoint, a homologação remota ponta a ponta ainda estava pendente; ela foi concluída com fixture local controlada no Lote 5.3 abaixo. Cancelamento depois que o commit começa continua fora do contrato suportado.

No Windows, `rename` é atômico dentro do mesmo volume quando o destino não está bloqueado; a substituição completa de diretório e a limpeza de backup não são tratadas como uma transação filesystem única. Por isso o journal, lock, validação pós-commit e backup persistente são obrigatórios.

## Lote 5.2 — Estabilização e gates

Os bloqueios concorrentes encontrados no typecheck foram resolvidos pelos fluxos concorrentes, preservando as alterações existentes em `prompts.ts` e `guided-tours.tsx`. A validação global passou em typecheck, ESLint, build Electron e `git diff --check`; os testes direcionados dos Lotes 1–5 passaram 41/41.

## Lote 5.3 — Homologação E2E transacional completa

`tests/e2e/skills-transactional-full.spec.ts` cria, em cada caso, uma pasta temporária, um repositório bare local e um repositório de trabalho controlado. O Git é servido por HTTPS em porta dinâmica com certificado autoassinado restrito ao fixture; a aplicação recebe somente o caminho da CA de teste (`NB_SKILL_TEST_CA_FILE`), e o clone usa `http.sslCAInfo` com `http.sslVerify=true`. A preferência de allowlist é isolada no `preferences.json` temporário. Nenhum repositório público, credencial externa, `NODE_TLS_REJECT_UNAUTHORIZED=0` ou alteração de skills globais é usado.

Os três testes cobrem:

- instalação remota, atualização com backup persistente, rollback explícito e cancelamento antes do commit;
- fechamento/reabertura do Electron com journal em `committing`, recovery para `recovery_required` e ausência de instalação automática;
- duas confirmações simultâneas sob lock de destino, ausência de gravação durante o bloqueio e confirmação posterior; `install.ps1` permanece arquivo não executado.

O E2E direcionado final passou 5/5 somando `skills.spec.ts`, `skills-transactional.spec.ts` e o fixture transacional completo. O contrato IPC da prévia foi atualizado para aceitar os `findings` e `checks` produzidos pelo Trust Center, sem relaxar schemas estritos.

Limitações registradas: cancelamento depois que o commit começou não é suportado; o IPC atual aceita somente escopo global gerenciado; a origem remota não é pinada automaticamente a um commit imutável, portanto o fingerprint garante o conteúdo staged e a validação pós-commit, mas não certifica reputação nem alterações futuras da origem; backups são mantidos para rollback e exigem política futura de retenção.

## Critérios de aceite da Fase 41

- Skills existentes continuam abrindo, listando, configurando e instalando apenas com os contratos atuais.
- Nenhuma recomendação é confundida com autorização ou instalação.
- Nenhum script ou comando fornecido por uma skill é executado automaticamente.
- Integrações usam TaskEngine, Workflow Builder, Git Intelligence, Brain/RAG e Token Optimizer existentes.
- Todas as operações relevantes têm evidência unitária, integração e E2E antes do encerramento.
- Fases 36 e 37 permanecem inalteradas em comportamento e escopo.

## Lote 6 — Skill Studio implementado

O Lote 6 usa a abordagem filesystem-first aprovada. `createSkillStudioService` é a fronteira de domínio para `userData/skill-studio`, com `drafts/<id>`, `versions/<skillId>/<versionId>` e `exports/<skillId>-<versionId>`. Cada draft mantém `SKILL.md` compatível com o parser legado e `neuralbridge.skill.json` para metadata editorial, escopo, origem, revisão e fingerprint. As escritas são atômicas; locks por draft serializam saves/publicações e conflitos externos são rejeitados por revisão/fingerprint.

O serviço chama `createTransactionalSkillInstaller` para publicar/restaurar no único destino global `managed-skills`, precedido por Trust Center e confirmação explícita. Discovery passa a observar esse root junto às raízes existentes, enquanto Recommendation recebe uma simulação em memória; nenhuma recomendação publica ou ativa uma skill. A instalação legada, `skills.ts`, persistência existente e contratos IPC anteriores continuam disponíveis.

Contratos definidos em `contracts.ts` e espelhados em `shared/channels.ts`/`shared/ipc.ts`: `SkillMetadata`, `SkillDraft`, `SkillDraftSummary`, `SkillEditorState`, `SkillValidationResult`, `SkillVersion`, `SkillChangeSet`, `SkillExportResult`, `SkillImportPreview` e `SkillRecommendationSimulation`. O IPC aceita apenas intenção e dados limitados; o main resolve roots e destinos, e o preload não expõe APIs de filesystem.

A interface integrada à `SkillsPage` oferece editor de campos, Markdown, arquivos auxiliares textuais, preview, Trust Center, histórico/diff/restore, importação/exportação de diretórios e simulação de recomendação. Scripts são exibidos como dados inertes. O escopo de publicação continua global, conforme o contrato atual; ZIP, binários, execução assistida e retenção automática permanecem fora do lote.

Evidência em 2026-11-01: `skills-studio.test.ts` 11/11, `skills-installer.test.ts` 5/5, IPC 27/27, regressão direcionada dos módulos de Skills 66/66, E2Es Skills/Studio/transacionais 8/8, build Electron e gates direcionados aprovados. Snapshots têm metadata sidecar recuperável, e o restore remove essa metadata da cópia publicada. O typecheck e lint globais continuam com bloqueios concorrentes já registrados em `docs/PLAN.md`/`docs/STATUS.md`; Lote 7 não foi iniciado.

## Checkpoint de integração 41.9–41.10 (2026-11-01)

### 41.9 — integração real de contexto

`createSkillIntelligenceProvider` agora agrega, em modo somente leitura, skills válidas, `GitInfo`, contexto do Brain/RAG e sinais persistidos de uso. O conteúdo de skills, Git e memória é delimitado como dado não confiável, não concede permissões e é limitado pelo orçamento de tokens. O TaskEngine registra `skills_context`, referências e `tokenAnalytics`; o caminho de recommendation da tela Skills também recebe evidência de Git, memória/RAG e analytics sem alterar preferências.

O `TaskEngine` ganhou a capacidade estruturada read-only usada pela sugestão de composição Motion. Ela persiste a tarefa/eventos, chama os adapters existentes e valida a saída contra schema antes de devolver cenas. A capacidade `neuralbridge:motion-composition` foi adicionada ao inventário do Skills Manager sem refatorar `skills.ts`.

### 41.10 — homologação conjunta

Evidências desta rodada:

- Vitest focado: 5 arquivos, 70/70 testes, cobrindo agregação Git/memória/RAG/uso, recommendation, TaskEngine, parser de composição e alinhamento de legendas.
- Playwright conjunto: 15 aprovados, 1 ignorado e 0 falhas em Git Intelligence, Skills, Skill Studio, instalação transacional e Motion. O ignorado é o render real condicionado a `NB_MOTION=1`.
- Render real opt-in: `NB_MOTION=1` com Chromium explícito passou 1/1; sugestão via TaskEngine, aplicação humana, MP4 e FFprobe foram comprovados. Sem navegador explícito o botão permanece corretamente desabilitado no `userData` isolado.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:motion` e `git diff --check` passaram nesta retomada.

Naquele checkpoint a fase seguia aberta; o encerramento está registrado no fim deste arquivo. Nenhum contrato legado de `skills.ts` foi removido.

## Retomada do Lote 7 — integração de execução (2026-11-01)

O Lote 7 foi iniciado sem refatorar `skills.ts`. O contrato `skillAvailabilityProvider` foi adicionado ao TaskEngine como validação opcional de skills explicitamente solicitadas; o main o alimenta pelo inventário real e tarefas/capacidades read-only falham antes do adapter quando uma skill pedida não está disponível. Preferências antigas não são tratadas como erro fatal. A execução read-only, contexto de Git/Brain/RAG/memória/analytics, persistência de eventos e Token Optimizer existentes foram preservados.

Evidência nova: `packages/orchestrator/test/engine.test.ts` cobre ausência de skill em tarefa normal e capacidade estruturada; a cobertura anterior de contexto persistido e read-only continua válida. A matriz dos lotes 7–10 foi executada no encerramento abaixo.

## Encerramento da Fase 41 (2026-11-01)

**FASE 41 CONCLUÍDA.** Cada critério tem evidência: contratos antigos preservados (`skills*.spec.ts`), recomendação sem autorização, nenhum script executado, integrações reais com TaskEngine, Workflow Builder, Git, Brain/RAG e Token Optimizer, e evidência unitária, de integração e E2E, inclusive com Claude e Codex reais e reinício. Regra mantida: o roteador só usa skill habilitada para aquele agente; a skill pedida e não habilitada gera o evento `skills_skipped`.
