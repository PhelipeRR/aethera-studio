# Fase 47 — Velix Canal: ID visual, YouTube, agenda e otimizador

**Status:** PLANEJADA (2026-11-03). Só planejamento: sem implementação, dependências novas ou commit.

## 1. Objetivo

Criar a aba **Canal** no Velix para levar o vídeo pronto até o canal do usuário, com revisão humana em cada passo:

1. **ID visual:** extrair a identidade do canal (cores, @, logo) ou criar uma do zero a partir da descrição ou do nicho, com 3 direções para escolher. Gerar avatar, banner, logo, símbolo, marca d'água e thumbnail.
2. **Conectar o YouTube** pela API oficial (OAuth do próprio usuário), com o token criptografado no computador.
3. **Aplicar a identidade:** banner, marca d'água, descrição e palavras-chave do canal.
4. **Publicar e agendar** o MP4 renderizado pelo Velix: envio retomável, thumbnail e `publishAt`.
5. **Agenda:** calendário com os vídeos agendados, publicados e planejados, com opção de reagendar.
6. **Otimizador de publicação:** título, descrição, tags e horário com base em dados reais do nicho.

Nada é publicado ou alterado no canal sem a aprovação explícita do usuário para aquela ação.

## 2. Ponto de partida (auditoria de 2026-11-03)

| Área | Estado atual | Lacuna |
|---|---|---|
| Abas do Velix | `VelixPage.tsx`: `TABS` com Descobrir, Ideias, Produzir, Novo vídeo, Estúdio, Motion, Render direto, Importar | Não há aba Canal |
| YouTube | `velix-discovery-adapters.ts` → `searchYouTubeVideos` (só leitura, chave em `NB_YOUTUBE_API_KEY`) | Sem OAuth, sem escrita, sem leitura do próprio canal |
| OAuth | `apps/desktop/src/main/spotify/`: PKCE, `waitForCallback` só em loopback, `SecretCipher` (Electron `safeStorage`), token nunca em texto puro | Padrão pronto para reaproveitar, mas está acoplado ao Spotify |
| Render | Motion Engine da Fase 39 (Remotion) e pipeline FFmpeg/FFprobe | Peças de identidade (stills) ainda não existem; confirmar na 47.1 se viram composições Remotion |
| Persistência | Migrações até `0056_task_origin`; tabelas `velix_*` da Fase 36 | Sem tabelas de identidade, publicação ou agenda. A próxima é a `0057` (confirmar na pasta antes de criar) |
| IPC | `apps/desktop/src/main/index.ts` concentra muitos handlers (diagnóstico da Fase 43) | Os handlers novos vão num módulo próprio (`velix-channel-ipc.ts`) |
| Referência | A skill MotionVelix v2.8.0 (`~/.claude/skills/motionvelix`) tem implementação em Python e 31 testes: `mv_marca.py` (ID visual), `mv_youtube.py` (API) e `mv_otimizar.py` (otimizador) | A lógica precisa ser portada para TypeScript. A CLI Python não é chamada pelo app |

**Limites da API do YouTube** (documentação oficial, consultada em 2026-11-03):

- **Permite:** banner (`channelBanners.insert` + `channels.update` em `brandingSettings.image.bannerExternalUrl`); descrição e palavras-chave (`brandingSettings.channel`); marca d'água (`watermarks.set/unset`); envio de vídeo (`videos.insert`); agendamento (`status.privacyStatus=private` + `status.publishAt`, só para vídeo nunca publicado); `thumbnails.set`; leitura da playlist de uploads e `videos.list`.
- **Não permite:** foto de perfil e nome do canal. Esses ficam com instruções para o Studio.
- **Auditoria:** projetos de API não verificados criados depois de 28/07/2020 enviam vídeos travados em privado. Publicar ou agendar como público exige a auditoria do Google.
- **Cota:** até 100 envios por dia (bucket próprio); `search.list` custa 100 unidades; `channelBanners.insert` custa 50.

## 3. Decisões que dependem do usuário (pontos de aprovação)

Responder antes de 47.1:

