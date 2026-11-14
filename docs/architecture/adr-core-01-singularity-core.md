# ADR CORE-01 — Singularity Core: separação do Electron, acesso remoto e fronteira com o Paperclip

- **Status:** PROPOSTO — decisões de base aprovadas pelo usuário em 2026-11-08 (D-6, D-7, D-8 com ajustes).
  **Implementação não autorizada.**
- **Fase:** 50, trilha CORE. Base factual: `docs/plans/phase-50-singularity-audit.md` §3.
- **Escopo deste ADR:** onde roda a lógica, quem é dono de cada estado, como clientes falam com o Core, como os
  segredos migram, como o mobile acessa e como um orquestrador externo (Paperclip) se encaixa sem executar a
  mesma tarefa duas vezes.

## 1. Contexto

- O domínio já está fora do Electron: `orchestrator`, `brain`, `agents`, `workspace`, `database` e `mcp-server`
  não importam `electron`.
- A composição (criação de serviços, caminhos, segredos, janelas) está em `apps/desktop/src/main/index.ts`
  (1.856 linhas), junto com os 397 canais IPC com schema zod (`shared/src/ipc.ts`).
- Dois processos já abrem o mesmo `brain.db` (desktop e servidor MCP stdio), com WAL e `busy_timeout = 5000`.
  O MCP só lê e escreve memórias; tarefas rodam apenas no desktop.
- Os segredos usam `safeStorage` do Electron (DPAPI), em arquivos `.bin` dentro de `%APPDATA%\NeuralBridge`. A
  chave fica no `Local State` dessa mesma pasta.
- Os agentes rodam como subprocessos (`agents/src/process-runner.ts`), com a autenticação das CLIs da sessão do
  usuário.
- Não há servidor de rede, exceto o loopback do OAuth.
- As tarefas não têm lease nem dono registrado no banco.

## 2. Decisão

### 2.1 Processo e ciclo de vida (D-6)

O **Singularity Core** é um processo Node.js (o runtime do Electron com `ELECTRON_RUN_AS_NODE=1` no início,
como o servidor MCP já faz), com entrada própria (`packages/core/src/main.ts`, nome a confirmar).

Ele roda em dois modos, com **o mesmo código e a mesma entrada**:

| Modo | Quem inicia | Quando | Fase |
|---|---|---|---|
| **Embutido** | o Electron, como processo filho supervisionado | padrão | CORE-03 |
| **Independente** | uma tarefa agendada no logon do usuário (não um serviço em Session 0) | opt-in em Configurações | CORE-08 |

Regras para os dois modos funcionarem desde o início:

1. O Core não importa `electron` (regra de lint, como já vale para `packages/*`).
2. O Core não supõe janela: notificações, fala, captura de tela e HUD são **capacidades do desktop**, que o
   desktop registra no Core ao conectar e retira ao desconectar. Sem desktop, essas capacidades aparecem como
   indisponíveis, e nada falha em silêncio.
3. Um arquivo de lock na pasta de dados (`core.lock`, com PID e porta) garante **um Core por pasta de dados**. O
   Electron primeiro tenta se conectar a um Core já ativo e só cria um filho se não houver nenhum. Assim, com o
   modo independente ligado, fechar a janela não derruba o Core, e o mobile continua funcionando.
4. Health check (`/health`), graceful shutdown (termina as etapas em andamento ou as devolve para a fila) e
   recuperação de jobs na inicialização, reaproveitando `recovery-policy.ts` e `execution_snapshots`.
5. O Core roda **na sessão do usuário**, porque as CLIs Claude e Codex dependem da autenticação dela. Por isso
   o modo independente usa uma tarefa no logon, não um serviço Windows.

### 2.2 Dono único da execução

- **O TaskEngine do Core é a única autoridade que executa tarefas.** Desktop, mobile, MCP e qualquer
  orquestrador externo só **pedem** (criar, aprovar, cancelar) e **observam**.
