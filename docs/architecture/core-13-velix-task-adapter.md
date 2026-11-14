# CORE-13 — Adaptador de tarefas do Velix

**Status:** implementado e validado com E2E em 2026-11-10.

## Fronteira migrada

Os estágios lançados pelo caminho direto de `ProductionRunService` usam o adaptador
híbrido quando o Core está ativo. O identificador externo é por tentativa:

```text
system: velix
id: stage/<stageId>/attempt/<n>
revision: <n>
```

Uma reconexão reutiliza a mesma referência e não duplica a tarefa. Um retry legítimo
incrementa `n`, porque representa uma execução nova depois de uma falha anterior.
Pause, cancelamento e retomada continuam passando pelo dono do lease através do
adaptador. `NB_CORE_TASKS=main` mantém o rollback para o TaskEngine local.

## Limites preservados

O Core não recebe filesystem, FFmpeg/FFprobe, VoiceStudio, captura, direitos,
aprovação visual ou artefatos. Essas responsabilidades continuam nos adaptadores
Desktop e os estágios nativos seguem locais. Os adapters `script`, `research` e
`storyboard` ainda executam `runStructuredReadOnly` no TaskEngine local, porque o
contrato Core para capacidades estruturadas ainda não existe; não são declarados como
migrados por CORE-13.

## Evidência

- Velix production, research e script: 16/16 testes focados.
- Typecheck do Orchestrator e Desktop: aprovado.
- ESLint dos arquivos alterados e `git diff --check`: aprovado.
- `tests/e2e/core-velix-tasks.spec.ts` (2/2): o estágio interrompido, ao ser retomado, executa no processo do Core
  com `stage/<id>/attempt/1`; dois resumes simultâneos criam uma única tarefa; o cancelamento passa pelo Core;
  `NB_CORE_TASKS=main` executa no Desktop com a mesma referência.
- Continua fora: um contrato Core para capacidades estruturadas (`runStructuredReadOnly`); até lá script, pesquisa e
  storyboard ficam no Desktop, e o grupo Velix é declarado migrado só no caminho direto.
