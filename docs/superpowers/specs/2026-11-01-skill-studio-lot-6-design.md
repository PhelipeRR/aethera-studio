# Lote 6 — Skill Studio: design técnico

## Intenção

Adicionar um Skill Studio visual ao Skills Manager para criar, editar, validar, importar, exportar e versionar skills sem edição manual de arquivos. O Studio será local-first, não executará conteúdo de skills e publicará somente após Trust Center, prévia e confirmação explícita.

## Objetivos

- Criar e editar `SKILL.md` compatível com o parser legado, mantendo `name`, `description` e corpo Markdown como formato portátil.
- Guardar campos exclusivos do NeuralBridge em `neuralbridge.skill.json`, separado do manifesto externo.
- Persistir drafts e versões em `app.getPath('userData')/skill-studio` com escrita atômica.
- Detectar alterações externas por fingerprint antes de salvar/publicar.
- Reutilizar Trust Center, Discovery, Recommendation e o instalador transacional existente.
- Expor somente operações tipadas por IPC; o renderer nunca recebe autorização para escrever filesystem.

## Fora do escopo

- Execução de instruções por Claude, Codex ou qualquer agente.
- Instalação por projeto: o IPC transacional atual só suporta publicação global gerenciada.
- Alteração do TaskEngine, Workflow Builder, Git Intelligence ou Fase 36.
- Refatoração integral de `skills.ts`.
- Limpeza automática de versões ou política definitiva de retenção.
- Pacotes ZIP/arquivos binários; o formato portátil desta etapa é um diretório com `SKILL.md`, sidecar e auxiliares textuais permitidos.

## Abordagens consideradas

1. **Filesystem-first (escolhida):** drafts, sidecars, versões e exports ficam sob `userData/skill-studio`; o serviço de domínio controla caminhos e chama o instalador transacional para publicar. Menor acoplamento, fácil inspeção e compatibilidade com o fluxo local-first.
2. **SQLite:** facilitaria consultas históricas, mas exigiria migração, armazenaria conteúdo não confiável no banco e duplicaria a fonte de verdade dos arquivos.
3. **Escrita direta pelo renderer:** rejeitada por quebrar a fronteira de segurança, permitir destinos arbitrários e contornar Trust Center/instalador.

## Modelo de armazenamento

```text
<userData>/skill-studio/
  drafts/<draftId>/SKILL.md
  drafts/<draftId>/neuralbridge.skill.json
  drafts/<draftId>/files/<auxiliares textuais>
  versions/<skillId>/<versionId>/SKILL.md
  versions/<skillId>/<versionId>/neuralbridge.skill.json
  versions/<skillId>/<versionId>/neuralbridge.version.json
  versions/<skillId>/<versionId>/files/<auxiliares textuais>
  versions/<skillId>/index.json
  exports/<skillId>-<versionId>/...
```

`managed-skills/<skillId>` continua sendo o destino global publicado. O Studio não escreve nesse destino: `publish` e `restore` criam a operação do instalador transacional com staging, fingerprint, lock, backup e journal.

## Contratos

Os contratos ficam em `packages/workspace/src/skills/contracts.ts`. `SkillMetadata` contém os campos editoriais; somente `name` e `description` entram no frontmatter. `SkillDraft` contém o conteúdo editável, auxiliares, origem, escopo e fingerprint-base. `SkillEditorState` combina draft, validação e prévia de confiança. `SkillVersion` identifica snapshots publicados/restaurados. `SkillChangeSet` é um diff determinístico por caminho e hash. `SkillExportResult` e `SkillImportPreview` tornam operações portáteis e auditáveis.

## Serviço de domínio

`createSkillStudioService({ root, managedRoot, journalRoot, stagingRoot })` é a única fronteira de filesystem do Studio. Ele oferece criação/abertura/salvamento de drafts, validação, publicação, histórico, comparação, restauração, prévia/importação, exportação e simulação determinística de recomendação. Entradas vindas do renderer são validadas por limites, caminhos relativos, symlinks, arquivos ocultos e extensões; nenhum conteúdo é executado.

Conflitos são rejeitados quando o fingerprint observado da origem ou do destino diverge do `baseFingerprint`. Salvar draft não altera Discovery nem `managed-skills`; somente publicar/restore atualiza a instalação global. O snapshot é preparado antes do commit para evitar falha de cópia depois da instalação; seu `neuralbridge.version.json` permite reconciliar o índice se o processo cair entre o commit e a persistência do índice. Versões antigas nunca são substituídas.

## IPC e UI

Novos canais `skills:studio:*` transportam apenas IDs, campos editoriais, caminhos de importação escolhidos pelo usuário, contexto de simulação e confirmações literais. O main deriva drafts, destinos e roots autorizados. O preload expõe métodos agrupados em `skills.studio`. A `SkillsPage` recebe uma área `Skill Studio` integrada, com editor, prévia Markdown, Trust Center, histórico/diff, import/export e simulação read-only, mantendo dark/light, teclado, foco visível, responsividade e reduced motion.

## Segurança

- Conteúdo de skill é dado não confiável; scripts e instruções são apenas texto.
- Trust Center é executado antes de publicar/importar e suas findings aparecem na prévia.
- `SKILL.md` é serializado somente com frontmatter suportado pelo parser atual.
- Paths são normalizados e confinados; symlinks, traversal, arquivos ocultos e limites excedidos bloqueiam a operação.
- Publicação/restauração usam o instalador transacional; não há segundo instalador.
- Alterações externas nunca são sobrescritas silenciosamente.

## Critérios de aceite do Lote 6

1. Criar, editar, salvar, reabrir e publicar uma skill global a partir do Studio.
2. Gerar `SKILL.md` válido e manter sidecar separado.
3. Exibir validação, preview Markdown e findings do Trust Center.
4. Listar, comparar e restaurar versões com confirmação.
5. Importar/exportar diretórios portáteis sem executar scripts.
6. Bloquear traversal, symlink, ocultos proibidos, conteúdo perigoso crítico e conflitos externos.
7. Refletir publicação no Discovery e permitir recomendação determinística da skill criada.
8. Passar testes unitários, IPC, integração, E2E do Studio, E2E transacional existente, typecheck, ESLint, build e `git diff --check`.

## Riscos residuais

- O escopo de publicação por projeto permanece explicitamente indisponível.
- A execução real assistida por agente continua sendo trabalho futuro.
- Retenção automática de versões e pacotes compactados ficam fora deste lote.
- A origem de uma skill editada externamente continua sujeita a conflito; o Studio prefere bloquear e exigir reabertura.
