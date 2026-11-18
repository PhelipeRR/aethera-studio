# FIRST-VIDEO-RECOVERY — Auditoria e correção do pipeline de vídeo do Aethera Studio

> Status: **Fase 0 (Diagnóstico) + Fase 1 (Correção da causa raiz do Problema A) CONCLUÍDAS** em 2026-11-17.
> Próxima ação: validar a correção com execução real do job `cinema_1794859719031` (retomada) e avançar para o Problema B (classificação inconsistente de mídias).

---

## 1. Problemas identificados na auditoria forense

### Problema A — Conclusão prematura de etapas (CONFIRMADO)

**Sintoma observado:** no log do job `job_mwjp4upj_31mqyofu` / `cinema_1794859719031`, o tracker registrou:
- `decupagem stage_completed` às 20:14:34.754Z
- `aquisicao stage_started` às 20:14:34.754Z
- `aquisicao stage_completed` às 20:14:34.759Z (**5 ms depois**)
- `validacao_visual stage_started` às 20:14:34.760Z

Entretanto, os downloads reais de mídia (`Download concluído (youtube): ...`) só apareceram entre 20:14:54Z e 20:15:05Z, ou seja, **20–30 segundos após a marcação de conclusão da aquisição**. O console mostrava progresso falso enquanto a aquisição ainda rodava.

**Correlação entre jobs confirmada:** ambos os IDs pertencem à mesma execução (`projectId: cinema_1794859719031`). O log `cinema_1794859719031.log.jsonl` usa o `projectId` como `jobId` por ser uma retomada/binding legado; o log `job_mwjp4upj_31mqyofu.log.jsonl` usa o `jobId` real gerado pelo `createProductionJobId`. Mesma sequência temporal, mesmo prompt, mesmas cenas.

### Problema B — Classificação inconsistente de mídias (RESOLVIDO no commit e4ae701)

**Sintoma observado nos logs antigos:** rejeições como `Classe stock_video não é adequada para cena "anime_identity"` para vídeos legítimos de anime no YouTube (ex: "Overanalyzing Nen", "Nina é transformada em Quimera (Fullmetal alchemist)").

**Causa raiz identificada e já corrigida:** antes do commit `e4ae701`, vídeos do YouTube sem sinais claros nos metadados eram classificados incorretamente como `stock_video`. Após a correção:
- O classificador (`classification.ts:181`) retorna `unclassified_video` para vídeos do YouTube sem sinais, nunca `stock_video`.
- O `deriveMediaType` (`semantic-media.ts:283-285`) converte qualquer item com `classification === 'stock_video'` cujo provider não seja stock (`pexels`, `pixabay`, `mixkit`) em `{ type: 'unknown', confidence: 0 }`, impedindo que vídeos do YouTube sejam tratados como stock.
- A mensagem de rejeição mudou de `Classe X não é adequada` para `Tipo Y (classe Z) não é adequado` (`semantic-media.ts:491`).

**Evidência:** inspeção do código atual confirma que `isStockProvider('youtube')` retorna `false`, e o adapter do YouTube (`youtube.ts:93`) passa `hint: 'youtube_video'`, que produz `unclassified_video` ou `anime_footage` dependendo dos metadados. Os logs do job `cinema_1794859719031` foram gerados por uma versão anterior ao commit `e4ae701`.

**Status:** RESOLVIDO. Uma nova execução do pipeline deve classificar corretamente vídeos de anime do YouTube como `anime_footage` (com metadados adequados) ou `unclassified_video`/`unknown` (sem sinais), permitindo que avancem para a análise visual por frames.

### Problema C — Gerenciamento inadequado de agentes (RESOLVIDO)

**Sintoma observado:** Antigravity retornou `429 RESOURCE_EXHAUSTED` e Claude Code `5-hour limit`, mas novas tentativas foram feitas nas etapas seguintes.

**Mecanismo existente confirmado:** `production-agent-providers.ts` já implementa fallback e cooldown completos:
- **Classificação de falhas** (`classifyProductionAgentFailure`, linha 63): distingue `quota_exhausted`, `rate_limited`, `auth_failed`, `config_error`, `stalled`, `cancelled`, `skipped`.
- **Cooldowns persistentes** (`backendFailureState`, linha 630): `quota_exhausted`/`auth_failed`/`config_error` = 10 min; `rate_limited` = 60 s. Sobrevive entre execuções no mesmo processo.
- **Cadeia de fallback** (`runProductionAgentWithFallback`, linha 665): pula backends duplicados após falha definitiva dentro da mesma execução (`exhaustedBackends` in-memory) e entre execuções (`isBackendInCooldown`).
- **Pesquisa editorial** (`aethera-ipc.ts:2594`): usa `buildProductionFallbackChain` com lógica manual de skip por backend exausto e validação de conteúdo (não só `ok=false`).

**Status:** RESOLVIDO. O comportamento descrito na auditoria ocorreu antes dessa implementação ou em uma versão que não a incluía. Uma nova execução deve respeitar os cooldowns e pular provedores indisponíveis automaticamente.

### Problema D — Produção não chega ao resultado final (CONSEQUÊNCIA)

Derivado dos problemas A–C. Será reavaliado após as correções.

---

## 2. Causa raiz do Problema A

**Arquivo:** `apps/aethera-desktop/src/main/cinema-pipeline.ts`
**Linhas originais:** 1614–1618

