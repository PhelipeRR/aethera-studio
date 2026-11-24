# Auditoria técnica do pipeline Recap — Aethera Studio

**Data da auditoria:** 2026-11-23  
**Commit-base analisado:** `7569ec1`  
**Modo:** somente leitura estática  
**Skill aplicada:** `video-pipeline-auditor` v3.0.0, incluindo o módulo obrigatório **Token & Inference Budget Auditor**  
**Escopo:** importação de CBZ/PDF/imagens/URLs, extração, visão, Story Engine, continuidade, roteiro, Humanizer, TTS, alinhamento, MotionVelix, Remotion/FFmpeg, checkpoints, jobs e exportação.

## 1. Resumo executivo

O pipeline possui uma arquitetura real e relativamente completa: importação segura, extração determinística, análise visual com fallback, checkpoints atômicos, Story Engine, Gate G, TTS, planejamento Audio-First, MotionVelix híbrido com FFmpeg, Gates H/I/J e job manager durável.

O problema principal não é um único loop que transforme automaticamente 437 painéis em 437 chamadas Claude em todos os casos. O código, porém, torna esse cenário o comportamento provável quando o cache não é reutilizado: a análise visual é feita painel a painel; os providers Claude/Gateway aceitam uma imagem por chamada; o prompt de sistema e parte do contexto são reenviados em cada chamada; e a telemetria de tokens não é propagada nem vinculada ao `runId` do Recap.

### Conclusões prioritárias

1. **Causa raiz exata do estouro de quota não confirmável:** não há no repositório um ledger do job de 437 painéis, nem tokens de entrada/saída, cache-read/cache-write, custo ou número de tentativas por chamada do caminho Claude/Gateway. O relatório não inventa esses números.
2. **Mecanismo de alto consumo confirmado:** para `N` painéis não cacheados, o caminho normal realiza `N` chamadas de visão; com `N=437`, isso é uma ordem de grandeza de 437 chamadas, não uma suposição de “uma chamada por painel” feita apenas a partir do número de painéis — é o limite de código da implementação atual, condicionado ao cache e ao primeiro provider bem-sucedido (`narrative-analyzer.ts:337-385`, `aethera-ipc.ts:5482-5521`).
3. **Multiplicação por fallback confirmada:** a cadeia de providers não recebe `maxAttempts` no Recap Desktop; em falhas, pode tentar os providers disponíveis em sequência. Se o Router não obtiver análise, ainda pode tentar `describe` (`vision-router.ts:312-359`, `recap-vision-adapter.ts:640-677`).
4. **Desperdício de contexto confirmado:** cada análise envia um prompt de sistema longo, o índice/total, OCR auxiliar, resumo anterior e personagens conhecidos; o resumo de personagens é reconstruído percorrendo todos os resultados anteriores (`narrative-analyzer.ts:362-379`, `recap-vision-adapter.ts:208-221`, `claude-vision-provider.ts:47-78`). O adapter limita parte desse contexto a oito personagens e 220 caracteres por campo, mas ainda o repete em cada painel.
5. **Cache inadequado confirmado:** o cache persistente omite dimensões importantes — prompt, preprocessing, schema, locale e fingerprint de contexto — e existe um fallback por `imageHash` puro. O Router recebe o hash constante `recap-panel`, e seu cache no Desktop é apenas um `Map` em memória (`checkpoint-persistence.ts:13-23`, `narrative-analyzer.ts:343-386`, `recap-vision-adapter.ts:392`, `aethera-ipc.ts:5546-5550`).
6. **Custo apresentado como zero sem provar custo zero:** Claude e Claude Gateway são registrados com `costPerImageUsd: 0`; o Recap Vision Adapter também grava `costUsd: 0`, sem extrair eventos de uso do adapter CLI (`aethera-ipc.ts:5492-5518`, `recap-vision-adapter.ts:401-419`, `claude-vision-provider.ts:217-249`). Isso impede distinguir API paga, quota de CLI e inferência local.
7. **Humanização pode ser mais cara que o necessário:** no caminho Desktop, o Humanizer é habilitado sempre que a porta é construída; ele faz uma chamada textual por cena válida, com concorrência 4. Se configurado, o Claude Gateway, rotulado como Opus 5.5, aparece antes de Claude e Codex na porta textual (`aethera-ipc.ts:5568-5689`, `narrative-humanizer.ts:320-449`, `aethera-ipc.ts:5934-5945`).
8. **Gargalo local confirmado:** a renderização gera cada shot sequencialmente com `libx264`, concatena, mixa áudio e depois repete uma renderização separada para master. Preview e master usam diretórios/checkpoints diferentes, portanto o reaproveitamento entre os dois é limitado (`recap-mp4-renderer.ts:457-534`, `phase5/recap-production-orchestrator.ts:630-770`).
9. **Riscos de fidelidade confirmados:** a entrada Desktop força `readingOrder: 'vertical'` tanto na produção quanto no master; diretórios de imagens não são ordenados no importer. Isso pode alterar a ordem de manga RTL (`aethera-ipc.ts:5867-5872`, `5997-6004`, `chapter-importer.ts:164-174`).
10. **Gate de aprovação incompleto:** o renderer calcula Gate I e Gate J, mas o orquestrador só bloqueia por Gate H; um `fail` de ordem/alinhamento semântico ou voz pode não impedir a aprovação master (`recap-mp4-renderer.ts:698-731`, `phase5/recap-production-orchestrator.ts:687-735`).

### Decisão recomendada

Priorizar, nesta ordem, instrumentação/budget por chamada, cache content-addressed correto, triagem barata/local e redução do Humanizer; depois corrigir ordem/checkpoints e só então otimizar render. Isso reduz chamadas de IA drasticamente sem remover a análise de painéis que sustentam a fidelidade narrativa.

