# Fase 36 — Validação final (36.9)

**Data:** 2026-11-01. **Decisão: FASE 36 CONCLUÍDA.** Jornada real com voz ElevenLabs e vídeo próprio aprovada; YouTube e VoiceStudio reais homologados; baseline aprovada e gates finais verdes.

## YouTube real homologado (2026-11-01)

`tests/e2e/velix-youtube-real.spec.ts`, com `NB_REAL_YOUTUBE=1`, chave do usuário e trace desligado:

- Busca real: 25 vídeos, com URL `youtube.com/watch`, título, canal e data válidos.
- Origem conferida fora do app: o oEmbed público do YouTube confirmou o canal do primeiro resultado.
- Paginação: segunda página real com outros resultados.
- Filtros: período de 30 dias conferido nas datas; `videoLicense=creativeCommon` enviado à API. A licença é a declarada pela plataforma e não prova titularidade.
- Cache: repetir a busca não chamou a API.
- Persistência: 73 referências sem duplicatas, recuperadas após reiniciar, sem nenhum direito concedido automaticamente.
- Erro: chave inválida vira `status: error`, sem resultados e sem expor a chave.
- Cota real e HTTP 429 seguem cobertos só por simulação; não foram provocados de propósito.
- A busca passou pelo IPC real do app, não por clique na tela; a tela usa o mesmo canal e foi testada com feed.
- Nenhum arquivo do repositório nem de `test-results` contém a chave.

Com isso, o item 1 do conjunto para encerrar está concluído.

## Atualização — lacunas implementadas (2026-11-01)

**Decisão vigente: FASE 36 ABERTA, somente por pendências externas e por gates de outras frentes.** Substitui a lista de lacunas internas abaixo, mantida como histórico.

**Implementado e testado**

| Subfase | Entrega | Evidência |
|---|---|---|
| 36.1 | `VELIX_LIMITS`: 500 MB, 4 h, 2 threads FFmpeg, timeouts de análise e render, 2 jobs simultâneos | Aplicados em análise, render e IPC |
| 36.2 | Filtros de subtema, palavras-chave, plataforma, duração, estilo, público, período e direitos; paginação; cache de 15 min; 429 e cota; cancelamento | `velix-gaps.spec.ts`; adaptador |
| 36.3 | Radar por janela de 7, 30 e 90 dias, rotulado como medição das fontes do projeto | `velix-gaps.test.ts` |
| 36.4 | `conditional`, histórico, exceção legal com revisão humana, créditos em `creditos.txt`; render confere o direito vigente | E2E de revogação |
| 36.5 | Miniaturas, energia de áudio, favoritos | FFmpeg real em `velix-gaps.test.ts` |
| 36.6 | Fade, música autorizada, prévia, log e cancelamento | E2E pela interface; cancelamento por teste de abort no render |
| 36.7 | Ranking com critério, cartões de posição, classificação de cada fonte, seleção de fontes | E2E pela interface |
| 36.8 | Waveform, arquivo malformado, offline, mídia longa | E2E, `velix-long-media.test.ts` |

Mídia longa: 1 hora sintética (85 MB) analisada em 5,5 s e 30 s renderizados em 1,3 s. O vídeo tem baixa complexidade, então é um limite inferior, não uma estimativa para gameplay real.

**Defeitos reais encontrados pelos testes**

- O Rights Manager gravava o direito, mas o retorno violava o contrato, e a tela nunca atualizava.
- O render conferia o status gravado no asset, não o direito atual: revogar não tinha efeito.
- A lista exibia o direito mais antigo; a ordenação por segundo podia empatar registros.
- A referência do arquivo local aparecia como notícia no Noticiário.
- O log do render não aparecia ao terminar.
- `maxBuffer` de 4 MB podia estourar com mídia longa.

**Pendente**

