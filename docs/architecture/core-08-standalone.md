# CORE-08 — Core independente no logon, observabilidade e empacotamento

Status: **concluído em 2026-11-09** (commit por lote autorizado pelo usuário). Base: ADR CORE-01 §2.1 (modo
"Independente": tarefa agendada no logon do usuário, não um serviço em Session 0). O usuário autorizou registrar uma
tarefa agendada real e temporária para o teste, removida no fim.

## Como funciona

| Peça | Comportamento |
|---|---|
| Lançador | `NeuralBridge.exe --singularity-core` (desenvolvimento: `electron <app> --singularity-core`) não abre o app: inicia o Core como Node puro (`ELECTRON_RUN_AS_NODE=1`), desanexado e sem janela, só se nenhum Core vivo for dono da pasta de dados, e sai em seguida |
| Tarefa de logon | "Singularity Core", do usuário atual, `LeastPrivilege`, `InteractiveToken`, oculta, `IgnoreNew`, gatilho no logon com repetição a cada 5 min (um Core que caiu volta sozinho). Registrada e removida por `schtasks.exe` em caminho absoluto (`System32`) a partir de um XML UTF-16 temporário |
| Opt-in | Configurações → "Manter o Singularity Core ativo com a janela fechada". Ligar registra a tarefa e passa o Core da janela para o independente na hora; desligar remove a tarefa, encerra o Core independente com segurança e o desktop volta ao Core embutido |
| Conexão do desktop | O Core independente não tem canal IPC: grava o token do desktop em `core-desktop.token` na pasta de dados (o perfil do próprio usuário, como o resto do estado local), apaga ao sair e troca a cada início. O desktop lê o token, confirma o executor e vigia o `/health`; se o Core independente sumir, o desktop roda um embutido até a tarefa trazer outro |
| Fechar e sair | Com o modo independente ligado, sair do desktop não encerra o Core. Se o desktop estava com um Core embutido, ele passa a vez: inicia um independente que espera o embutido terminar (`NB_CORE_WAIT_PID`) |
| Observabilidade | `/internal/v1/status`: modo, PID, versão, tempo ativo, memória, CPU e tarefas em execução, mostrados em Configurações; logs JSON redigidos em `logs/core.log` e `logs/core-supervisor.log` |
| Empacotamento | O instalador contém `out/main/core.js` (verificado por `verify:dist`); o lançador funciona no app empacotado (teste) |

## Fechar a janela, sair e o Core independente (atualizado)

| Ação | Modo junto com a janela (padrão) | Modo independente (opt-in) |
|---|---|---|
| Fechar a janela | Vai para a bandeja; Core e tarefas continuam | Igual |
| Sair do Singularity | Core encerra com o app; tarefas em andamento são canceladas e recuperadas na próxima abertura | Core continua; tarefas do chat seguem rodando; o mobile continua funcionando |
| O app cai | O Core morre junto (job do Windows); o lock é assumido na próxima abertura | O Core continua |
| O Core cai | O desktop reinicia com espera crescente (até 5 em 10 min) | O desktop roda um embutido; a tarefa de logon traz o independente em até 5 min |
| Entrar no Windows | Nada até abrir o app | A tarefa inicia o Core |

## Testes

- `apps/desktop/test/core-standalone.test.ts` (4): XML da tarefa (usuário atual, menor privilégio, oculta, repetição,
  sem serviço/SYSTEM/boot), escaping de caminhos, registro por arquivo UTF-16 removido depois, remoção só do que
  existe, arquivos de configuração e token.
- `apps/desktop/test/core-supervisor.test.ts` (+1): conexão a um Core independente com o token e retomada com Core
  embutido quando ele some; sair conectado não manda encerrar o Core independente.
- `tests/e2e/core-standalone.spec.ts` (2, Electron real): o lançador inicia um Core independente, uma segunda execução
  não cria outro, o desktop se conecta e executa uma tarefa nele, e o Core sobrevive ao fechar o desktop; ligar o modo
  registra uma **tarefa agendada real** (consultada com `schtasks /Query /XML`: logon, sem privilégio elevado), a troca
  acontece, `schtasks /Run` não cria um segundo Core, desligar remove a tarefa, encerra o independente e volta ao embutido.
  A tarefa de teste é removida sempre (`finally`); nenhuma ficou registrada.
- `tests/e2e/core-packaged.spec.ts` (+1): o lançador no app empacotado.

## Achados durante o lote

- O filho que encontra outro Core sai com código 3 depois que a conexão já foi feita; o supervisor apagava essa
  conexão. Corrigido (só limpa quando não está conectado a outro Core).
- O Core independente herda o ambiente de quem o lança. Na tarefa de logon é o ambiente do usuário, onde as CLIs estão
  autenticadas, como no desktop.

## Limites e riscos

- Custo: o Core com o domínio de tarefas usa cerca de 140 MB de memória (medido pelo `/internal/v1/status`); em
  repouso a CPU fica perto de zero.
- Um Core independente que cai fica fora até 5 min se o desktop estiver fechado (próxima repetição da tarefa).
- O token do desktop em arquivo é protegido só pelas permissões do perfil do usuário, como os demais dados locais; ele
  dá acesso apenas ao Core em loopback.
- Segredos de integrações continuam no desktop (S0): sem janela, integrações que dependem deles ficam indisponíveis.

## Reverter

Desligar a opção remove a tarefa e volta ao modo junto com a janela. Manualmente:
`schtasks /Delete /TN "Singularity Core" /F` e apagar `core-standalone.json` da pasta de dados.
