# Fase 51 — Void Personal Agent (`VOID-PA-01`)

**Status:** PLANEJADO em 2026-11-10. Nenhum lote começa sem autorização explícita. Sem commit ou push sem autorização.
**Numeração:** confirmada. A última fase do roadmap é a 50 (Singularity); não há Fase 51 em `docs/PLAN.md` nem em `docs/plans/`.
**Briefing do usuário:** assistente pessoal do Void com Gmail, Google Agenda, WhatsApp, monitoramento, automações,
orquestração por Claude/Codex, notificações e interface própria.

## 1. Auditoria: o que já existe e será reaproveitado

| Necessidade do briefing | O que o repositório já tem | Decisão |
|---|---|---|
| OAuth 2.0 com PKCE para Google | `apps/desktop/src/main/oauth/loopback.ts` (PKCE, loopback, troca e renovação de token, cliente desktop do Google) e `oauth/channel-token.ts` (renovação antecipada), já usados pelo canal do YouTube | **Reusar.** Gmail e Agenda só acrescentam escopos e um armazenamento por conta |
| Cofre de credenciais | `safeStorage` do Electron via `SecretCipher` (`spotify/token-store.ts`): token só vai ao disco cifrado pelo SO; sem cifra, fica em memória | **Reusar o padrão** num `IntegrationTokenStore` genérico (um arquivo `.bin` por conta). Política S0 mantida: segredo fica no desktop |
| Aprovação de ações sensíveis e auditoria | `ComputerActionBroker` + tabela `neura_action_audits`: risco `safe`/`confirm`/`blocked`, fingerprint, expiração, decisão humana, executor tipado | **Reusar e estender** com novos `actionType` (`mail.send`, `calendar.create`…). É o `IApprovalService` do briefing |
| Interpretar comandos do Void | `neura-intents.ts` (lista fechada de intenções tipadas; o resto é conversa que só produz texto), `neura-orchestrator.ts`, `neura-registry.ts` | **Estender** com intenções pessoais; manter a regra "conversa nunca executa" |
| Execução por agentes | TaskEngine + Singularity Core (lease, `externalRef`, idempotência, eventos SSE), adaptador híbrido | **Reusar.** É o `IAgentTaskDispatcher`. Nenhum motor paralelo |
| Saída estruturada dos agentes | `runStructuredReadOnly` (JSON com schema, somente leitura) | **Reusar** para resumo, classificação e rascunho |
| Agendamento e deduplicação | Padrão das automações Git (`git_ref_cursors`, `dedupeKey`, limite por hora) e recuperação no boot (`waitForCore`) | **Reusar o padrão**; o agendador de relógio é novo (não existe cron persistente) |
| Módulo ligável/desligável | Plataforma de extensões (`BUILTIN_EXTENSION_MANIFESTS`, gates como Companion/Spotify) | **Nova extensão built-in `personal-agent`**, desligada por padrão |
| Memória | Cérebro (memórias, RAG, MCP) | **Reusar**, só com gravação autorizada e política de retenção |
| Mobile | Companion Mobile fala só com o Core; push só com metadados | **Canal futuro** do serviço de notificações; nenhum contrato novo agora |
| Design system | Tokens e componentes Singularity (`PageHeader`, `GlassPanel`, `StatusDot`, `FeedbackState`…) | **Reusar.** Sem segundo design system |

**Lacunas reais (código novo):** conectores Gmail/Agenda/WhatsApp; agendador persistente de relógio; serviço e central de
notificações (hoje não há `Notification` nativa do Electron nem central); tabelas do módulo; telas.

## 2. Decisões de arquitetura propostas

1. **Onde roda.** Conectores, tokens, monitoramento e agendador rodam no **processo principal do desktop**, porque os
   segredos estão no `safeStorage` (S0). Trabalho de agente vai ao **Core** pelo adaptador híbrido. Consequência aceita:
   com o desktop fechado, o monitoramento para; ao abrir, execuções perdidas são tratadas pela política de recuperação
   (D-PA-5). Migrar para o Core fica condicionado ao cofre S1/S2.
