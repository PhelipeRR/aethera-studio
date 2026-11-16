# Aethera Studio — Fontes de mídia (registry de providers)

Data: 2026-11-15. Código: `packages/cinema/src/analysis/media-providers/` (commit 81df3cd) e `apps/aethera-desktop/src/main/media-sources-service.ts` + `MediaSourcesSettings.tsx` (commit 49b4399).

## Arquitetura

- **Adapter comum** (`types.ts`): `search` paginado, categorias/filtros, preview, aquisição (`direct_http` | `yt_dlp` | `hls` | `none`), licença + proveniência, `healthCheck`, `AbortSignal`.
- **Resiliência** (`resilience.ts`): rate limiter de janela deslizante por provider (com pausa por `Retry-After`), retry só para erros retentáveis, circuit breaker (fechado → aberto → meio-aberto), cache TTL (Pixabay 24 h, conforme os termos; demais 30 min) e deduplicação por asset (`id` + URL de aquisição).
- **Classificação** (`classification.ts`): classes legadas do provider. Detecção de IA tem precedência e mídia `ai_generated` nunca vira screenshot oficial nem gameplay real. Trailers do YouTube só ganham alta confiança em canal oficial do publisher. Vídeo do YouTube sem sinais vira `unclassified_video`, **nunca** `stock_video`. Em domínio anime, títulos com marcador explícito de jogo (`game`, `gameplay`, `steam`…) sem marcador forte de anime são classificados como jogo, não como footage do anime.
- **Contratos semânticos** (`semantic-media.ts`, 2026-11-16): cinco dimensões independentes.
  - *Domínio de conteúdo* (`anime | game | movie | series | technology | documentary | generic`), inferido do briefing + cena, ou declarado em `SceneSourceContext.projectDomain`. O formato narrativo (`gameplay_essay`, `top_list`, `documentary`) **não é domínio**: no máximo `gameplay_essay` soma +1 para jogo.
  - *Tipo de mídia* (`anime_footage | gameplay | game_trailer | movie_footage | promotional_artwork | screenshot | stock_video | image | unknown`), derivado da evidência do próprio item.
  - *Identidade* (obra esperada × detectada, confiança, evidências, ambiguidades). Registro do provider ou análise visual são evidência; título é só indício (`probable`) e sempre exige confirmação por frames.
  - *Papel editorial máximo* antes dos frames (`literal_evidence | contextual_broll | transition | background`). Jogo derivado de anime nunca comprova cena do anime.
  - *Proveniência e direitos*: só o que a licença do provider atesta. `inferredFromTitle` é sempre `false`; canal de anime reconhecido pelo nome aumenta a confiança de identidade, mas **não** concede `publisher_promotional`.
- **Seleção por domínio** (`source-selection.ts`): `game_specific` → Steam, IGDB, YouTube; `game_ranking` → Steam, YouTube, com IGDB só para pesquisa; `anime_identity` → YouTube (Sakugabooru pelo adapter de anime; **nunca** Steam/IGDB); `screen_identity` (filme/série nomeado) → YouTube; `named_subject` (domínio incerto com obra nomeada) → YouTube, depois stock (que não prova identidade); `anime_reaction` → nekos.best, kawaii.red; `generic_broll` → Pexels, Pixabay; `dataset_research` → HF Datasets.
- **Gate de fidelidade** (`assessCandidate`): rejeita só o quase certo — IA em cena de identidade, stock em cena de identidade, tipo incompatível, fã/conceito (confiança < 0,2) e obra diferente declarada pelo provider ou detectada com confiança ≥ 0,6. Tipo `unknown` segue para análise visual em vez de ser descartado. Passar no gate nunca aprova a mídia.
- **Recuperação** (`registry.searchForScene`): se a consulta original não atinge `minResults`, até `maxRecoveryQueries` (padrão 2) consultas reformuladas por `buildSemanticQueries` (título canônico + evento, personagens, títulos alternativos, tipo de mídia, idioma), uma por estratégia, sem repetir consulta. Os mesmos gates valem para os resultados. O registro fica em `SceneSearchResult.recovery`.
- **Pontuação**: entidades contam por palavra inteira (`Magi` não pontua `Magicka`).
- **Propagação do briefing** (2026-11-16): `resolveProjectDomain` reconcilia `PromptInterpretation.domain` (regex que testa jogo antes de anime) com a inferência semântica do prompt e das obras pesquisadas; uma inferência clara e não ambígua prevalece. `workReferenceForScene` gera, por cena da decupagem, `work` = obra única da cena (cenas de visão geral com várias obras não têm título canônico, porque o rótulo da lista não é obra), personagens/técnicas, acontecimento e idioma. O desktop passa `projectDomain` ao contexto do registry e a `runAutonomousMediaAcquisition`, e `work` a cada segmento. Projetos antigos sem esses campos continuam com a inferência por cena.
- **Aprovação por cena** (`media-approval.ts`): após o Media Relevance Gate, `buildSceneMediaApproval` registra em `AutonomousAcquisitionAuditReport.mediaApprovals` quatro veredictos independentes por mídia × cena — *identidade* (aprovada só por frames ou consulta de proveniência, nunca por título/canal), *correspondência literal* (identidade + `exact_match` + intervalos com timestamps comprobatórios), *apoio contextual* e *autorização de uso* (só a licença). A camada confirma ou rebaixa o gate, nunca o promove: frames que mostram outra obra viram `wrong_anime_or_entity`; mídia cujo teto pré-download não comprova a cena (jogo derivado de anime) vira apoio contextual. O gate compara entidades do prompt por palavra inteira (antes, `com` casava dentro de `combate`).
- **E2E real**: `npx tsx scripts/aethera-frieren-reference-e2e.ts <pastaDeSaída>` executa briefing → domínio → registry → yt-dlp → ffprobe/ffmpeg → gate → aprovação com o vídeo de regressão. Sem provedor de visão semântica acessível, o analisador extrai os frames reais e falha explicitamente; o candidato fica `pending_visual_verification`, sem aprovação.
- **Gate de licença** (`licensing.ts`): `blocked`, `pending_human_review` (termos desconhecidos, direitos de terceiros, material promocional sem opt-in editorial) ou `allowed[_with_restrictions]`. Acesso público ≠ reuso livre.
- **Pipeline** (`resilient-media-sources.ts`): o registry entra na descoberta. O Media Relevance Gate continua decidindo relevância, sem nenhum threshold alterado. Uma mídia relevante com licença pendente vai para `pendingLicenseReview` e **não** é aprovada; o resultado de cada gate é preservado.
- **Desktop**: credenciais via `StudioSecretStore` (safeStorage). O renderer só recebe uma dica mascarada (`••••1234`). Os logs do Console de Produção são roteados por `jobId`; eventos sem job são descartados.

