# YouTube AI Factory × Aethera Studio — análise de integração

> Data: 2026-11-17. Escopo: somente leitura. Nada foi instalado e nenhum código do produto foi alterado.
> Fontes externas, com citações linha a linha: [youtube-factory-external-sources.md](youtube-factory-external-sources.md) (prefixos `YF:` = sasj93/YoutubeFactory, `FS:` = kajisho5/ffmpeg-skill).
> Fontes internas: código do repositório no commit `1f19706`, mais o working tree atual (inclui a correção ainda não commitada de `cinema-pipeline.ts` descrita em `FIRST-VIDEO-RECOVERY.md`).

---

## 0. Conclusão

1. **O YoutubeFactory não deve ser integrado como código.** O repositório não tem LICENSE, ou seja, todos os direitos são reservados. Ele tem 2 commits, nenhum teste, e o orquestrador quebra na execução: `YF:scripts/build_episode.py:209` atribui um atributo a um `dict`, o que levanta `AttributeError` para todo bloco sem card. Ele também depende de `yt-dlp` para baixar vídeos do YouTube e de rotação de chaves Gemini para driblar cota, o que viola os Google APIs Terms §2(d). **O que vale são cinco ideias**, a serem reimplementadas em TypeScript:
   - timing guiado pelo áudio real;
   - alinhamento do roteiro canônico com o ASR;
   - corte de cena ancorado na palavra falada;
   - paginação de legendas PT-BR sem preposição órfã;
   - regras de clipe sem frame congelado.
2. **O ffmpeg-skill (MIT, ~1.800 testes, CI no Windows) é o único componente externo que vale reutilizar como está**, com versão fixada e chamado por subprocesso:
   - `check.py --platform youtube --content --json` como gate de entrega;
   - `look.py` para gerar a prancha de QA visual.
   - Ele não usa NVENC e não substitui o renderer do Aethera.
3. **HyperFrames: descartar.** Duplica o Remotion, carrega GSAP de CDN no YF e acrescentaria um segundo compositor baseado em Chromium.
4. **Para o alinhamento por palavra, faster-whisper é a melhor opção (MIT).** Ele deve rodar em processo sidecar, com CPU int8 por padrão. Antes dele, vale verificar duas alternativas sem nova dependência:
   - o endpoint de timestamps da ElevenLabs, quando ela é a voz escolhida;
   - o Whisper já servido pelo VoiceStudio.
   - O FFmpeg 8.1 instalado nesta máquina também traz um filtro `whisper` (whisper.cpp). Ele fica como último fallback.
5. **A causa mais provável de um vídeo "completo, mas incoerente" não está no que falta copiar.** Está em três defeitos do renderer atual, descritos em §2: timing estimado em vez de medido, narração truncada pelo `atrim` e trilha/SFX sintéticos de placeholder. Corrigir esses três dá mais retorno que qualquer integração externa.

### Fato importante sobre o Remotion
O pedido parte de "preservar o Remotion como motor principal". **Hoje o MP4 do pipeline Cinema (Aethera) não passa pelo Remotion.** Ele é montado por FFmpeg em `renderRealCinemaMp4` (`packages/cinema/src/render/real-renderer.ts:308`), chamado em `apps/aethera-desktop/src/main/cinema-pipeline.ts` nos passos de prévia, re-render e masters.

O Remotion existe no caminho Velix/Motion e no editor:
- `apps/desktop/motion/render-worker.mjs`: `renderMedia` em processo isolado, `concurrency: 2`;
- composição `aethera-timeline`, compilada por `@neuralbridge/shared/aethera-timeline-composition` e usada em `packages/desktop-shared/src/main/index.ts:870,1009,1162,1183`.

**Recomendação:** preservar o Remotion como motor de motion graphics, editor e prévia, e não migrar o compositor do Cinema antes do primeiro vídeo. A evidência técnica para isso:
- o caminho FFmpeg já tem mixagem por stems, loudnorm em dois passes, NVENC com fallback, cache de cenas e probe de entrega, tudo coberto por testes;
- migrá-lo agora seria reconstrução, que o objetivo pede para evitar.

