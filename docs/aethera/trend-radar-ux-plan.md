# Pesquisar novas ideias (Trend Radar) — análise e plano de melhoria

Data: 2026-11-16. Escopo: `TrendRadarPanel.tsx` exibido no diálogo "Pesquisar novas ideias" (`cinema/IdeasColumn.tsx`).
Referência visual: tela "Produção com IA" (tokens do tema Aethera + componentes shadcn locais).

## Diagnóstico (UI/UX Pro Max)

| # | Problema | Regra | Severidade |
|---|---|---|---|
| 1 | Paleta própria em hex (`#0e0b18`, `#2d2647`, `#161124`…), CTA em gradiente roxo→âmbar, "Usar esta ideia" verde, "Por que agora" em âmbar: nada disso existe na Produção com IA | consistency | Alta |
| 2 | Cabeçalho duplicado dentro do diálogo: título do diálogo + "Pesquisa Inteligente & Pauta" + "Radar de Tendências…" + botão de recolher + "Recolher Radar" | hierarchy | Alta |
| 3 | 6 filtros com o mesmo peso (País, Idioma, Período, Formato, Qtd., Duração); rótulos sem `htmlFor` | form-labels, progressive disclosure | Alta |
| 4 | Três botões de pesquisa lado a lado com o CTA chamativo; "Atualizar" e "Pesquisar mais" competem com a ação principal | primary-action | Média |
| 5 | Cartões de ideia muito densos: título longo, resumo, "Por que agora" com data ISO crua (`2026-11-14T20:08:00.000Z`), três metadados | readability | Média |
| 6 | Detalhe: as ações "Usar esta ideia" e "Gerar outra abordagem" ficam enterradas após insights e fontes; quatro caixas aninhadas | primary-action, nesting | Alta |
| 7 | Bug: campo "Humor contextual & Duração/Formato" concatena dois valores e grava o texto concatenado em `contextualHumor`, corrompendo o briefing a cada tecla | data integrity | Alta |
| 8 | Texto 10–11 px, chips sem `aria-pressed`, mensagens sem `aria-live`, link externo sem indicação | accessibility | Média |
| 9 | Duas rolagens fixas de 520 px dentro de um diálogo que também rola | scroll nesting | Média |

## Plano

1. **Cores**: só tokens semânticos (`card`, `border`, `muted`, `primary`, `success`, `warning`, `destructive`) e os componentes `Button`, `Badge`, `Alert`, `Input`/`Select`/`Textarea`, iguais aos da Produção com IA. Sem gradiente, sem verde/âmbar decorativo.
2. **Cabeçalho**: no diálogo (`defaultExpanded`) o painel não repete título nem botão de recolher; o histórico vira um `Select` rotulado na barra de pesquisa.
3. **Formulário em dois níveis**: "Nicho" (chips com `aria-pressed` + campo livre + subnicho) e linha essencial (Período, Formato); País, Idioma, Qtd. de ideias e Duração em "Mais filtros" (`Collapsible`), com resumo visível.
4. **Ações**: um CTA primário "Pesquisar tendências"; "Atualizar" e "Pesquisar mais" como botões `ghost` com ícone, só depois de existir resultado.
5. **Lista de ideias**: título (2 linhas), `Badge` de formato·duração, resumo (2 linhas), "Por que agora" (1 linha, datas ISO formatadas em pt-BR) e metadados discretos; seleção com borda `primary` e `aria-pressed`.
6. **Detalhe**: cabeçalho com título e ações no topo (fixas ao rolar); insights como lista de definições em 2 colunas sem caixas; fontes com `Badge` da origem, data e ícone de link externo.
7. **Briefing**: `Field` + `Textarea` para todos os campos; "Humor contextual" e "Duração e formato" separados (corrige o bug 7); refinamento numa linha no fim.
8. **Feedback**: `Alert` para status/erro/avisos com `aria-live`; carregamento com spinner.
9. **Layout**: diálogo `max-w-6xl`; lista e detalhe com altura `min(60vh, 640px)`, uma rolagem por coluna; uma coluna abaixo de `lg`.

Invariantes: nenhuma mudança em handlers, chamadas IPC, tipos exportados ou payload de "Usar esta ideia"; textos usados por testes ("Pesquisar novas ideias", "Pesquisar tendências", `data-testid="trend-radar-panel"`) mantidos.

## Execução (2026-11-16)

- Itens 1–9 implementados em `TrendRadarPanel.tsx`; tipos e helpers puros movidos para `trend-radar-model.ts` (reexportados pelo painel) para o teste Node não depender do alias `@/`. Novo `formatIsoDates` (datas ISO → pt-BR) com teste. Estado vazio antes da primeira pesquisa. Diálogo em `sm:max-w-6xl`.
- Verificação: `tsc -p apps/aethera-desktop/tsconfig.web.json` OK; `eslint` OK; `vitest run packages/cinema/test/trend-radar.test.ts` 8/8 OK; `npm run build:aethera` OK; captura em `docs/aethera/screenshots/production-ai/03-pesquisar-ideias.png`.
- Pendência fora do escopo: `aethera-production-ai-layout.spec.ts` passa pelo diálogo, mas falha adiante (linha 120): a produção segue "Rodando Etapa 3 de 11" em vez de pausar em "Pesquisa Pendente". Coincide com alterações não commitadas de outra sessão em `packages/cinema/src/analysis/media-providers/*`.
- Não verificado com dados reais: lista de ideias e briefing (o ambiente E2E não tem histórico de pesquisas).