## Status dos providers

| Provider | Status | Evidência / justificativa |
|---|---|---|
| Steam Storefront | **Operacional** (sem chave) | Busca e aquisição reais: screenshot 349 KB por HTTP; trailer HLS → clipe de 12 s, 8,2 MB (ffmpeg) |
| nekos.best | Operacional para busca; **aquisição bloqueada** | Os ToS proíbem download automatizado e uso comercial: os itens saem como `license_blocked` |
| kawaii.red | Operacional (token anônimo) | Busca real ok; licença desconhecida, então tudo vai para `pending_human_review` |
| Hugging Face Datasets | Operacional (somente metadados) | Busca real ok; aquisição `none`, porque a licença varia por dataset |
| IGDB | Implementado; **não validado ao vivo aqui** | Usa o `IgdbClient` existente; depende de Client ID/Secret Twitch |
| YouTube Data API v3 | Implementado; **pendente de chave** | Testado só com mocks |
| Pexels | Implementado; **pendente de chave** | Testado só com mocks |
| Pixabay | Implementado; **pendente de chave** | Testado só com mocks |
| RAWG | Legado, desativado por padrão | Mantido para compatibilidade |
| waifu.pics | **Desativado permanentemente** | DNS NXDOMAIN; o domínio hoje hospeda spam de apostas |
| shadorki/anime-reaction-api | **Desativado permanentemente** | O servidor recusa conexões; repositório inativo desde 2023-01; sem licença |
| Mixkit | **Desativado permanentemente** | Não há API oficial (`/api` → 404); scraping não autorizado está fora de escopo |

Validação real: `npx tsx scripts/media-providers-live-check.mts`. Providers com chave rodam quando há `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `YOUTUBE_API_KEY`, `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`. O relatório sai em `artifacts/media-providers-live/live-check-report.json`.

## Fallback observado (2026-11-15)

- **"Cyberpunk 2077"** → `game_specific`. IGDB e YouTube foram `skipped_no_auth` e a Steam respondeu: 4 itens aceitos.
- **"Tecnologia"** → `generic_broll`. Pexels e Pixabay estavam sem chave e não houve substituição silenciosa: 0 aceitos, e a cena fica pendente de revisão.
- **Reação de anime** → nekos.best bloqueado por licença; kawaii.red aceito como `pending_human_review`.

## Pendências

- Chaves de YouTube, Pexels e Pixabay; credenciais IGDB para a validação ao vivo.
- A ligação IPC/preload/pipeline (`aethera-ipc.ts`, `preload/index.ts`, `cinema-pipeline.ts`) está no working tree, mas **não foi commitada**: esses arquivos carregam trabalho em andamento de outra sessão.
- Testes pré-existentes instáveis ou falhando, sem relação com esta mudança:
  - `media-relevance-coverage-voice` "funnel audit": faz rede real e estoura o timeout de 5 s; também falhou no HEAD.
  - `staged-pipeline.test.ts` "pauses in paused_pending_media…": falha também com as versões anteriores destes arquivos.
