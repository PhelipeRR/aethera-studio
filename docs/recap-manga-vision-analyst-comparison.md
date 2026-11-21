# Comparação Real — Pipeline Atual vs Manga Vision Analyst Skill (Nano Machine Cap. 01)

- **Data:** 2026-11-21T22:00:55.540Z
- **Skill:** `aethera-manga-vision-analyst` v1.0.0 (schema v1)
- **Provedor multimodal usado (último trace):** `antigravity` (agy-cli)
- **Painéis reais analisados:** 6 (nano-machine-cap-01_p0_0, nano-machine-cap-01_p0_1, nano-machine-cap-01_p0_2, nano-machine-cap-01_p1_0, nano-machine-cap-01_p1_1, nano-machine-cap-01_p1_2)

## Tabela Comparativa (Antes vs Depois)

| Métrica | Antes (Pipeline Atual) | Depois (Manga Vision Analyst) |
|---|---:|---:|
| Painéis cobertos | 6/6 | 6/6 |
| Cenas geradas (`natural_recap`) | 2 | 2 |
| Palavras no roteiro final | 105 | 123 |
| Falas/balões extraídos (total / substantivos) | 5 / 4 | 4 / 3 |
| Identificadores de personagens | 1 (Jovem de cabelos escuros em túnica clara com faixa roxa) | 1 (Jovem desconhecido em fuga) |
| Confiança média | 0.918 | 0.913 |
| Jargões cinematográficos nas análises | 10 | 0 |
| Jargões cinematográficos no roteiro | 0 | 0 |
| Traços repetitivos de roupa/cabelo (análises / roteiro) | 8 / 1 | 0 / 0 |
| Gate G | `pass` | `pass` |
| Manga Vision Quality Gate | n/a | `pass` (bloqueia produção: `false`) |

## Evidências por Painel (Antes vs Depois)

### nano-machine-cap-01_p0_0
- **Antes:** Plano geral vertical de ambientação noturna mostrando uma cadeia de montanhas íngremes e rochosas em camadas, cobertas por silhuetas de árvores e envoltas por densa névoa nos vales. No topo, um céu escuro e nublado exibe uma pequena lua cheia brilhante à direita e diversos pontos claros dispersos no ar. No primeiro plano inferior direito, galhos e folhas escuros aparecem em silhueta contra a névoa clara ao fundo. Não há personagens nem balões de texto visíveis.
  - *Personagens:* nenhum | *Falas:* nenhuma | *Confiança:* 0.95
- **Depois:** À noite, uma cadeia de montanhas íngremes permanece envolta em névoa densa sob um céu escuro, nublado e iluminado pela lua cheia. O silêncio domina os picos sombrios e os galhos escuros que despontam em meio ao nevoeiro, criando um clima tenso e misterioso antes do início da ação.
  - *Personagens:* nenhum | *Falas:* nenhuma | *Confiança:* 0.94
  - *Continuidade:* anterior="-" | próximo="Estabelece o ambiente noturno, isolado e montanhoso que antecede os eventos dos próximos painéis."

### nano-machine-cap-01_p0_1
- **Antes:** Em plano geral visto de cima (plongée), um jovem de cabelos escuros desalinhados corre descalço e apressadamente por um terreno rochoso e irregular em meio a uma floresta montanhosa à noite. Ele veste uma túnica e calças tradicionais claras com detalhes e faixa roxa na cintura, apresentando pequenos rasgos e marcas de sujeira. Seu corpo está inclinado para a frente com os braços abertos para equilíbrio e os cabelos esvoaçando para trás, projetando uma sombra no chão sob a luz azulada noturna. Galhos e folhagens escuras em silhueta emolduram toda a cena nas bordas da imagem.
  - *Personagens:* Jovem de cabelos escuros em túnica clara com faixa roxa | *Falas:* nenhuma | *Confiança:* 0.9
- **Depois:** Em meio à mata escura da montanha durante a noite, um jovem descalço e com as roupas desgastadas corre apressadamente por um terreno irregular cercado por galhos e folhagens densas. Inclinado para a frente e com os braços abertos para manter o equilíbrio, ele avança em fuga urgente enquanto o rosto permanece oculto pelos cabelos revoltos e pelas sombras.
  - *Personagens:* Jovem desconhecido em fuga | *Falas:* nenhuma | *Confiança:* 0.91
  - *Continuidade:* anterior="Dá continuidade direta ao ambiente noturno e silencioso das montanhas envoltas em névoa e galhos escuros mostrado anteriormente, quebrando a calmaria ao revelar alguém correndo apressadamente pela mata." | próximo="Prepara a continuação da perseguição ou fuga na floresta noturna, criando expectativa sobre o motivo da corrida, um possível perseguidor ou algum obstáculo à frente no caminho."

