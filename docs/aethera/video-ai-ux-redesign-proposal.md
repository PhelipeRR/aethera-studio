# Proposta de redesign — Criação de Vídeo com IA (Aethera)

Data: 2026-11-16 · Método: skill UI/UX Pro Max (design system + UX guidelines) sobre o código atual.
Escopo analisado: `packages/desktop-shared/src/renderer/src/features/video/CinemaDirectorPanel.tsx` (tela principal, 1.670 linhas) e os painéis que ela compõe: `TrendRadarPanel`, `MediaCoveragePanel`, `VoiceDirectorPanel`, `EditorialAuditPanel`, `ProductionConsoleAccordion`.

Status: **proposta**, nada implementado.

---

## 1. Diagnóstico

### 1.1 O problema central: uma página única para 3 jobs diferentes

Hoje a tela empilha verticalmente, na mesma rolagem:

1. Hero "Produção com IA" (status de provedores, FFmpeg)
2. Abas Produção & Direção | Auditoria Editorial
3. Radar de Tendências (861 linhas, acima do formulário)
4. Formulário de briefing + 7 controles + Benchmark + CTA
5. Progresso do job ativo + pendências de mídia (dentro do `<form>`)
6. Lista "Projetos em Produção" (cada card com seu próprio console)
7. Console Geral
8. Benchmark Corpus
9. Narrativa & Storyboard (7 col) + Comedy Beats & Release Gates (5 col)
10. Cobertura de Mídia
11. AI Voice Director (+ dicionário, prévia de voz)
12. Modal de exclusão

São três intenções de usuário distintas misturadas: **criar** (briefing), **acompanhar** (produções rodando) e **revisar** (storyboard, mídia, voz, auditoria). O usuário que só quer saber "minha produção travou?" precisa rolar além do Radar e do formulário. Quem quer criar vê consoles e benchmark que não ajudam a decidir nada.

### 1.2 Achados por prioridade (regras UI/UX Pro Max)

| # | Prioridade | Regra | Achado no código | Impacto |
|---|---|---|---|---|
| A1 | CRÍTICA | `color-contrast`, `readable-font-size` | Uso extenso de `text-[10px]` / `text-[11px]` em status, ETA, chips de etapa, botões Cancelar/Retomar. Chips inativos usam `text-muted-foreground` sobre `bg-background/40`. | Informação operacional crítica (etapa, ETA, erro) é a menos legível da tela. |
| A2 | CRÍTICA | `touch-target-size`, `aria-labels` | Botões Cancelar/Retomar com `py-0.5 text-[10px]` (~20px de altura). Botão de atualizar vozes usa o caractere `↻` como ícone, só com `title`. | Alvos pequenos para ações destrutivas/críticas; ícone sem `aria-label`. |
| A3 | ALTA | `error-feedback`, Progress Indicators | Lista de projetos mostra **"Etapa (x/8)"** com `Math.min(8, …)`, mas `PIPELINE_STAGES` tem **11** etapas. Barra do job ativo mostra 11 chips sem indicar "etapa N de 11". | Progresso inconsistente entre o painel ativo e a lista; o usuário não confia no número. **Bug, não só UX.** |
| A4 | ALTA | Hierarquia / CTA único | "Rodar Benchmark" fica ao lado de "Gerar Direção & Storyboard", com o mesmo peso de borda. Benchmark é ação de diagnóstico, não de criação. | Risco de clique errado; dilui o CTA principal. |
| A5 | ALTA | `form-labels` | Render, Idioma e Voz não têm `<label>`; o rótulo está embutido no texto da opção ("Idioma: Português (BR)", "Voz: X (9190edfa)"). | Leitores de tela leem o valor, não o campo; visualmente não fica claro que são campos editáveis. |
| A6 | ALTA | Progressive disclosure | Jargão técnico no primeiro nível: "-14 LUFS", "2.4 GB VRAM", ID da voz, "RF-07", "Modo determinístico". | Ruído para o caso comum; correto para o modo avançado. |
| A7 | MÉDIA | `content-jumping` | Bloco de progresso e pendências de mídia aparecem/somem dentro do `<form>`, empurrando o layout; ao clicar "Resolver Mídias" na lista a tela faz `scrollTo(top)`. | Salto de layout; contexto perdido. |
| A8 | MÉDIA | Consistência | Dois consoles (por produção + Geral) com o mesmo componente pesado (956 linhas); cada card de projeto renderiza o seu. | Peso visual e de render; o console por card duplica a função de "detalhes". |
| A9 | MÉDIA | Feedback de estado | Estados (rodando, pausado, falha, concluído) diferenciados só por cor de chip (verde/âmbar). | `Color is not the only indicator` — falta ícone/texto de estado. |
| A10 | MÉDIA | Responsivo | Grid `lg:col-span-*` funciona em desktop; em <1024px o formulário vira coluna longa com o Radar acima. | App desktop, mas janelas estreitas (split) degradam bastante. |
| A11 | BAIXA | `reduced-motion` | `animate-spin`, `transition-all` na barra sem checagem de `prefers-reduced-motion`. | Ajuste simples. |
| A12 | BAIXA | Estilo | Gradiente roxo→âmbar em hero, CTA e barra; cores hex fixas (`#121220`, `#0d0d17`) em vez de tokens. | Visual "template IA"; dificulta tema claro. |

