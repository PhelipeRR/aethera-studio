import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrainService, dot, EmbeddingIndexer, fromBlob, HybridSearch, LocalEmbeddingProvider, parseSearchFilter, projectScope, type Actor } from '@neuralbridge/brain';
import { openDatabase, projects } from '@neuralbridge/database';
import type { MemoryType } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';

// Relevance of keyword, semantic and hybrid search with the real local model.
// NB_EMBEDDINGS=1 runs it; the model is read from NB_MODELS_DIR or tests/.cache/models (downloaded there if missing).
const enabled = process.env['NB_EMBEDDINGS'] === '1';
const modelsDir = process.env['NB_MODELS_DIR'] ?? resolve(import.meta.dirname, '../.cache/models');
const MIGRATIONS = resolve(import.meta.dirname, '../../packages/database/migrations');

const MEMORIES: [string, string, MemoryType][] = [
  ['Migrações versionadas com Drizzle', 'Toda mudança de schema passa por migração gerada pelo drizzle-kit e revisada antes de aplicar.', 'decision'],
  ['Pool de conexões do PostgreSQL', 'Timeouts em produção vinham do pool pequeno; aumentamos max para 20 e adicionamos statement_timeout.', 'bug_fix'],
  ['Índices para consultas de pedidos', 'A listagem de pedidos fazia full scan; criamos índice composto em (customer_id, created_at).', 'learning'],
  ['Autenticação com OAuth e PKCE', 'O login usa OAuth 2.0 com PKCE; tokens de acesso expiram em 15 minutos e o refresh token é rotacionado.', 'decision'],
  ['Senhas com Argon2id', 'Hash de senha com Argon2id, memória 64 MB; nunca registrar senhas em log.', 'decision'],
  ['Rate limiting na API pública', 'Limite de 100 requisições por minuto por chave, com cabeçalho Retry-After.', 'decision'],
  ['Componentes React sem estado global', 'Estado de formulário fica no componente; Zustand só para estado compartilhado entre telas.', 'code_pattern'],
  ['Layout responsivo da sidebar', 'Abaixo de 960px a barra lateral vira um menu recolhível.', 'code_pattern'],
  ['Acessibilidade de foco', 'Todo elemento interativo precisa de anel de foco visível e navegação por teclado.', 'preference'],
  ['Testes E2E com Playwright', 'Fluxos críticos cobertos com Playwright; usar locators por papel e rótulo, sem sleeps fixos.', 'code_pattern'],
  ['Retry com backoff exponencial', 'Chamadas a serviços externos tentam de novo até 3 vezes com espera exponencial e jitter.', 'code_pattern'],
  ['Logs estruturados', 'Usar ILogger com mensagens estruturadas; nada de concatenar strings nem logar tokens.', 'code_pattern'],
  ['Cache de catálogo no Redis', 'O catálogo de produtos fica em cache por 10 minutos; invalidação ao salvar produto.', 'decision'],
  ['Fila de e-mails', 'Envio de e-mail sai do request e vai para uma fila processada em background.', 'decision'],
  ['Upload de arquivos para o S3', 'Uploads usam URL pré-assinada; o servidor nunca recebe o binário.', 'decision'],
  ['Deploy com blue-green', 'Publicação alterna entre dois ambientes; rollback é trocar o tráfego de volta.', 'documentation'],
  ['Feature flags', 'Funcionalidades novas entram desligadas atrás de flag e são liberadas por porcentagem.', 'preference'],
  ['Fuso horário em UTC', 'Datas são gravadas em UTC (timestamptz) e convertidas só na interface.', 'decision'],
  ['Valores monetários em centavos', 'Dinheiro é inteiro em centavos; nunca usar float para valores.', 'decision'],
  ['Paginação por cursor', 'APIs de listagem usam cursor opaco em vez de offset, para não pular itens.', 'code_pattern'],
  ['Memory leak in the websocket hub', 'Connections were never removed from the dictionary on disconnect; fixed by unsubscribing in finally.', 'bug_fix'],
  ['Slow dashboard rendering', 'The chart re-rendered on every keystroke; memoized the series and debounced the filter input.', 'bug_fix'],
  ['Dependency injection lifetimes', 'DbContext is scoped; never inject it into a singleton service.', 'learning'],
  ['Nullable reference types', 'All C# projects enable nullable; warnings are treated as errors in CI.', 'preference'],
  ['Git branch naming', 'Branches are named feat/, fix/ or chore/ followed by a short description.', 'preference'],
  ['Secrets management', 'Secrets come from the vault at startup; .env files are never committed.', 'decision'],
  ['Image thumbnails', 'Thumbnails are generated asynchronously after upload in three sizes.', 'learning'],
  ['Search uses Postgres full-text', 'Product search uses tsvector with a GIN index before considering Elasticsearch.', 'decision'],
  ['Remotion video rendering', 'Videos render with deterministic frames; no Math.random without a seed.', 'code_pattern'],
  ['Receita de pão de queijo', 'Polvilho azedo, queijo minas curado, ovos e leite; assar a 180 graus.', 'learning'],
];

