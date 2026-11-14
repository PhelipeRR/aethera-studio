# AETHERA EVOLUTION & AETHERA ACADEMY — Arquitetura e Auditoria (`EVO-00`)

**Data:** 2026-11-14  
**Status:** Auditoria concluída (`EVO-00`); fundação pronta para implementação incremental (`EVO-01` → `EVO-11`).

---

## 1. Inventário Real do Código Existente

### 1.1 Módulos Funcionais Comprovados
| Domínio | Arquivos Principais | Estado Real |
| :--- | :--- | :--- |
| **Direção & Roteiro** | [cinematography-director.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/director/cinematography-director.ts) | **Funcional**: `parseDurationFromPrompt`, `compileCreativeBrief`, `buildStyleBible`, `directNarrativeAndShots` |
| **Humor (35%)** | [comedy-director.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/comedy/comedy-director.ts) | **Funcional**: `planComedyBeats` com bloqueio de cenas sensíveis |
| **Montagem & NLE** | [editorial-engine.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/edit/editorial-engine.ts), [AetheraStudioEditor.tsx](file:///c:/dev/neuralbridge-studio/packages/desktop-shared/src/renderer/src/features/aethera/AetheraStudioEditor.tsx) | **Funcional**: trim frame-accurate, ripple delete, J/L cut, speed ramp, undo/redo, preview `<canvas>`/`<video>` via `aethera-media://` |
| **Áudio & Diretor de Som** | [sound-director.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/audio/sound-director.ts), [sound-engine.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/audio/sound-engine.ts) | **Funcional**: buses `A1`–`A5`, medição real `ffprobe`, gate bloqueador `SoundDirectorBlockedError` |
| **Cor, VFX & Tipografia** | [color-pipeline.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/color/color-pipeline.ts), [vfx-typography.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/vfx/vfx-typography.ts) | **Funcional**: Rec.709, safe-zones e efeitos tipados |
| **Renderizador & VoiceStudio** | [real-renderer.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/render/real-renderer.ts), [velix-narration.ts](file:///c:/dev/neuralbridge-studio/packages/workspace/src/velix-narration.ts) | **Funcional**: VoiceStudio `omnivoice` (`localhost:3900`) + fallback SAPI, FFmpeg `xfade`, `h264_nvenc`, `loudnorm` |
| **Qualidade & Sonda Real** | [qc-engine.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/qc/qc-engine.ts), [real-media-probe.ts](file:///c:/dev/neuralbridge-studio/packages/cinema/src/qc/real-media-probe.ts) | **Funcional**: `ffprobe`, `ebur128`, `blackdetect`, `freezedetect`, `scdet`, `silencedetect` |
| **Persistência Aethera** | [aethera-studio-repository.ts](file:///c:/dev/neuralbridge-studio/packages/database/src/aethera-studio-repository.ts) (+ 6 repositórios `aethera-*`) | **Funcional**: SQLite isolado do Singularity e do Void |
| **RAG & Busca Híbrida** | [rag-engine.ts](file:///c:/dev/neuralbridge-studio/packages/brain/src/rag-engine.ts), [hybrid-search.ts](file:///c:/dev/neuralbridge-studio/packages/brain/src/hybrid-search.ts) | **Existente**: padrão de busca híbrida reutilizável em escopo isolado do Aethera |

### 1.2 Lacunas Identificadas para Evolution & Academy
1. **Equipe de 15 diretores:** Hoje existem apenas funções isoladas (Narrativa, Humor, Som, Montagem, Colorização, VFX, Qualidade) sem um contrato unificado de diretor (`DirectorRole`, memória individual, ferramentas executáveis, consulta à Academy e resolução de conflitos).
2. **Orquestração colaborativa:** `produceCinemaPackage` executa em sequência fixa; falta grafo de dependências, resolução de conflitos entre diretores (ex.: Som vs Montagem vs Narrativa) e retomada por checkpoint.
3. **Núcleo unificado de aprendizado (Evolution Core + Academy):** Não há memória episódica/semântica/procedural/coletiva/contextual persistida para os diretores, nem ciclo verificável de feedback humano (`proposto -> em avaliação -> validado/rejeitado/desativado -> rollback`).
4. **Aethera Academy:** Não há biblioteca de estudos multimodal (vídeos, áudios, imagens, PDFs/documentos), modos *Estudar / Referência / Treinar*, exercícios práticos ou conversação com citação de evidências.

---

## 2. Fluxo Real Mapeado

```
Briefing / Prompt
  │
  ▼
[Diretor-Geral] ──consulta──▶ [Evolution Core + Aethera Academy]
  │                                  ▲
  ├──▶ [Pesquisa & Mídia] (procedência/direitos)
  ├──▶ [Narrativa + Humor 35%] ──▶ [Diretor de Arte + Fotografia]
  │                                  │
  ▼                                  ▼
[Orquestrador DAG] ──▶ [Montagem + VFX + Motion + Color + Música + Narração]
  │
  ▼
[Diretor de Som (A1–A5)] ──bloqueia se conflito──▶ [Renderizador FFmpeg/VoiceStudio]
  │
  ▼
[Diretor de Qualidade (Métricas Reais + Critérios Criativos)]
  │
  ▼
[Revisão Humana / Feedback NL] ──▶ [Ciclo Verificável Antes/Depois] ──▶ [Evolution Core]
```

---

## 3. Arquitetura Unificada: Evolution + Academy

Ambos os sistemas compartilham o mesmo pacote núcleo dentro de `packages/cinema/src/evolution/` (exportado por `@neuralbridge/cinema`) e persistência local isolada em `<AetheraUserData>/evolution/`:

1. **`director-registry.ts` (`EVO-01`)**: Define os **15 papéis especializados** com identidade tipada, ferramentas executáveis, critérios de sucesso, consulta à Academy e registro de decisões.
2. **`evolution-core.ts` (`EVO-03`, `EVO-04`, `EVO-05`)**:
   - Memórias tipadas (`episodic`, `semantic`, `procedural`, `collective`, `contextual`) com versionamento, procedência, confiança (`0..1`), estado (`proposed`, `evaluating`, `validated`, `rejected`, `disabled`) e rollback.
   - Classificador de feedback humano (`explicit_preference`, `proven_technical_defect`, `subjective_evaluation`, `unvalidated_hypothesis`) sem transformar reclamação subjetiva em regra universal.
   - Ciclo verificável Antes/Depois com comparação objetiva antes da consolidação.
3. **`director-orchestrator.ts` (`EVO-02`, `EVO-06`, `EVO-09`)**:
   - Grafo de dependências (DAG) com execução segura por ondas, checkpoints persistidos, timeout/retry, cancelamento, retomada após reinício, resolução de conflitos entre diretores e operação com provedor único de IA (RF-07, sem exigir 15 modelos simultâneos).
4. **`academy-engine.ts` (`EVO-11`)**:
   - Biblioteca de estudos com procedência, autoria, licença (`study_only` vs `reusable_owned`), sanitização contra *prompt injection* em documentos/transcrições, extração multimodal real (via `ffprobe`/frames/`pdftotext` ou parser local estruturado), chunking + busca híbrida (BM25/TF-IDF + tags/especialidade), 3 modos (*Estudar*, *Referência*, *Treinar*), encaminhamento automático aos 15 diretores, exercícios práticos avaliados pelo Diretor de Qualidade e conversação com citação de evidências.
5. **Segurança & Isolamento**:
   - Armazenamento exclusivo no diretório de dados do Aethera (`evolution-store.json` + `academy-store.json`), sem tocar nos bancos do Singularity ou do Void.
   - Proteção contra *prompt injection*: todo texto externo ingerido na Academy ou feedback é tratado como dado (`untrusted_content`), sanitizado contra instruções privilegiadas e nunca executado como comando.

---

## 4. Plano Incremental de Entrega

| Fase | Entregável | Pacotes / Arquivos |
| :--- | :--- | :--- |
| **EVO-00** | Auditoria e arquitetura | `docs/aethera/EVOLUTION-ARCHITECTURE.md` |
| **EVO-01 + EVO-03** | 15 Diretores + Evolution Core (memória persistente, busca híbrida, versionamento/rollback) | `packages/cinema/src/evolution/director-registry.ts`, `evolution-core.ts` |
| **EVO-04 + EVO-05 + EVO-07** | Feedback NL, ciclo verificável Antes/Depois e caso real do Diretor de Som (`showcase-v2-final.mp4`) | `evolution-core.ts`, `packages/cinema/test/evolution.test.ts` |
| **EVO-02 + EVO-06 + EVO-09** | Orquestrador DAG com checkpoints, colaboração entre diretores e integração ao pipeline | `packages/cinema/src/evolution/director-orchestrator.ts`, `packages/cinema/src/index.ts` |
| **EVO-11** | Aethera Academy (biblioteca, ingestão multimodal, 3 modos, exercícios, conversação e teste E2E completo) | `packages/cinema/src/evolution/academy-engine.ts`, `packages/cinema/test/academy.test.ts` |
| **EVO-08 + EVO-10** | IPC Aethera + UI Evolução dos Diretores & Academia + Benchmark longitudinal (redução real de erros) | `apps/aethera-desktop/src/main/aethera-ipc.ts`, `AetheraAgentsPage.tsx`, `AetheraAcademyPage.tsx`, `tests/e2e/aethera-evolution.spec.ts` |
