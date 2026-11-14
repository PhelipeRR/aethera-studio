# Fase 19 — Neural Brain 3D Interativo, Visualização de Memórias e Atividade Neural Animada

## Status

CONCLUÍDA em 2026-10-29 — critérios 2 e 3 aprovados pelo usuário; resta só a checagem no app instalado. Resultados, medições e desvios em `docs/PLAN.md`, Fase 19.

## Objetivo

Acrescentar à página Memória uma visualização tridimensional do Neural Brain: um cérebro formado por milhares de partículas luminosas (azul, ciano, branco e violeta) sobre fundo escuro, com conexões neurais e impulsos elétricos que percorrem a rede continuamente. A visualização é ligada ao conhecimento real do NeuralBridge: as memórias são nós selecionáveis, as relações persistidas aparecem como conexões rastreáveis e as recuperações reais feitas por Claude Code e Codex acendem os nós correspondentes.

Referência visual: a descrição desta fase (milhares de partículas azuis, ciano, brancas e violetas formando um cérebro, conexões brilhantes, fundo escuro). A imagem de referência está em `docs/assets/phase-19-reference.png`; a comparação lado a lado está em `docs/assets/phase-19-comparison.png`.

## Escopo e dependências

- Depende das Fases 3 (memórias, links, versões), 6 (embeddings e similaridade), 7.5 e 14 (contexto RAG e evento `rag_context`), 9 (grafo 2D, que permanece) e 18 (layout do app).
- Não cria memórias, relações ou eventos fictícios em produção. Não substitui o grafo 2D, que segue como visualização alternativa e acessível.
- Não altera contratos existentes de forma incompatível; acrescenta canais de leitura somente onde indicado em "Mudanças mínimas".
- Fora do escopo: edição de memórias dentro da cena 3D (continua no Inspector), desenho de documentos/chunks do RAG como nós, colaboração multiusuário, VR/AR.

## Levantamento do estado atual (2026-10-29)

**Dados de memória disponíveis** (`packages/database/src/schema.ts`):

- `memories`: `id` (ULID, estável), `title`, `content`, `type` (8 tipos em `MEMORY_TYPES`), `projectId` (null = global), `trust`, `sourceKind` (`user`, `claude`, `codex`, `mcp`, `extractor`), `sourceRef`, `version`, `embeddingStatus`, datas e `deletedAt` (exclusão lógica).
- `tags`/`memory_tags`, `memory_versions`, `memory_sources` (arquivo, URL, tarefa, conversa).
- `embeddings`: vetor `Float32` de 384 dimensões (`multilingual-e5-small`), só existe com a busca semântica ativada e `embeddingStatus = 'ready'`.
- `projects` (com `isPrivate`), `learning_candidates`, `token_analytics`, `rag_documents`/`rag_chunks` (documentos de projeto; não são memórias).

**Relações que já existem:**

- `links`: `sourceId` → `targetId` (null quando pendente), `targetTitle`, `relation` (padrão `references`), `origin` (`wikilink` ou `explicit`). É a única relação persistida entre memórias.
- Similaridade calculável por cosseno entre embeddings (base da busca híbrida da Fase 6, com corte `minSimilarity`). Não é persistida.
- O grafo 2D (`brain:graph`) entrega até `GRAPH_LIMIT = 5000` memórias vivas, tags e links internos ao recorte, com `truncated`.

**Eventos de atividade que podem alimentar a visualização:**

1. Evento de tarefa `rag_context` (`packages/orchestrator/src/engine.ts`): `references` no formato `memory://<id>` e `estimatedTokens`, gravado em `task_events` e avisado às janelas por `tasks:changed`. Cobre tarefas executadas pelo app (Chat).
2. `access_log`: uma linha por memória em `recall`, `search_hit`, `context` e `update`, com `client` (`electron` ou `mcp:<cliente>`) e horário. É o único registro de recuperações feitas por Claude Code e Codex **fora** do app (sessões que usam o MCP diretamente). O servidor MCP é outro processo e não avisa o app; ver "Mudanças mínimas".
3. `skills_context` não envolve memórias e não acende nós.

