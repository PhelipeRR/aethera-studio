# Skills Intelligence & Studio — Design

## Intent

Criar uma evolução incremental e segura do Skills Manager para compreender contexto de tarefas, avaliar skills e integrar seu uso aos fluxos existentes.

## Goals and non-goals

O Lote 1 cobre somente auditoria, contratos tipados, inventário, confiança declarativa e matriz de integração. Discovery, recomendação, instalação avançada, Skill Studio, persistência nova e IPC novo ficam para lotes posteriores.

## Approach

Foi escolhida a evolução por submódulo `packages/workspace/src/skills/`, mantendo `skills.ts` como fachada compatível. Um pacote independente duplicaria fronteiras; uma refatoração imediata do arquivo legado aumentaria risco sem entregar capacidade do Lote 1.

## Safety

O conteúdo é não confiável; scripts permanecem inertes; aprovação explícita continua obrigatória; allowlist HTTPS, limites, path traversal e symlinks permanecem implementados no serviço atual.

## Integrations

TaskEngine continua dono da execução; Workflow Builder continua dono da definição/execução de workflows; Git Intelligence mantém autorização; Brain/RAG fornece contexto delimitado; Token Optimizer permanece responsável pelo orçamento; IPC e persistência não mudam no Lote 1.
