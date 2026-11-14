# Inventário read-only — grupos de execução e migração para o Core

**Data:** 2026-11-10  
**Escopo:** inventário estático do repositório; nenhuma migração, alteração de runtime, banco ou credencial foi
executada.

## Critério

O grupo só pode migrar quando tiver uma porta explícita para o TaskEngine/Core, estado persistido, cancelamento,
recuperação, aprovação e idempotência verificáveis. Integrações que dependem de Electron, janela, áudio, tela, FFmpeg
ou credenciais locais continuam parcialmente no Desktop até uma autorização específica.

## Matriz

| Ordem | Grupo | Entrada e executor atual | Estado/persistência | Prontidão observada | Risco |
|---:|---|---|---|---|---|
| 1 | Missões autônomas | `apps/desktop/src/main/index.ts` cria `createAutonomousMissionMode`; cada etapa usa `hybridTasks.start()` quando o Core está ativo e `taskEngine.start()` no rollback | `autonomousMissions` e `autonomousMissionTasks`; recupera missões `running` no boot e reage ao mesmo stream de eventos | **Migrado em CORE-09**: `externalRef.system=mission`, id `mission/<mission-task>`, revisão por tentativa; lease/eventos do Core e `NB_CORE_TASKS=main` preservam fallback | **menor** |
| 2 | Workflows | `apps/desktop/src/main/workflows.ts` usa `createWorkflowCoordinator`; etapas de agente passam pela ponte híbrida e o Core quando ativo | `workflowRuns`, `workflowRunSteps`, checkpoints; `recover()` no boot; pause/cancel/resume encaminhados | **Migrado em CORE-10**: `externalRef.system=workflow`, id `<run>/<step>`, revisão por tentativa; etapas nativas continuam no Desktop | médio |
| 3 | Automações Git | `apps/desktop/src/main/git-automation.ts` monitora refs e dispara somente `workflows.run()` | cursores, eventos com `dedupeKey`, limites e runs em `workflowRuns` | **Migrado por composição em CORE-11**: a automação não executa agente; o Workflow disparado usa CORE-10 e conserva dedupe/limites | médio, dependente de Workflows |
| 4 | Missões + automações compostas | Missões podem originar várias tasks e automações Git podem originar workflows | estados e eventos distribuídos entre tabelas de missão, workflow e tasks | Não é grupo independente; deve ser validado depois das unidades base | alto se combinado |
| 5 | Void/Neura | `createNeuraRuntime` usa o adaptador híbrido para `project.edit_task`, mas também voz, worker local, captura de tela, ações de computador e Spotify | sessões, sugestões e auditorias `neura_*`; preferências e arquivos locais | **CORE-12 parcial:** `project.edit_task` usa `externalRef.system=void` com `action/<actionId>`; voz, UI Automation, tela, wake word, conversa, RAG e Spotify permanecem fronteiras Desktop até contratos próprios | alto |
| 6 | Velix | `ProductionRunService` e adaptadores de script, pesquisa, storyboard, narração, render e derivados; somente o caminho direto de tarefas passa pelo adaptador híbrido | repositórios de produção, stages, artefatos, claims, qualidade e runs | **Parcial:** tarefas diretas usam `externalRef` por tentativa; adapters estruturados, filesystem, FFmpeg/FFprobe, VoiceStudio, captura e aprovação visual permanecem no Desktop | muito alto |

## Ordem recomendada

1. **Missões autônomas**, individualmente, como primeiro grupo de menor risco.
2. **Workflows**, após estabilizar a ponte de tarefas, eventos, cancelamento e etapas nativas.
3. **Automações Git**, somente depois de Workflows, preservando `dedupeKey` e limites.
4. **Void/Neura**, separando primeiro tarefas/RAG do restante da experiência local.
5. **Velix**, por último e por stages, mantendo mídia, direitos, aprovação e rollback no Desktop até cada contrato ser
   provado.

Essa ordem é uma recomendação de auditoria, não autorização de implementação. Cada item exige uma autorização
separada, plano de rollback, testes unitários/integrados/E2E e prova de que o Core continua sendo o único executor.

## Lacunas remanescentes para os próximos grupos

- Para Workflows e Git, definir o `external_ref` por grupo, inclusive revisão e origem, sem reutilizar títulos ou prompts como identidade.
- Definir como o adaptador Core registra o vínculo `missionTask → coreTask` e reconcilia após reinício.
- Cobrir cancelamento e aprovação quando o Desktop fecha durante a execução.
- Confirmar que a execução independente do Core pode acessar somente os recursos permitidos, sem herdar implicitamente
  o contexto do Electron.
- Executar o inventário dinâmico read-only em uma instalação de teste antes de qualquer migração de dados.

