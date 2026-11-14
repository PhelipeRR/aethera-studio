# CORE-12 — Adaptador de tarefas do Void

**Status:** implementado e validado em 2026-11-10.

## Escopo

Somente a ação confirmada `project.edit_task` passa a usar o adaptador híbrido do
Desktop. Quando o Core está ativo, `hybridTasks.start()` é o único caminho de
execução; com `NB_CORE_TASKS=main`, o TaskEngine local permanece o rollback explícito.

O `actionId` persistido na auditoria de ações vira a referência externa estável:

```text
system: void
id: action/<actionId>
revision: 1
```

Isso preserva a deduplicação entre uma confirmação repetida, reconexão e retry do
adaptador. A política de execução continua exigindo projeto vinculado, confirmação
humana e prompt com as restrições existentes contra commit, push, checkout e merge.

## Fora do escopo

Voz, palavra de ativação, HUD, captura de tela, UI Automation, Spotify, sugestões e
conversa permanecem no Desktop. O TaskEngine local continua sendo injetado no
`NeuraOrchestrator` para essas capacidades; não há duplicação de executor nem
alteração no Singularity Core.

## Rollback e evidência

- Rollback imediato: `NB_CORE_TASKS=main`, sem alterar a auditoria ou os dados.
- Testes focados do broker/executor/orquestrador: 111/111.
- Typecheck do Orchestrator e Desktop: aprovado.
- ESLint dos arquivos alterados: aprovado.
- `tests/e2e/core-dynamic-inventory.spec.ts`: a chamada que o executor faz (`void/action/<id>`) executa no processo do
  Core; `core-tasks.spec.ts` prova que a mesma referência repetida reutiliza a tarefa. As demais capacidades do Void
  continuam no Desktop por desenho.