- Migração aditiva (CORE-04): colunas `owner_instance_id`, `lease_expires_at` e `external_ref` (ver §6) em
  `tasks`. Uma etapa só começa com lease adquirido numa transação; o lease é renovado durante a execução e
  retomado pela política de recuperação quando vencer. Isso protege contra dois Cores (bug do lock) e contra o
  desktop antigo rodando junto durante a transição.
- Toda operação que muda estado aceita uma **idempotency key** do cliente; repetir a mesma chave devolve o
  resultado anterior.
- O servidor MCP continua lendo e gravando memórias direto no banco (WAL), porque isso já funciona. Ferramentas
  MCP que criam tarefas passam a chamar a API do Core (CORE-05).

### 2.3 Contratos

- **API versionada `/api/v1`** sobre HTTP, com eventos por **WebSocket** (bidirecional: cancelamento, chat do
  Companion e confirmação de entrega). Os schemas saem dos schemas zod de `shared`, numa versão pública separada
  dos canais IPC internos. O OpenAPI é gerado a partir deles.
- Os eventos têm id monotônico por stream e `correlationId` (já existe `correlation.ts`). O cliente reconecta
  informando o último id recebido (`since`) e recebe o que faltou, com retenção limitada.
- Transição do desktop (CORE-06): o renderer continua falando IPC; o main vira **adaptador** que encaminha para o
  Core. A troca é por grupo de canais, atrás de uma flag, com o caminho antigo ativo até cada grupo passar nos
  testes.

### 2.4 Segredos (D-7)

| Etapa | O que acontece |
|---|---|
| **S0 — hoje até CORE-06** | `safeStorage` continua igual. O Core pede um segredo ao desktop por um canal autenticado, só no momento do uso; o segredo não é gravado nem logado. Sem desktop, as integrações que dependem de segredo (YouTube, Gemini, Azure DevOps) aparecem como "indisponível com a janela fechada". Os agentes não dependem disso, porque as CLIs têm a própria autenticação. |
| **S1 — CORE-07** | Novo `SecretStore` do Core baseado no **Windows Credential Manager / DPAPI do usuário** por módulo nativo (escolha e licença registradas no lote). O código fica atrás de uma interface, com implementação falsa para testes. |
| **S2 — migração** | O desktop decifra cada `.bin` e grava no novo store. Depois, lê de volta e compara o hash. Só então marca o segredo como migrado. **Os `.bin` originais ficam intactos** por pelo menos uma versão. Leitura dupla: novo store primeiro e `.bin` como fallback. |
| **S3 — rollback** | Uma flag volta a leitura para os `.bin`. Como eles não foram apagados, nada se perde. A remoção dos `.bin` exige uma versão posterior e confirmação do usuário. |

Invariantes: nenhum segredo sai do PC para o mobile; nenhum segredo vai para log, evento ou notificação; a
criptografia nunca fica mais fraca que DPAPI do usuário.

### 2.5 Acesso remoto e mobile (D-8)

- **O Core escuta só em `127.0.0.1`**, sempre. Nenhuma porta é aberta em interface pública ou de LAN.
- **Primeiro transporte: Tailscale.** O acesso remoto passa por `tailscale serve`, que publica o loopback do Core
  como HTTPS **somente dentro da tailnet** do usuário. `tailscale funnel` (exposição pública) é proibido e
  bloqueado na configuração do Singularity. O Singularity não instala o Tailscale: ele detecta o Tailscale e
  guia o usuário.
- **Abstração de transporte:** um `RemoteTransport`, que define como o cliente chega. A autenticação **não
  depende** do transporte: estar na tailnet não basta para autorizar nada. Outros meios (reverse proxy HTTPS com
  mTLS, outra VPN) entram como novas implementações.
