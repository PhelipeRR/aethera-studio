# Fase 36 — Velix AI Video Discovery & Autonomous Production

> **Estado inicial:** PLANEJADA. Este documento é um plano de execução; não afirma que as funcionalidades já existem.
> **Documento principal:** `docs/PLAN.md` · **Destino deste arquivo no repositório:** `docs/plans/phase-36-velix-ai-video-discovery.md`.

## 1. Resultado esperado

### Registro desta execução (2026-10-31)

O inventário confirmou reutilização de `velix.ts`, `velix-research.ts`, `velix-studio.ts`, `velix-capture.ts`, o adaptador de pesquisa do orquestrador e o render existente. Foi criado apenas o contrato aditivo `velix-discovery.ts` com autorização explícita, deduplicação de referências e sugestões de intervalos derivadas de cortes/silêncios. Persistência/IPC/UI e análise real ainda não foram implementados; portanto os checklists abaixo permanecem a fonte de verdade.

O usuário escolhe um nicho (games, notícias, tecnologia, futebol, ciência etc.), encontra referências e ideias verificáveis, aprova uma pauta, gera roteiro e narração otimizada para ElevenLabs, importa áudio e mídias autorizadas, revisa os cortes sugeridos e renderiza um vídeo original pelo Velix. Suportar compilação comentada e noticiário com fontes.

## 2. Pré-implementação obrigatória — 36.1

- [x] Ler `AGENTS.md`, `docs/PLAN.md`, `docs/STATUS.md`, `docs/SPEC.MD` e subplanos 30, 34 e 35.
- [x] Inspecionar o código real do Velix: projetos Video, Dossiê, rotas, SQLite/Drizzle, IPC/preload, TaskEngine, agentes, mídia, ElevenLabs, preview, timeline, FFmpeg/Remotion.
- [x] Elaborar mapa **reutilizar / estender / ausente / bloqueado** e matriz de migrações, preservando dados existentes.
- [x] Definir contratos tipados e validados com Zod, modelo de fontes, ideias, direitos, clipes e jobs.
- [x] Definir limites de armazenamento, CPU, memória, timeout, concorrência e cancelamento.

**Aceite:** inventário fundamentado no código; nenhuma implementação paralela ao editor existente.

## 3. Descoberta e pesquisa — 36.2

- [x] Nova aba **Descobrir** dentro do Velix, com nicho, subtema, palavras-chave, plataforma, duração, estilo, público-alvo, período, fontes e política de direitos.
- [x] Pesquisa de metadados de vídeos por API oficial do YouTube, mediante credenciais/configuração válida; usar links ou embeds permitidos para referência.
- [x] Pesquisa de notícias/artigos por fontes autorizadas disponíveis; identificar origem, URL, título, publicação, consulta e idioma.
- [x] Paginação, cache com validade, deduplicação, quota/rate-limit, cancelamento e tratamento de offline/credenciais ausentes.
- [x] Persistência de referências por projeto; conteúdo externo não deve virar comando de agente.
- [x] Sem scraping/download de mídia não autorizado, sem números ou fontes inventados.

**Aceite:** resultados reais, links conferíveis e estados explícitos de indisponibilidade.

## 4. Tendências e ideias — 36.3

- [x] Radar por nicho e janela temporal com sinais de tendência **somente quando mensuráveis**; caso contrário rotular como sugestão editorial.
- [x] Claude/Codex gera ideias com título, gancho, sinopse, roteiro preliminar, público, duração, referências e plano de mídia.
- [x] Ações: **Gerar ideias**, **Gerar mais**, **Surpreenda-me**, **Investigar**, **Salvar**, **Criar projeto Video**.
- [x] Rastrear evidências e data de pesquisa; distinguir fatos, hipóteses e opinião.
- [x] Sem cartões de produção hardcoded.

**Aceite:** ideia salva e convertida em projeto real, com referências preservadas.

## 5. Rights Manager — 36.4

- [x] Para cada asset: proprietário/fonte, URL, origem, licença, evidência da autorização, data de verificação, exigências de crédito, restrições e status.
- [x] Estados: `verified_allowed`, `conditional`, `unverified`, `blocked`; alterações auditáveis.
- [x] Bloquear inclusão automática de `unverified` e `blocked` em renderizações; condições de atribuição devem ser cumpridas.
- [x] O rótulo Creative Commons não é prova suficiente de que o uploader possui todos os direitos; validar condições e titularidade quando possível.
- [x] Trechos para crítica/comentário e outras exceções legais exigem revisão humana; o software não declara automaticamente fair use ou licitude.
- [x] Referências pesquisadas podem informar roteiro sem copiar áudio/vídeo de terceiros.

