# SINGULARITY --- Plano mestre de evolução do NeuralBridge

> **Status:** PROPOSTA PARA AUDITORIA E PLANEJAMENTO --- NÃO EXECUTAR
> IMPLEMENTAÇÃO\
> **Origem:** NeuralBridge (Windows / Electron)\
> **Destino:** Singularity --- AI Orchestrator\
> **Referências visuais:** imagens de inspiração JARVIS/buraco negro e
> mockups fornecidos na conversa (fornecer os arquivos ao Claude no
> repositório).\
> **Referência técnica externa:**
> https://github.com/paperclipai/paperclip\
> **Regra central:** preservar integralmente dados, projetos, memórias,
> agentes, integrações, credenciais, histórico e fluxos existentes.

## 0. Instruções obrigatórias para o Claude Code

1.  Leia `docs/PLAN.md`, a documentação arquitetural e o código do
    repositório **antes** de propor mudanças.
2.  Descubra a **próxima numeração disponível**; não presuma que
    qualquer fase mencionada em conversas anteriores continua livre.
3.  Faça uma auditoria factual: marque cada recurso como existente,
    parcial, ausente ou não verificado.
4.  **Nesta execução, apenas planeje.** Não renomeie arquivos, não
    instale dependências, não clone ou execute código externo, não
    altere schemas, não refatore e não modifique funcionalidades.
5.  Entregue um plano incremental no padrão do projeto, em
    `docs/PLAN.md`. Caso o arquivo já tenha mudanças não relacionadas,
    preserve-as; adicione o planejamento sem reescrever o histórico.
6.  Cada lote deve ter: objetivo, escopo, dependências, arquivos
    prováveis, riscos, critérios de aceite, testes, migração e rollback.
7.  Ao terminar, apresente as decisões pendentes e **aguarde aprovação**
    antes de iniciar qualquer implementação.
8.  O presente documento é o **briefing de referência**; a auditoria do
    código prevalece sobre hipóteses aqui registradas.

## 1. Visão do produto

Transformar o NeuralBridge em **Singularity --- AI Orchestrator**, uma
aplicação desktop Windows que reúne agentes Claude/Codex e outros
provedores, MCP, RAG, memória persistente, projetos, tarefas,
orquestração, observabilidade e uma experiência visual cinematográfica.

Não recriar o produto do zero: evoluir o que já funciona, com contratos
estáveis e migrações reversíveis.

### 1.1 Identidade

-   Nome exibido: **Singularity**.
-   Subtítulo: **AI Orchestrator**.
-   Logo/ícone: horizonte de eventos estilizado, com anel de acreção
    dourado.
-   Tema: verde-petróleo quase preto, painéis de vidro preto, brilho
    dourado suave e texto claro quente.
-   Tipografia: fina, moderna, legível, com espaçamento controlado em
    títulos.
-   Paleta inicial para prototipação (ajustar por contraste): `#061C20`
    fundo, `#102A2D` superfícies, `#D9B875` destaque, `#D6D6CB` texto.
-   Respeitar a imagem JARVIS enviada: evitar roxo/azul saturado,
    excesso de neon, widgets chamativos ou galáxia multicolorida.

## 2. Direção de UX e design system

Criar tokens de cores, tipografia, espaçamento, elevação, bordas,
transparência, estados, animação e acessibilidade. Padronizar navegação,
botões, cards, gráficos, overlays, tooltips, estados vazios e de erro.

Redesenhar, conforme a auditoria confirmar sua existência: - Hub e
dashboard - Orquestrador, agentes, sessões e TaskEngine - MCP e
integrações - RAG e conhecimento - Memórias / Galáxia - Projetos,
tarefas e execuções - Monitoramento e diagnósticos - Configurações,
permissões e credenciais - Companion HUD e outras superfícies auxiliares

Preservar atalhos, fluxos, preferências e navegação; prever estados
offline, loading, falha e dados insuficientes.

## 3. Galáxia de Memórias --- substituição do cérebro 3D

### 3.1 Semântica visual obrigatória

-   O **buraco negro é relativamente pequeno** e fica no centro; seu
    disco de acreção é cinematográfico, com luz dourada e espirais
    delicadas, inspirado na imagem original.
