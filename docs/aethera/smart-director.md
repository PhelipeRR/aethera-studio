# Aethera Smart Director — auditoria e plano incremental (2026-11-12)

Objetivo: o Aethera deixa de aplicar técnicas pré-definidas e passa a **dirigir** cada produção. Ele lê o roteiro inteiro,
entende o que cada trecho precisa comunicar e decide como mostrar. Também pode decidir não usar nenhum efeito. Cada decisão
tem justificativa, fica num plano versionado e é executada de forma reprodutível. Games são só o cenário de regressão; nada
aqui pode depender do tema.

## 1. Auditoria (verificada no código e nos testes, não em documentação)

| Área | O que existe de verdade | Situação |
|---|---|---|
| Skill MotionVelix v2.8.0 (`~/.claude/skills/motionvelix`) | Motor HTML determinístico próprio (`engine/mv.js`), 13 referências, templates fixos para vertical curto (F1–F12), QC de FFmpeg, revisão densa por folha de contato | Princípios bons (easing, durações, mixagem, revisão densa), mas sem direção editorial: o caminho é escolhido por **formato/template**. Sem integração com o Aethera |
| Diretor atual `shared/src/aethera-director.ts` | 8 presets **por categoria** (`games-analysis`, `documentary-cinematic`, `verified-news`…); a transição de cada cena é `allowed[index % allowed.length]` (rodízio) | É exatamente o modelo rejeitado. **Só os testes o chamam** (`aethera-director.test.ts`, `aethera-timeline.test.ts`, repositório); nenhum estágio de produção o usa. Fica como legado compatível |
| Timeline AP-03 (`aethera-timeline.ts`) + composição Remotion AP-04 | Documento versionado com hash; trilhas vídeo/gráficos/texto/legendas/narração/música/SFX; compilação pura para props (`compileAetheraTimeline`), render por janelas com cache | Base sólida para executar decisões. Gráficos limitados a `title/card/stat/lower-third/bars/caption`; sem máscara poligonal nem composição multi-painel |
| Narração E2 | Voz de canal, cadência por estilo, respiro entre frases no áudio real, correção de ritmo com piso 0,9 e guarda contra tomada que omite fala, checagem de fala faltante no sync | Funcional e validado em áudio real |
| Legendas E3 | `captionCues` por palavra medida, 2×42, ≤ 17 c/s, tamanho por formato, posição por tomada, SRT = o que aparece na tela | Funcional e validado em vídeo real |
| Seleção de tomadas (revisão E3 v2) | `planShotFootage`: assunto por frase, nunca imagem de outro assunto, fonte divergente/webcam/fade rejeitadas, texto queimado penalizado, cartão de identidade quando falta material, sem repetição | Funcional, mas a **intenção** de cada trecho ainda vem de heurística (`natureHints`, palavras-chave) — fica como fallback |
| Análise visual (AP-04 etapa 1) | `VisionRouter` + Claude via TaskEngine, contrato universal (natureza, entidades observadas/inferidas, texto e região, webcam), cache por quadros | Real e validado (piloto e amostra v2) |
| Gate editorial E1 e revisão AP-10 | `editorialGate`, `reviewAetheraTimeline` (regras sobre a timeline) | Regras sobre dados; **não inspeciona o vídeo renderizado** |
| Áudio AP-05 | `designAetheraAudio` (ducking por palavra, SFX alinhado a quadro), ACE-Step local | Contratos e validação; integração ao vídeo pendente |

**Conclusão.** As peças de execução existem: timeline, Remotion, FFmpeg, visão, narração e legendas. Falta o cérebro:
uma leitura do roteiro e uma direção por produção, decididas por um modelo e registradas como dado verificável. Falta
também a ponte entre essas decisões e técnicas de composição que hoje não existem, como painéis com máscara.

## 2. Arquitetura (responsabilidades separadas)

