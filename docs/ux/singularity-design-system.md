# Singularity — Design System (lote 50.02)

**Status:** implementado e **aprovado visualmente pelo usuário em 2026-11-08**. A aplicação nas demais telas
(lote 50.03+) não foi iniciada.

- **Referência visual:** `docs/assets/singularity/reference-memory-galaxy.webp`.
- **Página de revisão:** `#/design-system`, rota oculta que não aparece na navegação. Para abrir com `npm run dev`,
  rode `location.hash = '#/design-system'` no console do DevTools (Ctrl+Shift+I).
- **Capturas:** `artifacts/singularity/design-system-dark.png`, `design-system-light.png` e
  `dashboard-dark-tokens.png`, geradas pelo E2E `tests/e2e/design-system.spec.ts`.

## Princípios

1. **Petróleo quase preto como fundo, nunca preto puro.** As superfícies sobem em tons de petróleo
   (`background` → `sidebar` → `card` → `popover` → `secondary` → `accent`).
2. **Um dourado suave (`--primary` `#D9B875`)** marca o estado ativo, o foco e a ação principal. Não é cor de
   texto corrido, nem de fundo grande.
3. **Vidro preto:** painel translúcido, borda fina com 16% de dourado e realce superior de 5%. A luz fica sob o
   conteúdo, nunca atrás de parágrafos.
4. **Tipografia:** Inter na interface. A voz de marca é a própria Inter: fina, em caixa alta e bem espaçada, só
   em palavras curtas.
5. **Movimento discreto:** 140/220/420 ms com desaceleração, sem quique nem brilho pulsante. Com movimento
   reduzido, tudo fica instantâneo (regra global já existente).
6. **Evitar:** roxo ou azul saturados, neon, gradientes multicoloridos, vidro sobre vidro e brilho em todo lugar.
   O roxo e o azul que restam são cores de identidade (agente Codex, tipos de memória) e só aparecem em marcas
   pequenas.

## Tokens

Definidos em `apps/desktop/src/renderer/src/styles.css`. O tema escuro é o padrão; o claro vem de
`prefers-color-scheme`, que o Electron controla pelo seletor existente (`dark` / `light` / `system`). Os nomes dos
tokens anteriores foram mantidos, então nenhuma tela precisou mudar para receber a nova paleta.

| Grupo | Tokens | Escuro | Claro |
|---|---|---|---|
| Superfícies | `background`, `sidebar`, `card`, `popover`, `secondary`/`muted`, `accent` | `#041417` → `#173337` | pergaminho `#f3f0e7` → `#efe3c3` |
| Texto | `foreground`, `muted-foreground`, `accent-foreground` | `#e4e1d6`, `#9aa9a5`, `#f1e6c8` | `#0e2427`, `#4f5f5c`, `#3d2c08` |
| Sinal | `primary`, `ring`, `destructive`, `warning`, `success`*, `info`* | dourado `#d9b875`, `#e2c486`… | dourado escuro `#7d5a16`… |
| Sobre o sinal | `primary-foreground`, `destructive-foreground`* | `#1c1608`, `#2a0d08` | `#fffaf0` |
| Linhas | `border` (decorativa), `input` (identifica controles) | `#1d383b`, `#587879` | `#d8d1bf`, `#857c69` |
| Identidade | `agent-claude`, `agent-codex`, `type-*` (8 tipos) | dessaturadas | escurecidas |
| Vidro* | `glass-bg`, `glass-bg-strong`, `glass-border`, `glass-border-strong`, `glass-highlight`, `glass-blur` | | |
| Luz* | `glow-soft`, `glow-medium`, `glow-strong`, `atmosphere` | | |
| Profundidade* | `elevation-1..3` | | |
| Tipografia* | `tracking-display` 0.32em, `tracking-label` 0.24em, `tracking-title` | | |
| Movimento* | `motion-fast/base/slow`, `ease-out`, `ease-in-out` | | |

