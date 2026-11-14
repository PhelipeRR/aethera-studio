# Fase 18 — Redesign da Interface Chat (Codex-like UX)

## Status

CONCLUÍDA em 2026-10-29, incluindo o complemento 18.8, com validação em Claude Code e Codex reais. Resultados e decisões em `docs/PLAN.md`, Fase 18.

## Objetivo

Refatorar a experiência de Chat do NeuralBridge para uma interface moderna de conversação, inspirada na organização visual do Codex Desktop, sem copiar marcas ou logotipos e preservando a identidade visual do NeuralBridge.

## Escopo e dependências

Preservar TaskEngine, histórico e persistência, projetos, roteamento automático, Claude Code, Codex CLI, modo colaborativo, Neural Brain, RAG e eventos de execução. Não criar persistência paralela nem substituir integrações reais por mocks em produção.

## Plano de execução

### 18.1 — Layout e sidebars

- Manter a sidebar principal e torná-la recolhível, com preferência persistida, transição e tooltip no modo de ícones.
- Criar/ajustar a sidebar secundária do histórico, também recolhível e com rolagem independente.
- Preservar navegação em todas as páginas e adaptar o layout ao redimensionamento do Electron.

### 18.2 — Composer e seletores

- Fixar o composer no rodapé da área central usando flex/grid, sem sobrepor mensagens.
- Implementar textarea expansível, Enter para enviar, Shift+Enter para nova linha, envio, carregamento e interrupção quando suportada.
- Integrar seletores reais de projeto, agente e modelo/versão suportado.
- Informar limitações quando a integração não oferecer seleção explícita de modelo.

### 18.3 — Histórico de conversas

- Reutilizar o armazenamento existente para nova conversa, busca, agrupamento por Hoje/Ontem/Últimos 7 dias/Anteriores, reabertura e conversa ativa.
- Adicionar renomeação e exclusão mediante confirmação, sem criar armazenamento paralelo.

### 18.4 — Mensagens e execução

- Exibir mensagens cronológicas do usuário e agentes, atividades do TaskEngine, estados de execução e erros.
- Implementar estado vazio, continuidade e auto-scroll apenas quando o usuário estiver próximo do fim.

### 18.5 — Integrações

- Confirmar que o roteamento automático e os modos Claude Code, Codex CLI e colaborativo permanecem funcionais.
- Preservar Brain, RAG, eventos de execução, referências e persistência.
- Não inventar modelos, versões ou parâmetros de CLI.

### 18.6 — Responsividade e acessibilidade

- Validar sidebars independentes, composer adaptável, foco, teclado, rótulos acessíveis, contraste e ausência de rolagem horizontal.
- Validar diferentes tamanhos de janela Electron.

### 18.7 — Testes e encerramento

- Adicionar/ajustar testes unitários e E2E para composer, histórico, seletores, continuidade, estados e responsividade.
- Executar testes relevantes, lint, typecheck, build e `git diff --check`.
- Registrar resultados reais no `PLAN.md` e somente então alterar o status da fase.

### 18.8 — Painel lateral direito de contexto, skills e execução (complemento, CONCLUÍDO)

Painel informativo à direita do Chat, inspirado no painel de informações do Codex Desktop (sem copiar marca), compondo o layout: sidebar principal | histórico | Chat | painel direito. Cada uma das três barras recolhe de forma independente. Toda informação vem de fontes reais; quando um dado não existe, a métrica mostra "Indisponível" ou fica oculta. Nenhum dado sensível (tokens de autenticação, variáveis de ambiente, conteúdo de `.env`/credenciais) aparece no painel.

**Levantamento do estado atual (2026-10-29), base da implementação:**

