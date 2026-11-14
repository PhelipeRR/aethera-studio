# CORE-02 — Contratos da API do Singularity Core (v1)

Status: **aprovado em 2026-11-09**. Base: ADR CORE-01 (`adr-core-01-singularity-core.md`) e
decisões D-6, D-7 e D-8. Escopo deste lote: documentação, esquemas, tipos e testes de contrato. Nada aqui inicia
servidor, extrai backend do Electron, muda a autenticação atual do desktop ou começa Paperclip ou Mobile.

Código: `packages/shared/src/core-api/` (importado como `@neuralbridge/shared/core-api`).
Testes: `packages/shared/test/core-api-auth.test.ts`, `core-api-tasks-events.test.ts`, `core-api-routes.test.ts`.

## 1. Auditoria dos serviços existentes

| Serviço | Onde está hoje | Quem chama | O que o contrato reaproveita | Lacuna para clientes remotos |
|---|---|---|---|---|
| **Tarefas** (`TaskEngine`) | `packages/orchestrator/src/engine.ts`, composto no main do Electron | renderer por IPC (`tasks:*`), Neura/Void, workflows, git automations | Status (`TASK_STATUSES`), modos, etapas, `ExecutionSnapshot` (attempt, aprovação, cancelamento, recuperação), eventos gravados e redigidos (`task_events`, 4.000 caracteres, 5.000 por tarefa), `correlationId` (`correlation.ts`) | Sem idempotency key, sem dono/lease explícito (exclusividade só pela fila em memória por projeto), sem id de evento retomável por cliente, sem `external_ref` |
| **Agentes** (Claude Code, Codex) | `packages/agents`, disponibilidade e failover no orchestrator | só o TaskEngine | `AGENT_IDS`, limites de capacidade, política de recuperação (`recovery-policy.ts`) | Nenhuma: agentes continuam internos ao Core. Nenhum cliente inicia agente |
| **Memória** (brain) | `packages/brain`, SQLite WAL | renderer por IPC, servidor MCP direto no banco | `storeInputSchema`, `LIMITS`, tipos, trust/confidence, versões, exclusão lógica | Escrita remota precisa ser sempre `unverified` e ter concorrência otimista |
| **Busca e RAG** | `brain.search` (FTS5 + embeddings), `RagEngine` por projeto | renderer, MCP (`brain_search`, `brain_rag_search`), TaskEngine (`rag_context`) | Modo híbrido com `degraded` honesto, `RagHit.reference`, resultados marcados como não confiáveis | Reindexação hoje é ação local sem id de trabalho nem progresso observável |
| **MCP** | `packages/mcp-server`, processo próprio com `ELECTRON_RUN_AS_NODE` | Claude Code, Codex | Escopo por projeto/global/privado (`scope-resolution.ts`), log de acesso | Continua direto no banco (ADR §2.2); ferramentas que criam tarefa passarão pela API no CORE-05 |
| **Monitoramento** | `apps/desktop/src/main/monitoring` | renderer | `monitorSampleSchema`, `monitorSnapshotSchema` | Precisa de stream (`metrics.sample`) e de indicar quando a coleta depende do desktop |
| **Autenticação atual** | `isTrustedSender` no IPC (origem do renderer) | só o desktop | Permanece igual | Não existe identidade de dispositivo, token, escopo nem revogação |

Conclusões da auditoria:

1. O domínio já tem o vocabulário certo. O contrato v1 **usa os mesmos enums e limites** (testado), então nenhum
   dado existente fica inválido e não há tradução lossy.
2. O ponto fraco para múltiplos clientes é a **execução única**: hoje ela é garantida por um único processo. O
   contrato define lease e idempotência agora; o CORE-04 adiciona as colunas.
3. Logs já são redigidos e cortados antes de ir ao banco. Os eventos públicos são essa mesma saída, sem caminho novo
   para segredos.

## 2. Arquitetura proposta

```
 Desktop (renderer) ─IPC─► main = adaptador (CORE-06) ─┐
 Companion Mobile ─HTTPS tailnet (tailscale serve)─────┤
 Orquestrador externo (Paperclip) ─adaptador isolado───┼─► Singularity Core /api/v1 ─► TaskEngine (único executor)
 Agentes externos / scripts ─token com escopo──────────┘          │                      ├─ agentes (Claude, Codex)
                                                                    │                      ├─ memória / RAG / índice
 Servidor MCP ─ banco direto (WAL), como hoje ─────────────────────┘                      └─ monitoramento
```