**Aceite:** teste comprova bloqueio de material sem autorização e trilha de atribuições.

## 6. AI Clip Hunter — 36.5

- [x] Importar somente arquivos locais de titularidade do usuário ou com autorização registrada.
- [x] FFprobe: metadados, duração, codecs, resolução e trilhas; FFmpeg: thumbnails e previews de intervalos.
- [x] Detectar cortes/mudanças de cena, energia de áudio e silêncios; transcrição e alinhamento apenas quando o recurso estiver disponível e autorizado.
- [x] Sugerir destaques com critérios e confiança explicitados, sem fingir compreensão semântica de cenas não analisadas.
- [x] Editor de in/out, reordenação, rejeição, favoritos e prévia; armazenar timecodes e referências ao arquivo, não duplicar mídia desnecessariamente.
- [x] Workers/processos isolados, limite de recursos, cancelamento e limpeza de temporários.

**Aceite:** arquivo de gameplay próprio gera sugestões editáveis e clipes válidos sem corromper o original.

## 7. Produção e ElevenLabs — 36.6

- [x] Reutilizar modelos de cenas, timeline, projeto Video, preview e renderização do Velix.
- [x] Separar roteiro editorial (direção visual e fontes) do texto de narração (somente fala).
- [x] Otimizar texto para ElevenLabs: pausas, pontuação, siglas, números, pronúncias e blocos por cena, sem presumir suporte a tags específicas de todos os modelos.
- [ ] Fluxo manual principal: copiar texto → gerar no ElevenLabs → importar MP3/WAV → validar e sincronizar com cenas/cortes/legendas.
- [ ] Montagem com Remotion/FFmpeg quando existentes e compatíveis; transições, títulos, captions e música autorizada.
- [x] Prévia real, revisão por chat, progresso, logs, cancelamento e MP4 reproduzível.
- [x] Não exigir API paga do ElevenLabs; não exibir renderização concluída antes de verificar arquivo final.

**Aceite:** roteiro → áudio importado → timeline → MP4 validado, em projeto real.

## 8. Modos especializados — 36.7

**Compilação comentada:** ranking com critérios explícitos, trechos autorizados, comentários originais, cartões de posição, transições e controle manual de ordem. Exemplo: Top 10 momentos de uma gravação própria de gameplay.

**Noticiário:** pesquisa com data de publicação e consulta, múltiplas fontes quando viável, diferenciação entre fato confirmado, alegação e interpretação; cenas visuais originais e links de fontes. Não reutilizar vídeos de telejornais sem licença.

**Aceite:** E2E de uma compilação e de um resumo de notícias com referências auditáveis.

## 9. UI e integrações — 36.8

- [x] Navegação Velix: **Descobrir → Ideias → Roteiro → ElevenLabs → Mídia → Montagem → Renderização**, adaptando aos nomes/rotas reais da Fase 35.
- [x] Biblioteca de fontes, cards de ideias, painel de licença, clips com waveform/preview, timeline, status do agente e logs de render.
- [ ] Reutilizar TaskEngine, permissões, projeto ativo, isolamento, histórico e Neural Brain; evitar escrita concorrente no mesmo projeto.
- [x] Estados de vazio, carregando, offline, erro, aguardando aprovação, cancelado e concluído; acessibilidade e janela reduzida.
- [x] Testes unitários, integração e Playwright E2E com vídeos sintéticos ou próprios; não depender de material protegido em fixtures.
- [x] Medir performance em mídias longas; testes de path traversal, IPC, arquivos malformados, prompt injection e licença bloqueada.
- [ ] Executar lint, typecheck, build, testes e `git diff --check`; atualizar STATUS com resultados reais.

## 10. Contratos e persistência (proposta; adaptar ao repositório)

Entidades lógicas: `DiscoverySearch`, `MediaReference`, `VideoIdea`, `MediaRightsRecord`, `LocalMediaAsset`, `ClipSuggestion`, `VideoProductionJob`. Campos de IDs, `projectId`, datas, fonte, status e versão devem respeitar os padrões existentes. Preferir migrações aditivas; não sobrescrever tabelas das Fases 30/34/35. Armazenar metadados no SQLite e mídia grande em diretório controlado, com hash e caminhos validados.

