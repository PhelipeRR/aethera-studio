# Fase 50 — Singularity: lotes 50.02, 50.03 e 50.06

**Status: PLANEJADOS — NÃO INICIADOS. A implementação depende de autorização explícita do usuário.**
Base: auditoria `docs/plans/phase-50-singularity-audit.md` (decisões D-1 a D-9 aprovadas em 2026-11-08) e
referência visual `docs/assets/singularity/reference-memory-galaxy.webp`.

Regras comuns aos três lotes:

- Nenhuma funcionalidade existente é removida. As rotas, os atalhos, as preferências e os deep links atuais
  continuam funcionando.
- Nenhuma migração de banco nestes lotes. Se a 50.06 precisar de cache persistido, vira subtarefa com migração
  aditiva própria (próximo número livre: `0093`, a confirmar na pasta).
- Nenhuma dependência nova sem justificativa registrada aqui. Previsão: zero para 50.02/50.03 e no máximo uma para
  50.06 (redução de dimensionalidade), decidida no início do lote.
- Validação mínima de cada lote: `npm run typecheck`, `npm run lint`, os testes Vitest afetados
  (`--no-file-parallelism` quando houver git), os E2E listados e `git diff --check`.
- A marca visível muda só no lote 50.04. Até lá, os lotes 50.02 e 50.03 entregam o tema com o nome atual.

---

## Lote 50.02 — Design system e identidade Singularity

**Objetivo:** definir os tokens e as regras visuais do Singularity, de modo que os lotes 50.03 a 50.08 usem só
tokens, nunca cor solta.

**Escopo**

1. **Tokens de cor (escuro, padrão — D-2):** fundo `#061C20`, superfície `#102A2D`, destaque dourado `#D9B875`,
   texto `#D6D6CB`, com as derivadas de borda, input, ring, muted, destrutivo e aviso. Os valores finais saem de
   uma verificação de contraste (WCAG AA: 4,5:1 para texto, 3:1 para UI e foco).
2. **Tokens de cor (claro):** uma variante clara coerente, porque o claro e o "sistema" continuam disponíveis (D-2).
3. **Tokens novos:** vidro (`--glass-bg`, `--glass-border`, `--glass-blur`), brilho dourado (`--glow-*`, em três
   intensidades), elevação (`--elevation-1..3`), raio, espaçamento, tipografia (escala, peso fino, tracking dos
   títulos em caixa alta, como "MEMÓRIAS" e "STATUS DO SISTEMA") e movimento (`--motion-fast/base/slow` e
   easing), além da regra para `prefers-reduced-motion`.
4. **Tipografia:** manter IBM Plex Sans/Mono, que já estão instaladas, ou escolher uma fonte fina de
   licença OFL. A decisão fica registrada no lote; se a fonte trocar, a nova entra como `@fontsource` (D-50.02-a).
5. **Cores de identidade preservadas:** `--agent-claude`, `--agent-codex` e `--type-*` (8 tipos de memória),
   reajustadas para contraste sobre o fundo petróleo, mantendo as mesmas variáveis.
6. **Logo e ícone:** horizonte de eventos com anel dourado, em SVG para o app e PNG/ICO para o instalador. **Os
   arquivos só são trocados na 50.04**; aqui entram como asset em `docs/assets/singularity/` e numa página de
   amostra.
7. **Documento `DESIGN.md`** do Singularity (tokens, uso, o que fazer e evitar: nada de roxo/azul saturado,
   neon ou galáxia multicolorida) e uma página interna de amostra dos tokens, só em dev, para revisão visual.

**Dependências:** 50.01 (concluído).

**Arquivos prováveis:** `apps/desktop/src/renderer/src/styles.css` (bloco `:root` e variante clara), novo
`DESIGN.md` (ou `docs/ux/singularity-design-system.md`), `docs/assets/singularity/*` e uma rota de amostra
protegida por `import.meta.env.DEV`.

**Riscos**

