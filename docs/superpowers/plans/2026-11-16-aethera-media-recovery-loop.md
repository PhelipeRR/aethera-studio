# Plan: Aethera Media Recovery Loop

**Goal:** Transformar as falhas de cobertura audiovisual em um ciclo finito, rastreável e orientado por intervalos, preservando arquivos já baixados e mantendo a distinção entre contexto editorial e footage comprovado.

**Architecture:** O `StagedCinemaPipeline` continua sendo o único coordenador. O `packages/cinema` fornecerá o modelo puro de gaps, a geração de consultas e a política de recuperação; `runAutonomousMediaAcquisition` executará as rodadas usando as fontes existentes; o pipeline persistirá tentativas, decisões, alternativas e o encaminhamento para revisão humana no job/auditoria. Não será criado um segundo motor.

**Tech stack:** TypeScript estrito, Vitest, Electron main, FFmpeg nos testes E2E existentes, contratos serializáveis compatíveis com os jobs persistidos.

**Spec:**

- Um gap deve identificar `segmentId`, intervalo temporal faltante na timeline, segundos faltantes, mídia/intervalos já comprovados e motivo da ausência.
- Consultas de recuperação devem ser específicas ao gap (entidade, obra, acontecimento, natureza visual e intervalo), deduplicadas e limitadas por orçamento.
- Cada rodada deve registrar fontes consultadas, tentativa, resultado e motivo de exaustão. Uma rodada posterior pode usar outra fonte ou reformular a consulta, mas nunca repetir a mesma assinatura sem nova entrada.
- Apenas intervalos retornados pelo Scene Grounding podem alimentar cobertura e montagem. Nenhum intervalo é estendido para preencher a duração da cena.
- Alternativas `contextual`/`explanatory_graphic` devem ser propostas explicitamente e nunca virar footage comprovado.
- A auditoria de recuperação deve reavaliar somente as cenas afetadas; decisões anteriores e arquivos físicos permanecem disponíveis para inspeção/reuso.
- Após esgotar as tentativas, o job fica `paused_pending_media` com os gaps exatos, tentativas, alternativas editoriais e próxima ação humana.
- O painel deve exibir separadamente mídia identificada, mídia editorialmente aprovada e segundos comprovados, incluindo os gaps pendentes.
- O E2E deve ter dois resultados válidos: (a) mídia insuficiente => `paused_pending_media`; (b) fontes determinísticas com evidência visual suficiente => `editor` e MP4 válido usando apenas intervalos comprovados.
- O Contrato de Produção Inteligente é uma frente aditiva separada: o rascunho `docs/superpowers/specs/2026-11-16-production-contract-design.md` continua não integrado até que haja entidade persistida, sincronização de controles/prompt, evidência por requisito e teste de conflito.

**Global constraints:** Preservar alterações de outras sessões e arquivos baixados; não afrouxar o Scene Grounding; não contar cartões de texto como prova visual; não apagar dados; não fazer push; adicionar migrations somente se a implementação real exigir persistência fora do job JSON.

**Review focus:** geometria dos intervalos e ausência de extrapolação; separação dos status editoriais; escopo de reauditoria; limite de tentativas; compatibilidade com checkpoints e jobs antigos; E2E real com MP4.

## Tasks

### Task 1: Modelar gaps e recuperação como contratos puros

**Files:** `packages/cinema/src/analysis/media-coverage-planner.ts`, novo teste em `packages/cinema/test/media-recovery-loop.test.ts`.

- [x] **Step 1: Red — escrever testes** para complemento de intervalos na timeline, gaps sem mídia, gaps parciais, consultas orientadas ao evento e distinção contextual/footage.
- [x] **Step 2: Verify RED** executando somente o teste novo.
- [x] **Step 3: Green — implementar** `MediaCoverageGap`/`MediaRecoveryPlan` e expor gaps exatos no `MediaCoverageReport`, sem alterar a contagem dos intervalos comprovados.
- [x] **Step 4: Verify GREEN** com `media-recovery-loop.test.ts` e `media-relevance-coverage-voice.test.ts` (25/25).
- [ ] **Step 5: Commit** será feito junto do lote integrado, após seleção dos hunks próprios em arquivos compartilhados.