\* token novo. Classes Tailwind novas: `bg-success`, `text-info`, `text-destructive-foreground` etc.

### Classes de base (opcionais)

`.sg-atmosphere`, `.sg-glass` (+ `--strong`, `--interactive`, `--active`), `.sg-display`, `.sg-label`,
`.sg-title`, `.sg-gold`, `.sg-glow`, `.sg-hairline` e `.sg-enter`. Nenhuma tela existente as usa ainda; a
adoção é o lote 50.03. Sem `backdrop-filter`, o vidro vira painel opaco.

## Tipografia: avaliação

| Opção | Resultado |
|---|---|
| **Inter 300, tracking 0.32em (adotada)** | É o espaçamento do mockup, elegante, sem fonte extra. Usada em logo e rótulos de seção. |
| Inter 400, tracking 0.18em | Mais legível em tamanho pequeno, mas menos cinematográfica. |
| Inter 200, tracking 0.46em | Dramática; serve só para a tela de abertura. |
| Fonte display dedicada (ex.: Jost, Josefin Sans; OFL) | Não adotada. Aproximaria ainda mais o logotipo da referência, mas é uma dependência extra; fica como opção para o lote 50.04, se você quiser. |

**Escala:** destaque 32/300, título de página 24/400, seção 18/500, corpo 14/400, apoio 12/400, rótulo 11/500
em caixa alta. Os números grandes usam 200–300 com `tabular-nums`. Código e IDs continuam em IBM Plex Mono.

## Acessibilidade verificada

- `apps/desktop/test/singularity-tokens.test.ts` (146 testes) mede o contraste WCAG 2.2 nos dois temas:
  - texto (`foreground`, `muted-foreground`, `primary`, `destructive`, `warning`, `success`, `info`) ≥ 4,5:1
    sobre as 6 superfícies;
  - pares próprios (`*-foreground` sobre a sua cor) ≥ 4,5:1;
  - foco, borda de input e cores de agente e tipo ≥ 3:1 sobre `background` e `card`.
- A página mostra o contraste de cada token ao vivo, e o E2E garante que nenhum par aparece como "falha" em
  nenhum dos temas.
- O E2E também verifica: Inter carregada, sem rolagem horizontal em 1440/1024/800 px, todos os botões com nome
  acessível, foco visível por teclado e estado `aria-pressed` nas abas de exemplo.
- `--border` é decorativa (WCAG exige 3:1 só de linhas que identificam um controle, papel de `--input`).

## Mudanças em componentes existentes

- `components/ui/button.tsx`: a variante `destructive` trocou `text-white` por `text-destructive-foreground`.
  Com o vermelho claro do tema escuro, o branco ficava abaixo de 3:1. Só a cor mudou; a API do componente é a
  mesma.
- `body`: a fonte passou de IBM Plex Sans para Inter, e o `font-feature-settings` de `'ss02', 'tnum'` para
  `'cv11', 'tnum'` (o `ss02` da Inter troca formas de letras).

## Shell e componentes (lote 50.03)

**Status:** implementado e aprovado visualmente pelo usuário em 2026-11-08.