O Remotion entra no Cinema como camada de overlay (P5). A migração completa do compositor fica para uma decisão posterior, baseada em benchmark. Lembrete de licença: o Remotion é gratuito só para indivíduos e empresas de até 3 pessoas; acima disso exige licença comercial (§6.2 do dossiê).

---

## 1. O que o Aethera já tem

| Área | Implementação existente | Evidência |
|---|---|---|
| Pipeline em estágios com pausa | interpretação → pesquisa → roteiro → decupagem → aquisição → validação visual → planejamento → montagem → áudio/SFX/VFX → prévia → editor; pausas `paused_pending_research/script/media` | `cinema-pipeline.ts:1237-2817`, `:109-111` |
| Pesquisa e roteiro por agentes, com fallback e cooldown | classificação de quota, rate limit e auth; cooldown persistente; cadeia de fallback | `production-agent-providers.ts:63,630,665` |
| Pesquisa de mídia multi-provedor | YouTube, stock (Pexels/Pixabay/Mixkit), Steam, IGDB, RAWG, Hugging Face, anime | `packages/cinema/src/analysis/media-providers/adapters/*` |
| Classificação e licenciamento de mídia | `classification.ts`, `licensing.ts`; YouTube nunca vira `stock_video` | `classification.ts:181`, `semantic-media.ts:283-285,491` |
| Scene Grounding e gate semântico | gate de relevância (1.078 linhas), plano de cobertura, aprovação de mídia, frames distribuídos com VisionRouter | `qc/media-relevance-gate.ts`, `analysis/media-coverage-planner.ts`, `analysis/media-approval.ts`, `test/scene-grounding-e2e.test.ts` |
| Mídia pendente nunca é aprovada automaticamente | pausa com planos de recuperação editorial; nenhum Motion Visual é autorizado sozinho | `cinema-pipeline.ts:2085-2098` |
| Códigos de falha de download | `timeout`, `anti_bot`, `http_error`, `format_unavailable`, `invalid_file`, `cancelled`, `other` | `resilient-media-sources.ts:753-775` |
| TTS | ElevenLabs → VoiceStudio (voz `9190edfa`) → Windows SAPI → procedural; cache por segmento; dicionário de pronúncia; direção de voz por WPM | `real-renderer.ts:215-285,777-818`, `audio/voice-director.ts` |
| QA de narração | ritmo por segmento (>260 ou <85 ppm) | `voice-director.ts:301-316` |
| Mixagem | stems (voz, música, SFX, ambiência, master), ducking por `sidechaincompress`, loudnorm EBU R128 em **dois passes** (−14 LUFS / −1 dBTP) | `real-renderer.ts:935-947,987-1020` |
| Encode | `h264_nvenc` com fallback para `libx264`; perfis de entrega preview/master; validação de entrega | `real-renderer.ts:1026-1094` |
| QA técnico do MP4 | blackdetect, freezedetect, silencedetect, LUFS, true peak, delta A/V (>0,2 s gera achado) | `qc/real-media-probe.ts:69,247-254` |
| Crítico visual e reparo | crítico do MP4 renderizado → supervisor → re-render só das cenas afetadas | `cinema-pipeline.ts` (bloco de prévia), `qc/visual-critic.ts` |
| Contrato de produção | requisitos, evidências e recuperações registradas | `production-contract.ts`, `cinema-pipeline.ts` (`recordStageEvidence`) |
| Remotion | worker isolado, composição `aethera-timeline`, editor com assistente | `apps/desktop/motion/render-worker.mjs`, `AetheraEditorMode.tsx` |
| Kit de SFX licenciado | descoberta do kit MotionVelix com SHA-256 e evidência de licença | `packages/workspace/src/aethera-sfx.ts:8-25` |
| ComfyUI | gate de personagem, controle regional e perfis de qualidade | commits `1f19706`…`d96b8d0` |
| Ambiente | FFmpeg 8.1 (gyan full) com libass, `subtitles`/`ass`, `ebur128`, `scdet`, `libvmaf`, NVENC H.264/HEVC/AV1 e filtro `whisper`; RTX 4060 Ti 8.188 MiB; Python 3.14.3 | `ffmpeg -filters/-encoders`, `nvidia-smi` |

