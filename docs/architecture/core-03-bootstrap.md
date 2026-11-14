# CORE-03 — Bootstrap do Singularity Core

Status: **aprovado em 2026-11-09**. Base: ADR CORE-01 §2.1 (processo e ciclo de vida, D-6)
e contratos CORE-02 (`@neuralbridge/shared/core-api`). Este lote cria o processo do Core e sua supervisão. Ele **não
migra nada**: o TaskEngine, os agentes, a memória, o RAG e o MCP continuam no processo principal do Electron, que segue
sendo o único executor de tarefas.

## 1. Auditoria do ciclo de vida atual do Electron

| Momento | Como é hoje (`apps/desktop/src/main/index.ts`) |
|---|---|
| Início | `app.setName('NeuralBridge')`, `userData` = pasta de dados, `requestSingleInstanceLock()` (uma janela do app por pasta de dados). Banco, MCP, busca semântica, TaskEngine (com `recover`), workflows, Velix, monitoramento e Companion são compostos de forma síncrona no carregamento do main; janela, Void, HUD e bandeja sobem em `whenReady` |
| TaskEngine | Criado uma vez no main, com fila por projeto em memória; `before-quit` chama `cancelAll()`; a recuperação marca tarefas interrompidas na próxima abertura |
| Fechar a janela | No Windows a janela vai para a bandeja (`keepInTray`); o app continua rodando, inclusive tarefas e HUD |
| Sair | Menu da bandeja → `quitting = true` → `app.quit()` → handlers de `before-quit` e `will-quit` (cancelar tarefas, fechar banco, worker local, Void, Spotify, monitoramento, bandeja). O Electron **não espera** promessas nesses handlers |
| Processos filhos já existentes | Servidor MCP (o próprio executável com `ELECTRON_RUN_AS_NODE=1`, iniciado pelos clientes), worker local de voz, worker de histórico, processos de agentes |
| Queda do main | No Windows, o libuv põe os filhos num *job object* com `KILL_ON_JOB_CLOSE`: eles morrem junto com o main |

## 2. Arquitetura implementada

```
 Electron main ── fork(core.js, ELECTRON_RUN_AS_NODE=1, canal IPC) ──► Singularity Core (Node)
   CoreSupervisor                                                         ├─ core.lock (O_EXCL, um por pasta de dados)
   ├─ espera "ready" (15 s)                                               ├─ HTTP só em 127.0.0.1, porta dinâmica
   ├─ heartbeat ping/pong a cada 5 s (3 perdidos = travado)               │   └─ GET /api/v1/health (contrato CORE-02)
   ├─ reinício com espera crescente 1/2/5/10/30 s, no máximo 5 em 10 min  ├─ logs JSON redigidos em logs/core.log
   └─ will-quit → shutdown gracioso (5 s, depois kill)                     └─ para sozinho se o canal fechar ou o desktop sumir
```

| Peça | Arquivo | Função |
|---|---|---|
| Pacote | `packages/core` (`@neuralbridge/core`) | Resolve a decisão D-CORE-a com a recomendação do ADR. Proibido importar `electron` (regra de lint) |
| Entrada | `packages/core/src/main.ts` → `out/main/core.js` | Lê a configuração do ambiente, liga IPC, sinais e códigos de saída (0 ok, 3 já em execução, 4 falha de inicialização, 5 tempo de encerramento esgotado) |
| Ciclo de vida | `runtime.ts` | Lock → servidor → `ready`; `shutdown` idempotente (para de aceitar, fecha conexões, libera o lock) |
| Lock | `lock.ts` | Criação exclusiva; lock de processo morto ou de PID reutilizado (o `/health` não responde com o mesmo id de instância) é assumido; quem ainda está subindo tem 15 s de tolerância |
| Servidor | `server.ts` | Só `127.0.0.1`; recusa par que não seja loopback; recusa `Host` diferente de `127.0.0.1:<porta>` ou `localhost:<porta>` (proteção contra DNS rebinding); sem CORS; `Cache-Control: no-store`; qualquer outra rota responde o envelope de erro do CORE-02 |
| Protocolo | `protocol.ts` | Mensagens validadas com zod nos dois sentidos: `ping`/`shutdown` e `ready`/`pong`/`already-running`/`stopping`; tempos e códigos de saída |
| Logs | `log.ts` | Uma linha JSON por evento; só campos primitivos; texto passa pelo mesmo `redactSecrets` dos eventos de tarefa; campo com nome de credencial vira `[removido]`; caminho absoluto vira só o último trecho (tira o nome do usuário do Windows); rotação em 5 MB |
| Supervisor | `apps/desktop/src/main/core/supervisor.ts` | Estados `starting`, `running`, `attached`, `restarting`, `failed`, `stopping`, `stopped`, `disabled`; sem laço de reinício |
| Ligação | `apps/desktop/src/main/core/index.ts` + 4 linhas em `index.ts` | Ambiente do filho (modo embutido forçado; ganchos de teste removidos no app empacotado), log `logs/core-supervisor.log`, chave `NB_CORE_DISABLED=1` |

### Decisões

- **Porta dinâmica** (D-CORE-d, como recomendado): o Core escuta numa porta escolhida pelo sistema e grava a porta no
  `core.lock` e na mensagem `ready`. `NB_CORE_PORT` pede uma porta fixa; se ela estiver ocupada, o Core usa uma
  dinâmica e registra `core.port_in_use`.