- [ ] Externo: YouTube real, com `NB_YOUTUBE_API_KEY`. Filtros, paginação, 429 e cota do YouTube têm só teste simulado.
- [ ] Externo: jornada com voz ElevenLabs e vídeo próprio reais.
- [ ] Parcial: legendas queimadas no render de cortes não foram feitas, por exigirem alinhamento fala-texto; o render Dossiê usa blocos de texto por cena.
- [ ] Não aplicável hoje: transcrição no Clip Hunter. O plano a condiciona a recurso disponível, e o Clip Hunter não tem um.
- [ ] Parcial: cancelamento e log cobrem o render de cortes; o caminho Dossiê usa os jobs de render existentes.
- [ ] Não verificado: `Reutilizar TaskEngine, permissões, projeto ativo, isolamento, histórico e Neural Brain`. As operações do Velix rodam fora do TaskEngine.
- [ ] `velix-visual.spec.ts`: baseline não alterada. A tela mudou de propósito e outros 6 specs visuais também falham, então a aprovação visual é sua.

**Gates desta rodada**

| Gate | Resultado |
|---|---|
| Velix, Video e lacunas (E2E) | Aprovados; 8 ignorados na suíte por dependerem de flags reais |
| Vitest em série | 121 arquivos, 970/970 |
| Build | Aprovado |
| Typecheck | Falha fora do Velix: `GitIntelligencePage.tsx:8` importa `@neuralbridge/shared` no renderer |
| ESLint | Falha fora do Velix: `test-git-validation-enhanced.cjs`. Os arquivos Velix passam |
| Playwright completo | 168 aprovados, 8 ignorados, 30 falhas: 1 visual do Velix, as demais fora do Velix |

**Menor conjunto para encerrar**

1. Definir `NB_YOUTUBE_API_KEY` e rodar uma busca real.
2. Rodar a jornada com um áudio ElevenLabs e um vídeo próprios.
3. Aprovar visualmente a tela do Velix e atualizar a baseline.
4. Estabilizar as frentes 38 a 41 e rerodar os gates.

## Estado de prontidão

| Requisito | Estado | Evidência |
|---|---|---|
| Claude real | Aprovado | Quota 1% na semana e 9% em 5 h depois do reinício. Em 2026-10-31 estava em 99% e nada foi gerado. |
| Codex real | Aprovado, com ressalva | Ver abaixo. Teve limite de uso temporário em uma rodada anterior. |
| RSS/Atom real | Aprovado | BBC e NASA em E2E; seis feeds no adaptador. |
| YouTube real | Bloqueado por dependência externa | `NB_YOUTUBE_API_KEY` ausente no ambiente e nas variáveis de usuário e máquina. Nenhuma busca real foi executada. |
| Revisão de fontes | Aprovado | Testes de contorno e jornada real. |
| Direitos e aprovação editorial | Aprovado | E2E e jornada: nada é aprovado sem ação explícita. |
| Pipeline audiovisual | Aprovado com material sintético | FFmpeg e FFprobe reais; narração e vídeo são fixtures. |
| ElevenLabs real | Não executado | Fluxo manual: exige áudio gerado por você. |
| `chat-real.spec.ts` | Falhou, fora do Velix | Ver "Chat real". |

## Operações reais executadas

Cada linha é uma execução real; todas registraram `executionId` do provider.

| Provider | Operação | Resultado | Metadados |
|---|---|---|---|
| Claude | Roteiro | Aprovado | `model=claude-opus-5-5` |
| Claude | Pesquisa com busca web | Aprovado, 10 referências, 0 rejeitadas | `model=claude-opus-5-5` |
| Claude | Ideias | Aprovado, 3 ideias | `model=claude-opus-5-5` |
| Claude | Cancelamento | Aprovado, código `cancelled` | — |
| Claude | Roteiro pela interface, gravado na versão editorial | Aprovado | `agent=claude`, `model=claude-opus-5-5` |
| Claude + Codex + feed NASA | Jornada completa | Aprovada em 2,1 min | Roteiro `claude-opus-5-5` |
| Codex | Pesquisa com busca web | Aprovado, 7 referências, 0 rejeitadas | `model=null` (o CLI não informa) |
| Codex | Ideias | Aprovado, 3 ideias | `model=null` |
| Codex | Cancelamento | Aprovado, código `cancelled` | — |
| Codex | Roteiro | 1 falha fora do contrato, depois 3 de 3 aprovados | `model=null` |

