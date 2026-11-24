# Fase 4B.11 — Validação produtiva de capítulo completo

Data da execução: 2026-11-24  
Status: **análise visual 111/111; 31 painéis bloqueados reanalisados localmente e revisados de novo (ledger v2: 87 elegíveis, 1 só visual, 23 bloqueados); Story Engine segue bloqueado por strict fidelity**

## Escopo e segurança

- Dataset verificado: `C:\dev\neuralbridge-studio\tests\fixtures\real-manga\Nano-Machine-Capitulo-01.cbz`.
- Nenhum painel foi enviado ao Ollama nesta fase.
- Nenhum painel foi enviado ao PaddleOCR nesta fase.
- Não houve TTS, Humanizer, MotionVelix, FFmpeg ou renderização.
- Não houve chamada externa, cobrança de API ou fallback para Claude/Codex/Antigravity.
- O estado Git foi preservado; não houve reset, clean, checkout destrutivo, stash ou commit.

## Dataset e checkpoints históricos

O CBZ tem SHA-256 `968c652719f21f577ad6beaaccde1e38105cd29d761035124c46faac7be8aeaf`, igual aos dois manifests históricos:

- `.aethera-recap-data/phase4b5-qwen35-pilot-20261123/pilot-dataset-manifest.json`
- `.aethera-recap-data/phase4b9-qwen35-expansion-20261124/incremental-manifest-20.json`

Os artefatos confirmam 24 páginas, 111 painéis extraídos, 40 painéis no piloto inicial e 20 na expansão. A união contém 60 IDs únicos e deixa 51 painéis pendentes. O manifest inicial tem zero warnings e reading order `vertical`.

Os 60 arquivos de painel possuem ID, SHA-256, página, coordenadas, modelo, prompt, schema, preprocessing, cache version, contexto, blocos e uso. A identidade histórica é uniforme: `local-vlm | qwen3.5:4b-q4_K_M | local-panel-v3 | schema 1 | crop-v1 | recap-pilot-qwen35-structured-ocr-evidence-v1`.

Os IDs históricos `p0_0` foram reproduzidos; `p28_1`, `p58_12` e `p71_0` não foram reproduzidos e não foram tratados como equivalentes.

### Incompatibilidade que impede o cache hit produtivo

O caminho produtivo Desktop não lê `RecapPilotCheckpoints` nem os arquivos `qwen-cache/panels`; não há referência a esse contrato em `apps/aethera-desktop/src/main`. Ele usa o checkpoint do Story Engine e o cache de tiling do workspace. Além disso, o tiling produtivo usava `recap-production-tiling-v1`, enquanto os artefatos históricos usam `recap-pilot-qwen35-structured-ocr-evidence-v1`.

Portanto, os 60 resultados são compatíveis como evidência histórica, mas **não são automaticamente reutilizáveis pelo job produtivo**. Forçar um cache hit seria incorreto e poderia reprocessar os 60 painéis antes dos 51 pendentes. O impacto estimado seria até 111 análises, em vez de 51, violando a intenção do orçamento incremental; por isso nenhuma inferência foi iniciada.

## Pré-validação local

### Remote Host ao vivo

O serviço fonte subiu em `127.0.0.1:4848` depois da correção de import em `apps/aethera-remote-host/src/recap-url-import-routes.ts:11` (`@neuralbridge/cinema/recap` não era exportado; a entrada pública é `@neuralbridge/cinema`).

Resultados observados:

- `/api/health`: HTTP 200, `engineMode=monorepo_cinema`.
- Host: Windows x64, Node 24.17.0.
- GPU: NVIDIA GeForce RTX 4060 Ti, 8.188 MiB totais, 2.288 MiB usados no diagnóstico, driver 621.01.
- FFmpeg/ffprobe: disponíveis em `C:\ffmpeg\bin`.
- Ollama: disponível, modelos `qwen3.5:4b-q4_K_M` e `qwen2.5vl:3b`.
- Capacidade visual confirmada por `/api/show`: multimodal/vision, modelo selecionado Qwen3.5 4B.
- PaddleOCR: disponível, versão 3.7.0, execução preferencial em CPU.
- Worker: máximo concorrente 1; limite reportado 6.500 MiB.
- Telemetria declarada pelo host: tokens disponíveis; cache, custo efetivo, custo estimado e quota CLI permanecem `false`/desconhecidos.

O Remote Host foi encerrado após a validação; nenhum job foi submetido.

### Web ao vivo

O Web fonte subiu em `127.0.0.1:3000` e `/api/health` retornou HTTP 200. A interface abriu no browser, mas está no bootstrap de primeiro administrador. Criar uma conta exigiria inventar e persistir credenciais; isso não foi feito. Assim, a conexão autenticada Web → Remote Host e a navegação de job não foram declaradas como smoke test aprovado.

### Desktop

O único Desktop aberto é o build instalado `C:\Users\Pheli\AppData\Local\Programs\AetheraStudio\AetheraStudio.exe`. A interface observada é anterior ao caminho atual e exibe um projeto de 80 páginas, diferente do CBZ de 24 páginas usado nesta fase. Não foi fechado nem reutilizado para evitar interromper trabalho existente. Um Desktop fonte separado não foi iniciado porque o app instalado mantém o lock de instância e o código fixa o user data em `AetheraStudio` (`apps/aethera-desktop/src/main/index.ts:29`); iniciar outro processo poderia anexar-se ao job antigo.

## Fluxo produtivo auditado

O caminho estático confirmado é:

1. `importChapter` → extração determinística → Gate F em `apps/aethera-desktop/src/main/aethera-ipc.ts:5980-6034`.
2. `buildRecapVisionAdapter` → Ollama/VisionRouter/tiling em `apps/aethera-desktop/src/main/aethera-ipc.ts:5441-5670`.
3. `runRecapProductionOrchestrator` em `apps/aethera-desktop/src/main/aethera-ipc.ts:6026-6107`.
4. Story Engine, Gate G e Gates H/I/J em `packages/cinema/src/recap/phase5/recap-production-orchestrator.ts:775-1256`.

Confirmado no código:

- Tiling determinístico, sobreposição, cache por bloco e OCR seletivo.
- Ollama com capacidade multimodal validada por `/api/tags` e `/api/show`.
- SFX separado pelo filtro local em `packages/orchestrator/src/aethera/vision-providers.ts:117-365`.
- PaddleOCR complementar disponível quando `complementaryOcr` é habilitado (`aethera-ipc.ts:6011-6017`).
- Gates H/I/J são persistidos e considerados na aprovação master.
- Checkpoints atômicos e pausa `paused_budget` existem no orquestrador.

Corrigido nesta etapa no adapter produtivo:

- `NB_RECAP_PHASE_4B11` ativa Qwen3.5 4B, `think:false`, structured output, temperatura 0.2, uma imagem, stream desligado, contexto 4096, saída 560, nomes visual-only e SFX filter.
- `NB_RECAP_LOCAL_ONLY`/`NB_RECAP_PHASE_4B11` impedem a cadeia de providers externos para a execução controlada.
- Os limites locais de fase, quando ativados, são 51 painéis, 80 blocos, 100 chamadas, 15 OCR, 100.000 tokens de entrada, 40.000 de saída, 30 minutos, 2 fallbacks CPU e 6.500 MiB.

## Gate de fidelidade e Auto-Recovery

O `strictFidelity` agora exige um `RecapFidelityGateReport` evidence-backed e chama `canForwardToStoryEngine`; confiança do modelo ou schema válido não promovem painel. Isso está em `packages/cinema/src/recap/story-engine.ts:217-230`, com teste em `packages/cinema/test/recap-fidelity-gate.test.ts:177-187`.

Bloqueio produtivo confirmado: `executeRecapProduction` ainda não carrega um relatório independente para os 111 painéis nem o injeta em `panelFidelityGate`. Com `strictFidelity=true`, o Story Engine deve parar antes de gerar roteiro, conforme a regra de segurança. Com `strictFidelity=false`, haveria risco de contornar a fronteira narrativa; isso não foi feito.

Também não há chamada do `RecapFidelityRecoveryEngine` no caminho `executeRecapProduction`; o mecanismo existe como componente reutilizável, mas sua execução ainda é uma etapa de piloto/recovery, não uma etapa produtiva automática. Essa ausência deve ser resolvida antes de aprovar o capítulo completo.

## Orçamento — pré-estimativa, não consumo real

Estimativa estática para os 51 painéis restantes, usando os manifests e a telemetria histórica:

