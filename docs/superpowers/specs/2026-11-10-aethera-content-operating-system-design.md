# Aethera — Content Operating System

Data: 2026-11-10  
Status: implementação incremental em validação  
Decisão: Opção D — linha de produção + múltiplos projetos + experiência guiada  
Implementação: `docs/aethera/STATUS.md` registra os lotes entregues, evidências e pendências externas; OAuth real do Google permanece dependência de homologação, sem credenciais fictícias.

## 1. Intenção

Transformar o Aethera de uma coleção de ferramentas de vídeo em um estúdio de produção audiovisual inteligente, capaz de operar um vídeo por vez ou um calendário contínuo para vários canais.

O primeiro uso deve continuar simples: o usuário pode iniciar uma ideia e seguir uma próxima ação clara. A arquitetura, porém, precisa suportar múltiplos canais, vídeos longos, Shorts, versões, publicações e aprendizado com resultados sem duplicar o pipeline existente.

## 2. Resultado desejado

O usuário deve conseguir:

1. configurar um canal com identidade, público e estratégia;
2. transformar uma ideia em briefing, roteiro, produção e pacote de publicação;
3. revisar somente os pontos importantes conforme o nível de autonomia escolhido;
4. gerar diferentes versões do mesmo projeto sem perder histórico;
5. publicar ou agendar quando o pacote estiver aprovado;
6. usar os resultados para orientar novas ideias.

O Aethera coordena o trabalho. Agentes, modelos, provedores de mídia e motores de render são componentes substituíveis.

## 3. Não objetivos da primeira entrega

- implementar autonomia total ou produção em massa imediatamente;
- reescrever o `ProductionRunService`, o TaskEngine ou o render existente;
- obrigar o usuário a configurar vários canais antes de produzir o primeiro vídeo;
- fazer publicação pública sem uma política explícita de aprovação;
- criar um editor profissional completo antes de estabilizar o fluxo de produção;
- embutir provedores externos ou criar credenciais fictícias;
- remover ou renomear IDs, tabelas, canais IPC ou projetos legados do Velix/Aethera.

## 4. Abordagens consideradas

### A. Linha de produção única

Um vídeo percorre Ideia → Briefing → Roteiro → Produção → Publicação → Análise.

Vantagem: experiência clara e aproveita o pipeline atual.  
Limitação: não modela bem múltiplos canais, calendário e versões.

### B. Gerenciador de projetos

O produto se organiza em Ideias, Produções e Publicações, com foco em administrar muitos vídeos.

Vantagem: bom para escala e calendário.  
Limitação: pode parecer um gerenciador administrativo antes de o usuário criar seu primeiro vídeo.

### C. Assistente passo a passo

O sistema mostra somente a etapa atual e a próxima ação.

Vantagem: baixa complexidade inicial.  
Limitação: esconde contexto, histórico e controle para usuários avançados.

### D. Escolhida: linha de produção dentro de um sistema de conteúdo

Combina a clareza da linha de produção, a capacidade de múltiplos projetos e uma experiência guiada. O pipeline técnico continua sendo o motor; a nova camada organiza o produto em Workspace, Canais, Projetos, Execuções e Publicações.

Essa abordagem atende tanto o modo Criador quanto o modo Autônomo sem criar dois produtos diferentes.

## 5. Modelo conceitual

```text
Aethera
└── Workspace
    ├── Canais
    │   ├── identidade e público
    │   ├── estratégia editorial
    │   ├── regras de autonomia
    │   └── calendário
    ├── Ideias
    ├── Projetos de vídeo
    │   ├── briefing e roteiro
    │   ├── execuções de produção
    │   ├── ativos e versões
    │   └── pacotes de publicação
    ├── Fila de produção
    ├── Biblioteca
    ├── Agentes e provedores
    └── Analytics e memória
```

### 5.1 Entidades e responsabilidades

| Entidade | Responsabilidade |
|---|---|
| Workspace | Agrupa canais, projetos, biblioteca, configurações e memória. |
| Canal | Define nicho, público, identidade, formatos, frequência, regras editoriais e autonomia. |
| Ideia | Oportunidade ainda não transformada em produção; pode vir de pesquisa, analytics ou entrada manual. |
| Projeto de vídeo | Intenção editorial durável: tema, promessa, briefing, roteiro e relação com o canal. |
| Execução de produção | Uma tentativa rastreável do pipeline, com etapas, custos, falhas, aprovações e artefatos. |
| Ativo | Imagem, vídeo, áudio, narração, cena, thumbnail, legenda ou template versionado. |
| Pacote de publicação | Título, descrição, tags, capítulos, thumbnail, visibilidade, data e destino. |
| Publicação | Registro de uma entrega em uma plataforma, independente da execução que a originou. |
| Analytics | Métricas e observações associadas ao canal, projeto ou publicação. |
| Memória criativa | Preferências, padrões aprovados e aprendizados usados para orientar futuras sugestões. |