O limite temporário do Codex foi observado em 2026-10-31 (`provider_limit` classificado por teste de contrato com a mensagem real). Não foi forçado de novo, e failover silencioso é coberto por E2E simulado com quota a 97%.

Não houve Claude real para Investigar pela interface: Investigar real foi feito com Codex, e a pesquisa real com Claude usa a mesma função `runVideoResearch`.

## Jornada audiovisual

`tests/e2e/velix-journey.spec.ts`, rodada real com `NB_REAL_JOURNEY=1 NB_REAL_JOURNEY_CLAUDE=1`:

| Etapa | Execução |
|---|---|
| 1. Projeto | Real |
| 2. Pesquisa | Real, feed da NASA, 10 itens |
| 3. Ideia | Real, Codex |
| 4. Investigar | Real, Codex, 8 fontes pendentes |
| 5. Revisão de fontes | Real, uma aprovada e uma rejeitada pela interface |
| 6. Brief | Real, não aprovado até a ação explícita |
| 7. Roteiro | Real, `claude-opus-5-5` |
| 8. Aprovação do roteiro | Real; render bloqueado até aprovar |
| 9. Narração | **Sintética**: tom gerado por FFmpeg em `narracao/voz.m4a`, não ElevenLabs |
| 10. Cortes | Real pelo Clip Hunter, sobre vídeo **sintético** próprio |
| 11-12. Timeline e MP4 | Real, FFmpeg, 2 s |
| 13. FFprobe | Real: streams de vídeo e áudio, duração maior que zero |
| 14-15. Reinício e persistência | Real: fontes, rejeição, aprovações e MP4 |

## Revisão humana de fontes

Coberto por `velix-discovery-repository.test.ts`, `velix-contract.test.ts` e pela jornada.

- Fonte de agente entra pendente e não aparece em `listProject`, Rights Manager, Produzir, ideias nem conversão.
- Aprovar de outro projeto, reaprovar uma rejeitada e rejeitar uma aprovada falham com `not_found`.
- Rejeitada continua conhecida, então não volta em nova busca.
- Ideia que cita fonte pendente perde a URL, e o fato vira hipótese.
- Reinício preserva os estados. A origem agora aparece na revisão (agente e execução) e no Rights Manager.

Risco residual: `video:production:brief` e `references` do render aceitam itens enviados pelo renderer. O renderer é confiável e usa só fontes aprovadas, mas o processo principal não reconfere essa lista.

## Chat real

Executado com quota disponível, depois de corrigir dois seletores do teste. O fluxo real concluiu 8 etapas de Codex e Claude e criou `soma.js`, mas terminou em "Falhou": o revisor Claude recusou aprovar porque o comando de aceite `node -e` não pôde rodar sem aprovação. Falha conservadora de permissão e revisão, fora do Velix. Não foi repetido nem alterado no TaskEngine. Continua fora do CI local, atrás de `NB_REAL_CLI=1`.

## Checklists reconciliados

Marcados no subplano apenas os itens com evidência. Pendentes, por seção:

| Seção | Parcial ou ausente |
|---|---|
| 36.1 | Limites formais de armazenamento, CPU e memória: só há timeouts |
| 36.2 | Filtros de plataforma, duração, estilo, público e período; paginação na interface; cache com validade; tratamento de quota e 429; cancelamento de busca; YouTube real |
| 36.3 | Radar por janela temporal: só há contagem de 7 dias por ideia |
| 36.4 | `conditional` sem ação na interface; histórico auditável de direitos; atribuição obrigatória no render; revisão de exceções legais sem fluxo próprio |
| 36.5 | Thumbnails; energia de áudio; transcrição; favoritos; limites de recursos |
| 36.6 | ElevenLabs real; transições, captions e música; prévia, progresso, logs e cancelamento na aba Produzir |
| 36.7 | Ranking com critérios e cartões de posição; reclassificar fato e alegação na interface |
| 36.8 | Waveform; medição em mídia longa; teste de arquivo malformado; estados de offline em E2E |

