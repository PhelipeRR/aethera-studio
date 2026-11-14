# Aethera — Plano de redesign alinhado ao Singularity (substitui a AET-03 violeta)

Status: **concluído em 2026-11-10 (plano, marca, implementação e validação).** R0 a R8 concluídos no commit `56032f3`.

A AET-03 violeta (escopo `.aethera` com paleta própria, íris violeta, cabeçalho grande) foi **recusada**: ela continua
só na cópia de trabalho histórica; o lote R0 removeu essa direção antes da implementação aprovada.

## 1. Auditoria

### 1.1 Estrutura atual da tela (`features/video/VelixPage.tsx`)

| Bloco | Hoje | Problema |
|---|---|---|
| Cabeçalho | rótulo, título, descrição, seletor de projeto, 4 "etapas" | Alto demais; as etapas são só atalhos para 4 das 9 abas |
| Etapas (Descobrir, Planejar, Aprovar, Finalizar) | `FLOW_STEPS` → abas `descobrir`, `ideias`, `produzir`, `estudio` | Duplicam as abas e não refletem estado nenhum |
| Limites (`VelixLimits`) | aviso do Claude + seletor "Agente das novas produções" + "Atualizar limite" | Ocupa uma faixa inteira; só fala do Claude |
| Abas (9) | Descobrir, Ideias, Produzir, Novo vídeo, Estúdio, Motion, Canal, Render direto, Importar vídeo | "Novo vídeo" é uma ação, não uma área; sem ícones; sem ordem de trabalho |
| Novo vídeo (`ChatBrief`) | tipo, nicho (chips), formato, estilo (galeria), duração, extras, nome, referências | Grupos sem hierarquia; nicho com chips soltos; ficha ao lado sem relação visual |
| Ficha do vídeo | painel à direita com o resumo | Não acompanha a rolagem; parece um card solto |

### 1.2 Dados reais disponíveis (sem inventar nada)

| Necessidade | Fonte existente |
|---|---|
| Fase do fluxo | `video.productionRunList(projectId)` e `productionRunState(runId)`: status da produção e de cada etapa (`briefing`, `research`, `script`, `storyboard`, `narration`, `sync`, `composition`, `render`, `quality`, `export`) e aprovações |
| Status dos agentes | `agents.status()`: instalado, versão, autenticado, avisos, problemas (Claude e Codex) |
| Uso do Claude | `video.limits()`: disponível/bloqueado, janelas de uso com percentual e renovação |
| Uso do Codex | **não há fonte**: o painel diz "uso não informado pela CLI" |
| Agente das novas produções | preferência existente (`velixAgent`), já usada pelo seletor atual |

### 1.3 O que reutilizar do Design System do Singularity

Tokens (`--background` petróleo, `--primary` dourado, vidro, elevação, `--tracking-display`), Inter, `PageHeader`
(rótulo do grupo + título fino), `GlassPanel`, `SectionLabel`, `StatusDot`, `Chip`, `MeterBar`, `StatCard`,
`ActivityList`, `FeedbackState` (vazio, carregando, erro), `Button`, `Field`, `RadioGroup`, `Tooltip`, foco visível,
`motion` com `prefers-reduced-motion`. **Nenhum token novo de cor**: o Aethera usa a paleta do Singularity; o que muda é
o símbolo, a assinatura e a composição cinematográfica.

## 2. Marca (proposta para aprovação)

Prévia: `docs/aethera/brand/aethera-brand-preview.png` (gerada por `build-brand.mjs`; SVGs na mesma pasta).

- **Símbolo**: abertura de lente que é também um eclipse. Seis lâminas douradas (com a luz nas bordas) formam um
  hexágono negro no centro, o mesmo preto do horizonte do Void. Na borda superior direita, a "conta de diamante" do
  eclipse, o último ponto de luz, no mesmo lugar onde o disco do Void brilha mais. Lente, eclipse e cinema numa forma,
  parente do símbolo do Singularity sem copiá-lo.
- **Tamanhos pequenos**: até 24 px as lâminas somem e ficam anel dourado, núcleo e ponto de luz; 16 px continua
  legível. Versão monocromática dourada para menus e bandeja.
- **Assinatura**: símbolo + "AETHERA" com o mesmo espaçamento largo e peso leve do "SINGULARITY" e a linha "AI
  CINEMATIC STUDIO" em dourado, como "AI ORCHESTRATOR". Uma família só (Inter).
- **Ícone do menu lateral**: o símbolo pequeno no lugar do ícone genérico de filme.

## 3. Estrutura proposta