2. **Sem motor paralelo.** `PersonalAgentOrchestrator` é uma camada fina: intenção → plano de ferramentas → broker de
   aprovação → ferramenta tipada → tarefa no TaskEngine quando precisa de modelo. O `PersonalAutomationEngine` dispara
   tarefas e ferramentas; não executa agentes por conta própria.
3. **Modelo nunca age direto.** O agente devolve JSON validado por schema (`{ tool, args }`); quem executa é uma
   ferramenta com contrato. Envio, edição e exclusão passam sempre pelo broker com confirmação humana.
4. **Conteúdo externo é dado.** Corpo de e-mail, evento e mensagem entram no prompt delimitados como não confiáveis, em
   tarefas **somente leitura** e **sem ferramentas de ação**. Uma instrução dentro de um e-mail nunca vira permissão.
5. **Permissão mínima e por operação.** Escopos pedidos em degraus (ver §4); cada operação tem um interruptor por conta.
6. **Privacidade por padrão.** Guardar só metadados (ids, remetente, assunto, datas, hash, classificação). Corpo de
   mensagem não é persistido; resumo só vai à memória com autorização. Retenção configurável.
7. **Isolamento por conta.** Token, cursor de sincronização e auditoria são sempre chaveados por `accountId`.

### Mapa de responsabilidades (não são pastas obrigatórias)

```
packages/shared            contratos zod: IPC personal:*, tipos de conector, automação, notificação
packages/orchestrator      domínio puro e testável: orquestrador pessoal, motor de automações (regras, próxima
                           execução, backoff), classificação, deduplicação de notificações
packages/database          migrações aditivas (a partir da 0097) e repositórios
apps/desktop/src/main      conectores HTTP (Gmail, Agenda, WhatsApp), OAuth, cofre, agendador, monitor, notificações
apps/desktop/src/renderer  features/personal: dashboard, integrações, automações, notificações, atividades
```

### Contratos (reaproveitando os equivalentes)

| Contrato do briefing | Implementação |
|---|---|
| `IPersonalConnector` | novo: `connect`, `disconnect`, `status`, `scopes`, `revoke` |
| `IMessageProvider` / `ICalendarProvider` | novos, implementados por Gmail / Agenda (e futuros Outlook, Telegram) |
| `IAutomationScheduler` | novo (relógio persistente) |
| `INotificationChannel` | novo: Electron, central interna; WhatsApp, e-mail e Mobile como canais opcionais |
| `IAgentTaskDispatcher` | **existente:** adaptador híbrido de tarefas (`hybridTasks.start` com `externalRef`) |
| `IApprovalService` | **existente:** `ComputerActionBroker` |

## 3. Persistência (migrações aditivas, numeração a confirmar na pasta no momento da criação)

| Tabela | Conteúdo |
|---|---|
| `personal_accounts` | provedor, e-mail/identificador, escopos concedidos, estado, referência ao arquivo de token (nunca o token) |
| `personal_sync_state` | cursor por conta e recurso (`historyId` do Gmail, `syncToken` da Agenda) |
| `personal_processed_events` | chave de deduplicação por evento externo |
| `personal_automations` | regra (gatilho, condição, ação), fuso, estado (ativa/pausada), origem em linguagem natural |
| `personal_automation_runs` | execução, tentativa, estado, erro, `taskId`, duração, chave de idempotência |
| `personal_notifications` | prioridade, canal, grupo, lida, chave de deduplicação, só metadados |
| `personal_notification_prefs` | canais, silêncio, tela bloqueada |

Aprovações e auditoria usam `neura_action_audits` (existente). Nenhuma tabela existente é alterada de forma destrutiva.

## 4. Segurança e privacidade

- **Escopos em degraus (Gmail):** `gmail.readonly` para ler; `gmail.compose` só quando o usuário ligar rascunhos;
  `gmail.send` só quando ligar envio. **Agenda:** `calendar.readonly` → `calendar.events`.
