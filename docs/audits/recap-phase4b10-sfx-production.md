# Fase 4B.10 — SFX, OCR e integração produtiva

Data da auditoria: 2026-11-24  
Escopo: integração de código e smoke test estático sobre checkpoints/ledgers existentes.  
Inferência nova nesta fase: **0**. TTS, Humanizer, MotionVelix, FFmpeg e renderização: **não executados**.

## Resultado executivo

A fronteira de conteúdo textual agora é estruturada e compatível com os contratos antigos. Cada entrada preserva o texto original, a classificação, evidências e proveniência. `sound_effect` não é encaminhado como fala de personagem; `dialogue` e `narrative_caption` continuam elegíveis somente quando sustentados por evidência.

O caminho Desktop passou a aceitar configuração explícita por job para análise visual local, OCR complementar PaddleOCR, fidelidade estrita, tiling determinístico e limite de chamadas. O tiling usa o componente já validado e uma guarda local persistente de um worker; o orçamento do orquestrador continua sendo a guarda principal do job.

O estado factual dos artefatos permanece: os 40 painéis do piloto inicial têm hashes íntegros; os 20 da expansão também. A expansão registra 27 chamadas reais, 23 análises, 4 OCR, 24.814 tokens de entrada, 7.858 de saída e pico de 6.171 MiB. Não houve chamadas adicionais para esta fase.

## Casos pendentes

Os seis casos foram investigados apenas com os resultados persistidos, manifestos, imagens referenciadas e relatório da Fase 4B.9. Os 54 painéis já verificados não foram reprocessados.

| Painel | Evidência persistida | Classificação produtiva | Elegibilidade | Situação |
|---|---|---|---|---|
| `p1_3` | Fragmento em `y=3987–4211`, glyph de onomatopeia e borda parcial de balão; sem fala completa ou evento independente | `sound_effect`/fragmento visual | Não fornece fatos; permanece na sequência | `needs_review` mantido |
| `p1_1` | `!!!` em glifo/reação gráfica; não há sustentação de fala | `sound_effect` | Não é diálogo | `needs_review` mantido |
| `p7_0` | SFX coreano sobre impacto | `sound_effect` | Não é diálogo | `needs_review` mantido |
| `p13_3` | `!!` em globo de reação | `sound_effect` | Não é diálogo | `needs_review` mantido |
| `p7_3` | SFX visual omitido pela análise textual; não houve fala inventada | `unknown` até evidência textual adicional | Fato não confirmado; crop preservado | `needs_review` mantido |
| `p11_4` | SFX visual omitido; perfil mascarado e texto não confirmado | `unknown` até evidência textual adicional | Fato não confirmado; crop preservado | `needs_review` mantido |

O relatório persistido da expansão confirma 15/20 verificados, 5/20 em revisão, 3 problemas graves `SFX_AS_DIALOGUE` e 2 limitações menores `OCR_INCOMPLETE`; isso não foi promovido automaticamente pelo classificador.

As classificações acima são a política produtiva/elegibilidade aplicada ao novo fluxo; os checkpoints históricos não foram sobrescritos nem reescritos nesta fase.

Regressão `p6_3`: o artefato PaddleOCR localizado existente continua sendo `KEUK...!`, com pontuação preservada; o resultado anterior `REUR...!` não é reintroduzido. Não houve nova execução.

## Integração implementada

### Classificação e proveniência

- `packages/cinema/src/recap/recap-text-classification.ts:83` implementa classificação determinística combinando balão, tipografia, posição, contexto de ação/impacto, glifos, evidência OCR e ordem de leitura.
- `packages/cinema/src/recap/recap-types.ts:320` define `RecapAnalysisSettings`; o schema de diálogo aceita `contentKind`, evidências e proveniência sem quebrar checkpoints antigos.
- `packages/cinema/src/recap/dialogue-extractor.ts` e `packages/cinema/src/recap/recap-vision-adapter.ts` anotam tanto OCR quanto visão antes do Story Engine.
- `packages/cinema/src/recap/narrative-analyzer.ts` gera metadados estruturados de ações, impactos, movimentos, SFX, expressões, transições e intensidade.
- `packages/cinema/src/recap/story-continuity-engine.ts` e `script-generator.ts` já excluem `kind=sfx` da fala factual; a nova classificação preserva essa fronteira mesmo quando o modelo devolve SFX em `visibleText`.