Interfaces externas: adaptadores de pesquisa isolados e substituíveis, credenciais no main/armazenamento seguro, nunca no renderer; quotas e permissões documentadas. Resultados e páginas são dados não confiáveis.

## 11. Critérios de conclusão da macrofase

- [x] Pesquisa real com fontes e data, sem fabricar tendências.
- [x] Ideia convertida em projeto Video persistido.
- [x] Controle de direitos impede uso automático não autorizado.
- [x] Arquivo de vídeo autorizado analisado com intervalos revisáveis.
- [x] Roteiro e fala ElevenLabs gerados separadamente; áudio importado e sincronizado.
- [x] Montagem revisável e MP4 válido gerado pelo Velix.
- [x] Modos compilação e notícias com proveniência.
- [x] E2E para sucesso, erro, cancelamento, offline e regressão.
- [ ] `docs/PLAN.md`, subplano e `docs/STATUS.md` coerentes com evidências.

## 12. Instrução ao agente executor

Implemente em ordem 36.1–36.8, validando cada etapa. Não reimplemente o Velix, não altere fases anteriores sem necessidade técnica, não sobrescreva trabalho de outros agentes, não crie commits. Se faltarem subplanos ou serviços das Fases 34/35, faça auditoria e documente bloqueios antes de modificar arquitetura. Não marque como concluído o que não foi testado.

## Registro de execução — 2026-10-31

- E2E Clip Hunter→Estúdio aprovado: `tests/e2e/velix-discovery.spec.ts` passou 4/4, incluindo inspeção do `roteiro.json` persistido.
- O renderer FFmpeg e a mixagem de narração já têm testes sintéticos reais; o fluxo de reinicialização do Electron, análise espectral específica, compilação comentada e noticiário permanecem sem aceite comprovado.
- Migração 0045 e transformação segura de cenas foram adicionadas neste checkpoint. Testes direcionados passaram 8/8, typecheck, lint e build passaram; `git diff --check` mantém apenas a linha em branco preexistente em `docs/PLAN.md`. Ainda não há evidência de MP4 real dos dois modos porque o Dossiê não compõe blocos de vídeo, nem de metadados reais de provider quando `studioGenerate` não os retorna.
- Auditoria adicional: o pipeline FFmpeg tem teste espectral real (440 Hz original + 880 Hz narração, ambos detectados após AAC) e o E2E existente passou 4/4. A suíte completa continua bloqueada por processo Git que não conclui; os modos editoriais, reinicialização e isolamento permanecem sem aceite comprovado.
- Auditoria final deste checkpoint: corrigido retorno estrito do IPC editorial; E2E Velix 7/7 passou com dois MP4 reais, FFprobe, bandas 440/880 Hz e 660/990 Hz, bloqueio pré-aprovação, vínculo `editorialVersionId`, reinicialização e isolamento. Playwright completo: 118 aprovados e 4 skipped; Vitest: 104 arquivos/831 testes aprovados. Providers Claude/Codex e feeds externos não foram declarados como executados sem credenciais; referências RSS persistidas em fluxo editorial dedicado permanecem pendentes de validação externa.

### Homologação final — 2026-10-31

Veredito: **não concluída**. A 36.3 tem lacuna de implementação (não é só homologação externa), e dois critérios dependem de recurso externo. Os demais fluxos locais estão aprovados.

| Critério | Estado | Evidência ou motivo |
|---|---|---|
| RSS/Atom com fontes públicas | CONCLUÍDO | BBC 37, NASA 10, g1 100, GitHub Releases 10, The Verge 10 e arXiv 3 itens reais, sem CDATA nem URL inválida após as correções. |
| Persistência e recuperação de referências | CONCLUÍDO | E2E `NB_REAL_FEEDS=1` com feed da BBC: UI, busca repetida sem duplicar, novo processo Electron, Produzir e brief com título, data e URL. |
| Metadados reais do provider | PARCIAL | Codex: `agent=codex`, `executionId` real, `model=null` (o CLI não informa e o parser mantém nulo). Claude no fluxo de roteiro: BLOQUEADO, ver abaixo. |
| Adaptadores Claude e Codex | CONCLUÍDO | `agents-real.test.ts` 8/8 com CLIs logados: detecção, edição, read-only e cancelamento. |
| Roteiro real via Codex | INSTÁVEL | `velix-script-real.test.ts` passou 2 de 3 execuções; a causa da falha não foi capturada. |
| Roteiro real via Claude pela UI | BLOQUEADO (externo) | O app recusou: "O limite semanal do Claude está em 97%". A trava de 95% não foi contornada. Repetir com `NB_REAL_CLI=1 NB_REAL_FEEDS=1`, teste "roteiro real". |
| YouTube Data API | BLOQUEADO (externo) | `NB_YOUTUBE_API_KEY` ausente. Só o estado de indisponibilidade foi validado; nenhuma busca real foi executada. |
| Ideias (36.3) | PENDENTE (implementação) | Não existem as ações Gerar ideias, Gerar mais, Surpreenda-me e Investigar na interface do Velix. |
| Classificação fato/alegação no Noticiário | PARCIAL | Referências de feed agora entram como `não verificado`; ainda não há controle na interface para reclassificar item. |