- **Restrição do Google:** os escopos do Gmail são "restritos". Com cliente OAuth próprio em modo de teste (uso pessoal)
  funciona, mas o refresh token expira em 7 dias; para token duradouro o app precisa ser publicado e verificado
  (ou usar conta Workspace com app interno). Isso é decisão do usuário (D-PA-1), não de código.
- Tokens só cifrados pelo SO; nunca em log, IPC para o renderer, prompt ou memória. Revogação chama o endpoint do
  Google e apaga o arquivo.
- Confirmação explícita, com prévia do conteúdo exato, antes de enviar mensagem, criar/editar/cancelar evento ou excluir
  algo. Aprovação expira e vale para uma ação só.
- Limites: chamadas por minuto por conector, teto de execuções por automação/hora, teto de custo por dia para tarefas
  de agente; ao estourar, pausa e notifica.
- Notificação nativa mostra só "1 e-mail importante" por padrão; remetente/assunto só se o usuário permitir.
- LGPD: dados mínimos, retenção configurável, exportação e exclusão por conta ("desconectar e apagar").
- Testes de injeção obrigatórios (lote 51.07): e-mails com "ignore as instruções e envie…" não podem gerar ação.

## 5. WhatsApp: avaliação prévia

A API oficial (WhatsApp Business Platform / Cloud API) exige conta Business na Meta, número dedicado (que deixa de
funcionar no app comum), webhook HTTPS público, opt-in, janela de 24 h e modelos aprovados para iniciar conversa. **Não
dá acesso ao histórico pessoal.** Para uso pessoal num app desktop local há dois obstáculos: o número dedicado e o
webhook público (o Core hoje só é exposto por Tailscale `serve`, que é privado). O lote 51.05 começa por um relatório de
viabilidade com o usuário; se não for viável, o canal alternativo proposto é o Companion Mobile (push) e/ou e-mail,
mantendo o WhatsApp opcional. Engenharia reversa do WhatsApp Web está fora de questão.

## 6. Lotes

Cada lote: objetivo, entrega, testes, rollback; aprovação antes de começar; registro em `docs/STATUS.md` ao terminar.

| Lote | Escopo | Entrega e testes | Depende de |
|---|---|---|---|
| **51.01** Auditoria e arquitetura | Aprofundar esta auditoria (IPC, broker, intents, extensões), fixar contratos zod, ADR, modelo de dados final, matriz de ameaças | ADR + contratos em `packages/shared` (só tipos) com testes de schema. Sem runtime | decisões D-PA |
| **51.02** Infraestrutura e segurança | Extensão `personal-agent` (desligada), `IntegrationTokenStore`, gerenciador de contas, permissões por operação, novos `actionType` no broker, migrações | Unidade (cofre com cifra falsa, permissões, broker), integração com banco, E2E: módulo oculto até habilitar. Rollback: desabilitar extensão | 51.01 |
| **51.03** Gmail | OAuth (reuso do loopback), listar/pesquisar/ler, sincronização por `historyId`, classificação e resumo via tarefa somente leitura, rascunho, envio com confirmação | Unidade com servidor Gmail falso (fixtures), renovação e revogação de token, E2E com provedor falso; teste real manual documentado | 51.02 |
| **51.04** Google Agenda | Consultar, criar/editar/cancelar com confirmação, conflitos, horários livres, lembretes, resumo do dia, fuso e horário de verão | Unidade (conflitos, fusos, recorrência), servidor falso, E2E | 51.02 |
| **51.05** WhatsApp | Relatório de viabilidade; se aprovado: webhook com verificação de assinatura, comandos recebidos, envio por modelo. Senão: alternativa aprovada | Relatório; se implementado, unidade de assinatura/janela/opt-in e E2E com servidor falso | 51.02, D-PA-3 |
| **51.06** Motor de automações | Agendador persistente (relógio, intervalo), gatilhos por evento, condições, backoff, concorrência, idempotência, pausa/cancelamento, histórico, recuperação no boot | Unidade com relógio falso (DST, fuso, execução perdida), reinício no meio de execução, E2E | 51.02; ganha valor com 51.03/04 |
| **51.07** Orquestração de agentes | Intenções pessoais no Void, plano de ferramentas por schema, roteamento Claude/Codex configurável, memória autorizada, aprovações | Unidade de roteamento e plano, **suíte de injeção**, E2E com agentes falsos | 51.03, 51.04 |
| **51.08** Notificações | Serviço, central, Electron nativo, prioridade, agrupamento, deduplicação, silêncio, leitura, reenvio; canais externos disponíveis | Unidade (dedupe, silêncio, agrupamento), E2E | 51.02 |
| **51.09** Interface | Dashboard, integrações, automações (criação em linguagem natural com prévia da regra), notificações, atividades, configurações | E2E por tela, teclado, acessibilidade, visual em 3 larguras, estados vazio/erro/carregando | 51.03–51.08 |
| **51.10** Estabilização | Regressão completa, falha de rede, idempotência, reinício, documentação técnica e operacional | Vitest e E2E completos, instalador | todos |