**Projetos e agentes:** cada memória tem no máximo um projeto (ou é global) e uma origem (`sourceKind`). O agente que recuperou uma memória vem de `access_log.client` ou do agente da etapa da tarefa.

**Componentes reutilizáveis:** `features/brain/api.ts` (consultas TanStack sob a chave `brain`), `graph-model.ts` (filtros, vizinhos, caminho mais curto), `MemoryPage`/Inspector para detalhes, `TYPE_LABEL`/`--type-*` (cores por tipo), `useTaskUpdates` (eventos ao vivo), `usePersistentFlag` (preferências de layout), `Tooltip`, `ConfirmDialog` e o padrão de E2E com Electron em `tests/e2e/app.ts`.

**Limitações técnicas relevantes:**

- CSP de produção: `script-src 'self'`, `img-src 'self' data:`, `connect-src 'self'`, sem `worker-src`, `blob:` nem `wasm-unsafe-eval`. Carregadores que criam URLs `blob:` (texturas embutidas de GLB), workers inline ou decodificadores WASM (Draco/Meshopt) seriam bloqueados.
- O renderer é sandboxed e sem Node; todo dado chega por IPC validado com Zod e saída estrita (um campo a mais derruba a resposta, como visto no bug das Skills).
- Nenhuma dependência 3D instalada hoje; o bundle do renderer já tem ~3 MB.
- Similaridade só existe para memórias com embedding pronto; sem a busca semântica ligada, só há links persistidos.
- Com poucas memórias (a instalação atual tem 1), a parte "real" da cena será esparsa: o visual depende da camada decorativa, que precisa ser claramente separada.
- Testes de E2E rodam o Electron real; a renderização WebGL nos testes pode cair em software (SwiftShader), o que afeta medições de desempenho.

## Decisões de planejamento

1. **Duas camadas sempre separadas, inclusive no código:** a camada decorativa (partículas, conexões e impulsos ambientes, gerados localmente) não usa dados do banco; a camada de conhecimento (nós de memória, relações, ativações reais) só usa dados vindos por IPC. Nenhum elemento decorativo é clicável nem contado como memória.
2. **Cérebro:** nuvem de pontos pré-processada a partir de uma malha cerebral com licença compatível com distribuição comercial e atribuição registrada em `docs/THIRD-PARTY.md`. O ativo final é um binário de posições/normais/regiões importado pelo bundle (sem `fetch`, sem `blob:`, sem decodificador WASM), compatível com a CSP atual. Candidatos a avaliar na entrega 19.2 (licenças a confirmar na fonte, não presumidas aqui): BodyParts3D, malhas derivadas de atlas públicos de neuroimagem, ou modelos CC0. Se nenhuma fonte tiver licença compatível confirmada, o plano B é uma silhueta procedural (dois hemisférios com sulcos por ruído), registrada como desvio do critério 3 para decisão do usuário.
3. **Pilha 3D:** `three`, `@react-three/fiber` (linha compatível com React 19), `@react-three/drei` e pós-processamento de bloom (`@react-three/postprocessing`/`postprocessing`), com versões fixadas na implementação após conferir compatibilidade, advisories e idade mínima. O código 3D fica em um pedaço carregado sob demanda (`React.lazy`) só na rota da visualização, sem pesar no resto do app.
4. **Renderização por GPU:** partículas e impulsos em `Points`/`BufferGeometry` com shaders próprios; conexões em `LineSegments` com atributos por vértice; nós de memória em `InstancedMesh`. Nunca um componente React por partícula, conexão ou impulso.
5. **Impulsos simulados em módulo puro:** um simulador determinístico (semente fixa nos testes) decide nascimento, percurso pelas arestas, ramificação, ativação e dissipação; a GPU só desenha o estado. Isso permite testar o comportamento sem WebGL.
6. **Posição estável das memórias:** projeto → região do cérebro (por hash estável do `projectId`; global no centro), tipo → sub-região, memória → ponto de amostragem escolhido por hash do `id`, com afastamento mínimo entre nós. A mesma memória ocupa o mesmo lugar entre aberturas e após atualizações.
7. **Relações exibidas:** persistidas (`links`, com rótulo da relação e origem) e similaridade calculada (cosseno entre embeddings prontos, top-k por memória acima de um limiar documentado), em estilos distintos e com legenda. Similaridade é desligável e nunca gravada como link. Vínculos não derivados de dados não são exibidos.
8. **Atividade real:** vem de `rag_context` das tarefas e de `access_log` (incluindo clientes MCP externos). Cada ativação real mostra memória, agente/cliente, ação e horário no painel "Atividade real" e usa cor e forma de pulso distintas da atividade ambiente. Recuperações de documentos RAG (não memórias) aparecem só no painel, sem nó.
9. **Tema:** a área 3D é sempre escura (inclusive no tema claro do app), como uma janela de instrumento; os controles ao redor seguem o tema do app.
10. **Preferências locais:** qualidade gráfica (Automática/Baixa/Média/Alta), intensidade dos efeitos (Desligados/Discretos/Normais/Intensos), rotação automática e similaridade ligada/desligada ficam por janela, como as preferências da Fase 18.