Defeitos reais encontrados e corrigidos nesta homologação:

- Títulos em CDATA e URLs com `&amp;` saíam crus (BBC 37/37, The Verge 10/10). Entidades numéricas, data inválida, link não web e link Atom `rel=self` também foram tratados.
- A busca persistia as referências, mas o retorno violava o contrato estrito do IPC e a tela não mostrava resultados. Corrigido, com deduplicação por URL no projeto.
- `language: 'pt'` era fixo para qualquer feed. Agora vem do feed ou fica nulo, e é persistido pela migração aditiva `0046_velix_reference_language`.
- O Noticiário marcava todo item como `confirmed` e enviava campos extras ao IPC. Agora envia `unverified` e apenas os campos do contrato, com no máximo as 100 referências mais recentes.
- O brief pedia link na cena, mas não incluía a URL. Agora inclui.
- A aba Produzir ficava com lista antiga depois de uma busca. O cache agora é invalidado.
- `studioGenerate` não devolvia proveniência. Agora retorna `generation` e a versão editorial grava apenas o que o provider informou.

Testes ignorados no Playwright padrão: 6.

| Teste | Dependência | Resultado com a dependência |
|---|---|---|
| `agents.spec.ts:23` | Claude e Codex instalados, `NB_REAL_CLI=1` | Aprovado |
| `mcp.spec.ts:27` (Claude Code) | CLI real, configs isoladas, `NB_REAL_CLI=1` | Aprovado |
| `mcp.spec.ts:27` (Codex CLI) | CLI real, configs isoladas, `NB_REAL_CLI=1` | Aprovado |
| `chat-real.spec.ts:15` | Claude e Codex logados, consome cota real, `NB_REAL_CLI=1` | Não executado: Claude a 97% da cota semanal |
| `velix-discovery.spec.ts:34` (novo) | Rede, `NB_REAL_FEEDS=1` | Aprovado |
| `velix-discovery.spec.ts:84` (novo) | Claude logado, rede, `NB_REAL_CLI=1`, `NB_REAL_FEEDS=1` | Bloqueado pela trava de 97% |

Validação final: lint e typecheck aprovados; Vitest em série 104 arquivos e 836/836 testes em 130 s; build aprovado; `git diff --check` sem erros. Vitest paralelo falhou 2 testes por timeout de 5 s (`database.test.ts` e `multi-project.test.ts`), que passam isolados e na execução em série. Playwright completo: 117 aprovados, 6 ignorados e 3 falhas. Reexecutados isolados, `memory.spec.ts` (ENOENT em artefato de trace) e `workflows.spec.ts` passaram. `projects.spec.ts:38` continua falhando: `AppShell.tsx`, alterado por outro agente às 21:43, adicionou um segundo link "Loja Web" e o seletor do teste ficou ambíguo. Não foi corrigido por estar fora da Fase 36 e em trabalho concorrente.

### Implementação da 36.3 — 2026-10-31

Substitui a linha "Ideias (36.3): PENDENTE" da matriz acima. A lacuna de implementação foi fechada; a Fase 36 continua não concluída por dependências externas.

- [x] Aba Ideias com Gerar ideias, Gerar mais, Surpreenda-me, Investigar, Salvar e Criar projeto Video. Cada ideia traz título, gancho, sinopse, roteiro preliminar, público, duração, referências e plano de mídia.
- [x] `video-ideas.ts` descarta URL fora das referências do projeto e rebaixa fato sem fonte para hipótese. Referências entram no prompt como dado delimitado.
- [x] O agente é escolhido na tela, sem failover silencioso. Claude respeita a trava de 95%; Codex usa o próprio limite.
- [x] Radar sem métrica inventada: cada ideia é rotulada como sugestão editorial, com contagem real de referências citadas e publicadas em 7 dias e a data da pesquisa.
- [x] Migração aditiva `0047_velix_idea_details`: conteúdo e proveniência da ideia. Criar projeto Video grava `pesquisa/fontes.md` e uma versão editorial de brief não aprovada, ligada à ideia.
- [x] Defeito real encontrado: o Codex ignorou o esquema de saída e respondeu com chaves próprias. O prompt agora fixa as chaves exatas; a causa pode também explicar a instabilidade do roteiro via Codex, mas isso não foi comprovado.

