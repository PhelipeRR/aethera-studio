# Aethera Studio CS10 — Semantic Scene Gate e Composição Cinematográfica

## Intenção

Estender o Character Composition Gate criado no commit `1f19706` para que uma
imagem gerada seja avaliada não apenas pela contagem de personagens, mas pela
fidelidade verificável ao prompt e pela qualidade da composição. O gate continua
sendo um mecanismo de triagem e recuperação; `passed_pending_human_review`
nunca equivale à aprovação final.

## Metas

- Validar, com evidência local, personagens, descrições individuais, objetos,
  roupas, acessórios, poses, ações e cenário exigidos pelo prompt.
- Reutilizar os adapters e modelos locais já presentes no projeto, sem baixar
  pesos, instalar dependências ou criar um segundo pipeline.
- Detectar e registrar personagens translúcidos/fantasmas, duplicados,
  incompletos ou visualmente fundidos quando houver evidência objetiva.
- Medir composição em camadas: separação, perspectiva, iluminação, sombras de
  contato, aterramento e integração com o cenário.
- Corrigir somente uma região quando o defeito tiver bbox acionável, preservando
  o restante da imagem e a identidade individual.
- Manter seeds, prompts, parâmetros, evidência dos detectores e todas as
  imagens rejeitadas em armazenamento auditável.
- Gerar comparações reais para 2, 3 e 8 personagens, contact sheet e relatório
  JSON para revisão visual humana.

## Não metas

- Não substituir a revisão humana por um score automático.
- Não inferir que um objeto está ausente apenas porque um modelo local não o
  detectou.
- Não penalizar a ausência de um objeto, roupa, ação ou cenário que não foi
  exigido pelo prompt.
- Não adicionar modelos anime, LoRAs ou dependências externas nesta fase.
- Não habilitar photobombing, nem fazer commit/push/merge automaticamente.
- Não regenerar a imagem inteira quando uma correção regional for segura.

## Critério de evidência

O prompt é a fonte da expectativa. A receita existente fornece o prompt global,
o prompt de cenário e um prompt por região/personagem. O gate transforma esses
campos em critérios rastreáveis e avalia crops regionais e a cena completa com o
adapter local existente.

- Evidência positiva suficiente registra `confirmed` para o critério.
- Evidência ambígua, detector indisponível ou score inconclusivo registra
  `uncertain` e gera `needs_review`.
- Contradição comprovada por evidência local independente, ou defeito objetivo
  (ex.: máscara fantasma, bbox vazio, fusão inequívoca), registra `failed` e
  pode gerar `rejected`.
- `failed` é diferente de “não encontrado”: ausência de detecção isolada nunca
  é prova de ausência.

## Abordagens consideradas

1. **Gate integrado ao runner (escolhida).** Um novo contrato de Semantic Scene
   Gate é executado depois do Character Composition Gate, reutilizando o
   `ExternalImageAdapter`, o detector local, o inspector de qualidade e
   `inpaintRegion`. O runner registra os três eixos (`count`, `semantic`,
   `visual_quality`) no mesmo relatório e decide retries pela classe de falha.
   Essa opção preserva a rastreabilidade já existente e reduz regressão.
2. **Worker Python dedicado CS10.** Concentraria todos os detectores num
   processo residente, mas duplicaria os contratos semânticos e de qualidade já
   existentes e exigiria mudanças de runtime/VRAM mais amplas.
3. **Pós-processador fora do runner.** Geraria apenas um relatório depois da
   geração, mas não conseguiria corrigir regiões nem orientar retries sem criar
   um fluxo paralelo.

## Desenho escolhido

### Contratos

Adicionar um relatório semântico estruturado com critérios por escopo:

- `scene`: objetos, cenário, ação global e coerência da iluminação;
- `character`: identidade, roupa, acessórios, pose e ação de cada região;
- `composition`: transparência/fusão, separação, aterramento, sombras e
  perspectiva;
- `visual_quality`: anatomia, coerência física, qualidade composicional e
  identidade antes/depois.

Cada critério contém o texto de origem, o resultado (`confirmed`, `uncertain` ou
`failed`), score/margem quando disponível, detector/evaluator, bbox opcional e
uma explicação. O relatório mantém `failureCategories` separados para
`count`, `semantic` e `visual_quality`.

### Avaliação e recuperação

O runner mantém o prompt congelado e os seeds rastreáveis. Para cada tentativa:

1. gerar ou compor a imagem com a estratégia existente;
2. executar contagem/composição e, se não houver provider válido, descartar a
   tentativa;
3. avaliar critérios semânticos com CLIP local por região/cena, preservando
   `uncertain` quando o score não for conclusivo;
4. inspecionar qualidade local e heurísticas de máscara/alpha, sobreposição,
   contato e aterramento;
5. quando houver um único defeito regional acionável e o adapter suportar
   `inpaintRegion`, aplicar reparo com seed derivada e avaliar novamente sem
   recomeçar a geração inteira;
6. retry somente quando a classe de falha tiver uma estratégia conhecida e o
   limite de tentativas permitir; caso contrário escolher a melhor evidência e
   manter a revisão humana obrigatória.

Falhas semânticas por ausência de detecção isolada não serão consideradas
`failed`. Um critério só poderá ser rejeitado por contradição comprovada ou
defeito objetivo, e isso ficará explícito no motivo.

### Composição cinematográfica

Para composição em camadas, as regiões recebem variações determinísticas de
pose, escala e profundidade usando a seed da tentativa. A placa de cenário e os
retratos continuam separados, mas o composto final recebe integração com
iluminação compartilhada, sombra de contato suave e validação de pés/aterramento.
As mudanças não alteram a identidade nem o prompt semântico individual.

### Auditoria e artefatos

Todas as tentativas, incluindo rejeitadas e reparos, preservam imagem original,
imagem reparada quando existir, prompt, seed, parâmetros do engine, detector,
scores e motivos. O acceptance script produz para os casos 2/3/8:

- contact sheet antes/depois com rótulos de contagem, semântica e qualidade;
- `report.json` com o contrato completo e indicação de revisão humana;
- resumo dos testes reais e limitações ambientais/modelos ausentes.

## Validação

- testes unitários para critérios, política conservadora, agregação dos três
  eixos, heurísticas de transparência/fusão e escolha de reparo regional;
- testes de integração do runner com adapter local real quando disponível,
  mantendo fixtures apenas para regras determinísticas;
- execução real do acceptance script para dupla, trio e grupo de oito, sem
  mocks como evidência de funcionamento do pipeline;
- typecheck/build do package e suíte Vitest relevante;
- verificação final do diff para garantir que mudanças preexistentes de outras
  sessões não foram incluídas.

## Decisões do builder

- Usar os contratos `SemanticEvaluationResult`, `VisualQualityInspectionResult`
  e `LocalizedDefect` já existentes como fonte de evidência, sem criar novos
  pesos de modelo.
- Preferir `needs_review` a `rejected` em qualquer ambiguidade.
- Não instalar pesos ou alterar arquivos fora do escopo CS10 sem decisão
  explícita do usuário.