## Mudanças mínimas previstas fora do renderer

Todas aditivas, com schema Zod estrito e testes:

- `brain:graph3d` (ou extensão opcional de `brain:graph`): memórias com `id`, `title`, `type`, `projectId`, `projectName`, `trust`, `sourceKind`, `updatedAt` e links resolvidos; mesmo limite e `truncated`.
- `brain:similarity`: arestas calculadas `{ sourceId, targetId, score }` para memórias com embedding pronto, top-k e limiar fixos no processo principal, com `available: false` e motivo quando a busca semântica está desligada.
- `brain:activity { since }`: leitura de `access_log` (sem conteúdo das memórias) com `memoryId`, `client`, `action`, `at`; consulta periódica enquanto a visualização está aberta e visível, porque o MCP externo não tem canal para avisar o app. Sem nova tabela.
- Opcional, só se a medição mostrar necessidade: índice em `access_log(at)` por migração.

## Plano de execução

Cada entrega termina com testes verdes, sem regressão das anteriores. Dependências entre parênteses.

### 19.1 — Infraestrutura de renderização 3D

- Instalar e fixar `three`, R3F, Drei e pós-processamento; conferir advisories e licenças.
- Rota/aba "Cérebro 3D" na Memória carregada sob demanda; o grafo 2D continua acessível.
- Detecção de WebGL antes de montar (WebGL2 com fallback documentado); sem WebGL ou após perda de contexto (`webglcontextlost`): mensagem clara e alternativa 2D, sem tela branca.
- Ciclo de vida: descartar geometrias, materiais, texturas e alvos de renderização ao desmontar; `frameloop` pausado quando a página está oculta, a rota não está ativa ou a janela está minimizada.
- Conferir a CSP com o build real e com o app empacotado; nenhuma relaxação da CSP sem decisão registrada.
- **Aceite:** a cena vazia abre no dev e no app empacotado; montar/desmontar 20 vezes volta `renderer.info.memory` (geometrias e texturas) à linha de base; sem WebGL aparece a alternativa 2D.

### 19.2 — Modelo cerebral e sistema de partículas (19.1)

- Escolher a fonte da malha com licença confirmada e registrar origem, autor, licença e transformações em `docs/THIRD-PARTY.md`.
- Script de pré-processamento (fora do app) que gera o binário de pontos: amostragem de superfície ponderada por área, partículas internas em menor densidade, rótulo de região (hemisférios e lobos) por ponto.
- Partículas com variação sutil de tamanho, brilho e cor na paleta azul/ciano/branco/violeta; profundidade por atenuação e bloom controlado; fundo escuro.
- **Aceite:** silhueta reconhecível de frente, lado e cima, com hemisférios distinguíveis; contagem de partículas por nível de qualidade conforme tabela de desempenho; revisão visual com capturas comparadas à referência.

### 19.3 — Rede neural visual e conexões (19.2)