- Um backend, vários clientes. Todo cliente **pede e observa**; só o TaskEngine executa.
- O Core escuta só em loopback. Acesso remoto só por `tailscale serve`. `funnel`, LAN e host público são rejeitados
  pelo próprio esquema (`transportDescriptorSchema`, `privateEndpointSchema`).
- Os contratos ficam num subcaminho próprio, separado dos canais IPC internos: o IPC continua evoluindo com o desktop;
  a API pública só cresce de forma aditiva dentro da v1.

## 3. Contratos criados

| Arquivo | Conteúdo |
|---|---|
| `common.ts` | Prefixo `/api/v1`, ids (mesmos limites do IPC), timestamps, `correlationId`, `Idempotency-Key` (16–128 caracteres, retenção de 24 h), paginação por cursor opaco, `principal` (desktop, device, orchestrator, agent, system), `canonicalJson` para a impressão digital da idempotência |
| `errors.ts` | Envelope único de erro (HTTP, WebSocket, SSE); 24 códigos com status HTTP e `retryable`; `not_found` também para recurso invisível (proteção contra IDOR) |
| `version.ts` | `CORE_CONTRACT_VERSION 1.0.0`, regra aditiva, cabeçalhos `Singularity-Contract`, `Deprecation`, `Sunset`; `contractCompatible` |
| `limits.ts` | Classes de rate limit (pareamento e token por origem; o resto por principal), limites de corpo e de conexões |
| `auth.ts` | Escopos (`read`, `chat`, `memory:write`, `task:create`, `task:cancel`, `task:approve`★, `task:full-access`★, `index:manage`, `devices:manage`★ local), concessão por projeto com opt-in de privados, `authorize`, chave P-256 do aparelho, prova DPoP, pareamento (oferta do QR, claim, decisão no desktop, estados), tokens (acesso 15 min, refresh rotativo de 30 dias com detecção de reuso), dispositivos, revogação (um ou todos) e auditoria |
| `tasks.ts` | Criar (com `externalRef` e `limits`), listar, detalhar, continuar, aprovar/recusar, cancelar, pausar, retomar, recuperar (`resume`, `retry`, `heal`); `executor` (instância, lease, tentativa); máquina de estados e comandos permitidos por status |
| `events.ts` | Envelope `{ v, stream, id, at, correlationId, payload }`, 16 tipos de evento, streams (`tasks`, `task:<id>`, `memory`, `index`, `metrics`, `system`), retenção, `checkSequence`, `readEvent` tolerante, protocolo WebSocket `singularity.v1` (hello, subscribe, ack, command, ping; welcome, event, gap, result, error, pong), códigos de fechamento e `sseFrame` |
| `memory.ts` | Memória, listagem, criação/atualização (sempre não verificada para remoto, versão esperada), busca híbrida com `degraded`, busca de conhecimento do projeto marcada `untrusted`, status de indexação e trabalhos de reindexação |
| `integrations.ts` | Regras do orquestrador externo, propriedade por campo, registro do adaptador, relatório de reconciliação, transportes, `/health` e push só com metadados |
| `routes.ts` | Catálogo das 33 rotas v1: método, caminho, escopo, só-local, idempotência, classe de limite, esquemas e erros específicos |

## 4. Decisões técnicas

| # | Decisão | Motivo |
|---|---|---|
| C2-1 | Contratos em `shared/src/core-api` com zod, subcaminho próprio | Mesma ferramenta do IPC; tipos e validação de uma fonte; OpenAPI gerável (`z.toJSONSchema`, testado em todas as rotas). Não depende da decisão D-CORE-a (nome do pacote do Core) |
| C2-2 | Mesmos enums e limites do domínio atual | Compatibilidade: tarefas, memórias e ids existentes continuam válidos |
| C2-3 | Requisição estrita, resposta tolerante | O servidor recusa campo desconhecido (erro de digitação não passa); clientes ignoram campo e tipo de evento novos (`readEvent`) |
| C2-4 | WebSocket principal + SSE somente leitura | O ADR rejeitou SSE como **único** transporte; aqui ele é complemento para quem só observa (adaptador, script). Mesmo envelope e mesma retomada (`since` = `Last-Event-ID`) |
| C2-5 | Idempotência por cabeçalho em toda mudança de estado, impressão digital = SHA-256 de `canonicalJson(body)`; repetição devolve o resultado com `replayed: true`; mesma chave com outro corpo = `idempotency_conflict` | Retentativas do mobile e do orquestrador nunca criam segunda tarefa. Para orquestrador, `system + id` do `externalRef` é único além da chave |
| C2-6 | Executor único por lease: `executor { instanceId, leaseExpiresAt, attempt }` só escrito pelo Core; evento `task.lease` | Prepara o CORE-04; protege contra dois Cores e contra o desktop antigo durante a transição |
| C2-7 | Transições: entre estados ativos livre (como o engine faz hoje), só `paused → pending`, finais nunca mudam; retomar cria tarefa filha | Conferido contra os pontos de `setStatus` do `TaskEngine`; nenhuma sequência atual fica inválida |
| C2-8 | DPoP com chave P-256 do aparelho, acesso de 15 min, refresh rotativo com detecção de reuso | Token roubado sem a chave não serve; reuso revoga a família inteira |
| C2-9 | `not_found` para recurso fora da concessão | Não revela a existência de projetos privados (IDOR) |
| C2-10 | Push só com `kind`, `taskId`, `at`, `coreId` (esquema estrito) | Nenhum conteúdo sai pelo relay de push; um campo de texto novo quebra o teste |
| C2-11 | Imagens fora da v1 remota | Upload exige recurso próprio e limites; entra como versão menor aditiva |
| C2-12 | Desktop isento de rate limit, nunca de validação | É local e confiável; a validação continua igual para todos |