- **Autenticação e pareamento:**
  1. O usuário inicia o pareamento no desktop, que mostra um QR com um código de uso único, curto (≤ 5 min) e
     ligado ao endereço do Core.
  2. O app escaneia o QR, gera um par de chaves no armazenamento seguro do aparelho e envia a chave pública com
     o código.
  3. O desktop pede confirmação ("Parear o iPhone de Fulano?"). Só depois disso o dispositivo é registrado.
  4. As sessões usam token de acesso de curta duração e refresh token rotativo, vinculados ao dispositivo, com
     prova de posse da chave do aparelho.
- **Escopos por ação:** `read`, `chat`, `task:create`, `task:approve`, `task:cancel`. Ações perigosas (aprovar,
  executar em projeto com Acesso total) exigem um escopo explícito dado no pareamento e podem exigir confirmação
  local adicional.
- **Revogação:** a tela "Dispositivos" no desktop e no Core lista os aparelhos, o último acesso e os escopos.
  Revogar invalida os tokens na hora e derruba as conexões abertas. Também existe "revogar todos".
- **Proteções:** rate limit e bloqueio progressivo no pareamento e no login, trilha de auditoria (quem, o quê,
  de qual dispositivo) e verificação de autorização por recurso (proteção contra IDOR).
- **Notificações:** eventos de conclusão, erro, pedido de aprovação e limite de custo. O push leva **só
  metadados** ("Tarefa concluída", id); o conteúdo é buscado pelo app autenticado. O provedor de push (Expo Push,
  FCM/APNs) exige um relay externo: é a única saída de rede fora da tailnet, e a escolha fica registrada no
  MOB-02 (D-CORE-c). Com o app aberto, os eventos vêm pelo WebSocket, sem push.
- **Limite honesto:** com o PC desligado ou o Core parado, o mobile mostra "host indisponível" e o cache seguro.
  Ele não promete execução.

## 3. Alternativas consideradas

| Alternativa | Motivo da rejeição ou adiamento |
|---|---|
| Manter tudo no main do Electron e expor HTTP de lá | Fechar a janela derruba o mobile, o que viola o D-6 |
| Serviço Windows (Session 0) | Não enxerga a autenticação das CLIs nem o perfil do usuário (auditoria, achado 4) |
| Core só independente desde o início | Mais risco de instalação e suporte; o embutido entrega valor antes com o mesmo código |
| SSE em vez de WebSocket | Unidirecional; o chat e o cancelamento precisariam de um segundo canal |
| Porta na LAN com TLS próprio | Mais superfície de ataque e gestão de certificado; o Tailscale resolve o transporte com menos risco |
| Migrar segredos para arquivo cifrado com senha | Pede senha ao usuário e é mais fraco que DPAPI sem gestão de chave |

## 4. Consequências

- **Positivas:** um backend para vários clientes; o domínio já pronto é reaproveitado; o mobile funciona com a
  janela fechada; um único dono de execução.
- **Negativas:** mais um processo para supervisionar; latência de IPC para HTTP no desktop (medir no CORE-06);
  integrações com segredo ficam indisponíveis sem desktop até o S2.
- **Riscos que continuam abertos:** módulo nativo de Credential Manager (licença, build no Windows);
  dependência de um relay de push.

## 5. Plano incremental (com testes e rollback)

| Lote | Entrega | Aceite principal | Rollback |
|---|---|---|---|
| CORE-02 | Contratos `/api/v1`, eventos, escopos e schemas de pareamento (só documento e tipos) | Schemas revisados; testes de contrato planejados | Documento |
| CORE-03 | Processo Core embutido: boot, `/health`, lock, shutdown, sem lógica migrada | O Core sobe e cai com o desktop; o E2E atual passa sem mudanças | Flag desliga o filho |
| CORE-04 | Lease, dono e `external_ref` em `tasks` (migração aditiva); idempotency keys | Teste de corrida: dois executores, uma execução | Colunas ignoradas pelo código antigo |
| CORE-05 | TaskEngine, agentes, MCP e RAG compostos no Core; eventos com retomada | Execução, streaming, cancelamento e recuperação iguais aos atuais | Flag volta a compor no main |
| CORE-06 | Desktop vira adaptador, grupo por grupo de canais | Suíte Vitest e E2E completas sem regressão | Flag por grupo |
| CORE-07 | Pareamento, tokens, escopos, revogação, Tailscale `serve`, `SecretStore` S1 e migração S2 | Testes de segurança (acesso não autorizado, replay, IDOR, revogação) | Remoto desligado por padrão; leitura dos `.bin` |
| CORE-08 | Modo independente no logon, observabilidade e empacotamento | O mobile funciona com a janela fechada; upgrade e rollback testados no Windows | Desligar o modo independente |

