# Aethera — Status

## AET-01 — Auditoria técnica e planejamento (2026-11-09) — CONCLUÍDA, aprovada

- [x] Arquitetura do Velix mapeada no código real (renderer, domínio, orquestração, workspace, Remotion, main, 33 tabelas, 151 canais IPC, 66 arquivos de teste) — `AUDIT.md` §1.
- [x] Dependências: Remotion 4.0.539, FFmpeg/FFprobe empacotados, kit MotionVelix do usuário, yt-dlp, VoiceStudio, YouTube/Google OAuth, Gemini.
- [x] Identificadores, dados e configurações a preservar listados (`AUDIT.md` §1.3); 911 linhas com "velix" no código, 27 textos visíveis.
- [x] Hypit verificado na documentação oficial: CLI `hypit`, SVML, Worker próprio, resultados em `.hypit/results`, Node >= 22.15, Chromium headless, `uv` opcional, modelos externos opcionais.
- [x] Licença Hypit Open Source License analisada: proíbe distribuição empacotada com fins comerciais e SaaS/multi-tenant sem autorização; exige atribuição. Recomendação: não embutir.
- [x] Matriz de compatibilidade e de riscos; estratégia de integração; plano por fase com arquivos, complexidade, testes e rollback.
- [x] Decisões do usuário (2026-11-09): app não será vendido; PoC autorizada; MotionVelix mantém o nome; licença comercial do Remotion não se aplica.
- [x] **PoC Hypit no Windows concluída** (`POC-HYPIT.md`): instalação isolada (0.3.1), `doctor`, `check`, `plan`, `pricing --json` (US$ 0, tudo local), `runtime up` (Chrome Headless Shell win64), build de 8 s em 13 s (pico 849 MB, 11 processos), MP4 válido (H.264 + AAC, 8,000 s), `status --json`, cancelamento, códigos de saída, encerramento sem processos restantes; cache de 272 MB removido.
- [ ] Não testado (exige credenciais ou envio de dados): provedores externos, WhisperX/OpenCV locais, clonagem de vídeo, Studio do Hypit.
- [x] Nenhum código do app alterado; o Hypit não foi instalado no app.

## AET-02 — Rebranding seguro (2026-11-09) — CONCLUÍDA, aprovada

- [x] 38 textos visíveis trocados de "Velix" para "Aethera" (menu, cabeçalho "AI Cinematic Studio", regiões acessíveis, botões, avisos, tela de extensão indisponível, tour guiado, mensagens de erro, templates de Motion, skills internas, brief do agente, manifesto, README). Lista completa em `RENAME-STRATEGY.md`.
- [x] Nenhum identificador interno alterado: extensão `velix`, rota `/video`, canais `video:*`, 33 tabelas, preferências, pastas, segredos, variáveis, ids de templates e skills, kit MotionVelix.
- [x] Tela Extensões mostra "Aethera" para quem já tem a extensão instalada (manifesto gravado como "Velix"), por apelido de exibição pelo id, sem migrar o banco; teste unitário e E2E.
- [x] Erro do kit externo agora diz "O MotionVelix falhou" (o kit mantém o nome, decisão do usuário).
- [x] Projetos e produções do Velix: dados intocados; os E2E do Velix com persistência e reinício (descoberta, jornada, produção, narração, motion, canal) passaram.
- [x] Testes: 41 localizadores E2E atualizados; referências visuais do Velix regeneradas e conferidas (título, menu e aviso com "Aethera"); `extension-names` 2 testes.
- [x] Regressão: typecheck e lint limpos; Vitest serial 2082/2083 — a falha (`velix-research-stage`) é a intermitente conhecida, passou 3/3 sozinha em código não alterado; E2E completo **326 passados, 0 falhas**, 30 pulados.

## AET-03 — Identidade visual: proposta violeta recusada (2026-11-09)

- A primeira proposta (paleta violeta própria em `.aethera`, íris violeta, cabeçalho grande) foi recusada pelo usuário: parecia um app separado do Singularity. Nunca foi commitada.
- Nova direção aprovada: redesign dentro do Design System do Singularity (preto, petróleo e dourado), em lotes R0–R8 — `REDESIGN-PLAN.md`; marca proposta em `brand/` (abertura de lente que é também um eclipse).

## R0 — Remoção da AET-03 violeta (2026-11-09) — concluído

- [x] Código e testes voltaram ao estado do commit `3d0d9ab` (AET-02): CSS `.aethera`, `AetheraMark`, splash, `ProductionBoard`, teste de tokens, ajustes do teste visual e referências removidos.
- [x] Verificação: typecheck e lint limpos, build ok; E2E do Aethera (visual com as referências da AET-02, extensões, vídeo, jornada) 26 passados, 1 pulado.
- [x] Commit consolidado em `56032f3` (`feat(aethera): complete approved redesign lots`).

## R1 — Marca (2026-11-09) — concluído

- [x] `app/AetheraMark.tsx` (símbolo completo, pequeno e mono; assinatura) e `app/aethera-nav-icon.ts` (ícone do menu); rota `/video` usa o ícone novo.
- [x] Símbolo redesenhado conforme a referência `docs/assets/aethera/reference-aethera-screen.webp`: lâminas douradas em espiral, cunhas escuras, centro escuro grande, anel fino, sem ponto de luz.
- [x] Verificação: typecheck e lint limpos; Vitest completo 252 arquivos / 2089 testes passados; `aethera-mark.test.ts` 6/6.
- [x] Commit consolidado em `56032f3` (`feat(aethera): complete approved redesign lots`).

## R2 — Cabeçalho da referência (2026-11-09) — concluído

- [x] Imagens extraídas da referência para `apps/desktop/src/renderer/src/assets/aethera/` (`eclipse-horizon`, `director-chair`, `ai-chip`; as duas últimas entram no R4/R5).
- [x] Cabeçalho sem card: assinatura maior, divisor vertical (a partir de `lg`), descrição da referência, céu estrelado fixo (`.aethera-sky`, sem animação) e planeta à direita com esmaecimento; seletor de projeto mantido, compacto, à direita.
- [x] Em janelas estreitas o planeta é recortado pela esquerda para não ficar atrás da assinatura; texto com sombra para contraste.
- [x] Verificação: typecheck e lint limpos; build ok; E2E do Aethera (11 specs) 55 passados, 7 pulados; referências visuais 1280×800, 1024×768 e 800×700 regeradas e revisadas.
- [ ] Os 4 cards de fluxo ainda são os antigos (truncam em 800 px): entram no R3.
- [x] Commit consolidado em `56032f3` (`feat(aethera): complete approved redesign lots`).

## R3 — Cards de fluxo ligados ao estado (2026-11-09) — concluído

- [x] `features/video/production-phases.ts` (função pura): etapas reais → fases. Descobrir = briefing + pesquisa; Planejar = roteiro + storyboard; Aprovar = etapas aguardando decisão (concluída quando há decisões registradas); Finalizar = narração, sincronização, composição, render, qualidade, exportação. Só a etapa mais recente de cada tipo conta (novas tentativas); fase "concluída" só depois que a seguinte começou ou a produção terminou; produção pausada mostra a fase aberta como pausada.
- [x] `features/video/AetheraFlow.tsx`: 4 cards da referência (ícone dourado de linha, título, subtítulo), segue a produção aberta mais recente do projeto (mesmo cache da área Produzir, atualizado pelo evento de mudança). A fase que pede atenção (aguardando você, falha, em andamento, pausada, nessa ordem) fica com borda dourada. Sem produção, nenhum status aparece. Cada card continua abrindo sua área (Aprovar abre Produzir, onde as aprovações acontecem).
- [x] Grade por container: 4 colunas a partir de ~900 px de conteúdo, 2 abaixo, 1 em larguras muito pequenas; textos não são mais truncados.
- [x] Testes: `production-phases.test.ts` 10/10 (todos os status de etapa e produção); E2E `velix-production-runs` estendido (produção nova com 4 fases pendentes; após reinício, Descobrir pausada) 4/4; referências visuais regeradas e revisadas.
- [x] Commit consolidado em `56032f3` (`feat(aethera): complete approved redesign lots`).

## R4 + R5 — Faixa "Comece uma produção" + "Agente de produção" e abas com ícone (2026-11-09) — concluído

- [x] `features/video/AetheraStart.tsx`: card da referência com a cadeira de diretor à esquerda (luz quente, borda esmaecida), "NOVO PROJETO", "Comece uma produção", texto, "+ Novo vídeo" (abre o formulário e move o foco para ele) e "Usar template" (abre o Motion, onde o template é escolhido, com foco no painel).
- [x] `features/video/VelixLimits.tsx` virou o card "Agente de produção": ícone de robô, seletor do agente (mesma preferência), texto de responsabilidade, status real do agente escolhido (`agents.status()`; `agent-line.ts`, função pura), medidores do Claude compactos (região "Limite do Claude" mantida), "Uso do Codex não informado pela CLI" quando o Codex é o agente, motivo de bloqueio real, "Atualizar limite" e o chip "AI" à direita. A política de escolha do agente continua acessível (descrição do seletor). Quando o motivo de bloqueio do Claude já aparece, a linha de status repetida some.
- [x] Abas: as 8 áreas da referência com ícone; a ativa com contorno dourado. "Novo vídeo" saiu da lista de abas (é a ação do card) e continua sendo a tela inicial e o destino do atalho do Chat; com ele aberto, a primeira aba recebe o foco do teclado e as setas seguem funcionando.
- [x] Layout por container: dois cards lado a lado (1,5 : 1) a partir de ~900 px de conteúdo; abaixo, empilhados; foto e texto lado a lado até ~450 px de card; o chip aparece quando o card tem largura.
- [x] Testes: `aethera-agent-line.test.ts` 3/3; E2E novo em `velix-visual.spec.ts` (8 abas, "Usar template" → Motion com foco, "Novo vídeo" → formulário com foco, nenhuma aba selecionada, teclado); referências visuais regeradas e revisadas em 1280, 1024 e 800 px.
- [x] Commit consolidado em `56032f3` (`feat(aethera): complete approved redesign lots`).

## R6 — Cards Novo vídeo e Ficha do vídeo (2026-11-09) — concluído

- [x] O formulário foi preservado como a ação principal "Novo vídeo", agora em card de vidro com título e ícone, escolhas de tipo com ícones, nicho com busca/chips e os mesmos fluxos de pesquisa, captura, estilo, geração e início pelo agente.
- [x] A "Ficha do vídeo" permanece contextual e real: resume nome, tipo, projeto, nicho, formato, estilo, duração, extras e referências; atualiza conforme o formulário muda; mantém avisos de validação e o passo manual da narração; o lápis move foco para o nome.
- [x] Em conteúdo largo, os cards ficam em duas colunas e a ficha acompanha a rolagem; em conteúdo estreito, empilham sem alterar a ordem de leitura. Nenhuma regra de negócio, persistência, contrato IPC ou funcionalidade existente foi alterada.
- [x] Verificação: typecheck, lint, Vitest focado 19/19 e E2E de vídeo + visual 21/21 passados, 1 pulado por dependência opcional; referências visuais 1280×800, 1024×768 e 800×700 conferidas.
- [x] Commit consolidado em `56032f3` (`feat(aethera): complete approved redesign lots`).

## R7 — Responsividade e movimento reduzido (2026-11-09) — concluído

- [x] A casca Aethera usa largura máxima de 1440px para ultrawide, mantém duas colunas em conteúdo largo e evita linhas excessivamente longas; em larguras menores o fluxo vira grade compacta e a linha de ação empilha sem overflow horizontal.
- [x] A Ficha do vídeo permanece fixa em conteúdo largo e vira um disclosure acessível em conteúdo estreito (até 895px), fechado inicialmente e reabrível por teclado; a ordem de leitura continua formulário → ficha.
- [x] A preferência `prefers-reduced-motion` reduz transições e animações globais ao limite efetivo do sistema e desliga o scroll suave, sem remover feedback funcional.
- [x] Verificação: build ok; E2E R7 em 1440, 1280, 1024 e 800px sem overflow, ficha recolhível e reduced motion aprovados; varredura de acessibilidade das telas principais aprovada; referências visuais regeneradas e revisadas nas quatro larguras.
- [x] Commit consolidado em `56032f3` (`feat(aethera): complete approved redesign lots`).

## R8 — Regressão final, documentação e instalador (2026-11-09) — concluído

- [x] Correção do E2E de reinício: o cenário agora envia uma solicitação destrutiva explícita na retomada e não mistura o marcador `SEGREDO`, que pertence à cobertura do guardião de segurança; o comportamento do TaskEngine não foi alterado. Repetição direcionada: 9/9 passados.
- [x] Vitest completo: 254 arquivos e 2.102 testes passados com `npm test -- --no-file-parallelism`.
- [x] E2E completo após o build: 328 passados, 30 pulados e 1 falha intermitente em `neura-assistant.spec.ts` durante execução em lote. O mesmo teste passou 3/3 isoladamente; os 30 pulados são cenários opcionais que exigem credenciais, hardware, navegador ou provider real. Os testes R6/R7, acessibilidade, visual final, Galaxy, monitoramento e `primary-journey` passaram.
- [x] Typecheck, lint e `git diff --check` aprovados.
- [x] Empacotamento Windows aprovado: `npm run dist:win` gerou `dist/NeuralBridge-Setup-0.1.58-x64.exe`; `npm run verify:dist` passou. SHA-256: `3b9e0da936aa58c24c998a2bc1694dcd93526da8a5b26fa49f4a0300132a7431`. Build local sem assinatura configurada.
- [x] Smoke test do pacote aprovado: `singularity-packaged.spec.ts` 1/1, cobrindo Void, Galaxy, monitoramento real e CSP de produção.
- [x] Documentação finalizada; commit `56032f3` criado sem push. A reversão permanece por lote: reverter apenas os arquivos do lote aprovado, preservando alterações locais não relacionadas; o instalador não é aplicado automaticamente.

## Content Operating System — fundação implantada (2026-11-10)

