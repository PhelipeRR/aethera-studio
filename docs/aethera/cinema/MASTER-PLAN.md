# Aethera Cinema Master Plan (`CINEMA-00` .. `CINEMA-10`)

- **Pacote principal:** `packages/cinema` (`@neuralbridge/cinema`)
- **Integração desktop:** `apps/aethera-desktop` (`cinema:*` IPC + rota `/aethera/cinema` com `CinemaDirectorPanel`)
- **Estado atual:** Implementado e validado com testes unitários, determinísticos, fault-injection e smoke E2E. Não há afirmação de teste com mídia real de produção externa ou avaliação humana cega completa neste ciclo.

## Fases Implementadas
- **CINEMA-00:** Corpus de benchmark (`12` cenários: `8` dev, `4` holdout), rubrica criativa e baseline.
- **CINEMA-01:** Timeline IR canônica racional (`RationalTime`), exportação OTIO (`Timeline.1`), fingerprints determinísticos e sanitização anti-prompt-injection.
- **CINEMA-02:** `CreativeBrief`, `StyleBible`, `NarrativeBeat` e `ShotPlan` com Plano A/B e lacunas explícitas (`mediaGaps`).
- **CINEMA-03:** Motor editorial determinístico (trim frame-accurate, ripple delete, J/L cuts, speed ramp, reframe HUD-safe, undo/redo transacional, cache incremental).
- **CINEMA-04:** Catálogo tipado de VFX com fallback e posicionamento tipográfico com leitura mínima, contraste >= 4.5:1 e desvio de HUD.
- **CINEMA-05:** Pipeline de cor (Rec.709, proteção de pele, proveniência de LUT) e som (stems, EBU R128 `-14`/`-12.5`/`-16`/`-18 LUFS`, filtergraph FFmpeg e auditoria de licença).
- **CINEMA-07 / CINEMA-08:** QC técnico determinístico, QC narrativo/comédia, ensemble independente do produtor, `IssueLedger` com waiver controlado (proibido para críticos), reparo cirúrgico incremental (`budget <= 3`) e Release Gates.
- **CINEMA-09 / CINEMA-10:** Direção de comédia/entretenimento (`cinematic_subtle_humor` 35% padrão, bloqueio automático em contextos sensíveis/clímax, desativação em `0%`) e suíte A/B (`35%` vs `0%` e direcionado vs baseline).
