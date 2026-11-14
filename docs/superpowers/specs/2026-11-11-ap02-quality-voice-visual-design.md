# AP-02 — QA, fundo visual reutilizado e voz natural

## Objetivo

Concluir a correção do trailer AP-02 sem adquirir ou baixar mídia nova, preservando o manifesto, a base de uso editorial e o estado do Rights Manager. O resultado deve melhorar a validação técnica, reduzir a aparência de voz sintética e substituir cartões pretos por imagens relacionadas sempre que houver mídia já aprovada para reutilização.

## Escopo aprovado

### 1. Reutilização visual restrita

- Usar somente arquivos locais que já foram baixados e já aparecem como mídia usada nos jogos do AP-02.
- Reutilizar somente os trechos/fontes já presentes no storyboard e no manifesto aceitos: Elden Ring e Silksong, mantendo seus intervalos e bases de uso.
- Para uma fala que hoje cai no fallback tipográfico, selecionar um quadro ou pequeno intervalo de uma fonte já usada, priorizando o mesmo jogo/assunto, aplicar escurecimento/contraste para manter a leitura e registrar a associação no plano/manifesta.
- Nunca usar mídia de outro jogo apenas para preencher espaço, buscar uma fonte nova, gerar uma imagem abstrata ou alterar o Rights Manager.
- Toda cena deve ter algum fundo visual: tela preta sólida fica proibida. Se não existir mídia já usada e semanticamente compatível, reutilizar o trecho já aprovado mais próximo dentro do AP-02, com tratamento visual neutro e registro explícito de que ele é apoio ilustrativo, não evidência específica da fala. Não gerar mídia nova nem inventar que o fundo representa o fato narrado.

### 2. FFmpeg completo no Quality Director

- Resolver um FFmpeg/FFprobe completo para a montagem final que precisa gravar legendas e para as medições do Quality Director.
- Manter o FFmpeg embutido do compositor apenas onde ele é necessário para a composição/segmentação do Remotion.
- A resolução deve respeitar executáveis configurados e PATH, registrar o nome/capacidades do engine e verificar filtros obrigatórios antes da execução.
- Loudness, clipping, silêncio, tela preta, congelamento e legendas devem ser medidos ou gravados pelo engine completo. Se uma capacidade obrigatória não estiver disponível, o relatório permanece bloqueado e explica a causa; nunca há aprovação silenciosa.

### 3. Voz e roteiro

- Reduzir o ritmo padrão da Voz C para uma velocidade natural, preservando a possibilidade de ajustes por cena e re-renderizando a narração do AP-02.
- Atualizar as instruções de roteiro e síntese para português brasileiro natural: manter acentos ortográficos, pontuação útil para pausas, números e siglas escritos como devem ser pronunciados e instruções explícitas de pronúncia PT-BR.
- Permitir humor leve, observacional e contextual quando combinar com o briefing, sem inventar fatos, sem alterar afirmações verificáveis e sem transformar o vídeo em paródia.
- O humor deve ser opt-in pelo tom/briefing ou por uma direção editorial explícita, não uma regra global aplicada a todo roteiro.

## Fora de escopo

- Download, aquisição ou descoberta de novas fontes.
- Mudança de `legalClearance`, gravação no Rights Manager ou alteração da política de direitos.
- Troca global de modelo de voz ou criação de um novo provedor.
- Implementação de fases futuras do plano ou mudanças não relacionadas ao AP-02.

## Alternativas consideradas

1. **Reutilizar fonte aceita e aplicar quadro/clipe sob o texto — escolhida.** Mantém rastreabilidade, respeita o pedido de não buscar mídia nova e evita associar uma fala a um jogo diferente.
2. **Gerar fundos abstratos para todas as falas sem mídia — rejeitada.** Evita o preto, mas introduz material visual novo e pode sugerir evidência que não existe.
3. **Adquirir novas cenas compatíveis — fora de escopo.** Exigiria nova análise de direitos e mudaria o limite aprovado para esta correção.

## Critérios de aceitação

- Teste unitário prova que a seleção de fundo só retorna mídia local já usada/aceita no AP-02 e não cruza jogos/assuntos sem compatibilidade.
- Teste de render prova que o segmento reutilizado conserva sua fonte, intervalo e base de uso no manifesto.
- Com FFmpeg completo disponível, legendas são gravadas no vídeo e o Quality Director registra medições de loudness e clipping em vez de `indisponível`.
- Sem um engine capaz, as checagens obrigatórias continuam bloqueadas com diagnóstico explícito.
- Testes de roteiro/síntese verificam regras de acentuação e pronúncia PT-BR, humor opcional e velocidade padrão mais natural da Voz C.
- Um novo render do AP-02 usa apenas os quatro trechos já aprovados, não contém nenhuma tela preta sólida, usa o trecho mais relacionado disponível como fundo visual e preserva direitos/manifesto.
- `docs/aethera/STATUS.md` registra comandos, resultados, limitações e qualquer bloqueio residual. Nada é commitado automaticamente.

## Sequência de implementação

1. Criar os testes de seleção visual, resolução/capacidade do FFmpeg e contrato de voz/roteiro.
2. Implementar o plano visual de reutilização com rastreabilidade de fonte e intervalo.
3. Separar o engine completo de QA/legendas do compositor embutido.
4. Ajustar prompt/preset da Voz C, regenerar a narração e renderizar o AP-02.
5. Rodar FFprobe, Quality Director, manifesto, comparação de quadros e verificações de direitos.
6. Atualizar o STATUS com evidências e reportar bloqueios que dependam de dados ainda não disponíveis.