| Papel | Onde | Faz | Não faz |
|---|---|---|---|
| **Skill** (conhecimento) | `motionvelix/references/14-direcao-editorial.md` | Princípios de direção, montagem, ritmo, continuidade e composição; catálogo de técnicas; exemplos de decisões boas e ruins; critérios de revisão | Não escolhe técnica por tema |
| **Diretor de IA** (julgamento) | `orchestrator/src/aethera/smart-director.ts` → modelo multimodal pelo TaskEngine (Claude; Codex como fallback explícito) | Lê o roteiro inteiro e as mídias disponíveis; produz a **leitura** (o que se conta, intenção e emoção por trecho), o **conceito de direção** da produção e as **decisões por trecho**, cada uma com justificativa | Não renderiza; não inventa análise que não rodou |
| **Planejador** (estrutura) | `shared/src/aethera-smart-director.ts` (puro) | Valida o plano contra o catálogo de técnicas executáveis e contra os tempos medidos; converte âncoras de palavra em milissegundos; versiona com hash; nunca altera uma versão aprovada | Não decide estética |
| **Executor** | Timeline AP-03 + composições Remotion + FFmpeg | Executa cada técnica como elemento independente (máscaras, revelações, cortes) | Não muda decisões |
| **Revisor** | Checagens determinísticas + inspeção de quadros reais pelo VisionRouter | Compara o vídeo renderizado com a intenção de cada trecho; propõe correção; limite de tentativas | Não aprova G3 |

Decisão arquitetural: o plano editorial é **um dado** (zod), separado da timeline. A timeline continua sendo o documento
executável; o planejador a deriva do plano. Isso reaproveita AP-03/AP-04 inteiros e torna cada decisão inspecionável
antes do render. O diretor por presets fica como legado; o novo caminho não o usa.

**Biblioteca de técnicas, não de vídeos.** O catálogo descreve o que cada técnica comunica, seus parâmetros, seus custos
e se já é executável. Não diz quando usar. O diretor combina técnicas, por exemplo painéis diagonais + revelação
sincronizada à fala + câmera virtual, e pode propor algo que ainda não é executável. Nesse caso o planejador registra a
lacuna e usa um fallback declarado, nunca uma troca silenciosa.

## 3. Plano incremental

| Etapa | Entrega | Aceite |
|---|---|---|
| **SD-1 (esta)** | Contratos (leitura, conceito, decisão por trecho, plano versionado com hash); catálogo de técnicas; validador; diretor de IA real; técnica nova **multi-painel com máscara e revelação sincronizada à pronúncia** no Remotion; amostra real; skill atualizada | Testes do planejador e da composição; execução real do diretor em ≥ 5 roteiros (mesmo tema com intenções diferentes, mudança de tom, tema inédito, caso de corte simples, combinação nova), avaliados por critérios objetivos sobre o plano; MP4 com o trecho da comparação feito por painéis reais |
| SD-2 | Mais técnicas executáveis: picture-in-picture, câmera virtual (push/pan/reframe) dirigida, tipografia cinética, diagrama/gráfico progressivo, transições motivadas (match cut, dissolve) | Cada técnica com teste de composição e quadro real revisado |
| SD-3 | Seleção de tomadas guiada pela intenção do diretor (substitui `natureHints`): pontuação editorial explicável por critério (semântica, ação, luz, texto, qualidade, duração, repetição, continuidade) | Relatório por tomada com a decomposição da nota |
| SD-4 | Revisor pós-render: quadros reais por trecho → VisionRouter compara com a intenção; correção proposta e aplicada como nova versão; no máximo N tentativas | Ciclo real com ao menos uma correção aplicada e registrada |
| SD-5 | Direção de áudio integrada (pausas dramáticas, SFX de revelação justificados, ducking, ambiência) sobre o AP-05 | Mix medido (LUFS, pico, ducking) e eventos justificados |
| SD-6 | Memória de técnicas: soluções aprovadas registradas como referência consultável, nunca como regra; produções aprovadas imutáveis | Teste de imutabilidade e de consulta |

### Estado do SD-1 (2026-11-13)

Entregue e verificado em vídeo real. A evidência está em `docs/STATUS.md` (seção Aethera Smart Director). Lições que viraram
regra:

- **O diretor decide o ideal; o planejador decide o executável.** Mostrar ao modelo o que o renderer já fazia
  homogeneizou as direções (buraco negro ×3 com distância 0,035–0,15). Sem essa informação no prompt, a distância subiu
  para 0,232–0,571.
- **Um cartão é camada sobre imagem limpa, nunca tela chapada.** Ele termina com a própria frase, mesmo quando a imagem
  continua.
- **Fallback preserva a intenção sem repetir a legenda.** Palavras soltas fora de movimento não comunicam nada.
- **Quem nomeia um assunto tem prioridade sobre o material dele.** Painéis e frases específicas vêm antes do rodízio das
  frases gerais.