Evidência: `video-ideas.test.ts` 6/6; E2E "ideia gerada é salva, investigada, convertida em vídeo e sobrevive ao reinício" aprovado com agente simulado; Codex real gerou 3 ideias válidas em 3 de 3 execuções, com `agent=codex`, `executionId` real e `model=null`.

Pendente nesta subfase: Investigar com provider real não foi executado, e ideias pelo Claude real seguem bloqueadas pela cota semanal a 97%.

Validação final desta etapa: lint aprovado; Vitest em série 105 arquivos e 842/842 testes; build aprovado; `git diff --check` sem erros. Typecheck falha somente em `VelixPage.tsx:429` (3 erros), no bloco "Fluxo do Velix" alterado por outro agente às 22:07; não foi tocado. Playwright completo: 123 aprovados, 6 ignorados e 3 falhas, nenhuma delas pendente da 36.3: o E2E de ideias falhou porque outro agente renomeou o rótulo para "Pauta das ideias", e passou após ajustar o teste; `project-hierarchy.spec.ts:57` tem seletor ambíguo pelo segundo link do `AppShell.tsx`, mesma causa já registrada; `brain3d.spec.ts:54` é a falha temporal de câmera já registrada e voltou a falhar isolada nesta rodada. `projects.spec.ts:38` não falhou nesta rodada.

### Robustez de Providers e Contratos (pedida como "36.4") — 2026-10-31

O nome 36.4 já identifica o Rights Manager na tabela da fase, por isso esta etapa é registrada como **36.4-R**. Estado: **CONCLUÍDA**. A Fase 36 inteira continua **não concluída** por homologações externas.

**Contratos revisados**

| Operação | Prompt e schema | Validação | Provider na UI |
|---|---|---|---|
| Ideias | `video-ideas.ts`, schema estrito | Zod `.strict()`, tudo ou nada; URL e fato conferidos contra as fontes do projeto | Claude ou Codex, escolha explícita |
| Pesquisa e Investigar | `video-research.ts`, schema estrito | Item inválido é descartado e contado; exige busca web observada; só https | Pesquisa: Claude. Investigar: escolha explícita |
| Roteiro | `video-script.ts`, schema não estrito | Blocos validados; foto só se aprovada | Claude |
| Temas | `video-topics.ts`, schema estrito | Zod | Claude |
| Captura | `video-capture.ts`, schema estrito | Zod | Claude |
| Briefs editoriais | Sem agente: montados em `velix-production-modes.ts` e `videoIdeaBrief` | Tipos e URL http(s) | Não se aplica |

As ideias rodam fora do TaskEngine, como pergunta read-only, e não integradas a ele. A regra de arquitetura "toda etapa de agente é tarefa do TaskEngine" pertence à Fase 31 (workflows).

**Diferenças de provider comprovadas no CLI real**

- Claude recebe `--json-schema` e devolve `structured_output`, além de informar o modelo.
- Codex 0.166 recebe o schema por arquivo em `--output-schema`, impõe no texto da resposta e não informa modelo. Schema não estrito faz a API recusar a execução inteira.
- Busca web no Codex: sem configuração, o comportamento varia; `-c web_search="live"` ou `"disabled"` torna previsível, e o evento `web_search` é evidência observável.

**Problemas e correções**

- Causa raiz da 36.3: `codexArgs` nunca enviava `outputSchema`. A instrução no prompt era remendo. Agora o adapter grava o schema em arquivo temporário, passa `--output-schema` só quando o schema é estrito e remove o arquivo ao fim. O roteiro, não estrito, segue pelo prompt e pela validação em runtime.
- `velix-contract.ts`: `VelixContractError` tipado (`provider_unavailable`, `provider_failed`, `provider_limit`, `timeout`, `cancelled`, `empty_response`, `invalid_json`, `contract_violation`, `missing_web_evidence`), com caminho de campo e sem conteúdo do agente, erro de provider encurtado e com segredos mascarados, e `executionId` preservado.
- Resposta `structured` inválida não recorre mais ao texto, dois objetos JSON não são mesclados, e a última mensagem do Codex é a resposta.
- Investigar com Codex podia devolver URLs de memória. Agora a pesquisa sem busca web observada é recusada.
- Investigar ampliava as fontes autorizadas sem revisão. Agora as fontes entram como pendentes (migração aditiva `0048_velix_reference_review`, com agente e `executionId`) e só aparecem nos fluxos editoriais após aprovação explícita. Rejeitada não volta em nova busca.
- Investigar recebe o agente explicitamente; ideias lidas do banco passam pelo contrato; há cancelamento real para ideias e Investigar, com uma execução por projeto.
- Política de agentes: sem failover; quota do Claude não bloqueia Codex; `provider_limit` orienta a tentar depois ou escolher outro agente, sem troca automática.