| Fonte existente | O que já fornece | Lacuna |
|---|---|---|
| `packages/agents/src/claude-parser.ts` (stream-json) | `session` (id, modelo) no `system/init`; `tool` com nome e resumo de cada `tool_use`; `file_change` confirmado por `tool_result` sem erro; `usage` (entrada, saída, cache) no `result` | Não extrai a lista de servidores MCP, ferramentas e skills do `system/init`, nem a janela de contexto; a invocação da ferramenta `Skill` chega como `tool` genérico. Campos exatos devem ser confirmados numa saída real gravada antes de depender deles. |
| `packages/agents/src/codex-parser.ts` (`exec --json`) | `session` (thread, sem modelo); `tool` para `command_execution`, `mcp_tool_call` (`servidor.ferramenta`) e `web_search`; `file_change`; `usage` por turno | Nenhum evento estruturado de skill nem de janela de contexto conhecido; ler um `SKILL.md` por comando de shell é no máximo evidência de "Carregada", nunca de "Utilizada". |
| `packages/orchestrator/src/engine.ts` | Eventos persistidos por tarefa (`tasks:changed`), incluindo `skills_context` quando o NeuralBridge injeta skills no prompt; cancelamento (`cancel`) seguro já existente | Não há evento próprio de uso de skill; associação skill↔tarefa só existe para as skills injetadas. |
| `packages/workspace/src/skills.ts` (Skills Manager) | `scanSkills` → `SkillListing` (id, nome, descrição, origem `claude/codex/agents/plugin/custom`, caminho do `SKILL.md`, conflito); preferências por agente/tipo de tarefa | Nada a criar; o painel apenas consulta. |
| `packages/workspace/src/mcp-registration.ts` | Estado de registro do servidor `neuralbridge` em cada CLI | Não lista os demais servidores MCP configurados (Context7, Playwright etc.). |
| `packages/workspace/src/git.ts` | `gitInfo` (repositório, branch, arquivos alterados com estado, último commit) e `gitDiff`, ambos seguros contra config maliciosa | Sem linhas adicionadas/removidas (exigirá `git diff --numstat` pelo mesmo executor seguro). |

**Tarefas:**