### PaddleOCR local

- `packages/cinema/src/recap/paddleocr-adapter.ts:348` adiciona a ponte para o contrato genérico do extrator. Entradas em buffer são materializadas por SHA-256, e o adapter existente mantém cache, ledger, timeout e cancelamento.
- `apps/aethera-desktop/src/main/aethera-ipc.ts:5976` seleciona PaddleOCR somente quando `complementaryOcr` é solicitado; Tesseract permanece como opção legada para `enableOcr`.
- O worker PaddleOCR é encerrado em `finally` após a extração, evitando processo órfão.

### Tiling e orçamento no caminho produtivo

- `apps/aethera-desktop/src/main/aethera-ipc.ts:5440` integra `createTiledPanelProvider` ao provider local quando o job mantém o tiling habilitado.
- A configuração usa um worker, `maxVramMb=6500`, máximo conservador de dois fallbacks CPU, cache por bloco e OCR por evidência limitado a 12 chamadas.
- `apps/aethera-desktop/src/main/aethera-ipc.ts:5893` converte limites de UI em `RecapJobBudget`; o orçamento persistente é checado antes de novas chamadas e desconhecidos continuam desconhecidos.
- O limite principal é compartilhado pelo `RecapUsageTelemetry`/`RecapBudgetController`; o budget local do tiling é uma segunda barreira conservadora, não uma substituição do ledger principal.

### Fidelidade estrita e continuidade

- `packages/cinema/src/recap/story-engine.ts:217` bloqueia a geração de roteiro quando `strictFidelity` encontra análises abaixo do limiar de confiança. O bloqueio ocorre antes do script, sem remover painéis.
- `packages/cinema/src/recap/phase5/recap-production-orchestrator.ts:779` encaminha a opção persistida para o Story Engine.
- Regenerações de cena/roteiro reutilizam `analysisSettings` do projeto e o cache de análise existente.

### Desktop, Web e Remote Host

- `apps/aethera-desktop/src/renderer/src/RecapProductionPanel.tsx:2927` envia as opções por job e mostra estado local sem expor credenciais, caminhos ou logs internos.
- `apps/aethera-desktop/src/main/aethera-ipc.ts:5919` persiste as opções no registro durável; o job continua pertencendo ao processo principal, não ao ciclo de vida do React.
- `apps/aethera-remote-host/src/contracts/v1.ts:153` adiciona ao handshake OCR, worker e limite de VRAM como campos opcionais compatíveis.
- `apps/aethera-remote-host/src/agents.ts:284` verifica somente a instalação do pacote PaddleOCR, sem baixar modelo ou executar inferência, e mantém separada a prova de capacidade visual do Ollama.
- A observação, pausa, cancelamento, reconexão e retomada Web/Remote Host continuam apoiadas nos jobs duráveis existentes. Não foi feito E2E ao vivo nesta fase; a evidência executada é de contrato/mock.

## Evidências dos artefatos existentes

Smoke test somente leitura, executado em 2026-11-24:

- Manifesto inicial: 40 painéis declarados, 40 hashes SHA-256 verificados, 0 divergências.
- Manifesto da expansão: 20 painéis declarados, 20 hashes SHA-256 verificados, 0 divergências.
- Expansão 4B.9: 20 painéis, 23 blocos, 27 chamadas, 0 cache hits na execução inicial, 0 CPU fallback, 0 retries, 0 APIs externas, pico 6.171 MiB, 434.812 ms.
- Retomada do piloto inicial: 40 cache hits, 0 novas chamadas, 0 novas OCR, 87 ms no ledger de verificação.
- Estado agregado informado pelos artefatos das Fases 4B.8–4B.9: 54 painéis verificados, 6 em revisão, 0 rejeitados.

### Performance — sem benchmark novo

A diferença observada anteriormente permanece uma hipótese operacional, não um novo benchmark: aproximadamente 200 s para 40 painéis contra 434.812 ms para 20 painéis novos. O ledger da expansão mostra custo concentrado em chamadas de análise/tile, com 4 OCR adicionais e pico de VRAM dentro do limite; os artefatos não isolam de forma suficiente carregamento do modelo, tokens visuais, tiling e overhead do runner para afirmar uma causa única. Não foi executado benchmark adicional.