| Peça | Arquivo | Comportamento |
|---|---|---|
| Abas de contexto | `app/TopNav.tsx`, `app/shell-model.ts` | Orquestrador (`/chat`, também ativa em execuções, workflows e Mission Control), Agentes, MCP, RAG (`/memory/explore`), Memórias e Projetos. São atalhos para rotas existentes. Rótulo a partir de 1360 px, só ícone com tooltip de 1024 a 1359 px, ocultas abaixo de 1024 px. Nome acessível "Ir para X", que contém o texto visível e se distingue do link da lateral. |
| Barra lateral | `app/AppShell.tsx` | Mesmos grupos, rotas, recentes e recolhimento persistido (`nb.sidebar.collapsed`). O item ativo ganha borda dourada e brilho suave. |
| Status do sistema | `app/SystemStatus.tsx` | Agentes prontos / instalados, clientes MCP registrados / instalados (não registrado = atenção; erro = falha), banco e total de memórias. Enquanto carrega, mostra "verificando" ou "—", nunca um número. |
| Painel contextual | `app/shell-slots.tsx` (`ShellAside`) | Uma página registra conteúdo com `<ShellAside title>`. A partir de 1280 px vira coluna de 300 px; abaixo disso, drawer de vidro aberto por um botão no header, inerte quando fechado, fecha com Esc, clique fora ou troca de rota. Páginas sem painel mantêm o layout atual. |
| Linha do tempo | `components/shell/Timeline.tsx`, `ShellTimeline` | Trilho dourado com os eventos reais do dia, marcador "Agora" e rótulos que se escondem quando colidem (continuam no título e para leitores de tela). Sem eventos, diz isso. |
| Componentes de vidro | `components/ui/glass.tsx` | `GlassPanel`, `SectionLabel`, `StatusDot` (cor e texto oculto), `Chip`, `StatCard`, `MeterBar`, `DonutChart` (SVG com tabela acessível) e `ActivityList`. Todo número aceita `null`, que vira "—" ou "indisponível". |
| Barra de título nativa | `main/window.ts` | Fundo e símbolos no tom do header (`#0a1f22` / `#fbf9f2`), sem a faixa preta ou branca à direita. |

Movimento: transições de 220 ms nos itens, entrada `sg-enter` no status e drawer de 420 ms. Com movimento
reduzido, tudo é instantâneo.

## Galáxia de Memórias (lote 50.06)

- **Semântica:** cada estrela é uma memória viva (até 5.000, as mais recentes; acima disso o rodapé diz que é amostra). Cada braço é um grupo: tipo, projeto (até 9 + "Outros projetos") ou significado (k-means sobre os embeddings, nomeado pela tag mais frequente). Ao longo do braço, a posição vem do primeiro eixo semântico; o segundo abre o braço; o terceiro dá a espessura. Sem embedding, a posição vem de um hash do id, nunca de aleatoriedade.
- **Visual:** a viewport é sempre "espaço escuro", nos dois temas. Buraco negro pequeno (horizonte 0,62, disco 0,78–3,1, estrelas a partir de 3,4). Estrelas maiores = atualizadas nos últimos 7 dias ou validadas. Ligações douradas: só da estrela em foco, ou todas pelo botão.
- **Acessibilidade:** `role="application"` com ajuda de teclado (setas, Enter, +/−, Q/E, R, Esc), anúncio da estrela atual, lista virtual equivalente, movimento reduzido (sem rotação nem animação do disco), fallback sem WebGL.

## Monitoramento (lote 50.08)

- **Lateral:** medidores de CPU, memória e disco no bloco fixo "Status do sistema"; o bloco inteiro leva à página.
- **Página:** cartões de vidro com o valor atual grande e fino, gráfico histórico (área dourada na primeira série, linhas
  nas demais, lacunas onde não houve leitura) e detalhes. Sensor indisponível = ponto neutro e o motivo, nunca zero.
- **Gráfico:** `components/ui/time-series-chart.tsx` (SVG, sem dependência), com resumo acessível (agora, máximo e média).
- **Testes visuais:** elementos com `data-live-metric` ficam ocultos durante a comparação de snapshots.

## Pendências conhecidas

- **Snapshots visuais E2E:** atualizados depois da aprovação. `projects-visual` (1º caso) e `velix-visual`
  falham antes da captura, por motivos anteriores e sem relação com a paleta (ver `docs/STATUS.md`).
- **70 cores hexadecimais e 28 classes de paleta Tailwind** fixas no renderer (ex.: cérebro 3D, Velix, HUD) não
  seguem os tokens. A adoção é dos lotes 50.03+.
- O nome e o ícone continuam "NeuralBridge" até o lote 50.04 (D-1).
