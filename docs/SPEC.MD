PROJETO: NeuralBridge — Universal AI Orchestrator \& Memory

## Produto: Git Intelligence 2.0

Git Intelligence 2.0 é uma estação Git local-first para histórico, working tree, diffs, operações autorizadas, automações, revisão assistida e associação com Brain/RAG. O plano oficial está em `docs/plans/phase-38-git-intelligence-2.md` e preserva GitReader, GitWriter, TaskEngine, Workflow Builder, hierarquia de projetos e contratos IPC.

O renderer nunca executa shell. O processo principal resolve repositórios e valida schemas; comandos usam `shell:false`, argumentos em array, timeout, cancelamento e `--end-of-options` quando aplicável. Escritas exigem intenção explícita e confirmação contextual; reset hard, clean, force-push e rebase destrutivo ficam fora do MVP. Diffs e mensagens são dados não confiáveis. A UI segue o `MASTER.md`, com tokens semânticos, foco visível, teclado, contraste e reduced motion, sem métricas ou estados inventados.

Você é um engenheiro de software principal, arquiteto de sistemas distribuídos, especialista em Electron, TypeScript, Model Context Protocol (MCP), Claude Code, OpenAI Codex e engenharia de agentes de IA.

Sua missão é desenvolver um aplicativo desktop completo, funcional e instalável no Windows, chamado NeuralBridge.

