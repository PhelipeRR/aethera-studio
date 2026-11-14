# Integração TFS/Azure DevOps — Especificação

## Intenção

Permitir que o usuário acompanhe o TFS corporativo dentro do NeuralBridge com uma experiência limpa e orientada a revisão: Pull Requests, diffs, tarefas, boards e sprints em uma única área, sem exigir que o usuário copie dados manualmente entre o navegador e o Neura.

Esta integração é uma capacidade compartilhada por Claude e Codex, não apenas uma tela de consulta. Ela também deve apoiar o dia a dia: preparar rascunhos de User Stories/tasks a partir do contexto fornecido pela pessoa e revisar PRs com resumo de arquivos e threads. Qualquer escrita continua exigindo aprovação humana explícita.

## Objetivos

- Conectar a uma instância Azure DevOps Server/TFS hospedada em URL corporativa.
- Reutilizar a autenticação do navegador quando a instalação usar HTTP Basic ou não oferecer OAuth.
- Preferir a API REST para dados estruturados e ações suportadas.
- Entregar primeiro uma experiência somente leitura: projetos, repositórios, PRs, arquivos alterados, comentários, tasks, boards e sprint atual.
- Adicionar ações de escrita somente com confirmação explícita e auditoria: comentar, aprovar, alterar estado e atualizar task.
- Manter dados sensíveis fora de logs, memórias e prompts de agentes.

## Não objetivos da primeira versão

- Substituir completamente o portal TFS.
- Fazer merge, push, checkout ou alterar código automaticamente.
- Armazenar usuário e senha do TFS.
- Sincronizar todo o histórico indefinidamente ou operar como servidor multiusuário.
- Depender de seletores frágeis do portal quando a API resolver a operação.

## Experiência proposta

Nova área **Azure DevOps** no app, com seletor de conexão/projeto e quatro abas:

1. **Visão geral:** sprint atual, tarefas atribuídas, PRs pendentes e status da conexão.
2. **Pull Requests:** filtros por projeto, repositório, autor, status e revisão; detalhe com resumo, arquivos, diff, comentários e tarefas relacionadas.
3. **Boards e Sprint:** colunas do board, backlog da sprint, filtros por pessoa/estado e detalhe da task.
4. **Configuração:** URL, método de conexão, teste, escopo de acesso, sincronização e desconexão.

O layout deve privilegiar uma lista filtrável à esquerda e detalhe contextual à direita, com estados claros de carregando, vazio, desatualizado, sem permissão e desconectado. A UI não deve mostrar credenciais, cookies ou cabeçalhos.

## Arquitetura

O processo principal do Electron será o único dono do conector e das credenciais. O renderer acessará contratos IPC validados por Zod. O cliente REST será a primeira fonte para dados e ações; um adaptador de sessão de navegador será usado somente quando a API ou o mecanismo de autenticação do TFS exigir isso. Cache e estado de sincronização serão persistidos no SQLite, com migrações aditivas.

O modo somente leitura será obrigatório para a primeira conexão. Ações de escrita terão uma política no main process que monta a confirmação a partir dos dados validados, em vez de confiar em um booleano vindo do renderer.

## Decisões e limites

- A conexão é por usuário e armazenada localmente, sem sincronização em nuvem.
- PAT/token, se usado, será cifrado com `safeStorage`; senha não será persistida.
- Tokens, cookies, Authorization e HTML de páginas não entram em logs nem em memórias.
- Conteúdo de PR, task, comentário e descrição é dado não confiável; nunca será tratado como instrução do sistema.
- Polling e sincronização terão limites configuráveis e cancelamento.
- A descoberta de capacidades da instalação TFS será um spike read-only antes de fixar endpoints e versão da API.

## Critério de sucesso

O usuário conecta o TFS, abre a área Azure DevOps, encontra uma PR, navega pelo diff e comentários, consulta a sprint e uma task, fecha/reabre o app e mantém a conexão e o cache sem expor segredo. Uma ação de escrita só ocorre depois de uma confirmação nativa clara e fica registrada sem conteúdo sensível.