- **Texto dentro de painel é posicionado na faixa visível do polígono,** não na caixa.

### Estado do SD-2 (2026-11-13): aproximar o planejado do executável

Foco pedido: reduzir a distância entre o que o diretor planeja e o que o renderizador executa. Evidência e números em
`docs/STATUS.md` (seção SD-2). O que mudou de fato:

- **Técnicas que saíram do fallback:** picture-in-picture (layout `pip` dos painéis, com moldura e canto escolhido),
  tipografia cinética (`kinetic`: palavras que sobem de uma máscara na pronúncia), revelação progressiva de linhas no
  cartão (cada linha na própria palavra, com leitura mínima de 1,2 s antes do fim) e dissolve motivado (sobreposição
  de 420 ms com opacidade). Seguem em fallback: diagrama, gráfico de dados, mapa/linha do tempo; *match cut* e *wipe*
  são executados como corte e registrados.
- **Texto ciente da imagem:** cada candidato tem uma grade 6×6 de bordas e uma grade de bordas persistentes entre
  quadros (HUD, logo, moldura). Cartões e tipografia cinética vão para o terço mais calmo; a coluna medida segue o
  alinhamento (esquerda para cartão, centro para cinética).
- **Texto da própria mídia:** cartões e cinética só entram sobre filmagem sem texto; a revisão pós-render mede o texto
  que aparece de fato no quadro renderizado.
- **Corte seco preservado:** `continue_previous` depois de um cartão continua a imagem sem o texto; o dissolve só existe
  quando o diretor o motiva.
- **Plano no fluxo do app:** migração `0120_aethera_editorial_plans`, repositório (versão gravada uma vez; só
  rascunho → aprovado, por uma pessoa nomeada e ligada ao hash exibido), serviço no orquestrador (segmentos derivados
  da narração medida do storyboard; só um plano aprovado do roteiro atual é executado), IPC (`get`, `history`,
  `direct`, `approve`, `apply`) e painel "Plano editorial" no editor Aethera. Aplicar gera uma nova versão da timeline
  (desfazível); nada renderiza ou publica sozinho.
- **Revisão audiovisual pós-render v1** (`orchestrator/src/aethera/post-render-review.ts`): duração, loudness integrado,
  pico verdadeiro, silêncio longo no meio da fala, sincronia e sobreposição das legendas, quadro vazio, texto da mídia
  na tela e coerência imagem × fala (VisionRouter + juiz). Cada verificação traz a evidência; o relatório traz as
  limitações. Ciclo de correção limitado (`reviewAndCorrect`).

Lições do SD-2 que viraram regra:

- **Só o que é medido corrige sozinho.** No ciclo real, trocar filmagem pelo veredito do juiz piorou a amostra (5 → 7
  falhas): frases abstratas não têm imagem que satisfaça o juiz, e a troca tirou imagem limpa dos cartões. Agora o
  veredito do juiz vira `human_review`; só quadro vazio e texto da mídia viram `replace_footage`.
- **A melhor versão vence.** O ciclo para quando uma correção aumenta as falhas e devolve a versão anterior.
- **Uma troca local mexe no resto.** Excluir uma única filmagem reembaralhou outras escolhas e trouxe clipes com texto
  que a análise prévia (3 quadros) não viu. A próxima etapa é trocar só o corte afetado, sem replanejar a produção.
- **O juiz não é determinístico.** Sobre o mesmo vídeo, 3 dos 15 vereditos imagem × fala mudaram entre duas execuções.
  É mais uma razão para que ele recomende e não decida.
- **Cache de quadros da revisão é por arquivo renderizado**, não por nome: a primeira versão do script reaproveitou
  quadros de outro render e acusou um defeito que não existia.

## 4. Princípios que o código precisa respeitar

- A intenção do trecho decide a técnica, não o tema. Dois roteiros sobre o mesmo assunto podem ter direções opostas.
- Corte seco é uma decisão válida e frequente. Efeito sem motivo é defeito.
- Nenhuma imagem de um assunto ilustra outro, exceto numa comparação explícita.
- Fato verificável e representação artística são marcados como tais. Faltou material, registra-se a lacuna.
- Decisão não determinística não altera uma versão aprovada: uma nova direção vira nova versão em rascunho.
- G3 continua humano.