-   A **galáxia é o conjunto das memórias**; **cada estrela representa
    uma memória real**, não um agente ou uma categoria.
-   Estrelas próximas podem representar similaridade semântica, projeto,
    temporalidade ou relações explícitas; definir e documentar o
    critério.
-   Categorias e projetos aparecem como **agrupamentos, filtros e
    rótulos**, não substituem estrelas individuais.
-   Linhas de conexão são opcionais e devem refletir relações
    verificáveis, não aleatórias.
-   Selecionar uma estrela abre detalhes, fonte, projeto, tags, data e
    ações permitidas.

### 3.2 Funcionalidades

Pesquisa textual e semântica; zoom, rotação, pan, foco em estrela,
filtros por projeto/contexto/período, seleção múltipla quando útil,
mini-mapa opcional e navegação por teclado. Integrar com o repositório
real de memória, indexação RAG e mecanismos de recuperação existentes.

### 3.3 Escalabilidade e privacidade

-   Não instanciar um objeto 3D por memória quando o volume tornar isso
    inviável: avaliar instancing, LOD, agregação por clusters,
    carregamento incremental e Web Workers quando compatíveis.
-   Os números e pontos exibidos devem derivar de dados reais; indicar
    explicitamente amostragem/agregação.
-   Dados sensíveis não devem ser expostos em labels, logs, tooltips ou
    capturas sem controles adequados.
-   Prever fallback 2D/lista e redução de movimento.
-   Medir FPS, memória de GPU, latência de seleção e tempo até primeira
    interação em diferentes volumes.

## 4. Monitoramento de desempenho e observabilidade

Implementar, após auditoria, um painel compacto na lateral e uma visão
expandida, ambos com dados **reais** e séries temporais:

  -----------------------------------------------------------------------
  Área                    Indicadores desejados   Observações
  ----------------------- ----------------------- -----------------------
  CPU                     Uso %, por processo,    Sensores dependem de
                          histórico, temperatura  hardware/permissões
                          quando disponível       

  RAM                     Usada, livre, total, %  Distinguir sistema e
                          e histórico             Singularity

  GPU                     Utilização, temperatura Detectar adaptadores e
                          e processos quando      limitações
                          suportados              

  VRAM                    Usada, total, %,        Sem assumir métricas em
                          histórico               todas as GPUs

  Disco                   Espaço, I/O,            Separar disco do índice
                          throughput, latência    RAG
                          quando disponível       

  Rede                    Download/upload, taxa e Não confundir tráfego
                          histórico               total com tráfego do
                                                  app

  Agentes                 Sessões, duração,       Vincular à execução
                          estado, falhas, consumo real

  MCP                     Conectividade,          Sem expor segredos
                          chamadas, latência,     
                          erros                   

  RAG                     Indexação, consultas,   Coletar sem bloquear UI
                          duração, erros, tamanho 
                          do índice               

  TaskEngine              Fila, tarefas ativas,   Preservar contratos
                          sucesso/falha, duração  
  -----------------------------------------------------------------------

Requisitos: frequência configurável, buffers limitados, tratamento de
sensores indisponíveis, baixo overhead, coleta fora do renderer quando
adequado, suspensão inteligente, ausência de números fictícios e
histórico com política de retenção.

## 5. Renomeação segura NeuralBridge → Singularity

Inventariar referências em: branding, menus, janelas, notificações,
tray, atalhos, executáveis, package metadata, app ID, instalador,
updater, caminhos de dados, banco, migrações, logs, IPC, APIs, variáveis
de ambiente, docs, scripts, testes, integrações e identificadores
persistidos.

Estratégia recomendada: 1. Alterar **primeiro** a marca visível e os
recursos gráficos. 2. Mapear dependências de identificadores internos e
caminhos existentes. 3. Projetar migração versionada, idempotente e
reversível para o que realmente precisar mudar. 4. Preservar dados e
segredos, testar upgrade a partir de instalações antigas e recuperação
após falha. 5. Manter compatibilidade ou aliases quando necessário; não
renomear indiscriminadamente namespaces e contratos.

## 6. NOVA FASE --- Avaliação e possível integração/fusão com Paperclip