| Item | Estimativa | Limite |
|---|---:|---:|
| Painéis novos | 51 | 51 |
| Análises visuais Qwen | 51 | incluídas em 100 chamadas |
| OCR local complementar | até 15 | 15 |
| Chamadas Qwen totais | até 66 | 100 |
| Blocos | até 51 no manifest pendente; tiling sujeito à runtime | 80 |
| Entrada | aproximadamente 51.020 tokens de imagem/prompt; reserva conservadora até 94.000 | 100.000 |
| Saída | reserva de análise aproximadamente 28.560; OCR permanece dentro da margem somente se medido | 40.000 |
| Fallback CPU | 0 previsto; máximo 2 | 2 |
| Tempo | histórico de 20 painéis: ~632 s; extrapolação linear ~27 min, sem garantia | 30 min |
| VRAM | histórico observado até 6.171 MiB | 6.500 MiB |

Não houve consumo real nesta fase: chamadas Qwen = 0, tokens adicionais = 0, OCR real = 0, custo efetivo = 0, custo estimado realizado = 0 e quota CLI = 0. Valores de custo/telemetria não observados permanecem desconhecidos, não zero.

## Testes executados

- 46 testes direcionados Recap/tiling/budget/checkpoint/gate: **46 pass, 0 fail**.
- Teste novo de strict fidelity sem relatório independente: **pass**.
- Remote Host: **10 pass, 1 fail**. A falha preexistente é o teste RF-07 que espera 2 chamadas e observa 3 (`apps/aethera-remote-host/test/remote-host.test.ts:197-258`); não é causada pelo Recap nem pela correção de import.
- `npm run typecheck:desktop`: falha no baseline com módulos ausentes e erros antigos em vários subsistemas; o erro introduzido pela passagem de `model: undefined` foi corrigido. Permanecem erros preexistentes em `aethera-ipc.ts` e cinema/desktop.
- `git diff --check`: sem erro de whitespace; apenas avisos de normalização CRLF já existentes.

## Decisão da fase

**Não iniciar os 51 painéis.** O smoke test produtivo autenticado não foi aprovado e o caminho atual não consegue reutilizar de forma comprovada os 60 checkpoints históricos. Iniciar agora consumiria orçamento em painéis já analisados, poderia ultrapassar o limite incremental e chegaria ao bloqueio de strict fidelity sem relatório independente.

## Pendências para retomar

1. Integrar o contrato de checkpoint/painel do piloto ao cache persistente do caminho produtivo, com validação de identidade e sem copiar ou alterar os artefatos históricos.
2. Fazer o job produtivo aceitar o relatório de fidelidade independente para exatamente os 111 IDs, ou executar a auditoria independente antes do Story Engine.
3. Integrar o Auto-Recovery Engine ao job produtivo com orçamento compartilhado e checkpoint.
4. Executar smoke test autenticado no build fonte Desktop/Web com o Remote Host, sem o build instalado antigo.
5. Só então realizar a execução incremental dos 51 painéis, com o orçamento acima e pausa segura em qualquer gate.

## Situação Git

O worktree permanece sujo por trabalho prévio de Claude/Codex e outras fases. Não houve descarte nem commit automático. A correção desta fase adicionou apenas o import público do Remote Host, controles do adapter produtivo, a exigência evidence-backed do strict fidelity já integrada e seu teste; os demais arquivos modificados pertencem ao estado anterior e foram preservados.

## Atualização de integração — 24/11/2026

Esta atualização não executou inferência, OCR real, TTS, MotionVelix, FFmpeg ou renderização.

### Histórico no caminho produtivo

O Desktop fonte agora resolve o diretório histórico por identidade antes de iniciar o orquestrador (`apps/aethera-desktop/src/main/aethera-ipc.ts:6075-6115`). A resolução é somente leitura e classifica cada artefato como `compatible`, `migratable`, `incompatible`, `corrupted` ou `missing`, validando SHA-256, schema e identidade do painel. Somente resultados válidos são adaptados ao contrato `PanelAnalysis` e enviados como cache histórico; os arquivos originais não são sobrescritos. A implementação está em `packages/cinema/src/recap/historical-checkpoint-cache.ts`.

### Progresso incremental de fidelidade

Foi adicionado `packages/cinema/src/recap/fidelity-progress.ts` e sua exportação pública. O orquestrador grava atomicamente `<project>/fidelity/fidelity-progress.json` a cada persistência, distinguindo `pending_analysis`, `unverified`, `needs_review`, `verified` e `rejected`. Elegibilidade narrativa e evidência independente são campos separados; análise de modelo, schema válido ou cache hit não promovem painel para `verified`. A execução estrita continua bloqueada sem `RecapFidelityGateReport` evidence-backed.

### Validação executada

- `npx tsx --test packages/cinema/test/recap/historical-checkpoint-cache.test.ts packages/cinema/test/recap/fidelity-progress.test.ts`: **4 pass, 0 fail**.
- `npm run build:aethera`: **pass**; 1.093 módulos main e 2.646 módulos renderer transformados. Permanecem apenas avisos de comentários `@__PURE__` do zod.
- A pré-validação do Desktop fonte confirmou importação do CBZ de 24 páginas e a tela de configuração local; nenhum job de análise foi iniciado.
- O servidor Ollama local respondeu `/api/tags` com `qwen3.5:4b-q4_K_M` e `qwen2.5vl:3b`; isso é disponibilidade, não validação de inferência nesta etapa.

### Bloqueios ainda verdadeiros

O fluxo produtivo ainda não gera automaticamente um relatório independente de fidelidade para os 111 painéis, portanto `strictFidelity` deve bloquear antes do roteiro até que esse relatório seja fornecido. O Auto-Recovery Engine permanece reutilizável, mas não é disparado automaticamente pelo `executeRecapProduction`; ativá-lo sem um gate independente criaria risco de transformar correções não verificadas em fatos narrativos. O smoke test autenticado Web → Remote Host também permanece pendente.

### Decisão atual

**Não processar os 51 painéis.** O cache histórico e o progresso incremental estão integrados, mas a validação produtiva completa continua condicionada ao smoke test autenticado e à injeção de evidências independentes no gate estrito. Nenhum custo, token ou chamada de IA foi consumido por esta atualização.

## Atualização de continuidade — smoke produtivo e correção do caminho histórico (24/11/2026)

### Skills e protocolo

As skills `video-pipeline-auditor` e `Token & Inference Budget Auditor` foram verificadas uma única vez nesta sessão e não estavam disponíveis no catálogo local. Foi aplicado o protocolo equivalente documentado no relatório: análise incremental, orçamento persistente, ledger, checkpoints, validação independente e separação entre gates. Não houve chamadas externas de IA.

### Falha inicial e causa confirmada

O primeiro job produtivo autenticado (`recap-1795538364251`) falhou antes de analisar painéis: 0/111, 1 tentativa, 0 tokens, com `local-vlm=UNKNOWN_PROVIDER_ERROR`. A reprodução com o mesmo crop, passando pelo tiling e pelo `VisionRouter`, isolou a causa: o merger de tiling omitia `overlays.burnedTextRegion` quando não havia texto queimado, enquanto o schema privado do router exigia a propriedade como string nula. A propriedade passou a ser opcional, preservando o contrato compartilhado; os testes de tiling, protocolo Ollama e contrato local passaram.

### Smoke produtivo após a correção

Após rebuild e reinicialização do Desktop fonte, a análise real passou pelo caminho produtivo com Ollama/Qwen3.5 local, tiling e um worker. A GPU foi utilizada (aproximadamente 90% de uso, 56 °C durante a amostra) e a CPU chegou a 100%; não houve API externa, TTS, Humanizer, MotionVelix, FFmpeg ou renderização. O job foi pausado pelo operador no primeiro ponto seguro para evitar reprocessar checkpoints históricos enquanto a descoberta do diretório era corrigida.

Estado persistido no momento da pausa:

| Métrica | Valor observado |
|---|---:|
| Painéis concluídos | 9/111 |
| Chamadas de modelo no ledger | 11 |
| Cache hits | 0 |
| Cache misses | 11 |
| Tokens de entrada | 9.384 |
| Tokens de saída | 3.089 |
| Estado | paused, checkpoint preservado |

Essas 9 análises foram trabalho duplicado desta tentativa, não cache histórico; não são contabilizadas como reutilização. O custo efetivo de API permaneceu 0; custos locais e quota CLI não são inferidos como zero quando não medidos.

### Correção da descoberta de checkpoints

O relatório histórico não apareceu na primeira execução porque o Desktop fonte resolvia o histórico somente a partir de `process.cwd()`, que não era a raiz do monorepo durante a execução Electron. A resolução agora procura a raiz que contém `.aethera-recap-data` entre as raízes configuradas e os caminhos do app, sem copiar ou sobrescrever artefatos.