- Mudar `--primary` de laranja para dourado afeta todas as telas de uma vez. Isso é esperado, mas os snapshots
  visuais E2E (`*-visual.spec.ts-snapshots`) vão divergir. Mitigação: atualizar os snapshots num commit separado,
  com revisão das imagens.
- Contraste de dourado sobre petróleo em textos pequenos. Mitigação: o dourado fica para destaque e ícones; texto
  corrido usa `--foreground`.

**Critérios de aceite**

- Todos os tokens documentados, com par de contraste medido (tabela no documento).
- O tema escuro Singularity é o padrão; o claro e o "sistema" continuam funcionando pelo seletor atual
  (`handlers/theme.ts`).
- Nenhuma cor hexadecimal nova fora dos blocos de tokens (checagem por grep no PR).
- A página de amostra é aprovada visualmente pelo usuário (ponto de aprovação humana).

**Testes:** `theme-ipc.test.ts` sem regressão; um teste de contraste que lê os tokens e valida os pares
declarados; E2E `visual-qa.spec.ts` e `final-visual-matrix.spec.ts` com snapshots atualizados e revisados.

**Migração:** nenhuma. A preferência `theme` continua com `dark`/`light`/`system`.

**Rollback:** reverter o commit de tokens. Como os tokens mantêm os nomes, o código das telas não muda.

---

## Lote 50.03 — Infraestrutura de tema e componentes compartilhados

**Objetivo:** criar os componentes que o mockup usa várias vezes e o novo shell (topo, lateral, painel direito
opcional e rodapé), sem mudar o comportamento das telas.

**Escopo**

1. **Primitivos** em `components/ui/`: `GlassPanel`, `SectionLabel` (rótulo em caixa alta espaçado), `StatCard`
   (número grande e legenda), `MeterBar` (barra compacta de CPU/memória/disco, com estado "indisponível"),
   `StatusDot` (ok/aviso/erro/desconhecido), `DonutChart` (SVG puro, com tabela acessível equivalente),
   `ActivityList`, `Chip`/`Tag` e `GoldButton` (a variante primária do `button.tsx` atual).
2. **Shell** (`app/AppShell.tsx`, hoje com 130 linhas):
   - **Topo:** logo, abas de contexto (Orquestrador, Agentes, MCP, RAG, Memórias, Projetos), busca, notificações
     e configurações. As abas são atalhos para rotas que já existem, não um segundo sistema de navegação.
   - **Lateral:** mantém os grupos atuais (Trabalho, Conhecimento, Integrações, Configurações) e o recolhimento.
     Ganha um espaço reservado para "Status do sistema", que o lote 50.08 preenche com dado real. Até lá, o espaço
     mostra só o que já existe hoje (agentes disponíveis, estado do banco) ou fica oculto.
   - **Painel direito:** um slot opcional por rota (usado pela Galáxia).
   - **Rodapé:** um slot opcional para a linha do tempo (D-5), que fica oculto onde não for usado.
3. **Estados padrão:** vazio, carregando, erro, offline e dado insuficiente, reaproveitando o primitivo de feedback
   da Task 3.2 da consolidação.
4. **Movimento:** transições com `motion` (já instalado), respeitando `prefers-reduced-motion`.

**Dependências:** 50.02.

**Arquivos prováveis:** `components/ui/*` (novos), `app/AppShell.tsx`, `app/routes.ts` (metadados das abas, sem
rota nova), `styles.css`, e os testes correspondentes em `apps/desktop/test/`.

**Riscos**

- O shell é tocado por todas as telas e pelo E2E `navigation-information-architecture.spec.ts`. Mitigação: manter
  os rótulos acessíveis (`aria-label="Menu"`, `"Navegação principal"`) e os seletores por papel; as abas do topo
  ganham papéis próprios.
- `backdrop-filter` (vidro) pesa em GPU fraca. Mitigação: um token de fallback opaco e a mesma regra de qualidade
  do brain3d (`quality.ts`).
