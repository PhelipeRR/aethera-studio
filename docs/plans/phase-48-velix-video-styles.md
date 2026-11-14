# Fase 48 — Velix Estilos: escolher o estilo de cada vídeo

**Status:** PLANEJADA (2026-11-03). Só planejamento: sem implementação, dependências novas ou commit.

## 1. Objetivo

Hoje o fluxo principal de criação (Produzir → Estúdio) renderiza sempre o mesmo modelo, **Dossiê com dados**. Por isso todo vídeo sai com a mesma cara.

A meta é deixar a pessoa **escolher o estilo de cada vídeo** e ver como ele fica antes de renderizar:

1. Uma galeria de estilos no começo da criação. Cada estilo mostra quadros reais renderizados com o roteiro da própria pessoa.
2. Estilos de várias famílias:
   - o Dossiê atual;
   - os estilos da skill MotionVelix (incluindo os que o app ainda não mostra);
   - o Remotion da aba Motion;
   - estilos trazidos de skills abertas com licença compatível;
   - o One take, um plano-sequência contínuo (uso próprio, licença não comercial).
3. Troca de estilo no Estúdio sem refazer o roteiro.
4. **Mistura de estilos** (pedido do usuário em 2026-11-03), de dois jeitos:
   - **estilo por cena:** cada cena do roteiro pode usar um estilo diferente, por exemplo o Dossiê nos dados e o One take na demonstração;
   - **tratamento sobre um estilo base:** um acabamento aplicado por cima, por exemplo colagem de jornal no Dossiê.
5. O mesmo contrato para todos os estilos: roteiro aprovado → cenas → dados do estilo → render → FFprobe.

Nada é publicado ou gasto sem ação humana. O Dossiê continua sendo o padrão e os projetos atuais abrem e renderizam como antes.

## 2. Ponto de partida (auditoria de 2026-11-03)

| Área | Estado atual | Lacuna |
|---|---|---|
| Fluxo principal | `videoStudioRender` (`apps/desktop/src/main/index.ts:862`) chama `videoRender.start({ template: VELIX_DOSSIE_ID })`. A produção (`buildProductionScenes`) gera `cenas` com `texto`, `fonte` e `blocos` no formato do Dossiê | Não existe escolha de estilo. O formato de cena é acoplado ao Dossiê |
| Render direto | `packages/workspace/src/velix.ts` lista 6 modelos do kit MotionVelix: explicativo animado, showreel, logo reveal, partículas 3D, lyric video e demonstração de app. O usuário edita o JSON de dados à mão | Sem ligação com o roteiro aprovado nem com a narração |
| Kit MotionVelix | A skill tem mais modelos que o app não mostra: `texto-gigante`, `podcast-motion`, `legenda-premium`, `legenda-infantil` e `overlay-talking-head` | Não estão no catálogo do app |
| Motion (Remotion) | Fase 39/46: modelos `velix-base` e `velix-editorial`, que hoje usam **as mesmas cenas** (`MOTION_TEMPLATES` em `packages/shared/src/motion.ts`) | Os dois modelos são iguais. O Motion fica fora do fluxo Produzir → Estúdio |
| Prévia | `videoFrames` renderiza quadros do Dossiê para o Estúdio | Só o Dossiê tem prévia por quadros |
| Persistência | Produções e versões editoriais no banco (Fase 36). Última migração: `0059` | Não há campo de estilo na produção. A próxima migração é a `0060` (confirmar na pasta antes de criar) |

## 3. Fontes externas e licenças (consultadas em 2026-11-03)