## Quality gates

Rodada de 2026-11-01, com outras frentes (fases 38 a 41) alterando a árvore:

| Gate | Resultado |
|---|---|
| Vitest em série | 120 arquivos, 955/955 |
| Build | Aprovado |
| `git diff --check` | Aprovado |
| Typecheck | **Falha externa à Fase 36**: `GitIntelligencePage.tsx` importa `@neuralbridge/shared`, puxando `paths.ts` para o renderer |
| ESLint | **Falha externa à Fase 36**: `test-git-validation-enhanced.cjs` na raiz |
| Playwright completo | 157 aprovados, 8 ignorados, 33 falhas |
| Velix e Video isolados | 30 aprovados, 3 ignorados, 0 falhas, depois da correção do teste de cancelamento |
| `velix-visual.spec.ts` | **Falha**: 2% de pixels em `velix-1024x768.png`. Snapshot não atualizado |

Das 33 falhas, as maiores causas são externas ao Velix: 14 por `getByLabel('Agente')` ambíguo, mudança concorrente no chat e na tela de Git; as demais incluem snapshots e artefatos de trace removidos durante a rodada. A falha do cancelamento era o card dos Guided Tours sobre o botão, já tratada no teste. A diferença visual do Velix foi tratada como não diagnosticada: pode vir do card ou da navegação, e a baseline não foi alterada.

Correção fora do escopo, registrada: removi um `})` excedente em `packages/shared/src/ipc.ts`, em edição não commitada da frente de Git, porque impedia todos os testes de compilar. Nenhuma regra de validação mudou. `packages/shared/test/ipc.test.ts` teve uma falha de referência Git enquanto essa frente estava em andamento e passou na rodada final.

## Decisão

**FASE 36 ABERTA.** O aceite principal (seção 1) está demonstrado com Claude e Codex reais, salvo a voz e o vídeo reais, mas os critérios não estão todos comprovados.

**Bloqueio externo:**

1. Chave do YouTube em `NB_YOUTUBE_API_KEY`.
2. Um áudio real do ElevenLabs e um vídeo próprio para repetir a jornada.

**Bugs e lacunas internas da Fase 36:**

1. Lacunas da tabela acima. Elas pedem uma decisão de escopo, não necessariamente implementação.
2. Diagnosticar a diferença de `velix-1024x768.png`.

**Fora da Fase 36, mas impedem gates limpos:** typecheck, ESLint e as falhas de Playwright das fases 38 a 41; o caso de `chat-real`.

**Menor conjunto de ações para concluir:**

1. Definir a chave do YouTube e rodar uma busca real.
2. Repetir a jornada com voz e vídeo reais.
3. Decidir quais itens da tabela de pendências ficam obrigatórios e quais vão para fases futuras (a Fase 39 já trata do motor de vídeo).
4. Estabilizar as frentes 38 a 41 e rerodar os gates.

---

## Registro da rodada anterior (preservado)

Superado pela decisão acima; mantido como histórico.

# Fase 36.9 — Homologação externa e encerramento do Velix

Data da consolidação: 2026-10-31

### Rechecagem externa — retomada 36.9 (2026-10-31)

Não houve nova chamada de provider. `claude auth status` confirmou sessão autenticada em `claude.ai`/Pro, mas o comando não informa a quota semanal; a última evidência válida continua sendo o bloqueio da trava de 95%. `NB_YOUTUBE_API_KEY` permanece ausente. Portanto, nenhum teste anteriormente ignorado ganhou dependência disponível e nenhum quality gate local foi repetido nesta retomada.

### Decisão

**Fase 36 permanece aberta.** Os fluxos locais de produção, direitos, aprovação editorial, MP4, áudio e recuperação foram comprovados nos registros anteriores. A homologação integral não pode ser declarada porque o YouTube continua sem credencial, o Claude continua sem quota disponível para o fluxo real e há gates locais atuais que não estão limpos.