## 2. Método, limites e status de evidência

### Procedimentos executados

- Confirmada a disponibilidade da skill local `video-pipeline-auditor` e lido o módulo `Token & Inference Budget Auditor`.
- Lidos somente entrypoints e dependências diretas do Recap, precedidos por buscas `rg` direcionadas.
- Inspecionados código, contratos, checkpoints, testes/documentação existente e migrations de telemetria.
- Verificado que `docs/audits/recap-pipeline-audit.md` não existia antes da auditoria.
- Verificado o commit-base e o estado inicial do worktree.

### Procedimentos deliberadamente não executados

- Nenhuma chamada externa de IA.
- Nenhuma análise de imagem, painel, PDF, CBZ ou vídeo.
- Nenhum processamento dos 437 painéis.
- Nenhum teste que possa iniciar CLI real ou consumir quota.
- Nenhuma renderização FFmpeg/MotionVelix/Remotion.
- Nenhuma alteração de código, configuração, teste ou artefato existente.
- Nenhum subagente/modelo adicional.

### Níveis de evidência usados

- **Confirmado:** comportamento diretamente observável no código/configuração analisado.
- **Histórico/documental:** declarado em documentação ou teste, mas não verificado nesta execução.
- **Hipótese:** consequência plausível que depende do provider, configuração, artefato ou log do incidente.
- **Não medido:** não há telemetria ou artefato suficiente; não foi estimado artificialmente.

## 3. Mapa completo do pipeline Recap

| Etapa | Entrypoints/componentes | Saída | Perfil de consumo |
|---|---|---|---|
| Aquisição local | `aethera-ipc.ts:5840-5885`, `chapter-importer.ts:149-223` | páginas normalizadas e metadados | CPU, disco, memória; sem IA |
| Aquisição por URL | `url-importer/batch-import-queue.ts:82-420`, `url-chapter-importer.ts:494-620`, `apps/aethera-remote-host/src/recap-url-import-routes.ts:92-320` | imagens baixadas/CBZ, progresso e checkpoint | rede, disco, retries; sem IA de conteúdo |
| PDF | `pdf-import-adapter.ts:11-98`, chamado pelo importer | PNG por página a 200 DPI | memória do PDF inteiro, CPU, disco |
| Classificação de ordem | `chapter-importer.ts:25-31`, `aethera-ipc.ts:5867-5872` | `rtl`, `ltr` ou `vertical` | determinístico; risco narrativo por configuração |
| Extração de painéis | `panel-extractor.ts:93-168`, `224-323` | crops PNG, bounding boxes, classificação heurística, SHA-256 | CPU O(pixels), RAM temporária, I/O; OCR opcional |
| OCR | `panel-extractor.ts:273-290`, adapter Tesseract | `ocrText`, confiança/status | CPU; uma passagem por painel se habilitado |
| Gate F | `gate-f-panel-integrity.ts`, `aethera-ipc.ts:5886-5906` | integridade, avisos e decisão | determinístico |
| Ordenação narrativa | `narrative-analyzer.ts:62-99` | sequência por página/posição | CPU; preserva ordem somente se input estiver ordenado |
| Análise visual | `narrative-analyzer.ts:285-425`, `recap-vision-adapter.ts`, `claude-vision-provider.ts`, `vision-router.ts` | `PanelAnalysis` por painel | principal consumidor de IA; default de concorrência 1 |
| Cache/checkpoint de visão | `checkpoint-persistence.ts`, callback em `story-engine.ts:164-181` | `panelAnalyses`, `analysisCacheByHash` | I/O crescente; sem tokens/custo/attempts |
| Continuidade | `story-continuity-engine.ts`, `story-memory.ts` | beats, personagens, transições | determinístico/local; memória opcional |
| Pesquisa contextual | `contextual-research.ts:295-380` | referências filtradas | opcional; uma chamada de pesquisa se explicitamente injetada |
| Roteiro determinístico | `script-generator.ts` | `RecapScript`, cenas e duração estimada | local |
| Refinamento textual | `script-generator.ts:809-913`, portas em `aethera-ipc.ts:5568-5689` | narração por cena | 0 no caminho Desktop normal antes do Gate G; fallback sob falha |
| Gate G | `gate-g-narrative-fidelity.ts`, `story-engine.ts:331-457` | fidelidade, ordem, invenção e `needs_review` | local; pode disparar até duas passagens de fallback textual |
| Humanizer | `narrative-humanizer.ts:283-512` | narração humanizada ou reversão por cena | uma chamada textual por cena elegível; concorrência 4 |
| TTS | `recap-tts-adapters.ts`, `aethera-ipc.ts:5702-5735` | WAV contínuo ou por cena | API/serviço local/SAPI; custo por caracteres/tempo não registrado no job |
| Auditoria de áudio | `recap-mp4-renderer.ts:271-339`, `recap-tts-adapters.ts` | duração, silêncio e segmentos aceitos | CPU/I/O local |
| Alinhamento semântico | `recap-semantic-alignment.ts:515-553`, `738-995` | beats alinhados, timestamps, Gate I/J | CPU e possivelmente endpoint local Whisper; sem custo contabilizado |
| Planejamento de timeline | `recap-visual-planner.ts:211-510` | shots, duração, motion, captions, SFX/VFX e ducking | determinístico/local |
| MotionVelix | `recap-motionvelix.ts`, `recap-visual-planner.ts:360-456` | filtros, motion styles, safe zones, SFX | CPU/FFmpeg; kit de SFX opcional |
| Remotion | infraestrutura genérica em `aethera-ipc.ts:657-808` | render de motion de outros fluxos | **não há chamada direta do Recap encontrada**; Recap usa `ffmpeg_motionvelix_hybrid` |
| FFmpeg | `recap-mp4-renderer.ts:457-657` | shots H.264, concat, mix AAC, MP4 final | CPU, disco e memória; execução sequencial |
| Gate H | `recap-gate-h-quality.ts:45-317` | cobertura, repetição, áudio, MP4 básico e risco de crop | local; `ffprobe` limitado |
| Gate I/J | `recap-semantic-alignment.ts:738-995` | ordem/alinhamento semântico e voz | local; não bloqueiam master no orquestrador atual |
| Preview e master | `recap-production-orchestrator.ts:616-825` | prévia para aprovação e master/release | renders separados; TTS/plano podem ser refeitos |
| Exportação | `exportRecapReleaseBundle`, `recap-project-store.ts` | MP4, ASS, script, plano, gates e manifesto | I/O; não há checksum/final decode completo |
| Job/resume | `recap-production-job-manager.ts`, `aethera-ipc.ts:6121-6133` | JSON de job, controle e retomada | persistência local; progresso por etapa/painel |