---

## 2. Proposta: um estúdio com 3 áreas e um rail de produção

### 2.1 Nova arquitetura de informação

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Aethera · Produção com IA          [● 2 rodando] [! 1 aguarda você]  ⚙  │  ← header fino, status global
├───────────────┬──────────────────────────────────────────────────────────┤
│ PRODUÇÕES     │  [ Criar ] [ Produção ativa ] [ Revisão ] [ Auditoria ]  │  ← abas por intenção
│ (rail)        │                                                          │
│ ● Elden Ring  │  (conteúdo da aba)                                       │
│   Roteiro 4/11│                                                          │
│   62% · 8 min │                                                          │
│ ⏸ Top 10 RPG  │                                                          │
│   Mídia (3)   │                                                          │
│ ✓ Trailer GTA │                                                          │
│   Editor →    │                                                          │
│ ✕ Doc Zelda   │                                                          │
│   Falhou · t2 │                                                          │
│ [+ Nova]      │                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
│ ▸ Console (3 erros · 1 retry)                                   [filtros]│  ← dock inferior recolhível
└──────────────────────────────────────────────────────────────────────────┘
```

Princípios:

- **Rail de produções à esquerda (persistente).** Substitui a seção "Projetos em Produção". Cada item: ícone de estado + texto (não só cor), título, "etapa N/11", % e ETA. Clicar seleciona a produção, e as abas passam a mostrar aquela produção. Acaba o `scrollTo(top)`.
- **Abas por intenção**, não por componente:
  - **Criar**: briefing e configuração (seção 2.2).
  - **Produção ativa**: pipeline, progresso, pendências e ações (2.3).
  - **Revisão**: Roteiro/Storyboard, Mídia & Grounding, Voz, SFX/VFX (2.4).
  - **Auditoria**: Auditoria Editorial + Quality Gate + Release Gates (hoje Release Gates está solto ao lado do storyboard).
- **Console como dock inferior único**, com escopo "esta produção / todas" como filtro, e não dois componentes. O contador de erros e retries fica visível mesmo recolhido.
- **Benchmark** sai do formulário: vai para o menu ⚙ (Diagnóstico do ambiente) junto com o status de FFmpeg/provedores que hoje fica no hero.

### 2.2 Aba Criar: briefing primeiro, decisões em camadas

```
┌─ Briefing ──────────────────────────────────────────────┬─ Ideias ───────┐
│ Descreva o vídeo                                        │ Radar de       │
│ ┌─────────────────────────────────────────────────────┐ │ Tendências     │
│ │ PromptEditor (multilinha, chips de entidades)       │ │ (colapsado:    │
│ └─────────────────────────────────────────────────────┘ │  3 sugestões)  │
│ ✓ Detectado: Documentário · ~12 min · 16:9   [ajustar]  │ [Usar ideia]   │
│                                                         │ [Ver radar →]  │
│ Formato   ( YouTube 16:9 ) ( Shorts 9:16 )              │                │
│ Estilo    [Gameplay Essay][Documentário][Top List][Trailer]              │
│ Duração   [ 12 ] min   ↺ sincronizado com o briefing                     │
│ Humor     ──●────────── 35%  Sutil                                       │
│                                                                          │
│ ▸ Narração e idioma   Português (BR) · Voz "Narrador Grave"              │
│ ▸ Qualidade           Review 720p                                        │
│                                                                          │
│ Estimativa: ~25 min de produção · 2.4 GB VRAM                            │
│                                  [ ✦ Gerar direção e storyboard ]        │
└──────────────────────────────────────────────────────────────────────────┘
```

Mudanças:

1. **Briefing como protagonista**, usando o `PromptEditor.tsx` / `prompt-editor-model.ts` que já existem no diretório (não rastreados, de outra sessão; confirmar a origem antes de integrar).
2. **Interpretação do briefing antes de gerar**: a linha "Detectado: gênero · duração · formato" torna visível o que hoje é implícito (`durationSyncedFromPrompt`). O usuário corrige antes de gastar 25 minutos de pipeline.
3. **Formato e Estilo como segmented control / cards**, não `<select>`. São só 2 e 4 opções e são as decisões que mais mudam o resultado. O LUFS vai para um tooltip.
4. **Humor com rótulo semântico** (0 Desligado · 1–25 Sutil · 26–50 Pontual · 51–75 Marcante · 76–100 Comédia), além do número.
5. **Progressive disclosure** para Narração/Idioma e Qualidade: o resumo fica em uma linha e o detalhe abre ao clicar. A VRAM aparece na estimativa, não na opção. O ID da voz sai da UI (fica no tooltip/detalhe). O botão `↻` vira ícone Lucide `RefreshCw` com `aria-label`.
6. **Radar de Tendências como coluna lateral recolhível**, não um bloco acima do formulário. "Usar ideia" preenche o briefing e mostra um toast com "Desfazer".
7. **Um CTA**, sólido (cor primária do tema), sem gradiente; o loading fica no próprio botão, que se desabilita (já existe).
8. **Ao gerar**: navega para a aba "Produção ativa" da nova produção, que aparece no topo do rail.

### 2.3 Aba Produção ativa

```
Elden Ring — a história que ninguém contou        prod_8f2a · tentativa 2
● Rodando · Etapa 4 de 11: Roteiro         62%    Decorrido 14:02 · Restante ~8 min
████████████████████░░░░░░░░░░
 ✓ Prompt ✓ Interpretação ✓ Pesquisa ● Roteiro ○ Decupagem ○ Aquisição ○ Validação
 ○ Planejamento ○ Montagem ○ Prévia ○ Editor                       [Pausar] [Cancelar]