```
┌ Aethera ─────────────────────────────────────────────────────────────────────────────┐
│ [símbolo] AETHERA            Produção audiovisual com IA,       Projeto [select ▾]     │  ← cabeçalho compacto (≈96 px)
│           AI CINEMATIC STUDIO do roteiro ao render final.                               │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ Fluxo da produção "Tema X":  ● Descobrir ─── ● Planejar ─── ◐ Aprovar ─── ○ Finalizar │  ← indicador ligado ao estado
│                              concluído      concluído     aguardando você  pendente    │     (a fase atual tem ação)
├───────────────────────────────────────────────┬──────────────────────────────────────┤
│ Comece uma produção          [Novo vídeo]     │ Agentes de produção                   │  ← ação principal + agentes
│ (ou: retomar "Tema X")       [Usar template]  │ ● Claude  pronto · uso 34% (5 h)      │     (dados reais)
│                                                │ ○ Codex   não instalado               │
│                                                │ Novas produções usam: [Claude ▾]      │
├───────────────────────────────────────────────┴──────────────────────────────────────┤
│ Áreas:  Descobrir  Ideias  Produzir  Estúdio  Motion  Canal  Render direto  Importar  │  ← uma navegação só
├──────────────────────────────────────────────────────┬───────────────────────────────┤
│ Conteúdo da área (ex.: Novo vídeo, em etapas)         │ Ficha do vídeo (fixa ao rolar) │  ← painel contextual
└──────────────────────────────────────────────────────┴───────────────────────────────┘
```

- **Fluxo** deixa de ser navegação duplicada: mostra a fase real da produção ativa (ou "nenhuma produção ativa"), cada
  fase com estado (pendente, em andamento, aguardando você, concluída, falhou). Só a fase atual tem um botão, e ele leva
  à ação certa ("Aprovar roteiro", "Ver render"). Mapeamento: Descobrir = briefing + pesquisa; Planejar = roteiro +
  storyboard; Aprovar = aprovações pendentes; Finalizar = narração, sincronização, composição, render, qualidade e
  exportação.
- **Navegação única**: as 8 áreas em abas com ícone; "Novo vídeo" vira a ação principal (e o atalho do Chat continua
  abrindo o formulário). Nenhuma área some; nenhuma opção fica escondida sem alternativa acessível.
- **"Usar template"** abre a galeria de modelos que já existe (Motion/estilos) — tem ação real.
- **Painel de agentes**: compacto, com Claude e Codex lado a lado; nada estimado; sem uso do Codex quando a CLI não informa.
- **Ficha do vídeo**: painel contextual fixo ao rolar (em telas largas) ou recolhível abaixo do formulário (estreitas).
- **Formulário Novo vídeo**: em blocos com título (Tema e nicho, Formato e estilo, Duração e extras, Nome e
  referências), nicho com busca e chips agrupados, formatos com prévia de proporção (16:9, 9:16, 1:1), estilos na galeria
  existente, duração com opções claras. Mesmas regras de validação de hoje.
- **Imagens cinematográficas**: substituído pela seção 3.1 (o usuário pediu a tela igual à referência, com as imagens).

### 3.1 Referência visual obrigatória (pedido do usuário em 2026-11-09)

Referência: `docs/assets/aethera/reference-aethera-screen.webp`. A tela deve ficar igual a ela, inclusive fundo,
imagens e layout dos cards. As imagens foram extraídas da própria referência para
`apps/desktop/src/renderer/src/assets/aethera/` (webp com transparência nas bordas):

| Arquivo | Onde | Recorte da referência |
|---|---|---|
| `eclipse-horizon.webp` (700×130) | fundo do cabeçalho, à direita, atrás da descrição e acima dos cards de fluxo | planeta com a borda do eclipse; esquerda esmaecida |
| `director-chair.webp` (300×202) | lado esquerdo do card "Comece uma produção" | cadeira de diretor com o símbolo; direita esmaecida |
| `ai-chip.webp` (192×180) | lado direito do card "Agente de produção" | chip "AI" verde-água; esquerda esmaecida |

As imagens estão em 1× (vêm de uma captura de tela); em telas HiDPI ficam um pouco suaves. Se houver originais em
resolução maior, basta trocar os arquivos.

Layout dos cards (igual à referência, com os dados reais):

1. **Cabeçalho** sem card: símbolo dourado grande + AETHERA / AI CINEMATIC STUDIO, divisor vertical, descrição em duas
   linhas; o planeta ocupa o fundo à direita. O seletor de projeto fica no cabeçalho, alinhado à direita (não aparece na
   referência, mas não pode sumir).