/** [query, expected title, why] */
const QUERIES: [string, string, string][] = [
  ['como versionar mudanças no banco de dados', 'Migrações versionadas com Drizzle', 'paraphrase, no shared keyword'],
  ['database connection timeouts in production', 'Pool de conexões do PostgreSQL', 'English query, Portuguese memory'],
  ['consulta lenta listando pedidos', 'Índices para consultas de pedidos', 'symptom → solution'],
  ['how do users log in', 'Autenticação com OAuth e PKCE', 'English paraphrase'],
  ['onde guardar chaves e segredos', 'Secrets management', 'Portuguese query, English memory'],
  ['tentar novamente quando serviço externo falha', 'Retry com backoff exponencial', 'paraphrase'],
  ['vazamento de memória websocket', 'Memory leak in the websocket hub', 'cross-language keyword'],
  ['playwright', 'Testes E2E com Playwright', 'exact keyword'],
  ['não usar float para dinheiro', 'Valores monetários em centavos', 'paraphrase with partial keywords'],
  ['migração', 'Migrações versionadas com Drizzle', 'singular vs plural (keyword search misses it)'],
];

const user: Actor = { kind: 'user', client: 'relevance-test' };

describe.skipIf(!enabled)('search relevance with the real model', () => {
  it('hybrid search finds the expected memory in the top 3 at least as often as either retriever alone', { timeout: 600_000 }, async () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-relevance-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
    handle.db.insert(projects).values({ id: 'shop', name: 'shop', rootPath: 'C:\\src\\shop' }).run();
    const scope = projectScope('shop');
    const brain = new BrainService(handle);
    for (const [title, content, type] of MEMORIES) brain.store({ title, content, type }, scope, user);

    const provider = new LocalEmbeddingProvider({ cacheDir: modelsDir, allowDownload: true });
    const indexed = await new EmbeddingIndexer(handle, provider).processPending(100);
    expect(indexed).toEqual({ indexed: MEMORIES.length, failed: 0, skipped: 0 });

    const top3 = (titles: string[], expected: string) => titles.slice(0, 3).includes(expected);
    const filter = parseSearchFilter({ limit: 20 });
    const rows: { query: string; fts: boolean; semantic: boolean; hybrid: boolean; expectedSim: number; bestOtherSim: number }[] = [];
    const hybrid = new HybridSearch(brain, provider);
    const keywords = new HybridSearch(brain, null);

    for (const [query, expected] of QUERIES) {
      const queryVector = await provider.embedQuery(query);
      const similarities = brain
        .vectorCandidates(filter, scope, provider.model)
        .map((row) => ({ title: row.title, similarity: dot(queryVector, fromBlob(row.vector)) }))
        .sort((a, b) => b.similarity - a.similarity);
      rows.push({
        query,
        fts: top3((await keywords.search(query, { limit: 3 }, scope, user)).hits.map((hit) => hit.title), expected),
        semantic: top3(
          similarities.map((entry) => entry.title),
          expected,
        ),
        hybrid: top3((await hybrid.search(query, { limit: 3 }, scope, user)).hits.map((hit) => hit.title), expected),
        expectedSim: Number((similarities.find((entry) => entry.title === expected)?.similarity ?? 0).toFixed(3)),
        bestOtherSim: Number((similarities.find((entry) => entry.title !== expected)?.similarity ?? 0).toFixed(3)),
      });
    }
    const unrelated = await provider.embedQuery('previsão do tempo para o fim de semana na praia');
    const noiseCeiling = Math.max(...brain.vectorCandidates(filter, scope, provider.model).map((row) => dot(unrelated, fromBlob(row.vector))));
    handle.close();

    const score = (key: 'fts' | 'semantic' | 'hybrid') => rows.filter((row) => row[key]).length;
    const summary = { fts: score('fts'), semantic: score('semantic'), hybrid: score('hybrid'), noiseCeiling: Number(noiseCeiling.toFixed(3)) };
    // Vitest only prints console output for failing tests; keep the numbers for the record either way.
    mkdirSync(resolve(import.meta.dirname, '../.cache'), { recursive: true });
    writeFileSync(resolve(import.meta.dirname, '../.cache/relevance-last.json'), JSON.stringify({ summary, rows }, null, 2));
    console.table(rows);
    console.log(JSON.stringify(summary));

    expect(score('hybrid')).toBeGreaterThanOrEqual(Math.max(score('fts'), score('semantic')));
    expect(score('hybrid')).toBeGreaterThanOrEqual(9);
  });
});