1. **Cliente HTTP:** (a) REST com `fetch`, sem dependência nova, incluindo o protocolo de upload retomável; ou (b) o pacote `googleapis`. Recomendação: (a). O app já faz assim na Discovery e no Spotify.
2. **Cliente OAuth:** (a) o usuário importa o próprio `client_secret.json` (tipo "App para computador"), como na skill; ou (b) um cliente OAuth do NeuralBridge, o que exige verificação do app pelo Google e auditoria em nome do projeto. Recomendação: (a) nesta fase.
3. **Escopos:** (a) pedir `youtube.readonly` ao conectar e ampliar para `youtube` (gerenciar e enviar) só na primeira ação de escrita; ou (b) pedir `youtube` de uma vez. Recomendação: (a).
4. **Peças de identidade:** (a) composições estáticas no Remotion da Fase 39; ou (b) HTML + Playwright, como na skill. Recomendação: (a), se a 47.1 confirmar que a renderização de stills está estável no build empacotado.
5. **Analytics do próprio canal** (`yt-analytics.readonly`) nesta fase? Recomendação: não. Fica para depois de uns 10 vídeos publicados (subfase futura).

## 4. Contrato (proposta)

Em `packages/shared/src/velix-channel.ts`, com zod e `schemaVersion: 1`:

- `ChannelConnection`: `status` (`disconnected|connected|expired|error`), `channelId`, `title`, `handle`, `scopes[]`, `auditDeclared` (o próprio usuário informa que a auditoria foi aprovada) e `connectedAt`. Nunca contém token.
- `BrandIdentity`:
  - `source` (`extracted|created`), `direction`, `mode` (`dark|light`)
  - `tokens {bg,bg2,fg,mute,ac,ac2,glow,card}`, `fonts {title,accent}` (só fontes empacotadas)
  - `symbol {style: monograma|seta|ponto, initials}`, `tagline`, `palette[]`
  - `pieces[] {kind, width, height, path, sha256}`, `approvedAt`
- `PublishDraft`:
  - vídeo e metadados: `videoAssetId`, `title`, `description`, `tags[]`, `thumbnailPath`, `privacy`, `publishAt`, `categoryId`, `madeForKids`
  - `scores {title, description, tags}`
  - `status` (`draft|awaiting_approval|uploading|uploaded|scheduled|failed|cancelled`), `uploadSession` (URL de retomada, criptografada) e `youtubeVideoId`
- `AgendaItem`: `origin` (`youtube|planned`), `title`, `at`, `state`, link para Ideia ou Produção.
- `NicheReference`: `query`, `region`, `language`, `days`, `n` e estatísticas (palavras fortes, mediana de caracteres, % com número, tags comuns, duração, % de shorts, horários ponderados por views/dia no fuso do público).

**Migração `0057` (aditiva):**

| Tabela | Conteúdo |
|---|---|
| `velix_brand_identities` | `project_id`, `data` JSON, `updated_at` |
| `velix_publications` | `id`, `project_id`, `status`, `youtube_video_id`, `publish_at`, `data` JSON, timestamps; índice por projeto e data |
| `velix_agenda_items` | planejados |
| `velix_niche_references` | referências do nicho |

**Tokens e `client_secret`** ficam num arquivo criptografado pelo `SecretCipher`, fora do banco, como no Spotify. Sem `safeStorage` disponível, eles ficam só em memória.

## 5. Subfases

### 47.1 — Auditoria e contratos

- [ ] Inventário da aba Velix, das saídas de render (onde fica o MP4 final), do Motion Engine (stills) e do padrão OAuth do Spotify.
- [ ] Extrair um núcleo OAuth loopback genérico (PKCE, `state`, porta efêmera em 127.0.0.1) e mantê-lo compatível com o Spotify. Os testes do Spotify continuam verdes.
- [ ] Contrato `velix-channel.ts`, migração `0057` e repositório com testes.
- **Aceite:** contratos validados, migração aplicada em banco novo e em banco existente (0056 → 0057), Spotify sem regressão.

### 47.2 — ID visual

- [ ] **Extração:**
  - canal conectado: `channels.list` (snippet, brandingSettings) e thumbnails dos uploads;
  - sem conexão: página pública com só `https`, limite de tamanho, só imagens decodificáveis e conteúdo tratado como dado.
