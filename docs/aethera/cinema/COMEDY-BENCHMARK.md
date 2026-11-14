# Benchmark de Comédia A/B (`35%` vs `0%`)

Validado automaticamente por `runBenchmarkSuite()` em `packages/cinema/test/cinema.test.ts`:
- `abHumor35ActiveRate > 0.70` (humor pontual ativo onde permitido).
- `abHumor0ActiveRate === 0` (desativação limpa a `0%`).
- `sensitiveBlockAccuracy === 1.0` (100% de bloqueio em cenas de luto/tragédia).