## 4. Auditoria de consumo de tokens e inferência

### 4.1 Métricas do incidente

| Campo exigido pelo Token & Inference Budget Auditor | Valor | Status |
|---|---:|---|
| `panels_total` | 437 | informado pelo usuário; não reprocessado nem validado contra artefato |
| `panels_unique` | `null` | não há inventário/hash do job no workspace |
| `panels_cached` | `null` | checkpoint do incidente não disponível |
| `panels_analyzed` | `null` | sem ledger do job |
| `model_calls` | `null` | não persistido no Recap |
| `input_tokens` | `null` | provider Claude/Gateway não expõe no Recap |
| `output_tokens` | `null` | idem |
| `cache_read_tokens` | `null` | idem |
| `cache_write_tokens` | `null` | idem |
| `estimated_cost` | `null` | `costPerImageUsd` é zero, não custo real |
| `quota_events` | `null` | só há classificação de erro/circuit breaker, sem contador do job |
| `retry_calls` | `null` | tentativas não são agregadas por vídeo |
| `wall_time` | `null` | o caso de 437 não possui log no repositório |
| `stop_reason` | `null` | não há registro do incidente |

Há infraestrutura genérica de `token_analytics` para tarefas do TaskEngine (`packages/database/migrations/0006_token_analytics.sql`, `packages/orchestrator/src/analytics.ts`, `engine.ts:1164-1247`), mas ela não define uma relação Recap `runId/jobId/stage`. O caminho de visão do Desktop usa `createClaudeVisionProvider` diretamente; portanto, seus eventos não são transformados em `token_analytics`. O Humanizer pode passar pelo TaskEngine fallback, mas continua sem correlação com o vídeo.

### 4.2 Contagem de chamadas: limites de código, não medição do incidente

Defina:

- `N = 437` painéis informados;
- `H` = hits de cache válidos, desconhecido;
- `U = N - H` = painéis que precisariam de análise nova;
- `P` = número de providers multimodais realmente registrados, `1 ≤ P ≤ 4`;
- `S` = número de cenas elegíveis para Humanizer;
- `R` = número de cenas selecionadas pelos hints do Gate G.

**Visão, caminho de sucesso:**

- `U` chamadas de análise se o primeiro provider disponível responder com sucesso por painel.
- O provider Claude e o Gateway estão explicitamente limitados a uma imagem por chamada (`maxImagesPerCall: 1`). O adapter passa apenas `frames[0]`, portanto não há batching efetivo nesse caminho.
- Se o primeiro provider falhar, o Router pode tentar até `P` providers porque o Recap Desktop não configura `maxAttempts`.
- Se nenhuma análise estruturada retornar valor e ainda houver provider disponível, o adapter chama `describe`; em uma falha completa, o número de tentativas pode chegar a aproximadamente `2 × P` por painel, condicionado aos circuitos e à configuração.

**Texto, caminho Desktop atual:**

- A produção injeta `scriptFallbackPort`, não `scriptPort`; logo a geração inicial é determinística e não faz uma chamada textual por cena no caminho normal.
- Humanizer: até `S` invocações lógicas de `enhance`, em paralelo até quatro por vez. Não há cache textual por hash da cena.
- Gate G: até duas passagens de fallback, cada uma limitada às cenas indicadas; teto lógico de `2 × R` invocações adicionais.
- Cada invocação textual pode tentar Gateway, Claude, Codex e, após falha desses, o adapter TaskEngine com Claude/Codex. Em termos de tentativas de provider, o máximo condicional é cinco por invocação quando todos estão configurados; não significa cinco chamadas em uma execução bem-sucedida.

**Conclusão quantitativa:** 437 painéis não provam 437 chamadas, mas a implementação atual tem 437 chamadas de visão como cenário de primeira ordem quando o cache não possui hits e o primeiro provider responde. O número real do incidente só pode ser obtido adicionando ou recuperando telemetria por chamada.

### 4.3 Causa raiz do consumo excessivo

**Não confirmada retrospectivamente.** Faltam o checkpoint/ledger e a saída de uso da janela de cinco horas. Não é possível afirmar se o limite foi consumido por Opus, Claude Code, Gateway, retries, outros chats ou uma combinação.

**Contribuintes confirmados pelo código:**

1. Análise visual individual, sem batching efetivo no caminho Claude/Gateway.
2. Cache de processo não durável no VisionRouter Desktop.
3. Cache persistente com chave insuficiente e fallback por hash puro.
4. Contexto narrativo reserializado em cada painel.
5. Humanizer textual por cena, habilitado no fluxo Desktop quando a porta é construída.
6. Fallback textual potencialmente multiplicado por provider.
7. Ausência de orçamento de tokens/custo real por job; o orçamento de USD não funciona quando providers têm custo declarado zero.
8. Regeneração de cena cria novo checkpoint com timestamp e pode perder o cache de análises anterior; isso faz uma operação chamada de “regenerate scene” reanalisar os painéis da cena (`aethera-ipc.ts:6212-6240`).