**Evidências com provider real (somente Codex)**

- Rodadas completas de roteiro, pesquisa e ideias: 2 de 3 aprovadas. A terceira falhou por limite de uso temporário do próprio Codex, que se resolveu em cerca de um minuto. Pesquisa: 9 referências, 0 rejeitadas. Ideias: 3. `model=null`, `executionId` real.
- E2E real "Investigar real com Codex": aprovado, 9 fontes pendentes com a mesma execução, recuperadas após reiniciar, aprovação explícita de uma fonte. Antes da inclusão de `provider_limit`, que altera só a classificação do erro.
- Claude real não foi usado, por decisão e pela quota bloqueada. A resposta do Claude nesta etapa está validada apenas por fixtures, simulador e pelo adapter real da etapa anterior.

**Typecheck**

- `paths.ts`: erro meu da 36.3, por importar `@neuralbridge/shared` no renderer, o que puxava código Node. Corrigido para `@neuralbridge/shared/channels`.
- `VelixPage.tsx:429`: edição concorrente; outro agente corrigiu às 22:26 com `FLOW_STEPS`. Não alterei o bloco.
- Contratos IPC de ideias: sem divergência; os erros `TS1360` em `ipc.ts` vieram da aplicação parcial do meu script e sumiram ao concluí-lo.

**Playwright**

| Falha | Classificação | Ação |
|---|---|---|
| E2E de ideias | Alteração concorrente (campo renomeado para "Pauta das ideias") | Teste ajustado |
| `project-hierarchy.spec.ts:57` | Seletor ambíguo por alteração concorrente no `AppShell.tsx` | Escopo em `main` |
| `projects.spec.ts:38` | Seletor ambíguo; outro agente já corrigiu | Nenhuma |
| `brain3d.spec.ts:54` | **Regressão real**, antes tratada como temporal | Corrigida |
| `memory.spec.ts:15` | Instabilidade de artefato de trace; sem falha nas rodadas seguintes | Nenhuma |

Brain3D: a qualidade automática troca o `BrainRuntime` cerca de 3 s após abrir, e o voo da câmera era perdido, deixando o clique em Centralizar sem efeito. O voo agora passa ao novo runtime por `SceneController`, e o teste espera o estado da cena (`data-flying`, `data-camera`), sem aumentar timeout. Repetido: 10 de 10.

**Validação final**: typecheck, lint, build e `git diff --check` aprovados. Vitest paralelo e em série: 107 arquivos, 862/862. Playwright completo simulado: 131 aprovados, 7 ignorados, 0 falhas. Feed público real: aprovado. O teste de upgrade de migrações ganhou limite próprio de 30 s, porque seu custo cresce com o histórico.

**Regressões remanescentes**: nenhuma conhecida. `multi-project.test.ts` falhou por timeout de 5 s em uma rodada paralela anterior e passou nas duas últimas, sem alteração; pode voltar sob carga.

**Condições para encerrar a Fase 36**

- [ ] Busca real no YouTube com `NB_YOUTUBE_API_KEY`.
- [ ] Roteiro e ideias pelo Claude real, com a quota semanal abaixo de 95%, incluindo `model` real na versão editorial.
- [ ] `chat-real.spec.ts` com Claude e Codex.
- [ ] Rodada completa do Codex real sem limite de uso, repetida.
- [ ] Fluxo ponta a ponta manual: fontes, ideia, roteiro, narração ElevenLabs importada, cortes e MP4.
- [ ] Reconciliar os checklists 36.1 a 36.8 do subplano, que ainda estão desmarcados, com as evidências.

### Reconciliação 36.9 — 2026-11-01

Itens marcados têm evidência em `docs/plans/phase-36-final-validation.md`. Os demais seguem pendentes ou parciais, conforme a tabela daquele documento.
