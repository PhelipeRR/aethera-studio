# Release Gates (`evaluateReleaseGates`)

Condições obrigatórias para `passed === true`:
1. `independentFromProducer === true` (avaliador não pode ser `director_agent`).
2. `openCritical.length === 0`.
3. `openWarning.length <= maxWarningsWithoutWaiver` (padrão `0`, exigindo correção ou waiver explícito).
4. `compositeScore >= 78`.

Quando `openWarning.length > 0` ou `compositeScore < 85`, `requiresHumanReview = true`.