**Hipóteses que exigem logs:**

- Claude foi o primeiro provider efetivamente disponível em todos os painéis.
- Claude Gateway/Opus foi usado no Humanizer.
- Houve reexecução após interrupção, regeneração ou invalidação de cache.
- O provider contou todo o prompt de sistema/contexto como entrada sem cache interno.
- Houve falhas ou timeouts que acionaram fallback.

### 4.4 Estimativa de desperdício de tokens

Não há tokens observados, portanto não é legítimo informar “X tokens desperdiçados”. A estimativa auditável é estrutural:

| Fonte de repetição | Quantidade estrutural | Premissa |
|---|---:|---|
| Prompt de visão fixo | `U` reenvios | um prompt por painel não cacheado |
| Contexto de obra/índice/ordem | `U` reenvios | contexto é montado por painel |
| Resumo anterior/OCR/personagens | até `U` reenvios | depende de dados presentes; campos são truncados no adapter |
| Humanizer | até `S` chamadas | cenas factuais e porta disponível |
| Fallback Gate G | até `2R` chamadas | Gate G reprova e aponta cenas |
| Retries por provider | até `P` tentativas por unidade | falhas e providers registrados |
| Repetição após cache perdido | `U` chamadas novamente | novo checkpoint, chave incompatível ou cache invalidado |

Para transformar isso em tokens, cada evento precisa registrar `input_tokens`, `output_tokens`, `cached_tokens`, `prompt_version`, `model`, `provider`, `cache_hit` e `attempt`. Sem esses campos, qualquer número seria inferência indevida.

Como referência histórica, o plano documenta uma execução de **4 imagens reais em 201,8 s, aproximadamente 33 s por painel**, com Claude Opus 5.5 (`docs/plans/aethera-recap-master-plan.md:142-151`). Isso não é benchmark do caso de 437 nem medição atual. Se essa taxa permanecesse linear, `437 × 33 s = 14.421 s`, aproximadamente 4 horas, seria apenas uma extrapolação de planejamento; não deve ser apresentada como duração observada.

## 5. Achados classificados por severidade

### P1 — impacto potencial em quota, fidelidade, retomada ou publicação

| ID | Achado confirmado | Evidência | Impacto |
|---|---|---|---|
| P1-01 | Ordem de leitura forçada para `vertical` na produção e no master | `apps/aethera-desktop/src/main/aethera-ipc.ts:5867-5872`, `5997-6004` | Manga RTL pode ser narrada/renderizada fora de ordem; Gate posterior não corrige uma importação já ordenada incorretamente |
| P1-02 | Cache de visão não é suficientemente content/context addressed | `checkpoint-persistence.ts:13-23`; `narrative-analyzer.ts:343-386`; `recap-vision-adapter.ts:392`; `aethera-ipc.ts:5546-5550` | Pode tanto perder hits e reprocessar como reutilizar análise em contexto/modelo inadequado; colisão concreta depende do dataset/configuração |
| P1-03 | Gate I/J é calculado, persistido e não governa aprovação master | `recap-mp4-renderer.ts:698-731`; `phase5/recap-production-orchestrator.ts:687-735` | Vídeo pode avançar com falha semântica, ordem fora do esperado ou inconsistência de voz se Gate H passar |
| P1-04 | Áudio/checkpoint não é vinculado ao hash do script, voz, modelo ou provider | `recap-mp4-renderer.ts:271-276` | Após regenerar roteiro/voz, WAV antigo pode ser aceito apenas porque existe e tem contagem compatível; risco de áudio narrar texto diferente do script |
| P1-05 | `-shortest` pode encerrar o MP4 no stream menor e a validação aceita tolerância de 500 ms | `recap-mp4-renderer.ts:614-657`; `recap-gate-h-quality.ts:211-231` | Pequenos truncamentos ou divergências de PTS podem escapar; não há decode completo nem validação do último frame/áudio |
| P1-06 | Regeneração de cena usa checkpoint novo e pode reanalisar a cena inteira | `aethera-ipc.ts:6212-6240` | Reparo editorial pode consumir visão novamente e contrariar a expectativa de “script-only”/reparo barato |

### P2 — custo, performance, observabilidade ou estabilidade