Validação read-only independente dos dois diretórios históricos existentes:

| Status | Quantidade |
|---|---:|
| Compatíveis | 60 |
| Migráveis | 0 |
| Incompatíveis | 0 |
| Corrompidos | 0 |
| Ausentes | 0 |

Essa contagem é uma validação estática dos 60 checkpoints, não uma afirmação de que o job pausado já os reutilizou. A retomada produtiva precisa carregar o build corrigido e confirmar o artefato de compatibilidade antes de consumir novas inferências.

### Validação de build e gates

`npm run build:aethera` passou após a correção: 1.093 módulos main, 2.646 módulos renderer e código de preload gerados. Permanecem apenas avisos de comentários `@__PURE__` provenientes do zod. Os testes direcionados anteriores permanecem aprovados: 28 testes de gate/cache/fidelidade e 30 testes de tiling/protocolo/contrato local, sem chamadas reais de IA.

O Gate de entrada e o Gate de análise estão aptos para retomada. O Gate de fidelidade continua separado e não aprovado: não existe ainda avaliação independente evidence-backed para todos os 111 painéis. Portanto o Story Engine permanece bloqueado pelo strict fidelity, como requerido. O Auto-Recovery está conectado como hook pós-análise e pré-encaminhamento; sem evidência independente suficiente, ele não promove observações para fatos narrativos.

### Decisão de continuidade

Não foi iniciado o lote dos 51 painéis nesta execução: a primeira tentativa ficou pausada antes de validar o reuso histórico no Desktop, e continuar naquele estado consumiria chamadas duplicadas. Próximo passo seguro: reiniciar somente o Desktop fonte com o build aprovado, retomar o mesmo job, confirmar os 60 checkpoints compatíveis no caminho produtivo, registrar cache hits reais e só então processar incrementalmente os painéis não cobertos, dentro do orçamento original. O Story Engine deve continuar bloqueado até o Gate narrativo independente.

### Retomada controlada e pausa solicitada (24/11/2026)

O Desktop fonte foi reiniciado com o build aprovado e o mesmo job foi retomado. A importação do CBZ foi validada novamente no caminho produtivo e o job entrou em `paused_budget` antes de qualquer nova inferência visual, porque o orçamento persistente já registrava o limite de tempo atingido. O usuário solicitou uma pausa imediata; o job ficou em ponto seguro, com o checkpoint `9/111` preservado.

Telemetria persistida após a retomada:

| Métrica | Valor |
|---|---:|
| Chamadas de modelo | 11 |
| Cache hits | 18 |
| Cache misses | 11 |
| Retries | 0 |
| Deduplicações | 0 |
| Tokens de entrada | 9.384 |
| Tokens de saída | 3.089 |
| Tokens de cache | null |
| Custo efetivo de API | null; não houve API externa |
| Quota CLI | null; nenhum agente CLI usado |
| Motivo de pausa | `RECAP_BUDGET_EXCEEDED`, tempo máximo |

Os 18 cache hits são evidência do cache local do job/tiling; não devem ser apresentados como 60 hits históricos. O artefato produtivo gerado em `AppData\\Roaming\\AetheraStudio\\recap-workspace\\compatibility\\historical-checkpoints.json` registrou 111 `missing`, pois os IDs dos checkpoints históricos (`nanomachine-cap-1-5_p…`) não correspondem aos IDs atualmente extraídos (`nano-machine-capitulo-01_p…`). A validação estática anterior dos arquivos históricos não prova compatibilidade produtiva por ID. Essa divergência agora é um bloqueio confirmado de integração, não uma hipótese; nenhum cache histórico foi forçado e nenhum arquivo histórico foi sobrescrito.

Não houve processamento dos 51 painéis pendentes, não houve OCR real, TTS, Humanizer, MotionVelix, FFmpeg, renderização ou chamada externa. O Gate de entrada/importação passou; o Gate de análise foi interrompido pelo orçamento; o Gate de fidelidade e o Gate narrativo permanecem não aprovados. O Story Engine não gerou roteiro.

O próximo passo, após a pausa do usuário, é corrigir somente a resolução de identidade histórica com uma chave determinística adicional (SHA-256 + página/posição/coordenadas), classificando divergências de ID como migráveis apenas quando a evidência coincidir. Depois disso, deve-se repetir a validação read-only dos 60 artefatos antes de qualquer nova inferência. Não retomar automaticamente nem iniciar a Fase 4B.12.

### Correção da identidade histórica após a retomada (24/11/2026)

Foi corrigido o resolver em `packages/cinema/src/recap/historical-checkpoint-cache.ts` para aceitar migração somente quando o ID divergir, mas SHA-256, página, posição e coordenadas coincidirem exatamente. O ID atual é preservado no resultado adaptado; o artefato histórico permanece somente leitura. Casos sem metadados suficientes continuam `missing`, e SHA coincidente com posição divergente continua incompatível.

Resultados read-only contra os 111 painéis atualmente extraídos:

| Status | Quantidade |
|---|---:|
| Compatíveis | 0 |
| Migráveis por evidência | 40 |
| Incompatíveis | 0 |
| Corrompidos | 0 |
| Ausentes nesta extração | 71 |

Os 40 migráveis correspondem a checkpoints históricos cuja imagem e geometria foram confirmadas; os 20 artefatos históricos restantes não correspondem aos 111 crops atuais e não foram forçados como cache. Portanto, a afirmação correta para o caminho produtivo é `40 migráveis + 71 ausentes`, não 60 hits.

Validação:

- Histórico/fidelidade/progresso: **29 pass, 0 fail**.
- Tiling/protocolo Ollama/contrato/orçamento/checkpoint: **30 pass, 0 fail**.
- `npm run build:aethera`: **pass**; 1.093 módulos main e 2.646 renderer.

O job continua pausado por orçamento e não foi retomado automaticamente após a correção. Como 71 painéis ficam sem checkpoint compatível e o limite da fase é 51 painéis novos, a próxima execução deve selecionar no máximo 51 ausentes de forma determinística, registrar os 40 migráveis como cache histórico e preservar os 20 checkpoints não correspondentes para auditoria, sem reprocessamento silencioso.

### Correção da mesclagem histórica e do orçamento de tempo (24/11/2026)

A validação acima foi refinada antes de qualquer nova inferência. As duas raízes históricas (`phase4b5` e `phase4b9`) foram comparadas contra os 111 painéis atuais por SHA-256, página, índice e coordenadas. A raiz `phase4b9` contém 20 checkpoints válidos adicionais; a primeira implementação da mesclagem descartava esses resultados porque mantinha o primeiro estado `missing` por ID atual. Isso foi corrigido sem alterar os arquivos históricos: a mesclagem agora escolhe deterministicamente o melhor estado comprovado por painel (`compatible` > `migratable` > `incompatible` > `corrupted` > `missing`).

Contagem read-only corrigida:

| Raiz | Migráveis | Ausentes | Incompatíveis | Corrompidos |
|---|---:|---:|---:|---:|
| `phase4b5` | 40 | 71 | 0 | 0 |
| `phase4b9` | 20 | 91 | 0 | 0 |
| Mescladas, sem duplicação | **60** | **51** | **0** | **0** |

Os 20 não são divergências de dataset: têm a mesma fonte/crops e geometria compatível, mas usam a convenção histórica de ID `nanomachine-cap-1-5_p…`, enquanto a extração produtiva usa `nano-machine-capitulo-01_p…`. A migração é lógica e somente leitura; o resultado é adaptado ao ID atual para o caminho produtivo, sem sobrescrever ou copiar checkpoints. A operação é idempotente: uma segunda resolução produz o mesmo resultado e não modifica os artefatos.

Também foi corrigido o cálculo de `maxWallTimeMs`. Antes, o controlador usava o primeiro evento do ledger como início absoluto e cobrava falhas anteriores, pausas e períodos com o aplicativo fechado. Isso explica o bloqueio observado após aproximadamente 17 minutos de tempo de calendário, embora a inferência ativa medida no ledger tenha sido de 57.235 ms. Agora cada execução registra marcadores persistentes `execution_started`/`execution_ended`; o orçamento cobra somente segmentos ativos acumulados, exclui lacunas de pausa e usa, para ledgers legados sem marcadores, apenas durações de trabalho já mensuradas como fallback conservador. A retomada permanece segura e não renova silenciosamente o orçamento.

Arquivos desta correção:

- `packages/cinema/src/recap/historical-checkpoint-cache.ts`: mesclagem por melhor evidência e remapeamento determinístico já validado.
- `packages/cinema/test/recap/historical-checkpoint-cache.test.ts`: idempotência e preferência de resultado válido sobre `missing`.
- `packages/cinema/src/recap/phase5/recap-usage-telemetry.ts`: segmentos de tempo ativo e compatibilidade com ledgers legados.
- `packages/cinema/src/recap/phase5/recap-production-orchestrator.ts`: abertura do segmento ativo na execução.
- `packages/cinema/test/recap/phase1-optimization.test.ts`: pausa não contabilizada como tempo ativo e bloqueio cumulativo.

Validação concluída:

- Histórico + telemetria: **12 pass, 0 fail**.
- Gates, recovery, tiling, protocolo Ollama, orçamento e checkpoints: **56 pass, 0 fail**.
- `npm run build:aethera`: **pass**; 1.093 módulos main e 2.646 renderer.
- Ledger existente: 31 eventos, 11 chamadas de modelo, 9.384 tokens de entrada, 3.089 de saída, 18 cache hits, 0 retries, 57.235 ms de duração mensurada. Não houve nova inferência nesta correção.

Estado operacional: o job permanece pausado em `paused_budget`, sem retomada automática. Com os 60 checkpoints históricos reutilizáveis, restam exatamente 51 painéis sem análise histórica. O orçamento de chamadas/tokens continua sujeito à pré-estimativa de blocos e ao limite de tempo ativo antes de iniciar; o Story Engine, fidelidade e gates narrativos continuam bloqueados até evidência independente. Não houve TTS, Humanizer, MotionVelix, FFmpeg, renderização, API externa ou commit.

### Retomada após rebuild e limite restante (24/11/2026)

Foi feita uma tentativa controlada de retomada antes do rebuild, apenas para confirmar o reaproveitamento: o ledger passou de 18 para **27 cache hits**, sem aumento de chamadas, tokens ou retries, e bloqueou antes do próximo painel. O processo Desktop fonte foi então reiniciado para carregar o novo cálculo de tempo ativo. Após o restart, a tela recarregada exibiu o projeto como `Aguardando início` e não ofereceu o botão de retomada do job já persistido; o estado no disco permaneceu `paused_budget` com 9/111 painéis e 27 hits. Não foi iniciado um novo job para evitar duplicação.

Assim, a correção do orçamento está validada por testes controlados e build, mas ainda falta uma validação ao vivo da retomada após restart: a UI precisa reidratar o job persistido e mostrar novamente `Retomar Checkpoint`. Esse é um bloqueio de integração de retomada, não uma falha do cache histórico nem uma autorização para criar outra execução. O caminho seguro seguinte é corrigir essa reidratação/ação de UI e então retomar o mesmo `runId` com os 60 checkpoints históricos, sem novas inferências para os painéis já cobertos.

### Reidratação persistente corrigida e confirmada (24/11/2026)

A causa raiz estava em duas camadas:

1. O renderer fazia uma única leitura de `recap:jobs-list` durante a montagem. Se essa leitura ocorria antes de o bridge/IPC estar pronto, o projeto era carregado sem o job correspondente e permanecia visualmente como uma nova produção.
2. O modelo de timeline não reconhecia `paused_budget`; o estado persistido caía no `default` de `getStateMetadata` e era exibido como `Aguardando início`. O status separado de produção também tratava esse estado como `ready_to_start`.

Correções realizadas:

- `RecapProductionPanel` reconsulta o registry persistente pelo `project.runId` após carregar os detalhes do projeto, sem criar job ou alterar o ledger.
- A seleção inicial ignora jobs terminados e não depende do primeiro item arbitrário da lista.
- `paused_budget` foi incluído no contrato visual, nos estados retomáveis, nos rótulos e na mensagem de orçamento preservado.
- A timeline exibe `Pausado (orçamento atingido)` e mantém o estágio `vision` pausado.
- O status separado Importação/Produção exibe `Produção Pausada`, em vez de `Pronto para Produzir`.

Validação ao vivo após recarregar a janela Desktop fonte:

- Projeto: `Nano-Machine-Capitulo-01`.
- RunId: `recap-1795538364251`.
- Estado exibido: **Pausado (orçamento atingido)**.
- Fonte CBZ: validada, 24 páginas.
- Checkpoint persistido: 9/111 painéis.
- Nenhuma chamada nova de IA, OCR ou fallback.
- Nenhum checkpoint, ledger ou runId foi recriado.

O botão de retomada permanece condicionado ao job hidratado e ao orçamento disponível; não foi acionado nesta validação. O Story Engine continua bloqueado pelo gate narrativo independente.

Arquivos alterados nesta correção:

- `apps/aethera-desktop/src/renderer/src/RecapProductionPanel.tsx`
- `apps/aethera-desktop/src/renderer/src/recap-timeline-model.ts`
- `apps/aethera-desktop/src/renderer/src/recap-timeline-model.test.ts`

Validação técnica:

- `npm run build:aethera`: **pass**; 1.093 módulos main e 2.646 renderer.
- Testes Vitest direcionados: bloqueados ambientalmente porque `vitest/config` não está instalado no workspace (`ERR_MODULE_NOT_FOUND`); nenhum teste foi mascarado ou desativado.
- A confirmação visual após reload demonstrou a hidratação do estado persistido; não houve inferência real nesta etapa.
### Retomada produtiva após correção do Vitest e reidratação (24/11/2026)

**Escopo executado.** A retomada foi acionada pelo botão de produção do Desktop, usando o mesmo `projectId/runId` `recap-1795538364251` e o mesmo job persistido `rjob-mwuxk2o7-b007b347`. Não foi criado um segundo job, o ledger não foi reiniciado e nenhum arquivo histórico foi sobrescrito.

**Vitest.** O workspace raiz não declarava o runner, embora `package-lock.json` registrasse a versão `5.0.4` em um workspace extraneous. Foi restaurado somente `vitest@5.0.4` como devDependency do workspace raiz, usando npm e sem scripts de instalação. O binário/configuração agora carregam com Vitest 5.0.4; o arquivo de timeline não está incluído pelo glob padrão do `vitest.config.ts`. O teste direcionado `recap-timeline-model.test.ts` via `tsx --test` passou com 8 casos; os três testes de cinema foram executados, mas falharam antes dos casos por `ERR_MODULE_NOT_FOUND: @neuralbridge/shared`, limitação de resolução dos workspaces isolados e não indisponibilidade do Vitest.

**Pré-validação.** Ollama respondeu em `127.0.0.1:11434`; `qwen3.5:4b-q4_K_M` e `qwen2.5vl:3b` estavam instalados e o catálogo reportou `vision` para ambos. A GPU reportada foi RTX 4060 Ti com 2.533 MiB de 8.188 MiB ocupados no instante da consulta. PaddleOCR não estava disponível no interpretador Python consultado, mas a retomada manteve OCR complementar desativado, conforme a configuração persistida.

**Resultado ao vivo.** O job avançou de `9/111` para `60/111` painéis. Foram registrados 18 novos cache hits comprovados e uma única tentativa nova; não houve nova inferência válida nem novos tokens contabilizados. O estado final foi `paused_provider_unavailable`, com checkpoint durável em `60/111` e retomada indicada no painel 61. A UI confirmou `Pausado: provedores`, preservação do checkpoint e strict fidelity ainda ativo.

**Ledger final do run.** `modelCalls=12`, `cacheHits=45`, `cacheMisses=12`, `retryCalls=0`, `inputTokens=9.384`, `outputTokens=3.089`, `effectiveApiCostUsd=null`, `estimatedCostUsd=null`, `quotaUnits=null` e `activeWallTimeMs=114.562`. O orçamento persistido original do job permaneceu `100` chamadas, `90.000` tokens de entrada, `30.000` de saída e `900.000 ms`; não foi renovado. Portanto, antes da falha havia margem temporal aproximada de `785.438 ms` (cerca de 13 min 5 s), além de chamadas e tokens, mas a indisponibilidade do provider impediu uma nova chamada segura.

**Falha confirmada.** O ledger registra a tentativa do painel `panel-18` como `failed`, `provider=local-vlm`, `providerAttempts=1`, `retryCount=0`, duração `153 ms`. O diagnóstico sanitizado foi `UNKNOWN_PROVIDER_ERROR`; a causa interna observada foi `expected: object, received: undefined` durante a validação do resultado pelo VisionRouter. Isso prova que a rota local chegou ao caminho produtivo e falhou no contrato de retorno antes de produzir análise válida. Não há evidência suficiente nesta execução para afirmar se o `undefined` veio do adaptador Ollama, do scheduler/wrapper ou de uma versão carregada pelo Desktop; nenhuma resposta fictícia foi criada e nenhum retry foi executado.