## Testes executados

Passaram:

- `npx tsx --test packages/cinema/test/recap/phase4b10-text-classification.test.ts` — 5/5.
- `npx tsx --test packages/cinema/test/paddleocr-adapter.test.ts` — 5/5, incluindo cache após restart, falha, timeout, cancelamento e ponte para o extrator.
- `npx tsx --test apps/aethera-remote-host/test/phase4a-capabilities.test.ts` — 3/3.
- `npx tsx --test packages/orchestrator/test/panel-tiling.test.ts` — 16/16.

Typecheck focado:

- `packages/orchestrator` e `apps/aethera-remote-host`: sem erro reportado.
- `packages/cinema` e Desktop ainda têm falhas preexistentes do worktree. Entre elas estão dependências `vitest` ausentes no ambiente, erros anteriores em `manga-vision-analyst.ts:727`, incompatibilidades antigas de tipos em módulos de calendário/recap audiovisual e erros já existentes em `aethera-ipc.ts`/`RecapProductionPanel.tsx`. Nenhum erro novo foi apontado nas linhas novas de classificação, PaddleOCR, orçamento, tiling ou handshake.

## Gates e bloqueios

- Gate de classificação: aprovado nos testes unitários.
- Gate de integridade dos checkpoints: aprovado no smoke test somente leitura.
- Gate de fidelidade narrativa: **não aprovado para os seis casos pendentes**; 54/60 continuam utilizáveis conforme os artefatos, mas os seis ainda exigem revisão/evidência adicional.
- Gate H/I/J e master: não executados nesta fase por restrição explícita; não há aprovação de vídeo.

O modo estrito agora impede que análises abaixo do limiar avancem silenciosamente para roteiro. Portanto, uma produção com os checkpoints atuais e `strictFidelity=true` deve pausar/falhar antes do script enquanto os painéis bloqueantes permanecerem sem evidência suficiente.

## Arquivos modificados nesta fase

- `packages/cinema/src/recap/recap-types.ts`
- `packages/cinema/src/recap/recap-text-classification.ts`
- `packages/cinema/src/recap/dialogue-extractor.ts`
- `packages/cinema/src/recap/recap-vision-adapter.ts`
- `packages/cinema/src/recap/manga-vision-analyst.ts`
- `packages/cinema/src/recap/narrative-analyzer.ts`
- `packages/cinema/src/recap/story-engine.ts`
- `packages/cinema/src/recap/phase5/recap-production-orchestrator.ts`
- `packages/cinema/src/recap/paddleocr-adapter.ts`
- `packages/cinema/src/recap/index.ts`
- `packages/cinema/test/recap/phase4b10-text-classification.test.ts`
- `packages/cinema/test/paddleocr-adapter.test.ts`
- `apps/aethera-desktop/src/main/aethera-ipc.ts`
- `apps/aethera-desktop/src/renderer/src/RecapProductionPanel.tsx`
- `apps/aethera-desktop/src/renderer/src/recap-timeline-model.ts`
- `apps/aethera-remote-host/src/agents.ts`
- `apps/aethera-remote-host/src/contracts/v1.ts`
- `apps/aethera-remote-host/test/phase4a-capabilities.test.ts`

Esses arquivos já continham alterações de sessões anteriores; não foram commitados nem descartados. O relatório é a única nova documentação criada por esta fase.

## Recomendação para a Fase 4B.11

Não ampliar o capítulo nem liberar master ainda. Primeiro executar um smoke controlado de um job de produção com `strictFidelity=true`, usando checkpoints válidos, orçamento explicitamente configurado e apenas o host local/Remote Host que comprovar Ollama + PaddleOCR. A promoção dos seis painéis deve ocorrer somente após evidência visual/ textual independente; especialmente `p1_3` pode ser preservado como fragmento não narrativo sem virar fato, enquanto `p1_1`, `p7_0` e `p13_3` precisam deixar de contaminar a fala. Nenhuma economia de tokens adicional é declarada sem telemetria de produção.
