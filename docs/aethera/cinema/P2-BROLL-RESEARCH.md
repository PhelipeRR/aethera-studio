# P2 — Pesquisa de B-roll para Aethera

**Escopo:** pesquisa somente; nenhum código-fonte, teste, pacote ou configuração foi alterado. Não foram executados downloads nem instalações.

**Data:** 2026-11-17

**Fontes obrigatórias consultadas:** somente as quatro fontes listadas em [§ 12](#12-fontes).

## Resumo executivo

`broll_tools.py` é uma referência compacta e determinística para três operações: aquisição com `yt-dlp`, catálogo de planos com OpenCV/Pillow e extração de um intervalo contínuo normalizado com FFmpeg. Para Aethera P2, as ideias mais reaproveitáveis são a redução para `160×90` em tons de cinza, o limiar configurável de diferença entre frames, a margem de `±0,08 s` nas bordas, o catálogo JSON por fonte, a prancha com timestamps e a exigência de sobra de `0,4 s` antes de desacelerar um trecho.

Há quatro ressalvas decisivas:

1. O código não possui um classificador de flash-frame. O que o material chama de proteção contra flash é o recorte fixo de `+0,08 s`/`-0,08 s` depois de um corte detectado.
2. A “keyframe representativa” é apenas o frame do ponto médio do plano; não há seleção por nitidez, movimento, cobertura semântica, rosto/objeto ou diversidade.
3. O extrator evita congelamento artificial por falta de duração, mas não detecta nem remove congelamentos naturais; a checagem `freezedetect` aparece no SKILL como portão separado.
4. A página do repositório não exibe uma entrada `LICENSE` nem uma concessão de licença visível. Isso impede assumir que o código pode ser incorporado em Aethera.

**Recomendação de proposta:** adotar os contratos e os parâmetros como inspiração técnica, mas implementar em Aethera um catálogo com proveniência/licença, detecção explícita de flash e congelamento, seleção de múltiplos keyframes e preflight/erros estruturados. O código deve ser tratado como referência não licenciada até haver autorização expressa.

## 1. O que foi realmente lido

### Fatos verificados

- O arquivo `scripts/broll_tools.py` tem 224 linhas e implementa `download_broll`, `detect_clean_shots`, `make_contact_sheet`, `extract_continuous_clip` e uma CLI com `download`, `scan` e `extract` ([S2]).
- O README do repositório descreve o script como “download via `yt-dlp`, scanner OpenCV de cortes (`±0,08s` contra flash frames), contact sheets e recorte contínuo anti-freeze”, e lista Python 3.10+, Node.js 22+ e FFmpeg/FFprobe no `PATH` como pré-requisitos do kit ([S1]).
- O site e o SKILL publicado descrevem a mesma arquitetura e explicitam a sequência de curadoria, catalogação e extração contínua ([S3], [S4]).

### Limite da evidência

O README/SKILL descreve o comportamento esperado do pipeline; os detalhes de algoritmo, campos de saída e tratamento de falhas abaixo foram derivados do corpo real de `broll_tools.py`, não apenas da descrição editorial ([S2]).

## 2. Dependências e compatibilidade

### Fatos verificados

Dependências Python diretas do arquivo:

| Tipo | Dependência | Uso observado |
|---|---|---|
| Biblioteca padrão | `argparse`, `json`, `subprocess`, `pathlib` | CLI, JSON, processos externos e caminhos |
| Python | `cv2` | leitura, amostragem, resize, grayscale e seeks de vídeo |
| Python | `numpy` | diferença média absoluta entre frames |
| Python | `Pillow` (`Image`, `ImageDraw`) | composição e gravação de contact sheet |
| Módulo local | `common.load_channel_env`, `common.probe_video_stream` | resolução do perfil/diretórios e probing de stream |
| Executável externo | `yt-dlp` | download/seleção de mídia |
| Executáveis externos | `ffmpeg` e, via `common`, `ffprobe` | merge/conversão e metadados |

`download_broll` prefere vídeo H.264/`avc1` até 1080p com áudio AAC/`mp4a`, depois tenta MP4 e por fim a melhor combinação disponível; pede merge final em MP4. `extract_continuous_clip` fixa `libx264`, `yuv420p`, 30 fps e GOP `10` ([S2]).

O Python/Node/FFmpeg exigido no README é do kit completo. Node.js não é importado por `broll_tools.py`; ele aparece para HyperFrames e demais partes do pipeline documentadas no site/SKILL ([S1], [S3], [S4]).

### Implicações para Aethera

- Windows precisa localizar `yt-dlp`, `ffmpeg` e `ffprobe` pelo `PATH`; o código não aceita caminhos de executável como argumento.
- O FFmpeg usado precisa oferecer `libx264`, `zscale` e `tonemap` para todos os caminhos do extrator.
- `cv2.VideoCapture` depende do backend/codec disponível na máquina. O código não escolhe backend nem transforma uma falha de abertura em erro explícito.
- `yuv420p`, MP4/H.264 e 30 fps são escolhas amplamente compatíveis, mas a saída landscape é sempre 1920×1080 e a portrait 1080×1920; isso pode ser caro para prévias em máquinas Windows sem aceleração.

## 3. Detecção de cena e filtragem de flash

### Fatos verificados — `detect_clean_shots`

1. Abre o vídeo com `cv2.VideoCapture`.
2. Usa o FPS reportado pelo container; se o valor for falsy, assume 30 fps.
3. Calcula a duração como `total_frames / fps`.
4. Lê todos os frames, mas só processa índices pares. Em material de 30 fps, a comparação efetiva é aproximadamente 15 amostras por segundo; a decodificação, contudo, continua ocorrendo frame a frame.
5. Redimensiona os frames processados para `160×90`, converte BGR para grayscale e calcula `mean(abs(gray - prev))` em `float32`.
6. Registra um corte quando `diff > 28.0`, o plano atual já tem pelo menos `0,8 s` desde o último corte e ainda há pelo menos `0,4 s` até o fim do vídeo.
7. Acrescenta `0,08 s` ao início e remove `0,08 s` do fim de cada intervalo; descarta intervalos brutos menores que `0,7 s`. Os tempos são arredondados para duas casas decimais ([S2]).

O limiar `28.0` e o `min_shot=0.8` são parâmetros da função, portanto são ajustáveis por chamada; a CLI `scan` usa os defaults e não expõe flags para eles ([S2]).

### Flash-frame: fato versus interpretação

**Fato:** não há estado, janela temporal, classificação de brilho, comparação de histograma, confirmação de corte ou teste de persistência de um frame isolado. A proteção contra um frame vizinho piscando é o aparo fixo de 80 ms nas duas bordas ([S2]).

**Implicação/inferência:** um flash de alta intensidade dentro de um plano pode superar o mesmo limiar e ser tratado como corte; uma mudança gradual ou um corte com pouca diferença pode não ser detectado. O `min_shot` e a margem final reduzem parte dos falsos positivos, mas não formam um detector de flash.

### Recomendação P2

Separar três decisões: `candidate_cut`, `flash_rejection` e `usable_interval`. Para cada candidato, comparar mais de um frame antes/depois, exigir persistência da mudança e marcar o motivo da rejeição. Manter o `±0,08 s` como margem configurável, não como substituto do filtro. Registrar o limiar e a versão do detector no catálogo para que uma nova varredura seja reproduzível.

## 4. Keyframes representativas e contact sheets

### Fatos verificados — `make_contact_sheet`

- Para cada plano aceito, calcula `mid = (start + end) / 2` e posiciona o `VideoCapture` nesse timestamp com `CAP_PROP_POS_MSEC`.
- Lê exatamente um frame por plano; redimensiona para `320×180`; monta uma grade fixa de quatro colunas, com número de linhas suficiente para todos os planos.
- Rotula cada célula como `#índice início-fim (duração)` usando `_fmt_time`, que arredonda para segundos inteiros.
- Cria fundo RGB `(12,14,20)`, desenha uma faixa escura para o texto e salva JPEG com `quality=92`.
- Cria o diretório-pai da imagem antes de salvar. Se `shots` estiver vazio, retorna sem criar a imagem. Se um seek/leitura falhar, pula aquela célula sem emitir erro ([S2]).

### Limitações verificadas

Isso é uma prancha de inspeção, não uma seleção de keyframes semanticamente representativos. Há um único frame central por plano, sem score de nitidez, detecção de blur, movimento, texto, assunto ou diversidade. O seek por timestamp pode ser aproximado e custoso dependendo de GOP/backend; a imagem também força a razão 16:9 e pode distorcer fontes que não sejam 16:9.

### Recomendação P2

Manter o frame central como fallback, mas gerar de três a cinco candidatos por intervalo e selecionar por nitidez/entropia, estabilidade temporal e diversidade. Guardar no JSON os timestamps de todos os candidatos, o escolhido, o motivo do score e um status de leitura. Paginar ou reduzir a resolução de sheets muito grandes para não transformar um vídeo longo em uma única imagem de dimensões excessivas.

## 5. Intervalos contínuos, desaceleração e congelamentos

### Fatos verificados — `extract_continuous_clip`

O intervalo bruto é `max(0.2, end - start)`. A função então:

- usa velocidade normal (`setpts=PTS*1`) quando a fonte tem pelo menos `target_dur + 0,4 s`;
- aceita um ajuste de velocidade quando a fonte tem pelo menos `target_dur / max_slowmo`, limitando `max_slowmo` a `1,20×` e o fator mínimo a `0,88`;
- lança `ValueError` quando o trecho não alcança esse limite;
- fixa `fps=30`; quando detecta `color_transfer` `smpte2084` ou `arib-std-b67`, aplica o caminho HDR→SDR descrito na seção seguinte;
- não usa `tpad`, clone do último frame ou áudio (`-an`);
- codifica H.264 com CRF 16, preset configurável (default `ultrafast`), GOP 10 e `yuv420p`, truncando a saída para `target_dur` ([S2]).

### O que isso garante e o que não garante

**Garante por construção:** não preencher artificialmente um intervalo curto repetindo o último frame; exigir margem de fonte; manter uma saída CFR de 30 fps.

**Não garante:** que a fonte não contenha um freeze natural, uma tela estática ou um plano sem movimento. `broll_tools.py` não executa `freezedetect`. O SKILL prescreve esse filtro como portão de QA do master, separado da extração ([S2], [S4]).

### Recomendação P2

Rodar detecção de freeze no clipe extraído e no master, com resultado persistido no catálogo/audit. Diferenciar `natural_static_shot` de `synthetic_freeze`; permitir override editorial para planos intencionalmente estáticos. Validar `end > start` e `target_dur > 0` antes do cálculo, pois o `max(0.2, ...)` mascara parte de entradas invertidas ou inválidas.

## 6. HDR→SDR e letterbox

### Fatos verificados

- O código consulta `probe_video_stream(src)` e considera HDR somente quando `color_transfer` está em `{smpte2084, arib-std-b67}`.
- Para HDR, usa `zscale` para linearizar/normalizar, converte para BT.709 e aplica `tonemap=hable`, depois retorna a `yuv420p`.
- `bar_top_bottom` é uma entrada manual; se maior que zero, aplica `crop=iw:ih-2*bar:0:bar`.
- Em portrait, corta uma janela 9:16 com posição horizontal `xc` e escala para 1080×1920.
- Em landscape, escala para preencher 1920×1080 e corta o excedente; depois aplica `setsar=1` e `format=yuv420p` ([S2]).

### Implicações

Não há detecção automática de barras, preservação de letterbox, escolha de `pad` ou validação da área de crop. A estratégia landscape é “scale to fill + crop”; em fontes com outra razão ou assunto fora do centro pode eliminar conteúdo. A detecção HDR olha apenas para o campo de transferência, não para todos os metadados de primárias/matriz. Um `bar` inválido também não é rejeitado antes de chegar ao FFmpeg.

O SKILL recomenda normalizar fontes PQ/BT.2020 para BT.709 SDR antes da mistura com SDR e apresenta `zscale`/`tonemap` ou `color.py --to-sdr` como caminhos de pipeline ([S4]).

### Recomendação P2

Persistir metadados de transferência, primárias, matriz e decisão de enquadramento. Implementar detecção/validação de barras, modos explícitos `crop`/`pad`/`preserve`, limites de `xc` e testes com fontes 16:9, 2.39:1, 4:3, PQ e HLG. Manter a conversão HDR→SDR antes da seleção final de keyframe, para que a prancha represente a aparência de entrega.

## 7. Metadata, biblioteca e organização

### Fatos verificados

Na CLI `scan`, o perfil resolve `env.broll_dir` para as fontes e cria `env.work_dir / "broll_catalog"`. Para cada MP4, grava:

```json
{
  "info": "resultado de probe_video_stream",
  "shots": "lista de intervalos detectados",
  "sheet": "caminho da contact sheet"
}
```

Os nomes são `<stem>.json` e `<stem>_sheet.jpg`; o resumo no stdout contém nome do arquivo, quantidade de planos e nome da sheet. O SKILL descreve a biblioteca por perfil com `assets/broll/`, catálogo JSON e contact sheets; o código coloca os artefatos do catálogo em `work/broll_catalog`, deixando as fontes em `env.broll_dir` ([S2], [S4]).

### Lacunas verificadas

O JSON produzido não registra, no próprio `entry`, URL de origem, slug original, timestamp de ingestão, hash do arquivo, licença/termos, titular, créditos, parâmetros usados no scan, versão do algoritmo, decisões de crop/HDR, erros de leitura ou status de curadoria. A URL existe apenas durante a chamada de download e não é persistida por `download_broll` ([S2]).

### Recomendação P2

Tratar a biblioteca como um ativo auditável, com pelo menos:

- identidade: `assetId`, nome, hash, tamanho, duração, FPS, resolução e codec;
- proveniência: URL, data de ingestão, título/origem e método de aquisição;
- direitos: titular, licença, escopo, expiração, crédito obrigatório e evidência;
- análise: versão do scanner, threshold, `min_shot`, margem, candidatos/keyframe escolhido, HDR/letterbox e resultados de freeze;
- estado: `ingested`, `scanned`, `rights_reviewed`, `approved`, `rejected`, `error`.

## 8. Tratamento de erros e implicações de operação

### Fatos verificados

- `subprocess.run(..., check=True)` faz falhas de `yt-dlp` e FFmpeg propagarem como exceções; não há retry, timeout ou mensagem de domínio.
- `extract_continuous_clip` fornece um erro de domínio explícito somente para trecho curto (`ValueError`).
- `VideoCapture` não é validado com `isOpened()`. Fim de leitura (`ret=False`) encerra o scan, mesmo que a falha seja codec/arquivo, e não há contador de frames inválidos.
- Uma falha no meio de `scan` interrompe o loop e pode deixar catálogos anteriores gravados; não há relatório parcial por arquivo.
- A saída do extrator usa `-y`, portanto um arquivo de destino existente pode ser sobrescrito.
- A busca de `src` em `extract` primeiro usa o caminho fornecido; só cai em `env.broll_dir / args.src` se o caminho inicial não existir ([S2]).

### Recomendação P2

Adicionar preflight de executáveis/codecs, validação de arquivo e stream, timeout, erro estruturado por asset, escrita atômica do JSON/MP4 e modo explícito de não sobrescrever. Em lote, continuar com os demais assets e emitir um relatório final `ok/warn/error`; nunca confundir “zero shots” com “vídeo sem cortes” sem registrar a causa.

## 9. Performance no Windows

### Fatos e implicações verificáveis

- O scanner reduz o frame para `160×90` e processa somente índices pares, o que reduz custo de NumPy/OpenCV; entretanto `cap.read()` ainda decodifica todos os frames. O ganho não é equivalente a ler somente 15 fps.
- A contact sheet usa seeks independentes ao ponto médio de cada plano. Em H.264 com GOP longo, isso pode gerar muitas buscas/decode e latência de I/O.
- O extrator é síncrono e executa uma invocação FFmpeg por clipe. O preset default `ultrafast` favorece tempo de CPU, mas não há encoder de GPU configurado; `libx264` permanece no caminho.
- GOP 10 melhora a granularidade de seek/edição, mas aumenta a frequência de keyframes e pode aumentar custo/tamanho em relação a um GOP mais longo.
- O SKILL recomenda retentativas curtas ao remover temporários no Windows por locks transitórios de antivírus/indexador; `broll_tools.py` não remove temporários e não implementa esse helper ([S2], [S4]).

### Recomendação P2

Para Windows, medir separadamente decode, seek, encode e escrita. Usar cache de `probe`, evitar seeks repetidos quando possível (uma passagem sequencial ou índice de frames), limitar concorrência por capacidade de CPU/SSD e permitir encoder configurável. Preservar a recomendação de cleanup com retry no orquestrador, não dentro do scanner, caso a implementação de P2 crie temporários.

## 10. Licenciamento e risco de adoção

### Fatos verificados

- A listagem visível da raiz do repositório mostra `.agents`, `channels`, `config`, `scripts`, `.gitignore`, `README.md` e `requirements.txt`, sem uma entrada `LICENSE`; a página também não exibe uma licença no bloco de informações do repositório ([S1]).
- `broll_tools.py` não contém cabeçalho de licença visível ([S2]).
- O site/SKILL orienta usar fontes oficiais/licenciadas, não usar watermark alheia nem material vazado protegido por direitos autorais, e menciona créditos para trilhas CC BY; isso é orientação de uso de mídia, não uma licença do código do repositório ([S3], [S4]).

### Recomendação

Não copiar o arquivo nem incorporá-lo como dependência de Aethera sem obter licença/autorização expressa do titular. Para P2, usar os comportamentos documentados como requisitos de pesquisa e fazer uma implementação própria, mantendo atribuição e revisão jurídica quando houver qualquer reutilização. Para cada asset de B-roll, exigir registro de origem e permissão de uso; para material CC BY, preservar o crédito exigido. A ausência de licença visível não prova, por si só, uma licença proibitiva, mas também não concede permissão.

## 11. Decisão recomendada para a proposta P2

**Adotar:** scanner determinístico com diff de baixa resolução; margem de segurança configurável; seleção visual por contact sheet; intervalos contínuos; normalização CFR/BT.709; catálogo por perfil; QA de freeze posterior.

**Não adotar sem reforço:** chamar a margem de 80 ms de “flash filtering”; tratar o midpoint como keyframe representativa; aceitar sheets sem validação de leitura; assumir que ausência de freeze artificial significa vídeo sem congelamento; usar JSON sem proveniência/licença; depender de erros brutos de subprocesso.

**Critério de aceite sugerido:** cada asset aprovado deve ter fonte/hash/licença, stream validado, catálogo versionado, pelo menos uma keyframe válida por plano, decisão de crop/HDR registrada, nenhum intervalo abaixo do limite definido e resultado de freeze auditável no clipe e no master.

## 12. Fontes

- **[S1] Repositório e README:** [https://github.com/sasj93/YoutubeFactory](https://github.com/sasj93/YoutubeFactory)
- **[S2] Implementação real de `scripts/broll_tools.py`:** [https://github.com/sasj93/YoutubeFactory/blob/main/scripts/broll_tools.py](https://github.com/sasj93/YoutubeFactory/blob/main/scripts/broll_tools.py)
- **[S3] Guia visual publicado:** [https://youtubefactory.vercel.app/](https://youtubefactory.vercel.app/)
- **[S4] SKILL.md publicado:** [https://youtubefactory.vercel.app/youtube-ai-factory-SKILL.md](https://youtubefactory.vercel.app/youtube-ai-factory-SKILL.md)

## 13. Comparação com o Aethera Studio

| Capacidade | YouTube AI Factory | Aethera atual | Decisão para P2 |
|---|---|---|---|
| Aquisição e catálogo | `yt-dlp` + JSON por MP4; pouca proveniência no catálogo | Aquisição, hash, direitos, checkpoint e funil já persistidos | Reutilizar o ativo/proveniência do Aethera; ampliar o índice, sem substituir aquisição |
| Cortes | Diff médio em `160×90`, escala de cinza, amostras de índices pares, `threshold=28`, `min_shot=0,8 s` | FFmpeg `select='gt(scene,0.3)'` + `showinfo`, depois janelas máximas de 20 s | Manter FFmpeg como compositor e análise; comparar/registrar o detector, sem alterar thresholds de Grounding |
| Flash frames | Não há classificador; há apenas margem fixa de `+/-0,08 s` após o corte | Não há rejeição explícita de flash no índice atual | Implementar persistência antes/depois do corte e registrar `flash_candidate`/motivo; não chamar a margem de detector |
| Keyframes | Um midpoint por plano para a contact sheet | 1–3 frames interiores, com hash SHA-256 e cache por conteúdo | Preservar os hashes; adicionar candidatos, score de nitidez/estabilidade e escolha rastreável |
| Contact sheet | Pillow, 4 colunas, timestamp/duração por célula | Não há contact sheet do índice visual | Adicionar artefato de inspeção opcional, sem virar evidência semântica automática |
| Congelamento | O extrator não detecta freeze natural; QA separado prescreve `freezedetect` | `signalstats` mede `black`, `frozen`, `motion` por segmento | Usar o probe existente como gate técnico e manter “estático intencional” separado de “freeze” |
| HDR/letterbox | HDR PQ/HLG para SDR com `zscale/tonemap`; crop manual de barras | O índice atual não normaliza HDR nem detecta barras automaticamente | Adicionar preflight/decisão de cor e enquadramento somente ao recorte; persistir parâmetros |
| Identidade do intervalo | Apenas índice numérico do shot no JSON | `assetId:startMs-endMs` já é estável dentro do ativo | Derivar ID versionado de hash do ativo + intervalo + versão do indexador |
| Semântica | Não possui VisionRouter ou decisão narrativa | VisionRouter, cache, tentativas e Scene Matching já existem | Fazer P2 consumir o VisionRouter e os thresholds existentes; nenhuma aprovação por metadata |
| Associação a cenas | `roteiro.json` fornece `{src,start,end,anchor}` manualmente | `MediaSegmentCandidate`, ranking por cena, identidade e `selectMediaSegments` | Persistir match por cena/trecho, permitindo o mesmo ativo em cenas distintas |
| Retomada | Catálogo é gravado por arquivo, sem checkpoint de cada operação | Checkpoints de produção e cache de frames/visão já existem | Indexar por item idempotente e retomar por fonte/segmento sem novo download |
| Timeline | O extrator recebe `target_dur` e recusa fonte curta; saída é sem áudio | P1 mede áudio antes, preserva pausas e torna a duração real autoridade | O intervalo selecionado alimenta a timeline medida; não duplicar frames, não truncar a narração |

Conclusão: o Aethera já possui partes mais fortes de persistência, direitos, VisionRouter, identidade e Scene Matching. O ganho real do projeto de referência está na curadoria determinística do intervalo e na inspeção visual; não é necessário criar um segundo orquestrador Python.

## 14. Prova de conceito local — Cyberpunk 2077

A prova foi executada em `2026-11-17` com o arquivo já existente, sem download:

`C:\dev\neuralbridge-studio\artifacts\creative-studio-cs6\cyberpunk-2077-clip.mp4`

O relatório completo, incluindo hashes dos frames e caminhos dos artefatos, está em [report.json](../../../artifacts/aethera-p2-broll-poc/2026-11-17T17-22-54-360Z/report.json). O arquivo foi copiado apenas para o diretório da prova para manter o experimento isolado; o hash SHA-256 permaneceu `db64afb8c1f43b6efdad4029d820f2e7c04b3b0728f797818100638af3dc37bc`.

| Métrica | Resultado |
|---|---:|
| Downloads | 0 |
| Duração / formato | 2,000 s; 1280×720; H.264; 24 fps |
| Cortes reais detectados | 0 cortes internos; limites `[0, 2]` |
| Intervalos identificáveis | 1 (`0–2.000 s`) |
| Keyframes | 2, em `0,500 s` e `1,500 s`, com hashes e bytes persistidos |
| Qualidade estrutural | 20 frames amostrados; luma médio 96,45; diff médio 6,01; `black=false`, `frozen=false`, motion 0,601 |
| Detecção de cortes | 89,84 ms |
| Probe de qualidade | 95,36 ms |
| Extração de frames — 1ª passagem | 160,16 ms |
| Extração de frames — 2ª passagem | 152,31 ms; mesmos hashes e 0 novos arquivos |
| Memória máxima do processo | 139.880 KB |
| GPU observada | NVIDIA GeForce RTX 4060 Ti; consulta `nvidia-smi` somente leitura |
| VisionRouter / Ollama | `technical_blocked`: endpoint local indisponível; `qwen2.5vl:3b` não foi inferido |

O resultado semântico foi corretamente classificado como bloqueio técnico, não como rejeição editorial. Portanto, a prova comprova segmentação, rastreabilidade, keyframes, qualidade estrutural e reutilização do cache, mas não afirma relevância semântica onde o provedor não estava disponível. A amostra de dois segundos também não é suficiente para medir a qualidade de cortes múltiplos, HDR, letterbox ou escolha de trechos longos.

## 15. Arquitetura proposta para implementação P2

1. **Manifesto do ativo:** reutilizar `assetId`, hash, proveniência, direitos, ffprobe e duração do ativo. O manifesto de B-roll terá versão do indexador, parâmetros, estado por etapa e erro estruturado.
2. **Detecção e normalização:** executar o detector FFmpeg existente, registrar candidatos de corte e aplicar margem somente depois de confirmar persistência. Dividir spans longos em janelas de até 20 s, preservando cortes reais.
3. **Validação técnica do intervalo:** para cada intervalo, executar o probe de preto, freeze e movimento; rejeitar como técnico apenas quando a evidência estrutural justificar. Um plano estático válido continuará distinguível de um freeze.
4. **Keyframes e inspeção:** extrair frames interiores content-addressed; gerar de três candidatos quando o intervalo permitir, guardar timestamps e hashes e selecionar o representativo por score técnico. A contact sheet será um artefato de revisão, não aprovação automática.
5. **Semântica:** enviar os frames do intervalo como uma única unidade ao VisionRouter. A chave de cache incluirá hash do ativo, intervalo, hashes ordenados dos frames, timestamps, provider/modelo e versão do prompt. Indisponibilidade de todos os provedores será `technical_blocked`, com tentativas preservadas.
6. **Seleção narrativa:** adaptar `MediaSegmentCandidate`/`rankMediaSegments` para consumir descrições e evidências observadas, mantendo identidade, direitos, banda calibrada e thresholds atuais como gates. O match persistirá `sceneId`, `segmentId`, intervalo de origem, timestamps que provam a decisão, descrição e motivo.
7. **Reutilização:** o mesmo `assetId` e o mesmo índice podem servir várias cenas; a diversidade será aplicada ao intervalo selecionado, não como bloqueio global do vídeo. Frames e inferências já válidos não serão refeitos.
8. **Retomada e P1:** cada fonte/intervalo será checkpointed e idempotente. O resultado final entregará `sourceStartMs/sourceEndMs` à Audio-First Timeline; a duração medida do áudio de P1 continua autoridade e nenhum filtro pode cortar narração.

O catálogo deve diferenciar explicitamente `technical_valid`, `semantic_adequate`, `editorial_rejected`, `human_review` e `technical_blocked`. A evidência visual continua obrigatória para aprovação; score textual, título ou hash não substituem o VisionRouter.

## 16. Plano incremental, riscos e aceite

### Lotes propostos

1. Contrato e persistência do índice, com migração aditiva/checkpoint.
2. Indexação FFmpeg, keyframes, qualidade, flash/freeze auditáveis e contact sheet.
3. Integração VisionRouter, cache, fallback, diagnósticos e retomada.
4. Associação por cena usando os matches existentes, com múltiplos intervalos por ativo.
5. POC automatizada em mídia real Cyberpunk e teste de retomada após reinício.
6. Só depois, integração com renderização FFmpeg e validação audiovisual E2E.

### Riscos controlados

- O código de referência não exibe licença; a implementação será própria e não copiará `broll_tools.py`.
- `cv2.VideoCapture` e seeks por timestamp variam no Windows; FFmpeg continua o caminho autorizado do Aethera.
- Ollama pode estar ausente, offline ou sem o modelo; isso deve produzir diagnóstico técnico persistido, nunca aprovação ou rejeição editorial.
- Um arquivo curto não prova desempenho em biblioteca longa; o benchmark P2 precisa incluir um segundo ativo local com cortes múltiplos quando disponível.
- HDR, barras, overlays e watermarks precisam de evidência técnica própria; defaults não serão tratados como “limpos”.

### Critérios de aceite propostos

- Um vídeo local real produz segmentos com IDs estáveis, timestamps e pelo menos uma keyframe rastreável por intervalo.
- A segunda execução reutiliza probe, frames e análise sem download nem inferência repetida.
- Cada match aponta para cena, intervalo, hashes/timestamps de prova e decisão separada de qualidade/semântica/direitos.
- Nenhum intervalo preto, congelado, incompleto ou semanticamente inconclusivo entra como aprovado.
- O restart retoma do checkpoint e conserva diagnósticos, erros e tentativas.
- O áudio medido por P1 não é estendido por repetição artificial nem encurtado por `atrim` silencioso.
- Os testes de indexação, cache, deduplicação, seleção, persistência, retomada e integração passam; somente então será solicitado o aceite para implementar P2 completo.

Esta rodada não implementou o módulo P2 completo, não alterou thresholds, não iniciou P3 e não substituiu o FFmpeg como compositor.
