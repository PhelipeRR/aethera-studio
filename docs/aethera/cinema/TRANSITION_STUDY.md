# TRANSITION_STUDY — Aethera Transition Academy

**Objetivo:** Transformar o Aethera Studio em um editor inteligente orientado pela narrativa, capaz de decidir **quando cortar seco e quando usar uma transição**, sincronizar áudio/SFX/VFX e validar qualidade objetiva e editorial antes da aprovação.

---

## 1. As 8 Trilhas Práticas da Academy

| Trilha | Tema Central | Foco de Engenharia e Direção no Aethera |
| :--- | :--- | :--- |
| **01 — Fundamentos de montagem** | Continuidade, ritmo, gramática visual, cortes invisíveis, J-cut e L-cut | Corte seco como opção de primeira classe; regra dos 30°; antecipação/extensão sonora (`J-cut`/`L-cut`). |
| **02 — Movimento e física visual** | Easing, curvas de velocidade, motion blur, speed ramps e correspondência de direção | Conservação de momento entre saída da Cena A e entrada da Cena B; `cubic-bezier` / `spring` no Remotion; `minterpolate` / `tblend` no FFmpeg. |
| **03 — Transições de impacto** | Flash, shake, zoom punch, energy wipe, glitch e sincronização com golpes/batidas | Limite de segurança fotossensível (`flashRateHz < 3 Hz` por janela no `Visual Critic`); alinhamento do pico de impacto no frame exato do corte (`offset`). |
| **04 — Composição e VFX** | Máscaras, profundidade, parallax, partículas, tracking e integração de cenas | Reuso do `VFX_CATALOG` (`feathered_mask`, `chromatic_aberration_light`, `particles_ambient`) sem competir com legendas ou sujeito principal. |
| **05 — Sound design** | Whooshes, risers, impacts, sub-drops, silêncio e transições musicais | Envelopes de antecipação (`-180ms` a `0ms`), pico (`0ms`), decaimento (`+250ms`), ducking de narração e `acrossfade` sem clipping (`<= -1.0 dBTP`). |
| **06 — Direção editorial inteligente** | Escolha de transição conforme gênero, emoção, ritmo e conteúdo das cenas | Matriz de decisão entre `cut`, `j_cut`/`l_cut`, `dissolve`, `impact_cut`, `glitch`, `wipe` e `shape_wipe` registrada no `TimelineTransition.reason`. |
| **07 — Engenharia e otimização** | Remotion `4.0.539`, FFmpeg `8.1`, GPU (RTX 4060 Ti 8 GB), cache incremental e fallback | Uso de `xfade` / `h264_nvenc` / `libshaderc` no FFmpeg; fallback automático para `cut` ou `fade` simples se algum filtro/agente falhar. |
| **08 — Aprendizado contínuo** | Comparação de variantes (seco vs. discreta vs. expressiva), revisão humana e regressão | Estados separados no `AetheraEvolutionCore`: `studied` -> `hypothesis` -> `validated_experiment` -> `approved_preference`. |

---

## 2. Fontes Oficiais de Referência (Verificadas)

1. **Remotion — Transitions & `TransitionSeries`** (`remotion.dev/docs/transitioning`, `transitions/transitionseries`):
   - `TransitionSeries` sobrepõe o fim da Cena A com o início da Cena B pela duração `timing.getDurationInFrames({ fps })`, encurtando a duração total da composição.
   - Versão instalada no workspace: **`remotion@4.0.539`** (`@remotion/transitions` ainda não instalado — ao instalar, habilita `springTiming`, `linearTiming` e apresentações como `slide`, `wipe`, `fade`, `flip`, `clockWipe` e custom timings).
2. **Remotion — Custom Timings** (`remotion.dev/docs/transitions/timings/custom`):
   - Curvas `getProgress(frame)` determinísticas por frame para sincronizar aceleração com curvas de áudio/SFX.
3. **FFmpeg 8.1 — Filters (`xfade`, `acrossfade`, `overlay`, `zoompan`, `rgbashift`, `boxblur`)**:
   - `ffmpeg -h filter=xfade` confirma **58 transições nativas** (`fade`, `fadeblack`, `fadewhite`, `dissolve`, `pixelize`, `radial`, `hblur`, `zoomin`, `smoothleft/right/up/down`, `wipe*`, `slide*`, `circleopen/close`, `custom`).
   - Regra crítica de timing: `offset = duracaoAcumulada - durationTransicao`; `acrossfade` deve usar curvas `tri` / `qsin` / `esin` conforme tipo de energia do corte.

---

## 3. Critérios de Aprovação e Bloqueadores Graves

| Dimensão | Peso | Critério Objetivo de Avaliação |
| :--- | :---: | :--- |
| **Coerência narrativa** | **25%** | A transição reforça a mudança de tempo, espaço, assunto ou impacto sem distrair da narração. |
| **Continuidade e fluidez** | **20%** | Direção de movimento, linha do olhar e ritmo entre Cena A e Cena B preservados. |
| **Sincronização musical e SFX** | **15%** | Pico da transição alinhado à batida/golpe; ausência de corte abrupto de fala ou colisão com narração. |
| **Qualidade visual e VFX** | **15%** | Sem artefatos de compressão, banding, ghosting ou motion blur excessivo. |
| **Legibilidade e composição** | **10%** | Legendas, HUD e títulos permanecem legíveis dentro da SafeZone durante toda a transição. |
| **Diversidade sem exageros** | **10%** | Evitar repetição mecânica da mesma transição em cortes consecutivos; priorizar corte seco quando melhor. |
| **Desempenho de renderização** | **5%** | Custo computacional compatível com o perfil (1080p30/60, 9:16) e fallback seguro disponível. |

### Bloqueadores Imediatos (Reprovação Automática Independentemente da Nota)
- **Frame preto não intencional** (gap de offset ou falha de decodificação).
- **Áudio cortado ou clipping** (`truePeak > -1.0 dBTP` ou corte no meio de fonema).
- **Transição quebrada** (descontinuidade brusca de aspecto/resolução ou erro de filtro).
- **Excesso fotossensível** (flash > `3 Hz` sem justificativa/aviso ou flash branco contínuo).
- **Conteúdo visual incorreto** (rejeitado pelo `Media Relevance Gate` / `Visual Critic`).
