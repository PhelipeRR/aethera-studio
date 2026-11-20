# Estilos visuais (temas prontos)

Troque com `"theme": "t-..."` no JSON ou `<body class="t-...">`. Os tokens estão em `engine/mv.css`.

| Tema | Visual | Referência | Fontes indicadas | Bom para |
|---|---|---|---|---|
| `t-claude-creme` | Papel creme quente + preto + laranja #e8692d, janelas escuras | V12, V05 | Inter 900 + Mono | Explicar números, tutoriais "IA" |
| `t-dark-laranja` | Preto + glow terracota, serif elegante | V17 | Serif itálico + Mono | Branding premium, logo |
| `t-verde-terminal` | Preto + vinheta verde neon, código, chips ✓ | V07 | Inter 900 + Mono | Tech, automação, "skill" |
| `t-azul-profundo` | Azul-marinho com glow azul, arco de luz | V06, V16 | Inter 800 | SaaS, agência, anúncio |
| `t-roxo-neon` | Roxo neon, tarja roxa, condensada | V02, V14 | Anton + Inter 900 | Talking head, infoproduto |
| `t-vermelho-glow` | Preto + glow vermelho, serif itálico de acento | V03 | Inter 900 + Serif itálico | Oferta agressiva, web design |
| `t-bauhaus` | Creme, vermelho, azul royal, amarelo, preto | V10, V13 | Archivo Black + Anton + Serif | Showreel, design, criativo |
| `t-branco-estudio` | Branco/cinza claro + vermelho/amarelo | V01, V05 | Inter 900 | Tutorial, estúdio clean |
| `t-aurora` | Preto puro + gradientes holográficos azul/ciano/violeta | V19 | Inter 300 (fino) | Design system, premium Apple-like |

## Regras de tipografia (o que separa amador de profissional)

1. **Máximo 2 famílias por vídeo.** Faça uma combinação: pesada + acento (serif itálico ou mono). Exemplo: "PÁGINA GENÉRICA por *migalha.*" (V03).
2. **Headlines com tracking negativo** (-0,03 a -0,05em) e entrelinha curta (0,9–1,0).
3. **Uma cor de destaque só**, aplicada às palavras-chave. Nunca destaque mais de 1–2 palavras por frase.
4. **Kicker** (texto pequeno mono, espaçado, maiúsculo) acima da headline cria hierarquia: "DEIXA EU TE MOSTRAR / COMO FUNCIONA" (V07).
5. **Tamanhos mínimos em 1080px:** legenda 54px+, headline 100px+, número-herói 250px+.
6. **Tarja** (fundo colorido atrás do texto) para frases de impacto (V02, V14).
7. **Condensada** (Anton/Bebas) para frases longas em caixa alta (V02 "DÁ PRA PERCEBER?", V11 "6 COMANDOS.").

## Cor

- **Fundo escuro:** nunca use #000 chapado. Use gradiente radial com glow da cor de destaque + vinheta + grão (`.bg-glow`, `.grain`).
- **Fundo claro:** creme ou off-white com textura leve, nunca branco puro, exceto no estilo estúdio.
- **Marca do cliente:** troque só `--ac`, `--ac2` e `--glow`. Para paleta 100% da marca (V20), redefina `--bg` também.

## Como criar um tema novo

```css
.t-meucliente{--bg:#0d0b14;--bg2:#24123d;--fg:#fff;--mute:#a59bb8;--ac:#ff2e88;--ac2:#ffc2dc;--glow:rgba(255,46,136,.5);--card:#17121f}
```
