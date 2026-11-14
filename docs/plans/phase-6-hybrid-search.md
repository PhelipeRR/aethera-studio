# Fase 6 — Busca híbrida (sub-plano)

Busca textual (FTS5, já existente) + busca semântica com embeddings locais, fundidas por Reciprocal Rank Fusion. Sem modelo, a busca continua funcionando só com FTS e avisa que está degradada.

## Decisões

- **Modelo**: `Xenova/multilingual-e5-small`, `dtype: 'q8'`, CPU, 384 dimensões, ~130 MB (A6, validado no spike S3). Prefixos `passage: ` para memórias e `query: ` para consultas; mean pooling + normalização.
- **Consentimento (A6)**: nada é baixado sem ação do usuário. O download só acontece pelo botão em Configurações → Busca semântica, depois de um diálogo que informa tamanho e origem (Hugging Face). Configuração `semantic_search` na tabela `settings`: `{ enabled, model, consentedAt }`.
- **Servidores MCP nunca baixam**: usam o modelo apenas se já estiver em `%APPDATA%\NeuralBridge\models` e `enabled = true` (`allowRemoteModels = false` no transformers.js).
- **Carga sob demanda**: o modelo carrega no primeiro uso e é descarregado após 10 min sem uso (R5: ~300 MB por processo com o modelo carregado).
- **Indexação assíncrona**: `store` continua síncrono e marca `embedding_status = 'pending'`. `EmbeddingIndexer.processPending()` calcula os vetores em lote e grava em `embeddings` com `content_hash`. Se a memória mudou durante o cálculo, o vetor é descartado e ela fica `pending`. Quem roda o indexador: o app (laço a cada 10 s enquanto houver pendentes) e o servidor MCP (logo após `brain_store`, se o modelo estiver disponível).
- **Vetores**: `Float32Array` em BLOB; similaridade = produto interno (vetores normalizados), força bruta em JS sobre as memórias visíveis no escopo. Suficiente até ~10–20 mil memórias; a interface permite trocar por índice (sqlite-vec) depois.
- **Fusão**: RRF com `k = 60` sobre até 50 candidatos FTS e até 50 semânticos com similaridade ≥ `minSimilarity` (calibrado no teste de relevância). Resultado: `{ hits, mode: 'hybrid' | 'fts', degraded: null | 'disabled' | 'model_missing' | 'model_error' }`. Hits só semânticos recebem um trecho do início do conteúdo.
- **Tipos**: `SearchHit` ganha `matchedBy: ('text' | 'semantic')[]`.
- **Pacote**: `packages/brain/src/embeddings/` (`provider.ts`, `local-provider.ts`, `indexer.ts`, `vectors.ts`) e `packages/brain/src/hybrid-search.ts`. `BrainService.search` (FTS) permanece e passa a usar um método interno sem log; o log `search_hit` acontece só para os resultados finais.

## Testes

- **Unitários** (provider falso e determinístico, sem modelo):
  - `vectors`: codificação BLOB ida e volta; produto interno.
  - `indexer`: processa pendentes, grava hash/modelo/dimensão, marca `ready`; memória alterada durante o cálculo continua `pending`; memória apagada é ignorada; vetor de outro modelo é recalculado; falha do provider marca `failed` sem derrubar o lote.
  - `hybrid-search`: RRF ordena pelo consenso; hit só semântico entra com `matchedBy: ['semantic']`; escopo, tipo e tags valem para os dois lados; consulta vazia → `[]`; provider indisponível → FTS + `degraded`; `minSimilarity` corta ruído; log só dos resultados finais.
  - `local-provider`: sem arquivos do modelo e sem permissão de download → `model_missing` sem tentar rede.
- **Integração** (`NB_EMBEDDINGS=1`, modelo real; baixa para `tests/.cache/models` se faltar):
  - Conjunto de relevância fixo: 30 memórias PT/EN, 10 consultas com a resposta esperada. Mede acerto no top-3 para FTS, semântica e híbrida; exige híbrida ≥ melhor das duas e ≥ 9/10.
  - Processo MCP real com modelo: `brain_store` → indexação → `brain_search` semântico ("plural/singular" e sinônimo que o FTS não acha).
- **E2E**: seção Busca semântica mostra "Desativada" sem modelo; o botão abre o diálogo de consentimento; cancelar não baixa nada.

## Aceite

`brain_search` (MCP) e a busca do app usam o modo híbrido quando o modelo está disponível e degradam para FTS com aviso quando não está. Critérios 3 e 4 do Neural Brain.

## Resultado (2026-10-28)

Teste `tests/integration/relevance.test.ts` com `Xenova/multilingual-e5-small` real, 30 memórias e 10 consultas (Y = resposta esperada no top-3):

| Consulta | FTS | Semântica | Híbrida | sim. esperada | melhor outra |
|---|---|---|---|---|---|
| como versionar mudanças no banco de dados | . | Y | Y | 0.861 | 0.833 |
| database connection timeouts in production | Y | Y | Y | 0.834 | 0.811 |
| consulta lenta listando pedidos | Y | Y | Y | 0.899 | 0.866 |
| how do users log in | Y | Y | Y | 0.837 | 0.831 |
| onde guardar chaves e segredos | . | . | . | 0.807 | 0.846 |
| tentar novamente quando serviço externo falha | Y | Y | Y | 0.890 | 0.865 |
| vazamento de memória websocket | Y | . | Y | 0.847 | 0.857 |
| playwright | Y | Y | Y | 0.844 | 0.802 |
| não usar float para dinheiro | Y | Y | Y | 0.902 | 0.862 |
| migração | Y | Y | Y | 0.868 | 0.856 |
| **Total** | **8** | **8** | **9** | | |

Similaridade máxima de uma consulta sem relação ("previsão do tempo…"): 0.847. Primeira rodada, antes das stopwords e da recalibração: FTS 7, semântica 8, híbrida 8.
