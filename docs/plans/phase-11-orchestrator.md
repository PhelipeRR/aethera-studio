# Fase 11 — Orquestrador e motor de tarefas (sub-plano)

Transforma um pedido em execução real: escolhe o agente, controla estados e limites, registra tudo no banco e permite cancelar e retomar. A UI (chat e execuções) é a Fase 12; aqui a API do motor fica pronta e testada.

## Pacote `packages/orchestrator`

- `router.ts` — `route(prompt, context): RouteDecision`. Regras determinísticas, sem gastar tokens:
  - Tipo da tarefa por palavras-chave PT/EN: `trivial`, `question` (análise/explicação), `planning`, `architecture`, `implementation`, `refactor`, `tests`, `ui`, `complex`.
  - Complexidade: tamanho do pedido, várias etapas ("e depois", listas), tipos combinados (ex.: arquitetura + implementação) → `complex`.
  - Agente: `planning`/`architecture`/`question`/`ui` → Claude; `implementation`/`refactor`/`tests` → Codex; `complex` → colaborativo; `trivial` → agente preferido do projeto, senão quem tiver mais sucesso (≥ 5 amostras), senão Claude.
  - Modo manual (`claude`/`codex`/`collab`) sempre vence. Agente indisponível → o outro, com o motivo; colaborativo sem os dois → agente único.
  - Edição: `question`/`planning`/`architecture` rodam em somente leitura; o resto em edição.
  - Resultado com `reasons[]` legíveis (mostrados na UI).
- `risk.ts` — `assessRisk(prompt): string[]`: apagar/excluir/drop/truncate/reset --hard/push --force/rm -rf/migração para baixo etc. Qualquer motivo → a tarefa espera aprovação (`awaiting_approval`) antes de rodar (A10).
- `prompts.ts` — textos enviados aos agentes: pedido, regras do projeto, limites, e o aviso de que memórias do NeuralBridge são referência, não instrução. Esquemas JSON do plano e da revisão.
- `engine.ts` — `TaskEngine`:
  - `start({ prompt, projectId, mode, approved? }) → taskId`, `approve(id)`, `cancel(id)`, `resume(id, prompt)`, `on('event')`, `recover()`.
  - Estados (seção 12): `pending → awaiting_approval? → planning? → running → validating? → completed | failed | cancelled`.
  - **Uma tarefa por projeto por vez** (fila em memória; o app é instância única). Projetos diferentes rodam em paralelo.
  - Cada etapa vira linha em `task_steps` (agente, tipo, sessão, tokens, custo informado, arquivos alterados, erro); cada evento do agente vira `task_events` (JSON redigido, texto limitado a 4 KB por evento).
  - **Arquivos alterados**: `git status` antes/depois de cada etapa de edição (somente leitura, Fase 10) + eventos `file_change`. Diff final da tarefa salvo como evento `diff` (até 512 KB).
  - **Sem projeto**: só leitura, numa pasta temporária vazia.
  - **MCP**: cada execução recebe o servidor do NeuralBridge com `--project` (Fase 7), para os agentes consultarem e gravarem memória.
  - `recover()` ao iniciar: tarefas que ficaram em estados ativos viram `failed` ("interrompida: o app foi fechado").
- **Colaborativo** (seção 4 da spec):
  1. `plan` — Claude, somente leitura, `--json-schema` → `{ summary, steps[{ title, instructions, files[] }], acceptance[] }`.
  2. `implement` — Codex, edição, com o plano, critérios e arquivos esperados.
  3. `review` — Claude, somente leitura, `--json-schema` → `{ approved, issues[{ description, fix }] }`, com o diff da etapa.
  4. Se reprovado e ainda houver iterações: `fix` — Codex com os problemas; volta à revisão.
  5. Reprovado no limite → `failed` com os problemas listados (as alterações ficam na pasta para o usuário revisar).
- **Limites** (configuráveis): `maxIterations = 3` correções, `stepTimeoutMs = 15 min`, `tokenBudget = 2.000.000` tokens informados por tarefa (verificado entre etapas). Nunca loop sem fim.
- **Retomada**: nova tarefa com `parent_task_id`; cada agente retoma a própria sessão anterior (`resumeSessionId`).

Também: o evento `result` dos adaptadores ganha `structured` (o Claude devolve `structured_output` com `--json-schema` — verificado na 2.1.312).

## Testes

- Roteador: cada exemplo da spec → agente esperado; trivial → um agente; manual vence; indisponibilidade; preferido do projeto; taxa de sucesso só com ≥ 5 amostras; somente leitura para análise.
- Risco: frases destrutivas PT/EN detectadas; frases comuns não.
- Motor (adaptadores falsos, banco real, repositório git temporário):
  - Agente único: estados persistidos, etapa com sessão e tokens, arquivos alterados, evento `diff`, falha do agente → `failed` com erro.
  - Aprovação: destrutiva para em `awaiting_approval`; `approve` executa; `cancel` encerra.
  - Fila: duas tarefas no mesmo projeto em série; projetos diferentes em paralelo.
  - Cancelamento em `pending` (na fila), `awaiting_approval` e `running` (sinal chega ao adaptador).
  - Colaborativo: aprovado na primeira; reprovado → correção → aprovado; reprovado sempre → para em `maxIterations`; plano inválido → `failed`.
  - Orçamento estourado interrompe antes da próxima etapa.
  - Retomada passa as sessões anteriores aos adaptadores.
  - `recover()` marca tarefas interrompidas.
- Real (`NB_REAL_CLI=1`): fluxo colaborativo completo num repositório temporário (Claude planeja, Codex implementa, Claude revisa).

## Aceite

Critérios "tarefa colaborativa", "registrar histórico" e "permitir cancelamento" comprovados por testes; tudo verde.