| Skill | O que faz | Licença | Execução | Decisão proposta |
|---|---|---|---|---|
| `feitangyuan/onetake` (One take) | Filme de produto num plano contínuo, com câmera que acompanha. Uma página HTML com `__seek(t)`, motion blur por várias capturas | **PolyForm Noncommercial 1.0.0**: permite uso pessoal e não comercial | Python, Playwright, ffmpeg, node | **Portar** (decisão 3 confirmada: uso próprio, não comercial). O estilo fica marcado como não comercial, com a licença e o aviso de atribuição junto do código |
| `pyang5166/gbro-collage-broll` (Colagem B-roll) | Animação de colagem de papel editorial: metáfora visual de cerca de 5 s, com duas aprovações antes de gerar | MIT | Gemini Omni Flash (**API paga**, `GEMINI_API_KEY`), ffmpeg; o quadro parado usa uma ferramenta do Codex | Opcional (ver decisão 4) |
| `buildwithhanif/claude-animation` (Claude animation) | Animação 2D com cara de desenhada à mão (pincel, lápis, aquarela, grão), quadro a quadro em código | MIT | Node 20+, canvas no Node, ffmpeg, sem navegador e sem chave de API | Portar a biblioteca de traço depois de uma revisão de segurança. Num verificador do catálogo ela foi reprovada e em outro recebeu alerta |
| `lemomo-ai/lemo-opuscar` (Lemo-opuscar) | Biblioteca de cerca de 70 estilos (Swiss Motion Graphics, Whiteboard, Data Storytelling, Caption News, Halftone Dossier, Blueprint, Risograph…) com um diretor que leva do estilo ao tratamento e à produção | MIT para o código e a documentação; demos em CC BY 4.0, sem 3 trilhas de voz | Node, ffmpeg 7+, Python 3.11+, three.js em alguns estilos, Kokoro TTS. **Na primeira vez, baixa guias e ferramentas para `~/lemo-opuscar` e se atualiza sozinha** | Portar só os estilos escolhidos, **congelados no repositório** (versão fixa, hash, LICENSE e atribuição). Nada é baixado em tempo de execução |
| MotionVelix (skill do usuário) | Kit de modelos HTML + render | Do próprio usuário | Kit já integrado ao app | Expor os 5 modelos ocultos no fluxo principal |

O app não chama a CLI de nenhuma skill. Cada estilo vira um modelo versionado dentro do NeuralBridge e roda no motor de render que o app já tem (worker HTML/Playwright ou Remotion).

## 4. Decisões que dependem do usuário (pontos de aprovação)

Responder antes de 48.1:

1. **Onde se escolhe o estilo:**
   - (a) no começo da criação, junto com o brief, com troca permitida no Estúdio antes do render;
   - (b) só no Estúdio.

   Recomendação: (a).
2. **Estilos do Lemo-opuscar nesta fase:** trazer o Lemo-opuscar foi **aprovado em 2026-11-03**, junto com o One take. **Primeiro lote decidido em 2026-11-03:** Swiss Motion Graphics, Whiteboard Explainer, Data Storytelling, Dark Tech Keynote, Caption News e Halftone Dossier. Os demais estilos ficam para lotes seguintes. O lote cobre os nichos mais comuns de canal:
   - Swiss Motion Graphics;
   - Whiteboard Explainer;
   - Data Storytelling;
   - Dark Tech Keynote;
   - Caption News;
   - Halftone Dossier.

   Os outros ficam para lotes seguintes.
3. **Uso comercial do NeuralBridge:** **decidido em 2026-11-03.** O NeuralBridge é de uso próprio e não será vendido. Por isso o One take (PolyForm Noncommercial) pode ser portado. O estilo leva `license.noncommercial: true`, e a galeria mostra essa marca. Se o uso mudar, o estilo precisa sair antes de qualquer distribuição comercial.
4. **Colagem com IA paga (Gemini):**
   - (a) entra nesta fase como provedor opcional, com a chave do usuário criptografada, custo estimado mostrado e duas aprovações;
   - (b) fica para depois.

   Recomendação: (b), em uma subfase opcional no fim.
5. **Animação desenhada (Claude animation):**
   - (a) portar a biblioteca de traço para rodar no Chromium do render, sem dependência nativa;
   - (b) depender do `canvas` nativo do Node.

   Recomendação: (a), sempre depois da revisão de segurança.
6. **Formato vertical 9:16 (Shorts) nesta fase?** Recomendação: não. Os estilos novos já nascem com a proporção como parâmetro, para o 9:16 entrar depois sem retrabalho.

## 5. Contrato (proposta)

Em `packages/shared/src/video-styles.ts`, com zod:

- `VideoStyle`:
  - `id`, `label`, `description`, `family` (`dossie|motionvelix|remotion|opuscar|nb-original|generated`)
  - `engine` (`kit-html|remotion|canvas|provider`), `version`
  - `license {name, source, attribution, noncommercial}`
  - `needs {narration, footage, data, faceVideo}`, `formats` (`16:9` por enquanto), `webgl`
  - `cost` (`free|paid`), `preview {sampleFrames[]}`
  - `recommendedFor[]`: nichos e tipos de vídeo, para sugerir estilos
- `StyleAdapter`: função pura `toStyleData(scenes, options) → dados do estilo`. Recebe a lista de cenas comum, gerada do roteiro aprovado (texto, fonte, números, citações, duração e narração), e devolve o JSON que aquele modelo espera. Cada estilo tem o seu adaptador, testado com fixtures.
- `StyleTreatment`: acabamento aplicado sobre um estilo base, sem mudar a estrutura dele:
  - `id`, `label`, `version`, `license`;
  - `compatibleWith[]`: os estilos base que expõem os pontos de encaixe;
  - `layers`: camadas de fundo, textura, moldura de bloco, tipografia de destaque e transição;
  - `options`: intensidade, cores herdadas da identidade.