O CORE-03 a CORE-08 só começam com autorização explícita. Os lotes visuais (50.02–50.08) não dependem deles.

## 6. Fronteira com o Paperclip e com outros orquestradores

Objetivo: permitir que o Paperclip (ou outro control plane) seja integrado no lote 50.10 sem dois sistemas
executando a mesma tarefa. Os fatos sobre o Paperclip vêm do briefing e estão **NÃO VERIFICADOS** até o estudo
técnico do lote 50.09.

**Princípios fixados agora**

1. **Execução é do Core.** O TaskEngine é o único que roda agentes. Um orquestrador externo pode planejar,
   delegar, priorizar, aprovar e orçar, mas **nunca inicia um processo de agente** num projeto gerenciado pelo
   Singularity. Se o Paperclip só funcionar executando os próprios agentes, isso é incompatível com a opção A ou
   B (integrar ou incorporar) e conta como evidência para a D (não integrar) na decisão 50.09.
2. **Integração só pela API pública do Core**, por um adaptador isolado (`OrchestratorAdapter`): sem acesso ao
   banco do outro lado e sem banco compartilhado.
3. **Correlação:** cada tarefa vinda de fora carrega `external_ref = { system, id, revision }` (coluna do
   CORE-04). O par `system + id` é único. Repetir a mesma requisição não cria uma segunda tarefa, porque a
   idempotência é garantida pelo `external_ref` e pela idempotency key.
4. **Ownership por campo:**

| Estado | Dono | O outro lado |
|---|---|---|
| Execução, etapas, lease, logs, evidências | Core | só lê, por eventos |
| Hierarquia, metas, delegação, orçamento organizacional | orquestrador externo (se aprovado) | o Core aplica os limites recebidos |
| Aprovação humana | quem a pede registra; o Core é a fonte do resultado | espelho |
| Credenciais de provedores e MCP | Core | nunca compartilhadas |
| Memória e RAG | Core | consulta pela API |

5. **Cancelamento:** qualquer lado pode pedir; só o Core cancela e emite `task.cancelled`, e o adaptador
   propaga o evento.
6. **Reconciliação:** na inicialização e periodicamente, o adaptador compara as tarefas abertas com
   `external_ref` contra o estado do sistema externo. Divergências viram alerta, não correção automática.
7. **Desligar o adaptador** não afeta as tarefas: elas continuam no Core com o `external_ref` guardado (rollback
   do lote 50.10).

**Ordem:** o CORE-02 (contratos) e o CORE-04 (lease e `external_ref`) precedem a PoC do Paperclip. O estudo da
50.09 preenche a matriz comparativa do briefing §6.2 e decide entre A, B, C e D com estes princípios como
restrição. A opção C (fusão) continua bloqueada sem um novo ADR.

## 7. Decisões internas ainda abertas

- **D-CORE-a:** nome e local do pacote (`packages/core` recomendado).
- **D-CORE-b:** módulo nativo para Credential Manager/DPAPI (avaliar licença, manutenção e build).
- **D-CORE-c:** provedor de push e relay (Expo Push recomendado para o MVP).
- **D-CORE-d:** porta do Core (fixa configurável ou dinâmica gravada no `core.lock`; a recomendação é dinâmica).