| ID | Achado confirmado | Evidência | Impacto |
|---|---|---|---|
| P2-01 | Tokens, custo, cache read/write e chamadas não aparecem no Recap record | `recap-production-orchestrator.ts:92-123`; `recap-types.ts:111-129`; `recap-vision-adapter.ts:386-419` | Impossível explicar quota, comparar providers ou exibir custo por vídeo |
| P2-02 | `costPerImageUsd: 0` para Claude/Gateway desativa o orçamento monetário | `aethera-ipc.ts:5492-5518`; `vision-router.ts:398-404` | Router pode exceder qualquer quota real porque o budget vê custo zero; zero é ausência de preço, não custo zero |
| P2-03 | Checkpoint completo é serializado e renomeado a cada painel | `story-engine.ts:164-181`; `checkpoint-persistence.ts:74-84` | Escrita e `JSON.stringify` crescem com o número de análises; para centenas de painéis há write amplification e pressão de disco/CPU |
| P2-04 | Contexto de personagens é reconstruído percorrendo todos os painéis anteriores | `narrative-analyzer.ts:362-367` | CPU O(n²) e repetição de contexto; o adapter corta a saída para oito personagens, mas não elimina o trabalho nem os campos recorrentes |
| P2-05 | Humanizer por cena sem cache/deduplicação e possível Gateway/Opus como primeira escolha | `aethera-ipc.ts:5585-5593`, `5621-5679`; `narrative-humanizer.ts:320-449` | Consumo textual alto, concorrência 4 e possível uso de modelo premium em texto que já foi validado pelo Gate G |
| P2-06 | Preview e master têm output/checkpoint separados | `phase5/recap-production-orchestrator.ts:630-642`, `764-775` | TTS, plano, shots e encode podem ser refeitos; custo de CPU/API não é compartilhado de forma confiável |
| P2-07 | Shots são codificados sequencialmente em `libx264` | `recap-mp4-renderer.ts:457-520` | Gargalo CPU; nenhuma seleção de encoder GPU ou paralelismo de shots foi encontrada no caminho Recap |
| P2-08 | Hash de shot inclui caminho, não hash dos bytes da imagem, áudio/captions ou versão do renderer | `recap-mp4-renderer.ts:137-159` | Pode reutilizar clip obsoleto se o arquivo for substituído no mesmo caminho ou se entradas semânticas mudarem |
| P2-09 | Checkpoint de Phase 3 faz parse sem schema/hash e falha silenciosamente para estado vazio | `recap-mp4-renderer.ts:57-64` | Corrupção ou mudança de contrato pode causar rerender caro ou reaproveitamento indevido |
| P2-10 | Arquivos temporários de Buffer de visão não têm limpeza no adapter | `recap-vision-adapter.ts:725-733` | Crescimento de disco ao longo de jobs/regenerações; item já reconhecido como pendência documental |
| P2-11 | Jobs de importação por URL no Remote Host ficam em `Map` em memória | `apps/aethera-remote-host/src/recap-url-import-routes.ts:92-105` | Reinício perde estado/SSE; retry zera `pagesDone` e pode refazer download (`:298-316`) |
| P2-12 | Fallback TTS trava no primeiro provider; falha posterior não troca de provider | `recap-tts-adapters.ts:334-369` | Preserva identidade vocal, mas reduz recuperação de falha durante o vídeo; pode interromper após áudio parcial |

### P3 — higiene e manutenção

| ID | Achado confirmado | Evidência | Impacto |
|---|---|---|---|
| P3-01 | Diretório de imagens é usado na ordem de `readdirSync`, sem `sortPageFiles` | `chapter-importer.ts:164-174` | Ordem depende do filesystem; em algumas plataformas pode ser estável por acaso, não por contrato |
| P3-02 | PDF inteiro é lido para Buffer e páginas são renderizadas sequencialmente a 200 DPI | `pdf-import-adapter.ts:41-98` | Pico de RAM e I/O em PDFs grandes; não é causa de quota, mas agrava tempo/estabilidade |
| P3-03 | Documentação histórica ainda descreve integração TaskEngine/Router de forma mais ampla que o wiring Desktop atual | `docs/plans/aethera-recap-master-plan.md:7`, `142-182`; `aethera-ipc.ts:5482-5557` | Pode induzir diagnósticos errados sobre qual adapter produz telemetria e qual provider foi usado |

## 6. Performance e custos por recurso

### CPU

- Detector de painéis calcula médias de todas as linhas e colunas em loops JavaScript sobre o raster (`panel-extractor.ts:93-168`).
- Cada crop relê a página e passa novamente pelo Sharp (`panel-extractor.ts:174-193`, `224-261`).
- OCR é sequencial por painel quando habilitado (`panel-extractor.ts:273-290`).
- Humanizer usa até quatro tarefas textuais simultâneas; isso reduz wall time mas pode concentrar quota e memória.
- FFmpeg reencoda cada shot com `libx264`; no master usa preset `medium`.

**Gargalos confirmados:** extração/crop/OCR em capítulos grandes, `JSON.stringify`/write do checkpoint incremental e encode de shots.

### GPU/VRAM

Não há medição de GPU/VRAM no caminho Recap analisado. O Router possui campo `vramMb` no contrato do provider, mas os providers do Desktop não o preenchem para Claude/Gateway. O FFmpeg Recap não seleciona encoder GPU. Portanto:

- GPU/V RAM real do incidente: **não medido**.
- Hipótese: visão remota/CLI não usa a GPU local do Aethera; FFmpeg local usa CPU por `libx264`.
- A infraestrutura genérica tem detecção NVENC no Remote Host, mas não foi ligada ao `recap-mp4-renderer.ts` nesta rota.

### RAM e disco

- PDF completo em memória (`pdf-import-adapter.ts:45`).
- Raster grayscale inteiro por página (`panel-extractor.ts:101-120`).
- Buffer de crop, escrita de PNG e leitura novamente pelo provider.
- Checkpoints JSON crescentes reescritos a cada painel.
- Temp `.recap-vision-tmp` sem política de retenção.
- Preview e master mantêm árvores distintas de áudio/shots/checkpoints.

### Rede

- URL importer tem concorrência limitada a 3 por padrão e até 6, com até 2 retries por página no importer interno (`url-chapter-importer.ts:511-605`).
- Remote Host URL importer processa páginas sequencialmente e não persiste o job (`recap-url-import-routes.ts:92-170`).
- Visão Claude/Gateway depende da rede/CLI, mas o Recap não registra bytes, latência agregada ou custo por request.
- TTS VoiceStudio/ElevenLabs também não registra consumo financeiro no job.

### Custos efetivos versus estimados

| Categoria | Estado atual |
|---|---|
| API/CLI de visão | cobrança efetiva não observável; `costPerImageUsd=0` e sem usage no Recap |
| Quota Claude/Opus | pode ser consumida, mas o job só registra provider/modelo/attempts parciais, não tokens |
| Text agents | TaskEngine genérico pode registrar tokens, mas não há vínculo com `runId`/cena Recap |
| TTS | provider/voice/duração são retornados; preço por caractere/segundo não é registrado |
| Whisper/local | processamento local ou endpoint; custo/tempo não é atribuído ao vídeo |
| CPU/FFmpeg | custo local não medido: sem duração CPU, pico RAM, disco, energia ou encoder efetivo no registro |
| Rede/download | páginas/retries existem, mas bytes/tempo/custo não entram no release manifest |