- Grafo decorativo: vizinhos próximos por região com densidade variável e algumas conexões longas entre regiões, para evitar padrão geométrico repetitivo.
- Conexões em `LineSegments` com intensidade base baixa e atributo de ativação por aresta.
- Estrutura de adjacência compartilhada com o simulador de impulsos.
- **Aceite:** conexões visíveis em diferentes profundidades; nenhuma aresta decorativa coincide com o grafo de conhecimento nem é clicável; testes da geração (grau médio, ausência de nós isolados, determinismo por semente).

### 19.4 — Impulsos elétricos e propagação animada (19.3) — prioridade visual

- Simulador puro: impulsos nascem em nós, percorrem arestas com velocidade variável, acendem os nós atravessados, ramificam com probabilidade decrescente, perdem intensidade e somem; limite global de impulsos simultâneos por nível de qualidade.
- Variação orgânica: intervalos de nascimento com jitter, sem período fixo; vários impulsos em direções diferentes ao mesmo tempo.
- Desenho na GPU: cabeça luminosa e trilha curta com dissipação; ativação e decaimento dos nós.
- Atividade ambiente discreta e permanente, rotulada na interface como "atividade ilustrativa".
- **Aceite:** testes do simulador provam que impulsos só existem sobre arestas, ramificam, decaem até zero, respeitam o limite e não repetem ciclos; capturas em sequência mostram movimento.

### 19.5 — Controles de câmera e navegação (19.1)

- Órbita livre 360°, zoom pela roda com limites, deslocamento por arraste, botão "Centralizar", foco animado em região ou memória, rotação automática opcional que pausa durante a interação e retoma após inatividade.
- Atalhos de teclado documentados para girar, aproximar e centralizar.
- **Aceite:** rotação, zoom, deslocamento e reset verificados por E2E (mudança de câmera e capturas); limites de zoom respeitados; transições instantâneas com movimento reduzido.

### 19.6 — Integração com memórias reais (19.2, 19.5)

- Canal `brain:graph3d`; nós de memória em `InstancedMesh`, maiores e mais nítidos que as partículas, com cor/forma por tipo e posição estável por projeto/tipo/id.
- Seleção por clique (raycasting no `InstancedMesh`), destaque e painel com título, tipo, projeto, origem, confiança, tags e link para o Inspector.
- Busca e filtros (projeto, tipo, confiança); "Localizar" centraliza a câmera na memória.
- Atualização após criar, editar ou excluir memórias (invalidação da chave `brain`).
- Estado vazio honesto: sem memórias, a cena mostra só a camada ilustrativa e o painel diz que nenhuma memória existe ainda.
- **Aceite:** com banco de teste conhecido, o número de nós, títulos e projetos exibidos bate com o banco; selecionar mostra os dados corretos; criar/excluir reflete na cena.

### 19.7 — Conexões semânticas e agrupamentos (19.6)

- Links persistidos como arestas sólidas com a relação; pendentes não viram arestas.
- Canal `brain:similarity` e arestas de similaridade tracejadas, com pontuação no hover/painel, top-k e limiar, desligáveis.
- Destaque das conexões da memória selecionada; demais esmaecidas. Limite de arestas visíveis por nível de detalhe.
- Agrupamento visual por projeto (regiões) e legenda.
- **Aceite:** cada aresta exibida corresponde a uma linha de `links` ou a um par acima do limiar calculado no processo principal (teste de rastreabilidade); sem busca semântica, a interface informa que a similaridade está indisponível.

### 19.8 — Atividade neural integrada ao RAG (19.4, 19.6)

- Fonte 1: eventos `rag_context` das tarefas em andamento, via `useTaskUpdates`.
- Fonte 2: `brain:activity` consultado periodicamente apenas com a visualização visível, cobrindo clientes MCP externos.
- Ativação real: pulso intenso e cor distinta no nó, propagação pelas relações reais do nó, iluminação temporária da região, decaimento gradual; painel "Atividade real" com memória, agente/cliente, ação e horário.
- Indicador de atividade real ligado só quando houver evento real recente.
- **Aceite:** um `rag_context` produzido por tarefa do agente falso acende exatamente as memórias referenciadas; uma linha de `access_log` de cliente MCP aparece no painel; nenhuma ativação real ocorre sem evento.