- **Segunda instância não é falha.** Se outro Core vivo for dono da pasta, o novo sai com código 3 e o supervisor fica
  `attached`, sem reiniciar nada.
- **Encerramento sem depender do Electron esperar.** No `will-quit` o desktop pede `shutdown`. Mesmo que o Electron
  saia antes da resposta, o Core para sozinho quando o canal fecha (`parent-gone`) ou quando passa 30 s sem heartbeat
  (`parent-silent`).
- **`/health` sem dados sensíveis.** Só os campos do contrato: status, versão, versões da API, modo, desktop conectado,
  capacidades (todas `false` neste lote) e horário de início. Sem PID, caminho, usuário, porta ou ambiente. O id
  aleatório da instância vai no cabeçalho `Singularity-Core-Instance`, para o lock reconhecer o dono.

## 3. Fechar a janela, sair do Electron e o Core independente no futuro

| Ação | Janela | Electron (main) | Core embutido (hoje) | Tarefas | Core independente (CORE-08, futuro) |
|---|---|---|---|---|---|
| **Fechar a janela** (X) | Vai para a bandeja | Continua | Continua rodando | Continuam (o executor é o main) | Continua |
| **Sair** (bandeja → Sair) | Fecha | Encerra | Recebe `shutdown`, fecha o servidor, libera o lock e sai (até 5 s; depois é morto) | O main cancela as tarefas em andamento, como antes | O desktop só se desconecta; o Core continua e o mobile segue funcionando |
| **O Electron cai ou é morto** | Some | Morre | No Windows morre junto (job do libuv); o lock velho é assumido na próxima abertura | Recuperadas na próxima abertura, como antes | Continua; o desktop se reconecta ao abrir |
| **O Core cai** | Nada muda | Nada muda | Reiniciado em 1, 2, 5, 10, 30 s; depois de 5 quedas em 10 min fica `failed` até a próxima abertura | Nada muda (ainda não dependem do Core) | Um supervisor próprio (tarefa no logon) reinicia |
| **Logoff ou desligar o PC** | Some | Encerra | Encerra | Recuperadas na próxima abertura | Encerra; volta no próximo logon |

O modo independente já está previsto no código (`NB_CORE_MODE=standalone`, mesma entrada, sem Electron), mas fica
**bloqueado** neste lote: só roda com `NB_CORE_ALLOW_STANDALONE=1`, que o desktop nunca define. Ligar esse modo,
registrar a tarefa de logon e fazer o desktop se conectar a um Core já ativo é o CORE-08. Nenhum serviço Windows é
criado.

## 4. Segurança

- Nenhuma porta fora do loopback: o bind é `127.0.0.1` (testado tentando conectar pelo IP da rede local) e o servidor
  ainda derruba conexões cujo par não seja loopback.
- Sem autenticação neste lote, porque não há nada para proteger além do status: a única rota é `/health`, que expõe só
  campos públicos. Autenticação e pareamento ficam para o CORE-07, antes de qualquer rota com dados.
- Proteção contra sites abertos no navegador: sem CORS, o navegador não deixa outra origem ler a resposta, e `Host`
  diferente de loopback é recusado (DNS rebinding).
- Ganchos de teste (`NB_CORE_TEST_CRASH`, `NB_CORE_ALLOW_TEST_HOOKS`, `NB_CORE_ALLOW_STANDALONE`) são removidos do
  ambiente do filho no app empacotado (teste no app empacotado).
- O Core herda o ambiente do desktop, porque o CORE-05 vai precisar do `PATH` e da autenticação das CLIs. Ele nunca
  grava o ambiente em log.

## 5. Limitações e riscos

| Item | Situação |
|---|---|
| O Core ainda não faz nada além de `/health` | Intencional: a migração é o CORE-05 |
| Estado `attached` (outro Core dono da pasta) não é monitorado pelo desktop | Só acontece com dois desktops na mesma pasta, o que o `requestSingleInstanceLock` já impede; o monitoramento entra no CORE-08 |
| Lock velho depois de queda ou desligamento | Assumido na próxima abertura (PID morto, ou PID reutilizado que não responde com o mesmo id) |
| Antivírus ou política corporativa bloqueando `ELECTRON_RUN_AS_NODE` | Mesmo mecanismo do servidor MCP já distribuído; se o Core falhar, o desktop segue normal e o log registra `core.restart_limit` |
| Um processo a mais por execução | Medido em repouso (app em desenvolvimento, 20 s): CPU 0,0% (abaixo da resolução do contador, menos de 0,08% de um núcleo), 72 MB de working set e 46 MB de memória privada. É quase todo o runtime do Node; sem trabalho, o único timer é o heartbeat |
| `NB_CORE_PORT` fixa pode colidir | O Core cai para uma porta dinâmica |
| Caminho `disconnect`/`parent-silent` | Coberto por código; no Windows a queda do main já mata o filho pelo job do libuv, então o caminho comum é o `shutdown` |

## 6. Como reverter

- **Sem recompilar:** `NB_CORE_DISABLED=1` impede o desktop de iniciar o Core (testado). Nada do app depende dele.
- **No código:** remover a chamada `createCoreSupervisor`/`core.start()` em `index.ts`. O pacote pode ficar, porque
  não é carregado.
- **Dados:** nenhum dado foi criado além de `core.lock` (apagado ao sair) e `logs/core*.log`.