### nano-machine-cap-01_p0_2
- **Antes:** Em plano médio frontal, o jovem de cabelos escuros desalinhados corre em alta velocidade em direção ao observador, com o corpo inclinado para a frente e os cabelos esvoaçando para trás. Sua túnica clara com gola e faixa roxo-acinzentadas está rasgada nos ombros e nas mangas, revelando arranhões, sujeira e marcas de ferimentos nos braços, no peito e no rosto. Ele tem olhos arregalados com pupilas contraídas, sobrancelhas franzidas, gotas de suor escorrendo pelo rosto e a boca aberta em uma expressão intensa e ofegante. O fundo escuro em tons cinza-esverdeados está completamente borrado e coberto por linhas de velocidade radiais que reforçam a corrida apressada.
  - *Personagens:* Jovem de cabelos escuros em túnica clara com faixa roxa | *Falas:* nenhuma | *Confiança:* 0.92
- **Depois:** O jovem desconhecido continua correndo em desespero e em alta velocidade para frente, ofegante, suado e marcado por arranhões, com as vestes rasgadas pelo desgaste da fuga.
  - *Personagens:* Jovem desconhecido em fuga | *Falas:* nenhuma | *Confiança:* 0.92
  - *Continuidade:* anterior="Continua imediatamente a corrida do jovem pela mata escura da montanha, evidenciando o desgaste físico, o suor, os ferimentos leves e o desespero enquanto ele mantém o ritmo acelerado da fuga." | próximo="Sustenta a urgência da fuga em andamento e prepara o desdobramento imediato do que o jovem encontrará adiante ou do que o persegue."

### nano-machine-cap-01_p1_0
- **Antes:** Em plano detalhe próximo ao chão escuro de uma floresta, um pé descalço atinge e se enrosca em uma raiz grossa de árvore que atravessa o solo, gerando um rastro branco de movimento/impacto e espalhando pequenos fragmentos de terra e detritos pelo ar. Folhagens e galhos em tons escuros azulados aparecem à esquerda sobre o chão cinza-azulado, enquanto a onomatopeia coreana '툭!' destaca-se no canto inferior direito.
  - *Personagens:* Jovem de cabelos escuros em túnica clara com faixa roxa | *Falas:* [sfx] "Tum!" | *Confiança:* 0.88
- **Depois:** Durante a fuga pela mata escura, o pé descalço do jovem desconhecido enrosca e tropeça com força em uma raiz grossa de árvore exposta no chão, levantando terra e interrompendo bruscamente sua corrida.
  - *Personagens:* Jovem desconhecido em fuga | *Falas:* [sfx] "Tuc!" | *Confiança:* 0.88
  - *Continuidade:* anterior="Interrompe subitamente a corrida desesperada do jovem desconhecido mostrada no painel anterior, evidenciando o instante em que seu pé descalço fica preso em uma raiz." | próximo="Prepara a iminente perda de equilíbrio ou queda do jovem durante a fuga no momento seguinte."

### nano-machine-cap-01_p1_1
- **Antes:** Em plano superfechado no rosto do jovem de cabelos escuros, seu olho esquerdo aparece bem aberto com a íris roxa contraída em choque, sobrancelha fortemente franzida e uma gota de suor escorrendo pela bochecha. Mechas de cabelo escuro se agitam junto a linhas verticais de velocidade e desfoque que cruzam o quadro, sugerindo uma queda ou movimento brusco. No canto superior esquerdo, sobrepondo a borda do painel, há um balão branco pontiagudo contendo três pontos de exclamação.
  - *Personagens:* Jovem de cabelos escuros em túnica clara com faixa roxa | *Falas:* [dialogue] "!!!" | *Confiança:* 0.94
- **Depois:** O jovem desconhecido em fuga arregala o olho em choque ao perder o equilíbrio após o tropeço, suando frio enquanto é puxado bruscamente para baixo.
  - *Personagens:* Jovem desconhecido em fuga | *Falas:* [dialogue:Jovem desconhecido em fuga] "!!!" | *Confiança:* 0.9
  - *Continuidade:* anterior="Mostra a reação imediata de choque do jovem desconhecido logo após enroscar o pé e tropeçar com força na raiz durante a fuga pela mata." | próximo="Antecipa o impacto ou a queda iminente causada pela perda brusca de equilíbrio."

### nano-machine-cap-01_p1_2
- **Antes:** Em um painel vertical longo de sequência de movimento em ambiente noturno, o jovem de cabelos escuros em túnica clara com faixa roxa, descalço, despenca de um penhasco rochoso em três estágios conectados por rastros luminosos de movimento. No topo, ele escorrega e cai de cabeça pela borda coberta de grama e detritos, com os braços estendidos e os pés no ar enquanto grita. No meio do paredão íngreme, seu corpo se choca contra a rocha, quicando com pernas e braços agitados em meio a poeira e estilhaços. Na base, ele aterrissa pesadamente no chão com o corpo estirado e contorcido, cabelos espalhados e cercado por densas nuvens de poeira e folhas levantadas pelo impacto.
  - *Personagens:* Jovem de cabelos escuros em túnica clara com faixa roxa | *Falas:* [dialogue] "AAARGH...!!"; [dialogue] "ARGH!!!"; [dialogue] "AARGH!!!" | *Confiança:* 0.92
