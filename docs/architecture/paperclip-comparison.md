# Paperclip × Singularity Core — auditoria preliminar

**Status:** PoC 50.09 concluída; opção A aprovada e o adaptador isolado 50.10 implementado e validado em testes determinísticos no commit `70d1593`. A ativação definitiva continua separada e sem validação autenticada de produção.
**Data:** 2026-11-10.

## Evidência externa verificada

O repositório oficial descreve o Paperclip como um control plane para equipes de agentes. A arquitetura publicada
separa o control plane do execution plane, usa checkout atômico com um único assignee e permite runtimes como Claude e
Codex. O runtime trabalha em heartbeats e o agente consulta a API para obter atribuições, executar o trabalho e
atualizar o estado.

Fontes primárias consultadas:

- https://github.com/paperclipai/paperclip/blob/master/docs/start/architecture.md
- https://github.com/paperclipai/paperclip/blob/master/docs/agents-runtime.md
- https://github.com/paperclipai/paperclip/blob/master/docs/api/overview.md
- https://github.com/paperclipai/paperclip/blob/master/docs/api/issues.md

Esses fatos tornam uma integração como control plane plausível, mas não demonstram que o Paperclip possa delegar a
execução ao Singularity Core, preservar as políticas locais de aprovação, ou transportar `external_ref`, lease e
idempotency key do Core. A versão, o contrato exato instalado e os eventos de retry/restart ainda precisam ser
verificados em uma PoC isolada.

## Matriz inicial

| Responsabilidade | Singularity Core atual | Paperclip verificado | Situação |
|---|---|---|---|
| Dono da execução | Core/TaskEngine com lease por tarefa | Runtime próprio acionado por heartbeat/checkout | conflito potencial; Core deve continuar único executor |
| Concorrência | lease, `external_ref` e idempotência | checkout/assignee atômico | compatível apenas com adaptador explícito |
| Agentes | Claude/Codex e adaptadores existentes | runtimes configuráveis, incluindo Claude/Codex | duplicação de adaptadores a evitar |
| Estado/eventos | API versionada, SSE/WebSocket e eventos do Core | API Paperclip e atualização de tarefa | contratos ainda não mapeados |
| Aprovações | gates existentes no TaskEngine e desktop | governança/controle no Paperclip | autoridade precisa ser definida |
| Memória/RAG | Neural Brain e RAG do Singularity | não comprovado como substituto | manter no Singularity |
| Credenciais | `safeStorage`/S0 e fronteira Core | credenciais do próprio Paperclip | não compartilhar segredos diretamente |
| Observabilidade | métricas Core/desktop/MCP/RAG | rastreamento de runs e tool calls | possível complemento, não fonte única ainda |

## PoC 50.09 — evidência executada

| Item | Resultado observado | Evidência/limite |
|---|---|---|
| Fonte/versionamento | Paperclip `0.3.1`, commit `16c30ac32b90eb7a574657b01a99e848cb997d5e` | clone descartável fora do repositório do produto |
| Windows/dependências | servidor subiu com Node `v24.17.0` e pnpm `11.25.0` | dependências somente no clone; lockfile requer pnpm 9.x |
| Isolamento de rede | listener em `127.0.0.1:43100`, `PAPERCLIP_BIND=loopback`, modo `local_trusted` | nenhuma exposição pública, credencial real ou provedor externo |
| Persistência | embedded PostgreSQL isolado em `%TEMP%\\singularity-paperclip-poc-state` | nenhuma migração NeuralBridge/produção |
| Health/auth | `GET /api/health` retornou `200`, `version=0.3.1`, `authReady=true`, `bootstrapStatus=ready` | API local confirmou modo privado e recuperação pronta |
| Criar/acompanhar/cancelar | company e issue reais criadas; `GET /api/issues/{id}` observou `backlog`; `PATCH` para `cancelled` retornou `cancelled` | valida o ciclo de control plane, não execução de agente |
| Executor | zero agente/provider configurado; nenhuma chamada de runtime/CLI ocorreu | adaptador não deve delegar execução ao Paperclip |
| Idempotência/reconexão | harness determinístico: retry retornou `replayed=true`, uma task Core e uma lease lógica; reconciliação consultou a mesma task | contrato do Core exercitado sem tocar o TaskEngine |
| Conflito/escopos | checkout `409` não foi repetido; `devices:manage` e `task:approve` foram rejeitados | mínimo: `read`, `task:create`, `task:cancel` |
| Custo local | amostra de 5 s registrou delta CPU `0.000 s`; working set `667.41 MB` do processo Node | inclui servidor + embedded PostgreSQL; não é custo de produção/provider |