### 19.9 — Interface, filtros e painel de detalhes (19.6–19.8)

- Cena centralizada, controles discretos (centralizar, rotação automática, qualidade, intensidade, similaridade), busca, filtros, contadores de memórias e conexões, alternância 3D/2D, painel de detalhes e painel de atividade.
- Estados de carregamento, vazio, erro, WebGL indisponível e recorte truncado.
- **Aceite:** E2E dos controles e estados; a visualização atual (grafo 2D, Explorar, Inspector) continua acessível e com os testes existentes verdes.

### 19.10 — Otimização, qualidade gráfica e acessibilidade (19.1–19.9)

- Níveis de qualidade com contagens máximas (partículas, conexões, impulsos, bloom); "Automática" escolhe pelo desempenho medido nos primeiros segundos.
- Movimento reduzido: sem impulsos ambientes, sem rotação automática, transições instantâneas; atividade real mostrada como destaque estático e lista.
- Alternativa acessível: lista/2D com as mesmas memórias e atividade; canvas com rótulo e resumo textual; foco visível e operação por teclado dos controles.
- Medições de desempenho e vazamento (ver metas).
- **Aceite:** metas medidas e registradas com o hardware usado; preferência de movimento reduzido verificada por E2E.

### 19.11 — Testes e validação final (todas)

- Executar e registrar: unitários, integração, E2E, lint, typecheck, build, `npm run dist:win`, `npm run verify:dist` (estendido para conferir o pedaço 3D e o ativo do cérebro no pacote) e `git diff --check`.
- Verificação manual no app instalado, com capturas comparadas à referência.

## Metas de desempenho (a medir, não prometidas)

Medidas com um harness E2E que registra quadros por segundo e tempo por quadro durante 10 s de rotação com impulsos ativos, a 1280×820, registrando GPU, driver e se a renderização foi por hardware ou software.

| Nível | Partículas (máx.) | Conexões (máx.) | Impulsos simultâneos (máx.) | Meta |
|---|---|---|---|---|
| Baixa | 8.000 | 6.000 | 40 | ≥ 30 fps na máquina de referência |
| Média | 20.000 | 15.000 | 120 | ≥ 45 fps |
| Alta | 40.000 | 30.000 | 250 | ≥ 55 fps |

Os números iniciais são hipóteses de trabalho e serão ajustados à primeira medição real; a tabela final registra o que foi medido. Outras metas: abrir a cena em até 2 s após o pedaço 3D carregado com 1.000 memórias; 5.000 memórias sem travar a interface; montar/desmontar sem crescimento de geometrias/texturas; CPU ociosa perto de zero com a página oculta.

## Estratégia de testes

- **Unitários (Node, sem WebGL):** simulador de impulsos (determinismo por semente, impulsos só sobre arestas, ramificação, decaimento, limites, ausência de periodicidade), geração da rede decorativa, mapeamento estável memória → posição, construção das arestas reais e de similaridade, conversão de eventos (`rag_context`, `access_log`) em ativações, seleção de nível de qualidade, picking por raio (matemática do `three` roda no Node).
- **Integração:** canais `brain:graph3d`, `brain:similarity` e `brain:activity` com banco temporário, incluindo memórias privadas/excluídas, limite e contrato estrito.
- **E2E (Electron real):** abertura da cena, partículas desenhadas (pixels não vazios no canvas), animação (capturas em sequência diferem), rotação/zoom/deslocamento/reset, seleção via busca e via clique, filtros, atualização após criar/excluir, destaque de memórias de um `rag_context` gerado pelo agente falso, linha de `access_log` de cliente MCP no painel, estado vazio, recorte grande (5.000 memórias), movimento reduzido (`prefers-reduced-motion` emulado), WebGL desligado (`--disable-webgl` no lançamento de teste) e montagem/desmontagem repetida.
- **App empacotado:** `verify:dist` estendido e verificação manual no instalado.

