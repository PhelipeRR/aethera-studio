# Baseline & Métricas Comparativas

| Dimensão | Baseline (Montagem Bruta) | Aethera Cinema Direcionado | Evidência |
| --- | --- | --- | --- |
| Timeline & Sync | Ms aproximado | `RationalTime` exato + OTIO | `packages/cinema/src/ir/timeline-ir.ts` |
| Recall defeitos críticos | N/A | `100%` em falhas sintéticas injetadas | `packages/cinema/test/cinema.test.ts` |
| Falso positivo (cenários limpos) | N/A | `0%` | `runBenchmarkSuite()` |
| Score médio (12 cenários) | `81.95` | `93.45` | `runBenchmarkSuite()` |

> Nota de honestidade: os números acima referem-se à suíte determinística com sinais sintéticos injetados. Testes em mídia real externa e avaliação humana cega permanecem como etapa operacional separada.