- A lateral não pode mostrar números fictícios antes do 50.08 (briefing §4).

**Critérios de aceite**

- Todas as rotas atuais abrem pelo novo shell, com teclado e foco visível.
- Os deep links e os atalhos atuais continuam funcionando.
- Cada primitivo tem estados de vazio, carregamento e erro, e o `DonutChart` tem alternativa textual.
- Nenhuma tela perde funcionalidade; as diferenças são só visuais.

**Testes:** testes unitários dos primitivos (renderização, estados, acessibilidade); E2E
`navigation-information-architecture.spec.ts`, `chat`, `memory.spec.ts` e `projects-visual.spec.ts`; um E2E de
viewport (larguras mínima e comum) e de movimento reduzido.

**Migração:** nenhuma. A preferência de lateral recolhida continua a mesma.

**Rollback:** os primitivos novos são aditivos. O shell fica num commit isolado e pode ser revertido sozinho.

---

## Lote 50.06 — Motor visual da Galáxia de Memórias

**Objetivo:** substituir o cérebro 3D por uma galáxia em que **cada estrela é uma memória real**, com um buraco
negro pequeno no centro e grupos por tipo e projeto (D-3), posicionados por similaridade (D-4).

**Escopo**

1. **Modelo de dados para a visualização** (somente leitura, sem mudar o schema):
   - **Estrela:** `memories` vivas, com `id`, `title`, `type`, `project_id`, `trust`/`confidence`, `source_kind`
     e datas.
   - **Grupo em órbita:** a agregação por `type` (8 tipos) e por `project_id` (global e projetos). A visão
     alterna entre "por tipo" e "por projeto". Os rótulos do mockup (Desenvolvimento, Documentação…) são mapeados
     para os tipos reais e documentados; o grupo "RAG/MCP/Agentes" do mockup vira o filtro por `source_kind`.
   - **Linha:** só `links` (explícitos e wikilinks resolvidos). A similaridade aparece como proximidade, não como
     linha, a não ser que o usuário ligue a opção existente "similaridade".
2. **Layout:**
   - Redução dos embeddings para 2D/3D (PCA incremental ou UMAP) **num Web Worker**, que substitui o cálculo
     O(n²) que hoje roda no processo principal (`main/brain.ts`, `SIMILARITY_LIMIT = 1500`).
   - As coordenadas viram posição dentro do braço do grupo, com raio pela relevância (recência e confiança). O
     critério fica documentado na tela, em "Como a galáxia é organizada".
   - Memórias sem embedding entram no grupo, em posição determinística pelo `id` (seed fixa, sem `Math.random()`).
3. **Renderização** (reaproveitando `scene-runtime.ts`, `webgl.ts`, `quality.ts` e o controle de câmera):
   - Estrelas via `InstancedMesh`/`Points` com shader de brilho; disco de acreção e buraco negro em shader
     dourado, pequeno e central.
   - **Escala:** até 5.000 estrelas individuais (o `GRAPH_LIMIT` atual). Acima disso, clusters agregados por grupo
     com contagem real e carregamento incremental ao dar zoom num grupo. Isso aparece na tela como "amostra" ou
     "agregado".
   - LOD por distância e pausa da animação quando a janela estiver oculta.
4. **Interação:** rotação, pan, zoom, foco na estrela, busca textual e semântica (reusa a `HybridSearch`
   existente), filtros por projeto, tipo, período e origem, e navegação por teclado entre estrelas. O card de
   detalhe mostra título, tags, resumo, data, fonte, projeto e as ações que já existem (abrir no editor, editar).
5. **Privacidade:** rótulos só com título, e o resumo só no card. Nenhum conteúdo de memória vai para logs ou para
   os atributos `data-*` dos testes.
6. **Fallback:** sem WebGL ou com movimento reduzido, a tela abre o grafo 2D (`GraphPage`) ou a lista, com os
   mesmos filtros.