## 7. Qualidade do vídeo e estabilidade

### Garantias existentes

- Gate F verifica integridade dos painéis antes da visão.
- Ordenação narrativa é determinística quando `pageNumber`, `panelIndex` e `readingOrder` estão corretos.
- Gate G verifica fidelidade, eventos inventados, repetição e ordem do roteiro.
- Planner é Audio-First e usa duração medida do TTS quando disponível (`recap-visual-planner.ts:243-276`).
- Gate H verifica clipping lógico, lacunas visuais, repetição consecutiva, ordem de cenas, legibilidade de balões, arquivos de imagem, presença de áudio/vídeo e duração aproximada.
- Gate I verifica ordem de painel, freezes, cauda silenciosa e alinhamento semântico (`recap-semantic-alignment.ts:738-844`).
- Gate J verifica troca de provider/voz, clipping PCM, saltos de volume/timbre e sample rate (`recap-semantic-alignment.ts:844-995`).
- Job manager persiste jobs, pausa/cancelamento em pontos seguros e recuperação após reinício (`recap-production-job-manager.ts:317-575`).
- Import jobs por URL do Cinema têm checkpoint atômico e restauração (`batch-import-queue.ts:132-176`, `import-checkpoint-store.ts:43-160`).

### Lacunas de qualidade confirmadas

1. A ordem pode estar errada antes de Gate I por `vertical` forçado ou diretório não ordenado.
2. Gate I/J não bloqueiam o master; apenas Gate H é consultado pelo orquestrador.
3. `ffprobe` confirma apenas presença de streams, duração e sample rate; não valida decodificação completa, PTS/DTS, frames finais, black/freeze frames, SAR/DAR, codec/profile, checksum ou integridade do container.
4. `-shortest` e tolerância de 500 ms deixam uma faixa de truncamento/defasagem sem bloqueio.
5. O checkpoint de áudio não é ligado ao conteúdo do roteiro; uma alteração textual pode não invalidar WAV existente.
6. O hash de shot não inclui bytes da imagem nem todas as entradas de mídia; há risco de clip stale.
7. TTS contínuo, quando falha, registra o erro mas não tenta automaticamente uma versão chunked; o job pode falhar mesmo havendo um modo alternativo tecnicamente possível (`recap-mp4-renderer.ts:278-339`).
8. MotionVelix visual é aplicado por filtros FFmpeg e é reportado; o kit de SFX pode estar ausente e o Gate H trata isso como aviso/risco conforme o plano. Não há evidência nesta auditoria de render real do caso de 437.

### Resiliência e retomada

**Fortes:** jobs de produção são persistidos em JSON, há `recoverOnStartup`, limite de tentativas de recuperação, circuit breaker por provider e checkpoint por painel.

**Fracas:**

- Circuit breaker do Recap é um objeto em memória do processo (`aethera-ipc.ts:3843`); a persistência de quota depende de cache de health separado e não de um ledger de consumo.
- Checkpoint inválido é tratado como “começar do zero” (`checkpoint-persistence.ts:87-100`), sem diferenciar corrupção, incompatibilidade de versão ou ausência.
- Checkpoint de visão guarda `z.any()` para análises/cache e não guarda tentativas, usage, provider efetivo, prompt/model version, custo ou erro por painel (`recap-types.ts:111-129`).
- Interrupção segura ocorre antes de cada novo painel, mas o callback grava o estado completo; retomada é funcional, porém cara em I/O.
- Regeneração de script/cena pode perder cache contextual e reexecutar visão.

## 8. Estratégia para reduzir drasticamente chamadas sem perder fidelidade

### Regra de decisão proposta

Preservar a análise de todos os painéis como evidência, mas não usar o mesmo modelo/custo em todos os painéis. A fidelidade deve ser protegida por validação estruturada e amostragem de revisão, não por enviar todos os painéis ao modelo premium.

1. **Pré-processamento local obrigatório:** normalizar ordem, deduplicar por SHA-256 do crop, detectar páginas/painéis, OCR local e eliminar chamadas repetidas para pixels idênticos.
2. **Triage econômico/local:** usar heurística/OCR e, quando disponível, VLM local barato para classificar `dialogue`, `new_character`, `action`, `transition`, `low_confidence` e `needs_context`.
3. **Análise premium seletiva:** enviar ao modelo caro apenas painéis de diálogo, primeira aparição de personagem, baixa confiança, transição ambígua, mudança de cenário/ação e amostra de QA. Painéis simples podem receber uma descrição determinística/local validada.
4. **Contexto em estado compacto:** substituir a lista cumulativa por um resumo fixo de entidades/eventos, com fingerprint estável. O painel recebe apenas os personagens relevantes e o beat anterior, não todo o histórico reconstruído.
5. **Batching por provider:** usar lotes somente onde o provider declara `maxImagesPerCall > 1`; para Claude/Gateway atuais, manter uma imagem por chamada, mas agrupar trabalho no nível de fila e aproveitar cache. O contrato deve impedir implicitamente qualquer falsa promessa de lote.
6. **Cache persistente correto:** chavear por `content_sha256`, crop/bounding box, preprocessing, prompt, schema, locale, model, provider policy e fingerprint de contexto. Deduplicar chamadas in-flight para o mesmo key.
7. **Modelo premium como escalonamento:** reservar Claude Gateway/Opus para baixa confiança ou revisão, nunca como primeira escolha automática do Humanizer. Humanizer deve ser opt-in ou limitado a cenas sinalizadas pelo Gate G.
8. **Roteiro determinístico primeiro:** manter `script-generator` como base factual. Chamar texto somente para cenas com issue explícito e passar apenas o contexto da cena, com cache por `scriptBaseHash + sceneId + style + promptVersion`.
9. **Budget stop real:** antes de cada chamada, consultar tokens/custo acumulados e reservar o budget; ao atingir limite, pausar o job com painel pendente e não iniciar cascata adicional.
10. **TTS e render incremental:** chavear áudio por texto/voz/modelo/provider/idioma; compartilhar audio/plan/shots entre preview e master e reencodar somente o que mudou.