- [x] Contratos compartilhados para canais, ideias, projetos, execuções, pacotes de publicação, publicações, autonomia e próxima ação em `packages/shared/src/content-operating-system.ts`.
- [x] Persistência aditiva em `0098_content_operating_system.sql`, sem substituir tabelas Velix existentes; histórico de execuções e versões de pacote preservado.
- [x] IPC tipado e protegido para canais, projetos, dashboard, pacote de publicação e aprovação.
- [x] Nova superfície `/aethera` e `/aethera/projects/:id`, com próxima ação única e pipeline Ideia/Briefing → Roteiro → Produção → Pacote → Publicação → Análise.
- [x] `/video` preservado como Aethera Studio e ponto de compatibilidade para as ferramentas existentes.
- [x] Validação: 15 testes focados passaram, typechecks shared/database/desktop passaram, ESLint direcionado passou e `npm run build` passou.
- [x] O projeto agora permite editar e salvar versões do pacote de publicação (título, descrição e tags) e aprovar uma versão explicitamente.
- [x] Pacote aprovado pode ser registrado como publicação agendada localmente; o registro exige aprovação e não chama o OAuth/YouTube real.
- [x] O dashboard agora persiste e relê as publicações, recalculando a próxima ação a partir do estado real em vez de perder o agendamento após recarregar.
- [x] Projetos novos podem iniciar produção somente quando possuem vínculo explícito com um projeto de vídeo existente; a ação chama o `ProductionRunService` real e registra a execução no estado do Content Operating System.
- [x] Projetos sem vínculo são rejeitados com orientação clara, sem inventar caminho, projeto de mídia ou credencial.
- [x] Serviço de publicação adicionado no orquestrador: normaliza tags, ordena/valida capítulos, aplica orçamento e mantém a aprovação pública explícita sem depender de OAuth.
- [x] O inventário esperado da suíte de banco foi atualizado para as cinco tabelas aditivas do Content Operating System; a regressão passou isoladamente com 19/19 testes.
- [x] Briefing estruturado agora é persistido por projeto na migração aditiva `0100_content_project_brief`, com validação Zod, leitura tolerante e canal IPC dedicado para salvamento.
- [x] A tela de projeto agora oferece editor de briefing com tema, público, promessa, duração e tom; a ação principal permanece guiada e o briefing é salvo antes das etapas seguintes.
- [x] A página do projeto foi reorganizada para manter briefing, execução, pacote e publicações em uma sequência única, com estados de carregamento/erro e ações de aprovação explícitas.
- [x] Analytics somente leitura foi adicionado: snapshots por projeto/publicação, métricas numéricas validadas, notas de origem e IPC dedicado; nenhum snapshot altera automaticamente o projeto.
- [x] Adaptador de publicação Aethera → contrato YouTube existente foi adicionado, validando ativo renderizado, metadados e regra de agendamento antes de qualquer chamada OAuth; nenhum provider é simulado.
- [x] O IPC do Content OS agora conecta pacotes aprovados ao executor YouTube existente; a ponte exige vínculo com projeto de vídeo, pacote aprovado, ativo local e token OAuth real.
- [x] Upload concluído também é registrado como `published` no Content OS, preservando a separação entre publicação nova e histórico legado do Velix.
- [x] A tela do projeto expõe MP4 renderizado e thumbnail como caminhos relativos, e habilita “Publicar agora” somente para pacote aprovado e ativo informado; OAuth real continua explícito.
- [x] A tela do projeto também exibe snapshots de analytics em modo somente leitura, com estado vazio explícito quando nenhuma plataforma autorizada forneceu dados.
- [x] A Home agora permite configurar o primeiro canal com autonomia Manual/Assistido/Autônomo; criar projeto continua possível sem canal.
- [x] Ideias agora são uma entidade persistida (`0102_content_ideas`), com criação/listagem via IPC e captura manual na Home; a sequência começa em Ideia antes do briefing.
- [x] Ideias novas podem ser convertidas em projeto pela Home; a conversão preserva a ideia como histórico `converted` e abre o projeto com o mesmo título/canal.
- [x] Conversão Ideia → Projeto recebeu cobertura IPC protegida; a sequência de descoberta agora é exercitável no backend e na Home.
- [x] Política de autonomia operacional adicionada ao orquestrador: publicação sempre exige aprovação, Manual/Assistido respeitam fronteiras distintas, e início de produção bloqueia concorrência/custo antes de criar execução.
- [x] Biblioteca segura agora reutiliza `velix_local_assets` via IPC Content OS, expondo caminho, hash, tamanho e status de direitos sem duplicar o inventário nem permitir ativos não verificados no pipeline.
- [x] A biblioteca agora aparece na página do projeto com origem, tamanho, hash parcial e status de direitos; nenhum arquivo é copiado e ativos bloqueados não são promovidos automaticamente.
- [x] Thumbnail agora pode ser selecionada entre ativos com direitos `verified_allowed` e gravada no pacote de publicação; o contrato preserva a aprovação e impede seleção silenciosa de ativos restritos.
- [x] A infraestrutura Vitest passou a inicializar fixtures Git não-interativos (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`, editor neutro), evitando processos aguardando entrada durante conflitos intencionais.
- [x] Suíte global serial validada em 2026-11-10: 287 arquivos e 2.196 testes aprovados; os `could not apply` restantes pertencem aos cenários de conflito e são resolvidos pelos próprios testes. Nenhum teste foi desabilitado ou recebeu timeout artificial.
- [x] Versão gerada: `0.1.65`; build Electron concluído com sucesso após os lotes de auditoria, calendário, biblioteca e política operacional.
- [ ] OAuth real do Google continua pendência externa de homologação; não foram criadas credenciais fictícias. A validação automatizada cobre contratos, armazenamento seguro, clientes e fluxos simulados.
- [x] Roteiro guiado aditivo implantado: `content_projects.script_json`, contrato/IPC de salvamento, aprovação explícita e próxima ação agora seguem Briefing → Roteiro → Produção; projetos legados sem roteiro continuam válidos.
- [x] Validação do lote de roteiro: contratos, repositório e IPC 15/15; build Electron `0.1.62` aprovado.
- [x] Geração de roteiro agora usa `TaskEngine.runStructuredReadOnly` com schema fechado, prompt delimitado e resultado salvo como roteiro draft; a aprovação continua sendo uma ação separada.
- [x] O botão “Gerar com agente” foi conectado à tela do projeto e reaproveita o agente configurado pelo TaskEngine; não há chamada direta de CLI nem segundo motor.
- [x] Publicação agora separa “Agendar vídeo” de “Publicar agora”: a tela exige data/hora para o registro local, mantém pacote aprovado como pré-condição e preserva OAuth apenas no upload imediato.
- [x] Regressão da linha guiada coberta: Briefing → Criar roteiro → Aprovar roteiro → Iniciar produção, além dos caminhos de falha e recuperação; lote Content OS validado com 23/23 testes.
- [x] Analytics YouTube conectado em modo somente leitura: cliente consulta `videos.list(part=statistics)`, valida contadores numéricos e o Aethera salva snapshot por título correspondente, sem alterar o projeto.
- [x] Sincronização de analytics validada junto ao cliente YouTube e Content OS: 26/26 testes aprovados; OAuth real continua pré-condição operacional.
- [x] E2E da jornada sem credenciais externas aprovado: ideia → projeto → briefing → roteiro aprovado → pacote aprovado → agendamento local, 1/1 em `tests/e2e/aethera-content.spec.ts`.
- [x] Home agora consulta os dashboards dos projetos e exibe resumo operacional de produção, aprovações pendentes e publicações/agendamentos, sem duplicar o estado no renderer.
- [x] Regressão global após os últimos lotes: 287 arquivos e 2.199 testes aprovados em modo serial; conflitos Git exibidos são cenários intencionais e não bloqueiam a suíte.
- [ ] Geração real depende de Claude/Codex autenticado no ambiente do usuário; sem agente disponível o IPC falha explicitamente, sem credencial fictícia.
- [x] Typecheck completo e build Electron revalidados na versão `0.1.62`; o ajuste de tipos Node no renderer e a normalização de opcionais no handler não alteram comportamento de runtime.
- [x] Etapa de pacote agora integra o gerador de thumbnail da identidade visual aprovada do canal, reutilizando `channelSaveThumbnail`; o arquivo gerado segue pelo mesmo caminho de publicação e não cria um provedor paralelo.
- [x] Briefing do Aethera expõe os formatos já suportados pelo pipeline (`youtube-long`, `youtube-short`, Reels, TikTok e quadrado), permitindo derivar versões do mesmo projeto sem criar um motor paralelo.
- [x] Consulta IPC somente leitura da fila de produção adicionada: agrega projetos do workspace, próxima ação e os últimos estados de execução, pacote e publicação sem duplicar persistência.
- [x] Fila ganhou tela navegável em `/aethera/queue`, com estados por projeto e acesso direto ao detalhe; typecheck e build Electron aprovados após a integração.
- [x] Configuração de canal ganhou fluxo dedicado em `/aethera/channels/new`, com nome, nicho, público, tom editorial e autonomia persistidos pelo contrato existente.
- [x] Configuração de canal também persiste a estratégia editorial como dado estruturado, mantendo o contrato de identidade/público/estratégia do modelo conceitual.
- [x] Pacote de publicação ganhou tela dedicada em `/aethera/projects/:id/package`: o agente existente gera título, descrição e tags em modo estruturado e somente leitura até o usuário salvar a nova versão.
- [x] Versão de distribuição incrementada para `0.1.63`; typecheck, build Electron e `git diff --check` revalidados.
- [x] Corrigida a próxima ação do projeto: quando a produção termina sem pacote, o botão principal abre `/aethera/projects/:id/package` em vez de ficar sem efeito.
- [x] E2E agora confirma também a entrada do projeto na Fila e a próxima ação derivada; jornada Aethera validada em `1/1`.
- [x] Revalidação do lote `0.1.63`: typecheck global, E2E Aethera `1/1` e `git diff --check` aprovados.
- [x] Linha de produção agora explicita a etapa `Thumbnail`; pacote sem ativo verificado deriva a próxima ação `Escolher thumbnail` antes da publicação.
- [x] Fila visual recebeu filtros locais por Todos, Produção, Aprovação e Agendados, preservando a consulta única e somente leitura.
- [x] Suíte global serial reexecutada após a etapa Thumbnail e os filtros da Fila; os conflitos Git observados permanecem cenários intencionais dos fixtures.
- [x] Regressão unitária adicionada para a transição pacote aprovado sem thumbnail → `Escolher thumbnail` → agendamento; contratos Aethera `8/8` aprovados.
- [x] A linha de produção comunica explicitamente que alterações de cena exigem render completo enquanto a invalidação incremental segura não estiver disponível.
- [x] Ponte Analytics → Ideias adicionada via IPC: uma ação explícita pode criar uma ideia com `source: analytics`, preservando o projeto publicado e sem mutação automática.
- [x] Ponte Analytics → Ideias ganhou tela dedicada em `/aethera/projects/:id/analytics/idea`, com snapshots somente leitura e criação explícita de título/ângulo.
- [x] IPC Analytics → Ideias recebeu regressão de integridade: `4/4` testes aprovados, incluindo preservação do projeto original.
- [x] O detalhe do projeto agora oferece navegação contextual para Pacote de publicação e Analytics → Ideia; typecheck e build revalidados.
- [x] Versões e Shorts ganharam tela dedicada em `/aethera/projects/:id/variants`, reutilizando o serviço de derivados Velix para gerar candidatos por formato.
- [x] Tela de derivados agora permite aprovar ou rejeitar candidatos antes da produção filha; testes Velix de derivados `3/3` e typecheck aprovados.
- [x] Derivado aprovado agora pode criar uma produção filha pela mesma tela, completando candidato → aprovação → produção derivada.
- [x] A criação explícita de ideia a partir de analytics também registra um insight editorial na memória criativa existente, sem persistir corpo de métricas automaticamente e sem bloquear a criação da ideia se o Brain estiver indisponível.
- [x] Validação final do lote atual: typecheck do desktop e contratos Content OS/IPC `12/12` aprovados; OAuth real do Google continua pendência externa, sem credenciais fictícias.
- [x] Aprovação de pacote agora deixa trilha aditiva em `content_publication_approvals`, com versão do pacote, decisor, observação e data; migrações `0104`/`0105` e regressão do repositório aprovadas (`11/11`).
- [x] Fila passou a expor a data da publicação agendada e ganhou calendário navegável em `/aethera/calendar`, reutilizando a mesma consulta persistida; typecheck, IPC/repositório `11/11` e E2E Aethera `1/1` aprovados.
- [x] Biblioteca ganhou visão agregada do workspace em `/aethera/library`, reutilizando o inventário de ativos por projeto e exibindo origem, integridade e status de direitos sem duplicar arquivos; typecheck e E2E `1/1` aprovados.
- [x] Suíte global serializada revalidada após as migrações de auditoria: `287` arquivos e `2.201` testes aprovados; a expectativa de tabelas foi atualizada para incluir `content_publication_approvals`.
- [x] E2E passou a verificar também `latestPublicationScheduledAt` na Fila; após reconstrução do bundle Electron, build e E2E Aethera `1/1` aprovados.
- [x] Dashboard do projeto passou a expor o histórico de aprovações persistido, incluindo pacote/versão, decisor e data; typecheck, build Electron e regressões de banco/IPC `11/11` aprovados.
- [x] A Home do Aethera recebeu navegação operacional compartilhada para Fila, Calendário, Biblioteca e Novo canal; typecheck e E2E Aethera `1/1` aprovados.
- [x] Publicação/agendamento público agora exige thumbnail aprovada também no repositório, não apenas na UI; regressões de banco/IPC `12/12`, build e E2E `1/1` aprovados.
- [x] Suíte global serializada revalidada na versão `0.1.65`: `287` arquivos e `2.202` testes aprovados; avisos de conflitos Git permanecem apenas cenários intencionais dos fixtures.
- [x] A próxima ação de produção agora fica desabilitada e explica o vínculo ausente com o Aethera Studio antes do IPC; typecheck, E2E `1/1` e `git diff --check` aprovados.
- [x] A mensagem de pré-requisito agora leva diretamente ao Aethera Studio; typecheck e E2E `1/1` aprovados.
- [x] Política operacional de canal ganhou orçamento por execução e limite de concorrência persistidos (`0106`/`0107`), formulário de configuração e consulta no gate de início de produção; typecheck e testes de autonomia/Content OS `14/14` aprovados.
- [x] Regressão de persistência confirma que orçamento e concorrência configurados no canal retornam iguais após reabertura/leitura do banco.

- [x] Fechamento da ponte Content OS → produção (2026-11-10, após o último lote do Codex): o status de `content_executions` agora acompanha o `ProductionRunService` (sincronização em cada mudança de execução e reconciliação no boot), evitando projeto preso em "rascunho"/"executando" e próxima ação errada após falha.
- [x] Limite de concorrência do canal passa a contar execuções em andamento (`draft`, `running`, `paused`, `awaiting_approval`) de **todos** os projetos do canal; projeto sem canal conta só as próprias.
- [x] Início de produção usa o briefing salvo do projeto (formato, duração, público, tom) e, sem briefing, o perfil do canal; o orçamento por execução do canal vai para o `ProductionRunService`, que já aplica o próprio controle de orçamento.
- [x] Validação do fechamento: testes focados de repositório, serviço, autonomia, contratos, IPC e banco `48/48`; `npm run typecheck` aprovado; suíte serial completa `287` arquivos / `2.206` testes aprovados; `npm run build` aprovado; E2E `tests/e2e/aethera-content.spec.ts` `1/1`; ESLint e `git diff --check` nos arquivos alterados aprovados. Sem commit ou push.
## Matriz de aceite do Content Operating System (versão 0.1.65, revisada em 2026-11-10)

| Critério da especificação | Estado atual | Evidência/pendência |
|---|---|---|
| Ideia → briefing → roteiro → produção | Aprovado | Contratos, próxima ação, IPC e E2E da jornada |
| Pacote → thumbnail → agendamento/publicação | Aprovado com OAuth pendente | Pacote, thumbnail com direitos, aprovação e publicação YouTube existente; credencial real externa |
| Múltiplos projetos/canais e fila | Aprovado | Entidades persistidas, Fila, Calendário e Biblioteca |
| Aprovação explícita e auditoria | Aprovado | `content_publication_approvals`, dashboard e testes de migração |
| Analytics → novas ideias/memória | Aprovado em modo somente leitura | Snapshot, ponte explícita e memória criativa; sem mutação automática |
| Autonomia, orçamento e concorrência | Aprovado | Modo por projeto; orçamento por execução do canal aplicado ao `ProductionRunService`; limite de concorrência contado em todos os projetos do canal; status da execução sincronizado com a produção |
| Editor de cenas e invalidação incremental | Transferido ao Autonomous Studio | O render já reaproveita segmentos inalterados; edição por cena/linguagem natural e invalidação seletiva ficam em AS-06/AS-08 (`docs/plans/aethera-autonomous-studio.md`) para não duplicar |
| OAuth real do Google | Pendente externo | Não criar credenciais fictícias; homologação depende do ambiente/cliente OAuth |

## Aethera Autonomous Studio — AS-01 (2026-11-10) — CONCLUÍDA, arquitetura aprovada

- [x] Auditoria do pipeline existente e mapeamento das entidades pedidas para tabelas/serviços atuais.
- [x] Decisões D-AS-1 a D-AS-6 registradas em `docs/plans/aethera-autonomous-studio.md` (IGDB + web + RAWG; política editorial para trailers/gameplays com `editorial_use`/`review_required`; visão híbrida independente de provedor com Codex via `TaskEngine.runStructuredReadOnly` + imagens; TTS e sync existentes; Remotion principal e Hypit opcional; ativação por fase).
- [x] Roadmap repriorizado AS-02…AS-11, contratos, critérios de aceite, benchmark B-1, cenário de referência com 3 jogos, riscos e estimativas (~41–61 dias para AS-02…AS-10).
- [x] Somente documentação alterada; nenhum runtime, migração, commit ou push.
- [ ] Pré-requisitos do AS-02 pendentes: commit estável do Content OS (0098–0103), separação do trabalho da Fase 51, suíte verde pós-commit, número da próxima migração, branch próprio e autorização explícita.
- [x] Ajustes aprovados incorporados ao plano (versão 3): B-1 separado por categoria (processamento, embeddings, multimodais), validação independente da identidade do jogo (§4.5), confiança calibrada com faixas automático/revisão/rejeição (§4.6) e quatro gates separados G1 técnico, G2 factual, G3 editorial, G4 publicação; `editorial_use` documentado como classificação interna, com `legalClearance` separado.
- [x] Runbook não destrutivo dos pré-requisitos em `docs/plans/aethera-studio-prerequisites-runbook.md`: inventário por frente e por trecho, ordem Fase 51 → Content OS (journal 0097 antes de 0098), validação por commit em worktree temporário, ambiente do Studio com worktree próprio e `NB_DATA_DIR` isolado.
- [x] Linha de base em 2026-11-10 (árvore não commitada e ainda em edição por outra sessão): `npm run typecheck` aprovado; `npx vitest run --no-file-parallelism` 287 arquivos / 2.201 testes aprovados (315 s). Backup temporário (patch + tar + SHA-256) na pasta de rascunho da sessão; refazer no passo F1.
- [ ] Bloqueios do AS-02: P0 sessão do Content OS ainda escrevendo; P1/P2 commits por frente não autorizados; P3 validação pós-commit; P4 número da migração; P5 worktree do Studio; P6 autorização.
- [x] Commits por frente autorizados e feitos em 2026-11-10, sem push: `6ef65aa9` infraestrutura de testes, `994dd70d` Fase 51 (separada por trecho nos 13 arquivos compartilhados), `ab97ea30` Content OS, seguidos da documentação do Studio e da versão 0.1.65. C1 e C2 validados isoladamente em worktree temporário (`npm ci`, typecheck, suíte serial: 281/2.172 e 287/2.206). Backup anterior aos commits em `C:/dev/_backups/neuralbridge-2026-11-10-pre-commits/`.
- [ ] Restam para o AS-02: P5 (worktree `feat/aethera-studio` + `NB_DATA_DIR` isolado) e P6 (autorização).

## Aethera Autonomous Studio — AS-02 Fundação (2026-11-10) — CONCLUÍDA, aguardando revisão

Autorizado pelo usuário em 2026-11-10; executado no worktree `C:/dev/neuralbridge-studio` (`feat/aethera-studio`), sem commit.

- [x] Contratos Zod em `packages/shared/src/aethera-studio.ts`: jogo verificado (confirmado exige evidência), intenção de ranking, job de aquisição com chave idempotente, proveniência com `usage` e `legalClearance` separados (padrão `unknown`), segmento, política de visão, faixas de confiança, calibração de limiar, identidade (2 fontes distintas, mismatch forte rejeita, ativo multi-jogo nunca verificado em bloco), match de cena e os gates G1–G4.
- [x] Etapas aditivas `game_research`, `media_acquisition`, `visual_index`, `scene_matching` em `productionStageKinds` (as 10 originais mantêm a ordem; runs antigos não ganham etapas), com rótulos e fases na UI de produção.
- [x] Migração aditiva `0108_aethera_studio_foundation`: `aethera_subjects`, `aethera_media_acquisitions` (única por run + chave), `aethera_media_provenance`, `aethera_media_segments`, `aethera_subject_identities`, `aethera_vision_cache`; colunas `gate` e `version` em `velix_production_approvals` (nulas nas aprovações antigas). Repositório `AetheraStudioRepository` com caminhos parciais confinados ao projeto.
- [x] Checkpoint por item (`orchestrator/src/aethera/item-checkpoint.ts`) sobre o `saveState` existente: falha no jogo 2 → reinício → retoma no jogo 2 sem repetir o jogo 1 nem duplicar artefatos; queda no meio de um jogo → `recover()` + `resume()` continua do item salvo; cancelamento para na fronteira do item.
- [x] `VisionRouter` (`orchestrator/src/aethera/vision-router.ts`): cadeia de provedores da política, indisponível/erro/sem orçamento pulados com motivo, cache por frame+provedor+modelo+versão, fallback antes da revisão, tudo em revisão enquanto a política não está calibrada. Nenhum provedor real registrado (AS-05).
- [x] Categoria A (FFmpeg) em `workspace/src/aethera-segment-quality.ts`: preto, imagem parada e movimento por intervalo via `signalstats`, segmentos entre cortes sem semântica inventada (`kind: unknown`, confiança 0).
- [x] Cenário de referência sintético com 3 jogos fictícios gerados por FFmpeg (`packages/workspace/test/fixtures/aethera-reference.ts`); pasta do cenário real criada fora do repositório (`C:/dev/aethera-reference-media`, escolha dos jogos pendente).
- [x] Testes novos: contratos 9/9, repositório + inventário do banco 25/25, checkpoint 4/4, router 6/6, qualidade FFmpeg 7/7.
- [x] Validação no worktree: `npm run typecheck` aprovado; suíte serial completa `292` arquivos / `2.238` testes aprovados (inclui produções Velix antigas e inventário do banco com 0108); `npm run build` aprovado; ESLint nos arquivos alterados aprovado. Sem commit ou push.
- [ ] Próximo: AS-03 (Game Research) exige autorização e credenciais IGDB/Twitch; escolha dos 3 jogos reais pendente.

## Aethera Autonomous Studio — AS-03 Pesquisa de Jogos (2026-11-10)

Autorizado pelo usuário em 2026-11-10, só no worktree `C:/dev/neuralbridge-studio` (`feat/aethera-studio`). Jogos de referência escolhidos: Cyberpunk 2077, Elden Ring e Hollow Knight: Silksong (`C:/dev/aethera-reference-media/manifest.json`, só títulos; nada pré-preenchido).

- [x] Regra pura `resolveGameVerification` (`shared/src/aethera-game-research.ts`): `confirmed` exige dois tipos de fonte (IGDB, RAWG, web) concordando na data na precisão comum; qualquer divergência vira `conflicting` com a lista das fontes; uma fonte só, sem data ou página não verificada fica `unconfirmed`. Cada observação guarda `retrievedAt`.
- [x] `IgdbClient` (`orchestrator/src/aethera/game-sources.ts`), conforme a documentação oficial: token do Twitch por client credentials (renovado uma vez em 401), cabeçalhos `Client-ID`/`Bearer`, limite de 4 req/s e 8 abertas, backoff com `Retry-After` em 429, novas tentativas em 5xx/rede, erros tipados (`auth_required`, `auth_failed`, `rate_limited`, `unavailable`, `invalid_response`), título escapado na query Apicalypse, data com a precisão real (`date_format`/`y-m-d`), busca por período só de jogos principais. Só aceita título ou alias exato (nunca DLC/edição).
- [x] `RawgClient` opcional: sem chave não faz nada; falhas viram nota.
- [x] Confirmação web (`web-confirmation.ts`): o agente (TaskEngine, read-only, schema fechado, título como dado) sugere até 3 páginas oficiais; o app abre cada uma (https público, sem IP/localhost, 10 s, 2 MB) e só conta a página que cita o jogo e o ano. URL recusada, página que não carrega ou não cita o jogo ficam `unverified`.
- [x] Etapa `game_research` com checkpoint por jogo: evidência por jogo em `research/games/<jogo>.json` (observações, notas, IDs, sites oficiais e imagens de referência do IGDB) e `VerifiedSubject` com id por run. Sem credencial IGDB a etapa falha com orientação e não grava nada; IGDB caindo no meio preserva os jogos concluídos e a retomada continua no jogo seguinte. Período → candidatos do IGDB salvos no estado (não reconsulta ao retomar).
- [x] `rankingIntentFromPrompt`: pedido em linguagem natural → intenção de ranking (contagem, período, critério) por agente estruturado; IPC `video:studio:ranking-intent`.
- [x] Credenciais: `StudioSecretStore` (safeStorage, gravação atômica, nunca vai ao renderer) para IGDB (`aethera-igdb-credentials.bin`) e RAWG (`aethera-rawg-key.bin`); IPC de salvar/status (com dica `••••1234`)/remover.
- [x] UI `ProductionGameResearch` na produção: fontes de dados (IGDB obrigatório, RAWG opcional), pesquisa por títulos ou por período, opção de confirmação web, lista de jogos com selo textual Confirmado / Não confirmado / Fontes em conflito, data com precisão, plataformas, id IGDB e data da consulta.
- [x] Testes com fixtures **sintéticas** identificadas como tal (jogos fictícios, sem dados reais): regras 8/8, clientes 13/13, etapa + web + intenção 11/11, cofre 3/3.
- [x] Os canais `video:studio:igdb:save` e `video:studio:rawg:save` foram declarados em `IPC_SECRET_INGRESS` (o teste de fronteira do renderer exigiu, como previsto).
- [x] Validação no worktree: `npm run typecheck` aprovado; suíte serial completa `296` arquivos / `2.273` testes aprovados; `npm run build` aprovado; ESLint nos arquivos do AS-03 aprovado; `git diff --check` aprovado. Sem commit nem push.
- [x] Credenciais reais do Twitch/IGDB foram configuradas pela UI do Aethera Studio e permanecem cifradas no computador; nenhum segredo foi exposto ao renderer, ao log ou a este registro. RAWG continua opcional e não configurado.
- [x] Execução real no Aethera Studio: Cyberpunk 2077 e Elden Ring ficaram `confirmed`; Hollow Knight: Silksong ficou `conflicting` por divergência entre fontes. Os três resultados foram persistidos na execução, sem preencher dados ausentes por suposição.
- [ ] Pendência de ambiente: a confirmação web depende de Claude/Codex autenticado no TaskEngine; sem agente ela vira nota e o jogo pode ficar `unconfirmed` mesmo com IGDB.
- [ ] Pré-existente (fora do AS-03): ESLint acusa `import()` em `packages/shared/src/channels.ts:664` (Content OS).

## Aethera Autonomous Studio — AS-04 Aquisição de trailers e gameplays (2026-11-10)

Autorizado pelo usuário em 2026-11-10, só no worktree `C:/dev/neuralbridge-studio` (`feat/aethera-studio`), sobre `230d5114`.

Auditoria de reuso (antes de implementar): a biblioteca existente (`velix_media_references`, `velix_local_assets`) guarda as fontes e os arquivos; o runner de processos e o diagnóstico de erro do yt-dlp de `workspace/velix.ts` são reaproveitados; o ffprobe do clip-hunter foi extraído para `probeVelixMedia` (o clip-hunter passou a usá-lo, testes dele inalterados e verdes); a fila `aethera_media_acquisitions`, a proveniência e a identidade vêm do AS-02; o checkpoint por item e o `ProductionRunService`/TaskEngine seguem como executores. A análise de cenas do clip-hunter exige `verified_allowed` e fica para o AS-05.

- [x] Contratos puros `shared/src/aethera-media.ts`: candidato de fonte, tipo do vídeo pelo título ("Gameplay Reveal" é trailer; "minutes of gameplay" é gameplay), canal oficial por palavras distintivas das empresas do IGDB (sufixos regionais ignorados — validado com metadados reais públicos: "BANDAI NAMCO Europe" × "Bandai Namco Entertainment"), sinais de identidade **antes do download** (vínculo do IGDB/canal oficial + título; título que cita outro jogo do ranking é mismatch), nota explicável com preferência por 1080p+, recomendação de um trailer e um gameplay por jogo, e mapeamento D-AS-2 (`editorial_use` só para mídia oficial com identidade verificada; incerteza → `review_required`; identidade rejeitada → `blocked`; `legalClearance` sempre `unknown`).
- [x] Migração aditiva `0109_aethera_media_candidates` (candidatos únicos por run+URL, histórico de uso por ativo/run). Repositório: decisão da pessoa preservada ao redescobrir, reuso da mesma origem entre produções do projeto, busca por hash, histórico ordenado por inserção.
- [x] `IgdbClient.gameVideos` (endpoint `game_videos`, ids do YouTube validados) e yt-dlp sem chave de API (`workspace/src/aethera-acquisition.ts`): metadados sem baixar, busca `ytsearch`, formato 1080p+ H.264 primeiro com fallback, `--continue` para retomar `.part`, progresso por template, versão do yt-dlp registrada, erros tipados (`network`/`forbidden` repetíveis; `unavailable`, `format`, `tool_missing`, `tool_outdated`, `cancelled`).
- [x] Etapa `media_discovery` (nova, aditiva): por jogo verificado, vídeos do IGDB + buscas "official trailer" e "gameplay"; referências reaproveitadas na Descoberta como pendentes; identidade, nota e recomendação; histórico `discovered`.
- [x] Etapa `media_acquisition`: só fontes selecionadas; identidade rejeitada nunca é baixada; reuso da mesma origem já adquirida no projeto; até 3 tentativas com backoff exponencial para falhas de rede/recusa; vídeo removido falha só aquele item; yt-dlp ausente falha a etapa com orientação; pausa marca o job e mantém o `.part`; retomada continua no item salvo; dedup por SHA-256 (arquivo duplicado removido, ativo reaproveitado); ativo na biblioteca com estado de direitos derivado do uso editorial, proveniência com restrições conhecidas, identidade registrada e manifesto `media/aethera/manifest.json` para o AS-05.
- [x] IPC e UI `ProductionMediaHunter`: procurar vídeos, prévia (miniatura buscada pelo processo principal e entregue como data URL, respeitando a CSP), seleção manual por fonte com identidade, canal oficial, resolução, duração, nota e motivos, aviso para vídeo de outro jogo, aquisição com progresso, tentativa e erro por fonte.
- [x] Testes: contratos 7/7, repositório 3/3 (+ inventário do banco), IGDB 14/14, yt-dlp com executável falso 9/9 (inclui retomada do `.part` e cancelamento da árvore de processos), etapas 10/10. Todos os dados de teste são sintéticos.
- [ ] Limitação: a confirmação de que o vídeo é do jogo usa vínculo do IGDB, canal oficial e título; sinais visuais e de áudio (OCR, transcrição, referência visual) entram no AS-05.
- [ ] Limitação: miniaturas dependem de rede; sem rede a lista mostra um marcador no lugar da prévia.
- [x] Descoberta real executada após a pesquisa: vídeos associados pelo IGDB e buscas yt-dlp foram catalogados para os três jogos; a UI deixou 6 fontes recomendadas selecionadas.
- [~] Aquisição real (2026-11-11, run `d4a808e4`): 5 de 6 fontes aprovadas baixadas em 1080p, com hash, proveniência e identidade — Cyberpunk 2077 (trailer 1m25, gameplay 52 min), Elden Ring (trailer 2m59, gameplay 57 min), Silksong (trailer 1m53). Pausa/retomada preservou o `.part`. A 6ª (gameplay de Silksong `PgUssv-fV7w`) era um walkthrough de 11h58: baixou 20,5 GB e só então o probe a recusou (limite técnico de 4 h); a etapa falhou em 83% e o job ficou preso em `running`.
- [x] Correção (2026-11-11): limite editorial por tipo em `shared/aethera-media.ts` (`MAX_ACQUIRABLE_SECONDS`: trailer 10 min, gameplay/outro 60 min). Fonte acima dele recebe nota 0 com o motivo, nunca é recomendada e, se alguém a selecionar, é recusada **antes** de contatar a origem (evento `too_long`; job antigo dessa fonte passa a `failed`). Falha depois do download (hash, probe) agora marca o job `failed` (`format`, não repetível) e a candidata `failed`, sem derrubar as demais fontes. Medição que motivou o limite: detecção de cenas a ~44× o tempo real (2 min de 1080p60 em 2,7 s) — 12 h seriam ~16 min só de detecção (acima do timeout de 120 s) e milhares de segmentos de visão. Testes: `aethera` 27 arquivos / 147 testes; tsc de shared, orchestrator e desktop; ESLint nos arquivos alterados.
- [x] Retomada real com a correção (2026-11-11 14:34Z): app reiniciado, `media_acquisition` rodada 2 `completed`; as 5 fontes já adquiridas reaproveitadas sem novo download; a de 12 h recusada antes de contatar a origem (`fonte acima do limite de 60 min para gameplay`), job antigo `running` → `failed`, candidata `skipped`. `visual_index` iniciado sobre as 5 mídias.
- [x] Incidente (2026-11-11 ~14:30Z): os arquivos de `media/aethera/` foram apagados fora do app (sem passar pela Lixeira; o código do app não remove essa pasta; ~114 GB liberados no C: ao mesmo tempo). O banco continuou marcando os jobs `done`, e o `visual_index` falhou com `not_found: arquivo de mídia inexistente`. Origem não identificada; havia uma sessão Codex ativa em paralelo.
- [x] Correção: o reaproveitamento por chave (`acquiredForKey`) só vale se o arquivo do asset ainda existir; caso contrário registra `missing_file`, baixa de novo com tentativas zeradas e mantém o mesmo asset (dedupe por hash). Teste de regressão "downloads again when an acquired file was deleted from disk"; `aethera` 27 arquivos / 148 testes; tsc orchestrator; ESLint.
- [x] Recuperação real: `media_acquisition` rodada 3 com os 5 IDs adquiridos, `completed` em 2 min; 5/5 arquivos (3,33 GB) com SHA-256 idêntico ao registrado antes. Observação: depois da aquisição as candidatas ficam `acquired`, então "Adquirir selecionados" fica sem seleção; a rebaixa exige passar os IDs (o IPC aceita).
- [x] `visual_index` real (rodada sobre as 5 mídias): 3/5 mídias, 163 segmentos, US$ 0 em 33 min; falhou na 4ª com `FFmpeg falhou ao medir o segmento: stdout maxBuffer length exceeded`. Causa: `probeSegmentQuality` guardava toda a saída do `signalstats` (~830 bytes/quadro) num buffer de 64 MB, que estoura num trecho sem corte de ~22 min a 60 fps. Correção: leitura em stream com somas acumuladas (`aethera-segment-quality.ts`); teste de regressão com clipe sintético de 25 min/60 fps (90.000 quadros); `aethera` 27 arquivos / 149 testes; tsc workspace; ESLint. Indexação retomada no app reiniciado; o usuário fechou o app às ~15:44Z com a rodada em 60% (4ª mídia em processamento havia 26 min). A etapa ficou `running` no banco sem processo: retomar com "Indexar" no app (nova rodada; as 3 mídias prontas usam o cache de visão). Visto no log, não tratado: `video:channel:profile` falha com `OAuth respondeu HTTP 400 ao renovar o token` (reconectar o canal antes de publicar).
- [ ] Pendente: Silksong sem gameplay ≤ 60 min entre os candidatos descobertos (12 h, 19 h, 3 h, 74 min; a busca traz 4 resultados por consulta) — decidir entre nova busca mais ampla ou seguir só com o trailer. Achado lateral: o canal Team Cherry (desenvolvedora) aparece como não oficial e com identidade "a revisar". Decidir sobre o arquivo de 20,5 GB já baixado (`media/aethera/hollow-knight-silksong/gameplay-pgussv-fv7w.mp4`). Risco registrado: a detecção de cenas tem timeout de 120 s; um gameplay de 60 min leva ~82 s nesta máquina, margem curta em máquinas mais lentas.
- [x] Validação no worktree: `npm run typecheck` aprovado; suíte serial completa `300` arquivos / `2.303` testes aprovados; `npm run build` aprovado; `git diff --check` aprovado; ESLint nos arquivos do AS-04 aprovado (resta só o erro pré-existente do Content OS em `channels.ts`). Sem commit nem push.

## Aethera Autonomous Studio — AS-05 Visual Intelligence (2026-11-11)

Autorizada explicitamente no checkout `C:/dev/neuralbridge-studio`, sobre `9799cf97` (AS-04 preservado).

- [x] Fundação do VisionRouter: capacidades, batches, cache, fallback, orçamento e registro de provedores; integração opcional com TaskEngine read-only para Codex/Claude.
- [x] `SubjectIdentityVerifier` separado do seletor, com duas origens independentes, rejeição de mismatch forte e identidade por segmento.
- [x] Contratos de calibração isotônica, divisão calibration/test, benchmark B-1 e persistência aditiva nas migrações `0110_aethera_visual_benchmarks` e `0111_aethera_visual_spend`.
- [x] Extração FFmpeg de 1–3 frames por segmento, indexação persistida, reindexação sem chamadas quando o conteúdo não muda e scheduler compartilhado com renderização.
- [x] Adaptador de `visual_index` registrado na composição desktop; provedores externos/modelos locais permanecem indisponíveis por padrão e o runtime continua conservador/review-only.
- [x] Validação final: regressão AS-05 com 9 arquivos e 82 testes; `npm run typecheck`; `npm run build`; ESLint nos arquivos tocados; `git diff --check`; suíte serial completa com 306 arquivos e 2.325 testes aprovados. Avisos observados são normalizações CRLF de fixtures Git.
- [x] Revisão independente encontrou seis problemas importantes e um menor; a correção adicionou testes de regressão para todos os comportamentos reproduzíveis e cobriu FFmpeg analítico, títulos sobrepostos, thresholds, scheduler de render, orçamento após lease, gasto persistido e reindexação real.
- [x] Auditoria local final confirmou as quatro correções da segunda rodada: ocorrência de títulos por intervalo, gasto persistido por run, custo preservado no checkpoint após falha e exclusão também para renders/previews do kit. A revisão externa final não foi concluída porque o agente atingiu o limite de uso; nenhuma aprovação externa é alegada.
- [ ] Homologação B-1 real: trailers/gameplays rotulados, provedores/modelos reais, métricas de qualidade/identidade/VRAM e ativação de calibração baseada nesses dados ainda dependem de ambiente e credenciais; nenhum dado ou número foi inventado.
- [ ] A interface ainda não oferece acionamento dedicado do índice visual; a composição registra o estágio para os runs de produção.
- Commit: `feat(aethera): visual intelligence foundation (AS-05)`.
- Relatório detalhado: `.superpowers/sdd/aethera-autonomous-studio/task-AS-05-report.md` (histórico de RED/GREEN, validações e limitações).

## Aethera Autonomous Studio — AS-06 Semantic Scene Matching (2026-11-11)

Autorizada pelo pedido de continuidade do plano no checkout `C:/dev/neuralbridge-studio`, sobre o AS-05 já commitado.

- [x] `rankMedia` agora aceita candidatos `MediaSegment` persistidos, juntados ao asset e à identidade independente; o ranking explica similaridade semântica frase↔descrição/tags, identidade, tipo pedido (`combat`/`exploration`/`cinematic`/`menu_ui`/`presentation`), qualidade, diversidade e duração.
- [x] Match serializado no visual da cena e no checkpoint da etapa com `segmentId`, `sourceStartMs`, `sourceEndMs`, `subjectId`, `confidence`, `confidenceBand`, breakdown e motivo; o schema aceita storyboards antigos sem esses campos.
- [x] Identidade de outro jogo nunca é elegível; `review_required`, ausência de calibração e faixa abaixo do automático permanecem candidatos marcados em `reviewCandidates`, sem seleção automática. Direitos continuam sendo um gate independente.
- [x] Nova etapa aditiva `scene_matching` lê o índice persistido, salva uma nova versão imutável com origem `matching` e preserva exatamente narração, clips de áudio, tempos medidos e `narrationKey`; sem chamar TTS ou sync.
- [x] Integração desktop registra a etapa e monta candidatos a partir de aquisições, proveniência, assets locais, segmentos e identidades; a política atual usa `thresholds: null`, portanto não inventa uma calibração real nem promove seleção automática.
- [x] Testes focados: combate contra chefe e exploração de mundo aberto preferem o tipo correspondente; jogo errado nunca entra no automático; revisão fica marcada; timestamps e breakdown são explicáveis; persistência no repositório deixa narração/sync inalterados — 10 testes focados verdes, além da regressão de storyboard/narração/repositório.
- [x] Validação final: `npm run typecheck`; `npm run build`; ESLint dos arquivos AS-06 tocados; `git diff --check`; testes focados AS-06 (10/10); regressão storyboard/narração/repositório (13/13); suíte serial completa (307 arquivos / 2.330 testes). O lint global ainda encontra apenas o erro pré-existente de `import()` em `packages/shared/src/channels.ts:671`.
- [ ] Homologação com mídia/identidade/calibração reais continua pendente por depender do B-1 e das credenciais/arquivos externos; os fixtures desta fase são explicitamente sintéticos.
- Commit: `feat(aethera): semantic scene matching (AS-06)`.

## Aethera Autonomous Studio — AS-07 Ranking Templates (2026-11-11)

Autorizada pela continuidade explícita do plano no checkout `C:/dev/neuralbridge-studio`, sobre o AS-06 já commitado.

- [x] Contrato aditivo `aethera-ranking` v1 em `shared/src/motion.ts`: abertura, cartões de posição em ordem `#N…#1`, transição entre posições, terço inferior e encerramento; cada cartão deriva título, data e plataformas do `VerifiedSubject` validado.
- [x] Builder determinístico em `workspace/src/aethera-ranking-templates.ts`: 30 fps, formatos 16:9 e 9:16, safe area persistida, rejeição de posições duplicadas/fora da sequência, snapshots de frames e chave de cache que inclui `templateId@templateVersion`.
- [x] Composição Remotion `aethera-ranking` registrada no bundle desktop; movimento reduzido elimina entrada, escala e transição animadas sem alterar conteúdo nem duração.
- [x] Snapshot visual de contrato cobre abertura e primeiro cartão; testes focados AS-07 + Motion/composição: 4 arquivos / 29 testes aprovados; regressão serial completa: 308 arquivos / 2.334 testes aprovados.
- [x] Render real do bundle em 1920×1080 a 30 fps com Chrome local: frame 20 repetido produziu o mesmo SHA-256 (`d900fa4e29e4e0395ca2202c908f59bfc18ff58eab342417e1b2fb4b2991964e`); frame 110 produziu hash distinto (`6737169a2a0f250b211b00186e12b13874ec406ecedc6c5fe4f8d257aaaf42b0`). A inspeção confirmou que o cartão permanece dentro da safe area.
- [ ] Validação com três jogos, mídia e identidade reais continua pendente das dependências externas; os sujeitos usados nos testes/render são sintéticos e não representam dados reais.
- Commit: `feat(aethera): ranking templates (AS-07)`.

## Aethera Autonomous Studio — AS-08 Semantic Editing (2026-11-11)

Autorizada pelo pedido de continuidade do plano no checkout `C:/dev/neuralbridge-studio`, sobre o AS-07 já commitado.

- [x] Contrato fechado `EditPlan` em `shared/src/aethera-studio.ts`: operações limitadas (`replace_subject_visual`, `update_scene`, `move_scene`), agente explicitamente `read-only`, confirmação obrigatória para comando ambíguo e rejeição de propriedades extras.
- [x] Planner estruturado em `orchestrator/src/semantic-editing.ts`: usa somente `runStructuredReadOnly`, não recebe ferramentas de edição, pesquisa, shell, TTS ou sync; comando e storyboard são dados sanitizados antes do prompt.
- [x] Edição semântica aplicada como nova versão imutável: troca por `subjectId`, respeita cenas bloqueadas, preserva narração, áudio, tempos medidos e `narrationKey`; undo usa o `restore` existente e recupera o storyboard anterior bit-for-bit.
- [x] Escopo de render seletivo retorna `affectedSceneIds` e `rerenderSegmentIds`; o IPC/UI do storyboard expõe o comando natural, mostra confirmação quando necessário e não inicia TTS, pesquisa ou sync.
- [x] Testes focados AS-08: 3 arquivos / 8 testes; cobrem schema fechado, fronteira read-only, sanitização de prompt, alteração somente do jogo-alvo, preservação de áudio/tempo, cenas bloqueadas, confirmação, undo e escopo de rerender.
- [x] Validação final: `npm run typecheck`; `npm run build`; `git diff --check`; suíte serial completa com 310 arquivos e 2.340 testes aprovados. O lint direcionado reproduz somente o erro pré-existente de anotação `import()` em `packages/shared/src/channels.ts:672`.
- [ ] Validação com agente, jogos, mídia e renderização reais continua pendente das dependências externas; os fixtures desta fase são explicitamente sintéticos e nenhum resultado ou credencial foi inventado.
- Commit: `feat(aethera): semantic editing (AS-08)`.

## Aethera Autonomous Studio — AS-09 Quality Director (2026-11-11)

Autorizada pela continuidade explícita do plano no checkout `C:/dev/neuralbridge-studio`, sobre o AS-08 já commitado.

- [x] Quality Director determinístico em `shared/src/aethera-quality.ts`: silêncio, preto, congelamento, loudness EBU, clipping, sync de legenda, mismatch de sujeito, repetição, marca d’água, identidade não confirmada e jogo não confirmado, todos com evidência explicável.
- [x] Inspetor FFmpeg em `workspace/src/velix-production-render.ts`: `blackdetect`, `freezedetect`, `silencedetect`, `ebur128` e `astats`; falha da medição não inventa aprovação e mantém a limitação explícita.
- [x] Integração no render existente: Quality Director consome match/subjectId do storyboard sem novo executor; cenas Aethera sem identidade confirmada bloqueiam exportação, enquanto renders legados sem sujeitos Aethera preservam compatibilidade.
- [x] Gates versionados G1–G4: G1 técnico e G2 factual são registrados automaticamente pelo Quality Director; G3 editorial e G4 publicação exigem nota humana; exportação exige G1–G3 e publicação exige G1–G4 da mesma versão.
- [x] IPC/preload/UI para aprovar G3/G4 e exibir o estado por render; aprovação de check não dispensável continua proibida para arquivo, formato, áudio, direitos e fatos.
- [x] Testes focados AS-09: 3 arquivos / 9 testes; suíte sintética de defeitos detecta 100% dos sinais injetados e o gate de versão prova exportação sem G3 e publicação sem G4 recusadas.
- [x] Validação final: `npm run typecheck`; `npm run build`; ESLint dos arquivos AS-09 tocados; `git diff --check`; suíte serial completa com 311 arquivos e 2.343 testes aprovados.
- [ ] Homologação com trailers/gameplays, loudness, identidade e defeitos de três jogos reais continua pendente do AS-10 e de arquivos/credenciais externos; nenhum número real foi inventado.
- Commit: `feat(aethera): quality director (AS-09)`.

## Aethera Autonomous Studio — AS-10 Reference Validation (2026-11-11)

Autorizada pela continuidade explícita do plano no checkout `C:/dev/neuralbridge-studio`, sobre o AS-09 já commitado.

- [x] Contrato fechado de evidências em `packages/shared/src/aethera-reference-validation.ts`: exige exatamente três jogos, IGDB + duas fontes por jogo, trailer e gameplay com proveniência, labels separados entre calibração/teste, todas as etapas da cadeia, FFprobe MP4 1920×1080, troca incremental de cena, relatório do Quality Director e métricas observadas.
- [x] Gate determinístico `pass`/`blocked`/`fail`: evidência ausente permanece `blocked`; defeito explícito ou escopo de rerender acima das cenas afetadas vira `fail`; o relatório preserva valores nulos e nunca cria métricas.
- [x] Teste TDD focado: 3/3 testes cobrem cenário completo, manifesto externo vazio e bloqueios explícitos de QA/reuso.
- [x] Loader somente leitura em `packages/workspace/src/aethera-reference-validation.ts`: o envelope esperado é `validation/as-10-evidence.json`; arquivo ausente ou JSON inválido vira `blocked`, o conteúdo válido é encaminhado ao validador compartilhado e manifesto/mídias/proveniências/labels/render/QA são conferidos dentro da pasta de referência.
- [x] Acionamento dedicado do `visual_index` adicionado à cadeia IPC/preload/main/UI; a indexação continua sendo uma etapa persistida do `ProductionRunService`, sem executor paralelo e sem aparecer em produções legadas que não têm etapas Aethera.
- [x] Gate AS-10 exposto na tela de Produção: pasta configurável, consulta somente leitura e resultado `pass`/`blocked`/`fail` por check, via IPC validado.
- [x] Validação de implementação: 313 arquivos / 2.353 testes na suíte serial; 41 testes focados AS-10/IPC; typecheck completo; build desktop; ESLint direcionado aprovado.
- [x] E2E AS-10 passou em `tests/e2e/velix-production-runs.spec.ts` (1/1, 7,2 s): atravessa a tela, preload, IPC e loader e confirma `blocked/evidence-file`; o helper foi atualizado para o rótulo atual `Aethera Studio` e os locators de status ficaram específicos.
- [x] Credenciais e execução real de pesquisa/descoberta já estão disponíveis no Aethera Studio; o envelope externo de AS-10 ainda não foi materializado.
- [ ] Homologação real permanece bloqueada: `C:/dev/aethera-reference-media` ainda contém somente `manifest.json` e `README.md`; faltam aquisição aprovada, `labels/segments.json`, pipeline completo, render 1080p, QA e métricas observadas.
- [ ] O relatório só poderá receber `pass` depois que a aquisição, o pipeline completo, o render e a inspeção QA forem executados com os artefatos reais; nenhum fixture sintético satisfaz este gate.

## Aethera Produtora — AP-02 Caminho real de mídia no render (2026-11-11) — execução técnica concluída; exportação pendente

Autorizado pelo usuário com D-AP-9 (política editorial desligada por padrão, ligada por projeto com nota), D-AP-10
(`review_required` só na prévia até decisão por ativo) e D-AP-11 (validação com produção nova e curta). Plano:
`docs/plans/aethera-production-house.md` §14.

- [x] Base de uso (`shared/aethera-render-use.ts`): `licensed` (só Rights Manager `verified_allowed`), `editorial_use`, `preview_only`, `not_allowed`; mídia adquirida nunca vira licenciada; `legalClearance` nunca alterado. 7 testes, incluindo a matriz completa.
- [x] Composição: trecho casado (`source`) no segmento de mídia; elegibilidade por base e modo (prévia/final); chave de cache antiga idêntica (`f5623c334958042a` fixada em teste) e trecho na chave quando existe; check `rights` aceita licença ou uso editorial válido; novo aviso `editorial-use` com publicador, URL e `legalClearance`; manifesto com `source`, `basis`, `heldMs` e `mediaUse`.
- [x] FFmpeg: `renderAssetSegment` corta o trecho com busca precisa, sem laço; trecho curto congela o último quadro e reporta `heldMs`; 59,94 fps sai com os quadros exatos; caminho antigo inalterado. 4 testes com FFmpeg real (fonte sintética de uma cor por segundo: o segmento abre no segundo 7, não no 0).
- [x] Etapa de render: prévia aceita `preview_only`, final não; teste de integração real prova recusa sem base, prévia só com `preview_only`, render final com `editorial_use`, trecho certo no quadro e tabela de direitos intocada.
- [x] Jogo por cena (`orchestrator/aethera/scene-subjects.ts`): título citado na narração, capítulo com um único jogo; ambíguo fica sem jogo; escolha humana preservada. O ranking passou a considerar a base de uso (antes exigia `verified_allowed` até para propor candidato, então mídia adquirida nunca aparecia). Candidatos em revisão ganham `candidateKey` e `assetId`.
- [x] Operações `accept_match` (só candidato proposto, nunca trecho livre; recusa outro jogo e cena bloqueada) e `assign_subject` (descarta trecho de outro jogo); cada uma é uma nova versão do storyboard (desfazer pelo histórico).
- [x] Migração aditiva `0112_aethera_editorial_use` (política por projeto e decisão por ativo), repositório e inventário de tabelas.
- [x] IPC: política editorial (ler/alterar), base de uso das mídias, decisão por ativo, candidatos em revisão, disparo do matching e quadro de um trecho (data URL).
- [x] UI nos componentes atuais: "Uso editorial de mídia de terceiros" (política com motivo obrigatório, base de cada mídia, decisão por ativo) e "Cenas e trechos" (jogo da cena, trechos propostos com quadro, nota, base de uso e "Usar este trecho").
- [x] Correções encontradas na validação real (todas com teste): ranking exigia `verified_allowed` até para propor candidato; trechos sem corte viravam um segmento de 53 min (agora janelas de até 20 s, `windowCuts`) e a medição de qualidade passou a amostrar 10 fps em 180 p (reindexação de 33+ min para ~12 min); alinhador e inferência de jogo não reconheciam números e siglas falados por extenso ("dois mil e setenta e sete", "efe tê cê"), corrigido com `portugueseNumber` e nomes das letras (sincronização de 88% bloqueante para 93%); o FFmpeg embutido do app (build mínimo do Remotion) não tem `fps`/`tpad`: o corte usa só scale/crop/format e `-r`, e um trecho curto continua tocando a fonte (`extendedMs`), testado nos dois FFmpeg; botões que exigiam motivo ficavam desabilitados sem explicação, agora avisam e focam o campo; o guarda de IPC barrou um campo chamado `authorization` (renomeado para `useApproval`).
- [x] **Validação audiovisual real (M1), 2026-11-11, run `7013e4fb` "AP-02 · 3 jogos"**: pesquisa IGDB (Cyberpunk 2077 e Elden Ring confirmados, Silksong `conflicting`), roteiro Codex (316 palavras), narração com a voz do canal (88,3 s), sincronização 295/316 (93%), 5 fontes reaproveitadas sem novo download, reindexação com janelas (Cyberpunk gameplay 211, Elden Ring gameplay 173 segmentos), política editorial e jogo de 7 cenas registrados por instrução explícita do usuário no chat (os cliques no app não chegavam à janela de desenvolvimento), 4 trechos aceitos pelo usuário (Elden Ring 104–110 s e 117–132 s; Silksong 23–39 s e 44–54 s), decisão editorial do trailer do Silksong (`review_required` → aprovado com nota). Prévia 640×360 e final `producoes/7013e4fb…/render/youtube-long-v017.mp4` 1920×1080, 30 fps, 88,27 s, h264/aac. Comparação de quadros no meio de cada cena: diferença ao trecho escolhido 6,8–14,1 contra 10,3–62,4 ao segundo 0 da fonte. Manifesto com `source`/`basis` por segmento e `mediaUse` (`legalClearance: unknown`); nenhuma linha em `velix_media_rights`; biblioteca continua `pending_review`/`conditional`.
- [x] **Correção e rerender AP-02, 2026-11-11**: Quality Director, montagem final, FFprobe, silêncios, loudness/clipping e legendas gravadas usam `C:\ffmpeg\bin\ffmpeg.exe`/`ffprobe.exe`; o FFmpeg embutido permanece somente na composição/segmentação. Narrow suite: 5 arquivos, 36 testes passados; `npm run typecheck` e `npm run build:motion` passaram. Nenhum filtro obrigatório ausente (`filtersMissing: []`).
- [x] **Rerender real v018**: `producoes/7013e4fb-f81e-41e7-8bc2-d5bb1a67b74f/render/youtube-long-v018.mp4`, manifesto `youtube-long-v018.json`, SRT `youtube-long-v018.srt`, relatório `quality-report-youtube-long-v018.json` e storyboard `v018.json`. FFprobe: 1920×1080, 30 fps, 109,011 ms, h264/aac; `captionsBurned: true`. Quality Director: silêncio `[]`, preto `[]`, congelamento `[]`, loudness `-18,3 LUFS`, pico `-1,9 dBTP`, clipping `0`, sync de legendas aprovado. Comparação de quadros nos quatro trechos: `35,68`, `12,40`, `38,08`, `27,28` de mean absolute difference.
- [x] **Regra de mídia e telas pretas**: somente os dois trailers locais já usados no AP-02 foram reutilizados (Elden Ring e Silksong); nenhum download novo e nenhuma linha no Rights Manager. A segunda janela do Elden Ring foi ajustada de `117267–131698 ms` para `128000–135835 ms` dentro do mesmo trailer, pois a janela anterior continha preto fornecido pela própria fonte. O render final não possui intervalo preto prolongado.
- [x] **Histórico dos bloqueios do v018**: 4 fatos sem evidência aprovada (`claims`), uso editorial de terceiros com `legalClearance: unknown` (`G3/G4` pendentes) e Silksong `conflicting/unconfirmed` (`G2` bloqueia corretamente). O v018 foi preservado como referência e não foi sobrescrito.
- [x] **Pesquisa oficial dos fatos e licenças**: relatório `docs/aethera/ap02-research-2026-11-11.md`. Três fatos foram confirmados com fontes primárias (FTC, CD PROJEKT RED, BANDAI NAMCO Europe e Team Cherry); “comparáveis” foi rebaixado para enquadramento editorial; a afirmação ampla sobre inexistência de notas/vendas/recordes foi removida do texto.
- [x] **Roteiro, narração, legendas e timeline corrigidos**: roteiro `producoes/7013e4fb-f81e-41e7-8bc2-d5bb1a67b74f/roteiro/roteiro-v003.json`, claims `pesquisa/afirmacoes-v002.json`, storyboard `v020` e timeline `timeline-v020.json`. A pronúncia passou a usar “padrões sombrios” em vez de uma frase isolada em inglês; o alinhamento terminou com 42 legendas sem frases sem tempo.
- [x] **Prévia segura v020**: `producoes/7013e4fb-f81e-41e7-8bc2-d5bb1a67b74f/render/youtube-long-v020.mp4`, manifesto `youtube-long-v020.json`, SRT `youtube-long-v020.srt` e relatório `quality-report-youtube-long-v020.json`. FFprobe: 1920×1080, 30 fps, 113,710 ms, h264/aac; `captionsBurned: true`; `mediaReferenceIds: []`. Quality Director: todas as checagens passaram — zero silêncio longo, preto, congelamento, clipping e desvio de legenda; loudness `-18,4 LUFS`, pico `-1,9 dBTP`.
- [x] **Substituição dos trechos não liberados**: Elden Ring e Silksong têm proveniência oficial, mas não têm autorização/licença comercial específica comprovada para recortar e republicar os trailers. Os quatro trechos foram removidos da v020 e substituídos por motion graphics, sem alterar `legalClearance` e sem gravar linhas no Rights Manager. Substituição recomendada para publicação: captura própria com direitos comerciais documentados, press kit com permissão explícita ou mídia licenciada/produzida sob encomenda.
- [ ] **Bloqueios de publicação após a v020**: o modelo OmniVoice/pesos CC-BY-NC e o áudio do VoiceStudio continuam limitados ao escopo `noncommercial`; não usar esta narração em publicação monetizada. Para publicar comercialmente, obter modelo/licença de voz comercial e decidir uma fonte visual com permissão comercial explícita. O vídeo permanece apenas como demonstração técnica até nova autorização humana.
- [x] **Validação AP-02 no escopo aprovado**: a voz atual Aethera/OmniVoice pode continuar sendo usada nas prévias e produções do canal enquanto permanecerem não comerciais. A restrição comercial acima é intencional e não bloqueia o objetivo atual do projeto.
- [ ] Achados registrados: gameplays do canal BRKsEDU têm webcam do streamer (rosto de terceiro) e o sistema não detecta webcam/sobreposição; canal da Team Cherry classificado como não oficial; sem provedor de visão o matching não distingue conteúdo (notas ~0,40, quadros pretos e cartões de texto entre as opções); inferência de jogo grava o resultado como `subjectId` e depois não distingue de escolha humana.

## Aethera — Voz do canal (2026-11-11)

- [x] Auditoria do VoiceStudio 0.5.7: único TTS instalado é OmniVoice (pesos CC-BY-NC, `commercial_inference: restricted`, `commercial_outputs`/`voice_rights` desconhecidos); `/v1/audio/speech` aceita `instruct` (design por atributos) e `seed` determinístico; `/design/describe` traduz descrição em atributos.
- [x] Auditoria comercial em `docs/aethera/voice-engine-commercial-audit-2026-11-11.md`: VoiceStudio é AGPL-3.0-only e pode ser usado comercialmente sob seus termos, mas isso não libera pesos, tokenizer, voz ou outputs; OmniVoice é Apache-2.0 no código e CC-BY-NC nos pesos, o tokenizer tem termos Boson/Meta separados e não há concessão geral de direitos comerciais sobre os áudios gerados.
- [x] Três amostras isoladas, sem clonagem e sem alterar a voz oficial: `docs/aethera/voice-engine-samples-2026-11-11.md` (Kokoro PT-BR, Piper PT-BR e Chatterbox PT). Kokoro é o primeiro candidato técnico; Piper depende de decisão GPL; Chatterbox é expressivo, mas aposentado no upstream.
- [x] **Decisão do usuário, 2026-11-11**: manter a voz atual Aethera/OmniVoice para produção exclusivamente não comercial, sem monetização, patrocínios ou exploração comercial. Kokoro, Piper e Chatterbox não serão implementados nem integrados; as amostras permanecem somente como registro de investigação. VoiceStudio, preset, autorização e verificações de licença existentes permanecem inalterados.
- [x] Três amostras originais por design + seed, sem áudio de referência nem clonagem (`C:/Users/Pheli/Documents/ChatGPT/Videos/vozes/amostras-aethera/`); seed reproduz a voz (duração ±30 ms, volume ~1 dB); transcrição em português correta. Escolhida pelo usuário: **C — dinâmica** (male, young adult, moderate pitch, seed 303, 1,12×).
- [x] Preset do canal (`aethera-voz-dinamica`, escopo do projeto; voz padrão do app inalterada), autorização persistente e revogável ligada à impressão da licença declarada pelo VoiceStudio (expira se ela mudar; escopo `noncommercial` para OmniVoice; comercial só com modelo de licença comercial), direção por cena (velocidade 0,8–1,3× e pausa de até 2 s como silêncio real). Migração `0113_aethera_voice`, IPC e painel "Voz do canal". Autorização concedida pelo usuário no app em 17:38Z.
- [x] Testes: contratos 5, repositório, cliente VoiceStudio (design sem `voiceId`, licença do modelo), etapa de narração com preset (recusa sem autorização, silêncio de 600 ms real, bloco cortado na pausa); suíte serial completa 317 arquivos / 2.391 testes + guarda de IPC corrigido; `shared` + `desktop` 1.019 testes.
- [x] Escopo de uso da voz definido: OmniVoice/Aethera está aprovado pelo usuário para o canal não comercial e continua bloqueado para qualquer monetização, patrocínio ou exploração comercial. Não há troca de motor nem alteração no Rights Manager.
- [ ] Limite: OmniVoice não tem controle de emoção; energia e expressividade dependem de texto, pontuação e velocidade.

## Aethera Produtora — AP-03 Timeline estruturada (2026-11-11) — CONCLUÍDA tecnicamente no worktree

- [x] Contrato `TimelineDocument` v1 em `packages/shared/src/aethera-timeline.ts`, com fontes fechadas, faixas, clipes, transformações, keyframes, transições, efeitos, marcadores e mix de áudio.
- [x] `assembleTimeline` converte o storyboard medido em timeline determinística; IDs de clipe permanecem estáveis por cena e o trecho casado (`inMs`/`outMs`) é preservado.
- [x] `TimelineOp` básico com seletor determinístico (`subjectId`, `clipIds`, intervalo e seleção total), operações de fonte, faixa, movimento, corte, remoção, inserção gráfica e ganho; cada aplicação produz `TimelineChange` versionado.
- [x] Hash determinístico compatível com renderer, sem dependência Node no pacote compartilhado; operações desconhecidas e seletores vazios são rejeitados pelo schema fechado.
- [x] Persistência aditiva `0114_aethera_timelines`, `AetheraTimelineRepository` e histórico imutável com reabertura do banco; versões antigas de storyboard permanecem intocadas.
- [x] Validação focada: timeline `3/3`, repositório Aethera `12/12`, integridade/migração do banco `19/19`; typecheck de `shared` e `database` aprovados.
- [x] Regressão global após AP-02 + AP-03: typecheck completo e suíte serial `320` arquivos / `2.415` testes aprovados; `git diff --check` sem erros.
- [ ] Integração da timeline como fonte da prévia/render e interface Editor ficam para AP-04/AP-07/AP-08; o compositor atual ainda é mantido para compatibilidade.

## Aethera Produtora — AP-04 Composição Remotion e proxies (2026-11-11) — EM IMPLEMENTAÇÃO, sem commit
- [x] Contrato compartilhado `AetheraTimelineCompositionProps` e `compileAetheraTimeline`: janela de render, hash da timeline, camadas, corte de fonte, transformações, keyframes de câmera push-in/pan, efeitos/transições e palavras de legenda.
- [x] Prova RED→GREEN em `packages/shared/test/aethera-timeline-composition.test.ts`: prévia e render recebem JSON idêntico; 3+ camadas, trecho casado, janela parcial, palavras, transição e cache key por janela/proxy.
- [x] Composição Remotion `aethera-timeline` registrada no bundle; o worker isolado aceita as mesmas props serializadas. Build `npm run build:motion` aprovado.
- [x] Proxies locais AP-04: `createAetheraMediaProxy` gera H.264 540p com GOP curto a partir de arquivo já local; `aethera_media_proxies`/migração 0115 e `AetheraMediaProxyRepository` persistem metadados sem tocar em Rights Manager. Teste real do FFmpeg aprovado.
- [x] Fundo de fallback do compositor legado deixa de ser tela preta; composição AP-04 usa gradiente petróleo/esmeralda quando não há proxy disponível.
- [x] Validações focadas: shared 3/3; database 32/32; workspace render 13/13; typecheck shared/workspace/database/desktop; bundle Motion.
- [x] IPC aditivo de timeline: o Editor cria/carrega a primeira versão, aplica operações com `baseVersion` e lista histórico imutável; `replaceSource` só reutiliza asset já presente na timeline.
- [x] O adaptador de render consome a última `TimelineDocument` persistida quando o formato coincide, renderiza as janelas com `renderAetheraTimelineSegments`, registra reuso e monta o áudio/legendas depois; sem timeline persistida, o caminho Velix antigo continua compatível.
- [x] A criação inicial da timeline tenta reutilizar ou gerar proxy H.264 540p apenas para arquivos locais já registrados, persiste o metadado em `aethera_media_proxies` e não altera direitos.
- [x] ~~Pendências da fase~~ tratadas no fechamento abaixo (2026-11-12).

### AP-04 — fechamento autorizado (2026-11-12), sem commit

Escopo: D-AP-17 (texto sobre imagens), selo ilustrativa/reconstituição, fundo chapado evitável no QD e na revisão, prova
real de reuso e proxy, validação audiovisual.

- [x] **Texto sobre imagens (D-AP-17).** `assembleTimeline` põe por trás de cada cena `fallback` um clipe `video:backdrop:<cena>`: o trecho casado mais próximo do **mesmo assunto** (ou, em cena sem assunto, como abertura e encerramento, do tema do vídeo), desacelerado até 0,5× se faltar duração, com `blur` + `color` (brilho 0,45) e `intent.reason`. Cena de um assunto nunca usa imagem de outro; sem trecho longo o bastante, nada é inventado.
- [x] **Motivo técnico fora da tela.** O cartão gráfico de cena `fallback` exibia `visual.reason` ("Nenhum trecho com identidade verificada…") como título; agora o motivo fica só para a pessoa, e o gráfico sem texto não desenha placeholder.
- [x] **Selo manual.** `clipDepictions` (`real_record`, `illustrative`, `reconstruction`), campo opcional `depiction` no clipe, operação `setDepiction`, camada leva o campo e a composição desenha "Imagem ilustrativa"/"Reconstituição"; controle "Natureza da imagem" no inspetor do Editor (marcação humana, não altera direitos nem origem).
- [x] **Fundo chapado evitável.** `avoidableFlatBackgroundSceneIds`; QD `director-flat-background` (aviso) alimentado pela timeline persistida em `renderQuality`; revisão AP-10 `flat-background` (aviso).
- [x] **Defeitos de produção achados na prova real e corrigidos:**
  1. Chave de cache do segmento usava o hash da timeline inteira (qualquer edição invalidava tudo) → agora é o que a janela desenha; proxy só conta se o ativo aparece na janela.
  2. `renderAetheraTimelineSegments` passava o segmento com `index`/`key` ao schema estrito → ZodError; o render por segmentos nunca tinha rodado.
  3. `calculateMetadata` da composição lia `props.window`, mas o Remotion entrega `{ props: { props } }` → a composição nunca tinha renderizado num worker real.
  4. `OffthreadVideo` só baixa http(s): novo `serveRenderMedia` (`workspace/src/aethera-media-server.ts`) serve só os proxies da janela em 127.0.0.1, porta aleatória, token de 128 bits, Range, fechado ao fim do job.
  5. Proxies da timeline não eram gerados para **mídia adquirida** (procurava o arquivo pelo id da referência): `ensureAetheraTimelineProxies` agora usa o vínculo de proveniência (`acquiredMediaUse`).
- [x] **Prova real fora do app** (mesmas funções de produção; o app antigo não pôde ser reiniciado nesta sessão), run `7013e4fb`, storyboard v17 lido do banco somente para leitura:
  - timeline: vídeo 10 (4 trechos + 6 fundos D-AP-17), gráficos 9, legendas 13, narração 13; fundo chapado evitável: nenhum;
  - proxies 540p H.264 reais: trailer Elden Ring 27,5 s, trailer Silksong 11,8 s (`proxies/aethera/…`);
  - render 1: 13 segmentos em 218,3 s; edição de **uma** cena (`setDepiction`) → render 2: **12 de 13 reaproveitados, 12,0 s**, só a janela 5 renderizou de novo;
  - MP4 `producoes/7013e4fb…/render/ap04-prova.mp4`: 1920×1080, 30 fps, 88,3 s; −15,3 LUFS; pico −1,3 dBFS; blackdetect e freezedetect sem ocorrência; quadros conferidos (fundos desfocados, título "Elden Ring", selo, legenda por palavra).
- [x] Testes: composição 8/8, quality, review, servidor de mídia 2/2, workspace motion 22/22, ACE-Step 6/6; typecheck geral; ESLint dos arquivos tocados; suíte serial completa 330/332 arquivos e 2.460/2.462 testes — as 2 falhas (`git-write` push remoto e `neura-orchestrator` parada manual, fora do AP-04) passam isoladas (145/145), por tempo sob carga.
- [ ] **Validação audiovisual humana: REPROVADA editorialmente (2026-11-12).** Passou nos testes técnicos, não na qualidade editorial. Achados do usuário: abertura sem composição, legenda fragmentada palavra a palavra, cenas com uma palavra sobre gradiente, identidade inconsistente, um "cartão" fora de contexto, legenda competindo com texto do trailer, voz acelerada. Investigação com evidência:
  - **"Cartão" de dark patterns/FTC:** não é vazamento. A legenda, sem palavra ativa durante uma pausa (1,7 s na cena 11), cai para a narração inteira da cena numa caixa grande (`TextLayer`). O texto vem do roteiro (cena 11), sem relação visual com o fundo de Silksong.
  - **Voz:** 215 palavras/min em média, picos de 283 (cena 3) e 264 (cena 6); referência documental PT-BR 140–170. Entre cenas, 1 ms de intervalo (sem respiro). Preset da Voz C com velocidade 1,12.
  - **Escolha por disponibilidade (causa raiz):** os 504 trechos indexados das fontes desta produção estão todos `unknown`, com "Semantic content unavailable" — nenhum provedor de visão está habilitado (`createVisionProviders()` sem provedor configurado). O casamento só conhece jogo e qualidade técnica. O `visualObjective` do storyboard é um saco de palavras da fala ("Mostrar: aqui, cada, compare"), não uma intenção visual. Cenas cortam no meio de um tópico (cena 7 termina em "Terceiro eixo: a exploração" sobre combate de Elden Ring) e a cena 5 cita os três jogos, mas tem um assunto só.
  - **Fundo desfocado do D-AP-17** foi aplicado a toda cena sem mídia, não só onde há texto na tela: virou padrão, não decisão.
  - Conclusão: o QD aprova o técnico, e nada impede que uma edição sem correspondência entre fala e imagem pareça "pronta". O AP-05 fica em espera até a correção editorial.
- [ ] **Caminho no app** (proxy de mídia adquirida, sinal do QD) com o app reiniciado — não verificado nesta sessão.
- [ ] Limitações observadas: o mesmo trecho aparece como fundo em cenas vizinhas (sem offset por cena); trailer com texto queimado em inglês colide com a legenda; cenas de Cyberpunk seguem em gradiente porque nenhum trecho do jogo foi casado; a prévia no Player ainda não toca proxies (caminho relativo no navegador) — AP-08.

### AP-04 · etapa 1 — piloto do VisionRouter com Claude/Codex pelo TaskEngine (2026-11-12), sem commit

Decisão do usuário: Claude preferencial, Codex fallback, via TaskEngine e VisionRouter existentes; nenhum modelo local.

- [x] **Contrato universal** `shared/src/aethera-visual-analysis.ts`: `sceneNatures` neutras (ação, exploração, paisagem, diálogo, fala, multidão, retrato, cinemática, interface, cartão de texto, documento, outro, desconhecido), quadros com `atMs`, texto visível com região, entidades/ações/ambiente com base `observed`/`inferred`, evidência e confiança, overlays (texto queimado, marca d'água, webcam), limitações. `segmentAnalysisRecordSchema` registra provedor, modelo configurado, modelo reportado e versão do prompt. Juiz `narrationRelevanceSchema` + gate determinístico `relevanceDecision`: aceita só com aspecto observado; vínculo só pelo nome do assunto, parcial, incerto ou confiança < 0,7 → revisão humana; "não representa" → rejeita.
- [x] **VisionRouter `analyze`**: todos os quadros de um trecho numa chamada (nunca divide), cache por hash dos quadros + `atMs` + contexto + provedor + modelo + versão do prompt; análise com confiança 0 não entra no cache. Provedor do TaskEngine com `analyze` em modo enxuto (sem ferramentas) e modelo reportado. `orchestrator/src/aethera/visual-relevance.ts`: juiz só por texto sobre a observação guardada.
- [x] **Defeito crítico do TaskEngine corrigido:** `runStructuredReadOnly` recebia `images`, mas a requisição à CLI usa `run.images`, criado vazio → **nenhuma análise de imagem por esse caminho chegava a Claude ou Codex**. O teste do AS-05 só verificava o adaptador com mock. Corrigido em `engine.ts` com teste de regressão. O mesmo padrão existe no checkout principal (`C:\dev\neuralbridge`, `engine.ts:425`).
- [x] **Piloto real** (TaskEngine com banco temporário; CLIs reais; 50 trechos de 5 fontes, 10 por fonte, 3 quadros cada com timestamp; gabarito rotulado por inspeção dos quadros):
  - Claude (`sonnet`, reportado `claude-sonnet-5-5`): 50/50 analisados, 0 falhas, sem fallback; mediana 15,9 s por trecho, p90 21,4 s, total 12,9 min.
  - Natureza: 38/50 (76%) no critério estrito. Interface 6/6, cinemática 5/5, ação 9/11, exploração 10/13, cartão de texto 7/9, diálogo 0/3 (diálogo com legenda vira "cinemática"). Ao menos 1 dos 12 erros era do gabarito (`elden-gameplay-3239320` tem combate).
  - Texto queimado: 34/34. Webcam de streamer: 20/20, 0 falso positivo (todos os gameplays de Elden Ring e Cyberpunk têm webcam).
  - Observado × inferido: 124 entidades observadas, 33 inferidas; o nome de obra só aparece como observado quando legível na tela (logo, tutorial). Identificou a "fonte de Cyberpunk" como demonstração NVIDIA RTX/DLSS 3.
  - Confiança não separa acerto de erro (média 0,80 × 0,76): não serve sozinha para automação.
  - Relevância, 24 pares: sem intenção visual, 0 aceitações indevidas, 13/15 "não representa" rejeitados (2 em revisão) e 0/6 positivos aceitos (frase inteira tem partes abstratas). **Com intenção visual por tomada: 4/8 positivos aceitos, 4 em revisão, 0 aceitações indevidas em 16 negativos**; `subjectOnly` detectado em 7 pares. Juiz: mediana 5,5 s.
  - Cache: segunda rodada dos 50 trechos 100% do cache, 3 s no total, nenhuma chamada.
- [ ] **Codex (fallback) não validado:** as 5 chamadas falharam por limite de uso da conta ("try again at Nov 16th, 2026 10:29 PM"); o router registrou o erro e não inventou resultado. Suporte a imagem do Codex (`--image=`) segue não comprovado.
- [ ] Limitações: diálogo × cinemática ambíguos; confiança não calibrada; gabarito de uma só pessoa (recomendada auditoria de amostra pelo usuário); custo de cota da assinatura Claude ~13 min de CLI por 50 trechos.
- [x] Piloto aprovado pelo usuário como prova de viabilidade técnica (2026-11-12). Plano da etapa 2 em `docs/plans/aethera-production-house.md` §16, aguardando autorização.
- [ ] **Correção necessária fora deste checkout:** o mesmo defeito de imagens do TaskEngine existe em `C:\dev
euralbridge` (`packages/orchestrator/src/engine.ts:425`); não alterado sem autorização específica.

### AP-04 · etapa 2 — E1, E3 e E4 estabilizados (2026-11-12), sem commit

Etapa 2 autorizada (lotes E1–E7; E8 só com relatório de seleção antes de render). Decisões D-E1…D-E4 aprovadas: trailer
oficial de Cyberpunk a pesquisar (identidade, origem e condições validadas antes de usar), Voz C a 1,0 no preset com
ajustes por produção preservados, FTC removida desta demonstração, tema grafite neutro com acentos das mídias aceitas.
Diretrizes: 145–170 ppm vale para esta demonstração (não é regra universal); origem oficial ≠ autorização; Rights Manager
preservado; sem mídia utilizável → composição original que represente a informação; gate avalia também legibilidade,
composição, ritmo e coerência.

- [x] `shared/src/aethera-editorial.ts` (exportado): `captionCues` (E3: frases de até 2×42 caracteres, quebra em fim de frase e pausa ≥ 300 ms, máx. 6 s, mínimo de leitura 1,2 s quando a próxima permite; nada entre frases, nunca o parágrafo), `shotIntentSchema`/`splitSceneIntoShots` (E4), `editorialGate` + `editorialReportMarkdown` (E1: checagens por tomada — visual presente, relevância ou decisão humana, webcam, fonte divergente, repetição, colisão legenda × texto gravado, ritmo, legibilidade do texto, tema; globais — ritmo da fala por cena com faixa dada pela produção, leitura da legenda; status `blocked`/`awaiting_review`/`ready_for_human`/`approved`, este último só com aprovação humana registrada).
- [x] **Diagnóstico e correção da divisão em tomadas** (aprovada pelo usuário). Falha: a enumeração "Em Cyberpunk… Em Elden Ring… Em Silksong…" virava 2 tomadas. Segmentação e timestamps estavam corretos; a última frase durava 1,16 s de fala (fixture a 300 ms/palavra ≈ 200 ppm) e a regra de cauda a fundia com a anterior, criando uma tomada com dois jogos. Causa real: (1) duração medida como fala, não tempo de tela; (2) fusão só por duração, sem olhar conteúdo. Correção: tempo de tela (até o início da próxima tomada; a última até o fim da cena, `SceneWords.endMs` opcional); fusão automática só de fragmentos sem conteúdo próprio (≤ 2 palavras, "Sim.", "Pois é."), antes ou depois do vizinho; frase curta com conteúdo continua tomada própria e recebe o aviso de ritmo do gate; a junção por intenção compatível fica no E4. Mínimo de 1,2 s mantido (`MIN_SHOT_SCREEN_MS`, também usado pelo gate).
- [x] **Erros TypeScript (linhas 59, 60, 63 do teste):** `{ ...x as never }` é spread de `never` (TS2698), usado para contornar a união discriminada; o código de produção estava correto. Exportado `FootageVisual` e criado helper tipado no teste. O typecheck geral revelou ainda uma variável sombreada no teste do piloto de visão (`first`), que fazia a checagem de invalidação do cache usar o resultado em vez do quadro; corrigida.
- [x] Validação: `aethera-editorial.test.ts` 11/11 (novos: enumeração com 3 tomadas a ritmo rápido, tempo de tela, fragmentos antes/depois); suíte inteira do shared 53 arquivos / 298 testes; `aethera-vision-analyze` 5/5; `npm run typecheck` geral sem erros; ESLint dos arquivos tocados sem erros.
- [ ] Próximos (aguardando início): E2, E7, E4 (intenções), E5, E6; E8 só relatório de seleção.

### AP-04 · etapa 2 — E2 (narração) e E7 (conteúdo e fontes) (2026-11-12), sem commit

- [x] **E2 · cadência como dado.** `shared/src/aethera-voice.ts`: `narrationPacingSchema`, `NARRATION_PACING_STYLES` (`documentary` 145–170 ppm, bloqueio 185, pausas 280/600/900 ms; `conversational`; `energetic`) — estilos que o Director escolherá por produção, nenhum é regra universal; `pacingDirections` (pausa após cada cena, maior antes de nova seção, nenhuma após a última; a direção manual da cena vence), `startsSection`, `sentenceTexts`. A etapa `narration` aceita `pacingStyle` e reaproveita `planDirectedSegments` e o gerador de silêncio existentes; o manifesto registra `pacingStyle` (campo opcional; narrações antigas seguem válidas).
- [x] **E2 · preset da Voz C em 1,0** (D-E2), pelo repositório (mesmo caminho do "salvar voz" do app): só `speed` mudou (1,12 → 1,0); design, seed, amostra e a autorização persistente continuam iguais e ativos. Override de velocidade por produção preservado.
- [x] **E2 · medição real no VoiceStudio (OmniVoice, mesmos parâmetros da etapa), 3 cenas:**

  | Velocidade | Cena 3 | Cena 6 | Cena 5 |
  |---|---|---|---|
  | 1,0 | 203 ppm | 214 ppm | 171 ppm |
  | 0,9 | 182 | 192 | 154 |
  | 0,85 | 174 | 182 | 146 |
  | 0,8 | 162 | 172 | 137 |

  **Achado:** 1,0 no preset não basta para a faixa desta demonstração; o OmniVoice fala rápido por natureza. A faixa 145–170 pede ~0,8–0,85 **nesta produção** (override por produção, não no preset). Pausas entre frases já saem do próprio TTS (≈ 270–990 ms pela pontuação). Amostras para escuta em `vozes/amostras-aethera/cadencia/` (cenas 3 e 6 a 1,0/0,9/0,85/0,8). Limitações: palavras/min é enviesado pelo tamanho das palavras (cena 6 tem palavras curtas); naturalidade a 0,8 só a escuta decide.
- [x] **E7 · remoção da FTC** (D-E3). Nova operação aditiva `remove` no storyboard (cena bloqueada e cena única recusadas; as demais fecham o intervalo). Aplicada ao run `7013e4fb`: storyboard **v18**, 12 cenas, 79,9 s, tempo medido; v17 preservada no histórico. Nenhuma afirmação da FTC/dark patterns restante. A cena 10 ainda termina em "truques de interface" (frase autônoma, mantida).
- [x] **E7 · fonte divergente.** `assessSource` (`shared/src/aethera-visual-analysis.ts`), determinístico e neutro: webcam em ≥ 50% dos trechos → `third_party_commentary`; mídia adquirida como promo com o mesmo texto sobreposto em ≥ 40% dos trechos → `divergent_suspected`; menos de 4 trechos → `insufficient_evidence`. Só sinaliza para a seleção e para a pessoa; não muda direitos, proveniência nem o tipo declarado. Nos dados reais do piloto: trailers de Silksong e Elden Ring `consistent`; "trailer" de Cyberpunk `divergent_suspected` (texto "rtx on"); os dois gameplays `third_party_commentary`.
- [x] Validação: pacing 3/3, visual-analysis 6/6, storyboard 10/10, narração (FFmpeg real) 2/2; shared + orchestrator Aethera 69 arquivos / 385 testes; `npm run typecheck` sem erros (um conflito de nome com `SourceStatus` do monitoramento foi corrigido renomeando para `MediaSourceStatus`); ESLint dos arquivos tocados sem erros.
- [ ] Narração completa da produção ainda não regenerada: depende da velocidade escolhida e roda pela etapa `narration` do app (E8).

### ACE-Step 1.5 local — instalação e primeira geração (2026-11-12)

- [x] `C:\dev\ace-step-1.5` com `uv sync`; modelos em `C:/dev/ace-step-models` (11 GB: DiT turbo, VAE, Qwen3-Embedding-0.6B, LM 0.6B; o pacote principal também trouxe o LM 1.7B, não usado).
- [x] API local em 127.0.0.1:8001 (tier3, 8 GB). Defeito corrigido no cliente: a API carrega modelos sob demanda e `/v1/models` volta vazio até a primeira geração; `probe` aceita o `loaded_model` do `/health` (teste novo).
- [x] Geração real de 45 s pelo `AceStepLocalClient`: WAV 48 kHz estéreo, −15,5 LUFS, pico −1,0 dBFS, manifesto com modelo, seed, hash do prompt e evidência de licença. ~9 min a frio (≈4 min de carga dos modelos) com pico de 7,8 GB de VRAM; VoiceStudio descarregado antes.
- [ ] Tempo a quente e integração da faixa ao vídeo ficam no AP-05.

## Aethera Produtora — AP-05 Áudio profissional (2026-11-11) — EM IMPLEMENTAÇÃO, sem commit
- [x] Contratos `MusicLibraryTrack`/`GeneratedMusicTrack`, licença/evidência, `AetheraAudioPlan`, ducking por palavra e `SfxEvent` alinhado a frame; fonte `generated` só passa com manifesto ACE-Step local, hash e escopo não comercial.
- [x] `designAetheraAudio` só escolhe faixa de biblioteca com licença registrada e deixa música nula quando não há faixa elegível; `validateAetheraAudioPlan` exige true peak ≤ −1 dBTP e ducking ≥ 10 dB abaixo da fala.
- [x] Grafo FFmpeg local com `loudnorm`, ducking nas janelas medidas e `adelay` para SFX; testes de contrato aprovados.
- [x] Biblioteca de música por projeto persistida em `aethera_music_library`/migração 0116, sem alterar Rights Manager. Repositório e regressões de migração aprovados.
- [x] O render final agora recebe `AetheraAudioPlan` por callback, monta o vídeo sem áudio, renderiza a mixagem com FFmpeg completo e faz mux de volta; o plano e o manifesto SFX são artefatos persistidos por render. A narração recebe o ganho do plano, SFX usam `adelay`/`loudnorm` e o caminho legado permanece intacto.
- [x] Manifesto somente leitura do kit MotionVelix local (`assets/sfx`, 31 WAV já instalados) com SHA-256 e evidência `motionvelix-user-kit-original-synthesized`; transições explícitas da timeline viram eventos frame-alinhados. Nenhum download, cópia, Rights Manager ou licença de mídia de jogo foi alterado.
- [ ] Pendências: nenhuma faixa musical está registrada com licença verificável, portanto a mixagem segue sem música; falta homologar um render audiovisual real com SFX e confirmar no Quality Director −14 ±1 LUFS/true peak. A licença/evidência do kit SFX continua separada dos direitos das mídias de jogo.
- [x] Avaliação do ACE-Step 1.5 registrada em `docs/aethera/ace-step-1.5-evaluation-2026-11-12.md`: API local viável sem serviço pago; na RTX 4060 Ti de 8 GB, piloto recomendado com Turbo + LM 0.6B + `pt`, INT8/offload e batch 1. Python 3.14 local não atende ao requisito oficial 3.11–3.12.
- [x] Adaptador local `AceStepLocalClient`: restringe a origem a localhost, negocia `/health` e `/v1/models`, envia apenas `text2music` instrumental, acompanha `/release_task` + `/query_result`, valida o caminho `/v1/audio`, calcula SHA-256 e persiste manifesto de modelo, revisão, parâmetros, origem local e evidências de licença. Nenhum checkpoint foi instalado/baixado e nenhum serviço externo é chamado pelo adaptador.
- [x] Cache imutável por hash de prompt normalizado, modelo/revisão, LM/backend e parâmetros; reuso verifica manifesto, faixa e SHA-256. `aceStepInstrumentalRequest` traduz intenção existente da timeline em gênero, emoção, intensidade e prompt sem voz.
- [x] Faixas ACE-Step registráveis em `aethera_music_library` como `GeneratedMusicTrack`; o caminho de render usa a mesma faixa `music`, ducking por palavra, loudnorm e os 31 SFX locais, sem escrever no Rights Manager.
- [x] Ação IPC/Editor `aetheraMusicGenerate`: escolhe cenas já presentes, deriva prompt instrumental de gênero/emoção/intensidade, chama somente localhost, salva a faixa no `aethera_music_library`, insere/atualiza um clipe `musicTrackId` na `TimelineDocument` e exibe reuso do cache; nenhum Rights Manager é escrito.
- [ ] Pendências ACE-Step: preparar ambiente oficial Python 3.11–3.12 e checkpoints localmente, medir uma geração real de 30–60 s na RTX 4060 Ti e homologar o render audiovisual com Quality Director. A evidência de output continua condicional: uso atual é exclusivamente não comercial; não marcar `legalClearance` como aprovado.

## Aethera Produtora — AP-06 Presets e DirectorRules (2026-11-11) — IMPLEMENTAÇÃO DE CONTRATOS CONCLUÍDA, sem commit
- [x] `AetheraProductionPreset` como gramática fechada, com oito presets versionados: TOP 10 dinâmico, documentário, notícias verificáveis, games/análises, tecnologia futurista, storytelling, Shorts e anime energy.
- [x] `applyDirectorRules` determinístico: planos de cena, beats, transições, câmera e som com `intent.reason`/`directorRuleId` e orçamentos explícitos; testes repetem a entrada e comparam JSON.
- [x] Persistência aditiva `aethera_presets`/`aethera_director_plans` nas migrações 0117–0118, com histórico de planos por run; testes de banco aprovados.
- [x] `assembleTimeline` aceita o DirectorPlan persistido e propaga `intent.reason`/`directorRuleId` para clipes, transições e efeitos; `basedOn` registra preset e versão do plano. Preview/render compilam esses mesmos metadados.
- [ ] Pendências: snapshots visuais dos oito presets no bundle Remotion e homologação audiovisual da direção em janela Electron.

## Aethera Produtora — AP-07 Workspace único (2026-11-11) — IMPLEMENTAÇÃO INICIAL, sem commit

- [x] Rota `/aethera/productions/:id` adicionada sem remover `/video`; o id aponta para uma produção persistida e o carregamento usa o IPC existente `productionRunState`.
- [x] Shell escopado em `[data-module="aethera"]`, com verde-petróleo/esmeralda, sinal turquesa, estados com texto/ícone, foco visível, `prefers-reduced-motion` herdado e layout em três larguras.
- [x] Modo Automático exibe monitor, progresso real, formato/FPS, orçamento, aprovações e etapas persistidas; pausa/retomada/cancelamento continuam usando o serviço real.
- [x] Estados vazio, carregando, erro e sucesso cobertos no componente; o monitor nunca usa tela preta pura nem inventa progresso.
- [x] Contrato puro `aethera-workspace.ts` e 4 testes focados; `shared` e `desktop` typecheck aprovados.
- [ ] E2E visual e validação em janela Electron ainda pendentes; a rota não foi marcada como substituta da compatibilidade `/video`.

## Aethera Produtora — AP-08 Editor de timeline (2026-11-11) — IMPLEMENTAÇÃO INICIAL, sem commit

- [x] Modo Editor no mesmo workspace, com player Remotion `aethera-timeline`, timeline multicamadas, inspetor contextual e biblioteca das cenas/fontes já presentes.
- [x] Player recebe as props compiladas pela mesma composição registrada no bundle; câmera, transição, texto na tela e bloqueio do clipe são editáveis por operações versionadas (`setCamera`, `setTransition`, `setText`, `setClipLock`) na mesma `TimelineDocument` persistida; o storyboard legado continua apenas como compatibilidade de leitura.
- [x] Nenhuma mídia nova é adquirida: a biblioteca identifica fonte existente ou fallback/gráfico; direitos e Rights Manager permanecem intocados.
- [x] Fundo do player e fallbacks usam composição petróleo/esmeralda, sem tela preta deliberada.
- [x] `aethera-workspace.test.ts` e contratos de composição/timeline passaram; typecheck do desktop passou.
- [x] O Editor cria/lê o `TimelineDocument` persistido pelo IPC e o Player usa a versão carregada quando ela existe; a montagem inicial ainda deriva do storyboard somente na primeira abertura.
- [x] O Editor expõe a geração instrumental local ACE-Step por cena/produção, com gênero, emoção e intensidade; o resultado entra na biblioteca de áudio para o próximo render com ducking e SFX.
- [x] A montagem inicial tenta anexar proxies persistidos ou gerar proxy 540p dos arquivos locais já usados; falha de arquivo/FFmpeg deixa o estado explícito e usa apenas o gradiente petróleo/esmeralda, nunca tela preta.
- [ ] Falta comprovar AV real de 1 minuto com medição de latência e quadros; a homologação visual ainda não foi executada em janela Electron.

## Aethera Produtora — AP-09 Assistente na timeline (2026-11-11) — CONTRATO + PRÉVIA LOCAL, sem commit

- [x] `planAetheraTimelineCommand` transforma o comando de exemplo em `replaceSource`, `insertGraphic` e `setGain` somente para alvos determinísticos; sem alvo seguro retorna `needs_review`/`unsupported`.
- [x] Diff versionado por clipe, aplicação protegida por status `ready` e ação de desfazer no rascunho do Editor.
- [x] O painel de Assistente mostra o comando, o resumo e os clipes afetados antes de aplicar; música só é reduzida se houver faixa já persistida.
- [x] Testes AP-09 2/2 passaram; nenhum Rights Manager ou licença foi alterado.
- [x] Plano pronto aplicado pelo painel é enviado ao IPC com `baseVersion` e persiste em `aethera_timelines`/`TimelineChange`; conflito de versão é rejeitado e exige recarregar.
- [x] Desfazer do painel agora restaura um snapshot anterior como nova versão `source=restore`, com conflito por `baseVersion` e histórico preservado; teste de reabertura/ordem `3,2,1` aprovado.

## Aethera Produtora — AP-10 Revisão automática (2026-11-11) — CONTRATO INICIAL, sem commit

- [x] `reviewAetheraTimeline` detecta cobertura visual ausente, sobreposição estrutural, proxy não registrado e `legalClearance` não aprovado; direitos permanecem aviso/revisão humana, sem correção automática.
- [x] `runAetheraReviewCycles` aplica somente correções de baixo risco como `insertGraphic`/`move`, registra `TimelineChange.author = review` e limita a no máximo dois ciclos.
- [x] O Quality Director audiovisual continua separado e usa FFmpeg completo para preto, congelamento, silêncio, loudness, clipping e legendas; nenhum sinal sem medição vira aprovação.
- [x] Testes AP-10 2/2 passaram; nenhum gate G3/G4 foi aprovado automaticamente.
- [x] Relatórios AP-10 agora são persistidos na migração 0119 (`aethera_review_reports`) com `timelineVersion` + hash; correções de baixo risco são salvas como versões `source=review` e o Editor executa a revisão sobre a mesma composição usada pelo Player.
- [x] IPC aditivo de execução, último relatório e histórico; o painel de Revisão mostra achados, ciclos aplicados e mantém direitos como revisão humana.
- [ ] Ainda falta homologar a taxa de falsos positivos com vídeo real e medir a camada audiovisual do Quality Director em uma janela Electron; sem mídia local disponível nesta máquina, nenhuma evidência real foi inventada.

## Aethera Produtora — AP-10b Integração planejada da Fase 52 (2026-11-11) — ANÁLISE, sem merge

- [x] A branch `feat/neura-assistant` foi inspecionada em modo somente leitura; não houve diff de árvore adicional contra a base comum durante esta validação.
- [x] Nenhum merge, cherry-pick, commit ou push foi executado; o Aethera mantém o roteamento atual e o VisionRouter continua independente.
- [ ] Ensaio em worktree descartável com a integração efetiva, conflitos de contratos/migrações e suíte serial ainda depende de uma mudança real disponível na Fase 52; fica antes do AP-11 conforme D-AP-5.

## Aethera Produtora — AP-11 ProductionPlanner (2026-11-11) — CONTRATO INICIAL, sem commit

- [x] `planAetheraProductionCommand` transforma comando natural específico em cadeia Research → Script → Storyboard → Narração → Sync → Composição → Quality → Prévia, com dependências explícitas e até três perguntas quando faltam dados.
- [x] O plano fixa a decisão vigente: OmniVoice/Aethera com escopo `noncommercial` e mídia `reuse-downloaded-only`; aprovações de fontes, prévia editorial e exportação continuam explícitas.
- [x] Testes AP-11 2/2 passaram.
- [x] O contrato está exposto por IPC e o workspace Aethera mostra o plano, perguntas, etapas e aprovações antes de qualquer execução; nenhuma fonte nova é adquirida.
- [x] Aplicação adicionada ao IPC/workspace: valida tema, voz Aethera autorizada em escopo `noncommercial` e executa a cadeia persistida no `ProductionRunService`, sem exportar e sem alterar o Rights Manager.
- [x] Dependências entre etapas ficam no checkpoint do banco; a retomada após reinício lança somente etapas pendentes elegíveis. Composição usa o render existente, `quality` materializa o relatório real do Quality Director e `preview` cria um ponteiro não publicável.
- [x] Testes AP-11 ampliados: dependências/avanço automático do `ProductionRunService`, IPC de aplicação, typecheck shared/orchestrator/desktop e suíte serial final `330` arquivos / `2.451` testes passaram; build desktop e bundle Motion também passaram.
- [ ] Homologação com um run real ainda depende de voz autorizada no projeto, storyboard/narração/mídia já disponíveis e validação audiovisual humana; nenhuma etapa de exportação/publicação é agendada pelo plano.

## Aethera Produtora — AP-12a/AP-12b Demonstração final (2026-11-12) — PREPARAÇÃO TÉCNICA CONCLUÍDA, HOMOLOGAÇÃO REAL PENDENTE

- [x] A cadeia técnica AP-02…AP-11 está implementada no worktree: plano persistido, execução dependente, storyboard/timeline versionados, Editor/Player, ACE-Step local condicional, mix com ducking e 31 SFX, revisão com histórico e prévia não publicável.
- [x] Regressão após a integração ACE-Step/revisão: `330` arquivos / `2.451` testes em modo serial; typechecks shared/database/orchestrator/desktop, bundle Motion e build desktop verdes; nenhum commit ou push foi executado.
- [x] A política vigente foi preservada: OmniVoice/Aethera somente não comercial; apenas mídia já baixada/registrada; telas pretas deliberadas não são fallback; Rights Manager e `legalClearance` não foram alterados.
- [ ] AP-12a não pode ser declarado concluído: `C:/dev/aethera-reference-media` contém apenas `manifest.json` e `README.md`, sem mídia/narração aprovadas para um TOP 5 real; faltam medir geração ACE-Step real, render 1080p, relatório audiovisual e aprovação humana.
- [ ] AP-12b depende do AP-12a e permanece bloqueado pela mesma ausência de fontes/voz/mix reais; não há base para afirmar duração, latência, disco, VRAM ou reaproveitamento em 15 minutos.
- [ ] Próxima ação humana: disponibilizar no projeto as mídias já baixadas e a narração não comercial autorizada, confirmar os ativos permitidos para a prévia e assistir/aprovar o TOP 5. A publicação continua fora do escopo desta execução.

## Aethera — Quality Director com FFmpeg completo (2026-11-12)

- [x] `selectQualityFfmpeg` (`workspace/src/aethera-quality-ffmpeg.ts`) escolhe o primeiro FFmpeg com `ebur128`, `astats`, `silencedetect`, `blackdetect`, `freezedetect` e `subtitles` (env `NB_QUALITY_FFMPEG`/`NB_FFMPEG`, PATH, `C:\ffmpeg\bin`, embutido); o render continua no FFmpeg embutido do Remotion. Sem binário capaz, o QD segue dizendo "medição indisponível", nunca aprova. Testes 3/3 (aceita o completo, recusa o embutido).
- [x] Rechecagem real do render `youtube-long-v017.mp4`: −19,1 LUFS, pico −2,0 dBTP, 0 amostras clipadas, sem silêncio ≥ 3 s; o QD agora detecta **2 intervalos pretos** (cenas de texto sobre fundo sólido).
- [ ] Legendas gravadas no vídeo exigem nova montagem (o render reaproveitou a etapa concluída); pendente para o próximo render.


## Aethera NLE & Qualidade Verificável (2026-11-13) — CONCLUÍDA E VALIDADA

- [x] **Editor NLE Funcional (`AetheraStudioEditor.tsx`)**: preview em `<canvas>` sincronizado com playhead + `<video controls>` via protocolo `aethera-media://`; régua temporal com scrubbing, zoom (`px/s`), snap magnético (`0.25s` + bordas de clipe), seleção/drag horizontal/trim/speed/ripple delete, thumbnails e waveforms reais, undo/redo (`Ctrl+Z`/`Ctrl+Y`) e persistência em disco via `cinema:update-timeline` e `cinema:load-project`.
- [x] **Renderização Real Refletindo a Timeline (`packages/cinema/src/render/real-renderer.ts`)**: `renderRealCinemaMp4` consome os clipes editados (`pkg.timeline.clips`), suas durações/velocidades e mídias locais importadas (`sourceMedia`), aplicando transições `xfade`, tipografia safe-zone, Rec.709, `vignette`, narração SAPI PT-BR, ducking e `loudnorm`.
- [x] **Produção Cinematográfica Visual (`CinemaDirectorPanel.tsx`)**: sincronia automática de duração do briefing (`12 minutos` → `720s`), cards visuais de storyboard com duração/câmera/áudio e aprovação explícita antes de abrir no Editor.
- [x] **Qualidade Verificável (`AetheraReviewRoomPage.tsx`, `real-media-probe.ts`)**: distinção clara entre estimativa de planejamento e auditoria real `ffprobe`/`ebur128`/`blackdetect` no MP4 final (`docs/aethera/cinema/REAL-AUDIOVISUAL-AUDIT.md`).
- [x] **Biblioteca & Agentes (`AetheraMediaLibraryPage.tsx`, `AetheraAgentsPage.tsx`)**: importação via diálogo e drag-and-drop (`cinema:import-media`) com thumbnail/waveform reais e distinção entre motores prontos e agentes em execução.
- [x] **Validação**: `npm run typecheck`, `eslint`, `npm run build:aethera`, Vitest (`10 passed`), Playwright Electron E2E com mídia real e capturas em `docs/aethera/screenshots/01..07.png` (`4 passed` em 34.8s).
- [x] **Limitações registradas**: renderizador demonstrativo ainda sintetiza fundo procedural quando o usuário não importa vídeo/imagem local; Whisper e modelos locais de visão permanecem opcionais/externos.

## CINEMA — Produção Audiovisual Real e Avaliação Cinematográfica (2026-11-13) — CONCLUÍDA E AUDITADA

- [x] **Produção Real de Gameplay (60,6s, 10 cenas)**: montagem completa usando clipes reais limpos de *Elden Ring* e *Hollow Knight: Silksong* (descartando segmentos com legendas pré-queimadas), procedência registrada em `docs/aethera/cinema/REAL-GAMEPLAY-SHOWCASE-AUDIT.md`, narração real via **VoiceStudio v0.5.7** (`omnivoice` + perfil `Phelipe PT-BR` `a6422ef2` na RTX 4060 Ti), cama musical com `sidechaincompress` ducking, SFX sincronizados, `slow_push` / `climax_zoom`, correção Rec.709, letterbox e tipografia em *safe-zone*. `real-renderer.ts` atualizado para priorizar o VoiceStudio com fallback offline para SAPI.
- [x] **Humor Pontual (35%) & Comparativo Antes vs Depois**: `showcase-v1-before.mp4` (sem ducking, SFX cômico atenuado e defeito injetado na Cena 4) vs `showcase-v2-final.mp4` (correção cirúrgica com pausa cômica de 2,5s na Cena 4, tarja editorial e mixagem `-14.3 LUFS / -1.0 dBTP`).
- [x] **Sonda Real Ampliada (`packages/cinema/src/qc/real-media-probe.ts`)**: adicionadas medições objetivas `sceneCutsCount` (`scdet=threshold=12`, 18 cortes detectados) e `silenceEventsCount` (`silencedetect`, 0 silêncios prolongados), além de `ebur128`, `blackdetect` e `freezedetect`.
- [x] **Validação Completa**: `npm run typecheck`, `eslint`, `npm run build:aethera`, Vitest (`10 passed`), Playwright Electron E2E (`4 passed` em 37,2s, incluindo importação de `showcase-v2-final.mp4` com `>= 60s` no Editor) e inspeção visual direta de frames (`frames_v1` vs `frames_v2`).
- [x] **Limitações registradas honestamente**: voz sintética Windows SAPI (`Microsoft Maria Desktop`), cama musical e SFX procedurais (sem stems orquestrais licenciados), e 4 micro-segmentos escuros (`0.1s–0.43s`) no `blackdetect` herdados dos cortes internos dos trailers originais.

## CINEMA-AUDIO-01 & Novo Tema NASA (`2026-11-14`) — CONCLUÍDA E AUDITADA

- [x] **Diretor de Som com Gate Bloqueador (`packages/cinema/src/audio/sound-director.ts`)**: timeline explícita `A1`–`A5`, medição real via `ffprobe` (`measureAudioDurationMs`), bloqueio automático (`SoundDirectorBlockedError`) em sobreposições (`narration_overlap`), truncamentos (`narration_truncated`) e colisão com diálogo de gameplay (`narration_vs_gameplay_dialogue`), com 5 testes em `sound-director.test.ts`.
- [x] **Correção do Showcase (`CINEMA-AUDIO-01-AUDIT.md`)**: eliminadas as 3 sobreposições (`0,30s`, `3,19s` e `0,64s`) e o truncamento de `2,56s` no outro; `showcase-v2-final.mp4` aprovado sem conflitos e com stems separados em `stems_v2/`.
- [x] **Produção Completa em Novo Tema (`SPACE-DOC-AUDIT.md`)**: pesquisa e download direto na API da NASA (`images-api.nasa.gov`, 5 imagens + 2 clipes de vídeo em domínio público), planejamento `produceCinemaPackage`, narração PT-BR no VoiceStudio, aprovação pelo Diretor de Som e renderização `aethera-space-doc.mp4` (`51,25s`, `-14.6 LUFS`, `-1.4 dBTP`).

## AETHERA EVOLUTION & AETHERA ACADEMY (`2026-11-14`) — CONCLUÍDA E VALIDADA

- [x] **Núcleo Evolutivo Unificado (`packages/cinema/src/evolution/evolution-core.ts`)**: 5 tipos de memória (`episodic`, `semantic`, `procedural`, `collective`, `contextual`), níveis epistêmicos (`extracted_knowledge`, `hypothesis`, `validated_rule`), ciclo de estados (`proposed` → `evaluating` → `validated` / `rejected` / `disabled`), versionamento, rollback, exclusão, busca híbrida, classificação de feedback humano (`technical_defect`, `creative_direction`, `explicit_preference`, `subjective_evaluation`), sanitização anti-prompt-injection e persistência atômica em JSON isolado do Singularity e do Void.
- [x] **15 Diretores Especializados & Orquestração DAG (`director-registry.ts`, `director-orchestrator.ts`)**: todos os 15 diretores implementados (`general_director`, `narrative_director`, `screenwriter`, `research_director`, `storyboard_director`, `cinematographer`, `art_director`, `casting_director`, `editing_director`, `sound_director`, `vfx_director`, `colorist`, `comedy_director`, `retention_director`, `quality_supervisor`), execução em ondas paralelas com checkpoints e resolução colaborativa de conflitos de duração/narração.
- [x] **Aethera Academia (`academy-engine.ts`)**: ingestão multimodal com sondagem `ffprobe`, modos `study` / `reference` / `train`, roteamento por especialidade, exercícios práticos conectados à memória evolutiva, Q&A fundamentado com citações (`askAcademy`) e limpeza coordenada na exclusão de materiais.
- [x] **IPC, Preload & UI (`aethera-ipc.ts`, `preload/index.ts`, `AetheraAgentsPage.tsx`, `AetheraAcademyPanel.tsx`)**: exposição completa de `cinema:evolution-*` e `cinema:academy-*` sob `userData/evolution/` e interface para os 15 diretores, DAG, feedback humano, rollback/desativação e Academia.
- [x] **Validação**: `npm run typecheck`, `eslint`, `npm run build:aethera`, Vitest (`4 arquivos / 18 testes`, incluindo `evolution-academy.test.ts` com ciclo Antes/Depois sobre `showcase-v2-final.mp4`, persistência entre reinícios e sanitização) e Playwright Electron E2E (`tests/e2e/aethera-evolution.spec.ts`, `1 passed`).


---

### Auditoria de Integração & Validação Real — Evolution 2.0 (2026-11-14)

- [x] **Pipeline Principal (`apps/aethera-desktop/src/main/cinema-pipeline.ts` & `aethera-ipc.ts`)**: Conectados `matchNarrationSegmentsToMedia` (Etapa B), `resolveLearnedSceneConstraints` (Etapa C Academy), `segmentCacheDir` persistente por projeto (Etapa A2), `detectMediaAnomalies` em `cinema:probe-real-mp4` (Etapa A1) e `evaluateRenderedVisualCritic` + `runAutonomousSupervisorPass` com re-render incremental na etapa `previa` (Etapa C).
- [x] **Cache Incremental & Recuperação (`packages/cinema/src/render/real-renderer.ts`)**: `sceneKey` expandido para incluir `sourceStat` (`mtimeMs`, `size`), `speed`, `trimIn/Out`, `fontOption`, `effects`, `beatSummary`, `beatStage`, `previewQuality`, `useNvenc`, `fps`; escrita atômica (`.tmp` -> `renameSync`), validação `size > 1024` e limpeza automática de `.tmp` órfãos após interrupção.
- [x] **QC sem Falsos Positivos (`packages/cinema/src/qc/real-media-probe.ts`)**: `runRealMediaQc` e `evaluateRenderedVisualCritic` ignoram fades de borda (`black` na abertura/encerramento) e silêncio dramático curto (`<= 2.2s`), além de suportarem `intentionalRanges`.
- [x] **Guarda Anti-Loop do Supervisor (`packages/cinema/src/qc/visual-critic.ts`)**: `runAutonomousSupervisorPass` limita tentativas (`maxAttempts: 2`) e bloqueia assinaturas repetidas (`previousActionSignatures`), retornando `escalate_to_user`.
- [x] **Validação Executada**:
  - Vitest (`evolution-2.0.test.ts`, `nle-editor-integration.test.ts`, `waveform-extractor.test.ts`, `trend-radar.test.ts`): **4 arquivos / 21 testes passando**, incluindo render real FFmpeg de 3 cenas alterando apenas a cena 2 (`cacheHits: 2`, `reRenderedScenes: 1`) e limpeza de `.tmp` órfão.
  - TypeScript (`npm run typecheck -w @neuralbridge/aethera-desktop`): **0 erros**.
  - Build (`npm run build:aethera`): **Concluído com sucesso**.
- [ ] **Lacuna Conhecida**: `StagedPipelineDeps.analyzeFrameWithAI` está integrado como hook opcional; enquanto nenhum provedor multimodal de visão for plugado no `aethera-ipc.ts`, o Visual Critic executa em modo degradado determinístico. Aprovação visual final dos vídeos permanece manual.

### AI Visual Critic com Visão Real & Reparos Direcionados — 2026-11-14

- [x] **Visão real conectada (`apps/aethera-desktop/src/main/aethera-ipc.ts`)**: `StagedCinemaPipeline` conectado ao `VisionRouter` + `createVisionProviders` + `createTaskEngineVisionProvider` (`claude` / `codex` / fallback `ffmpeg-heuristics`), sem criar provedores duplicados.
- [x] **Avaliação audiovisual completa (`packages/cinema/src/qc/visual-critic.ts`)**: Cobertura de composição/enquadramento, HUD, legendas/tipografia, repetição visual, correspondência narração-imagem, SFX (`adjust_sfx`) e VFX (`adjust_vfx`), emitindo achados com timestamp, cena, severidade, evidência e reparo sugerido.
- [x] **Reparos seguros e anti-loop (`apps/aethera-desktop/src/main/cinema-pipeline.ts`)**: Reparos aplicados apenas nas cenas reprovadas, preservando cenas aprovadas via `segmentCacheDir`, com limite `maxAttempts: 2` e escalonamento `escalate_to_user`.
- [x] **Validação Executada**:
  - Vitest (`visual-critic-vision.test.ts`, `evolution-2.0.test.ts`, `nle-editor-integration.test.ts`, `waveform-extractor.test.ts`, `trend-radar.test.ts`): **5 arquivos / 23 testes passando**, incluindo geração de PNGs reais, vídeo multi-cena FFmpeg e re-render incremental com `cacheHits: 2` e `reRenderedScenes: 1`.
  - TypeScript (`npm run typecheck -w @neuralbridge/aethera-desktop`): **0 erros**.
  - Build (`npm run build:aethera`): **Concluído com sucesso**.
- [x] **Aprovação visual final**: Permanece manual pelo usuário.

### Validação End-to-End de Produção Autônoma (~5 min: TOP 5 Jogos de 2027) — 2026-11-14

- [x] **Produção E2E real executada (`scripts/e2e-production-top5-2027.mts`)**:
  - **MP4 final**: `C:\Users\Pheli\AppData\Roaming\AetheraStudio\cinema-workspaces\cinema_top5_2027_e2e\renders\cinema_top5_2027_e2e.mp4` (`298s`, `81.95 MB`, `1280x720`, `30fps`, `h264`, `aac 48kHz`).
  - **Relatório de Qualidade**: `C:\Users\Pheli\AppData\Roaming\AetheraStudio\cinema-projects\cinema_top5_2027_e2e\e2e_quality_report.json`.
  - **Provedores reais utilizados**: Voice Studio (`voicestudio_tts`), `yt-dlp` (4 trailers reais), `ffmpeg`/`ffprobe`, e `claude-cli` (visão real nos 6 frames PNG extraídos).
  - **Cache incremental & reparos**: `totalScenes: 6`, `cacheHits: 3`, `reRenderedScenes: 3` após reparo direcionado do Supervisor.
- [ ] **Pendências para intervenção/aprovação manual na Sala de Revisão**:
  1. `clip_3` possui dois trechos pretos do trailer original (`124.43s–125.1s` e `126.47s–127.23s`).
  2. `clip_4` (Fable) ficou com trailer de *Tomb Raider* por haver 4 arquivos adquiridos para 5 jogos distintos.
  3. `integratedLufs` medido em `-19.5 LUFS` (abaixo do alvo `-14.0 LUFS`).

### Hardening de Qualidade Editorial & Audiovisual (Antes vs. Depois) — 2026-11-14

- [x] **Normalização EBU R128 2-pass (`packages/cinema/src/render/real-renderer.ts`)**: Loudness corrigido de `-19.5 LUFS` para **`-14.0 LUFS`** (`truePeakDbtp: -3.6 dBTP`, dentro de `<= -1.0 dBTP`), eliminando `real_qc_loudness_drift`.
- [x] **Corte `-ss` e avanço de trechos pretos (`real-renderer.ts` + `cinema-pipeline.ts`)**: `real-renderer.ts` agora aplica `-ss` a partir de `sourceRange.start`, e o Supervisor avança `+4s` quando `blackdetect` aciona `rerender_scene` mantendo `timelineRange`, narração, SFX, VFX e música sincronizados.
- [x] **Amostragem adaptativa & bloqueio editorial (`packages/cinema/src/qc/visual-critic.ts`)**: Amostragem ampliada de `6` para **`18` frames** por vídeo de 5 min; `retry_media_research` (mídia de outro jogo) sempre emite `severity: 'critical'`.
- [x] **Recuperação automática de mídia (`cinema-pipeline.ts` + `e2e-production-top5-2027.mts`)**: Trailers salvos com slug verificável do jogo e `retryResearchSceneIds` aciona busca/download de trailer específico (`acquiredMediaCount` subiu de `4` para `7`).
- [x] **Validação executada**:
  - **Vitest** (`visual-critic-vision.test.ts`, `evolution-2.0.test.ts`, `nle-editor-integration.test.ts`, `waveform-extractor.test.ts`, `trend-radar.test.ts`): **5 arquivos / 23 testes passando**.
  - **TypeScript (`typecheck`)**: **0 erros**.
  - **E2E Real v2**: MP4 `298s` (`80.09 MB`), `-14.0 LUFS`, `-3.6 dBTP`, `18` frames amostrados, `cacheHits: 2 / reRenderedScenes: 4`. Fades escuros internos dos trailers originais continuam reportados honestamente no QC para avaliação manual na Sala de Revisão.

## ElevenLabs TTS — correções de integração (2026-11-15)

- [x] **API Key na interface**: `TtsProviderSelector` ganhou formulário (campo senha, "Salvar e testar", "Trocar chave", "Remover") usando o IPC existente; a chave é verificada via `tts:health-check` e nunca volta para o renderer.
- [x] **Render usa a chave salva**: `StagedCinemaPipeline` recebe `resolveTtsCredentials` e resolve a chave do `StudioSecretStore` só no momento do render; nada é persistido no job. `ELEVENLABS_API_KEY` ficou apenas como fallback.
- [x] **Formato de áudio real**: helper único `synthesizeElevenLabsWav` (`packages/cinema/src/render/elevenlabs-tts.ts`) pede `output_format=pcm_24000` (todos os planos) e grava WAV RIFF válido; antes o arquivo `.wav` continha MP3.
- [x] **Cache de narração por provedor**: segmentos ElevenLabs usam chave de cache própria (`elevenlabs:<voz>:<modelo>`) e um fallback para VoiceStudio/SAPI nunca é gravado sob essa chave; a falha agora é registrada em log em vez de engolida.
- [x] **Validação**: `tts-providers.test.ts` `18/18`; typecheck web limpo e node limpo exceto o erro pré-existente em `creative-studio-service.ts:460`; `build:aethera` aprovado; lint sem erros novos.
- [ ] **Pendências**: síntese real contra a API ElevenLabs não testada (exige chave do usuário). Testes de render real do `packages/cinema` falham também no código original (`project-isolation-and-preview`, `editorial-integrity`); "Audit Item 3 & 8" leva 28–32 s contra limite de 30 s nos dois códigos.

### Telas ligadas à interface real (2026-11-15)

- [x] **Causa**: `apps/aethera-desktop/src/renderer/src/App.tsx` não é importado por nada; o app usa as rotas de `main.tsx`. Production Console, seletor ElevenLabs e Creative Studio estavam montados só nesse arquivo morto.
- [x] `TtsProviderSelector` e `ProductionConsoleAccordion` movidos para `packages/desktop-shared/src/renderer/src/features/aethera/`.
- [x] "Produção com IA" (`CinemaDirectorPanel`): seletor "Motor de voz" (VoiceStudio/ElevenLabs), formulário de API Key e vozes ElevenLabs; a produção envia `ttsProviderId`/`ttsVoiceId`; cada card de projeto exibe o Production Console.
- [x] Nova rota `/aethera/creative` e item de menu "Thumbs & Artes" para o Creative Studio.
- [x] **Validação**: typecheck web limpo; `build:aethera` aprovado; E2E Electron temporário confirmou menu, formulário de chave e Creative Studio com capturas. Falhas restantes em `apps/aethera-desktop/test` são pré-existentes (`sharp-native-smoke` exige instalador empacotado; `staged-pipeline` falha igual no código original).
- [ ] Production Console no card não foi verificado visualmente: exige um job de produção existente.

## P0/P0.5 — pendências preservadas antes do P1 Audio-First (2026-11-17)

- [ ] Dois casos `technical_blocked` do Media Pipeline ainda não foram recuperados; permanecem distintos de rejeição editorial.
- [ ] Os arquivos MP4 físicos não estavam presentes no workspace investigado; não foi feito novo download automático para reproduzir o teste anterior. A retomada deve procurar primeiro cache e artefatos locais.
- [ ] Falta validar a retomada completa em um novo teste E2E, reutilizando os arquivos existentes quando encontrados.

P1 — Audio-First Timeline foi autorizado para implementação. P2 permanece bloqueado até o aceite explícito de P1.

## P1 — Audio-First Timeline (implementação concluída para aceite — 2026-11-17)

- [x] Narração preparada e medida via `ffprobe` antes da codificação das cenas; duração final = `max(duração planejada, duração medida)`.
- [x] Pausas preservadas por segmento; cena ajustada pela duração medida do segmento atribuído; `atrim`, `Math.min` de truncamento e `-shortest` removidos do caminho final.
- [x] Diagnóstico persistido: duração planejada, medida, final, tolerância, ajustes por cena, stream de áudio final, provedor efetivo por segmento, cache hit/key e modo de narração.
- [x] Cache de narração isolado por endpoint/modelo/voz; correções visuais reutilizam os WAVs e não fazem nova chamada TTS quando o sidecar é verificável.
- [x] Testes focados: 7 arquivos / 23 testes passando; inclui áudio longo/curto, dois segmentos, atribuição por cena, stream final e cache.
- [x] Evidência real: MP4 `C:\dev\neuralbridge-studio\artifacts\aethera-p1-audio-first\20261117165701\render\cyberpunk-audio-first.mp4`, arquivo Cyberpunk local reutilizado sem download, H.264/AAC 48 kHz, `deliveryValidation.valid=true`, stream de áudio `19,285 ms`.
- [ ] Aceite do usuário ainda pendente; P2 não iniciado.