**Repositório:** https://github.com/paperclipai/paperclip\
**Licença declarada no repositório:** MIT --- verificar `LICENSE`,
dependências e obrigações antes de redistribuir.\
**Premissa:** Paperclip é um plano de controle de agentes, com servidor
Node.js e UI React, oferecendo gestão de tarefas, hierarquias,
delegação, aprovações, heartbeats, custos/orçamentos, rotinas e
integrações de agentes. A compatibilidade específica com NeuralBridge
**não está comprovada** e exige prova de conceito.

### 6.1 Objetivo

Determinar se o Singularity deve: - **A --- Integrar** Paperclip como
serviço/control plane isolado, mantendo o Electron/TaskEngine e expondo
recursos via adaptador; - **B --- Incorporar seletivamente** componentes
ou padrões do Paperclip, respeitando licença e manutenção; - **C ---
Fundir arquiteturas** e migrar parte da orquestração para uma base
comum, apenas se custo, compatibilidade e risco justificarem; - **D ---
Não integrar**, se o ganho líquido não compensar a complexidade.

**Não escolher C automaticamente.** Priorizar interoperabilidade, menor
acoplamento e capacidade de rollback.

### 6.2 Auditoria comparativa obrigatória

Criar matriz **NeuralBridge atual × Paperclip × proposta Singularity**
para: - Gestão de agentes e provedores (Claude Code, Codex, outros) -
TaskEngine, execução, filas, locks, concorrência, retries e
recuperação - Sessões persistidas, heartbeats, tarefas, comentários e
histórico - Delegação, organogramas, papéis, permissões e aprovações -
Projetos, metas, prioridades e dependências - Orçamentos, tokens, custos
e limites por agente/projeto - Skills, ferramentas MCP, gateways e
integrações - RAG, memória, recuperação de contexto e Galáxia -
Credenciais, isolamento, segurança e auditoria - Rotinas agendadas,
eventos, notificações e automações - UI desktop, processo principal
Electron, servidor local e empacotamento Windows - Armazenamento,
migrations, backups e upgrade - Diagnóstico, métricas e observabilidade

Identificar duplicações, lacunas, conflitos de modelo de dados e
responsabilidades. Não eliminar capacidades exclusivas do NeuralBridge,
especialmente RAG, memória, Companion HUD, otimização de tokens e
integrações existentes.

### 6.3 Estudo técnico do Paperclip

Antes de propor integração, examinar a versão/commit escolhido e os
documentos `README.md`, `LICENSE`, `SECURITY.md`, `DESIGN.md`,
`ROADMAP.md`, contratos de API, esquema de banco, arquitetura do
servidor, adaptadores e plugins.

Validar: - APIs e eventos disponíveis e sua estabilidade; - suporte real
a Claude Code e Codex na versão escolhida; - autenticação, autorização,
permissões e armazenamento de segredos; - requisitos de Node, banco,
runtime e subprocessos no Windows; - possibilidade de execução local sem
serviço externo obrigatório; - licença das dependências e atribuições
exigidas; - riscos de atualizar/forkar; - consumo de CPU/RAM e impacto
no instalador; - uso offline e reinício após crash; - se o Paperclip
pode operar sem duplicar o TaskEngine ou provocar execução concorrente
da mesma tarefa.

### 6.4 Arquitetura-alvo candidata

    Singularity Desktop (Electron + UI)
      ├─ Design System / Dashboard / Galáxia / Monitoramento
      ├─ Orquestração (facade estável)
      │   ├─ TaskEngine existente
      │   └─ Adaptador Paperclip [opcional, isolado]
      ├─ Agentes / Claude / Codex / Skills
      ├─ MCP / RAG / Memória / Token Optimizer
      └─ Observabilidade / Auditoria / Configuração

A facade deve evitar que a UI dependa diretamente de contratos internos
de um produto externo. Definir uma única autoridade por tarefa,
ownership de estados, IDs correlacionados, reconciliação, idempotência e
política de cancelamento. Não compartilhar diretamente bancos sem
contrato e migração formal.

### 6.5 Prova de conceito --- somente após aprovação

