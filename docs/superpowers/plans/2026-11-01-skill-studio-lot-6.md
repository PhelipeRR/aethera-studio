# Plano: Lote 6 — Skill Studio

> Execução nativa nesta sessão, sem commits. Cada tarefa segue RED → GREEN → REFACTOR e termina com seu teste específico.

## Requirements

- Criar, editar, salvar, validar, publicar, importar, exportar, versionar, comparar e restaurar skills globais.
- Manter `skills.ts`, contratos legados, segurança de conteúdo não confiável e instalação transacional.
- Usar filesystem-first sob `userData/skill-studio`, sidecar NeuralBridge e escrita atômica.
- Não escrever filesystem a partir do renderer, não executar scripts e não iniciar o Lote 7.
- Atualizar Discovery/Recommendation após publicação e preservar escopo global suportado.

## Review Focus

- Conteúdo com traversal, symlink, arquivo oculto ou script perigoso: deve bloquear ou advertir sem executar.
- Alteração externa entre abrir/salvar/publicar: deve resultar em conflito explícito e preservar o arquivo externo.
- Draft salvo sem publicar: não deve aparecer como skill instalada nem alterar preferências.
- Restore/import/export com nomes inválidos ou arquivos acima do limite: deve falhar sem escrita parcial.
- Reabertura do app após draft/version persistidos: deve recuperar estado sem depender de memória do processo.

## Arquivos e responsabilidades

- Create `packages/workspace/src/skills/studio.ts`: serviço de domínio filesystem-first, serialização, validação de paths, drafts, versões, import/export e simulação.
- Modify `packages/workspace/src/skills/contracts.ts`: contratos `SkillMetadata`, `SkillDraft`, `SkillEditorState`, `SkillValidationResult`, `SkillVersion`, `SkillChangeSet`, `SkillExportResult`, `SkillImportPreview`.
- Modify `packages/workspace/src/skills/index.ts`: exportar Studio.
- Modify `packages/shared/src/channels.ts`: canais, tipos de retorno e API preload.
- Modify `packages/shared/src/ipc.ts`: schemas Zod estritos dos canais Studio.
- Modify `apps/desktop/src/preload/index.ts`: bridge `skills.studio` sem acesso filesystem.
- Modify `apps/desktop/src/main/index.ts`: serviço por janela, handlers validados, root gerenciado e Discovery incluindo `managed-skills`.
- Create `packages/workspace/test/skills-studio.test.ts`: domínio, segurança, versionamento, import/export e recommendation.
- Create `tests/e2e/skills-studio.spec.ts`: fluxo Electron em diretório temporário, sem skills globais.
- Modify `apps/desktop/src/renderer/src/pages/SkillsPage.tsx`: área visual integrada e acessível.
- Modify `docs/PLAN.md`, `docs/STATUS.md`, `docs/plans/phase-41-skills-intelligence-studio.md`: evidências e limitações do Lote 6.

## Interfaces centrais

`createSkillStudioService(options)` recebe `root`, `managedRoot`, `journalRoot` e `stagingRoot` e produz métodos `createDraft`, `openSkill`, `getDraft`, `saveDraft`, `validateDraft`, `publishDraft`, `listVersions`, `compareVersions`, `restoreVersion`, `previewImport`, `importDraft` e `exportVersion`.

`SKILL.md` contém apenas frontmatter `name`/`description` e instruções Markdown; `neuralbridge.skill.json` contém objetivo, gatilhos, agentes, dependências, permissões, exemplos e metadados de origem/versionamento.

### Task 1: Contratos e serialização

**Test:** `packages/workspace/test/skills-studio.test.ts`

- [ ] RED: testar criação de metadata mínima, serialização/parsing round-trip e rejeição de nome/descrição vazios.
- [ ] Rodar `npx vitest run packages/workspace/test/skills-studio.test.ts`; esperar falha por exports ausentes.
- [ ] GREEN: adicionar contratos e helpers internos de serialização em `studio.ts` usando o parser legado para leitura.
- [ ] Rodar o teste; esperar os casos de contrato verdes.

### Task 2: Drafts, sidecar e conflitos

**Files:** `studio.ts`, `skills-studio.test.ts`