- **Depois:** O jovem desconhecido em fuga despenca da borda do penhasco de cabeça para baixo, gritando de dor e pânico enquanto tenta em vão se segurar. Durante a queda pelo paredão rochoso, ele bate com força contra a encosta, levanta poeira e folhas e continua rolando descontrolado até se esborrachar no chão lá embaixo, soltando novos gritos de dor ao atingir o solo.
  - *Personagens:* Jovem desconhecido em fuga | *Falas:* [dialogue:Jovem desconhecido em fuga] "AAARGH...!!"; [dialogue:Jovem desconhecido em fuga] "ARGH!!!" | *Confiança:* 0.93
  - *Continuidade:* anterior="Continua imediatamente o momento anterior em que o jovem perdeu o equilíbrio ao tropeçar e foi puxado para baixo, mostrando agora a consequência direta: ele despenca do penhasco, bate contra a encosta rochosa e atinge o chão lá embaixo." | próximo="-"

## Consolidação por Sequência (Nova Skill)

- **seq_001** (nano-machine-cap-01_p0_0, nano-machine-cap-01_p0_1, nano-machine-cap-01_p0_2, nano-machine-cap-01_p1_0): À noite, uma cadeia de montanhas íngremes permanece envolta em névoa densa sob um céu escuro, nublado e iluminado pela lua cheia, em meio à mata escura da montanha durante a noite, um jovem descalço e com as roupas desgastadas corre apressadamente por um terreno irregular cercado por galhos e folhagens densas, o jovem desconhecido continua correndo em desespero e em alta velocidade para frente, ofegante, suado e marcado por arranhões, com as vestes rasgadas pelo desgaste da fuga e durante a fuga pela mata escura, o pé descalço do jovem desconhecido enrosca e tropeça com força em uma raiz grossa de árvore exposta no chão, levantando terra e interrompendo bruscamente sua corrida.
- **seq_002** (nano-machine-cap-01_p1_1, nano-machine-cap-01_p1_2): O jovem desconhecido em fuga arregala o olho em choque ao perder o equilíbrio após o tropeço, suando frio enquanto é puxado bruscamente para baixo. Em seguida, o jovem desconhecido em fuga despenca da borda do penhasco de cabeça para baixo, gritando de dor e pânico enquanto tenta em vão se segurar.

## Roteiro Final (`natural_recap`) — Antes vs Depois

### Antes
- **nano-machine-cap-01_scene_0000** (nano-machine-cap-01_p0_0, nano-machine-cap-01_p0_1, nano-machine-cap-01_p0_2, nano-machine-cap-01_p1_0): A história começa quando uma cadeia de montanhas íngremes e rochosas em camadas, cobertas por silhuetas de árvores e envoltas por densa névoa nos vales. Folhagens e galhos em tons escuros azulados aparecem à esquerda sobre o chão cinza-azulado, enquanto a onomatopeia coreana '툭!' destaca-se.
- **nano-machine-cap-01_scene_0001** (nano-machine-cap-01_p1_1, nano-machine-cap-01_p1_2): Logo depois, no rosto do jovem de cabelos escuros, seu olho esquerdo aparece bem aberto com a íris roxa contraída em choque, sobrancelha fortemente franzida e uma gota de suor escorrendo pela bochecha. Na base, ele aterrissa pesadamente no chão com o corpo estirado e contorcido, cabelos espalhados e cercado por densas nuvens de poeira e folhas levantadas pelo impacto.

### Depois (Manga Vision Analyst)
- **nano-machine-cap-01_scene_0000** (nano-machine-cap-01_p0_0, nano-machine-cap-01_p0_1, nano-machine-cap-01_p0_2, nano-machine-cap-01_p1_0): A história começa quando à noite, uma cadeia de montanhas íngremes permanece envolta em névoa densa sob um céu escuro, nublado e iluminado pela lua cheia. Durante a fuga pela mata escura, o pé descalço do jovem desconhecido enrosca e tropeça com força em uma raiz grossa de árvore exposta no chão, levantando terra e interrompendo bruscamente sua corrida.
- **nano-machine-cap-01_scene_0001** (nano-machine-cap-01_p1_1, nano-machine-cap-01_p1_2): Nesse momento, o jovem desconhecido em fuga arregala o olho em choque ao perder o equilíbrio após o tropeço, suando frio enquanto é puxado bruscamente para baixo. Durante a queda pelo paredão rochoso, ele bate com força contra a encosta, levanta poeira e folhas e continua rolando descontrolado até se esborrachar no chão lá embaixo, soltando novos gritos de dor ao atingir o solo.

## Manga Vision Quality Gate

- **Veredito:** `pass` — Análise aprovada: 6/6 painéis cobertos (confiança média 0.91).