Em ambiente isolado e com dados de teste: 1. Subir uma versão **fixada**
do Paperclip. 2. Conectar um agente Claude Code e um Codex sem expor
credenciais. 3. Criar tarefa, delegar, acompanhar execução, cancelar e
recuperar após reinício. 4. Exercitar aprovações, limites de custo,
locks e erros. 5. Testar adaptador com TaskEngine sem dupla execução. 6.
Verificar eventos e atualização do dashboard. 7. Medir latência,
memória, CPU, estabilidade e empacotamento Windows. 8. Validar rollback
desligando o adaptador sem perder tarefas ou dados.

### 6.6 Critérios de decisão

Pontuar A/B/C/D por segurança, preservação de funcionalidades,
complexidade, desempenho, manutenção, compatibilidade Windows,
maturidade de API, facilidade de atualização, custo de migração,
experiência do usuário e rollback. Documentar evidências, trade-offs e
recomendação arquitetural (ADR). Se houver riscos não resolvidos,
**bloquear a fusão**.

### 6.7 Critérios de aceite da fase Paperclip

-   Matriz comparativa preenchida com evidências de código e
    documentação.
-   Versão/commit e licenças verificados.
-   Arquitetura candidata e fronteiras de responsabilidade documentadas.
-   Estratégia para dados, IDs, credenciais, permissões e sessões
    definida.
-   Plano de PoC com métricas objetivas, testes e rollback.
-   Recomendação A/B/C/D justificada.
-   Nenhuma dependência Paperclip instalada nem código fundido durante o
    planejamento.

## 7. Roadmap proposto (renumerar segundo `docs/PLAN.md`)

  -----------------------------------------------------------------------
  Lote                    Entrega                 Dependência
  ----------------------- ----------------------- -----------------------
  01                      Auditoria do            Nenhuma
                          NeuralBridge e          
                          inventário de           
                          contratos/dados         

  02                      Design system           01
                          Singularity e           
                          identidade              

  03                      Infraestrutura de tema  02
                          e componentes           
                          compartilhados          

  04                      Rebranding visível e    01--03
                          plano de migração       
                          técnica                 

  05                      Redesign do dashboard,  03
                          navegação e telas       

  06                      Motor visual da Galáxia 01, 03
                          de Memórias             

  07                      Integração da galáxia   06
                          com memória real e RAG  

  08                      Monitoramento de        01, 03
                          hardware e              
                          observabilidade         

  09                      **Paperclip: auditoria, 01
                          decisão A/B/C/D e PoC   
                          planejada**             

  10                      **Paperclip:            09 e aprovação
                          implementação opcional  explícita
                          aprovada, em lotes      
                          próprios**              

  11                      Performance, animações, 05--10, conforme
                          acessibilidade e        aplicável
                          fallback                

  12                      Migração, testes E2E,   Todos os lotes
                          segurança,              implementados
                          empacotamento e         
                          rollback                
  -----------------------------------------------------------------------

O lote 10 **não está automaticamente autorizado**: seu escopo e execução
dependem da decisão da fase 09. O plano deve permitir que o redesign e a
galáxia avancem sem depender do Paperclip.

## 8. Testes e salvaguardas transversais

-   Unitários, integração IPC, testes de contrato, E2E e regressão
    visual.
-   Instalação limpa, upgrade, backup/restore e rollback no Windows.
-   Migração com base real anonimizada ou fixture representativa.
-   Falha de energia, crash, rede indisponível, token expirado, limite
    de custo e cancelamento.
-   Comparativos de performance antes/depois, uso de memória e GPU.
-   Segurança: privilégios mínimos, segredos protegidos, sanitização de
    logs, isolamento de agentes e revisão de dependências.
-   Acessibilidade, teclado, zoom, redução de movimento e fallback sem
    GPU 3D.
-   Critério de não regressão para MCP, RAG, memória, agentes, projetos,
    TaskEngine e Companion HUD.

## 9. Entregáveis de planejamento