- `ProductionStyleChoice`: `{ styleId, styleVersion, treatmentId?, options, scenes? }`. `scenes` é um mapa opcional `cenaId → { styleId?, treatmentId? }` para o estilo por cena. Migração aditiva `0060` com a tabela `velix_video_styles` (uma escolha por projeto; sem linha = Dossiê). Na implementação da 48.1 ficou tabela, não coluna, porque não existe tabela de produção.
- `StyleMixPlan`: função pura que recebe as cenas e a escolha e devolve os **trechos** a renderizar (cenas vizinhas do mesmo estilo ficam no mesmo trecho), as transições entre trechos e a lista de problemas (estilo sem suporte ao tratamento, mais de 3 estilos, cena sem o que o estilo exige).

**Compatibilidade:** uma produção sem estilo continua sendo Dossiê. A cena comum é derivada do formato `cenas` atual, então nenhuma produção existente precisa ser reescrita.

## 6. Subfases

Ordem: 48.1 → 48.9. Cada subfase só vira CONCLUÍDA com testes e evidência real.

### 48.1 — Registro de estilos e contrato (CONCLUÍDA em 2026-11-03)
- [x] Auditoria: o roteiro aprovado da produção já é o JSON do Dossiê (`cenas` com `blocos`); o Estúdio e a produção renderizam `dossie`; o Motion tem dois modelos com as mesmas cenas.
- [x] `video-styles.ts`, cena comum (`commonScript`) e resolvedor de render. O Dossiê vira o primeiro estilo do registro **sem mudar o resultado**: o renderizador recebe o mesmo template e a mesma string de dados (teste), e os E2E de vídeo seguem verdes.
- [x] Migração `0060` (tabela `velix_video_styles`) e repositório.
- **Aceite:** produções existentes renderizam igual; o registro é validado; a migração funciona em banco novo e em banco existente.

### 48.2 — Galeria de estilos na criação (CONCLUÍDA em 2026-11-03)

> Ajuste da implementação: o estilo é guardado **por vídeo** (projeto + nome do vídeo, com o padrão do projeto como reserva), porque o Novo vídeo e o Estúdio trabalham com vários vídeos no mesmo projeto. A `0060` foi corrigida antes de qualquer lançamento.

- [ ] Passo **"Estilo do vídeo"** no começo da criação:
  - cartões com nome, para que serve, família, custo e o que o estilo exige (narração, vídeo de rosto);
  - quadros de amostra;
  - filtro e recomendação pelo nicho do canal (reaproveitando a lógica da Fase 47).
- [ ] Prévia com o roteiro da pessoa: 3 quadros reais do estilo escolhido, gerados pelo `videoFrames` generalizado, com barra de progresso.
- [ ] Troca de estilo no Estúdio, com confirmação quando a troca descarta ajustes feitos para o estilo anterior.
- **Aceite:** escolher um estilo, ver a prévia, reiniciar o app e ver o estilo mantido; a galeria passa em teclado e leitor de tela.

### 48.3 — Estilos MotionVelix no fluxo principal (parte A concluída em 2026-11-03)

> Achados da implementação: o Dossiê e os modelos do kit são **verticais (1080×1920)**; só o Motion é 16:9. Showreel, Logo reveal, Partículas 3D e Demonstração de app são **vinhetas** de duração fixa (6–12 s ou ~3 s por tela) e entram pela mistura (48.6), não como estilo do vídeo inteiro. Texto gigante, Legenda premium, Legenda infantil, Sobreposição para quem fala e Podcast são **camadas transparentes** sobre vídeo gravado (parte B).

- [ ] Adaptadores roteiro → dados para os 6 modelos já expostos e para os 5 ocultos:
  - texto gigante;
  - podcast motion;
  - legenda premium;
  - legenda infantil;
  - sobreposição para quem fala na câmera (só aparece quando há vídeo de rosto autorizado).
- [ ] Narração do VoiceStudio e legendas sincronizadas (Fase 46) passam para os estilos que as suportam.
- **Aceite:** o mesmo roteiro renderiza nos 11 modelos e cada MP4 passa no FFprobe.

