# Legendas e roteiro

## Estilos de legenda (template `overlay-talking-head`, campo `style`)

| style | Visual | Referência | Palavras/bloco |
|---|---|---|---|
| `destaque` | Branco 900, palavra falada fica na cor de destaque | V02 | 2–3 |
| `palavra` | Uma palavra gigante por vez, keywords coloridas | V01 | 1 |
| `caixa` | Palavra falada ganha caixa colorida | V05 | 2–3 |
| `mono` | Mono bold, keyword colorida (tech/bastidor) | V11, V04 | 3–4 |
| `glow` | Pequena, palavra falada com brilho amarelo | V15 | 3–5 |

**Campos úteis:**

- `keywords`: palavras sempre coloridas (produto, número, benefício)
- `capY`: altura da legenda (padrão 1180; use 940 em split-screen)
- `maxWords`: palavras por bloco

**Regras:**

- Um bloco quebra em pausa > 0,3s, em pontuação ou ao atingir `maxWords`.
- A legenda some na troca de bloco. Nunca deixe duas frases na tela.
- Corrija a transcrição antes de renderizar: nomes próprios, números e gírias.

## Roteiro: estrutura padrão de 30s

```
0.0  GANCHO   (headline topo + 1ª frase)       "Você acredita que esse vídeo foi editado 100% por IA?"
2.5  CONTEXTO (por que importa)                 "Eu não abri nenhum programa de edição."
6    PROVA 1  (insert de UI/B-roll)             "Foram 6 comandos…"
12   PROVA 2  (número animado / antes-depois)   "…e ele mesmo assistiu e corrigiu os erros"
20   VIRADA   (punch-in + frase forte)          "O editor agora é o roteiro."
25   CTA      (comenta PALAVRA + DM)            "Comenta MOTION que eu te mando o passo a passo"
30   LOOP     (última frase emenda na 1ª)
```

## Roteiro de kinetic explainer (template `kinetic-explainer`)

O JSON é uma lista de `beats`. Cada beat dura 1,8 a 3,2s.

```json
{ "theme":"t-claude-creme", "handle":"@seuperfil", "progress":false,
  "beats":[
   {"type":"text","dur":2.2,"kicker":"","lines":["Quanto eu *ganho*","só com IA?"]},
   {"type":"window","dur":2.6,"title":"terminal","typing":"> claude, gera o reel","caption":"Eu faço *3 vídeos* por dia."},
   {"type":"counter","dur":2.4,"label":"vídeos no mês","from":0,"to":90,"caption":"*90* vídeos no mês."},
   {"type":"price","dur":2.2,"caption":"Cada vídeo me custa…","value":"R$ 1,20"},
   {"type":"hub","dur":2.6,"items":6,"caption":"90 vídeos dão pra *6 clientes.*"},
   {"type":"chips","dur":2.4,"title":"Sem *limite*","items":["qualquer estilo","sem crédito"]},
   {"type":"list","dur":3,"title":"Ele faz sozinho:","items":["edita","legenda","corta na batida"]},
   {"type":"cta","dur":3.2,"lead":"quer o passo a passo?","word":"Comenta","keyword":"GUIA","reply":"te mando no direct"}
  ]}
```

**Duração do vídeo:** soma dos `dur`. Narração: ~2,5 palavras/s. Escreva **no máximo 6 palavras na tela por beat**.

## Copy que prende

- Frases curtas, verbo no começo e números concretos.
- Uma ideia por beat.
- Use "você", "eu" e "olha isso".
- Crie lacunas: "a segunda coisa é a mais importante…".
- No CTA, prometa algo específico ("o passo a passo", "o prompt", "o arquivo do projeto").