┌─ Agora ────────────────────────────────────────────────────────────────┐
│ Escrevendo bloco 3/7 do roteiro · última atividade há 4 s             │
│ (últimas 3 linhas do log desta etapa)               [abrir no console] │
└────────────────────────────────────────────────────────────────────────┘
┌─ ⚠ Precisa de você (3) ────────────────────────────────────────────────┐
│ Cena #4 · "boss fight Malenia" — nenhuma mídia válida                  │
│   [Importar mídia]  [Usar motion visual]                               │
│ …                                       [Usar motion visual em todas]  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Stepper com 11 etapas**, com ícone + texto por estado (✓ concluída, ● atual, ○ pendente, ✕ falhou, ⏸ pausada). Agrupar visualmente em 4 fases (Planejamento: Prompt→Decupagem; Mídia: Aquisição→Validação; Montagem: Planejamento→Prévia; Entrega: Editor) para reduzir a carga cognitiva.
- **Corrigir o "x/8"** para derivar de `PIPELINE_STAGES.length` (fonte única de verdade).
- **Bloco "Agora"**: o heartbeat da etapa (última atividade + 3 linhas de log). Responde "travou?" sem abrir o console.
- **"Precisa de você"** substitui o bloco âmbar dentro do form. "Autorizar Motion Visual para todas" vira uma ação secundária com confirmação, porque troca mídia real por procedural em lote.
- **Falha**: card vermelho com causa resumida, etapa que falhou, [Tentar novamente a partir desta etapa] e [Ver erro no console]. Hoje a falha só aparece como cor/mensagem.
- Botões Cancelar/Retomar com altura mínima de 32px (desktop) e texto ≥12px.

### 2.4 Aba Revisão

Sub-navegação lateral com 4 itens, cada um com indicador de saúde:

| Item | Conteúdo atual reaproveitado | Indicador |
|---|---|---|
| Roteiro & Storyboard | seção Narrativa & Storyboard + revisão em linguagem natural | nº de cenas |
| Mídia & Grounding | `MediaCoveragePanel` + Scene Grounding | % de cobertura, nº de cenas com baixa relevância |
| Voz | `VoiceDirectorPanel` (Voice Director, dicionário, prévia) | termos sem pronúncia |
| SFX / VFX | etapa SFX/VFX | aplicado / pendente |

