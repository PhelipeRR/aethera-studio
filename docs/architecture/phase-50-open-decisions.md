# Fase 50 — pacote de decisões abertas

**Status:** decisões confirmadas pelo usuário em 2026-11-10; implementações continuam aguardando autorização específica por frente.
**Data:** 2026-11-10.

Este documento não autoriza código. Ele consolida os gates que continuam abertos depois da conclusão dos lotes visuais
e CORE-02 a CORE-08. As decisões devem ser registradas antes de cada implementação e não alteram identificadores,
dados ou credenciais por inferência.

## 1. Paperclip — 50.09/50.10

### Decisão confirmada: opção A, adaptador de control plane

O Paperclip deve coordenar atribuição e governança, enquanto o Singularity Core continua sendo o único executor. A
integração só é aceitável se a PoC provar `external_ref`, idempotência, autenticação, reconciliação após restart e
um único lease por tarefa.

Decisão confirmada pelo usuário: **A**. A PoC 50.09 foi autorizada e concluída; a integração definitiva 50.10 permanece não autorizada.

- [x] A — integrar como control plane externo, sem executar agentes diretamente no desktop. **Decisão confirmada; Core continua como único executor.**
- [ ] B — não integrar; incorporar apenas conceitos comprovadamente úteis.
- [ ] C — fundir/substituir o TaskEngine (não recomendado; exige paridade completa).
- [ ] D — manter separado por incompatibilidade ou custo.

50.10: adaptador isolado em `70d1593`, opt-in. A ativação depende do ambiente: um servidor Paperclip em execução e
credenciais para o principal `orchestrator`.

## 2. COMP-01 — Companion como extensão

Decisões confirmadas: Core como fonte principal de execução e persistência, com compatibilidade Desktop e contratos
existentes, além das quatro escolhas abaixo.

Perguntas e alternativas documentadas em `docs/plans/companion-extension.md`:

- [x] D-COMP-a: **A — extensão `companion` separada do Void**; B — uma extensão única “Void”.
- [x] D-COMP-b: **desligado por padrão em instalações novas**.
- [x] D-COMP-c: **preservar o estado atual nas instalações existentes**.
- [x] D-COMP-d: **Spotify como extensão própria e independente**.

Gate atual: COMP-01 está implementado e validado no commit `ea8e40e`. Esta decisão não desbloqueia Paperclip 50.10,
MOB-01–03, migrações M1–M3 ou a alteração da wake word.

## 3. Companion Mobile — MOB-01–03

Decisões confirmadas pelo usuário; continuam sem scaffold ou implementação:

- [x] React Native + Expo com development builds como cliente oficial;
- [x] Android primeiro; iOS posteriormente;
- [x] notificações push somente com metadados;
- [x] voz opcional e busca RAG usando os serviços existentes do Core;
- [x] distribuição interna inicialmente.

MOB-01 a MOB-03 implementados (`8c6fdbf`, `77a1873`, `17818af`, mais SSE e ações de tarefa). Falta só o smoke num
dispositivo Android, que depende de SDK/aparelho; o provedor de push continua a definir.

Invariante: o Mobile nunca acessa SQLite, inicia CLI, executa MCP ou se torna dono de uma tarefa; tudo passa pelo Core.

## 4. Migrações técnicas e grupos do Core

Ordem recomendada:

1. inventariar e migrar um grupo de execução por vez;
2. M1 — instalador com nome visível novo, preservando `appId`;
3. M2 — cópia verificável de `%APPDATA%\\NeuralBridge` para `Singularity`;
4. M3 — alias MCP `singularity` ao lado de `neuralbridge`;
5. M4 — não executar salvo motivo forte e decisão específica.

Decisões confirmadas pelo usuário:

- [x] M1–M3 aprovados como planejamento, não como implementação;
- [x] cada migração deverá receber autorização separada, com testes e rollback;
- [x] migrar grupos individualmente, começando pelo menor risco identificado na auditoria;
- [x] manter credenciais no S0 enquanto não houver decisão de migração de segredos.

Executado em 2026-11-10: M1 (0.1.59, upgrade e rollback testados), M2 (com banco aberto adiando a cópia), M3, CORE-09 a
CORE-13 e o inventário dinâmico. **M4 rejeitada.**

## 5. Palavra de ativação

Decisão confirmada: **opção 2**, sem alterar código ainda.

- [ ] manter `Neura`;
- [x] mudar o padrão para `Void` e aceitar `Neura` como alias temporário e configurável;
- [ ] mudar para `Void` e remover `Neura` após janela de migração.

Implementado em `0c93d3e`: `Void` é a palavra primária e `Neura` continua como alias configurável; o identificador
técnico `neura` permanece inalterado.

Nenhuma alteração deve ser feita em `packages/extensions-neura`, no identificador técnico `neura` ou nos contratos até
esta decisão estar registrada.

## Critério de desbloqueio

Uma frente só sai de “aguardando decisão” quando as caixas correspondentes estiverem aprovadas, o plano específico
estiver revisado e o usuário autorizar a implementação daquela frente. Commits, push e mudanças em frentes não
autorizadas continuam proibidos.