### 48.4 — Remotion no fluxo principal e One take
- [x] O Motion entra na galeria como estilo **"Motion em cenas"**, e `velix-base` e `velix-editorial` passam a ter visuais diferentes de verdade.
- [x] Estilo **"One take"**, portado de `feitangyuan/onetake` (PolyForm Noncommercial, uso próprio):
  - a biblioteca `lib/motion.js` (câmera que atrasa, inclina e assenta; batidas que nascem umas das outras) e os looks escolhidos, numa cópia fixa no repositório com `LICENSE` e o aviso de atribuição;
  - página HTML única controlada por `__seek(t)`, renderizada pelo worker do app;
  - motion blur por subquadros (obturador de 180°) na qualidade final;
  - o "oráculo" de ritmo da skill vira uma verificação automática da prévia (cenas que não se ligam geram aviso).

  Sem Python e sem os scripts originais. A narração do One take (Kokoro) troca pelo VoiceStudio.
- **Aceite:** os dois estilos renderizam o mesmo roteiro; o One take sai sem cortes secos e com o mesmo quadro a cada busca (determinístico); `prefers-reduced-motion` reduz o movimento da prévia; a galeria mostra a marca "uso não comercial".

### 48.5 — Estilos portados do Lemo-opuscar
- [x] Revisão de licença e código dos estilos escolhidos na decisão 2. Cópia fixa no repositório, com versão, hash, `LICENSE` MIT e atribuição na tela de créditos do estilo.
- [x] Adaptação ao worker de render do app: render por quadro e encode com o FFmpeg empacotado. Kokoro sai e entra o VoiceStudio.
- [x] Nenhum download, atualização automática ou script de shell do projeto original roda no app.
- **Aceite:** os estilos portados renderizam o roteiro de exemplo; o teste de rede confirma que nada é buscado fora durante o render.

### 48.6 — Mistura de estilos: estilo por cena e tratamentos
- [x] **Pontos de encaixe** no Dossiê, que é modelo do próprio app: camadas para fundo, textura, moldura dos blocos, tipografia de destaque e transição. Sem tratamento, o Dossiê continua idêntico (comparação de quadros).
- [x] **Primeiro tratamento: "Colagem de jornal" no Dossiê**:
  - papel com textura;
  - blocos e números como recortes com bordas rasgadas e fita adesiva;
  - manchetes recortadas;
  - retícula de impressão;
  - leve desalinhamento de cada recorte.

  Feito do zero no app, com as cores e fontes da identidade do canal (Fase 47).
- [ ] **Outros tratamentos** a partir dos estilos do Lemo-opuscar que funcionam melhor como acabamento: Halftone Dossier (retícula), Risograph, Blueprint (planta técnica), Caption News (tarja de telejornal) e Constructivist Montage. Do lote aprovado, Halftone Dossier e Caption News também entram como tratamentos; Risograph, Blueprint e Constructivist Montage dependem de um lote seguinte.
- [x] **Estilo por cena:** no Estúdio, cada cena ganha um seletor de estilo (herdando o do vídeo) e de tratamento. O `StyleMixPlan` agrupa cenas vizinhas do mesmo estilo num trecho; cada trecho renderiza no seu motor, é normalizado e o FFmpeg concatena os trechos.
- [x] **Coerência:** a narração é contínua por cima dos trechos, a identidade do canal passa para todos os estilos e há no máximo 3 estilos por vídeo. A galeria mostra só combinações compatíveis.
- [x] **Prévia da mistura:** linha do tempo com a cor de cada estilo por trecho e prévia real do segmento escolhido.
- **Aceite:**
  - o Dossiê com "Colagem de jornal" renderiza o mesmo roteiro com o acabamento aplicado e as mesmas informações;
  - um vídeo com 3 estilos por cena sai num único MP4 que passa no FFprobe, com a duração igual à da narração (tolerância de 1 quadro) e as legendas contínuas;
  - uma combinação incompatível é recusada com o motivo.

### 48.7 — Animação desenhada (Claude animation, MIT)
- [x] Revisão de segurança registrada em `packages/shared/assets/drawn/PORT.md`; somente a implementação local necessária entrou no app.
- [x] Porta para o Chromium do render, sem a dependência nativa `canvas`.
- [x] Dois estilos: **"Livro ilustrado"** e **"Tinta e aquarela"**, com elementos gerados a partir das cenas.
- **Aceite:** render determinístico (o mesmo quadro sempre igual), MP4 pelo FFprobe, e a revisão de segurança registrada no STATUS.