O Claude deve adicionar ao `docs/PLAN.md`: 1. Fase numerada
corretamente, com status **PLANEJADA --- NÃO INICIADA**. 2. Auditoria do
estado atual e dependências. 3. Lotes, ordem, estimativas **somente após
auditoria** e critérios de aceite. 4. ADR preliminar das opções de
integração Paperclip. 5. Plano de PoC isolada, testes e rollback. 6.
Matriz de riscos e decisões pendentes. 7. Checklist de migração
NeuralBridge → Singularity. 8. Lista de referências visuais e de código.
9. Definição de pronto e ponto de aprovação humana.

**Resposta final esperada do Claude:** informar o número da fase, resumo
da auditoria, lotes criados, opções Paperclip avaliadas, bloqueios e
arquivos alterados. **Não iniciar a implementação.**

## 10. Fontes de referência

-   Paperclip: https://github.com/paperclipai/paperclip
-   Documentação Paperclip: https://docs.paperclip.ing/
-   Mockup oficial Singularity: `docs/assets/singularity/reference-memory-galaxy.webp`.
-   Imagens do JARVIS e outros mockups: anexar ao workspace local
    para consulta visual; este Markdown não incorpora os arquivos
    binários.

---

## 11. NOVA FRENTE ARQUITETURAL — Singularity Core Node.js e Companion Mobile

**Status: PROPOSTA PARA AUDITORIA — NÃO IMPLEMENTAR NESTA ETAPA.**

### 11.1 Objetivo e princípios

Separar gradualmente a lógica de negócio, orquestração e serviços atualmente acoplados ao Electron em um **backend Node.js/TypeScript independente**, reutilizável pelo **Singularity Desktop (Electron)** e pelo futuro **Singularity Companion Mobile (React Native/Expo, Android/iOS)**. Não presumir que todos os componentes atuais estejam no processo principal Electron: identificar o que já é independente antes de mover qualquer código.

- O Electron deve atuar como cliente desktop e hospedeiro de capacidades locais estritamente necessárias, não como única fonte de verdade dos dados.
- O Core deve ser executável e testável **sem abrir a interface Electron**.
- O aplicativo móvel deve consumir contratos estáveis e autenticados, nunca IPC Electron diretamente.
- Preservar RAG, MCP, memórias, agentes, TaskEngine, Skills, Token Optimizer, sessões, credenciais, projetos, histórico e integrações atuais.
- A arquitetura deve permitir um único backend para múltiplos clientes, sem duplicar execução de tarefas.

### 11.2 Topologia-alvo candidata (validar na auditoria)

```text
                         ┌─────────────────────────────┐
                         │ Singularity Core             │
                         │ Node.js + TypeScript         │
                         │ API REST + WebSocket/Eventos │
                         │ Auth / Devices / Sessions    │
                         │ TaskEngine / Agents / MCP    │
                         │ RAG / Memory / Projects      │
                         │ Observability / Notifications│
                         └──────────────┬──────────────┘
                                        │
                      ┌─────────────────┴─────────────────┐
                      │                                   │
          ┌───────────▼───────────┐           ┌───────────▼────────────┐
          │ Singularity Desktop    │           │ Companion Mobile        │
          │ Electron + React       │           │ React Native + Expo     │
          │ Windows + recursos OS  │           │ Android / iOS           │
          └───────────────────────┘           └────────────────────────┘
```

**Nota:** o servidor pode rodar no PC do usuário, num mini PC dedicado ou em infraestrutura hospedada, conforme decisão posterior. Para uso remoto, exigir canal seguro (por exemplo, VPN privada ou HTTPS com autenticação robusta); **não abrir uma API local diretamente à internet**.

### 11.3 Auditoria de separação Electron ↔ Core

1. Inventariar módulos do Electron Main, Preload, Renderer, IPC, subprocessos, persistência e integração com SO.
2. Classificar cada função como **Core independente**, **adaptador desktop**, **serviço local dependente do Windows**, **UI**, ou **compartilhável**.
3. Mapear APIs internas, eventos, DTOs, contratos, schemas, dependências circulares e pontos de acoplamento.
4. Avaliar execução de Claude Code, Codex e MCP em subprocessos: permissões, working directory, sessão, isolamento, disponibilidade do executável e ownership do processo.
5. Identificar quais recursos não podem funcionar quando o computador hospedeiro estiver desligado, sem rede ou sem sessão válida.
6. Produzir diagrama atual vs. proposto e ADR com alternativas (monólito modular Node.js, serviço isolado, gateway/sidecar e outras que a auditoria justificar).