**Gates e escopo.** A análise visual avançou, mas o gate de fidelidade/narrativo não foi aprovado para os painéis novos; o Story Engine permanece bloqueado. Não foram executados Humanizer, TTS, MotionVelix, FFmpeg, renderização ou provedores externos. O próximo passo seguro é corrigir e testar isoladamente o contrato `local-vlm.analyze → VisionRouter` com mock e uma chamada local única autorizada, depois retomar do painel 61 sem renovar o orçamento.

## Handoff Codex → Claude Code — causa raiz do painel 61 (24/11/2026)

Status: **causa raiz comprovada e corrigida; inferência produtiva desbloqueada; novo bloqueio de VRAM do host (decisão do usuário).**

### Causa raiz comprovada — cadeia exata

O `undefined` não vinha do Ollama, do adaptador de tiling nem do scheduler. Evidência: o ledger do job registra `path: []` e duração de 16–27 ms (sem inferência), e o ledger do orçamento piloto (`usage/recap/recap-1795538364251-tiling.jsonl`) registra às 19:14:04Z `budget paused: prazo de 1800000 ms excedido`, com apenas 54.535 ms de inferência liquidada em 9 chamadas.

1. `RecapPilotBudget` (`packages/orchestrator/src/aethera/recap-pilot-budget.ts`) media `maxWallTimeMs` em **tempo de calendário** desde o evento `opened` (16:39:33Z). Às 19:14 o prazo "estourou" com 54,5 s de trabalho real. Esse é o mesmo defeito corrigido antes na telemetria do job, mas existia num segundo orçamento.
2. A pausa era restaurada do ledger em **toda** reidratação (`hydrate` → `paused = true`), então cada retomada falhava no `ensureCanCall` antes de chamar o Ollama.
3. O `local-vlm` lançava `RECAP_PILOT_BUDGET_EXCEEDED`; o `VisionRouter` registrava o erro do `analyze` corretamente.
4. O adaptador Recap (`packages/cinema/src/recap/recap-vision-adapter.ts`) caía no fallback `router.describe`.
5. **Ponto exato de origem do `undefined`:** `local-vlm` anunciava `capabilities: ['describe', 'analyze']` (`vision-providers.ts`, `createOllamaLocalVlmProvider`) sem implementar `describe`. No router, `case 'describe': return provider.describe?.(...)` resolvia `undefined` e `description.parse(undefined)` emitia `expected object, received undefined` (path `[]`).
6. O trace do `describe` **substituía** o do `analyze`, então o ledger perdia o erro verdadeiro e o job ia para `paused_provider_unavailable` com uma mensagem de schema.

A correção anterior do Codex (guarda só no `analyze`) não interceptava o caminho porque a falha estava no `describe`. A primeira falha do run (`panel-0`, 19 ms, mesma mensagem com `path: []`) seguiu o mesmo padrão de mascaramento.

### Correções

| Arquivo | Mudança |
|---|---|
| `packages/orchestrator/src/aethera/recap-pilot-budget.ts` | Prazo = soma do `wallMs` liquidado (ok e falhas), reidratada do ledger. Pausa persistida é reavaliada na construção e, se os limites permitirem, grava **um** evento auditável `resumed` (idempotente; contadores não são renovados). `settleCall` não lança mais após chamada concluída: marca pausa para a **próxima** chamada, sem descartar o resultado pago. |
| `packages/orchestrator/src/aethera/vision-router.ts` | Contrato `VISION_PROVIDER_CONTRACT` para **todas** as capabilities (método ausente ou resultado `undefined/null`), não só `analyze`. |
| `packages/orchestrator/src/aethera/vision-providers.ts` | `local-vlm` anuncia apenas `analyze`. |
| `packages/cinema/src/recap/recap-vision-adapter.ts` | Pausa de orçamento local (`RECAP_PILOT_*`) não aciona `describe`; quando o `describe` roda, o trace mantém as tentativas do `analyze` primeiro. |
| `packages/cinema/src/recap/phase5/recap-usage-telemetry.ts` | Segmento ativo termina no último trabalho registrado (um fechamento tardio não cobra pausa); trabalho medido fora de segmentos (ledger anterior aos marcadores) continua cobrado. |

### Testes de regressão (vermelhos antes, verdes depois)

- `packages/orchestrator/test/recap-panel61-regression.test.ts` (3): reproduz `received undefined` com o provider real e `fetch` stubado; nenhuma chamada a `/api/chat` nos dois primeiros; o terceiro prova que o ledger com pausa obsoleta chega à inferência uma vez.
- `packages/orchestrator/test/recap-pilot-budget.test.ts` (+4): tempo ativo vs calendário, reavaliação idempotente, pausa legítima mantida, `settleCall` sem descarte.
- `packages/cinema/test/recap/vision-adapter-describe-masking.test.ts` (2).
- `packages/cinema/test/recap/phase1-optimization.test.ts` (+2): segmento com fim tardio = 671 ms (antes 503.033 ms); trabalho pré-marcador cobrado.
- Suítes relacionadas: **92/92** (`tsx --test`: Ollama/contrato/degeneração/tiling/budget/telemetria/histórico/fidelidade/recovery) e **44/44** (Vitest: router/analyze/adapter/fallback/e2e).
- Pré-existentes e não relacionadas: 2 falhas em `aethera-vision-capabilities.test.ts` (idênticas com a mudança revertida).
- `npm run build:aethera`: **pass**; o bundle contém as correções.

### Contabilidade temporal verificada

- Ledger do job: o segmento reparado (19:14:03.685 → 19:22:26.718) cobrava **503.033 ms**, mas o último trabalho foi às 19:14:04.4. Pela regra nova, o segmento vale ~0,7 s. A telemetria anterior também ignorava 57,4 s de trabalho medido antes do primeiro marcador.
- Tempo ativo recalculado (somente leitura, sobre cópia do ledger): **58.543 ms** antes da retomada e **75.322 ms** depois. Nenhum evento histórico foi apagado ou reescrito; o ledger não foi zerado e o orçamento não foi renovado.

### Retomada produtiva controlada (19:48Z)

Só o Desktop de desenvolvimento foi reiniciado (`NB_RECAP_PHASE_4B11=1`, `NB_RECAP_LOCAL_ONLY=1`). O app instalado não foi tocado. A retomada usou **Continuar Produção** no job existente (`recap-1795538364251` / `rjob-mwuxk2o7-b007b347`), não o botão "Continuar NanoMachine (Cap. 2)". `paused_provider_unavailable` e `paused_budget` são retomáveis (`RECAP_JOB_RESUMABLE`).

Resultado:

- O orçamento gravou `resumed` (`previousReason: prazo de 1800000 ms excedido`, `activeWallTimeMs: 54535`).
- 60 checkpoints reutilizados (cache hits) e uma **inferência real bem-sucedida** no painel 61: Qwen3.5, 1.075 tokens de entrada, 397 de saída, 16.307 ms. O structured output foi válido no provider.
- Logo após, a amostra de VRAM do host deu **6.792 MiB > 6.500 MiB**. O `settleCall` antigo, ainda no bundle em execução, lançou a pausa e **descartou o resultado** (corrigido depois; exige novo restart do Desktop dev). O erro agora aparece com a causa real: `RECAP_PILOT_BUDGET_EXCEEDED: VRAM observada 6792 MiB...`.
- Estado: `paused_provider_unavailable`, checkpoint **60/111** preservado. Nenhum retry automático.

### Consumo acumulado (orçamento piloto, autoritativo para chamadas e tokens)

| Item | Usado | Limite |
|---|---:|---:|
| Painéis registrados | 10 (9 duplicados dos históricos + painel 61) | 51 |
| Blocos | 18 | 80 |
| Chamadas Qwen | 10 | 100 |
| OCR | 0 | 15 |
| Fallback CPU | 0 | 2 |
| Tokens de entrada | 10.459 | 100.000 |
| Tokens de saída | 3.486 | 40.000 |
| Tempo ativo | 70.842 ms | 1.800.000 ms |
| Pico de VRAM (host) | 6.792 MiB | 6.500 MiB |

O ledger do job registra 14 misses e 81 cache hits; os hits são reutilizações e não painéis únicos. Os tokens da chamada descartada (1.075/397) estão no orçamento piloto, mas não no ledger do job (falha sem `usage`). **Capacidade restante de painéis: 41 novos**, porque as 9 análises duplicadas do primeiro smoke consumiram o limite de 51. Concluir os 51 pendentes exige uma decisão explícita sobre esses 9; o limite não foi ampliado.