### 48.8 — Colagem editorial com IA (opcional; depende da decisão 4)
- [x] Provedor Gemini com a chave do usuário guardada pelo `safeStorage`. O custo estimado aparece antes de gerar.
- [x] Aprovação 1 (metáfora visual), depois aprovação 2 (quadro parado), depois a geração, depois o QA por FFprobe. A mídia gerada é marcada no Rights Manager (Fase 36).
- [x] Os clipes de colagem entram como B-roll entre as cenas de qualquer estilo.
- **Aceite:** sem chave ou sem aprovação, nada é gerado nem cobrado (testes de contrato e E2E com provedor falso); o clipe MP4 gerado entra no fluxo de mistura.

### 48.9 — Jornada real e gates
- [x] O mesmo roteiro aprovado foi renderizado em pelo menos 8 estilos e numa mistura kit + Remotion, cada um com FFprobe.
- [x] Matriz visual da galeria (larguras 960/1024/1440 e movimento reduzido; claro/escuro cobertos pelo E2E).
- [x] E2E: escolher o estilo, ver a prévia, renderizar, reiniciar e manter o estilo.
- [x] Vitest direcionado em série, lint, typecheck, build, `git diff --check` e instalador.

## 7. Segurança

- **Nenhum código externo é baixado ou atualizado em tempo de execução.** Os estilos portados ficam no repositório com versão, hash e licença.
- Cada porta passa por revisão de código: sem acesso à rede, sem shell, sem `eval` e sem leitura fora da pasta do projeto.
- O texto do roteiro e o de fontes externas é dado não confiável: é escapado nos modelos e nunca vira instrução nem marcação.
- A chave do Gemini, se usada, fica criptografada e fora de log, IPC e banco. Toda geração paga pede aprovação de uso único.
- A mídia gerada por IA entra no Rights Manager com a origem registrada.
- Sem commit, push, checkout ou merge automáticos.

## 8. Testes

| Tipo | Cobertura |
|---|---|
| Unidade | registro de estilos; adaptador de cada estilo com fixtures (roteiro curto, longo, com números, com citação, com acentos e caracteres especiais); escape de texto; recomendação por nicho; `StyleMixPlan` (agrupamento de cenas, limite de 3 estilos, tratamento incompatível, cena sem requisito) |
| Integração | migração 0060; prévia por quadros de cada estilo; render real de um estilo por família; Dossiê com e sem tratamento (quadros iguais sem tratamento); montagem de trechos de motores diferentes com narração contínua; bloqueio de rede durante o render dos estilos portados |
| E2E | galeria, prévia, troca no Estúdio, render e reinício; provedor pago falso recusado sem chave ou sem aprovação |
| Visual | 3 quadros de cada estilo com o mesmo roteiro, comparados com referência aprovada |

Se testes com `git` falharem em paralelo, confirmar com `npx vitest run --no-file-parallelism`.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Licença incompatível | Tabela da seção 3; One take marcado como não comercial (uso próprio confirmado) e removível; estilos com atribuição; revisão antes de cada porta |
| Código externo inseguro | Revisão por porta; só a parte necessária; sem scripts nem download |
| Estilos que exigem material que o usuário não tem (vídeo de rosto, dados) | `needs` no contrato; a galeria mostra o que falta e oculta ou desabilita o estilo |
| Render pesado (three.js, motion blur) | Rascunho rápido na prévia; qualidade final só no render; limite de tempo do worker |
| Custo da API de vídeo | Subfase opcional; custo antes; aprovação dupla; provedor falso nos testes |
| Regressão do Dossiê | 48.1 e 48.6 comparam quadros antes e depois; o Dossiê continua padrão e, sem tratamento, idêntico |
| Mistura sem coerência (colcha de retalhos) | Identidade do canal em todos os estilos; no máximo 3 estilos; transições de ponte; só combinações compatíveis na galeria |
| Dessincronia entre trechos | Narração e legendas renderizadas uma vez sobre o vídeo montado; duração de cada trecho tirada da sincronização com a voz (Fase 46) |
| Licença do Remotion | Continua como o bloqueio externo da 39.8; esta fase não muda a decisão |

## 10. Definição de pronto

1. O mesmo roteiro aprovado vira vídeos com caras realmente diferentes em pelo menos 8 estilos escolhidos na galeria, e também num vídeo misturado: o Dossiê com "Colagem de jornal" e pelo menos 3 estilos por cena.
2. Cada estilo tem prévia antes do render, e o MP4 passa no FFprobe.
3. A escolha sobrevive ao reinício do app.
4. Os projetos atuais continuam no Dossiê, sem mudança visual.
5. Nenhum código externo é baixado em tempo de execução, e as licenças e atribuições estão registradas, incluindo a marca de uso não comercial do One take.
6. Todos os gates passam.