### 11.4 API, eventos e contratos compartilhados

- Definir API versionada (ex.: `/api/v1`) para sessões, agentes, projetos, tarefas, execuções, memória, RAG, MCP, notificações, dispositivos e monitoramento autorizado.
- Documentar contratos com OpenAPI e/ou schema tipado compartilhado, conforme stack real.
- Definir WebSocket ou SSE para streaming de eventos, progresso, mensagens do Companion, status de agentes e execução de tarefas; justificar a escolha.
- Implementar posteriormente paginação, filtros, limites, backpressure, idempotency keys, correlação de eventos, reconexão e recuperação após desconexão.
- Proteger operações destrutivas e de execução remota com autorização explícita e trilha de auditoria.
- Garantir compatibilidade progressiva: IPC atual pode chamar um adaptador para a API durante a transição.

### 11.5 Companion Mobile — escopo de produto futuro

Planejar app React Native/Expo com experiência consistente com a identidade Singularity (verde-petróleo, dourado, glassmorphism), adaptada a telas pequenas:

- Conversa com o Companion via texto e, em fase opcional, voz (captura, transcrição e síntese mediante permissões e escolha tecnológica).
- Listar agentes Claude/Codex, ver sessões e tarefas, progresso e logs autorizados.
- Iniciar, pausar, cancelar e aprovar tarefas conforme papel e política de segurança.
- Receber eventos e notificações push (conclusão, erro, solicitação de aprovação, limite de custo).
- Consultar memórias e pesquisar via RAG; uma visualização leve da Galáxia é opcional e não deve bloquear o MVP.
- Consultar projetos, filas, resultados e anexos autorizados.
- Exibir status de conexão e do servidor; modo offline limitado a cache seguro, sem prometer execução quando o host estiver desligado.
- Permitir emparelhamento seguro de dispositivos, revogação de sessões e logout remoto.

### 11.6 Segurança e privacidade obrigatórias

- Avaliar OAuth 2.0/OIDC com Authorization Code + PKCE para mobile ou outra arquitetura comprovadamente adequada; **nunca embutir client secret no aplicativo móvel**.
- Usar TLS em acesso remoto, tokens de curta duração, renovação/revogação, armazenamento seguro de credenciais no sistema operacional e escopos por ação.
- Prever emparelhamento com aprovação no desktop, inventário de dispositivos, rate limiting, proteção contra brute force, auditoria e bloqueio de operações perigosas.
- Nunca enviar diretamente ao celular segredos de provedores, chaves MCP, arquivos privados completos ou comandos arbitrários sem autorização.
- Sanitizar logs e dados de notificação; push deve conter metadados mínimos, não conteúdo sensível.
- Avaliar autenticação e autorização por usuário/projeto/agente; isolamento de sessões e proteção contra execução duplicada.

### 11.7 Persistência, execução e disponibilidade

- Definir fonte de verdade de tarefas, sessões, projetos e memórias, política de concorrência e esquema de IDs estáveis.
- Planejar migração versionada e reversível do armazenamento atual, com backup, verificação de integridade e rollback.
- Definir supervisão do Core, reinício após crash, health checks, graceful shutdown e recuperação de jobs.
- Considerar serviço Windows ou processo supervisionado para manter o Core ativo **sem a janela Electron**, desde que explicitamente configurado e autorizado.
- Documentar que o celular depende do Core acessível; se o PC hospedeiro estiver desligado, execução remota não estará disponível sem um host alternativo.
- Prever estratégia para arquivos grandes, upload/download autenticado, retenção, sincronização de estado e consistência entre clientes.

### 11.8 Relação com Paperclip — decisão arquitetural conjunta

**A fase de extração do Core deve preceder qualquer fusão profunda com Paperclip**, salvo justificativa explícita da auditoria. Avaliar se Paperclip:

- opera como serviço separado conectado ao Core por adaptador;
- fornece módulos selecionados sem substituir TaskEngine e memória;
- pode assumir funções de control plane com fronteiras claras;
- ou não deve ser integrado.