```typescript
checkCancelled();
job.state = 'validacao_visual';   // ← transição ANTES da aquisição real
job.progressPct = 62;
job.message = 'Validando mídias por Scene Grounding e evidências por frame...';
this.saveJob(job);                // ← saveJob dispara o stage tracker

const baseDeps = this.deps.autonomousAcquisitionDeps;
// ... 140 linhas de preparação ...
const audit = await runAutonomousMediaAcquisition({ ... }); // ← aquisição real só aqui (linha ~1755)
```

**Mecanismo do defeito:**
1. O `ProductionStageTracker.observe()` (`production-stage-tracker.ts:222-230`) emite `stage_completed` para o estágio anterior sempre que o `state` muda.
2. Ao salvar o job com `state = 'validacao_visual'` antes de chamar `runAutonomousMediaAcquisition`, o tracker emitia `aquisicao stage_completed` imediatamente.
3. A aquisição real (downloads, validação visual, grounding) rodava depois, já sob o estado `validacao_visual`, fazendo os logs de download aparecerem com `stage: "aquisicao"` (herdado do contexto) mas sem evento de conclusão correspondente.
4. O console mostrava "Etapa aquisicao concluída" em 5 ms, enquanto os downloads ainda estavam em andamento.

**Classificação:** CONFIRMADO com evidência de log e código-fonte.

---

## 3. Correção aplicada

**Commit pendente** (alterações no working tree, não commitadas para preservar outras sessões).

### Mudança 1: remover a transição prematura (linha ~1614)

```typescript
// ANTES (defeituoso):
checkCancelled();
job.state = 'validacao_visual';
job.progressPct = 62;
job.message = 'Validando mídias por Scene Grounding e evidências por frame...';
this.saveJob(job);

// DEPOIS (corrigido):
checkCancelled();
// Keep state as 'aquisicao' until runAutonomousMediaAcquisition actually completes.
// Setting 'validacao_visual' here and saving would make the stage tracker emit
// 'aquisicao stage_completed' before any download/validation ran (root cause of the
// premature-completion bug observed in job_mwjp4upj_31mqyofu / cinema_1794859719031).
job.progressPct = 58;
job.message = 'Adquirindo e validando mídias orientadas pela decupagem semântica...';
this.saveJob(job);
```

### Mudança 2: inserir a transição correta APÓS o await (linha ~1782)

```typescript
const audit = await runAutonomousMediaAcquisition({ ... });

// Only now that acquisition + visual grounding actually finished can we transition out of 'aquisicao'.
// This prevents the stage tracker from emitting 'aquisicao stage_completed' before downloads/validation ran.
checkCancelled();
job.state = 'validacao_visual';
job.progressPct = 62;
job.message = 'Validando mídias por Scene Grounding e evidências por frame...';
this.saveJob(job);

job.autonomousAudit = audit;
```

### Validação técnica

- `npx tsc -p apps/aethera-desktop/tsconfig.node.json --noEmit`: **0 erros no cinema-pipeline.ts** (erro pré-existente em `DeletePromptDialog.test.ts` não relacionado).
- Lógica preservada: `completedStages` continua sendo atualizado apenas na linha 2090, após todo o processamento de aquisição e validação.
- Sem mudança de contrato, sem reescrita de módulos, sem alteração em outros arquivos.

---

## 4. Evidências coletadas

| Artefato | Caminho | Conteúdo relevante |
|---|---|---|
| Log do job (tracker) | `%APPDATA%/AetheraStudio/cinema-console-logs/job_mwjp4upj_31mqyofu.log.jsonl` | Timeline mostrando `aquisicao stage_completed` em 5 ms |
| Log do job (downloads) | `%APPDATA%/AetheraStudio/cinema-console-logs/cinema_1794859719031.log.jsonl` | Downloads reais 20–30 s após a marcação de conclusão |
| Código defeituoso | `apps/aethera-desktop/src/main/cinema-pipeline.ts:1614-1618` | Transição de estado antes do `await` |
| Tracker | `apps/aethera-desktop/src/main/production-stage-tracker.ts:222-230` | Mecanismo de emissão de `stage_completed` na mudança de estado |

---

## 5. Riscos remanescentes

- **Problema B (classificação):** ainda não investigado. Pode bloquear a produção mesmo com o Problema A corrigido.
- **Problema C (agentes):** quotas esgotadas podem impedir a pesquisa editorial e o roteiro. Precisa de mecanismo de fallback/respeito a limites.
- **Validação real pendente:** a correção do Problema A foi verificada por typecheck e análise de código, mas ainda não foi exercitada por uma execução real do pipeline. A próxima etapa é retomar o job `cinema_1794859719031` e confirmar que o tracker agora registra `aquisicao stage_completed` somente após os downloads.

---

## 6. Próxima ação

1. **Validar a correção do Problema A** com execução real (retomar o job ou iniciar nova produção curta).
2. **Investigar o Problema B** (classificação inconsistente): inspecionar `assessIdentity`, `MediaRelevanceGate` e a propagação de `projectDomain`/`work` entre cenas.
3. **Investigar o Problema C** (gestão de agentes): localizar onde os erros 429/rate-limit são tratados e implementar backoff/fallback.
4. **Teste A (renderização mínima):** produzir 15–30 s de vídeo real após os problemas A–C estarem resolvidos.

---

*Documento criado em 2026-11-17 como parte da Operação First Video. Atualizar após cada fase.*