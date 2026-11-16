# Produção com IA — migração incremental para shadcn/ui (redesign minimalista)

Data: 2026-11-16. Tela: `/aethera/cinema` → `CinemaDirectorPanel` (`packages/desktop-shared/src/renderer/src/features/video`).

## 1. Arquitetura atual

- O Aethera (`apps/aethera-desktop`) renderiza o código de `packages/desktop-shared/src/renderer/src` pelo alias `@`.
  O `components.json` do shadcn fica em `apps/desktop` (outra cópia do renderer), então `npx shadcn add` gravaria no
  lugar errado. Os componentes foram obtidos pelo CLI (`add --dry-run --view`, estilo `new-york`, base `radix`,
  Tailwind v4, ícones `lucide`) e gravados em `desktop-shared/.../components/ui`, com `cn` de `@/lib/utils`.
- Tema: `aethera-theme.css` escopado em `[data-studio-theme='aethera']`, fundo obsidiana, `--primary` roxo
  `#8b5cf6`, `--ring` `#a855f7`. Os tokens `success`, `warning`, `info` já existem no `@theme`.
- `CinemaDirectorPanel` (≈2000 linhas) concentra estado e handlers da produção e a marcação da tela. Hoje a tela tem
  ~15 cartões com borda, um hero em gradiente roxo→âmbar, controles soltos em grade de 12 colunas, cores cruas
  (`amber-*`, `emerald-*`, `#0d0d17`) e o progresso dentro do formulário.

## 2. Componentes reutilizáveis

| Já existe (mantido) | Uso no redesign |
|---|---|
| `ui/button` (shadcn) | todas as ações (variantes `default`, `outline`, `ghost`, `secondary`, `destructive`) |
| `ui/field` (`Input`, `Select`, `Textarea`) | controles nativos (preservam ids, `multiple` e teclado) |
| `ui/tooltip`, `ui/confirm-dialog`, `DeletePromptDialog` | sem mudança |
| `ProductionConsoleAccordion` | Console Geral (`scope="all"`) e console por projeto (`jobId`) — sem mudança de lógica |
| `TrendRadarPanel`, `ProductionContractCompliancePanel`, `EditorialAuditPanel`, `MediaCoveragePanel`, `VoiceDirectorPanel` | reaproveitados como estão; só mudam de posição |

| Adicionado do registro shadcn | Substitui |
|---|---|
| `Tabs` | botões manuais "Produção & Direção" / "Auditoria Editorial" |
| `Badge` | `span` com cores cruas (status, percentuais, contagens) |
| `Progress` | barras `div` com gradiente |
| `Separator` | bordas entre blocos e cartões por item |
| `Collapsible` | grade de configurações avançadas sempre aberta |
| `Alert` (+ variante local `warning`) | caixas âmbar/vermelhas de conflito, pendência e erro |

## 3. Nova organização (proposta minimalista)

1. **Cabeçalho compacto**: título, uma linha de descrição, `Badge`s de diretores/FFmpeg e `Tabs` (Produção ·
   Auditoria editorial). Sem hero em gradiente.
2. **Briefing** (coluna principal): textarea em destaque, avisos de sincronia/conflito como `Alert`, uma linha de
   ajustes essenciais (duração, humor, idioma, voz) e o botão principal. Formato, categoria, estética, entrega,
   exportações, catálogo e perfis de render/preview ficam em **Configurações avançadas** (`Collapsible`).
3. **Acompanhamento** (coluna lateral, fixa na rolagem em telas largas): produção ativa com `Progress`, tempos,
   etapas em lista vertical, cancelar/retomar, pendências de mídia e conformidade do contrato.
4. **Produções**: lista sem cartão por item (linhas separadas por `Separator`), cada uma com ações e o **console
   do projeto**.
5. **Console Geral**: seção própria e independente das produções.
6. **Resultado e diagnósticos**: storyboard, qualidade, benchmark, cobertura de mídia e voz, com menos bordas.

## 4. Lotes