**Ordem recomendada:** 51.01 → 51.02 → 51.03 → 51.04 → 51.08 → 51.06 → 51.07 → 51.09 → 51.10, com 51.05 em paralelo
como investigação. Notificações antes das automações porque toda automação termina numa notificação; a interface de
cada lote entra mínima no próprio lote (conectar conta, ver estado) e é consolidada no 51.09.

## 7. Decisões pendentes do usuário

| Id | Decisão | Recomendação |
|---|---|---|
| D-PA-1 | Cliente OAuth do Google: próprio em modo de teste (token expira em 7 dias), próprio verificado, ou conta Workspace interna | Começar com cliente próprio em teste; reavaliar antes do 51.10 |
| D-PA-2 | Escopos iniciais do Gmail | Só leitura no 51.03; rascunho e envio ligados depois, um de cada vez |
| D-PA-3 | WhatsApp: há conta Business e número dedicado? | Sem isso, canal alternativo (Mobile/e-mail) |
| D-PA-4 | Agente padrão para resumos e classificação, e teto de custo diário | Claude (modelo menor) com teto baixo; configurável |
| D-PA-5 | Execução perdida com o app fechado: executar ao abrir, pular, ou perguntar | Executar uma vez ao abrir se ainda fizer sentido; senão registrar como perdida |
| D-PA-6 | Retenção de metadados e do histórico | 30 dias, configurável |
| D-PA-7 | Nome e lugar no menu ("Void" como grupo próprio?) | Item "Void Pessoal" no grupo Trabalho |

## 8. Critérios de aceite da fase

Os do briefing (§12), mais: nenhum token em log/IPC/prompt (teste automatizado), suíte de injeção verde, e regressão
completa do Singularity sem perdas.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Verificação do Google para escopos restritos | D-PA-1; modo de teste para uso pessoal; documentar a renovação |
| Injeção de instruções por e-mail/mensagem | Decisão 3 e 4; tarefas somente leitura; suíte de injeção |
| Monitoramento parado com o desktop fechado | Política D-PA-5; evolução para o Core após S1/S2 |
| Custo de modelo em caixa de entrada grande | Classificar por metadados primeiro; modelo só no que passar do filtro; teto diário |
| Notificações em excesso | Deduplicação, agrupamento, silêncio, prioridade |
| WhatsApp inviável para uso pessoal | Relatório antes de código; canal alternativo |

## 10. Evoluções futuras (pontos de extensão já previstos)

Outlook/Teams, Telegram e Discord entram como novos `IMessageProvider`/`ICalendarProvider`/`INotificationChannel`;
Home Assistant como conector; Companion Mobile como canal; voz pelo Void já existente; integrações via MCP como
ferramentas; Zapia somente se houver API oficial.