- [ ] **Paleta:**
  - k-means determinístico (semente fixa) e cor de destaque por croma × presença;
  - modo claro/escuro e fundo tingido;
  - contraste mínimo de **4,5:1** entre destaque e fundo;
  - aviso quando o avatar é o padrão do YouTube.
  - Os fixtures de ouro gerados pela implementação Python da skill garantem paridade.
- [ ] **Criar do zero:** 9 direções; escolha de 3 pelo nicho ou pela descrição; símbolo (monograma, seta, ponto) com iniciais escapadas; prévia de cada opção.
- [ ] **Peças:**

  | Peça | Tamanho |
  |---|---|
  | Avatar | 800×800 (seguro em círculo) |
  | Banner | 2560×1440, com área segura de 1546×423 |
  | Logo | 1800×600, transparente |
  | Símbolo | 1000×1000, transparente |
  | Marca d'água | 150×150 |
  | Thumbnail base e exemplo | 1280×720 |

- [ ] Aba Canal → **Identidade**: paleta, prévias, escolha da direção, edição de destaque, fonte e tagline, lista das peças.
- **Aceite:** a mesma entrada gera a mesma paleta; todas as direções passam no contraste; as peças saem nas medidas certas (conferidas por leitura do PNG); a identidade reabre depois de reiniciar o app.

### 47.3 — Conexão com o YouTube

- [ ] Guia de 5 passos dentro do app (projeto no Google Cloud, ativar a YouTube Data API v3, tela de consentimento com usuário de teste, cliente "App para computador", baixar o JSON).
- [ ] Importar o JSON validando o tipo `installed` e os campos. Guardar criptografado. O renderer nunca vê o segredo.
- [ ] OAuth no navegador do sistema com PKCE e loopback. Refresh automático. Desconectar apaga o token local e mostra o link de revogação.
- [ ] Erros traduzidos: `accessNotConfigured` (com o link certo para ativar), cota, `forbidden`, conta sem canal, autorização expirada.
- **Aceite:** conectar, reiniciar e continuar conectado; o token não aparece em log, IPC, banco nem renderer (teste que procura o valor em todos esses lugares).

### 47.4 — Aplicar a identidade no canal

- [ ] Banner: `channelBanners.insert` + `channels.update`, enviando o `brandingSettings` **inteiro** (o update substitui a parte toda). Marca d'água: `watermarks.set/unset`, com momento e canto. Descrição e palavras-chave do canal, com os limites validados.
- [ ] Cada ação mostra um **resumo** e pede aprovação humana. A aprovação vale para uma única execução, não pode ser reutilizada e é registrada em auditoria.
- [ ] Avatar e nome: instruções para o Studio, com o arquivo pronto.
- **Aceite:** sem aprovação, nenhuma chamada de escrita sai (teste com servidor falso); o banner preserva descrição e palavras-chave existentes.

### 47.5 — Publicar e agendar

- [ ] O envio é uma **tarefa do TaskEngine**, não uma CLI: upload retomável, progresso, cancelamento, retomada do byte confirmado e estado persistido em `velix_publications`. Ao reiniciar, a tarefa retoma ou fica `failed` com o motivo.
- [ ] Validações:
  - título com 1–100 caracteres, sem `<>`;
  - descrição até 5000 caracteres;
  - tags até 500 caracteres no total;
  - thumbnail até 2 MB;
  - `publishAt` pelo menos 15 min no futuro, exigindo `private`;
  - declaração de conteúdo infantil.
- [ ] Origem do vídeo: um render do Velix (Fases 39/46) ou um asset local autorizado. Depois do envio, `thumbnails.set`.
- [ ] Aviso de auditoria: sem ela, o vídeo fica privado; o app mostra isso no resumo e no resultado.
- **Aceite:** envio interrompido no meio retoma sem recomeçar (servidor falso); agendamento chega em UTC; aprovação obrigatória.

### 47.6 — Agenda

- [ ] Calendário mensal na aba Canal: agendados, publicados, privados e planejados, com legenda e navegação por teclado.
- [ ] Sincronizar a playlist de uploads + `videos.list`. Os itens planejados ficam no banco e se ligam a Ideias e Produção.
- [ ] Reagendar (`videos.update` em `status`, só vídeo privado nunca publicado, com aprovação). Planejar e desplanejar.
- **Aceite:** a sincronização preserva os planejados; reagendar um vídeo público é recusado; a agenda reabre depois de reiniciar.

