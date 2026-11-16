# Aethera Studio — Home "Light Bento" e paleta do sistema

Data: 2026-11-16. Referência: print enviado pelo usuário (dashboard claro em blocos: aprovações, agenda, publicados, mix de formatos, produção automática).

## Análise (UI/UX Pro Max)

- Estilo: **Vibrant & Block-based** sobre base clara — blocos brancos `rounded-[28px]`, sem bordas, sobre cinza-claro; cor só nos blocos de destaque (lavanda, lima, rosa) e no CTA preto.
- Hierarquia: barra de status em linha única ("3 pra aprovar, 7 na fila…") + CTA preto à direita; grade de 3 colunas (fila · agenda · recentes) e uma linha inferior (mix de formatos · card rosa de automação).
- Tipografia: sans geométrica, títulos 20–22px semibold, metadados em chips com ponto (`• A2 • 16s`).
- Ícones: rail lateral só com ícones em botões quadrados arredondados, item ativo preto, badge lima com contador.
- Anti-padrões evitados: lavanda/lima como cor de texto sobre branco (contraste < 3:1). Texto sobre lavanda/lima/rosa é sempre `#111`.

## Paleta (tokens em `apps/aethera-desktop/src/renderer/src/aethera-theme.css`)

| Token | Valor | Uso |
|---|---|---|
| `--background` | `#ececee` | fundo do app |
| `--card` / `--popover` | `#ffffff` | blocos |
| `--secondary` / `--muted` | `#f4f4f6` | itens dentro de blocos, chips neutros |
| `--foreground` | `#111111` | texto |
| `--muted-foreground` | `#62626c` | texto secundário (≥ 5:1 no branco) |
| `--primary` | `#111111` | CTA e item ativo (texto branco) |
| `--brand-lavender` | `#b8a4f4` | destaque 1 (aprovação, dias agendados) |
| `--brand-lime` | `#d8fb4f` | destaque 2 (hoje, badge, sucesso) |
| `--brand-pink` | `#f9a8d4` | destaque 3 (produção automática) |
| `--chip-blue-*` / `--chip-violet-*` | `#e2ecff/#2f5fd0`, `#efe8ff/#6a46d8` | chips de status/motor |

## Implementação

1. Tokens claros no tema `aethera` + remapeamento das cores escuras fixas (`bg-[#0d0d17]` etc.) para tokens e dos tons `text-*-300` para tons legíveis no claro.
2. Shell: header e sidebar claros, item ativo preto, logo e badges na nova paleta.
3. Home reconstruída em bento: status + CTA, "Pra aprovar" (projetos aguardando revisão), "Agenda" (calendário do mês com dias de projetos), "Projetos recentes", "Mix de status", card rosa "Produção automática" com atalhos.
4. Dados reais apenas (projetos, dashboards, canais); sem números inventados — vazios mostram estado vazio.
5. Validação: typecheck, testes do desktop-shared que tocam a home, screenshot do app.

## Validação (2026-11-16)

- `npx tsc -p apps/aethera-desktop/tsconfig.web.json --noEmit` — OK.
- `npm run build` (apps/aethera-desktop) + `npx playwright test tests/e2e/aethera-home-bento.spec.ts` — 1 passed; sem overflow horizontal em 1440px.
- Screenshots em `docs/aethera/screenshots/home/` (home vazia, com projetos, 1024px, Produção com IA e Revisão no tema claro).
- Pendência: telas antigas ainda usam literais escuros/gradientes que agora são remapeados por CSS no tema; migrar cada tela para tokens quando for tocada.