Regra essencial: Projeto de vídeo, Execução de produção e Publicação são entidades diferentes. Um projeto pode ter várias execuções e várias publicações, inclusive uma versão longa e cortes para Shorts.

## 6. Fluxo de produto

```text
Descoberta de oportunidades
        ↓
Ideia selecionada
        ↓
Briefing e planejamento
        ↓
Roteiro e aprovação
        ↓
Storyboard, cenas, voz e edição
        ↓
Render, qualidade e exportação
        ↓
Thumbnail, título, descrição e tags
        ↓
Revisão e agendamento/publicação
        ↓
Analytics e aprendizado
        └──────────────→ novas ideias
```

Cada projeto deve sempre exibir uma única próxima ação principal, por exemplo:

- `Escolher uma ideia`;
- `Completar briefing`;
- `Aprovar roteiro`;
- `Continuar produção`;
- `Escolher thumbnail`;
- `Revisar pacote de publicação`;
- `Agendar vídeo`;
- `Ver desempenho`.

## 7. Modos de operação

### Modo Criador

Para um vídeo por vez e controle criativo. O Aethera guia o usuário, mostra versões e interrompe nos pontos configurados.

### Modo Autônomo

Para um canal ou calendário contínuo. O Aethera pode pesquisar oportunidades, preparar projetos, executar etapas intermediárias e manter uma fila, respeitando orçamento, limites e políticas de aprovação.

Os dois modos usam o mesmo pipeline e os mesmos contratos. O modo altera a política de execução, não a arquitetura.

## 8. Aprovações inteligentes

Cada canal possui um nível padrão, que pode ser substituído por projeto:

| Nível | Comportamento inicial |
|---|---|
| Manual | Aprova briefing, roteiro, storyboard/vídeo e publicação. |
| Assistido | Aprova roteiro e resultado final; etapas intermediárias seguem automaticamente. |
| Autônomo | Executa etapas sem aprovação intermediária dentro de limites configurados. |

Na primeira versão, publicação pública exige aprovação explícita, mesmo no modo Autônomo. A política deve registrar quem aprovou, qual versão foi aprovada e quais mudanças ocorreram depois.

## 9. Experiência de navegação

### Home

Deve responder rapidamente:

- o que está em produção;
- o que aguarda aprovação;
- o que está pronto para publicar;
- o que está agendado;
- qual é a próxima ação recomendada;
- quais custos ou limites exigem atenção.

### Canal

Apresenta identidade, público, estratégia editorial, calendário, regras de autonomia e projetos associados. Um usuário pode criar o primeiro projeto sem preencher todos os campos avançados.

### Projeto de vídeo

É o centro do trabalho. Deve apresentar:

```text
Ideia ✓ → Briefing ✓ → Roteiro ● → Produção ○ → Pacote ○ → Publicação ○ → Análise ○
```

Além do estado, exibe versões, ativos, custos, aprovações, histórico e a próxima ação.

### Fila

Mostra projetos em andamento, bloqueados, aguardando aprovação e agendados. A produção paralela terá limite explícito de concorrência e custo.

### Biblioteca

Organiza ativos reutilizáveis com origem, licença, canal permitido, versão, tags e relação com projetos. Reutilização não pode apagar a origem nem ocultar restrições de direitos.

### Publicações

Combina pacotes prontos, calendário, status de upload/agendamento e histórico de plataformas. O canal do YouTube deixa de ser uma área isolada e passa a ser um destino de publicação.

### Analytics

Relaciona métricas às decisões editoriais e gera sugestões de novas ideias. A primeira versão deve ser somente leitura e não alterar automaticamente um projeto publicado.

## 10. Agentes especializados

Os agentes são papéis substituíveis dentro de tarefas do pipeline:

- Pesquisador: fontes, tendências e oportunidades;
- Estrategista: promessa, público, formato e calendário;
- Roteirista: estrutura e texto;
- Diretor visual: storyboard, cenas e referências;
- Editor: montagem, ritmo, legendas e continuidade;
- Especialista de thumbnail: composição e variações;
- Especialista de SEO: título, descrição, tags e capítulos;
- Analista: desempenho e hipóteses para a próxima rodada.

Nenhum agente executa ações externas diretamente. Ele produz uma saída estruturada; o orquestrador aplica políticas, custos, aprovações e ferramentas autorizadas.

## 11. Produção por cenas e render incremental

O editor de cenas é uma prioridade arquitetural. Cada cena deve ser um ativo versionado, com dependências, duração, narração e posição na composição.

Uma alteração em uma cena deve invalidar somente os derivados afetados quando possível. O sistema deve manter:

- versão anterior;
- cena alterada;
- dependências invalidadas;
- custo estimado da regeneração;
- render parcial e final;
- aprovação relacionada.

Até existir um mecanismo seguro de invalidação incremental, o produto deve comunicar claramente quando um render completo será necessário.

## 12. Custos, limites e segurança

- estimar custos antes de operações externas ou caras;
- aplicar orçamento por canal, projeto e execução;
- impedir produção paralela acima da capacidade configurada;
- registrar provedor, modelo, versão e custo estimado/real;
- tratar prompts, fontes, arquivos SVML e conteúdo externo como dados não confiáveis;
- manter tokens e OAuth no cofre existente;
- exigir confirmação para publicação, alteração de canal e ações irreversíveis;
- nunca criar credenciais fictícias para integrações reais.

## 13. Evolução técnica a partir do código atual

O pipeline atual de produção, persistência, aprovações, TaskEngine, render e integração de canal deve ser preservado e envolvido por uma camada de produto mais clara.

Primeiros pontos de integração esperados:

- reutilizar `ProductionRunService` como Execução de produção;
- reaproveitar `ProductionState` para o estado detalhado das etapas;
- manter aprovações e auditoria existentes;
- adaptar `VelixChannel` para o conceito de destino de publicação;
- preservar tabelas, IDs, canais IPC e projetos antigos;
- adicionar entidades e migrações de forma aditiva;
- manter o suporte de abertura e execução de projetos legados.

O rebranding de Velix para Aethera continua sendo compatibilidade de apresentação; identificadores internos não devem ser renomeados nesta iniciativa.

## 14. Fases propostas

### Fase 1 — Fundação do produto

Workspace, canal, projeto, execução, publicação e linha de produção visual. Home com próxima ação. Sem alterar o motor de render.

### Fase 2 — Experiência guiada

Briefing orientado, editor de roteiro, versões e aprovações por política.

### Fase 3 — Produção editável

Editor de cenas, ativos versionados, invalidação de dependências e render incremental quando seguro.

### Fase 4 — Distribuição

Pacote de publicação, thumbnails, SEO, calendário, upload e agendamento com OAuth real pendente de validação externa.

### Fase 5 — Inteligência operacional

Biblioteca inteligente, custos, agentes especializados, memória criativa e recomendações.

### Fase 6 — Escala e autonomia

Produção paralela, filas, limites, modo Autônomo e analytics conectados à descoberta de oportunidades.

Cada fase deve ser implementada em lotes pequenos, com testes de unidade, integração e E2E quando houver mudança de fluxo, sem desativar regressões existentes.

## 15. Critérios de sucesso

- um usuário novo consegue iniciar um vídeo sem entender a arquitetura interna;
- um usuário avançado consegue administrar vários canais e projetos;
- cada projeto tem uma próxima ação inequívoca;
- o usuário sabe o que está aguardando sua aprovação;
- versões, execuções e publicações não se confundem;
- o mesmo projeto pode gerar vídeo longo e Shorts;
- o pipeline existente continua funcionando;
- nenhuma integração externa é simulada como se estivesse validada;
- o sistema consegue evoluir de criação manual para operação autônoma sem criar um segundo motor.

## 16. Decisões ainda necessárias

1. O primeiro canal deve ser tratado como canal padrão do Workspace ou o usuário deve criar um canal explicitamente?
2. Quais plataformas entram no primeiro pacote de publicação além do YouTube?
3. A thumbnail deve ser aprovada separadamente do vídeo ou junto com o pacote de publicação?
4. O modo Autônomo pode preparar uploads privados automaticamente, deixando apenas a publicação pública para aprovação?
5. Qual é a unidade principal do calendário: projeto, pacote de publicação ou publicação por plataforma?