### Evidências recuperadas

| Categoria | Resultado | Evidência |
|---|---|---|
| Simulado/fixtures | Aprovado | E2E e Vitest documentados nos checkpoints da Fase 36; contratos e cancelamento cobertos. |
| Codex real | Parcial/aprovado nas rodadas registradas | `agent=codex`, `executionId` real e `model=null`; ideias 3/3 e Investigar real aprovados; roteiro real registrado como instável (2/3). |
| Claude real | Bloqueado | A execução anterior foi recusada pela trava de 95%/quota semanal; `claude auth status` atual confirma login, mas não fornece quota e não foi feita chamada pagante. |
| RSS/Atom real | Aprovado | BBC, NASA, g1, GitHub Releases, The Verge e arXiv; persistência/deduplicação/recuperação documentadas. |
| YouTube real | Bloqueado externo | `NB_YOUTUBE_API_KEY` ausente; nenhuma busca real foi substituída por fixture. |
| MP4/renderização | Aprovado localmente | Dois modos editoriais com FFprobe, áudio AAC e bandas espectrais 440/880 Hz e 660/990 Hz. |
| Reinício/isolamento | Aprovado localmente | E2E anterior 7/7 e recuperação de versões/editorial state entre processos/projetos. |

### Matriz final de homologação externa

| Requisito | Evidência | Resultado | Bloqueio |
|---|---|---|---|
| Ideias com Claude real | `claude auth status` autenticado; não há quota exposta | Não homologado nesta retomada | Quota semanal/trava de 95%; sem chamada adicional segura |
| Pesquisa com Claude real | Contrato e adapter cobertos localmente; provider real anterior não executado | Não homologado | Mesma quota do Claude |
| Roteiro com Claude real | Teste E2E `roteiro real do Claude...` permanece ignorado | Não homologado | Mesma quota do Claude |
| Chat real com Claude | `chat-real.spec.ts` permanece condicionado a `NB_REAL_CLI=1` e quota | Não homologado | Não executar sem quota disponível |
| Busca oficial real no YouTube | Variável `NB_YOUTUBE_API_KEY` ausente | Não homologado | Credencial externa ausente |
| Metadados YouTube/proveniência | Não há resposta real sem credencial | Não homologado | Dependência anterior |
| RSS/Atom real | Feeds públicos e persistência já registrados | Aprovado | Nenhum; preservado |
| Codex real | Ideias/Investigar e execution IDs registrados anteriormente | Parcial/aprovado conforme escopo | Roteiro Codex anterior instável; não repetido sem necessidade |
| MP4, aprovação, cancelamento, reinício e isolamento | E2Es locais anteriores e 36.9-S | Aprovado localmente | Nenhum |

### Gates recuperados e executados agora

- Recuperados: Vitest global, Playwright global, typecheck, lint, build e `git diff --check` documentados no checkpoint da Fase 37; não repetidos quando não invalidados por mudança posterior.
- Executados agora: `npm run typecheck` **passou**; `npm run build` **passou**; `git diff --check` **passou**.
- `npm run lint` passou após substituir as duas non-null assertions por narrowing explícito em `packages/workspace/test/git-history.test.ts`. A correção é somente de teste e não altera runtime.
- Reprodução individual dos quatro testes E2E anteriormente falhos: **4/4 passaram**.
- Reexecução do arquivo completo `tests/e2e/velix-discovery.spec.ts --workers=1`: **12 passaram, 3 ignorados, 0 falhas**. Os ignorados continuam sendo os cenários externos condicionais.
- Testes Vitest diretamente afetados: **3 arquivos, 27/27 testes passaram**; typecheck e `git diff --check` passaram novamente.
- Causa das quatro falhas anteriores: a primeira rodada coexistiu com processos Node antigos e outro Playwright sobrescreveu `test-results`; a segunda rodada isolada não reproduziu o defeito. Não há evidência de falha em IPC, FFmpeg, fixtures, persistência ou sincronização do Velix.