| Lote | Escopo | Validação |
|---|---|---|
| M1 | Adicionar `tabs`, `badge`, `progress`, `separator`, `collapsible`, `alert` | typecheck |
| M2 | Cabeçalho + `Tabs` | typecheck, E2E redesign |
| M3 | Briefing + configurações avançadas | E2E (`#cinema-prompt`, `#cinema-duration`, conflitos) |
| M4 | Acompanhamento lateral + produções + consoles | E2E (`data-production-job`, `data-console-panel`) |
| M5 | Resultado e diagnósticos com menos bordas | typecheck, inspeção visual |
| M6 | Validação visual (1440×900 e 1024×768) e testes | screenshots em `docs/aethera/screenshots` |

## 5. Invariantes

- Nenhuma mudança em handlers, bridge IPC, estado ou contrato de produção: só marcação e classes.
- Mantidos: heading "Produção com IA", ids `cinema-*`, textos e rótulos usados pelos E2E, `data-production-job`,
  `data-console-panel` (os dois consoles sempre montados), região "Conformidade do contrato de produção".
- Cores por tokens semânticos (`primary`, `muted-foreground`, `success`, `warning`, `destructive`); sem `dark:`.
- Acessibilidade: rótulos em todos os controles, foco visível, `aria-live` no progresso, ordem de leitura igual à
  visual, layout de uma coluna abaixo de `lg`.

## 6. Execução e evidências (2026-11-16)

Executado no worktree `.claude/worktrees/aethera-production-shadcn`, branch `feat/aethera-production-shadcn`
(base `feat/gateway-fallback-fix` @ `142f1e2`), porque o checkout principal foi trocado para `main` por outra sessão
durante o trabalho.

| Lote | Resultado |
|---|---|
| M1 | `tabs`, `badge`, `progress`, `separator`, `collapsible`, `alert` obtidos com `npx shadcn@latest add --dry-run --view`; variantes locais `success`/`warning`/`muted` (Badge) e `warning` (Alert) sobre tokens semânticos |
| M2–M5 | `CinemaDirectorPanel`: só marcação/classes (handlers e estado intactos). Cabeçalho compacto com `Tabs`; briefing + ajustes essenciais + `Collapsible` de configurações avançadas; coluna "Acompanhamento" fixa (≥1280 px) com `Progress`, tempos, etapas e pendências; lista "Projetos em Produção com IA" sem cartões, com console por projeto; "Console Geral" em seção própria; resultado/diagnósticos com menos bordas. `ProductionContractCompliancePanel` sem cartões aninhados. `ProductionConsoleAccordion`: paleta verde-azulada trocada por tokens roxos do tema (cores de status mantidas) |
| M6 | Capturas em `docs/aethera/screenshots/production-ai/` (1440×900 e 1024×768) |

Verificação:

- `tsc -p apps/aethera-desktop/tsconfig.web.json`: OK. `tsconfig.node.json` falha em
  `test/delete-prompt-dialog.test.ts` (`--jsx` não configurado), erro pré-existente desde `e1335e6`.
- `eslint` nos arquivos alterados: OK. `npm run build:aethera`: OK.
- E2E `tests/e2e/aethera-redesign.spec.ts` e novo `tests/e2e/aethera-production-ai-layout.spec.ts`: 2/2 OK
  (o primeiro precisa do fixture não versionado `docs/aethera/cinema/real-showcase/showcase-v2-final.mp4`).
- `vitest run apps/aethera-desktop/test`: 197 OK, 3 falhas só em `sharp-native-smoke.test.ts`, que exige o instalador
  empacotado em `dist/aethera/win-unpacked` (ausente no worktree).

Observação: `TrendRadarPanel`, `EditorialAuditPanel`, `MediaCoveragePanel` e `VoiceDirectorPanel` foram
reaproveitados sem mudança visual. A seção 7 substitui o layout descrito acima.

## 7. Segunda proposta aprovada (v2) — execução e evidências (2026-11-16)

Fonte: `docs/aethera/video-ai-ux-redesign-proposal.md` e `.html` (versionados em `main`, commit `8e03aea`). A
estrutura da proposta foi adotada integralmente. A paleta petróleo/dourado dos mockups **não** foi usada: o pedido
original exige manter a identidade escura com detalhes roxos, então tudo usa os tokens do tema Aethera.