O NeuralBridge será um sistema local-first de orquestração multiagente e memória compartilhada, inspirado conceitualmente no AI Brain (https://ai-brain.aisac.cloud/), mas com funcionalidades adicionais de execução de tarefas, gerenciamento de projetos, otimização de tokens e coordenação automática entre Claude Code e Codex.

Não quero apenas um protótipo visual, telas estáticas ou funcionalidades simuladas. Quero um produto real, com integrações funcionais, persistência e testes.

1\. Objetivo principal

O usuário deverá digitar um único comando em linguagem natural, por exemplo:

"Analise meu projeto .NET, identifique problemas de performance, implemente melhorias e execute os testes."

O NeuralBridge deverá automaticamente:

Interpretar a solicitação.

Identificar o projeto e seu contexto.

Recuperar memórias relevantes.

Classificar a complexidade.

Selecionar Claude, Codex ou ambos.

Dividir a tarefa quando necessário.

Aplicar estratégias de economia de tokens.

Executar as tarefas pelos CLIs instalados.

Monitorar progresso, logs e resultados.

Validar alterações e testes.

Registrar decisões e aprendizados na memória.

Apresentar um resultado consolidado.

O usuário não deve precisar escolher manualmente qual IA utilizar em cada solicitação.

Deve existir também um modo manual para selecionar o agente.

2\. Stack tecnológica

Utilize:

Electron para o aplicativo desktop.

React + TypeScript para a interface.

Vite para desenvolvimento e build.

Tailwind CSS.

shadcn/ui.

Lucide Icons.

Zustand para estado da interface.

TanStack Query quando apropriado.

Node.js para serviços locais.

SQLite para persistência.

Drizzle ORM para acesso ao banco.

Zod para validação.

MCP SDK oficial para o servidor MCP.

Electron Builder ou Electron Forge para empacotamento.

Vitest para testes unitários.

Playwright para testes E2E.

Verifique versões e compatibilidade antes de instalar.

Utilize arquitetura modular, tipagem rigorosa e separação entre processo principal do Electron, preload, renderer, agentes, orquestrador e memória.

3\. Interface desktop

Crie uma interface profissional, moderna e consistente, com identidade visual própria.

Referências de qualidade: Linear, Cursor, Raycast e interfaces modernas de ferramentas para desenvolvedores.

Tema escuro como padrão, com opção de tema claro.

Sidebar principal:

Dashboard

Chat

Projetos

Agentes

Memória

Skills

MCPs

Execuções

Analytics

Configurações

Dashboard

Exibir:

Status de Claude Code.

Status de Codex CLI.

Agentes disponíveis.

Tarefas em execução.

Histórico recente.

Consumo de tokens.

Estimativa de custos, quando houver dados confiáveis.

Economia estimada de contexto.

Status do servidor MCP.

Saúde geral das integrações.

Chat central

Implementar:

Campo de entrada com suporte a múltiplas linhas.

Seleção de projeto.

Modo automático.

Modo Claude.

Modo Codex.

Modo colaborativo.

Histórico de conversas.

Markdown e blocos de código.

Visualização de arquivos modificados.

Progresso de execução em tempo real.

Botão de cancelar execução.

Indicadores de agente ativo.

Não utilizar respostas mockadas na integração final.

4\. Orquestrador inteligente

Criar um módulo chamado AgentOrchestrator.

O sistema deve possuir um roteador que decida qual agente utilizar.

Exemplos de classificação:

Planejamento complexo: Claude.

Arquitetura: Claude.

Implementação isolada: Codex.

Refatoração: Codex.

Testes: Codex.

UI/UX: Claude com skills específicas.

Problemas complexos: Claude + Codex.

Tarefas triviais: apenas um agente, sem delegação desnecessária.

A seleção deve considerar:

Tipo de tarefa.

Complexidade.

Tamanho do contexto.

Disponibilidade dos agentes.

Histórico de sucesso.

Capacidade necessária.

Custo estimado.

Necessidade de revisão independente.

Implemente roteamento inicialmente com regras determinísticas e configuráveis, evitando consumir tokens apenas para decidir qual agente chamar.

Permita evoluir futuramente para um classificador assistido por IA.

Modo colaborativo

Quando ambos forem necessários:

Claude analisa a tarefa.

Claude define subtarefas e critérios de aceite.

Codex executa a implementação delimitada.

Codex retorna arquivos alterados, testes e resumo.

Claude revisa os resultados.

Se necessário, Codex recebe uma correção específica.

O orquestrador consolida a resposta.

Não permitir loops ilimitados.

Definir limite configurável de iterações, timeout e orçamento.

Não executar agentes simultaneamente sobre os mesmos arquivos.

5\. Integração real com Claude Code e Codex

Criar adaptadores independentes:

ClaudeCliAdapter

CodexCliAdapter

Cada adaptador deverá:

Detectar instalação.

Identificar versão.

Verificar autenticação por mecanismos oficiais.

Identificar recursos suportados.

Executar comandos com parâmetros seguros.

Capturar stdout e stderr.

Suportar cancelamento.

Tratar timeouts.

Normalizar resultados.

Registrar métricas disponíveis.

Tratar erros sem travar a interface.

Utilize APIs de processo do Node.js no processo principal do Electron.

Nunca execute comandos arbitrários enviados diretamente pelo renderer.

Não utilizar shell: true com conteúdo não confiável.

Validar argumentos e caminhos.

Usar interfaces de execução documentadas nas versões instaladas dos CLIs.

Não presumir que o usuário possui créditos de API separados. As autenticações e permissões do Claude Code e Codex devem ser tratadas conforme seus respectivos produtos e planos.

6\. Token Optimizer

Implementar um módulo chamado TokenOptimizer.

Esse módulo é uma das partes mais importantes do projeto.

Objetivos:

Reduzir contexto redundante.

Evitar processamento duplicado.

Recuperar apenas memórias relevantes.

Utilizar resumos estruturados.

Delegar tarefas com escopo limitado.

Evitar agentes desnecessários.

Evitar ciclos excessivos de revisão.

Manter qualidade e correção.

Funcionalidades:

Context Budget

Definir orçamento de contexto por tarefa e agente.

Context Compression

Gerar resumos compactos preservando:

Objetivo.

Restrições.

Arquivos relevantes.

Critérios de aceite.

Decisões anteriores.

Erros conhecidos.

Smart Context Retrieval

Consultar memória e arquivos por relevância, evitando carregar tudo.

Agent Handoff

Criar pacotes de delegação com:

Identificador da tarefa.

Objetivo.

Contexto mínimo necessário.

Arquivos autorizados.

Critérios de aceite.

Limitações.

Resultado esperado.

Deduplication

Evitar transmitir repetidamente o mesmo contexto sem necessidade.

Token Analytics

Mostrar:

Tokens informados pelos provedores.

Tokens estimados, identificados como estimativas.

Tokens por agente.

Tokens por tarefa.

Custo estimado quando houver tabela de preços aplicável.

Comparação entre execução individual e colaborativa, somente quando existir base mensurável.

Não inventar métricas de economia.

Quando não houver dados confiáveis, mostrar "Indisponível".

7\. Memória universal — Neural Memory

Implementar um sistema persistente de memória compartilhada entre agentes.

Inspirar-se nos conceitos de memória do AI Brain, sem copiar sua implementação.

Criar operações:

memory\_store

memory\_search

memory\_recall

memory\_list

memory\_delete

memory\_link

Cada memória deverá possuir:

ID.

Título.

Conteúdo Markdown.

Projeto.

Tags.

Tipo.

Data de criação.

Data de atualização.

Origem.

Relações com outras memórias.

Tipos:

Decisão arquitetural.

Padrão de código.

Contexto de projeto.

Bug resolvido.

Aprendizado.

Preferência.

Documentação.

Resumo de execução.

Pesquisa

Implementar inicialmente:

Busca textual com SQLite FTS5.

Busca por título.

Filtros por projeto.

Filtros por tags.

Ranking de relevância.

Preparar a arquitetura para busca semântica futura, mas não exigir APIs pagas.

Memória automática

Após uma tarefa, identificar informações potencialmente reutilizáveis.

Não salvar automaticamente segredos, credenciais ou conteúdo sensível.

Oferecer configuração para memória automática, manual ou desativada.

Permitir visualizar, editar, exportar e excluir memórias.

8\. Servidor MCP real

O NeuralBridge deverá funcionar também como servidor MCP local.

Implementar usando o SDK oficial do Model Context Protocol.

Expor inicialmente:

memory\_store

memory\_search

memory\_recall

memory\_list

memory\_delete

orchestrator\_status

task\_status

Utilizar transporte stdio para clientes locais.

Criar um processo independente para o servidor MCP, sem depender da janela Electron estar aberta.

Permitir que Claude Code e Codex acessem a mesma base de memória.

Criar uma tela que mostre os comandos de conexão compatíveis com cada cliente.

Verificar os comandos oficiais atuais antes de gerar configurações.

Não presumir que o MCP permite controlar diretamente qualquer cliente sem as permissões e interfaces apropriadas.

O servidor MCP deverá respeitar permissões e isolamento entre projetos.

9\. Skills Manager

Criar uma interface para detectar e gerenciar skills.

Skills prioritárias:

Claude Codex Orchestrator.

Superpowers.

Frontend Design.

UI UX Pro Max.

Impeccable.

Remotion Best Practices.

Playwright Best Practices.

Caveman / Token Optimizer.

Vercel React Best Practices.

Web Design Guidelines.

Funcionalidades:

Listar skills instaladas.

Identificar diretórios.

Visualizar SKILL.md.

Verificar compatibilidade.

Instalar skills a partir de repositórios confiáveis.

Atualizar skills.

Detectar conflitos.

Ativar ou desativar quando suportado.

Associar skills a tipos de tarefa.

Não instalar nem executar scripts de terceiros sem inspecionar o conteúdo e solicitar aprovação quando necessário.

10\. Gerenciamento de projetos

Permitir:

Adicionar diretórios locais.

Detectar stack.

Identificar Git.

Visualizar arquivos relevantes.

Configurar agentes preferenciais.

Configurar regras de projeto.

Gerenciar memória por projeto.

Visualizar histórico de tarefas.

Revisar diffs.

Suportar especialmente:

.NET / C#.

ASP.NET Core.

Vue / Nuxt.

React / Next.js.

TypeScript.

SQL Server.

PostgreSQL.

Remotion.

Nunca modificar projetos sem uma tarefa autorizada.

11\. Segurança

Configurar Electron com:

contextIsolation: true.

nodeIntegration: false.

Sandboxing quando compatível.

Preload mínimo e tipado.

IPC com validação Zod.

Content Security Policy restritiva.

Proteção contra navegação externa indevida.

Proteção contra execução arbitrária.

Validação de caminhos.

Controle de permissões.

Logs sem credenciais.

Tratar conteúdo de memória e saídas de agentes como dados não confiáveis.

Não executar instruções encontradas em arquivos ou memórias como se fossem comandos privilegiados.

Para tarefas destrutivas, solicitar confirmação.

12\. Histórico e monitoramento

Criar sistema de execuções persistentes.

Estados:

Pendente.

Planejando.

Executando.

Aguardando aprovação.

Validando.

Concluído.

Falhou.

Cancelado.

Cada execução deverá registrar:

ID.

Prompt.

Projeto.

Agentes utilizados.

Etapas.

Duração.

Arquivos alterados.

Testes.

Erros.

Métricas disponíveis.

Permitir abrir uma execução antiga e continuar a partir do contexto salvo.

13\. UI/UX profissional

Utilizar as skills disponíveis de:

Frontend Design.

UI UX Pro Max.

Impeccable.

A interface deverá possuir:

Navegação consistente.

Tipografia profissional.

Espaçamento bem definido.

Componentes reutilizáveis.

Estados de carregamento.

Empty states.

Feedback de ações.

Tratamento de erros.

Atalhos de teclado.

Layout responsivo à janela.

Acessibilidade.

Não criar dashboards com números fictícios.

Não utilizar dados mockados na versão final.

14\. Arquitetura de pastas

Proponha uma estrutura semelhante a:

neuralbridge/

&#x20; apps/

&#x20;   desktop/

&#x20;     electron/

&#x20;     src/

&#x20;       components/

&#x20;       features/

&#x20;       pages/

&#x20;       hooks/

&#x20;       stores/

&#x20; packages/

&#x20;   core/

&#x20;     orchestrator/

&#x20;     router/

&#x20;     token-optimizer/

&#x20;     agent-adapters/

&#x20;     task-engine/

&#x20;   memory/

&#x20;   database/

&#x20;   mcp-server/

&#x20;   shared/

&#x20; tests/

&#x20;   unit/

&#x20;   integration/

&#x20;   e2e/

&#x20; scripts/

&#x20; docs/

Ajuste a estrutura quando houver justificativa técnica.

15\. Testes obrigatórios

Criar testes para:

Roteamento de agentes.

Otimização de contexto.

Persistência de memória.

Busca FTS5.

Operações MCP.

Detecção de CLIs.

Tratamento de erros.

Cancelamento de tarefas.

Controle de concorrência.

Segurança de IPC.

Fluxo completo de execução.

Implementar testes de integração reais quando os CLIs estiverem disponíveis.

Não afirmar que a integração está funcionando apenas porque o código compila.

16\. Empacotamento Windows

Configurar build de produção para Windows.

Gerar instalador compatível com Windows 10/11.

Incluir:

Ícone do aplicativo.

Nome NeuralBridge.

Versionamento.

Diretório de dados do usuário.

Persistência entre atualizações.

Logs locais.

Tratamento de inicialização.

Processo MCP independente.

Não exigir que o usuário abra um terminal para usar o aplicativo após a instalação.

17\. Plano de implementação

Antes de programar:

Inspecione o ambiente.

Verifique Claude Code e Codex.

Verifique as skills instaladas.

Consulte a documentação técnica necessária.

Defina arquitetura e contratos.

Crie um plano curto por fases.

Depois implemente progressivamente:

Fase 1 — Fundação

Electron, React, TypeScript, layout, navegação e banco SQLite.

Fase 2 — Agentes

Integração real com Claude Code e Codex CLI.

Fase 3 — Orquestração

Roteamento, delegação, execução e monitoramento.

Fase 4 — Memória e MCP

Persistência, pesquisa, ferramentas MCP e integração entre clientes.

Fase 5 — Token Optimizer

Orçamento, compactação, handoff e métricas.

Fase 6 — Skills e projetos

Gerenciamento de skills, configuração de projetos e histórico.

Fase 7 — Qualidade

Testes, segurança, auditoria visual e tratamento de erros.

Fase 8 — Distribuição

Build de produção, instalador Windows e documentação.

18\. Critérios de conclusão

O aplicativo somente poderá ser considerado concluído quando:

Abrir normalmente no Windows.

Detectar Claude e Codex instalados.

Executar uma tarefa real usando Claude.

Executar uma tarefa real usando Codex.

Executar uma tarefa colaborativa.

Salvar e recuperar memórias.

Expor ferramentas MCP funcionais.

Compartilhar memória entre clientes MCP configurados.

Registrar histórico.

Permitir cancelamento.

Exibir métricas reais ou estimativas identificadas.

Passar nos testes obrigatórios.

Gerar um instalador Windows.

Se algum recurso depender de autenticação, permissões ou serviços externos, informe claramente a pendência.

19\. Regras de execução

Não crie apenas um protótipo.

Não substitua integrações reais por mocks na versão final.

Não invente APIs ou comandos.

Não utilize dependências pagas desnecessariamente.

Não exponha credenciais.

Não sobrescreva configurações existentes sem backup.

Não utilize execução irrestrita.

Não esconda falhas de testes.

Evite abstrações excessivas.

Priorize código sustentável e funcional.

Utilize Claude e Codex de maneira complementar quando disponível.

Reduza contexto e tarefas redundantes.

20\. Começar agora

Crie o projeto NeuralBridge no diretório de trabalho autorizado.

Inspecione as dependências e versões disponíveis.

Implemente a primeira fase funcional e continue pelas demais, validando cada etapa.

Não pare após criar documentação ou telas.

Ao final de cada fase, informe resumidamente:

O que foi implementado.

O que foi testado.

O que está pendente.

A próxima etapa.

Objetivo final: entregar um aplicativo desktop real que una Claude Code, Codex, memória universal MCP e otimização inteligente de tokens em uma única interface profissional.



# NeuralBridge — Implementar o Neural Brain



Quero adicionar ao NeuralBridge um módulo chamado \*\*Neural Brain\*\*, inspirado nas funcionalidades publicamente documentadas do AI Brain da AISAC Cloud:



https://ai-brain.aisac.cloud/



\*\*O cérebro deverá ser uma das funcionalidades centrais do aplicativo.\*\*



Não quero apenas uma lista de memórias. Quero um sistema real de memória compartilhada entre Claude Code, Codex e outros clientes MCP compatíveis, com pesquisa semântica, grafo de conhecimento e recuperação inteligente de contexto.



\## 1. Memória universal



Implementar as seguintes ferramentas MCP:



\- `brain\_store`: criar ou atualizar memórias.

\- `brain\_recall`: recuperar uma memória completa.

\- `brain\_search`: pesquisar por palavras-chave e significado.

\- `brain\_list`: listar e filtrar memórias.

\- `brain\_delete`: excluir memórias.

\- `brain\_links`: consultar relações e backlinks.

\- `brain\_context`: montar contexto otimizado para uma tarefa.



Manter compatibilidade conceitual com as cinco operações principais do AI Brain, acrescentando funcionalidades próprias.



\## 2. Banco de conhecimento



Utilizar SQLite com Drizzle ORM.



Criar entidades para:



\- Memórias.

\- Projetos.

\- Tags.

\- Links.

\- Backlinks.

\- Embeddings.

\- Versões de memória.

\- Fontes.

\- Histórico de acesso.

\- Decisões arquiteturais.



Cada memória deverá ter identificador único, título, conteúdo Markdown, origem, projeto, tags, timestamps e relações.



Implementar migrações versionadas e integridade referencial.



\## 3. Pesquisa híbrida



Implementar dois mecanismos complementares:



\*\*Busca textual:\*\* SQLite FTS5, com ranking e filtros.



\*\*Busca semântica:\*\* embeddings locais, preferencialmente usando um modelo multilíngue executado no próprio computador.



Escolher um modelo que funcione em CPU, com aceleração por GPU opcional.



Armazenar os vetores localmente.



Implementar ranking híbrido usando Reciprocal Rank Fusion ou técnica equivalente, com testes de relevância.



O sistema deverá continuar funcionando caso o modelo de embeddings esteja indisponível, utilizando somente a pesquisa textual.



Não depender obrigatoriamente de APIs pagas.



## Neural RAG Engine — Recuperação Inteligente de Conhecimento

O Neural RAG Engine amplia o Neural Brain existente para indexar e recuperar conhecimento de documentos, documentação e código-fonte, preservando SQLite + Drizzle, FTS5, embeddings locais, \`BrainService\`, servidor MCP e contratos atuais. Não cria um segundo sistema de memória ou busca.

### Indexação
- Indexação incremental de documentos e código-fonte.
- Detecção de mudanças por hash.
- Chunking semântico para Markdown e documentação.
- Chunking orientado a símbolos para C# e TypeScript.
- Metadados de arquivo, linhas, projeto, hash e versão.
- Atualização e exclusão de registros obsoletos.
- Respeito a \`.gitignore\` e exclusão de arquivos sensíveis.

### Recuperação
- Pesquisa textual com SQLite FTS5.
- Pesquisa semântica com embeddings locais.
- Busca híbrida com Reciprocal Rank Fusion.
- Deduplicação e ranking de resultados.
- Filtros por projeto, tipo e origem.
- Recuperação de informações relacionadas pelo grafo.
- Fallback textual quando embeddings estiverem indisponíveis.

### Integração
- Reutilizar o Neural Brain existente.
- Integrar ao Token Optimizer.
- Disponibilizar recuperação para Claude e Codex via MCP.
- Preservar os contratos atuais.
- Montar contextos compactos com referências verificáveis.

### Segurança
- Isolamento entre projetos.
- Proteção contra prompt injection.
- Não indexar credenciais ou arquivos sensíveis.
- Não executar instruções recuperadas como comandos.
- Permitir exclusão e reindexação.

### Avaliação
- Recall@K, Precision@K, MRR, latência e tokens utilizados.
- Comparação de recuperação com e sem busca semântica.

Resultados e métricas só serão registrados após benchmarks reproduzíveis; esta especificação não presume resultados.

\## 4. Grafo de conhecimento visual



Criar uma página chamada \*\*Brain Graph\*\*.



O usuário deverá visualizar memórias como nós conectados.



Implementar:



\- Nós interativos.

\- Conexões direcionadas.

\- Backlinks.

\- Zoom e movimentação.

\- Arrastar nós.

\- Busca por memória.

\- Filtro por projeto.

\- Filtro por tags.

\- Agrupamento por categorias.

\- Painel lateral de detalhes.

\- Navegação entre memórias relacionadas.

\- Destaque de caminhos entre nós.



Utilizar React Flow, Cytoscape.js ou biblioteca equivalente, escolhendo conforme os requisitos de desempenho e manutenção.



Interpretar links no formato `\[\[Nome da Memória]]`.



Criar nós pendentes para links ainda não resolvidos, diferenciando-os visualmente.



\## 5. Aprendizado contínuo controlado



Ao finalizar uma tarefa, o NeuralBridge deverá identificar informações potencialmente úteis para reutilização.



Exemplos:



\- Causa raiz de um bug.

\- Solução aplicada.

\- Padrão de arquitetura.

\- Convenção de projeto.

\- Decisão técnica.

\- Erro recorrente.

\- Restrição de implementação.

\- Resultado de teste.



Não armazenar automaticamente toda a conversa.



Criar um mecanismo de extração, classificação, deduplicação e aprovação de memórias.



Disponibilizar três modos:



\- Manual.

\- Automático com confirmação.

\- Automático para categorias explicitamente autorizadas.



Não armazenar segredos, credenciais ou dados sensíveis sem autorização.



Memórias devem possuir estado de confiança e possibilidade de revisão.



\## 6. Memória compartilhada entre Claude e Codex



Implementar um servidor MCP local independente da janela Electron.



Claude Code e Codex deverão conseguir se conectar ao mesmo servidor e consultar a mesma base.



Fluxo esperado:



1\. Claude analisa uma arquitetura.

2\. Registra a decisão no Neural Brain.

3\. Codex recebe uma tarefa de implementação.

4\. Consulta o Neural Brain.

5\. Recupera a decisão relevante.

6\. Implementa respeitando as restrições.

7\. Registra o resultado validado.

8\. Claude consegue recuperar esse aprendizado posteriormente.



Utilizar o SDK oficial do MCP e comandos de configuração compatíveis com as versões instaladas dos clientes.



O servidor deve funcionar mesmo com a interface Electron fechada, quando iniciado como processo independente.



Não alegar compatibilidade com clientes que não tenham sido testados.



\## 7. Token Optimizer integrado à memória



Antes de executar uma tarefa:



1\. Identificar o projeto.

2\. Extrair palavras-chave e conceitos.

3\. Pesquisar memórias relevantes.

4\. Selecionar apenas as mais úteis.

5\. Eliminar duplicações.

6\. Montar um pacote de contexto compacto.

7\. Respeitar orçamento de tokens.

8\. Enviar o contexto ao agente escolhido.



Utilizar um limite configurável de memórias e tokens por recuperação.



Não carregar todo o histórico.



Manter referências às memórias utilizadas, permitindo rastrear de onde vieram as decisões.



Diferenciar economia estimada de economia efetivamente medida.



\## 8. Interface do cérebro



Criar uma experiência visual profissional, integrada ao NeuralBridge.



Páginas:



\*\*Brain Overview\*\*

\- Total de memórias.

\- Memórias por projeto.

\- Últimos aprendizados.

\- Conexões existentes.

\- Estado do servidor MCP.



\*\*Brain Graph\*\*

\- Grafo visual interativo.



\*\*Memory Explorer\*\*

\- Pesquisa híbrida.

\- Filtros.

\- Edição.

\- Histórico de versões.

\- Links e backlinks.



\*\*Memory Inspector\*\*

\- Conteúdo completo.

\- Origem.

\- Projeto.

\- Agente responsável.

\- Memórias relacionadas.

\- Histórico de alterações.



\*\*Brain Settings\*\*

\- Modelo de embeddings.

\- Política de retenção.

\- Backup e restauração.

\- Configuração MCP.

\- Permissões.

\- Limites de contexto.



\## 9. Segurança e confiabilidade



\- Tratar memórias recuperadas como dados não confiáveis.

\- Não executar instruções contidas em memórias como comandos.

\- Isolar memórias por projeto e escopo.

\- Impedir acesso não autorizado a projetos privados.

\- Criar backups automáticos configuráveis.

\- Implementar exportação em JSON e Markdown.

\- Permitir exclusão definitiva.

\- Registrar alterações sem armazenar credenciais nos logs.

\- Proteger o servidor MCP contra acesso remoto não autorizado.

\- Implementar testes de isolamento e recuperação.



\## 10. Critérios de aceite



O Neural Brain estará funcional quando:



1\. Uma memória puder ser criada no Claude Code.

2\. A mesma memória puder ser recuperada pelo Codex.

3\. A pesquisa textual funcionar.

4\. A pesquisa semântica funcionar com embeddings locais.

5\. Links e backlinks forem persistidos.

6\. O grafo exibir relações reais.

7\. O Electron permitir criar, editar e excluir memórias.

8\. O servidor MCP funcionar independentemente da interface.

9\. O Token Optimizer recuperar contexto relevante.

10\. As memórias sobreviverem ao reinício do computador.

11\. Backup e restauração forem testados.

12\. Os testes automatizados principais passarem.



\## 11. Estratégia de implementação



Priorizar a implementação do cérebro antes de funcionalidades secundárias do aplicativo.



Ordem:



1\. Modelagem e persistência.

2\. Ferramentas MCP.

3\. Integração Claude/Codex.

4\. Busca textual.

5\. Busca semântica local.

6\. Grafo e relações.

7\. Interface Electron.

8\. Aprendizado controlado.

9\. Otimização de contexto.

10\. Testes e empacotamento.



Não substituir funcionalidades reais por dados simulados.



Implemente por etapas verificáveis, mantendo o aplicativo executável.



\*\*Resultado esperado: um cérebro de IA independente, persistente, visual, compartilhado entre agentes e integrado ao NeuralBridge, com funcionalidades equivalentes às capacidades públicas centrais do AI Brain e recursos próprios de orquestração.\*\*