- [x] 18.8.1 — Layout: painel direito recolhível independente das outras duas barras; largura predefinida com ajuste por arrastar (limites mínimo/máximo); rolagem própria; seções em accordion; estado aberto/recolhido do painel e de cada seção persistido no armazenamento local (mesmo mecanismo de 18.1, com fallback seguro); abaixo de uma largura de janela a definir, vira drawer sobreposto que não reduz o Chat; tooltips, foco visível, `aria-expanded` e operação completa por teclado; o composer e o envio de mensagens nunca são bloqueados. **Feito** — `SessionPanel.tsx`: painel recolhível (`nb.chat.panel.collapsed`), largura 260–480 px por arrastar ou setas no separador (`nb.chat.panel.width`), seções em accordion persistidas (`nb.chat.panel.section.*`), rolagem própria; abaixo de 1440 px vira drawer sobreposto, fechado por padrão e por Escape (E2E `chat-panel.spec.ts`).
- [x] 18.8.2 — Ambiente: nome do ambiente (máquina local), projeto e diretório da conversa ativa, branch de `gitInfo` do **mesmo** projeto (atualizada ao trocar de conversa/projeto e ao fim de cada tarefa, sem polling contínuo), agente selecionado (Claude Code, Codex ou Auto), configurações relevantes já existentes e estado de conexão de cada agente via `agents:status`. Sem Remote Control. **Feito** — ambiente local, projeto, diretório, branch do `gitInfo` do mesmo projeto (recarregado ao fim de cada tarefa pela invalidação existente), agente, modelo, agente preferido do projeto e estado dos CLIs via `agents:status`; sem Remote Control.
- [x] 18.8.3 — Contexto: mostrar tokens de contexto da última chamada e, só quando o CLI informar a janela de contexto de forma confiável, o limite e o percentual com barra. Separar "uso da janela de contexto" de "tokens totais da execução" (já somados no Analytics). Sem dado confiável, "Indisponível". Tarefa técnica: confirmar em saída real gravada de cada CLI quais campos existem (Claude: `result.usage` e, se presente, metadados de modelo com janela; Codex: `turn.completed.usage`), estender os parsers só com campos comprovados e cobrir com fixtures. **Feito** — campos confirmados na fixture real `claude-text.jsonl` (Claude Code 2.1.312): `usage.iterations` (última chamada) e `modelUsage[modelo].contextWindow`; evento `context` só quando existem. Codex 0.162.1 não expõe janela: "Indisponível". "Na janela" separado de "Total gasto".
- [x] 18.8.4 — Conectores: listar os servidores MCP realmente configurados para cada CLI (estender o gerenciamento MCP existente com leitura via `claude mcp list` / `codex mcp list` ou pelo `system/init` do Claude, com o mesmo executor de `mcp-registration.ts` e as mesmas regras de isolamento de configuração), mostrando nome, estado de conexão, disponibilidade e, expandido, detalhes não sensíveis (comando sem argumentos com segredos, escopo, ferramentas usadas na sessão via eventos `mcp_tool_call`/`tool`). Variáveis de ambiente e cabeçalhos nunca são exibidos. **Feito** — `mcp:servers` (cache de 5 min, sob demanda ao abrir a seção) via `claude mcp list` e `codex mcp list --json` com o mesmo executor e override de CLI; só nome, transporte e estado saem do processo principal (comando, argumentos, URL e ambiente descartados no parser e rejeitados pelo esquema). Ferramentas usadas na sessão vêm dos eventos `tool`. Formato do Codex conferido numa execução real (só a estrutura das chaves foi impressa); o do Claude segue o texto documentado e precisa de validação com `NB_REAL_CLI=1`.
- [x] 18.8.5 — Skills (seção obrigatória): integrada ao Skills Manager (`skills:list` para nome, descrição, origem, compatibilidade por agente e caminho do `SKILL.md`; "Abrir detalhes" leva à página Skills; instalar/remover/configurar continua só lá). Estados, do mais fraco ao mais forte, cada um exigindo sua evidência:
  - **Disponível** — instalada e acessível ao agente pela origem/compatibilidade; sem confirmação de uso.
  - **Carregada** — evidência de que o conteúdo chegou ao agente: evento `skills_context` do TaskEngine (injeção pelo NeuralBridge) ou leitura do `SKILL.md` observada em evento de ferramenta. Não implica que as instruções foram aplicadas.
  - **Utilizada** — evento estruturado de invocação (Claude Code: `tool_use` da ferramenta `Skill` com o identificador da skill, a confirmar em saída real); nunca inferida do texto da resposta.
  - **Falha** — invocação identificável cujo resultado veio com erro.
  - **Indisponível** — o CLI não fornece dados para decidir (caso esperado do Codex enquanto não houver evento estruturado).
  Cabeçalho com a contagem de utilizadas; cada item expandido mostra descrição, agente, última utilização, número de ativações na sessão, tarefa/execução associada e acesso aos detalhes. Ativações ao vivo chegam pelos eventos de `tasks:changed` já existentes, com destaque discreto e contador atualizado, preservadas após o fim da execução. **Feito** — ver os estados abaixo; "Indisponível" é o estado das skills do Codex instaladas, cujo uso o CLI não informa.