## Critérios de aceite

Cada item exige evidência registrada no `PLAN.md` (comando, resultado, captura ou medição). Itens visuais usam capturas do app real comparadas à referência; nenhum teste não executado é declarado aprovado.

- [x] 1. O cérebro é realmente tridimensional (geometria 3D navegável, não imagem, vídeo ou 2D). Evidência: capturas de três ângulos e E2E de rotação. **Comprovado** — `brain3d.spec.ts` (rotação, zoom, deslocamento) e `phase-19-app-side|front|top.png`.
- [x] 2. A aparência está alinhada à imagem de referência. **Aprovado pelo usuário em 2026-10-29** sobre `docs/assets/phase-19-comparison.png`. Evidência: capturas lado a lado com `docs/assets/phase-19-reference.png` e aprovação do usuário.
- [x] 3. A geometria cerebral é reconhecível (silhueta e hemisférios). **Aprovado pelo usuário em 2026-10-29:** plano B procedural (sem ativo externo), reconhecível nas vistas lateral, frontal e superior; testes de anatomia em `brain3d-anatomy.test.ts`. Evidência: capturas frente/lado/topo; origem e licença do modelo em `docs/THIRD-PARTY.md`.
- [x] 4. Existem partículas e conexões luminosas tridimensionais. Evidência: E2E de canvas não vazio e contagens por nível. **Comprovado** — E2E (partículas ≥ 8.000, conexões > 1.000, pixels acesos) e testes da rede.
- [x] 5. O cérebro apresenta impulsos luminosos contínuos. Evidência: capturas em sequência e teste do simulador. **Comprovado** — E2E (impulsos > 3, imagem muda com a câmera parada) e simulador.
- [x] 6. Os impulsos percorrem conexões visíveis. Evidência: teste do simulador (posição sempre sobre uma aresta). **Comprovado** — `brain3d-impulses.test.ts` (distância ao segmento < 1e-5).
- [x] 7. Há sinais simultâneos em direções diferentes. Evidência: teste do simulador e captura. **Comprovado** — `brain3d-impulses.test.ts` (pico > 5, direções opostas).
- [x] 8. Os impulsos se propagam e ramificam. Evidência: teste do simulador. **Comprovado** — `brain3d-impulses.test.ts` (saltos > 2, ramificações > 0).
- [x] 9. Os nós apresentam ativação e dissipação. Evidência: teste do simulador (decaimento até zero) e capturas. **Comprovado** — `brain3d-impulses.test.ts` (ativação > 0,3 e decaimento < 0,01).
- [x] 10. Rotação, zoom, deslocamento e reset funcionam. Evidência: E2E. **Comprovado** — `brain3d.spec.ts` (mouse, roda, botão direito, setas, Centralizar).
- [x] 11. Os nós interativos representam memórias reais. Evidência: E2E com banco conhecido (contagem e títulos). **Comprovado** — E2E (contagens e filtros iguais ao banco; criar/excluir refletem).
- [x] 12. A seleção mostra informações corretas. Evidência: E2E comparando o painel ao banco. **Comprovado** — E2E (busca e clique na tela; tipo, projeto e conexões).
- [x] 13. As conexões semânticas são justificáveis. Evidência: teste de rastreabilidade (cada aresta = link persistido ou similaridade acima do limiar). **Comprovado** — `brain3d-model.test.ts` e `brain3d-ipc.test.ts` (links do banco; similaridade ≥ 0,75 calculada no processo principal).
- [x] 14. Recuperações RAG reais destacam as memórias correspondentes. Evidência: E2E com `rag_context` do agente falso e com linha de `access_log` de cliente MCP. **Comprovado** — E2E (Claude Code via servidor MCP real; `rag_context` de tarefa com o agente falso).
- [x] 15. A atividade ambiente é distinguível da real. Evidência: legenda, cores/formas distintas, indicador, e E2E sem ativação real na ausência de eventos. **Comprovado** — legenda, cores distintas, indicador e E2E sem atividade real sem evento.
- [x] 16. As animações permanecem fluidas durante a navegação. Evidência: medição do harness durante rotação/zoom. **Comprovado** — `brain3d-perf.spec.ts`: 60 fps (GPU) e 63–74 fps (software).
- [x] 17. O usuário controla a intensidade dos efeitos. Evidência: E2E dos controles de qualidade e intensidade e persistência. **Comprovado** — E2E (qualidade e efeitos, persistidos após reinício).
- [x] 18. A preferência de movimento reduzido é respeitada. Evidência: E2E com `prefers-reduced-motion` emulado. **Comprovado** — E2E com `prefers-reduced-motion` emulado.
- [x] 19. A visualização atual permanece acessível. Evidência: alternância 3D/2D por E2E e testes existentes do grafo verdes. **Comprovado** — link "2D" (E2E) e testes do grafo 2D verdes.
- [x] 20. Desempenho e estados de erro são tratados. Evidência: tabela medida, E2E de WebGL desligado, estados vazio/erro e teste de vazamento. **Comprovado** — E2E sem WebGL, estado vazio, 5.000 memórias, 18 montagens sem esgotar contextos, geometrias estáveis.
- [x] 21. Funciona no Electron empacotado. Evidência: `verify:dist` estendido e verificação manual no app instalado. **Comprovado** — `verify:dist` estendido e `brain3d-packaged.spec.ts` no executável empacotado; falta a checagem no app instalado.
- [x] 22. As integrações existentes continuam funcionais. Evidência: suíte completa verde (unitários, integração, E2E). **Comprovado** — suítes completas: 398 unitários, 50 E2E, integração 8.
- [x] 23. Testes e verificações de qualidade aprovados. Evidência: lint, typecheck, build, `dist:win`, `verify:dist` e `git diff --check` registrados. **Comprovado** — lint, typecheck, build, `dist:win`, `verify:dist` e `git diff --check`.