7. **Rota:** a Galáxia assume a entrada do cérebro 3D. A rota antiga redireciona para ela, e o cérebro 3D fica
   atrás de uma preferência até o fim do 50.07, para permitir rollback sem build novo.

**Fora do escopo** (fica no 50.07): painel direito com total e distribuição, atividade recente, linha do tempo e
"Adicionar memória" ligados aos dados. Na 50.06 o painel direito pode mostrar só o total e a distribuição, que já
saem do mesmo modelo.

**Dependências:** 50.01 e 50.03 (shell e primitivos). Não depende do 50.08 nem do CORE.

**Arquivos prováveis:** novo `features/galaxy/` (página, modelo, layout, worker, shaders), reuso de
`features/brain3d/{scene-runtime,webgl,quality,controller}.ts`, um IPC de leitura em `main/brain.ts`
(`graph3d`/`similarity`, com contrato novo e versionado em `shared/src/brain3d.ts` ou `galaxy.ts`), além de
`main.tsx`/`routes.ts`.

**Riscos**

- **Desempenho (R3):** GPU integrada com milhares de estrelas e o disco de acreção. Mitigação: orçamento medido
  e níveis de qualidade.
- **Fidelidade semântica:** projeções de embedding podem agrupar mal com poucas memórias. Mitigação: abaixo de N
  memórias, o layout cai para o determinístico por grupo.
- **Nova dependência para UMAP:** avaliar a licença e o tamanho. PCA não precisa de dependência e é o padrão
  inicial (D-50.06-a).
- **Regressão do brain3d:** 7 arquivos de teste unitário e 4 E2E dependem dele. Mitigação: manter o brain3d
  intacto atrás da preferência até a 50.07.

**Critérios de aceite**

- Cada estrela corresponde a uma memória viva, e as contagens batem com o banco (teste com fixture).
- Sem números fictícios: agregação e amostragem aparecem indicadas.
- Seleção por mouse e teclado abre o card com os dados reais e as ações existentes.
- Orçamento de desempenho (medido no `brain3d-perf.spec.ts` adaptado): ≥ 30 FPS no perfil "low" com GPU, com
  5.000 memórias; tempo até a primeira interação ≤ 1,5 s com 5.000; seleção ≤ 100 ms. Os números finais são
  medidos antes e depois e registrados.
- O fallback 2D/lista funciona sem WebGL e com movimento reduzido.
- O cérebro 3D continua disponível pela preferência e a rota antiga redireciona.

**Testes**

- **Unitários:** modelo (agregação, contagens, mapeamento tipo/projeto), layout determinístico, worker de
  projeção (fixture de vetores), filtros e busca.
- **IPC:** contrato novo validado por schema, no padrão do `brain3d-ipc.test.ts`.
- **E2E:** abrir a galáxia, filtrar, buscar, selecionar por teclado, fallback sem WebGL e movimento reduzido;
  desempenho com 0, 50, 1.000 e 5.000 memórias; o empacotado no padrão do `brain3d-packaged.spec.ts`.
- **Privacidade:** nenhum conteúdo de memória em logs ou atributos de teste.

**Migração:** nenhuma de schema. As preferências ganham uma chave nova e opcional (`galaxy` vs `brain3d`), com
padrão `galaxy` e leitura tolerante quando a chave não existir.

**Rollback:** voltar a preferência para `brain3d`, sem build novo. Para remover de vez, reverter a rota.

**Decisões internas a registrar no início do lote:** D-50.06-a (PCA vs UMAP), D-50.06-b (2D plano vs disco 3D
inclinado como no mockup; a recomendação é o disco 3D inclinado com câmera limitada).

---

## Ponto de aprovação humana

Antes de iniciar cada lote: o usuário autoriza o lote explicitamente. Ao fim da 50.02: o usuário aprova a página
de amostra dos tokens. Ao fim da 50.06: o usuário aprova visualmente a galáxia com os próprios dados.