| Lote | Entrega |
|---|---|
| V1 | Componentes shadcn `dialog`, `popover`, `toggle`, `toggle-group` (com `motion-reduce:animate-none`) |
| V2 | `cinema/production-status-model.ts` (puro, com teste): status por ícone + texto, etapa "N de 11", 4 fases do stepper, rótulo semântico do humor, opções de render com VRAM, favoritos de formato/estilo |
| V3 | `ProductionRail`: lista persistente à esquerda; selecionar só troca a produção exibida (sem `scrollTo`); "Nova produção" |
| V4 | Cabeçalho: chips "N rodando" / "N aguarda você", atalho para o Console Geral e popover ⚙ "Diagnóstico do ambiente" (diretores/provedores, FFmpeg, Benchmark) |
| V5 | Abas de intenção **Criar · Produção ativa · Revisão · Auditoria Editorial** |
| V6 | Criar: briefing protagonista, linha "Entendi:" com "ajustar", Formato e Estilo como `ToggleGroup` (favoritos + catálogo completo em Configurações avançadas), duração sincronizada, humor com rótulo semântico, linhas de divulgação progressiva (Narração e idioma, Qualidade, Configurações avançadas), VRAM só na linha de estimativa, ID da voz fora do rótulo, `RefreshCw` com `aria-label`, CTA único |
| V7 | `IdeasColumn`: histórico real do Trend Radar em coluna com altura limitada e rolagem própria; "Pesquisar novas ideias" abre o `TrendRadarPanel` real num `Dialog`; "Usar ideia" só preenche o briefing e oferece **Desfazer** |
| V8 | Produção ativa: título/id/tentativa, status com ícone + texto, "Etapa N de 11", % e `Progress`, decorrido/restante, `ProductionStepper` (11 etapas em 4 fases), bloco "Agora" com atalho para o console, falha como `Alert`, "Precisa de você" para mídia pendente; "Autorizar Motion Visual para todas" agora pede confirmação (`ConfirmDialog`) |
| V9 | Revisão: subnavegação vertical (Roteiro & Storyboard, Qualidade & Render, Mídia & Grounding, Voz & Pronúncia) com estados vazios |
| V10 | Console do projeto como dock recolhível no rodapé (só a produção selecionada, altura máx. 45vh); **Console Geral** como página própria (`/aethera/console`) no menu principal |
| V11 | Texto mínimo de 12 px (console 11 → 12 px), botões ≥ 32 px, `motion-safe` nas animações |

Invariantes mantidos: nenhum handler, chamada IPC, estado de produção ou contrato mudou. A única mudança de
comportamento é a confirmação antes de autorizar motion visual em todas as cenas pendentes, pedida pela proposta.
Retomar, cancelar, editor e exclusão aparecem só nas mesmas condições de antes (a API decide).

Verificação (worktree `aethera-production-shadcn`):

- `tsc -p apps/aethera-desktop/tsconfig.web.json`: OK. `eslint` nos arquivos alterados: OK. `npm run build:aethera`: OK.
- `vitest run apps/aethera-desktop/test/production-status-model.test.ts`: 8/8 OK.
- E2E `aethera-production-ai-layout.spec.ts` (reescrito para a v2) e `aethera-redesign.spec.ts`: 2/2 OK.
- Capturas revisadas em `docs/aethera/screenshots/production-ai/01..09` (1440×900 e 1024×768). A revisão visual
  encontrou e corrigiu: o dock aberto cobria as abas em 1024×768, as subabas aninhadas herdavam o indicador
  horizontal e um rótulo visível divergia do nome acessível.

Pendências:

- Matriz cena × qualidade e a aba SFX/VFX da Revisão: sem dados na API atual.
- "Agora" mostra a última mensagem do job; ainda não há heartbeat por etapa.
- Virtualização do trilho e do console para muitas produções.
- `PromptEditor.tsx`/`prompt-editor-model.ts` (não rastreados, de outra sessão) não foram integrados.
- `aethera-console-jobs.spec.ts` (opt-in) ainda usa o seletor antigo `[data-production-job] [data-console-panel="job"]`;
  o console por projeto agora fica em `#cinema-project-console`.
- O `TrendRadarPanel` reaproveitado no diálogo mantém o CTA em gradiente próprio.
