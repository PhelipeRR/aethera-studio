# TRANSITION_AUDIT — Fase 0: Auditoria Obrigatória do Repositório

**Data:** 2026-11-14  
**Escopo:** Inspeção real de código, dependências e ferramentas instaladas no `neuralbridge-studio` antes de implementar ou expandir o motor de transições da Aethera Academy.

---

## 1. Ferramentas e Dependências Reais Verificadas

| Componente | Versão / Estado Real | Evidência no Repositório / Ambiente |
| :--- | :--- | :--- |
| **FFmpeg** | `8.1-full_build-www.gyan.dev` (GPL, `nvenc`, `vulkan`, `libshaderc`, `libplacebo`, `opencl`) | `ffmpeg -version` + `ffmpeg -h filter=xfade` (`58` transições `xfade` nativas: `-1 custom` e `0..57`) |
| **Remotion** | `4.0.539` (`remotion`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/player`, `@remotion/captions`, `@remotion/media-utils`) | `apps/desktop/package.json` e `node_modules/@remotion/*` |
| **@remotion/transitions** | **Ausente** (não instalado em `node_modules/@remotion`) | Verificação direta em `node_modules/@remotion` |

---

## 2. Matriz de Maturidade por Módulo

| Módulo | Arquivo | Estado | O que já existe hoje | Lacunas identificadas |
| :--- | :--- | :--- | :--- | :--- |
| **Timeline IR** | [timeline-ir.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/ir/timeline-ir.ts#L90-L97) | **Parcial** | `TimelineTransition` tipa apenas 6 `kind`: `'cut' \| 'dissolve' \| 'j_cut' \| 'l_cut' \| 'match_cut' \| 'wipe'`, com `duration: RationalTime` e `reason`. | Não registra metadados de easing, direção, sync musical, justificativa comparativa contra corte seco nem parâmetros de VFX/SFX. |
| **Cinematography Director** | [cinematography-director.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/director/cinematography-director.ts#L50-L78) | **Parcial** | `allowedTransitions` e `transitionIn` usam os mesmos 6 tipos; atribuição heurística simples (`idx === 2 ? 'j_cut' : 'cut'`). | Não avalia movimento de câmera, batida musical, contraste visual entre cenas nem regras aprendidas da Academy. |
| **Editorial Engine** | [editorial-engine.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/edit/editorial-engine.ts#L85-L105) | **Funcional (básico)** | `applyJLCutTransition` e `upsertClipTransition` atualizam `timeline.transitions` e espelham `effect` `transition` (`transitionKind`, `durationSec`) no clip de destino. | Mapeia `j_cut`/`l_cut` para `fade` genérico no vídeo sem deslocar independentemente a trilha de áudio (`J-cut`/`L-cut` real no renderizador). |
| **Real Renderer (FFmpeg)** | [real-renderer.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/render/real-renderer.ts#L541-L567) | **Parcial** | Aplica `xfade=transition=...:duration=...:offset=...` entre clipes sequenciais, lendo `trEffect.params.transitionKind`. | Quando não há `transitionKind`, alterna às cegas `['fade', 'wipeleft', 'smoothleft', 'slideright', 'dissolve']`; não trata `'cut'` como concatenação direta (0 s) sem `xfade`. |
| **Sound Engine & SFX** | [sound-engine.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/audio/sound-engine.ts#L141-L150) e [real-renderer.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/render/real-renderer.ts#L819-L824) | **Parcial** | `sound-engine.ts` gera cues (`whoosh_soft` para `wipe`, `cut_breath` para os demais); `real-renderer.ts` sintetiza 3 tons `sine` fixos (520/780/440 Hz). | Sem catálogo rico de risers, impacts, sub-drops, glitch SFX ou sincronização de ataque/pico/cauda com o ponto médio da transição. |
| **VFX & Typography** | [vfx-typography.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/vfx/vfx-typography.ts#L5-L60) | **Funcional (isolado)** | `VFX_CATALOG` define 7 efeitos (`soft_glow`, `bloom_subtle`, `particles_ambient`, `volumetric_ray`, `chromatic_aberration_light`, `feathered_mask`, `kinetic_caption`) com `estimatedCostMs` e `fallbackMode`. | Não está conectado como camada auxiliar de transições (ex.: flash, chromatic aberration ou feathered mask no corte). |
| **Visual Critic & QC** | [visual-critic.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/qc/visual-critic.ts) e [benchmark-suite.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/benchmarks/benchmark-suite.ts#L31-L155) | **Parcial** | Detecta `black_frame`, `audio_clipping`, `av_sync_drift` e `epilepsy_flash` (`flashRateHz`). | Não audita descontinuidade de movimento, repetição excessiva da mesma transição, legibilidade de texto durante transição ou desalinhamento SFX/batida. |
| **Aethera Academy & Evolution** | [academy-engine.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/evolution/academy-engine.ts) e [storytelling-school.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/evolution/storytelling-school.ts) | **Funcional (sem trilha de transições)** | Suporta importação de currículos (`packages/cinema/academy-curriculum/`), citações verificadas, exercícios e estados (`studied` → `validated_experiment` → `approved_preference`). | Não possui currículo, catálogo estruturado nem experimentos laboratoriais específicos de transições cinematográficas. |

---

## 3. Conclusão da Auditoria
1. **Não duplicar**: `AetheraAcademyEngine`, `AetheraEvolutionCore`, `TimelineIR`, `VFX_CATALOG`, `SoundEngine` e `real-renderer.ts` (`xfade`) já formam a espinha dorsal.
2. **Alavancar FFmpeg 8.1 imediatamente**: antes mesmo de instalar `@remotion/transitions` (que exige React/Chromium headless), o FFmpeg 8.1 já oferece 58 modos `xfade`, `acrossfade`, `zoompan`, `tblend`, `lut3d`/`eq`, `rgbashift` (aberração cromática), `boxblur`/`gblur`, `overlay` e `blend`.
3. **Prioridade arquitetural**: construir o currículo na `academy-curriculum/`, o módulo `transition-academy.ts` integrado ao `AetheraAcademyEngine` e regras explícitas para o **Intelligent Transition Director** justificar **por que uma transição supera o corte seco** (sem nunca aprovar conhecimento não testado como regra permanente).