Evitar dois sistemas independentes reivindicando ownership da mesma tarefa, credencial ou sessão. Criar ADR conjunto **Core + Paperclip** antes da PoC de integração; planejar contratos, observabilidade, autenticação, estado e rollback.

### 11.9 Lotes propostos para a nova frente (renumerar conforme PLAN.md)

| Lote | Entrega | Critério de aceite principal |
|---|---|---|
| CORE-01 | Auditoria e ADR de separação Electron/Core | Mapa de dependências e responsabilidades validado |
| CORE-02 | Contratos de API, eventos e segurança | Schemas versionados, autorização e testes de contrato planejados |
| CORE-03 | Estrutura do serviço Node.js independente | Boot, health check e configuração sem Electron (implementação futura) |
| CORE-04 | Extração incremental de domínio e persistência | Mesmas operações e dados com testes de regressão |
| CORE-05 | TaskEngine, agentes, MCP e RAG no Core | Execução única, streaming, cancelamento e recuperação |
| CORE-06 | Adaptador Desktop para Core | Interface Electron preservada, sem regressões |
| CORE-07 | Autenticação, dispositivos e acesso remoto seguro | Pairing, revogação, TLS e auditoria testados |
| MOB-01 | MVP Companion Mobile React Native/Expo | Login, chat, sessões, tarefas e progresso em tempo real |
| MOB-02 | Push, aprovações, voz opcional e busca RAG | Permissões, privacidade e fallback validados |
| MOB-03 | Testes Android/iOS, resiliência e distribuição | Testes E2E, reconexão, offline e release documentados |
| CORE-08 | Observabilidade, empacotamento e migração | Upgrade/rollback Windows e métricas de desempenho |

**Ordem:** planejar CORE-01 e CORE-02 antes de implementar; a extração pode ocorrer em paralelo ao redesign visual quando contratos forem estáveis. O MVP mobile depende de Core/API/autenticação operacionais. A decisão Paperclip deve considerar o novo limite entre clientes e servidor.

### 11.10 Testes e critérios de aceite transversais

- Testes unitários e de contrato para API/IPC, integração com banco e regressão do Desktop.
- E2E do fluxo mobile: emparelhar → autenticar → conversar → criar tarefa → acompanhar → aprovar/cancelar → receber resultado.
- Cenários de reconexão, token expirado, host desligado, reinício de serviço, execução longa e duas interfaces abertas.
- Testes de segurança: acesso não autorizado, IDOR, vazamento de segredos, replay, revogação e execução remota indevida.
- Medir latência de eventos, consumo de CPU/RAM, estabilidade do serviço e impacto sobre a execução dos agentes.
- Confirmar migração sem perda de memórias, projetos, tarefas, preferências, credenciais ou histórico.
- Demonstrar que o Desktop continua funcional em cada etapa e que o rollback é viável.

### 11.11 Entregáveis de planejamento a acrescentar ao `docs/PLAN.md`

1. Nova fase numerada **PLANEJADA — NÃO INICIADA** para **Singularity Core + Companion Mobile**, ou lotes separados se a estrutura atual exigir.
2. Diagrama de arquitetura atual e alvo, inventário de acoplamentos e ADR.
3. Matriz de responsabilidades Desktop / Core / Mobile / Paperclip.
4. Contratos de API e eventos propostos, autenticação, política de acesso remoto e persistência.
5. Lotes CORE/MOB, dependências, critérios de aceite, testes e rollback.
6. Riscos e decisões pendentes (host local vs dedicado vs nuvem; VPN vs endpoint HTTPS; voz; push; persistência).
7. **Somente planejamento nesta execução; nenhuma migração, instalação, refatoração ou criação de app móvel sem aprovação.**

### 11.12 Ajuste do roadmap mestre

A tabela do item 7 é uma visão inicial. **Inserir a nova frente CORE/MOB como trilha arquitetural transversal**, com auditoria e contratos antes da integração Paperclip profunda e antes do MVP mobile. Não renumerar lotes existentes arbitrariamente; o Claude deve conciliar esta frente com o planejamento real do `docs/PLAN.md`, registrar dependências e manter o trabalho de redesign/galáxia independente quando possível.