---

## 2. Lacunas reais (por impacto no primeiro vídeo)

### L1 — O timing vem de estimativa, e a narração pode ser cortada (crítica)
- A duração das cenas vem de `estimatedDurationSec`, a estimativa do roteiro (`editorial/research-and-decupagem.ts:728-731`).
- O TTS só é sintetizado **dentro** do renderer, depois que a timeline já está fechada (`real-renderer.ts:777-845`).
- Na mixagem, a narração recebe `apad=whole_dur=totalDur` e o mix final aplica `atrim=0:totalDur` (`:935,947`). **Se a voz real for mais longa que a soma das cenas, o fim da narração é cortado em silêncio.** Se for mais curta, sobra imagem sem fala.
- O `audioTimeline` registra `endMs = min(medido, total)` (`:855`). Isso esconde o corte em vez de reportá-lo.
- Consequência: dessincronia entre cena e fala que nenhum gate atual bloqueia. O probe compara só a duração do *container* de vídeo com a do de áudio, e as duas são iguais porque o áudio foi aparado.
- O YoutubeFactory faz o inverso: **o áudio vem primeiro** e as cenas são cortadas sobre os tempos reais das palavras (`YF:build_episode.py:134-201`). Essa é a ideia mais valiosa do projeto.

### L2 — As legendas não têm tempo real de palavra (alta)
- As legendas são `drawtext` por clipe da trilha `sub1`, com `enable=between(t,…)` herdado dos tempos do clipe (`real-renderer.ts:693-720`).
- Não há tempo por palavra, karaokê, paginação nem libass.
- A ElevenLabs é chamada no endpoint simples `/v1/text-to-speech/{voice}` (`render/elevenlabs-tts.ts:57`), sem pedir alinhamento.
- O Whisper aparece só como flag degradada (`analysis/media-intelligence.ts:96`) e como ditado de texto puro no VoiceStudio (`desktop-shared/src/main/voicestudio-whisper-provider.ts`).

### L3 — A trilha sonora é placeholder sintético (alta, qualidade profissional)
- A "música" são três senoides: 110, 164,81 e 220 Hz.
- A ambiência é ruído rosa.
- Os "SFX" são três bipes senoidais em posições fixas, a 25 %, 50 % e 75 % da duração, limitados a 5,6/11,2/16,8 s (`real-renderer.ts:928-946`). **Eles não coincidem com as transições.**
- O kit de SFX licenciado do MotionVelix já existe em `workspace/aethera-sfx.ts`, mas não é usado pelo Cinema.

### L4 — Voz degradada passa sem gate (alta, semântica e qualidade)
- `narrationMode` pode virar `windows_sapi_tts` ou `procedural_voice_fallback`.
- Nenhum consumidor bloqueia ou pausa por causa disso: a busca no código fora do renderer não retorna nada.
- Isso é exatamente "aprovar resultado degradado automaticamente". Precisa virar revisão humana.

### L5 — Os erros não seguem uma taxonomia única (média)
- Existem pausas por insumo (research/script/media) e códigos de download, mas não um resultado final classificado em **erro técnico × mídia indisponível × revisão humana**.
- Há também um bug no tratamento de erro: em `cinema-pipeline.ts:2827-2829` o código faz `job.state = 'error'` e **depois** monta `Falha na etapa "${job.state}"`. A mensagem sempre diz `"error"` e perde a etapa real.

### L6 — O gate de entrega é incompleto (média)
- O `real-media-probe` cobre preto, congelado, silêncio, LUFS e delta A/V.
- Faltam conformidade com a plataforma (pix_fmt, tags de cor, faixa legal), flash frames de 1 frame, dropouts digitais e prancha visual para revisão.
- O `FS:check.py --content` cobre exatamente isso (dossiê §3).