### Checklists 36.1–36.8

Os itens foram reconciliados contra código, testes e evidências existentes. Foram considerados concluídos apenas os critérios com teste/evidência; ideias/Investigar, Claude real e YouTube permanecem parciais ou bloqueados conforme a matriz da Fase 36. A presença de implementação isolada não foi tratada como aprovação.

### Pendências objetivas

1. Disponibilizar `NB_YOUTUBE_API_KEY` por configuração externa segura e executar a busca oficial real.
2. Disponibilizar quota Claude abaixo da trava do produto e executar o mínimo de ideias, roteiro e `chat-real`, registrando `executionId` e `model` quando fornecidos.
3. Manter a execução E2E serializada (`--workers=1`) para evitar colisão de processos/artefatos; não usar retries para mascarar falhas.

Não foram criados commits, não foram feitas chamadas externas pagas adicionais e a Fase 37 concluída foi preservada.

## Subfase 36.10 — auditoria do VoiceStudio local (2026-11-01)

A auditoria foi concluída antes de qualquer implementação. A documentação oficial do VoiceStudio descreve uma API local versão 0.5.0 em `http://localhost:3900`, com contrato OpenAI-compatible `POST /v1/audio/speech`, campos `model`, `voice`, `input` e `response_format`. O serviço depende do aplicativo VoiceStudio estar iniciado localmente; não há endpoint hospedado ou chamada de nuvem no contrato auditado.

O repositório oficial declara AGPL-3.0 para o aplicativo. Modelos, vozes e saída gerada podem possuir licenças próprias e precisam ser avaliados individualmente. Portanto, não foi adicionado provider, dependência, binário ou integração de distribuição nesta subfase. ElevenLabs permanece o provider alternativo já suportado.

Critérios para uma futura implementação: adapter isolado atrás do contrato comum de TTS, health check explícito em `localhost:3900`, timeout/cancelamento, nenhum fallback silencioso, preservação do provider ElevenLabs, validação das licenças do app/modelo/voz/saída e decisão jurídica sobre distribuir ou apenas conectar a uma instalação externa AGPL. A jornada real de áudio ElevenLabs + vídeos próprios e a validação da instalação limpa continuam pendentes; esta auditoria não encerra a Fase 36.

## Provider VoiceStudio e jornada de mídia real (2026-11-01)

Foi implementado um adapter opcional filesystem-first em `packages/workspace/src/velix-narration.ts`, com contratos compartilhados, health check compatível com o contrato 0.5.0, descoberta de modelos/vozes, geração OpenAI-compatible, validação de áudio, sidecar, prévia e timeline. A integração é loopback-only, não instala nem distribui VoiceStudio e preserva ElevenLabs/manual. O processo principal é o único chamador da API; o renderer acessa apenas IPC tipado.

Testes locais contra servidor HTTP loopback real cobrem descoberta, geração, licenças, persistência e prévia. O teste `tests/integration/voicestudio-real.test.ts` executa somente com `NB_VOICESTUDIO=1` e exige confirmação externa de licenças. Nesta rodada `localhost:3900/health` não respondeu dentro do timeout, portanto a homologação real continua bloqueada.

`tests/e2e/velix-journey.spec.ts` aceita `NB_ELEVENLABS_AUDIO`, `NB_ELEVENLABS_TEXT` e `NB_VELIX_OWN_VIDEO` para substituir as fixtures sintéticas por arquivos reais. Essas variáveis não estavam disponíveis nesta execução; o critério de áudio ElevenLabs + vídeo próprio permanece aberto.

## Homologação final de mídia real (2026-11-01)

Jornada com Claude e Codex reais, feed RSS real, áudio ElevenLabs de 109,2 s, vídeo próprio de 12,8 s e kit Velix real: sincronização pelo transcritor, MP4 de 110 s com vídeo e áudio conferido no FFprobe e persistência após reiniciar. VoiceStudio 0.5.7 com a voz clonada do usuário gerou e validou a narração. O motor OmniVoice declara pesos CC-BY-NC.