- [ ] RED: testar `createDraft`, `saveDraft`, `getDraft`, reabertura após nova instância e conflito quando `SKILL.md` externo muda.
- [ ] Implementar persistência atômica em `drafts/<id>` e fingerprint de árvore sem seguir symlinks.
- [ ] RED/GREEN: validar paths relativos, arquivos ocultos e limites; confirmar que salvar não cria destino em `managed-skills`.
- [ ] Refatorar somente após todos os testes verdes.

### Task 3: Trust Center, publicação transacional e versões

**Files:** `studio.ts`, `skills-studio.test.ts`

- [ ] RED: testar validação/finding do Trust Center, publicação global via instalador existente, criação de versão, listagem, diff e restore confirmado.
- [ ] Implementar `publishDraft`/`restoreVersion` chamando `createTransactionalSkillInstaller`; não duplicar staging, lock, backup ou journal.
- [ ] Testar falha de conteúdo perigoso crítico e conflito de destino sem sobrescrita.
- [ ] Confirmar que versões antigas permanecem no filesystem.

### Task 4: Importação, exportação e Recommendation

**Files:** `studio.ts`, `skills-studio.test.ts`

- [ ] RED: testar preview/import de diretório local, exportação portátil, symlink/traversal, arquivos ocultos e script inerte.
- [ ] Implementar `previewImport`, `importDraft` e `exportVersion` com Trust Center antes da cópia e diretório de exportação confinado.
- [ ] Construir candidato `DiscoveredSkill` somente em memória e verificar que Recommendation retorna explicação para skill criada.
- [ ] Rodar os testes dos Lotes 1–5 junto com o Studio.

### Task 5: IPC estrito, preload e integração main

**Files:** `channels.ts`, `ipc.ts`, `preload/index.ts`, `main/index.ts`, `packages/shared/test/ipc.test.ts`

- [ ] RED: adicionar casos de schema para campos válidos, `confirmed: true`, IDs, limites e rejeição de destinos arbitrários.
- [ ] Adicionar canais `skills:studio:create/open/get/save/validate/publish/versions/compare/restore/import-preview/import/export` com schemas estritos.
- [ ] Registrar handlers que resolvem roots no main, incluindo `managed-skills` no inventário sem remover raízes existentes.
- [ ] Exportar somente funções tipadas no preload e rodar testes IPC.

### Task 6: Skill Studio visual

**Files:** `SkillsPage.tsx`, `skills-studio.spec.ts`

- [ ] RED: E2E deve criar draft, preencher metadados/instruções, salvar, recarregar, validar, exibir preview e Trust Center.
- [ ] Implementar seção integrada com editor, preview Markdown, diagnóstico, histórico/diff, import/export e confirmação de publish/restore.
- [ ] RED/GREEN: E2E deve provar que salvar não publica, publish atualiza listagem, import inseguro é bloqueado e conflito exige reabertura.
- [ ] Verificar dark/light, teclado, foco, responsividade e reduced motion sem alterar identidade visual.

### Task 7: Documentação e gates finais

- [ ] Atualizar os três documentos da Fase 41 com arquitetura, contratos, fluxos, testes, limitações e risco residual.
- [ ] Rodar `npx vitest run packages/workspace/test/skills-studio.test.ts packages/workspace/test/skills-*.test.ts packages/shared/test/ipc.test.ts`.
- [ ] Gerar build novo e rodar `npx playwright test tests/e2e/skills.spec.ts tests/e2e/skills-transactional.spec.ts tests/e2e/skills-transactional-full.spec.ts tests/e2e/skills-studio.spec.ts --workers=1`.
- [ ] Rodar `npm run typecheck`, `npm run lint`, `npm run build` e `git diff --check`.
- [ ] Conferir `git status`/diff, preservar alterações concorrentes e não criar commit.

## Self-review

O plano cobre criação/edição, serialização, validação/Trust Center, versionamento/diff/restore, import/export, simulação segura, Discovery/Recommendation, IPC/preload/main, UI, E2E e gates. O cancelamento durante commit, execução real por agente, escopo projeto e ZIP foram mantidos como limitações explícitas, sem simular suporte inexistente.