### L7 — Não há E2E real de produção (média)
- `scene-grounding-e2e.test.ts` e os testes de `packages/cinema/test` renderizam MP4 real, mas com mídia sintética e visão simulada.
- Não existe teste que leve **prompt → pesquisa → TTS real → aquisição real → MP4 de 60 s** e o reprove por critérios objetivos.
- A correção da conclusão prematura de etapas (`FIRST-VIDEO-RECOVERY.md`) também ainda não foi validada em execução real.

### L8 — Motion graphics limitados (baixa para o primeiro vídeo)
- Headlines e cards são feitos com `drawtext` (`real-renderer.ts:528-531`).
- O Remotion, que faria isso com qualidade, não está ligado ao Cinema.

### Não são lacunas
Pesquisa multi-fonte, grounding semântico, fallback de agentes, loudnorm em dois passes, NVENC, cache incremental e crítico visual. Em todos esses o Aethera **já está à frente** dos dois projetos externos. O YF não tem grounding semântico, só palavra-âncora, e seu QA cobre apenas freeze e LUFS.

---

## 3. Componentes recomendados

| # | Componente | Decisão | Como entra no Aethera |
|---|---|---|---|
| C1 | **Timing guiado pelo áudio** (ideia do YF) | Adaptar (TS próprio) | Novo passo `narracao` entre roteiro/decupagem e planejamento: sintetiza os segmentos, mede e grava `measuredDurationSec` por segmento. A decupagem passa a usar o valor medido. O renderer recebe a narração pronta e **nunca** a apara. |
| C2 | **Alinhamento roteiro↔ASR** (ideia do YF: `difflib` + interpolação) | Adaptar (TS) | `alignScriptToWords(scriptTokens, asrWords)` com LCS e interpolação por caracteres; a saída são tempos por palavra do **texto canônico**. |
| C3 | **Provedor de tempos de palavra** | Cadeia | 1) ElevenLabs com timestamps, quando ela é a voz (sem custo extra de GPU; **endpoint a confirmar na doc oficial**). 2) Whisper do VoiceStudio, se aceitar `verbose_json` com granularidade de palavra (**não verificado**). 3) **faster-whisper** em sidecar Python, `small`/`medium`, CPU int8 por padrão, GPU int8 opcional. 4) Filtro `whisper` do FFmpeg 8.1 (precisa de modelo ggml; precisão por palavra **não verificada**). |
| C4 | **Corte na palavra-âncora** (−0,09 s, ideia do YF) | Adaptar | Snap dos limites de cena para o início da palavra-chave do segmento, com tolerância; respeita a duração mínima de 1,0 s. |
| C5 | **Legendas ASS com libass** + paginação PT-BR (ideia do YF; escape de caminho como em `FS:_common/decision.py:359-371`) | Adaptar | Gerar `.ass` com `fontsdir` explícito (evita fallback silencioso de fonte) e trocar o `drawtext` das legendas por `ass=`. Palavra ativa destacada; sem preposição órfã; entidades atômicas ("R$ 10", "GTA 6"). |
| C6 | **Kit de SFX/música licenciado** | Reutilizar (interno) | Usar `discoverMotionVelixSfx` e uma biblioteca de música com manifesto de licença; SFX posicionados nas transições reais. A ideia do `YF:sfx_gen.py` (síntese com seed) pode virar fallback **declarado**, nunca silencioso. |
| C7 | **`FS:check.py --platform youtube --content --json`** | Reutilizar (MIT, tag fixa) | Subprocesso após o encode final; achados mapeados para `QcFindingRecord`, separando bloqueantes de avisos. |
| C8 | **`FS:look.py`** | Reutilizar | Prancha de frames para o crítico visual e para a revisão humana. |
| C9 | `FS:loudness.py` | Opcional | O Aethera já faz dois passes; aproveitar só a **medição pós-encoder** (o `check.py` já mede). |
| C10 | `FS:fit/cut/color --to-sdr` | Reutilizar mais tarde (P5) | Normalizar B-roll HDR/VFR antes da montagem, se aparecer na aquisição real. |
| C11 | Remotion como camada de motion graphics | Adaptar (interno) | Renderizar lower-thirds, cards e títulos como overlay com alfa e compor no FFmpeg; usar `render-worker.mjs` já isolado. |
| — | YF orquestrador, `.ass` literal, `hf_cards`, edge-tts, rotação Gemini, `broll_tools` (yt-dlp) | **Descartar** | Sem licença, bug fatal, risco de ToS ou duplicação (dossiê §9) |
| — | HyperFrames | **Descartar** | Duplica o Remotion; segundo Chromium; sem ganho comprovado (benchmark do fornecedor não conclusivo) |
| — | `FS:render.py`, `FS:caption.py` burn-in, `FS --hw` | **Descartar** | Concorre com o renderer; sem NVENC |

