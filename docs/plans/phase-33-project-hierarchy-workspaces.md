# Fase 33 — Hierarquia de Projetos, Workspaces e Detecção Inteligente: arquitetura

**Status:** CONCLUÍDA em 2026-10-30, com as ressalvas de `docs/STATUS.md`. Requisitos, tarefas, testes e critérios de aceite estão em [docs/PLAN.md](../PLAN.md#fase-33--hierarquia-de-projetos-workspaces-e-detecção-inteligente). Este documento guarda a auditoria do código, as decisões e os contratos. Os nomes abaixo são propostas; mudanças ficam registradas aqui.

## 1. Estado real do código (auditoria de 2026-10-30)

| # | Achado | Evidência | Efeito na Fase 33 |
|---|---|---|---|
| H1 | Projetos são uma lista plana, com `root_path` único. Não há pai, tipo nem Git por projeto. | `packages/database/src/schema.ts`, tabela `projects`. | Migração aditiva. |
| H2 | **Já existem projetos sobrepostos no banco real:** `hepta` (`D:\Dev\Hepta`, Acesso total) e `INS` (`D:\Dev\Hepta\INS`, Padrão). | Consulta somente leitura ao banco do usuário. | A migração e a primeira varredura precisam vincular os dois, preservando IDs. |
| H3 | **Uma tarefa em `hepta` alcança o `INS` sem checagem de permissões**, porque o agente roda com `cwd` na raiz e o Acesso total não tem limite de caminho. | `accessFor` e `runStep` em `engine.ts`; `claudeArgs` em `claude-adapter.ts`. | **Mantido por decisão do usuário** (D6). O alcance precisa ficar visível na interface. |
| H4 | `D:\Dev\Hepta` tem uma pasta `.git` que **não é repositório válido**. | `git -C D:\Dev\Hepta` falha, e `gitRepositories` já trata isso desde a 0.1.17. | `.git` nunca é prova sozinha. Vira fixture de teste. |
| H5 | `gitRepositories`, `gitChangedPaths` e `gitDiffFiles` já tratam pastas que agrupam repositórios, mas só um nível abaixo e com limite de 50. | `packages/workspace/src/git.ts`. | Reaproveitar. Na hierarquia, a lista passa a vir dos projetos cadastrados. |
| H6 | `stack` e `detected_at` já guardam tecnologia e data de detecção. `detectStack` já existe. | `schema.ts`; `apps/desktop/src/main/projects.ts`. | Reaproveitar em vez de criar `detectedTechnology` e `lastScannedAt`. |
| H7 | O índice RAG é por `project_id`, e `indexProject` varre a raiz inteira. `hepta` e `INS` podem ter os mesmos arquivos indexados duas vezes. | `packages/brain/src/rag-engine.ts`. | Dono único por arquivo (D8). A limpeza por `project_id` pode apagar chunks ao mudar a raiz indexada, então a transição precisa ser explícita. |
| H8 | Commits são indexados por projeto, com `knownCommits(handle, id)`. Dois projetos no mesmo repositório indexariam o mesmo histórico. | `apps/desktop/src/main/projects.ts`, `indexGit`. | Dono único do repositório (D9). |
| H9 | O TaskEngine tem um só `projectId` e `cwd`, e a fila é por projeto. Uma tarefa no workspace não conflita com uma tarefa em um filho, embora mexam nos mesmos arquivos. | `inProjectQueue`, `runRouted`. | Fila por raiz física (D7). |
| H10 | O Chat agrupa conversas por **nome** do projeto. Dois filhos chamados `root` se misturariam. | `History` em `ChatPage.tsx`, `byProject`. | Trocar por ID. |
| H11 | `projects.remove` já mede impacto em memórias, mas não há conceito de desvincular. | `impact`, `remove` em `projects.ts`. | Separar "desvincular" de "excluir". |
| H12 | O acesso Git é somente leitura por contrato (Fase 25). Não existem `git init` nem `git clone`. | `git.ts`; Fase 25 "Fora do escopo". | Criar executor de escrita separado e restrito (D10). |
| H13 | `validateProjectRoot` já recusa disco, pasta do usuário, sistema e rede, e resolve junctions. `isInsideProject` trata links. | `packages/workspace/src/project-paths.ts`. | Reaproveitar em todos os caminhos novos. |
| H14 | A correção automática exige repositório na raiz. Em `hepta`, ela recusa. | `takeSnapshot`. | Corrigir ao rodar a tarefa dentro do filho (33.7). |
| H15 | As Fases 31 e 32 estão em andamento, sem commit, nos mesmos arquivos. | `git status`; migrações `0020` a `0024`. | Conflito provável em `engine.ts`, `git.ts` e `main/index.ts`. |

## 2. Inventário

| Situação | Itens |
|---|---|
| **Reaproveitar** | `validateProjectRoot`, `isInsideProject`, `isSensitiveFile`, `detectStack`, `readDependencies`, `gitRun`, `gitRepositories`, `gitDiffFiles`, RagEngine, Project Intelligence, `ProjectsPage`, `ProjectPage`, `ConfirmDialog`, permissões, Guardian. |
| **Estender** | Tabela `projects`, `createProjectService`, IPC `projects:*`, `ProjectsPage`, seletores do Chat, histórico do Chat, `RagEngine`, `indexGit`, TaskEngine (fila e contexto), `contextProvider`. |
| **Novo** | Serviço de descoberta, classificador, overrides, tela de prévia, executor Git de escrita, fluxo "Novo Projeto", seleção de projetos na tarefa. |

## 3. Decisões

1. **Dois tipos gravados, quatro exibidos.** Grava-se `kind` (`project` ou `workspace`) e `parent_project_id`. Os quatro tipos pedidos são derivados e não podem divergir: Standalone (`project`, sem pai), Child (`project`, com pai), Workspace (`workspace`, sem pai), Nested Workspace (`workspace`, com pai). Um projeto real pode ter filhos, como `RNU`, sem deixar de ser projeto. Por isso `kind` indica se a pasta é só agrupadora.
2. **Sem coluna `workspaceId`.** É derivada da cadeia de pais. Guardá-la criaria outra fonte de verdade.
3. **Reaproveitar `stack` e `detected_at`.** Evita duplicar `detectedTechnology` e `lastScannedAt`.
4. **Descoberta nunca grava.** Só produz candidatos. Gravação só ocorre na confirmação da prévia. O texto "cadastrar automaticamente como candidatos" vale como pré-seleção na prévia.
5. **Evidência determinística.** IA nunca classifica. A pontuação usa a seção 5.
6. **Acesso total do workspace vale para toda a pasta (decisão do usuário, 2026-10-30).** Uma tarefa iniciada em um workspace com Acesso total roda como hoje, sem limite de caminho, e alcança todos os filhos, inclusive os de nível Padrão. Essa escolha substitui o requisito original de não ampliar permissões pelo workspace, apenas nesse caso. A regra de não herança continua nos demais: workspace sem Acesso total não amplia nada, tarefa iniciada em um filho usa só o nível do filho, o nível do filho nunca sobe para o workspace, e seleção de vários projetos em um workspace sem Acesso total usa o nível de cada um. A tela de confirmação do Acesso total, o aviso do Chat e a árvore de projetos informam que o nível alcança os projetos filhos. O nível gravado em cada filho não muda.
7. **Fila por raiz física.** A fila usa o caminho canônico, e duas tarefas bloqueiam uma à outra se uma raiz contiver a outra. Tarefa de leitura segue a regra da Fase 31.
8. **Dono único por arquivo no RAG.** Cada arquivo pertence ao projeto cadastrado mais profundo que o contém. O workspace indexa só arquivos soltos, excluindo as raízes dos filhos. A busca no workspace une os índices dos descendentes.
9. **Dono único por repositório.** A nova tabela `git_repositories` guarda `git_root` canônico, e commits são indexados uma vez, por repositório. Projetos no mesmo repositório filtram por caminho.
10. **Escrita Git separada.** `git.ts` continua somente leitura. Um módulo `git-write.ts`, com lista fechada (`init`, `clone`, sem shell), é usado só por ação explícita do usuário.
11. **Vínculo lógico.** Mover para outro workspace muda só `parent_project_id`. Nunca move arquivos. Desvincular nunca apaga arquivos nem memórias.
12. **Overrides por caminho canônico.** Decisões manuais ficam em `project_discovery_overrides`, porque pastas auxiliares não são projetos e não têm linha em `projects`.
13. **Compatibilidade.** Migração não muda IDs, nem vincula nada sozinha. Vínculos entre projetos já cadastrados, como `hepta` e `INS`, aparecem na prévia.

## 4. Modelo de dados

Migração prevista `0025_project_hierarchy`, a confirmar pela sequência real. Aditiva.

```sql
-- projects (novas colunas)
kind TEXT NOT NULL DEFAULT 'project',           -- project | workspace
parent_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
detection_confidence INTEGER,                   -- 0..100
detection_evidence TEXT,                        -- JSON
detection_source TEXT NOT NULL DEFAULT 'manual',-- manual | scan | migration
git_repository_id TEXT REFERENCES git_repositories(id) ON DELETE SET NULL;

CREATE TABLE git_repositories (
  id TEXT PRIMARY KEY,
  git_root TEXT NOT NULL UNIQUE,                -- canônico
  kind TEXT NOT NULL,                           -- repository | worktree | submodule
  last_verified_at TEXT
);

CREATE TABLE project_discovery_overrides (
  path TEXT PRIMARY KEY,                        -- canônico, minúsculo
  classification TEXT NOT NULL,
  parent_path TEXT,
  created_at TEXT NOT NULL
);
```

Sem pai, o projeto é `standalone`. Isso cobre todos os registros atuais. Ciclos são recusados em transação, subindo a cadeia antes de gravar.

## 5. Classificação

| Evidência | Pontos | Observação |
|---|---|---|
| Git validado com raiz na própria pasta | +60 | **Evidência principal.** `rev-parse --show-toplevel` igual à pasta canônica |
| `*.sln`, `*.slnx`, `*.csproj`, `*.fsproj`, `pom.xml`, `build.gradle*`, `Cargo.toml`, `go.mod`, `pyproject.toml` | +50 | |
| `package.json` com `name` ou `scripts` | +40 | |
| `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `go.work`, `settings.gradle*`, `global.json`, `Directory.Build.props` | +30 | Sinal de monorepo |
| `angular.json`, `vite.config.*`, `next.config.*`, `nuxt.config.*` | +20 | Identifica framework |
| `requirements.txt`, `setup.py`, `Pipfile` | +30 | |
| `yarn.lock`, `package-lock.json` sozinhos | +10 | |
| `README.md`, `Dockerfile`, `.git` inválido, configuração genérica | 0 | Nunca provam projeto |
| Só `*.sql`, ou maioria de arquivos de dados e documentos | −20 | Sinal de pasta auxiliar |
| Manifesto dentro de backup ou cópia, sem código-fonte nem Git | −30 | "Manifesto acidental" |

Faixas: `CONFIRMED_PROJECT` ≥ 60; `PROBABLE_PROJECT` de 30 a 59; `UNKNOWN` de 1 a 29; `AUXILIARY_DIRECTORY` ≤ 0. `WORKSPACE` quando há dois ou mais descendentes qualificados, sem manifesto próprio. Monorepo com manifesto raiz fica como projeto, com filhos sugeridos. Nomes de pasta nunca pontuam. Override do usuário sempre vence.

O catálogo é uma lista de `Detector { id, files, evaluate }`, para acrescentar tecnologias sem mudar o caminhante.

**Validação Git.** `.git` pode ser pasta ou arquivo. Comandos, pelo executor seguro: `rev-parse --is-inside-work-tree`, `--show-toplevel`, `--git-common-dir`, `--show-superproject-working-tree`. Isso distingue repositório, worktree e submódulo. Repositório recusado por `safe.directory` vira "não verificado", sem mudar configuração.

## 6. Serviço de descoberta

```ts
interface DiscoveryOptions { maxDepth: number; maxEntries: number; maxDurationMs: number } // padrão: 8, 200.000, 60 s
interface DiscoveryCandidate {
  path: string; relativePath: string; classification: Classification; confidence: number;
  evidence: { signal: string; detail: string; points: number }[];
  technologies: string[]; git: { root: string; kind: string; branch: string | null } | null;
  parentPath: string | null; existingProjectId: string | null; overridden: boolean;
}
interface DiscoveryReport { root: string; candidates: DiscoveryCandidate[]; skipped: { path: string; reason: string }[]; limited: boolean }
```

- **Caminhada assíncrona** com `opendir`, em lotes, cedendo ao laço de eventos, com `AbortSignal` e evento de progresso.
- **Links:** `lstat`; symlink e junction não são seguidos. Um conjunto de caminhos canônicos impede ciclos.
- **Ignorados:** `node_modules`, conteúdo de `.git`, `dist`, `build`, `bin`, `obj`, `.next`, `.nuxt`, `coverage`, `.venv`, `__pycache__`, temporários conhecidos. `backup`, `sql`, `docs` e `wiki` **são** percorridas.
- **Continuar dentro de projetos**, para achar repositórios aninhados (`RNU/.git`, `RNU/Ru`), respeitando os limites.
- **Monorepo:** membros de `workspaces`, `pnpm-workspace.yaml` e `.sln` viram filhos sugeridos, desmarcados por padrão, para não inflar a lista.
- **Somente leitura:** nunca instala, compila ou executa nada. Manifestos são lidos como texto, com limite de tamanho.
- **Erros:** pasta inacessível entra em `skipped`, sem abortar.
- **Incremental:** guarda `mtime` dos manifestos para reaproveitar classificações não alteradas.

## 7. Novo Projeto

| Opção | Comportamento |
|---|---|
| Criar independente | Nome, pasta, tecnologia, estrutura mínima, `git init`, `.gitignore`, cadastro |
| Criar dentro de workspace | Igual, com `parent_project_id` definido |
| Vincular existente | Usa `validateProjectRoot` e oferece descoberta |
| Clonar repositório | URL, destino, cadastro; sem submódulos automáticos |

Regras de `git-write.ts`:

- Antes de `init`, conferir `rev-parse --show-toplevel`. Se a pasta já estiver dentro de um repositório, **pedir confirmação explícita**, avisando sobre repositório aninhado. Pasta com `.git` válido nunca recebe `init`.
- A pasta de destino deve ser nova, ou vazia para `clone`. Nada é sobrescrito.
- `.gitignore` vem de modelos embutidos por tecnologia. Se já existir, é preservado.
- `clone` aceita `https` e `ssh`. Recusa `ext::`, `file://` e argumento iniciado por `-`, usa `--`, define `GIT_ALLOW_PROTOCOL=https:ssh` e `GIT_TERMINAL_PROMPT=0`, roda com `--template=` vazio e `core.hooksPath` desligado, tem tempo limite e é cancelável. Autenticação usa o que o Git do usuário já tiver. O app nunca recebe credenciais.
- Sem commit inicial automático, salvo decisão futura. O guia na tela informa isso.

## 8. Fluxo da descoberta

```mermaid
flowchart LR
  A[Usuário escolhe a pasta] --> B[validateProjectRoot]
  B --> C[Caminhada somente leitura]
  C --> D[Detectores e validação Git]
  D --> E[Classificação e overrides]
  E --> F[Prévia]
  F -->|confirmação| G[(projects, git_repositories, overrides)]
  G --> H[Chat, RAG, Git Intelligence]
```

## 9. Tarefa multiprojeto

```ts
interface TaskStartInput { /* ... */ projectId: string | null; participants?: string[] }
```

`projectId` continua sendo o projeto principal, e `participants` lista os demais. Sem `participants`, tudo se comporta como hoje para projetos independentes.

- **Contexto:** cada projeto entra identificado por nome e caminho. Referências de arquivo levam o projeto de origem. Regras de um projeto não valem para outro.
- **Citação por nome:** "backoffice e suporte-ms" é resolvido contra os filhos do workspace, por comparação exata, normalizada, sem IA. Resultado ambíguo pede escolha.
- **Memórias:** projetos privados continuam isolados, e o escopo MCP não se amplia por parentesco.
- **Guardian:** continua revisando os arquivos da tarefa, com `gitDiffFiles`.
- **Permissões:** seção 3, decisão 6. Em workspace com Acesso total, a tarefa roda na raiz, sem limite por projeto; a seleção de participantes define o contexto, não uma barreira de segurança.

## 10. Migração dos dados existentes

1. `0025` acrescenta colunas. Todos os projetos ficam como `project`, sem pai.
2. Nada de RAG, tarefas, memórias ou conversas muda.
3. Na primeira varredura de `hepta`, o `INS` aparece com `existingProjectId` e é sugerido como filho.
4. Ao confirmar `hepta` como workspace, a interface informa que a reindexação vai redistribuir o índice entre os filhos.
5. A redistribuição roda primeiro nos filhos e só depois limpa o workspace, para nunca ficar sem índice (H7).

## 11. Fora do escopo

Mover arquivos físicos, commit inicial automático, gerenciar credenciais Git, publicar repositório remoto, criar projetos a partir de templates de framework (`create-*`), classificação por IA.
