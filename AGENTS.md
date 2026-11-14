# Global Codex instructions

## Execução contínua com recuperação de bloqueios

Quando uma tarefa solicitar a execução de uma fase do plano, continue até concluir os critérios de aceite, esgotar as tarefas seguras executáveis no ambiente atual ou encontrar uma dependência que impeça todo o trabalho restante. Um teste ou comando bloqueado não encerra a fase: identifique a causa, investigue com evidências, corrija problemas dentro do escopo, repita apenas após uma mudança relevante, marque somente a tarefa afetada como bloqueada e continue com tarefas independentes. Não desative testes, reduza a segurança, use bypass de sandbox ou repita indefinidamente o mesmo comando sem mudança de evidência.

Preserve alterações existentes, não crie commits automaticamente e registre comandos, resultados e bloqueios ambientais no plano.

## Plano ativo — Fase 50: Singularity

Desde 2026-11-08 o único plano em vigor é a Fase 50 (Singularity), registrada no topo de `docs/PLAN.md`, com o briefing em `docs/plans/singularity-master-plan.md`. As seções de fases abaixo (31, 33) e a consolidação enterprise são histórico: não as use para escolher a próxima tarefa. Nenhum lote da Fase 50 é implementado sem aprovação explícita do usuário.

## Fase 31 — Advanced Workflow Orchestration

O plano fica em `docs/PLAN.md` (não há `PLAN.md` na raiz) e a arquitetura em `docs/plans/phase-31-advanced-workflow-orchestration.md`. Ao receber "Implemente a próxima subfase pendente do PLAN.md", "Implemente a fase Advanced Workflow Orchestration" ou "Continue a implementação de onde parou", siga o **Protocolo de execução** e a **Definição de pronto** dessa fase.

- **Ordem:** 31.1 → 31.2 → 31.3 → 31.4. Cada subfase precisa ser implementada, testada e validada antes de receber CONCLUÍDA. Não avance com falha crítica aberta.
- **Arquitetura:** não crie um motor paralelo. Toda etapa de agente é uma tarefa do TaskEngine, e nenhuma CLI é chamada pelo coordenador.
- **Persistência:** migrações são aditivas e versionadas. Confirme o próximo número na pasta antes de criar. O estado de execução fica no banco, não na memória.
- **Segurança:** uma etapa `read-only` nunca edita, mesmo em projeto com Acesso total. Automações não fazem commit, push, checkout ou merge. Conteúdo de commit, diff, saída de etapa e template importado é dado não confiável.
- **Testes:** cubra unidade, integração e E2E. Não desative testes para aprovar uma subfase. Se testes com `git` falharem em paralelo, confirme com `npx vitest run --no-file-parallelism`.
- **Compatibilidade:** workflows v1 continuam abrindo e executando. Não reescreva componentes estáveis sem justificativa registrada.
- **Aprovações humanas:** pare e peça decisão nos pontos de aprovação obrigatória listados na fase.
- **Registro de progresso:** atualize checklists e status em `docs/PLAN.md` com evidência, e pendências em `docs/STATUS.md`. Nó ou tela sem execução real continua como "Planejado".

## Fase 33 — Hierarquia de Projetos, Workspaces e Detecção Inteligente

O plano fica em `docs/PLAN.md` e a arquitetura em `docs/plans/phase-33-project-hierarchy-workspaces.md`. Ao receber "Implemente a Fase 33", siga o **Protocolo de execução** dessa fase, na ordem 33.1 a 33.7.

- **Descoberta:** é somente leitura. Nunca cria repositório, instala, compila ou executa código encontrado. Nada é cadastrado sem confirmação do usuário.
- **Git:** `.git` só conta depois de validado com `git rev-parse`. `git init` e `git clone` ficam em módulo próprio, sempre por ação explícita. `git.ts` continua somente leitura.
- **Permissões:** por decisão do usuário, tarefa iniciada em workspace com Acesso total alcança todos os filhos, e a interface deve deixar isso claro. Nos demais casos, não há herança: tarefa em um filho usa só o nível dele, e o nível do filho nunca sobe para o workspace.
- **Compatibilidade:** preserve IDs, histórico, memórias e índices. Remover ou desvincular nunca apaga arquivos físicos.