---

## 4. Riscos e incompatibilidades

### Licenças e termos
- **YoutubeFactory sem licença:** não copiar código, nem trechos. Reimplementar só as ideias.
- **ffmpeg-skill (MIT):** se for vendorizado, manter LICENSE e copyright e registrar em `docs/THIRD-PARTY.md`. Fixar tag (o `CHANGELOG` do FS recomenda).
  - O clone traz um `.claude/settings.json` que habilita plugins de marketplace. Não abrir o clone como workspace do Claude Code; o instalador `npx` não copia esse diretório.
- **Remotion:** licença comercial obrigatória para empresas com mais de 3 pessoas. Confirmar o enquadramento antes de distribuir.
- **FFmpeg com libx264 é GPL.** Se o instalador do Aethera distribuir o binário, isso afeta a distribuição. Já há `docs/THIRD-PARTY.md`; revisar lá.
- **Risco já presente no Aethera:** download do YouTube via `yt-dlp` (`media-sources-service.ts`, `cinema-pipeline.ts`, `aethera-ipc.ts`, `creative-authentic-media.ts`). Os Termos do YouTube proíbem acesso automatizado sem permissão, e reusar trailers e gameplay traz risco de Content ID.
  - Isso não vem da integração, mas o primeiro vídeo **publicável** deve priorizar fontes com licença explícita (stock, oficial, gerado no ComfyUI) e registrar a evidência de licença de cada clipe.
- **edge-tts:** LGPLv3 e serviço não oficial. Não usar em produção.
- **Gemini com várias chaves:** proibido (ToS §2(d)).