## 5. Pontos do pedido e onde estão

| Requisito | Onde |
|---|---|
| 1. Auditoria | §1 deste documento |
| 2. API, eventos, WebSocket/SSE versionados | `routes.ts`, `events.ts`, `version.ts` |
| 3. Autenticação, autorização, pareamento, revogação | `auth.ts` |
| 4. Criação, acompanhamento, cancelamento, recuperação | `tasks.ts`, rotas `tasks*` |
| 5. Idempotência e executor único | `IDEMPOTENCY`, `executorSchema`, `externalRefSchema`, regra de rota testada |
| 6. Streaming de status, logs e métricas | `task.status`, `task.log`, `task.step`, `metrics.sample`, `index.progress` |
| 7. Memória, busca semântica, indexação | `memory.ts` |
| 8. Paperclip por adaptador isolado | `integrations.ts` (`ORCHESTRATOR_RULES`, `FIELD_OWNERSHIP`, reconciliação), rotas `orchestrators*` |
| 9. Mobile por acesso privado | `transportDescriptorSchema`, `privateEndpointSchema`, `healthSchema`, `pushNotificationSchema` |
| 10. Versionamento, compatibilidade, erros, limites | `version.ts`, `errors.ts`, `limits.ts` |

## 6. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Contrato divergir da implementação do CORE-03/05 | Clientes quebram | O servidor será gerado a partir de `CORE_ROUTES`; os testes de contrato passam a rodar contra o servidor real |
| Lease ainda não existe no banco | Dois executores possíveis até o CORE-04 | Hoje há um só processo executor; o contrato já reserva `executor` e `task.lease` |
| `funnel` tem o mesmo domínio `.ts.net` que `serve` | O esquema não distingue os dois | `funnel: false` é obrigatório no descritor; o CORE-07 confere o estado real do `tailscale serve` antes de anunciar o endereço |
| DPoP exige biblioteca de JOSE no Core e no app | Dependência nova | Escolha e licença registradas no CORE-07; o contrato só fixa os campos |
| Retenção de eventos (10.000 por stream, 24 h) | Cliente muito tempo offline perde eventos | `gap` manda reler o recurso pelo HTTP; nada se perde do estado |
| Paperclip ainda **NÃO VERIFICADO** | O adaptador pode não caber | As regras são restrição para a decisão 50.09; se o Paperclip só funcionar executando os próprios agentes, conta para a opção D |
| Segredos dependem do desktop até o S2 (D-7) | Integrações indisponíveis sem janela | `capability_unavailable` e `/health.capabilities` tornam isso explícito |

## 7. O que não mudou

Nenhum servidor, porta, processo, migração, canal IPC ou fluxo de autenticação foi criado ou alterado. Dados,
credenciais (`safeStorage`), o nome técnico NeuralBridge (D-1) e o servidor MCP seguem iguais. Reverter este lote é
remover `packages/shared/src/core-api/`, os três testes e a entrada `./core-api` do `package.json` do pacote.

## 8. Próximos lotes (cada um com autorização própria)

CORE-03 (processo embutido, `/health`, lock), CORE-04 (lease, `external_ref`, idempotency keys no banco), CORE-05
(TaskEngine, agentes, MCP e RAG no Core com eventos retomáveis), CORE-06 (desktop como adaptador), CORE-07
(pareamento, tokens, revogação, Tailscale, `SecretStore`).
