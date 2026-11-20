# Playbook viral MotionVelix

Regras tiradas das 21 referências (ver `07-analise-referencias.md`). Use como checklist antes de renderizar.

## 1. Os 3 primeiros segundos (o gancho)

- **O frame 0 nunca é vazio nem preto.** Todos os 21 vídeos já mostram texto, rosto ou movimento no primeiro frame. Nos templates, a 1ª animação começa em `at: -0.2…-0.35` para o frame 0 pegar o movimento no meio.
- **O som começa até 0,7s.** Em todos os 21 vídeos, o primeiro impacto de áudio cai entre 0,54 e 0,70s.
- **Headline grande no topo, na 1ª fala.** Em V02, V04, V11 e V14 o título do assunto entra junto com a primeira frase.
- Fórmulas de gancho que aparecem nas referências:
  - **Promessa + número:** "6 comandos. 1 vídeo." (V11) / "3 minutos" (V02) / "reels ilimitados" (V07)
  - **Pergunta de curiosidade:** "Quanto eu ganho só com IA?" (V12) / "Dá pra perceber?" (V02) / "Você acredita que esse vídeo…" (V11)
  - **Ordem/choque:** "PARE de vender página genérica por migalha." (V03)
  - **Prova:** "Esse anúncio foi 100% criado pelo Opus" (V06) / before→after (V15)
  - **Batalha:** "Qual o melhor? Claude vs GPT" (V14)
  - **POV / identidade:** "POV: você cria o vídeo de lançamento do app do McDonald's" (V20, V17)

## 2. Retenção (o miolo)

- **Algo muda na tela a cada 0,6–2,5s.** Showreels trocam a cada ~0,6s (V08, V10, V13). Vídeos falados trocam a cada 1,5–2,5s, com legenda, zoom, B-roll ou card.
- **Legenda palavra a palavra**, em blocos de 1 a 3 palavras, com a **palavra-chave em cor de destaque** (laranja, roxo, verde ou amarelo). Aparece em 15 das 21 referências.
- **Texto que constrói em camadas:** a linha anterior fica (ou esmaece) e a nova entra embaixo (V03, V07, V12).
- **Números sempre animados:** contador rolando, R$300→5.000, 0→1 milhão+, +56%→+248% (V03, V06, V07, V08, V12).
- **Estrutura em lista:** "a primeira coisa… a segunda coisa…" e "PASSO 1/2/3" (V05, V07). Isso cria um loop aberto na cabeça de quem assiste.
- **Interface como cenário:** janelas de terminal/código, chat da IA, timeline de edição e dashboards (V01, V02, V05, V07, V11, V12). Passa autoridade e mostra o "como".
- **Zoom/punch-in no rosto** nas palavras de ênfase (V11). Também vale o jump-zoom seco.
- **Fundo nunca estático:** glow que respira, deriva lenta, grão, parallax.
- **Alternar claro e escuro** entre cenas acorda o olho (V01, V19).
- **Ritmo de áudio:** a média é de ~3,4 impactos por segundo. Os cortes caem na batida (V11: "cada corte cai na batida").

## 3. O final (CTA + loop)

- **CTA de comentário com palavra-chave** + promessa de DM automática: "Comenta GUIA" (V12), "comenta EDIT IA" (V01), "Comenta CLAUDE" (V07), "comenta SITE" (V05). Mostre o campo de comentário sendo digitado e a resposta "DM enviada".
- **Loop perfeito:** o último frame volta ao primeiro (V02, V03, V04, V10, V12, V13, V17, V20, V21). Quem assiste vê duas vezes sem perceber, e o algoritmo conta como replay.
- Botão de CTA com **mão/cursor tocando** + setas para baixo (V03).

## 4. Zonas seguras 9:16 (1080x1920)

- **Topo 0–220px:** abas do Reels. Use só para HUD discreto.
- **Base 1500–1920px:** nome, legenda e botão "Saiba mais". Não coloque nada essencial ali.
- **Direita 940–1080px:** curtir, comentar e compartilhar.
- **Legenda falada:** y ≈ 1100–1250. **Headline:** y ≈ 240–520.

## 5. Duração

| Formato | Duração |
|---|---|
| Showreel / logo | 6–16s, com loop |
| Explainer motion | 15–40s |
| Talking head | 25–40s, chegando a 75s só com formato forte (V04, V14) |
| Anúncio | 15–35s |

## 6. Áudio

- Fala em -14 LUFS (`mv_edit.py exportar`). A trilha fica de 18 a 22 dB abaixo, com ducking (`mv_edit.py musica`).
- Use whoosh nas transições, pop nos cards e click na mão/cursor. O conector Magnific gera SFX (`audio_sfx_generate`) e trilha (`audio_music_generate`).
- Lyric/kinetic video (V16): cada palavra da letra vira um evento visual sincronizado. Use `mv_edit.py batidas`.