Harness: `spikes/paperclip-core-boundary/harness.test.mjs` — 4/4 testes passaram.

## Comparação efetiva dos contratos

| Contrato do Core | Paperclip observado | Decisão para o adaptador A |
|---|---|---|
| `external_ref` `{system,id,revision}` | Paperclip expõe `companyId`, `issue.id` e `statusVersion`; não foi encontrado campo equivalente documentado | derivar `system=paperclip`, `id=<company>/<issue>` e revisionar com `statusVersion` |
| idempotency key por mutação | estado/versionamento Paperclip não substitui a idempotência do Core | gerar chave estável por issue/revisão e reutilizá-la no Core |
| lease/executor único | checkout/assignee é atômico, mas runtimes Paperclip também podem executar | adaptador não usa runtime Paperclip; Core continua único executor |
| estado/eventos | Paperclip oferece consulta/heartbeat; Core possui eventos/SSE próprios | Core é fonte de execução/estado operacional; Paperclip é fonte de planejamento |
| cancelamento | issue pode ir a `cancelled`; runtime tem ciclo próprio | cancelar primeiro no Core e depois refletir no Paperclip, com reconciliação |
| autenticação | Bearer tokens/JWT/sessão; local trusted não substitui auth remota | token fica somente no processo Core/adaptador; renderer nunca recebe segredo |

## Resultado e implementação 50.10

A opção A é tecnicamente viável como control plane isolado. O maior risco continua sendo a sobreposição entre
checkout/heartbeat/runtimes do Paperclip e lease/executor do Core. O 50.10 implementa apenas o adaptador sem runtime
Paperclip: `PaperclipAdapter`, `createPaperclipHttpClient` e `createCoreOrchestratorClient` em
`packages/orchestrator/src/integrations/paperclip-adapter.ts`.

O adaptador deriva `external_ref` estável (`paperclip/<company>/<issue>`), consulta o Core antes de criar, reutiliza
uma chave SHA-256 por revisão, cancela primeiro no Core e só depois espelha o cancelamento no Paperclip. O cliente não
expõe tokens ao renderer, não acessa SQLite e não inicia agentes, CLI, MCP ou TaskEngine.

Ainda fora desta fatia: provisionamento de credencial mútua pelo Desktop, tela de configuração, aprovação remota e
execução de um Paperclip real contra um Core autenticado. Sem esses itens, o adaptador permanece opt-in por injeção e
não é ativado automaticamente.

## Decisão registrada

As opções continuam:

- **A — Adaptar:** Paperclip controla planejamento/atribuição e chama uma API do Core; o Core cria, executa e reporta a
  tarefa. Exige `external_ref`, idempotência, autenticação mútua e reconciliação de restart.
- **B — Incorporar conceitos:** não executar Paperclip; aproveitar somente ideias que preencham lacunas comprovadas.
- **C — Fundir/substituir:** não recomendado sem prova de paridade de memória, RAG, aprovações e segurança.
- **D — Não integrar:** manter os dois separados se a fronteira não puder garantir ownership único ou custo razoável.

O usuário aprovou a opção A para a PoC e, posteriormente, autorizou a execução geral: Paperclip como control plane
isolado, Core como único executor, sem substituir TaskEngine e sem duplicar orquestração. A PoC 50.09 foi concluída e
o adaptador 50.10 foi implementado sem ativação automática.