### Bloqueio restante — VRAM do host

Com o Qwen3.5 residente, o Ollama usa 3.140 MB; o resto da GPU é ocupado por outros aplicativos abertos (navegadores, Teams, Discord, Spotify, o Aethera instalado, um `python.exe` com contexto CUDA etc.). O sampler mede a GPU inteira (`nvidia-smi memory.used`). Com o modelo carregado, a amostra pré-chamada já excede 6.500 MiB, então cada retomada processa no máximo um painel. Opções, sem ampliar o limite por conta própria: (a) liberar cerca de 400 MiB fechando apps com GPU e retomar; ou (b) o usuário decide medir só o processo do Ollama (`/api/ps size_vram`) contra o limite.

### Gates

- Entrada/importação: aprovado.
- Análise visual: desbloqueada (inferência e structured output válidos), pausada por VRAM do host.
- Fidelidade e narrativa: não aprovados; strict fidelity ativo; o Story Engine continua bloqueado.
- Smoke autenticado Web → Remote Host: pendente (bootstrap de administrador exige credenciais do usuário).
- Não houve Humanizer, TTS, MotionVelix, FFmpeg, renderização, API externa, commit ou deploy.

### Limite de VRAM 7 GiB e segunda retomada (19:58Z)

Por decisão do usuário (GPU de 8 GiB), `maxVramMb` passou de 6.500 para **7.168 MiB** (7 GiB) nos três pontos do caminho produtivo em `apps/aethera-desktop/src/main/aethera-ipc.ts` (orçamento piloto, configuração 4B.11 e provider local). Os demais limites ficaram iguais. Depois de rebuild e restart só do Desktop dev, o mesmo job foi retomado por **Continuar Produção**. O orçamento gravou `resumed` (`previousReason: VRAM observada 6792 MiB…`).

Resultado:

- **Painel 61 (`panel-18`) concluído e persistido**: 1.075 tokens de entrada, 308 de saída, 7.960 ms.
- **8 painéis novos** analisados com structured output válido (~6 s cada), 30 cache hits intercalados e VRAM entre 6.492 e 6.580 MiB. Progresso: **68/111**.
- **Nova falha, sem retry:** `panel-38`, chamada 19, `Ollama retornou JSON de análise inválido: Unexpected end of JSON input`. Evidência: `outputTokens = 560`, exatamente o teto `maxOutputTokens: 560`. O painel é denso (1.625 tokens de entrada, o maior do run) e a resposta foi truncada pelo `num_predict`. O job ficou em `paused_provider_unavailable`, com checkpoint preservado.

Consumo acumulado (orçamento piloto): 18/51 painéis, 27/80 blocos, 19/100 chamadas, 0/15 OCR, 0/2 fallback CPU, 20.959/100.000 tokens de entrada, 7.017/40.000 de saída, 127.978 ms/30 min de tempo ativo, pico de VRAM de 6.792/7.168 MiB. Ledger do job: 23 misses, 111 cache hits, 0 retries, tempo ativo de 133.915 ms.

Capacidade restante: **33 painéis novos** para 43 pendentes (inclui `panel-38`). Sem decisão sobre as 9 análises duplicadas do primeiro smoke, o run termina em no máximo ~101/111.

Próxima decisão: aumentar só `maxOutputTokens` (`num_predict`) de 560 para 900. Isso cabe no contexto de 4.096 (1.625 + 900 + prompt). A reserva do planejador de tiles (`outputReserveTokens`) não muda, para não alterar os cortes nem o cache.

### Rota local sem teto de consumo e conclusão da análise visual (20:08–20:12Z)

**Decisão do usuário (24/11):** não limitar o consumo do `local-vlm`. Aplicado em `apps/aethera-desktop/src/main/aethera-ipc.ts`:

- O orçamento piloto, usado só pelo `local-vlm`, passa a ter painéis, blocos, chamadas, OCR, tokens e tempo ativo **sem teto** (`Number.POSITIVE_INFINITY`). Tudo continua registrado no ledger.
- Mantidas as proteções de recurso: VRAM de 7.168 MiB, um worker, no máximo 2 fallbacks de CPU, zero retries automáticos e zero API externa.
- Na rota só local (`NB_RECAP_LOCAL_ONLY`/`NB_RECAP_PHASE_4B11`), o orçamento salvo no job (100 chamadas, 90k/30k tokens, 15 min) não se aplica; resta apenas `maxRetries: 0`. Rotas mistas ou externas mantêm o orçamento persistido. O arquivo do job não foi alterado.
- `maxOutputTokens` (`num_predict`) passou de 560 para **1.024**, por evidência: o `panel-38` truncou em 560/560. O contexto continua 4.096 e a reserva do planejador de tiles continua 560, então cortes e cache não mudam.

**Defeito pré-existente encontrado e corrigido:** `RecapBudgetController.beforeCall` com `maxRetries: 0` bloqueava **qualquer** chamada após a primeira do job, porque `modelCalls > 0 && retryCalls >= 0` é sempre verdadeiro. O sintoma foi o job pausado com `maxRetries=0` antes de qualquer chamada. Agora, com `unitId`, retry é uma nova chamada para uma unidade que **já falhou no segmento de execução atual**. A retomada explícita abre um segmento novo e não conta como retry automático. Sem `unitId`, a regra antiga é mantida. Arquivo: `packages/cinema/src/recap/phase5/recap-usage-telemetry.ts` (`failuresInCurrentExecution`). Teste novo em `phase1-optimization.test.ts`: bloqueia o retry na mesma execução, permite outra unidade e permite a retomada.

**Retomada final:** mesmo job, via **Continuar Produção**.

- `panel-38` concluído: 1.625 tokens de entrada, **657** de saída, 12,7 s.
- **Análise visual concluída: 111/111.** Neste segmento: 43 análises novas, 68 cache hits, 0 falhas e 0 retries. Maior saída: 901 tokens (abaixo do teto de 1.024).
- O Story Engine parou como exigido: `Recap strict fidelity blocked Story Engine before script generation: no evidence-backed RecapFidelityGateReport was supplied`. Nenhum roteiro foi gerado.

**Defeito de relatório corrigido:** o strict fidelity lança a exceção dentro do `runStoryEngine` antes de devolver as análises, então o `fidelity/fidelity-progress.json` gravado no bloqueio marcava os 111 painéis como `pending_analysis`. O caminho de falha do orquestrador agora preenche as análises a partir do checkpoint durável (`recap-production-orchestrator.ts`). Validação somente leitura no checkpoint real: 111 painéis, 111 análises → **111 `unverified`, 0 `pending_analysis`**, `storyEngineBlocked: true`. O arquivo em disco só será regravado na próxima persistência do job; não foi editado manualmente.

### Consumo total do run `recap-1795538364251`

| Item | Orçamento piloto (`local-vlm`) | Ledger do job |
|---|---:|---:|
| Painéis analisados pelo modelo neste run | 60 registrados (9 duplicados do 1º smoke + 51 novos) | — |
| Blocos | 70 | — |
| Chamadas Qwen | 62 | 66 misses |
| Cache hits | — | 217 (reutilizações, não painéis únicos) |
| Retries | 0 | 0 |
| OCR / fallback CPU | 0 / 0 | — |
| Tokens de entrada | 69.166 | 66.466 |
| Tokens de saída | 22.520 | 21.563 |
| Tempo ativo | 382.882 ms (~6,4 min) | 396.299 ms |
| Pico de VRAM (host) | 6.936 MiB (limite 7.168) | — |
| API externa / custo efetivo | 0 / `null` | `null` |

A diferença entre os ledgers vem das chamadas que falharam sem `usage` no ledger do job (como a descartada pela pausa de VRAM antiga). O orçamento piloto é o registro autoritativo de tokens.

### Status dos gates e bloqueios restantes

- Importação: aprovado. **Análise visual: aprovada (111/111)**, com 60 checkpoints históricos reutilizados e 51 painéis novos.
- **Fidelidade: não aprovada.** Os 111 painéis estão `unverified`; ainda não existe um produtor de `RecapFidelityGateReport` evidence-backed independente no caminho produtivo. O Story Engine continua bloqueado por strict fidelity, sem geração textual.
- O job ficou com estado `failed` (stage `vision`), checkpoint 111/111 e `canResume=false`. Com o relatório independente disponível, uma nova execução reutiliza 100% do cache (0 inferências) e segue para o Story Engine.
- Smoke autenticado Web → Remote Host: pendente (exige credenciais de administrador do usuário).
- Não houve Humanizer, TTS, MotionVelix, FFmpeg, renderização, commit ou deploy.