### Windows
- **faster-whisper na GPU:** desencontro CTranslate2 × cuDNN 9 × cuBLAS 12 causa `cudnn_ops64_9.dll` ou `cublas64_12.dll not found`. Mitigação: CPU int8 por padrão, que para 60–120 s de áudio leva segundos com o `small` (o benchmark do README dá 13 min de áudio em 1 min 42 s em CPU de 8 threads).
- **Python 3.14.3 é o interpretador global.** A disponibilidade de wheels de `ctranslate2` para 3.14 **não foi verificada**. Usar venv isolado com 3.11/3.12, gerenciado pelo app, nunca pip global.
- **Fontes:** `drawtext` e `ass` dependem de fontconfig. O FS documenta travamento do `drawtext` com fontconfig em builds gyan 9.x. O Aethera já resolve `fontfile` (`resolveFontOption`); para ASS, passar `fontsdir`.
- **Escape de caminho** em `ass=`/`subtitles=` com `C:\`: usar caminho relativo com `cwd=workDir` (padrão do YF) ou o escape do FS.
- **Concat lists com apóstrofo:** o Aethera já escapa (`real-renderer.ts:825`).

### Recursos na RTX 4060 Ti 8 GB
- ComfyUI com SDXL ocupa ~6–7 GB. faster-whisper large-v2 em int8 usa ~2,9 GB (README, em placa de 8 GB). **Os dois juntos na GPU podem estourar a VRAM.**
  - Regra: estágios de GPU serializados por um *lease* (ComfyUI descarrega o modelo antes do ASR na GPU), ou ASR em CPU.
- NVENC usa um ASIC dedicado e pouca VRAM; não compete de forma relevante.
- Remotion: `concurrency: 2` = 2 Chromium. Na etapa de overlay, manter 2 e medir RAM.
- O `check.py` do FS roda em CPU (x264 e análise), com timeout padrão de 1.800 s. Para 60 s de vídeo, o custo esperado é baixo (**medir**).

### Técnicos
- **C1 muda contratos:** a decupagem passa a depender do TTS. Isso invalida caches de timeline quando a voz muda; a chave de cache precisa incluir `voiceId|model|texto`, como já faz `voice-director.ts:206`.
- **Custo de TTS antecipado:** se a mídia ficar pendente, a narração já foi paga. O cache por segmento evita pagar de novo na retomada.
- **ASR sobre a própria voz sintética** é muito preciso, mas nomes próprios estrangeiros podem falhar. O alinhamento contra o roteiro canônico com interpolação cobre esses buracos, e eles são reportados como cobertura.

---

## 5. Plano incremental

Cada lote = implementação + testes + commit local, na ordem abaixo. P0–P3 e P6 formam o caminho mínimo até o primeiro vídeo.

### P0 — Base confiável (pré-requisito)
1. Validar em execução real a correção ainda não commitada de `cinema-pipeline.ts`: `aquisicao stage_completed` só depois dos downloads.
2. Corrigir a mensagem de erro em `cinema-pipeline.ts:2827`: guardar a etapa antes de mudar o estado.
3. Criar a taxonomia `ProductionOutcome`:
   - `technical_error`: exceção, FFmpeg com código ≠ 0, timeout, OOM. Retry automático limitado e idempotente.
   - `media_unavailable`: nenhum candidato aprovado após a recuperação, ou falha de download classificada. Pausa `paused_pending_media` com plano de recuperação.
   - `needs_human_review`: voz degradada, cobertura semântica abaixo do limiar, conflito de licença, gate visual inconclusivo. Pausa nova `paused_pending_review`.
4. Gate de voz: `windows_sapi_tts` ou `procedural_voice_fallback` → `needs_human_review`. Nunca entregar como final.
- **Testes:**
  - unidade: classificador de outcome com tabela de erros, cobrindo os 3 tipos e os códigos de download;
  - integração: pipeline com TTS falso que devolve `procedural` termina em `paused_pending_review`;
  - integração: falha injetada no FFmpeg termina em `technical_error` com a etapa correta na mensagem.

### P1 — Timing guiado pelo áudio (resolve L1)
1. Novo estágio `narracao`, depois da aprovação do roteiro e antes da decupagem final. Usa o `voice-director` e a mesma cadeia de TTS e cache. Grava `segments[].{wavPath, measuredDurationSec, cacheKey}` no job.
2. A decupagem usa `measuredDurationSec` (+ pausa do segmento) como duração da cena. `estimatedDurationSec` vira só planejamento de aquisição.
3. O renderer aceita `prebuiltNarration` e não sintetiza de novo. Remover o `atrim` da voz: se `narração > vídeo`, o renderer **falha** com `technical_error` (contrato violado) em vez de cortar.
4. `audioTimeline` sem `min()` silencioso.
- **Testes:**
  - unidade: decupagem com durações medidas; soma das cenas = narração ± 1 frame;
  - unidade: o renderer rejeita narração maior que o vídeo;
  - integração: TTS falso com durações conhecidas (ffmpeg `sine`) → MP4 com |vídeo − narração| ≤ 0,10 s.

### P2 — Tempos de palavra, legendas ASS e corte na âncora (resolve L2)
1. `WordTimingProvider` com a cadeia de C3. Implementar primeiro o sidecar faster-whisper:
   - venv isolado gerenciado pelo app;
   - CPU int8 `small`, `language` do job, `word_timestamps=True`, `condition_on_previous_text=False`;
   - entrada WAV, saída JSON;
   - timeout e classificação de falha.
   - Antes disso, verificar se a ElevenLabs e o VoiceStudio já entregam tempos por palavra. Se entregarem, eles vêm primeiro na cadeia.
2. `alignScriptToWords`: LCS sobre tokens normalizados (NFKD, sem acento, minúsculas) e interpolação por caracteres nas lacunas. Reportar `coverage`.
3. Gerador ASS próprio:
   - `PlayRes` igual à resolução de saída;
   - paginação PT-BR (limites short 28 car./1,65 s; long 54 car./2,40 s, como referência do YF);
   - palavra ativa destacada;
   - safe area do perfil de entrega;
   - `fontsdir` com a fonte do projeto.
   - O render troca o `drawtext` das legendas por `ass=`.
4. Snap dos limites de cena para a palavra-âncora (−0,09 s), respeitando o mínimo de 1,0 s por cena.
- **Testes:**
  - unidade: alinhamento com ASR com palavras faltando ou trocadas; paginação sem órfãs; entidades atômicas; escape de caminho Windows;
  - integração: WAV gerado por TTS real ou fixture gravada → sidecar → tempos com cobertura ≥ 95 %;
  - integração: ASS renderizado (frame em t de uma palavra conhecida contém a legenda esperada, via OCR ou comparação de crop).

### P3 — Trilha e SFX profissionais (resolve L3)
1. Música de biblioteca com manifesto de licença (local e escolhida pelo usuário ou pelo diretor de som). Sem música licenciada, usar **silêncio + ambiência discreta** e marcar no relatório; nunca senoides.
2. SFX do kit MotionVelix nas transições reais (`timelineRange.start` de cada cena, −0,04 s), com densidade limitada pelo `sound-director`.
3. Manter ducking, stems e loudnorm em dois passes.
- **Testes:**
  - unidade: posicionamento dos SFX igual às transições; manifesto de licença obrigatório;
  - integração: stems medidos (pico de SFX dentro de ±1 frame da transição).

### P4 — Gate de entrega com ffmpeg-skill (resolve L6)
1. Obter o ffmpeg-skill numa **tag fixa**, com checksum registrado, em `tools/ffmpeg-skill/` ou cache do app, mais a LICENSE MIT. Chamar `python check.py <mp4> --platform youtube --content --json` em subprocesso com timeout.
2. Mapear o JSON para `QcFindingRecord`:
   - FAIL de spec, preto, congelado ou flash → bloqueante;
   - WARN → aviso no contrato.
3. `look.py` gera a prancha anexada ao crítico visual e à tela de revisão.
4. Se o Python ou o FS não estiver disponível, o gate vira `technical_error` **declarado**. Ele não é pulado em silêncio; o probe interno continua valendo.
- **Testes:**
  - unidade: parser com fixtures JSON reais do FS;
  - integração: MP4 com defeito injetado (`injectRealBlackFrameDefect` já existe no renderer) → reprovado.

### P5 — Motion graphics em Remotion (resolve L8; depois do primeiro vídeo)
1. Composição Remotion de overlay (título, lower-third, card de tópico sincronizado às palavras de P2), renderizada com alfa (ProRes 4444 ou PNG sequence) pelo `render-worker.mjs`.
2. Composição por `overlay` no FFmpeg.
3. Decisão registrada: depois de P0–P4 e de um benchmark, avaliar se o compositor inteiro do Cinema migra para `aethera-timeline`.
- **Testes:** snapshot de frame do overlay e integração com o MP4 final.

### P6 — E2E real de 60 s (aceite final)
- Teste opt-in (`AETHERA_E2E_REAL=1`), fora do CI comum, que roda o pipeline completo com:
  - prompt fixo;
  - agentes reais com fallback;
  - TTS real (VoiceStudio ou ElevenLabs);
  - aquisição real com fontes licenciadas;
  - ComfyUI opcional;
  - duração alvo de 60 s.
- Ele grava um relatório JSON com todas as medições de §6.
- Rodar 2 vezes:
  - uma do zero (cache limpo);
  - uma retomada com cache, para checar reprodutibilidade.

---

## 6. Critérios objetivos de aprovação (E2E de 60 s)

| # | Critério | Limite |
|---|---|---|
| A1 | Arquivo | MP4 existe; `ffprobe`: H.264, `yuv420p`, 1920×1080 (master) ou o perfil pedido, 30 fps CFR, AAC 48 kHz estéreo, `+faststart` |
| A2 | Duração | 60 s ± 3 s |
| A3 | Sincronia de container | \|vídeo − áudio\| ≤ 0,10 s |
| A4 | Narração íntegra | última palavra alinhada termina ≤ duração − 0,3 s; zero segmentos aparados; `coverage` do alinhamento ≥ 95 % |
| A5 | Fidelidade da fala | WER do ASR contra o roteiro canônico ≤ 10 % |
| A6 | Legenda | mediana \|início da legenda − início da palavra\| ≤ 80 ms; p95 ≤ 200 ms; 100 % dentro da safe area; 0 linhas terminando em artigo ou preposição |
| A7 | Corte de cena | ≥ 90 % dos cortes a ±150 ms da palavra-âncora; nenhuma cena < 1,0 s |
| A8 | Loudness | integrado −14 ± 1 LUFS; true peak ≤ −1,0 dBTP (medido **depois** do encode) |
| A9 | Integridade visual | 0 trechos pretos ≥ 0,5 s (exceto fade intencional ≤ 0,5 s); 0 congelamentos ≥ 0,5 s (exceto still marcado como still); 0 flash frames; `FS:check.py` sem FAIL |
| A10 | Áudio | 0 silêncios > 1,0 s dentro da região de narração; SFX a ±1 frame das transições; trilha com manifesto de licença |
| A11 | Semântica | 100 % dos clipes com `MediaRelevanceDecision` aprovada pelo gate; 0 aprovações abaixo do limiar; 0 placeholders ou Motion Visuals sem autorização humana registrada |
| A12 | Voz | `narrationMode` ∈ {`elevenlabs_tts`, `voicestudio_tts`} |
| A13 | Licença de mídia | 100 % dos clipes com evidência de licença ou origem registrada no contrato |
| A14 | Classificação de falhas | testes de injeção produzem exatamente 1 dos 3 outcomes para cada caso; mensagem com a etapa real |
| A15 | Reprodutibilidade | retomada com cache gera o mesmo hash de timeline IR, a mesma duração de narração (±1 frame) e passa nos mesmos gates |
| A16 | Recursos | render dos 60 s (sem aquisição) ≤ 10 min na 4060 Ti; pico de VRAM ≤ 7,5 GB; nenhum OOM; nenhum processo órfão (FFmpeg, Python, Chromium) após o término ou cancelamento |
| A17 | Etapas | nenhum `stage_completed` antes do fim real do trabalho da etapa (log do tracker) |

**A entrega é aprovada só com A1–A17 verdes.** Qualquer item de A4–A7, A11–A13 vermelho por causa não técnica gera `needs_human_review`, nunca aprovação automática.

---

## 7. Itens não verificados (resolver no início de P2/P4)
- Formato exato do endpoint de timestamps da ElevenLabs e custo adicional. Consultar a doc oficial antes de implementar.
- Se o Whisper do VoiceStudio aceita `response_format=verbose_json` com `timestamp_granularities[]=word`.
- Wheels de `ctranslate2`/`faster-whisper` para o Python escolhido para o venv.
- Precisão por palavra do filtro `whisper` do FFmpeg 8.1 (`max_len=1`, `format=json`) e o backend de GPU do build gyan.
- Comportamento real do `FS:check.py` neste FFmpeg 8.1: rodar o `doctor` do FS em ambiente isolado.
- Enquadramento da licença do Remotion para o uso do Aethera.