### Task 2: Executar rodadas de recuperação multifonte

**Files:** `packages/cinema/src/analysis/resilient-media-sources.ts`, seus testes de aquisição e o teste novo do loop.

- [x] **Step 1: Red — testar** reformulação por gap, rotação de fontes, deduplicação de assinaturas e limite de tentativas.
- [x] **Step 2: Verify RED**.
- [x] **Step 3: Green — integrar** o plano de gaps ao alvo de cada rodada, registrar `recoveryAttempts`, `affectedSegmentIds`, fontes alternativas e alternativas editoriais; reutilizar somente intervalos aprovados.
- [x] **Step 4: Verify GREEN** com regressão de aquisição, checkpoint e os quatro casos reais de Scene Grounding v3 já cobertos.
- [ ] **Step 5: Commit** será feito junto do lote integrado, após seleção dos hunks próprios em arquivos compartilhados.

### Task 3: Integrar recuperação no pipeline e na revisão humana

**Files:** `apps/aethera-desktop/src/main/cinema-pipeline.ts`, contratos IPC/painel de revisão somente se necessário, testes de pipeline.

- [x] **Step 1: Red — testar** que uma tentativa de recuperação audita somente cenas afetadas, mantém mídia anterior e pausa com gaps/alternativas após exaustão.
- [x] **Step 2: Verify RED**.
- [x] **Step 3: Green — persistir** histórico do loop no job, alimentar `pendingMedia` por gap real, encaminhar para `resolvePendingMedia`/revisão humana e impedir montagem automática baseada em contexto.
- [x] **Step 4: Verify GREEN** com staged pipeline, retomada e E2E negativo.
- [ ] **Step 5: Commit** será feito junto do lote integrado, após seleção dos hunks próprios em arquivos compartilhados.

### Task 4: Atualizar painel de cobertura e controles de recuperação

**Files:** painéis Aethera que exibem auditoria/cobertura, contratos compartilhados se necessário, testes de renderer/typecheck.

- [x] **Step 1: Red — testar** a presença dos três números (identificada, aprovada, segundos comprovados), gaps por intervalo e próxima ação humana.
- [x] **Step 2: Verify RED**.
- [x] **Step 3: Green — renderizar** o estado persistido sem misturar `contextual` com footage.
- [x] **Step 4: Verify GREEN** com typecheck web aprovado e testes focados.
- [ ] **Step 5: Commit** será feito junto do lote integrado, após seleção dos hunks próprios em arquivos compartilhados.

### Task 5: Fechar regressão E2E e auditar o Contrato de Produção Inteligente

**Files:** `apps/aethera-desktop/test/scene-grounding-e2e.test.ts`, novo teste de contrato/integração se a auditoria confirmar uma lacuna implementável no escopo, documentação de status.

- [x] **Step 1: Red — atualizar** o E2E para aceitar `paused_pending_media` no caso insuficiente e adicionar um cenário completo com fontes comprovadas que chega ao editor e gera MP4 válido.
- [x] **Step 2: Verify RED** usando a expectativa antiga (`editor`) contra o novo gate.
- [x] **Step 3: Green — ajustar** fixtures/adapters determinísticos sem relaxar thresholds ou transformar gráficos em prova.
- [x] **Step 4: Verify GREEN**: E2E Scene Grounding 1/1, suíte focada 34/34, typecheck web aprovado; typecheck node permanece bloqueado por erros preexistentes da implementação concorrente do Contrato de Produção.
- [x] **Step 5: Reportar** separadamente o estado do Contrato de Produção Inteligente: já há integração parcial não pertencente a este lote; persistem erros de tipo e a validação completa do contrato fica como dependência posterior.
- [ ] **Step 6: Commit** será feito após seleção dos hunks próprios; push não será feito.