### Auditoria de fidelidade independente dos 111 painéis (24/11, ~20:40Z)

Pedido do usuário: implementar a auditoria independente. Não houve inferência nem chamada a modelo. Foi só revisão visual dos crops mais junção com o checkpoint produtivo.

**Produtor evidence-backed no caminho produtivo.** Novo módulo: `packages/cinema/src/recap/recap-fidelity-review-ledger.ts`.

- Cada revisão fica presa ao **SHA-256 do crop** e à **impressão digital da análise** (descrição, personagens, falas com `kind/contentKind/speaker` e ações). Se o painel for reanalisado ou o crop mudar, a revisão vira `stale` e o painel volta a `unverified`. Uma revisão antiga nunca aprova conteúdo novo.
- O schema exige evidência visual (`image`/`human_review`). `verified` não pode ter issues, e `needs_review` precisa de pelo menos uma. Revisões duplicadas são recusadas. `visual_only` é uma exceção explícita e com evidência, usada para painel ambíguo sem fato narrativo.
- `buildRecapFidelityGateFromReviews` monta o `RecapFidelityGateReport` com `runRecapFidelityGate`, o mesmo gate conservador das fases 4B.7–4B.9.
- O orquestrador recebeu `fidelityReviewLedger`. O relatório é construído **depois da análise**, pelo gancho `fidelityRecovery` do Story Engine, então não há dependência circular. Também é persistido em `fidelity-progress.json` e no registro do projeto.
- O Desktop lê o ledger em `recap-workspace/checkpoints/<chapterId>/fidelity-review-ledger.json`, por capítulo e ao lado das análises a que se refere. Ledger malformado falha o job: não aprova nem ignora evidência em silêncio.
- Testes:
  - `fidelity-review-ledger.test.ts` (7): vinculação a crop e análise, revisão stale após reanálise ou outro crop, `needs_review` bloqueia, sem ledger tudo fica `unverified`, schema rejeita contradições, `visual_only`.
  - `fidelity-review-ledger-orchestrator.test.ts` (1): o strict bloqueia sem ledger. Com ledger correspondente, a retomada usa 0 chamadas, `fidelity-progress` fica com `verified: 1` e `storyEngineBlocked: false`.

**Correção de origem das revisões.** O mapeamento por SHA mostrou que os 9 painéis duplicados (p0_0 a p2_0) foram **reanalisados** no primeiro smoke deste run. O conteúdo atual deles difere do que foi revisado nas fases 4B.5/4B.9 (por exemplo, `p1_2` agora tem `EUAACK...!!`). As revisões históricas desses 9 **não foram herdadas**.

| Origem | Painéis | Critério |
|---|---:|---|
| Revisão visual nova (crop inspecionado nesta fase) | 60 | 51 inéditos + 9 reanalisados |
| Revisão histórica herdada (4B.5 `after-paddleocr` → `before`; 4B.9 `report-20` → `before`) | 51 | Só quando texto e descrição atuais são idênticos ao checkpoint histórico revisado. O script aborta se houver divergência. |

Script: `scripts/audit-recap-phase4b11-fidelity-ledger.mts`. Escrita atômica, recusa sobrescrever e valida 0 `stale`, 0 sem revisão e 0 sem análise.

**Resultado do gate** (`projects/recap-1795538364251/fidelity/fidelity-gate-report-independent-v1.json`):

| Métrica | Valor |
|---|---:|
| Painéis | 111 |
| `verified` / elegíveis para narrativa | **79** |
| `visual_only` (sem fato narrativo) | 1 (`p1_0`: membro ambíguo, mão ou pé) |
| Bloqueados | **31** |
| Fila de revisão humana | 32 (31 bloqueados + `p1_0`) |
| `canForwardToStoryEngine` | **false**: Story Engine continua bloqueado |

Issues por tipo:

| Tipo | major | minor |
|---|---:|---:|
| Identidade de personagem | 12 | 7 |
| SFX como fala | 4 | — |
| Ação incorreta | 3 | 2 |
| OCR incompleto (histórico) | 1 | 2 |
| Personagem alucinado | 1 | 1 |
| Fala alucinada | 1 | — |
| Fala classificada como SFX | — | 1 |
| Objeto incorreto | — | 1 |
| Evidência insuficiente | — | 1 |

Lacunas narrativas relevantes:

1. **Fusão de identidade (12 major).** O Qwen usa os mesmos descritores do protagonista ferido ("jovem de cabelo escuro despenteado/espetado", "pessoa de cabelos escuros e túnica clara rasgada") para o **recém-chegado de moletom azul** (p14_2, p15_0, p15_3, p20_0, p20_2, p20_3, p21_1, p21_3, p21_4) e para o **assassino em fuga** (p18_1). Num roteiro, isso funde três pessoas numa só, justamente na virada da história (ancestral × descendente). Há também inflação de aliases do mesmo jovem (p8_4: 5 descritores; p9_2: 7).
2. **Falas inventadas a partir de SFX coreano:** `KOOY` (p6_2), `ok` (p12_0), `N/A` (p13_0), além dos históricos `KAAK!` (p7_0) e `!!` (p13_3).
3. **Ação invertida:** p8_2 descreve o jovem como ferido, mas quem sangra é o encapuzado (coerente com "kill one of our members"). p7_1 diz "segura por trás", mas é um agarrão frontal pela garganta. p13_0 atribui a túnica clara à figura atingida.
4. **Personagem inexistente:** p1_3 é só um glifo, mas a análise descreve um personagem.

Inconsistência conhecida, registrada sem reauditar o histórico: as revisões herdadas de 4B.5/4B.9 não avaliavam a lista de personagens com o mesmo rigor desta fase. Alguma inflação de aliases pode existir entre os 46 verificados herdados.

### Rota e orçamento do Story Engine (apresentados antes de qualquer geração textual)

Nada foi gerado. Rota atual do caminho produtivo (`runStoryEngine`):

| Etapa | Rota | Modelo/API | Custo |
|---|---|---|---|
| Análise visual | checkpoint 111/111 (cache) | nenhum (0 inferências) | 0 |
| Gate de fidelidade | ledger independente | nenhum | 0 |
| Roteiro | `runScriptGenerator`, determinístico; o Desktop não liga `scriptPort` de refinamento | nenhum | 0 |
| Fallback do roteiro quando o Gate G reprova | `scriptFallbackPort`: CLI claude-gateway → claude → codex, até 2 tentativas | **externo** | — |
| Humanizer | `recapHumanizePort` (CLI) | **externo**, proibido nesta fase | — |

**Correção aplicada (risco introduzido pela remoção do teto na rota local):** com `NB_RECAP_LOCAL_ONLY`/`NB_RECAP_PHASE_4B11`, o orçamento do job foi reduzido a `maxRetries: 0`. Assim, o fallback do roteiro e o Humanizer, ambos externos, poderiam rodar **sem teto** depois que o strict fidelity liberasse. Agora, na rota só local, essas duas portas **não são ligadas** (`aethera-ipc.ts`). Roteiro só determinístico, 0 API externa. Se o Gate G reprovar, as cenas ficam `needs_review` (nunca aprovadas em silêncio). Rotas mistas ou externas mantêm o orçamento persistido.

**Orçamento proposto para quando a fidelidade liberar:** 0 tokens, 0 chamadas e 0 API externa (roteiro determinístico).

**Pré-requisitos ainda abertos antes de executar o Story Engine:**

- Resolver os 31 bloqueados: revisão humana, ou correção das análises com nova revisão vinculada.
- Ainda não existe ponto de parada após o roteiro. Com a fidelidade liberada, o orquestrador seguiria para TTS/preview, que estão proibidos nesta fase. A execução do Story Engine precisa de uma parada explícita depois do roteiro, ou de autorização para as etapas seguintes.

Build `npm run build:aethera`: **pass**. O bundle contém a leitura do ledger e as portas desligadas na rota local. O Desktop dev em execução ainda usa o bundle anterior a estas mudanças; nenhuma nova execução produtiva foi iniciada. Não houve Humanizer, TTS, MotionVelix, FFmpeg, renderização, API externa, commit ou deploy.

### Reanálise dos 31 painéis bloqueados e ledger v2 (24/11, 20:40–21:20Z)

**Mecanismo.** O arquivo `reanalysis-request.json`, no checkpoint do capítulo, lista os painéis a reanalisar.

