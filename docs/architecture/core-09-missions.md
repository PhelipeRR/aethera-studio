# CORE-09 — Missões autônomas no Core

## Decisão

Missões autônomas são o primeiro grupo adicional migrado porque já persistem a máquina de estados em
`autonomousMissions`/`autonomousMissionTasks`, recuperam missões em execução no boot e possuem uma porta estreita para
criação, persistência e validação. A missão continua sendo coordenada pelo Desktop; a execução da etapa é do Core quando
ele está disponível.

## Implementação

- `createHybridTaskService` é criado antes do modo de missão e recebe os mesmos eventos SSE que já alimentam o Desktop.
- A etapa usa `externalRef.system = mission`, `externalRef.id = mission/<mission-task-id>` e
  `externalRef.revision = attempts`. A repetição de uma etapa muda a revisão e não reutiliza o task anterior.
- O Core continua como único executor quando ativo. O lease e a idempotência existentes impedem duas execuções para a
  mesma referência/revisão.
- `NB_CORE_TASKS=main` ou indisponibilidade do Core mantém o caminho local como rollback operacional. A persistência da
  missão não muda.
- A alteração do contrato interno de início de tarefa é aditiva: `externalRef` é opcional e todos os consumidores atuais
  continuam válidos.

## Verificação e rollback

Testes de missão, rotas Core, typecheck do shared/Desktop e lint passaram. O rollback é iniciar com `NB_CORE_TASKS=main`;
nenhuma migração de banco ou alteração de credenciais é necessária. Workflows, Git automations, Void/Neura e Velix não
participam deste lote.

## Limitação

O inventário dinâmico (`tests/e2e/core-dynamic-inventory.spec.ts`) revelou que uma missão **recuperada no boot**
executava no Desktop: a recuperação rodava antes de o Core conectar e o adaptador caía no fallback. Agora a recuperação
espera o Core (`waitForCore`, no máximo o timeout de prontidão; Core desligado ou falho libera na hora) e a missão
executa no processo do Core com `mission/<id>`.