### 47.7 — Otimizador de publicação

- [ ] Referência do nicho: `search.list` com os mais vistos dos últimos 90 dias + `videos.list`, estatísticas ponderadas por views/dia e cache em `velix_niche_references`. Mostrar o custo de cota antes.
- [ ] O agente gera 5 títulos, a descrição e as tags numa etapa **somente leitura** (`TaskEngine.runStructuredReadOnly`, com schema). Títulos, tags e descrições de outros canais entram como dado não confiável.
- [ ] Notas determinísticas (porte do `mv_otimizar.py`):
  - **título:** tamanho, palavra-chave como palavra inteira no começo, número, gatilhos, CAIXA ALTA, pontuação, aderência ao nicho;
  - **descrição:** 150 primeiros caracteres, mais de 15 hashtags, regras de capítulos, CTA;
  - **tags:** 500 caracteres.
- [ ] Horários: 3 opções em dias diferentes, no fuso do público, convertidas para o horário local e prontas para agendar.
- [ ] Aplicar uma sugestão é sempre uma ação humana. Aviso visível de que é correlação, não garantia.
- **Aceite:** paridade das notas com a skill nos mesmos fixtures; horário correto com e sem horário de verão.

### 47.8 — Jornada real e gates

- [ ] E2E com servidor YouTube falso: conectar, criar a identidade, aplicar o banner com aprovação, otimizar, publicar agendado, ver na agenda, reiniciar e reagendar. Também os casos de falha: cota, sem rede, cancelamento.
- [ ] Homologação real com o canal do usuário: envio de teste **privado** para confirmar como o `publishAt` se comporta antes da auditoria.
- [ ] Matriz visual da aba Canal (dark/light, desktop/compact, reduced motion), Vitest serial, lint, typecheck, build, `git diff --check` e instalador.

## 6. Segurança

- Uma etapa somente leitura (geração de sugestões, análise do nicho) nunca escreve, nem com Acesso total.
- Automações não publicam sozinhas: cada escrita no YouTube exige aprovação de uso único.
- Conteúdo não confiável inclui a descrição do canal, títulos e tags de busca, respostas da API e o JSON importado. Ele nunca vira instrução.
- Os segredos (`client_secret`, `access_token`, `refresh_token`, URL de sessão de upload) ficam criptografados pelo sistema operacional e fora de log, IPC e banco.
- Downloads só de `https`, com limite de tamanho e verificação de que é imagem.
- Nenhum commit, push, checkout ou merge.

## 7. Testes

| Tipo | Cobertura |
|---|---|
| Unidade | paleta e contraste, direções, iniciais e escape do SVG, notas de título, descrição e tags, horários e fusos, validadores de publicação, mapeamento de erros da API |
| Integração | repositório e migração 0057; OAuth com servidor loopback falso; upload retomável com servidor falso (interrupção e retomada); `channels.update` preservando `brandingSettings` |
| E2E | jornada da 47.8 e recusa sem aprovação |

Se testes com `git` falharem em paralelo, confirme com `npx vitest run --no-file-parallelism`.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Auditoria do Google demora ou é negada | Envio privado com tudo preenchido; o usuário publica pelo Studio |
| Cota diária | Custo mostrado antes; cache das referências; `search.list` só sob demanda |
| Mudança na página pública do canal | Preferir `channels.list` com a conta conectada; a página pública é só alternativa |
| Licença de fontes | Só fontes OFL já empacotadas |
| Regressão do Spotify ao extrair o núcleo OAuth | Testes do Spotify obrigatórios na 47.1 |

## 9. Definição de pronto

Num canal real:

1. conectar o canal;
2. criar e aprovar a ID visual;
3. aplicar o banner com aprovação;
4. otimizar e enviar um vídeo privado agendado;
5. ver o vídeo na agenda depois de reiniciar o app.

Além disso: nenhum segredo encontrado em log, IPC ou banco; as abas existentes do Velix e a Discovery funcionam como antes; todos os gates aprovados. Projetos v1 do Motion continuam abrindo.
