# ADR PAPERCLIP-50-10 — Adaptador de control plane sem executor duplicado

**Status:** aceito para a implementação isolada em 2026-11-10; ativação automática e provisionamento de credenciais ainda não são padrão.

## Decisão

O Paperclip será integrado somente por um adaptador em `packages/orchestrator`. Ele consulta atribuições e estados do
Paperclip, mas o Singularity Core continua sendo o único dono de criação, execução, lease, cancelamento, eventos,
memória, RAG e credenciais de agentes.

O adaptador:

- mapeia cada issue para `external_ref = { system: "paperclip", id: "<company>/<issue>", revision }`;
- consulta o Core por `external_ref` antes de criar uma tarefa;
- envia `Idempotency-Key` determinística por revisão;
- reconcilia após reconexão sem criar tarefa duplicada;
- cancela primeiro no Core e depois espelha o estado no Paperclip;
- exige somente `read`, `task:create` e `task:cancel`;
- não faz checkout, heartbeat de executor, spawn de agente, acesso direto ao banco ou compartilhamento de segredos.

## Consequências

O Paperclip pode continuar indisponível sem impedir o Desktop, o Core ou o TaskEngine. Divergências são observadas e
reportadas; o adaptador não corrige automaticamente o estado do Core. O cliente HTTP recebe token por injeção no processo
do adaptador, nunca pelo renderer.

## Rollback

Desativar o consumidor do adaptador interrompe sincronização futura; tarefas já criadas continuam no Core com seu
`external_ref`. A remoção do módulo não apaga tarefas, memórias, credenciais ou dados do Paperclip.

## Limitações desta etapa

O provisionamento de credencial mútua, a tela de configuração e a ativação contra um Core remoto autenticado ainda não
foram ligados ao Desktop. Isso é deliberado até existir um contrato de autenticação para principals `orchestrator`.