- `applyRecapReanalysisRequest` remove desses painéis apenas as análises e as entradas de cache mais antigas que `requestedAtIso`. Reaplicar o pedido não tem efeito, o que evita laço de inferência.
- As análises históricas desses painéis ficam excluídas.
- Um pedido com panelId que não existe no checkpoint agora falha com `RECAP_REANALYSIS_UNKNOWN_PANEL`, antes de qualquer inferência.
- O ledger de revisões passou para o diretório do checkpoint do capítulo e vale para qualquer run.

Mudanças no prompt local:

- SFX em hangul nunca entra em `dialogue`.
- Um item por pessoa visível.
- O rótulo é visual e só é reutilizado para a mesma pessoa, com a mesma roupa.
- Placeholders N/A, none e null viram texto vazio.

**Primeira reanálise (job `rjob-mwv5t9fm-d11b2a92`).** 13 painéis receberam conteúdo novo, mas 18 voltaram **idênticos**.

**Causa raiz dos 18 idênticos.** O cache persistente do VisionRouter (`cache/vision-router.json`) usa `promptVersion = policy.version` na chave. Esse valor continuava `recap-v1`, embora o prompt local tivesse mudado. Os 18 painéis cujo contexto não mudou repetiram a resposta antiga, sem inferência.

- Correção: `RECAP_VISION_PROMPT_VERSION = 'recap-v2-identity-sfx'` em `recap-vision-adapter.ts`.
- Efeito: muda só a chave do cache do roteador. O cache do checkpoint tem versionamento próprio e continua servindo os 80 painéis revisados.
- Regressão coberta em `phase4a-routing.test.ts` e `reanalysis-request.test.ts`.

Uma tentativa intermediária usou panelIds curtos (`p1_2`). Não casou nenhum painel e só repetiu o checkpoint, sem inferência. Foi isso que motivou o erro explícito para panelId desconhecido.

**Segunda reanálise (job `rjob-mwv67dux-cef978d4`, run `recap-1795553518566`, 20:52–20:54Z).**

| Item | Resultado |
|---|---|
| Pedido aplicado | `invalidated=18`, `removedCacheEntries=36` |
| Chamadas | 18 `local-vlm` (`qwen3.5:4b-q4_K_M`) |
| Retry, fallback, API externa | 0, 0, 0 |
| Tokens | 23.072 de entrada, 6.956 de saída |
| Inferência | 113 s |
| Custo | US$ 0 |
| Hits de checkpoint | 93 |

Os 18 painéis têm conteúdo novo. O job parou no strict fidelity antes do roteiro, como esperado, porque as análises novas ainda não tinham revisão. Não houve roteiro, Humanizer, TTS, MotionVelix, FFmpeg nem render.

Consumo somado das duas reanálises: 31 chamadas locais, 0 retry, 0 chamada externa, US$ 0.

**Revisão visual independente v2.** Cada um dos 31 crops foi inspecionado de novo e comparado à análise nova, em `scripts/audit-recap-phase4b11-fidelity-ledger-v2.mts`.

- As 80 revisões v1 continuam valendo porque ainda casam com o SHA do crop e com o fingerprint da análise.
- O ledger v1 foi arquivado em `fidelity-review-ledger.v1.json`. Nenhum artefato foi sobrescrito.

O critério é o mesmo do v1. Conta como issue o que muda quem está presente, quem faz o quê a quem, o que é dito ou o que é o objeto. Quando o rótulo do protagonista é reaproveitado para outra pessoa, a issue é **major** se nada no painel distingue os dois e **minor** se a descrição já os distingue.

| | v1 | v2 |
|---|---|---|
| Elegíveis (verified) | 79 | **87** |
| Só visual | 1 (p1_0) | 1 (p1_0) |
| Bloqueados | 31 | **23** |
| Fila de revisão | 32 | 24 |
| `canForwardToStoryEngine` | false | **false** |

**Corrigidos pela reanálise (8 painéis):** p1_4, p6_2 (o SFX não vira mais "KOOY"), p7_3, p11_2, p11_4, p12_0 (o SFX não vira mais "ok"), p13_3 e p21_3. Em p13_0 o placeholder N/A sumiu, mas o painel segue bloqueado por outro defeito.

**Ainda bloqueados (23 painéis):**

| Defeito | Contagem | Painéis |
|---|---|---|
| Identidade de personagem | 8 major, 6 minor | Major: recém-chegado de moletom com descritor do protagonista (p15_0, p20_0, p20_2, p20_3, p21_1); rótulos duplicados ou ausentes (p8_2, p8_4); protagonista descrito como "personagem feminino" (p11_1). Minor: p1_2, p10_4, p13_0, p15_3, p18_1, p21_4 |
| Ação errada ou invertida | 5 major, 2 minor | Major: p6_1, p7_0, p7_1, p8_2, p18_1. Minor: p9_2, p21_0 |
| Personagem inexistente | 3 major, 1 minor | Major: p1_3, p7_0, p8_4. Minor: p11_1 |
| Objeto, OCR ou classificação | minor | p6_3 (KEUK lido como REUR; faca descrita como espada), p14_2 (visor descrito como óculos), p16_3 (SIR!!! classificado como SFX) |

Dez dos 23 têm só issues minor: p1_2, p6_3, p9_2, p10_4, p13_0, p14_2, p15_3, p16_3, p21_0 e p21_4. Mesmo uma issue minor bloqueia no strict fidelity.

**Conclusão.** Com o `qwen3.5:4b` local, o prompt corrigido resolve SFX e placeholders. Não resolve a consistência de identidade entre painéis nem quem age em cenas de combate, e reanalisar com o mesmo modelo tende a repetir esses defeitos. Os 23 painéis restantes pedem uma destas saídas, que dependem de decisão do usuário:

- revisão humana, que corrige a análise ou aceita o painel como `visual_only` com evidência;
- outra rota de visão. Modelo e quantização continuam inalterados por restrição da fase.

**Testes e build:**

- tsx: pass em `reanalysis-request` (6 testes), `fidelity-review-ledger` (7), `fidelity-review-ledger-orchestrator` (1) e `phase4a-routing`.
- vitest: 19 pass em `story-engine-narrative-fidelity`, `recap-production-job-continuity`, `vision-adapter-describe-masking` e `recap-identity-sfx-prompt`.
- Build `npm run build:aethera`: pass.

Não houve commit nem deploy.

### Revisão humana dos 23 bloqueados (ferramenta pronta, decisões pendentes)

O usuário decidiu revisar pessoalmente os 23 painéis. Nada foi inferido e nada foi decidido em nome dele.

**Página de revisão.** `scripts/recap-phase4b11-human-review-page.mts` gera `.aethera-recap-data/phase4b11-human-review/review-blocked-panels.html`. A página é autocontida, com os crops embutidos, e mostra para cada painel:

- o crop;
- os problemas da revisão v2;
- a análise do modelo.

Há quatro decisões possíveis por painel:

| Decisão | Efeito no ledger e no checkpoint |
|---|---|
| Aceitar | Revisão `verified`, com evidência `human_review`. Prevalece sobre as issues da v2. |
| Corrigir | Substitui a análise no checkpoint, em `panelAnalyses` e em todas as entradas de `analysisCacheByHash` do painel. O cache por hash tem precedência na retomada, por isso as duas são substituídas. Gera revisão `verified` vinculada ao novo fingerprint. |
| Só visual | Registra uma issue INSUFFICIENT_EVIDENCE não bloqueante com a nota. O painel entra no vídeo sem gerar fatos narrativos. |
| Manter bloqueado | Nada muda. |

Toda decisão exceto "manter bloqueado" exige um motivo. A página salva as decisões no navegador e exporta `recap-human-review-decisions.json`.

**Aplicação.** O comando é `npx tsx scripts/recap-phase4b11-apply-human-review.mts <decisions.json> [--dry-run]`. O script:

- recusa decisões feitas sobre outro ledger (`RECAP_HUMAN_REVIEW_STALE_LEDGER`) ou sobre uma análise que mudou depois da decisão (`RECAP_HUMAN_REVIEW_STALE_ANALYSIS`);
- faz backup com timestamp do checkpoint e do ledger;
- grava de forma atômica;
- registra a aplicação em `human-review-log.jsonl`;
- gera `fidelity-gate-report-human-review-<timestamp>.json`.

Não deve rodar com um job de recap em execução.

**Validação.** O dry-run sobre os dados reais passou. Com uma decisão de cada tipo, aplicada a uma cópia temporária do workspace:

- elegíveis passaram de 87 para 89, e p1_3 virou só visual;
- a correção substituiu `panelAnalyses` e as 3 entradas de cache do painel;
- reaplicar o mesmo arquivo foi recusado.

Os dados reais não foram alterados.