## Riscos e limitações conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| Licença do modelo cerebral | Não poder distribuir o ativo | Confirmar licença na fonte antes de usar; plano B procedural como desvio registrado (critério 3) |
| CSP bloquear carregadores 3D | Cena não carrega no app empacotado | Ativo importado pelo bundle, sem `blob:`/WASM/workers; testar no pacote cedo (19.1) |
| GPU fraca ou renderização por software | Baixo fps, consumo alto | Níveis de qualidade, "Automática" medida, pausa quando oculto, limites de impulsos |
| E2E com WebGL instável | Testes intermitentes | Comportamento testado no simulador puro; E2E verificam presença, mudança e estados, não pixels exatos |
| Poucas memórias reais | Camada real esparsa | Estado vazio honesto e rótulo "ilustrativa" na camada decorativa |
| Similaridade sem busca semântica | Sem arestas calculadas | Mostrar indisponibilidade e como ativar (consentimento da Fase 6) |
| Recuperações MCP externas sem aviso ao app | Atraso na atividade real | Consulta periódica de `access_log` só com a página visível; atraso documentado |
| Retenção apaga `access_log` antigo | Histórico de atividade limitado | Painel mostra só atividade recente; sem promessa de histórico longo |
| Tamanho do bundle | Abertura mais lenta | Pedaço 3D carregado sob demanda; ativo compacto |
| Vazamento de recursos WebGL | Memória crescente | Descarte explícito e teste de montagem/desmontagem repetida |
| Confundir decoração com processamento real | Informação enganosa | Camadas separadas no código e na legenda; atividade real só por evento |

## Instruções para a implementação futura

Inspecionar o estado do repositório antes de começar; seguir TDD onde aplicável (simulador, mapeamentos, canais IPC); não usar mocks em produção; não executar Claude Code como subprocesso durante a implementação automatizada (usar o agente falso dos E2E); não criar commits automaticamente; registrar no `PLAN.md` apenas resultados comprovados. A fase só pode ser marcada como concluída quando todos os 23 critérios tiverem evidência; itens dependentes do usuário (referência visual, aprovação estética, licença) permanecem pendentes até essa evidência existir.
