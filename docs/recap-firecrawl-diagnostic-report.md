# Relatório de Investigação e Diagnóstico — Firecrawl Local no Aethera Recap

- **Data:** 2026-11-21T18:01:26.363Z
- **Suíte de testes automatizados:** 49/49 passando (`firecrawl-local-provider.test.ts`, `url-chapter-importer.test.ts`, `acquisition-router.test.ts`)

## 1. Achados no Repositório (Antes da Integração)

- Já existia `FirecrawlSelfHostedProvider` em `packages/cinema/src/recap/url-importer/firecrawl-provider.ts`, porém:
  1. No `apps/aethera-desktop/src/main/aethera-ipc.ts`, o `RecapImportJobManager` era instanciado **sem `discoveryPort`** — ou seja, nem o `AcquisitionRouter` nem o Firecrawl Local estavam conectados ao app desktop.
  2. O provedor iniciava desabilitado por padrão (`FIRECRAWL_ENABLED=true` obrigatório), apontava para `http://localhost:3002` sem auto-detecção e não tinha IPC/UI nas configurações do Recap.
  3. O extrator rodava `extractImagesFromHtml` genérico antes do `adapter.extractPagesFromHtml` (perdendo ordenação `[data-page]`) e não diferenciava HTTP 401, HTTP 403, página de desafio Cloudflare e erro de extração (`no_pages_found`).

## 2. O Que Foi Implementado

- **Auto-detecção em `http://127.0.0.1:3002` + configuração em tempo real:** `checkHealth()`, `getConfig()` e `updateConfig()` em `firecrawl-provider.ts`, com persistência em `recap-library/firecrawl-config.json`.
- **Integração à fila real do `aethera-desktop`:** `AcquisitionRouter` (`firecrawl-self-hosted` → `direct-fetch`) conectado a `RecapImportJobManager` e `analyzeChapterUrl` em `aethera-ipc.ts`, com IPCs `recap:firecrawl-status` / `recap:firecrawl-config` e barra de status/endpoint na aba **Capítulos → Links dos Capítulos**.
- **Validação estrita e sem bypass:** rejeita desafios Cloudflare (`Just a moment`, `cf-challenge`, `challenge-platform`, `cf-turnstile`), diferencia `paywall_detected` (401), `access_denied_403` (403), `captcha_detected` (Cloudflare/CAPTCHA) e `no_pages_found` (extração vazia), todos com `retryable: false` (sem repetição indefinida).
- **Preservação intacta:** CBZ, PDF, arquivos locais, Story Engine, Story Memory, `natural_recap` e layout principal mantidos sem regressão.

## 3. Auto-detecção Real do Firecrawl Local (`http://127.0.0.1:3002`)

- **Endpoint sondado:** `http://127.0.0.1:3002/`
- **Disponível neste ambiente:** `false`
- **Detalhe sanitizado:** `ECONNREFUSED: Unable to connect. Is the computer able to access the url?`
- **Comportamento:** como o serviço local não está em execução na porta `3002`, o adaptador marca `provider_unavailable` e o `AcquisitionRouter` faz fallback limpo para `direct-fetch` sem travar o app.

## 4. Teste Real em Fonte Permitida (Firecrawl Local → Fila → CBZ → `importChapter`)

- **Health check:** `available=true` (3ms)
- **Status do job na fila:** `completed`
- **Páginas extraídas:** 4/4 · **Ordem numérica `[data-page]` preservada:** `true`
- **CBZ gerado:** `true` (985 bytes) · **Validado por `importChapter()`:** 4 páginas íntegras
- **Eventos de telemetria:** discovery_started(firecrawl-self-hosted) → discovery_completed(firecrawl-self-hosted)

## 5. Diagnóstico Real — URL do Nano Machine (`asurascans.com`)

- **URL testada:** `https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1`
- **Resultado:** `blocked` · **Código:** `all_providers_failed` · **Tentativas de descoberta:** 2 (parada imediata sem loop de retry)
- **Mensagem sanitizada:** Todos os provedores falharam. Último erro: [access_denied_403] Falha ao carregar capítulo (HTTP 403).

### Logs sanitizados do roteador
- `2026-11-21T18:01:26.256Z` · `discovery_started` (`firecrawl-self-hosted`)
- `2026-11-21T18:01:26.256Z` · `discovery_failed` (`firecrawl-self-hosted` · code=provider_unavailable) — Firecrawl Local indisponível em http://127.0.0.1:3002.
- `2026-11-21T18:01:26.256Z` · `discovery_started` (`direct-fetch`)
- `2026-11-21T18:01:26.362Z` · `discovery_failed` (`direct-fetch` · code=access_denied_403) — Falha ao carregar capítulo (HTTP 403).
- `2026-11-21T18:01:26.362Z` · `all_providers_exhausted` (`router`) — 2 provider(s) failed.

### Causa do HTTP 403 e Alternativas Autorizadas

- **Causa:** o domínio `asurascans.com` aplica proteção anti-bot/Cloudflare (retornando **HTTP 403** para clientes automatizados). Mesmo com o Firecrawl Local em execução, o Aethera Recap **não** implementa contorno de Cloudflare/CAPTCHA e **não** trata páginas de desafio como capítulos válidos — portanto o erro 403 no AsuraScans **não é declarado como resolvido**.
- **Alternativas autorizadas e confiáveis:**
  1. **Arquivos locais CBZ / PDF** (aba *Capítulos → Arquivo Local*): importação 100% offline, determinística e sem bloqueios de rede.
  2. **Importação Direta CDN** (aba *Capítulos → Importação Direta CDN*): quando você possui URLs diretas acessíveis das imagens autorizadas.
  3. **Fontes públicas/autorizadas sem proteção anti-bot** via **Links dos Capítulos** (com Firecrawl Local em `http://127.0.0.1:3002` ativo ou fallback direto).