2. **Fluxo**: 4 cards de vidro lado a lado, ícone dourado de linha + título + subtítulo (Descobrir "Fontes, pesquisa e
   referências"; Planejar "Ideias, roteiro e cenas"; Aprovar "Brief, revisão e ajustes"; Finalizar "Composição, render e
   exportação"). O estado real da produção ativa entra no card (borda/ícone/estado), sem mudar a forma.
3. **Linha de ação**: card largo "NOVO PROJETO · Comece uma produção" com a cadeira à esquerda, texto, "+ Novo vídeo"
   (dourado) e "Usar template" (contorno); ao lado, card "Agente de produção" com ícone de robô, seletor do agente, texto
   de responsabilidade, "Atualizar limite" e o chip à direita. Status real do Claude/Codex como linha discreta no card.
4. **Abas** numa barra de vidro, com ícone; a ativa com contorno dourado: Descobrir, Ideias, Produzir, Estúdio, Motion,
   Canal, Render direto, Importar vídeo.
5. **Conteúdo** em card ("Novo vídeo" com ícone de filme; "Tipo de vídeo" em botões com ícone; "Nicho" com busca e chips
   e "+ Sugerir temas") e, à direita, card "Ficha do vídeo" com ícone de informação, lápis de edição e linhas
   chave/valor alinhadas à direita.

Símbolo: o R1 foi ajustado à referência (lâminas douradas em espiral, cunhas escuras entre elas, centro escuro grande,
anel fino). O lápis da Ficha só aparece se tiver ação (rolar/focar o formulário).

## 4. Responsividade e acessibilidade

- **1080p**: duas colunas (conteúdo + ficha), fluxo em uma linha.
- **Ultrawide**: largura máxima maior com a ficha e o painel de agentes ganhando espaço; texto nunca acima de ~80
  caracteres por linha.
- **Janelas menores**: fluxo vira uma lista compacta; agentes abaixo da ação principal; ficha recolhível.
- **Teclado**: abas com setas (como hoje); fluxo com a ação da fase atual focável; ordem de leitura igual à visual.
- **Movimento reduzido**: sem animação de entrada; só a confirmação de ação (mudança de fase) anima, e some com reduce.

## 5. Lotes (pequenos, verificáveis, cada um com aprovação)

| Lote | Escopo | Telas | Testes de regressão |
|---|---|---|---|
| **R0** ✅ | Remover a AET-03 violeta da cópia de trabalho (CSS `.aethera`, `AetheraMark`, splash, `ProductionBoard`, ajustes de testes); voltar ao estado do commit `3d0d9ab` | Aethera | Velix E2E, visual do Velix |
| **R1** ✅ | Marca: símbolo (completo, pequeno, mono) como componente; ícone do menu; assinatura | Menu, cabeçalho | Unidade (renderização em 3 tamanhos), visual |
| **R2** ✅ | Cabeçalho da referência (símbolo, divisor, descrição, planeta ao fundo, céu estrelado em CSS) + seletor de projeto | Aethera | E2E do Velix (cabeçalho), acessibilidade, visual 3 larguras |
| **R3** ✅ | 4 cards de fluxo da referência ligados ao estado (função pura de mapeamento etapa → fase + componente) | Aethera | Unidade do mapeamento (todos os status), E2E com produção real (fake agents) |
| **R4** ✅ | Card "Comece uma produção" com a cadeira ("Novo vídeo", "Usar template") + barra de abas com ícone | Aethera | E2E de todas as abas e do atalho do Chat (`/video`), teclado |
| **R5** ✅ | Card "Agente de produção" com o chip (seletor, "Atualizar limite", status real Claude/Codex, uso do Claude) | Aethera | Unidade com status reais/ausentes, E2E com CLI instalada e ausente |
| **R6** ✅ | Cards "Novo vídeo" e "Ficha do vídeo" no layout da referência | Novo vídeo | E2E de criação de vídeo existentes, validação, teclado, visual |
| **R7** ✅ | Responsividade (1080p, ultrawide, estreita) e movimento reduzido | Aethera | Visual 4 larguras, varredura de acessibilidade, reduced motion |
| **R8** ✅ | Regressão completa e documentação | — | Vitest, E2E completo, instalador se aplicável |

Regras em todos os lotes: sem mudar regras de negócio, contratos, persistência, produção, render ou integrações; sem
remover funcionalidades; sem botão sem ação; sem dados inventados; sem commit ou push sem autorização; sem iniciar
o próximo lote sem autorização.