## 9. Proposta de contabilização de custo por vídeo

### Evento canônico

Criar um evento imutável por operação, associado a `runId` e `jobId`:

```text
recap_usage_event {
  schemaVersion,
  runId, jobId, chapterId, stage, unitId, attempt,
  operation, provider, backend, model, promptVersion, schemaVersion,
  cacheKey, cacheStatus,
  inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
  inputChars, outputChars, imageCount, imageBytes,
  durationMs, cpuMs, peakRssMb, gpuMs, peakVramMb, readBytes, writeBytes,
  apiCostUsd, estimatedCostUsd, currency,
  quotaUnits, billingSource, usageSource,
  status, errorCode, startedAtIso, finishedAtIso
}
```

Campos desconhecidos devem permanecer `null`, nunca zero. `0` só significa zero comprovado.

### Camadas de custo

1. **Realizado:** valor fornecido pela API/TTS, invoice/usage endpoint ou evento do provider.
2. **Estimado:** tarifa versionada × tokens/caracteres/segundos/imagens observados, com `priceSheetVersion`.
3. **Quota:** tokens/requests de CLI quando a cobrança financeira não está disponível; exibir como consumo de quota, não como USD.
4. **Local:** CPU/tempo, RAM, disco, rede e GPU; converter para custo opcional por perfil da máquina, mantendo as métricas físicas separadas.

### Tela futura por vídeo

Exibir no projeto:

- total: custo realizado, custo estimado, quota consumida e “não medido”;
- tabela por etapa: import, OCR, visão, continuidade/roteiro, Humanizer, TTS, alinhamento e render;
- chamadas: tentadas, sucesso, fallback, retry, cache hit/miss;
- modelo/provider efetivo, não somente o provider configurado;
- tokens input/output/cache e fonte da medição;
- tempo e recursos locais;
- alertas de budget antes de iniciar uma etapa;
- botão de exportar JSON/CSV redigido, sem prompt completo, imagens ou credenciais.

O `RecapOrchestratorRecord` deve receber somente agregados seguros; os eventos detalhados devem ficar em tabela/arquivo append-only. O `TaskEngine` precisa aceitar `parentRunId`/`correlationId` para que chamadas textuais não fiquem isoladas em analytics genéricos.

## 10. Plano de refatoração priorizado

| Ordem | Lote | Impacto | Risco | Esforço |
|---:|---|---|---|---|
| 0 | Instrumentação e budget: eventos por chamada, correlação `runId/jobId`, tokens/custo/null semantics, limite por etapa e stop antes de fallback | muito alto | médio | médio |
| 1 | Cache correto: hash de conteúdo real, prompt/schema/preprocessing/context fingerprint, dedup in-flight, cache persistente e invalidação explícita | muito alto | médio | médio |
| 2 | Redução de IA: triage local, escalonamento por confiança, batch onde suportado, resumo compacto e Humanizer opt-in/targeted | muito alto | médio/alto | alto |
| 3 | Correção de ingestão: respeitar ordem declarada/detectada, ordenar diretórios, persistir `sourceHash` do archive e testar RTL/vertical | alto | baixo | baixo/médio |
| 4 | Checkpoint delta/idempotência: append por painel ou chunks, script/áudio/plan hashes, schema/version validation e motivo de reset | alto | médio | médio |
| 5 | Qualidade de publicação: Gate I/J bloqueantes, validação FFmpeg completa, checksum, PTS/DTS, frames finais e `audio/video duration` por política | alto | médio | médio |
| 6 | Reuso preview/master: compartilhar TTS/plano/shots por content hash e somente trocar preset/encode final | alto | médio | médio |
| 7 | Render performance: medir CPU/RAM/GPU, opção NVENC/hardware validada, paralelismo limitado de shots e evitar reencode desnecessário | médio/alto | alto | médio/alto |
| 8 | Resiliência URL/remote: persistir jobs no Remote Host, retomar páginas já baixadas, retry por item sem zerar progresso e expirar listeners | médio | médio | médio |

### Critérios de aceite para a próxima fase

- Um job sintético de 437 painéis, sem chamar provider, produz ledger com `model_calls=0` e `panels_cached=437`.
- Um job controlado com amostra pequena demonstra: cache miss, hit, retry, fallback, quota stop e retomada sem duplicar chamada.
- O ledger distingue `reported`, `estimated` e `not_measured`.
- A mesma sequência em RTL, LTR e vertical produz ordens verificáveis.
- Regenerar uma cena não chama visão para um painel cuja chave de conteúdo/contexto não mudou.
- Humanizer desligado, targeted e premium são escolhas explícitas, com chamada/custo visíveis.
- Gate I/J `fail` não permite master.
- Alterar texto, voz, provider ou modelo invalida áudio e plano relacionados.
- `ffmpeg -v error -i final.mp4 -f null -` e probes de streams/timing passam antes de release.

## 11. Arquivos e componentes que precisarão de alterações futuras

### Core Recap e contratos

- `packages/cinema/src/recap/recap-types.ts`
- `packages/cinema/src/recap/checkpoint-persistence.ts`
- `packages/cinema/src/recap/narrative-analyzer.ts`
- `packages/cinema/src/recap/story-engine.ts`
- `packages/cinema/src/recap/recap-vision-adapter.ts`
- `packages/cinema/src/recap/claude-vision-provider.ts`
- `packages/cinema/src/recap/contextual-research.ts`
- `packages/cinema/src/recap/script-generator.ts`
- `packages/cinema/src/recap/narrative-humanizer.ts`