- [x] 18.8.6 — Histórico de skills: registrar cada evento observável como evento de tarefa do TaskEngine (novo `kind` `skill_activity` com execução, conversa, skill, agente, horário, estado, evidência resumida e redigida, referência à etapa), sem tabela nem serviço paralelo; um IPC de leitura agregado por conversa e por tarefa permite ver a conversa atual e execuções anteriores. Avaliar e justificar no plano se um índice novo em `task_events` é necessário. Eventos são gerados apenas pelos parsers/motor a partir de saída real; não há backfill inventado para execuções antigas. **Feito, com desvio de nome** — o evento é `skill` (`name`, `status` `loaded|used|failed`, `evidence`), gravado pelo TaskEngine como os demais (`storable` + `redactSecrets`), com etapa, tarefa e horário próprios; o histórico da conversa e de execuções anteriores sai do `tasks:thread` existente, então não houve IPC agregado novo nem índice novo (a leitura já é por `task_id`). O `system/init` do Claude vira o evento visível `capabilities` (o `session` continua oculto).
- [x] 18.8.7 — Saídas: arquivos dos eventos `file_change` confirmados da execução atual (não de todo o repositório), agrupados por tipo (Markdown, código, relatório, imagem, vídeo, outros), com "Abrir" e "Mostrar na pasta" via o shell do Electron, restritos a caminhos dentro do projeto da tarefa. Arquivos alterados fora dos eventos não são apresentados como saídas do agente. **Feito** — eventos `file_change` por execução, agrupados por tipo; "Abrir" e "Mostrar na pasta" pelo `tasks:output-file`, que só aceita caminhos dentro do projeto da tarefa e nunca abre tipos que o Windows executaria (`canOpenOutput`).
- [x] 18.8.8 — Alterações: estado real do Git do projeto (`gitInfo`), contagens de arquivos modificados/novos/excluídos e linhas adicionadas/removidas (novo `git diff --numstat` no executor seguro), acesso ao diff existente (`gitDiff`), com duas visões claramente rotuladas: repositório inteiro e arquivos atribuíveis à execução atual (interseção com 18.8.7). Botão para abrir a criação de Pull Request só se houver integração real (nenhuma existe hoje; não planejada aqui) — nunca cria PR. **Feito** — `projects:line-stats` (`git diff --numstat -z HEAD` no executor seguro) + `gitInfo`; visões "Repositório inteiro" e "Arquivos da última execução"; link para o diff do projeto. Sem botão de PR (não há integração).
- [x] 18.8.9 — Tarefas em segundo plano: tarefas reais do TaskEngine (em execução, concluídas, com falha), agente, descrição curta, tempo decorrido calculado dos timestamps, estado, link para detalhes/logs existentes e "Cancelar" usando o `cancel` do motor apenas para tarefas ativas. Sem barras de progresso inventadas. **Feito** — `tasks:list` existente, tempo decorrido dos timestamps (relógio só enquanto há tarefa ativa), link para `/runs/:id` e "Cancelar" pelo `tasks:cancel` só em tarefas ativas.
- [x] 18.8.10 — Arquitetura e desempenho: um único hook de assinatura de `tasks:changed` compartilhado pelas seções (sem listeners duplicados, com remoção no desmontar), consultas sob demanda e ao fim de tarefas em vez de polling; nenhum serviço que duplique TaskEngine, Skills Manager, MCP, projetos ou Git; novos IPC com esquemas Zod estritos e só leitura (exceto cancelar e abrir/revelar arquivo); redação de segredos (`packages/agents/src/redact.ts`) aplicada a toda evidência exibida. **Feito** — sem listener novo: as seções usam o React Query já invalidado pelo `useTaskUpdates` do Chat; `mcp:servers`, `projects:line-stats` e `tasks:output-file` com esquemas Zod estritos.
- [x] 18.8.11 — Testes: unitários para os parsers estendidos (fixtures de saída real, incluindo ausência de campos), para a classificação de estados das skills (instalada ≠ utilizada; texto da resposta nunca promove estado) e para contagens Git; contratos IPC; E2E com o agente falso (`tests/e2e/fake-agent.mjs`, estendido com invocação de skill, falha de skill e uso de MCP nos formatos reais) cobrindo abrir/recolher independente com persistência, branch do projeto correto, "Indisponível" sem métricas, saídas localizáveis, alterações iguais ao repositório, cancelamento, envio de mensagens com os três painéis abertos e layout em 960×600, 1280×820 e 1920×1080 (drawer na janela menor); validação final com `NB_REAL_CLI=1` documentando as diferenças de telemetria entre Claude Code e Codex. **Feito** — agente falso e CLIs reais; resultados no `PLAN.md`.