Uma **matriz cena × qualidade** (linhas = cenas; colunas = mídia, grounding, narração, SFX) como visão de entrada. Clicar numa célula abre o detalhe. Com isso, Cobertura de Mídia, Scene Grounding e Auditoria deixam de ser três painéis que o usuário cruza de cabeça.

### 2.5 Console (dock)

Mantém tudo que já existe (abas Terminal/Eventos/Erros, busca, filtros, auto-scroll, exportação TXT/JSON, importação, detalhes expansíveis, histórico, contagem de erros/retries) e muda:

- **Um componente**, escopo por filtro ("Esta produção" padrão / "Todas"), e não um por card mais o Console Geral.
- **Filtros como chips ativos removíveis** acima da lista. Os 6 filtros ficam num popover "Filtros (2)".
- **Deep-link**: "abrir no console" vindo do bloco Agora ou de uma falha abre o dock já filtrado por etapa e nível.
- Fonte monoespaçada (Fira Code / JetBrains Mono do tema) com tamanho ≥12px; `aria-live="polite"` só para erros novos, não para cada linha.
- Importação JSON fica no menu "…" (é uma ação rara).

---

## 3. Sistema visual

- **Tokens, não hex**: trocar `#121220`, `#0d0d17`, `#1a102d` por tokens do tema (`bg-card`, `bg-muted`, `--surface-2`), o que habilita o tema claro.
- **Cor semântica de estado** (com ícone sempre junto): rodando = primária, pausado/aguardando = âmbar, falha = vermelho, concluído = verde, pendente = neutro.
- **Remover gradientes** do CTA e da barra. Manter no máximo um acento de marca no header. O gradiente roxo→âmbar repetido em hero, CTA e barra é o padrão "template IA" que o guia pede para evitar.
- **Escala tipográfica mínima**: 12px para metadados, 14px para corpo, 16px para títulos de seção. Eliminar `text-[10px]`.
- **Ícones**: só Lucide (já usado), nada de caracteres como ícone.
- **Movimento**: 150–250ms em transições de estado; `motion-safe:` em `animate-spin` e na barra.

---

## 4. Plano de implementação sugerido (incremental)

| Lote | Entrega | Risco | Arquivos principais |
|---|---|---|---|
| 1 — Correções rápidas | Fix "x/8"→`PIPELINE_STAGES.length`; labels reais em Render/Idioma/Voz; `↻`→`RefreshCw` + `aria-label`; tamanhos mínimos de texto/botão; ícone+texto nos estados; `motion-safe` | Baixo | `CinemaDirectorPanel.tsx` |
| 2 — Extração | Quebrar `CinemaDirectorPanel` (1.670 linhas) em `CreateTab`, `ActiveProductionTab`, `ReviewTab`, `ProductionRail`; estado do job selecionado num hook `useCinemaProduction` | Médio (refactor) | novo `cinema/` |
| 3 — Rail + abas | Rail de produções, abas por intenção, seleção sem `scrollTo` | Médio | `ProductionRail`, `CinemaDirectorPanel` |
| 4 — Criar | Interpretação visível, segmented controls, disclosure, Radar lateral, Benchmark → ⚙, `PromptEditor` | Médio | `CreateTab`, `TrendRadarPanel` |
| 5 — Produção ativa | Stepper agrupado, bloco Agora, Precisa de você, card de falha com retomada por etapa | Médio | `ActiveProductionTab` |
| 6 — Revisão + Console dock | Matriz cena × qualidade, sub-nav de revisão, console único com escopo | Alto | `ReviewTab`, `ProductionConsoleAccordion` |

Validação por lote: typecheck + testes existentes da feature + E2E Playwright do fluxo "briefing → produção → resolver mídia → editor", com locators por role/label (o lote 1 já melhora isso).

## 5. Fora do escopo / a confirmar

- `PromptEditor.tsx` e `prompt-editor-model.ts` estão não rastreados no git: vieram de outra sessão. Confirmar a origem antes de integrar no lote 4.
- O design system gerado pela skill sugeriu Fira Code/Fira Sans e um CTA vermelho "play". Adotar só a mono para logs/métricas; manter a cor primária atual do NeuralBridge para não quebrar a consistência com o resto do app.