### Ingestão e ordem

- `packages/cinema/src/recap/chapter-importer.ts`
- `packages/cinema/src/recap/pdf-import-adapter.ts`
- `packages/cinema/src/recap/panel-extractor.ts`
- `packages/cinema/src/recap/gate-f-panel-integrity.ts`
- `packages/cinema/src/recap/url-importer/batch-import-queue.ts`
- `packages/cinema/src/recap/url-importer/import-checkpoint-store.ts`
- `packages/cinema/src/recap/url-importer/url-chapter-importer.ts`
- `apps/aethera-remote-host/src/recap-url-import-routes.ts`

### Routing, providers e telemetria

- `packages/orchestrator/src/aethera/vision-router.ts`
- `packages/orchestrator/src/aethera/vision-providers.ts`
- `packages/orchestrator/src/analytics.ts`
- `packages/orchestrator/src/engine.ts`
- `apps/aethera-desktop/src/main/aethera-ipc.ts`
- `apps/aethera-desktop/src/main/vision-priority-store.ts`
- nova migration/repositório de uso Recap em `packages/database/migrations/`

### Audiovisual, gates e render

- `packages/cinema/src/recap/phase3/recap-audiovisual-types.ts`
- `packages/cinema/src/recap/phase3/recap-tts-adapters.ts`
- `packages/cinema/src/recap/phase3/recap-semantic-alignment.ts`
- `packages/cinema/src/recap/phase3/recap-visual-planner.ts`
- `packages/cinema/src/recap/phase3/recap-gate-h-quality.ts`
- `packages/cinema/src/recap/phase3/recap-mp4-renderer.ts`
- `packages/cinema/src/recap/phase3/recap-motionvelix.ts`
- `packages/cinema/src/recap/phase5/recap-production-orchestrator.ts`
- `packages/cinema/src/recap/phase5/recap-production-job-manager.ts`
- `packages/cinema/src/recap/phase5/recap-project-store.ts`
- `apps/aethera-desktop/src/renderer/src/RecapProductionPanel.tsx`

## 12. Matriz dos gates da auditoria

| Gate da skill | Resultado | Observação |
|---|---|---|
| G1 — source/inventory | PASS parcial | entrypoints e dependências relevantes identificados; não há artefato do incidente |
| G2 — ordering/identity | FAIL | ordem forçada `vertical`, diretório de imagens sem sort e cache com identidade incompleta |
| G3 — narrative grounding | PASS com risco | Gate G e OCR existem; qualidade real dos 437 painéis não foi reprocessada |
| G4 — visual/audio alignment | FAIL parcial | Gates I/J existem, mas não bloqueiam master; áudio checkpoint não usa hash de script |
| G5 — effects/motion | PASS parcial | MotionVelix/FFmpeg e safe zones existem; prova específica de 437 não existe |
| G6 — export integrity | FAIL parcial | `ffprobe` limitado; falta decode completo/checksum/PTS/final frame |
| G7 — resilience/resume | PASS parcial | job/checkpoints/circuit breaker existem; resets e cache inválido podem refazer trabalho |
| G8 — observability | FAIL | Recap não tem ledger de tokens, custo, retries e chamadas por vídeo |
| G9 — cost/resource | FAIL | custos declarados zero para Claude/Gateway e recursos locais não medidos |
| G10 — Token & Inference Budget Auditor | FAIL | não há budget efetivo por chamada, cache de tokens ou stop de quota no Recap |

## 13. Índice de evidências principais

- Importação e ordem: `packages/cinema/src/recap/chapter-importer.ts:25-31`, `149-223`; `apps/aethera-desktop/src/main/aethera-ipc.ts:5867-5872`, `5997-6004`.
- PDF/memória: `packages/cinema/src/recap/pdf-import-adapter.ts:41-98`.
- Extração/OCR: `packages/cinema/src/recap/panel-extractor.ts:93-168`, `224-323`.
- Cache/checkpoint: `packages/cinema/src/recap/checkpoint-persistence.ts:13-100`; `story-engine.ts:132-181`.
- Contexto/chamadas: `packages/cinema/src/recap/narrative-analyzer.ts:337-385`; `claude-vision-provider.ts:217-249`; `recap-vision-adapter.ts:386-419`.
- Routing/fallback/budget: `packages/orchestrator/src/aethera/vision-router.ts:303-432`; `apps/aethera-desktop/src/main/aethera-ipc.ts:5482-5557`.
- Humanizer/text fallback: `apps/aethera-desktop/src/main/aethera-ipc.ts:5568-5689`; `narrative-humanizer.ts:320-449`; `story-engine.ts:331-405`.
- Audio/timeline/render: `packages/cinema/src/recap/phase3/recap-mp4-renderer.ts:271-339`, `457-657`.
- Gates: `recap-gate-h-quality.ts:45-317`; `recap-semantic-alignment.ts:738-995`; orchestration `phase5/recap-production-orchestrator.ts:687-735`.
- Resilience: `packages/cinema/src/recap/phase5/recap-production-job-manager.ts:317-575`; `vision-circuit-breaker.ts:1-176`.
- Historical, não atual: `docs/plans/aethera-recap-master-plan.md:142-182`, `245-286`, `292-297`.

## Encerramento

Há evidência suficiente para iniciar um plano de correção focado em budget/telemetria, cache, triagem e idempotência. A auditoria foi encerrada sem executar o pipeline e sem modificar arquivos além deste relatório. Nenhuma correção foi implementada. A próxima ação requer aprovação do plano de refatoração, especialmente das mudanças de contrato de telemetria e da política de seleção de modelos.