**Diferenças de observabilidade esperadas** (a confirmar na implementação, sem presumir paridade): o Claude Code tende a expor mais (init com MCP/ferramentas, `tool_use` nomeado, uso por resultado); o Codex expõe itens concluídos (comandos, MCP, arquivos, uso por turno) sem evento de skill. A interface mostra cada agente no nível que seus dados permitem e documenta a limitação na própria seção.

## Critérios de aceite

- [x] Sidebar principal recolhível e persistente.
- [x] Histórico recolhível, pesquisável, agrupado e persistente.
- [x] Composer fixo no rodapé e sem formulário antigo no topo.
- [x] Seletores reais de projeto, agente e modelo/versão suportado.
- [x] Conversas persistentes, pesquisáveis, reabríveis e gerenciáveis com confirmação.
- [x] Mensagens e estados de execução corretos, com auto-scroll inteligente.
- [x] Estado vazio centralizado e composer no rodapé.
- [x] Responsividade sem sobreposição em resoluções Electron relevantes.
- [x] Integrações reais preservadas. (Agente falso nos formatos reais e `NB_REAL_CLI=1 chat-real.spec.ts` aprovado em 2026-10-29.)
- [x] Testes, lint, typecheck, build e `git diff --check` aprovados.

**Complemento 18.8 — painel direito (implementado em 2026-10-29; evidências em `docs/PLAN.md`):**

- [x] O painel direito abre e fecha independentemente das outras barras, com preferências visuais persistidas. (E2E com reinício.)
- [x] As informações de ambiente são reais e a branch Git corresponde ao projeto selecionado. (E2E: branch `trabalho` do repositório do projeto.)
- [x] As métricas de contexto não são simuladas; sem dado confiável aparecem como "Indisponível" ou ficam ocultas, separadas dos tokens totais. (Campos da fixture real do Claude; Codex "Indisponível".)
- [x] Os conectores refletem as configurações MCP reais, sem expor segredos. (Os dois CLIs conferidos com a configuração real; o "✔" real do Claude exigiu uma correção, coberta por teste.)
- [x] A seção Skills usa o Skills Manager existente, mostra skills relacionadas à sessão e diferencia Disponível, Carregada, Utilizada, Falha e Indisponível.
- [x] Toda skill "Utilizada" tem evidência verificável, associada ao agente responsável e à execução correspondente; o histórico é preservado quando os dados existem. (Formato da chamada `Skill` conferido numa transcrição real do Claude Code.)
- [x] As limitações de telemetria de cada CLI são tratadas sem inventar dados.
- [x] Os arquivos exibidos em Saídas podem ser abertos ou localizados. (Recusas comprovadas por E2E; o caminho de sucesso é coberto pelo teste unitário de `resolveOutputPath`, para o E2E não abrir janelas no computador.)
- [x] As alterações Git correspondem ao estado real do repositório, distinguindo repositório inteiro e execução atual.
- [x] As tarefas refletem eventos reais do TaskEngine; cancelar só onde o motor suporta.
- [x] O painel não interfere no envio de mensagens e o Chat continua utilizável com as três barras abertas.
- [x] O layout funciona em diferentes tamanhos de janela, com drawer em janelas pequenas. (960×600, 1280×820, 1600×900 e 1920×1080.)
- [x] As integrações anteriores continuam funcionais e os testes de 18.8.11 estão aprovados. (Agente falso e `NB_REAL_CLI=1`.)

## Instruções para a implementação futura

Inspecionar primeiro a implementação atual e os contratos existentes. Trabalhar em ciclos TDD quando aplicável, preservar as fases concluídas, não executar Claude Code durante a implementação automatizada desta fase, não criar commits automaticamente e registrar apenas resultados comprovados. A fase não deve ser marcada como concluída se algum critério permanecer sem validação real.
