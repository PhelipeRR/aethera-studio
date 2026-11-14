# Timeline IR Canônica & OTIO

- **Arquivo:** `packages/cinema/src/ir/timeline-ir.ts`
- **Precisão temporal:** `RationalTime { value, rate }` sem drift de ponto flutuante.
- **Trilhas padrão:** `v1` (video), `vfx1` (VFX/tipografia), `a_nar`, `a_mus`, `a_sfx`, `sub1`.
- **Invalidação incremental:** `recomputeTimelineFingerprints` e `invalidateAffectedSegments` preservam clipes aprovados não afetados.
- **Interoperabilidade:** `exportToOtioJson` gera `OTIO_SCHEMA: "Timeline.1"` com metadados `metadata.aethera`.
