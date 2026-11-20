# Aethera Recap — Plano Mestre

Pipeline de transformação de mangá/manhwa/webtoon em roteiros narrativos validados para produção audiovisual.

**Status atual:** Fase 2.1 concluída. Fase 2.2 (2.2.1–2.2.3) implementada em código; Fase 2.2.4 com correções estruturais aplicadas e script E2E pronto, pendente execução ao vivo com agentes autenticados e suíte de testes.

**⚠️ Correção arquitetural (2026-11-20):** O Aethera Recap **não está vinculado ao Claude CLI, ao modelo claude-opus-5-5 ou a qualquer provedor específico**. Claude/claude-opus-5-5 foi utilizado apenas como evidência histórica do primeiro teste E2E multimodal real da Fase 2.1. Em produção, o Recap utiliza descoberta dinâmica de agentes via VisionRouter + TaskEngine, com fallback automático entre todos os provedores disponíveis. Ver seção [Arquitetura Multiagente](#arquitetura-multiagente) abaixo.

---

## Arquitetura Multiagente

### Princípios

1. **Descoberta dinâmica:** todos os agentes e provedores configurados no Aethera são descobertos em runtime via `createVisionProviders()` e `TaskEngine.availability()`. Nenhuma lista fixa de modelos ou agentes é hardcoded no Recap.
2. **Reuso de infraestrutura:** TaskEngine, AgentAdapter, VisionRouter e mecanismos existentes de seleção/fallback são reutilizados sem duplicação.
3. **Seleção por capacidade:** o agente é selecionado conforme a capacidade exigida (visão multimodal, OCR, geração de roteiro, humanização, pesquisa, validação editorial), não por nome.
4. **Verificação prévia:** disponibilidade e autenticação são verificadas antes de encaminhar tarefas (`provider.detect()` + `checkAvailable()`).
5. **Fallback automático:** quando houver falha, timeout, indisponibilidade ou incompatibilidade de capacidade, o VisionRouter tenta o próximo provider na cadeia de prioridade.
6. **Configurabilidade:** prioridades, custos, limites e modelos preferenciais são configuráveis via `VisionPolicy` e `VisionRouterConfig`.
7. **Resiliência mínima:** apenas um agente disponível que suporte todas as capacidades necessárias é suficiente para executar o fluxo completo.
8. **Falha explícita:** quando nenhuma opção suportar uma capacidade obrigatória, o sistema retorna erro claro ou solicita revisão humana — nunca fabrica resultados.
9. **Telemetria completa:** agente, provedor, modelo efetivo, tentativas, motivo do fallback, tempo e custo são registrados em cada etapa.
10. **Checkpoints preservados:** etapas concluídas não são repetidas após fallback ou retomada.
11. **Anti-loop:** alternância infinita entre agentes é prevenida por `maxAttempts` e cooldowns no VisionRouter.
12. **Fase 2.2 compatível:** Humanize e YouTube Agent utilizarão a mesma infraestrutura multiagente.
13. **Compatibilidade futura:** MotionVelix, TTS, legendas, SFX e VFX herdarão a mesma arquitetura.

### Matriz de Agentes e Capacidades

| Agente/Provider | Visão Multimodal (`analyze`) | Classificação (`classify`) | Descrição (`describe`) | OCR | Geração de Roteiro | Humanização | Pesquisa Web | Integração TaskEngine | Status no Desktop |
|---|---|---|---|---|---|---|---|---|---|
| **Claude CLI** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (via agent) | ✅ `createTaskEngineVisionProvider` | ✅ Autenticado OAuth |
| **Codex CLI** | ❌ (sem `analyze`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (web search nativo) | ✅ `createTaskEngineVisionProvider` | ✅ Detectado |
| **Antigravity CLI** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (via agent) | ⚠️ Via `createAntigravityCliVisionProvider` (não usa TaskEngine diretamente) | ✅ Integrado no desktop |
| **Claude Gateway** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `createTaskEngineVisionProvider` | ⚠️ Requer token configurado |
| **Local VLM (Ollama)** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ (provider direto) | ✅ `createOllamaLocalVlmProvider` |
| **Local SigLIP** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (embedding only) | ⚠️ Requer modelo instalado |
| **FFmpeg Heuristics** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ (determinístico) | ✅ Sempre disponível |

### Cadeia de Prioridade Padrão

A cadeia é configurável via `VisionPolicy.chain`. A ordem padrão no desktop (`aethera-ipc.ts:1249`) é:

```
['local-vlm', 'antigravity', 'claude', 'codex', 'local-siglip', 'ffmpeg-heuristics']
```

O VisionRouter aplica reordenação dinâmica baseada em:
- **Prioridade configurada** (`VisionRouterConfig.priority`).
- **Histórico de timeouts:** providers com timeouts recentes são movidos para o final da fila (`prioritizedChain()` em `vision-router.ts:160-173`).
- **Cooldowns:** providers em cooldown por quota ou timeout são pulados com registro de tentativa (`checkProvidersHealth()` em `vision-router.ts:82-97`).
- **Capacidade requerida:** se a operação exige `analyze` e o provider não suporta, ele é pulado automaticamente.

### Estratégias de Fallback

| Cenário | Comportamento | Limite |
|---|---|---|
| Provider indisponível (`detect()` falha) | Pula para o próximo na cadeia | Por chamada |
| Timeout do provider | Registra tentativa, aplica cooldown, tenta próximo | `perProviderTimeoutMs` por provider |
| Quota esgotada | Cooldown prolongado, tenta próximo | `budgetUsd` na policy |
| Capacidade não suportada | Pula silenciosamente, tenta próximo | Por operação |
| Todos os providers falham | Retorna `value: null` com telemetria completa; adapter retorna confiança 0 | `maxAttempts` na config |
| Erro de path (fora do root) | Falha imediata com erro explícito, sem fallback | Segurança |
| Buffer input | Escrita temporária em `.recap-vision-tmp/` dentro do root | Automático |

### Hardcodes Identificados e Correções Propostas

| Localização | Hardcode | Impacto | Correção Proposta |
|---|---|---|---|
| `recap-vision-adapter.ts:202` | `policyChain = ['claude', 'codex', 'local-vlm', 'antigravity']` | Default favorece Claude/Codex | Remover default; exigir cadeia explícita ou herdar do VisionRouter ativo |
| `shared/src/domain.ts:40` | `AGENT_IDS = ['claude', 'codex']` | Tipo `AgentId` exclui Antigravity | Expandir para incluir `'antigravity'` ou tornar extensível |
| `vision-providers.ts:192-193` | Codex/Claude sem `analyze` na registry | Registry desatualizada vs implementação real | Atualizar capabilities para refletir `createTaskEngineVisionProvider` real |
| Script E2E live | `id: 'claude'` hardcoded | Teste vinculado a Claude | Parametrizar agente via variável de ambiente `NB_RECAP_E2E_AGENT` |

### Lacunas da Integração Antigravity

O Antigravity CLI possui integração funcional via `createAntigravityCliVisionProvider` (`vision-providers.ts:312-399`), mas **não usa o TaskEngine diretamente** — executa via `runPrompt` personalizado com detecção própria (`detectAntigravityCli`). Isso significa:

- ✅ Funciona como provider no VisionRouter com fallback.
- ✅ Suporta todas as capacidades de visão (`classify`, `describe`, `ocr`, `analyze`).
- ⚠️ Não compartilha sessões, quotas ou telemetria unificada do TaskEngine.
- ⚠️ Autenticação e gerenciamento de credenciais são independentes.

**Proposta para Fase 2.2:** Criar `createTaskEngineAntigravityProvider` análogo aos providers Claude/Codex, unificando a infraestrutura de execução.

---

## Roadmap

| Fase | Objetivo | Estado | Dependências |
|---|---|---|---|
| **Fase 1** | Importação e extração de painéis | ✅ Concluída | — |
| **Fase 2** | Story Engine (análise narrativa + roteiro) | ✅ Concluída | Fase 1 |
| **Fase 2.1** | Integração multimodal real (RecapVisionAdapter) | ✅ Concluída | Fase 2 |
| **Fase 2.2** | Narrative Enhancement (Humanize + YouTube Agent) | 📋 Planejada | Fase 2.1 |
| **Fase 3** | MotionVelix (motion graphics a partir do roteiro) | 📋 Planejada | Fase 2.2 + teste narrativo real |
| **Fase 4** | Produção audiovisual (TTS, legendas, SFX, VFX) | 📋 Planejada | Fase 3 |
| **Fase 5** | Revisão inteligente (QC multi-pass, reparo) | 📋 Planejada | Fase 4 |

**Gate obrigatório antes da Fase 3:** teste narrativo com painéis sequenciais reais, personagens recorrentes e Gate G validado.

---

## Fase 1 — Importação e Extração ✅

**Arquivos:** `packages/cinema/src/recap/chapter-importer.ts`, `panel-extractor.ts`, `pdf-import-adapter.ts`, `tesseract-ocr-adapter.ts`, `gate-f-panel-integrity.ts`

**Entregas:**
- Importação de capítulos a partir de PDF, CBZ, ZIP ou pasta de imagens.
- Extração de painéis com bounding box, classificação (dialogue/action/splash/transition/establishing) e hash SHA-256.
- OCR via Tesseract com status explícito (`not_run`/`success`/`failed`) e confiança.
- Suporte a ordens de leitura RTL, LTR e vertical (manhwa/webtoon).
- Gate F de integridade dos painéis extraídos.
- Checkpoint persistence para retomada segura.

**Testes:** `packages/cinema/test/recap-phase1.test.ts`, `recap-phase1-pending.test.ts`

---

## Fase 2 — Story Engine ✅

**Arquivos:** `packages/cinema/src/recap/narrative-analyzer.ts`, `story-continuity-engine.ts`, `script-generator.ts`, `gate-g-narrative-fidelity.ts`, `story-engine.ts`

**Entregas:**
- Narrative Analyzer: consome VisionAdapter + OcrAdapter, produz PanelAnalysis com evidências explícitas (visual_observation, ocr_text) e confiança.
- Story Continuity Engine: agrupa análises em NarrativeSequence de StoryBeats respeitando ordem de leitura.
- Script Generator: gera RecapScript com Scenes referenciando painéis originais, em PT-BR, nos estilos narrative_recap/cinematic_recap/mystery/suspense/documentary.
- Gate G: valida fidelidade narrativa (missing_panel_reference, invalid_image_path, invented_event, character_inconsistency, narrative_gap, order_violation, low_confidence, unresolved_ambiguity).
- Orquestrador completo: Panels → Analysis → Continuity → Script → Gate G.

**Testes:** `packages/cinema/test/recap-phase2.test.ts` (48 testes)

---

## Fase 2.1 — Integração Multimodal Real ✅

**Conclusão:** 2026-11-20

### Evidências da execução real

| Critério | Resultado |
|---|---|
| Provider | Claude CLI (OAuth autenticado) |
| Modelo reportado | claude-opus-5-5 |
| Painéis analisados | 4 imagens reais (abacaxi, bala, capim, formiga) |
| Tempo total | 201,8 segundos (~33s/painel) |
| Confiança média | 0,93–0,96 por painel |
| Beats narrativos | 2 |
| Cenas geradas | 2 |
| Gate G | **PASS** (0 warnings, 0 hints) |
| Warnings totais | 0 |

### Arquitetura implementada

- **RecapVisionAdapter** (`packages/cinema/src/recap/recap-vision-adapter.ts`): bridge entre `VisionAdapter` (Cinema) e `VisualAnalysisProvider`/`VisionRouter` (Orchestrator).
  - Validação de path contra root autorizado (`realpathSync` + `relative`).
  - Suporte a Buffer (escrita temporária em `.recap-vision-tmp/` dentro do root).
  - Telemetria completa: provider, model, reportedModel, costUsd, attempts.
  - Fallback graceful: zero confidence em falhas, nunca fabrica resultados.
  - Funciona com provider único ou VisionRouter com cadeia de fallback.
- **Integração TaskEngine**: reutiliza `createTaskEngineVisionProvider` existente, sem duplicar provedores ou exigir novas credenciais.
- **Script E2E live** (`scripts/e2e-recap-vision-live.mts`): instancia TaskEngine fora do Electron com SQLite temporário, executa pipeline completo com Claude CLI real.

### Evidências visuais extraídas pelo Claude

- **panel-0** (abacaxi): "cubo de polpa de abacaxi dourado e fibroso, fotografado em estilo de produto recortado sobre fundo preto sólido" — setting: "fundo preto sólido (#000000) sem gradiente ou textura"
- **panel-1** (bala): "doce redondo com padrão espiralado verde e branco sobre fundo preto sólido, iluminado para destacar textura brilhante"
- **panel-2** (capim): "maço de capim-limão sobre fundo preto sólido, com talos claros e folhas verdes amarrados por barbante"
- **panel-3** (formiga): "postura de caminhada/atitude defensiva com antenas e mandíbulas orientadas para frente" — action tipo `interaction`

### Testes

- 8/8 testes E2E do adapter (`packages/cinema/test/recap-vision-adapter-e2e.test.ts`).
- Typecheck limpo (`tsc --noEmit`).
- 48 testes das Fases 1 e 2 preservados.

### Pendências de robustez

- [ ] Validação com sequência real de mangá/manhwa (painéis narrativos sequenciais, não imagens isoladas).
- [ ] Continuidade de personagens e diálogos entre painéis consecutivos.
- [ ] Otimização de desempenho e cache de análises visuais (atualmente ~33s/painel).
- [ ] Limpeza segura dos arquivos temporários (`.recap-vision-tmp/`).
- [ ] Testes contra interpretações visuais incorretas (hallucination detection).
- [ ] Integração IPC no desktop (canal `recap:*` para UI).

---

## Fase 2.2 — Narrative Enhancement 📋 Planejada

**Depende de:** Fase 2.1  
**Bloqueia:** Fase 3

### 2.2.1 — Humanize

Integrar a skill Humanize à geração de roteiros do Aethera Recap.

**Objetivos:**
- Melhorar naturalidade e fluidez da narração em português brasileiro.
- Evitar linguagem robótica e repetições.
- Melhorar transições entre cenas e acontecimentos.
- Preservar fatos, personagens, diálogos e ordem cronológica.
- Manter os estilos narrative, cinematic, mystery, suspense e documentary.
- Preservar duração estimada, orçamento de palavras e intenção emocional.
- Manter referências entre cenas e painéis originais.
- Impedir invenção de acontecimentos ou diálogos.
- Executar Gate G novamente após a humanização.
- Permitir ativação/desativação e fallback para o gerador atual.

**Investigação de reuso:** Não existe implementação de Humanize no codebase atual (`packages/`, `.agents/skills/`, `.claude/skills/`). A skill precisa ser criada como componente compartilhado entre Aethera Studio e Aethera Recap, utilizando o TaskEngine para invocação via agente (Claude/Codex/Antigravity).

### 2.2.2 — YouTube Agent Skill

Adicionar a skill YouTube Agent como recurso opcional de pesquisa contextual.

**Objetivos:**
- Pesquisar informações oficiais e referências sobre personagens, obras e acontecimentos.
- Complementar o contexto editorial quando necessário.
- Distinguir informações externas da história demonstrada pelos painéis.
- Evitar spoilers de capítulos posteriores sem autorização.
- Não transformar teorias em fatos.
- Não substituir os painéis originais por vídeos externos.
- Preservar fontes e referências.
- Reutilizar os mecanismos de pesquisa existentes no Aethera Studio.
- Permitir funcionamento integral do Recap sem a skill.

**Componentes reutilizáveis identificados:**
- `packages/orchestrator/src/video-research.ts`: `runVideoResearch()`, `videoResearchPrompt()`, `parseVideoResearch()` — pesquisa de vídeo via agente com parsing estruturado.
- `packages/orchestrator/src/aethera/web-confirmation.ts`: `fetchPublicPage()` — busca de páginas públicas com signal/abort.
- `packages/orchestrator/src/aethera/game-sources.ts`: IGDB/RAWG clients (para personagens/obras de jogos).
- TaskEngine + VisionRouter: infraestrutura de agentes e fallback já integrada.

### 2.2.3 — Arquitetura Compartilhada

**Requisitos:**
- Não duplicar implementações entre Aethera Studio e Aethera Recap.
- Reutilizar Orchestrator, TaskEngine e provedores existentes.
- Investigar origem, licenças e dependências das skills Humanize e YouTube Agent.
- Não adicionar novas credenciais obrigatórias sem necessidade.
- Garantir execução com apenas Claude Code, Codex ou Antigravity disponível.
- Preservar checkpoints e mecanismos de fallback.

**Decisão pendente:** As skills Humanize e YouTube Agent devem ser implementadas como módulos em `packages/orchestrator/src/` (compartilhados) ou como skills independentes em `.agents/skills/`? A recomendação é `packages/orchestrator/src/recap-enhancement/` para garantir type safety e integração direta com o TaskEngine.

### 2.2.4 — Validação Editorial (Em andamento — código atualizado em 2026-11-20)

**Implementações e correções aplicadas:**
- Persistência e reutilização de `panelAnalyses` + `analysisCacheByHash` no checkpoint (`recap-types.ts`, `narrative-analyzer.ts`, `story-engine.ts`), evitando reprocessamento de painéis já analisados.
- Concorrência limitada configurável (`analysisConcurrency` 1..4) preservando estritamente a ordem de leitura.
- `createMultiAgentVideoResearchPortAdapter` (`contextual-research.ts`) com detecção dinâmica (`detect()`) e fallback real entre agentes compatíveis para `runVideoResearch()`.
- Preservação de personagens nomeados no `narrative-humanizer.ts` e relatório comparativo `buildGateGDivergenceReport` (`gate-g-narrative-fidelity.ts`, `story-engine.ts`).
- Correção do registry em `vision-providers.ts` incluindo capacidade `'analyze'` para `claude` e `codex`.
- Script E2E dedicado: `scripts/e2e-recap-phase224.mts` para `tests/fixtures/real-manga/Nano-Machine-Capitulo-01.cbz` (24 páginas `.webp` validadas por CRC `testzip`).
- Testes adicionados em `packages/cinema/test/recap/phase224-enhancements.test.ts`.

**Pendências para encerramento da Fase 2.2.4:**
- Executar `tsc --noEmit` e `vitest` no ambiente com `node_modules` instalados.
- Executar `npx tsx scripts/e2e-recap-phase224.mts` com agente autenticado (Claude CLI / Claude Gateway / Codex) para coletar métricas reais de tempo, confiança média, roteiro original vs. humanizado e veredictos Gate G pré/pós-humanização.

### 2.2.5 — Testes Previstos

- [ ] Preservação de fatos e personagens após humanização.
- [ ] Naturalidade da narração (métrica qualitativa + comparação A/B).
- [ ] Controle de duração (desvio ≤ 10% do estimado).
- [ ] Detecção de alucinações (Gate G pós-humanização).
- [ ] Gate G após Humanize (verdict pass/needs_review/fail).
- [ ] Funcionamento com ambas as skills desativadas (fallback ao gerador atual).
- [ ] Fallback em caso de falha do agente (zero confidence, não fabricação).
- [ ] Execução com um único agente disponível.
- [ ] Persistência e retomada por checkpoint.
- [ ] Compatibilidade futura com MotionVelix, TTS, legendas, SFX e VFX.

---

## Fase 3 — MotionVelix 📋 Planejada

**Depende de:** Fase 2.2 + teste narrativo real com painéis sequenciais  
**Gate obrigatório:** Sequência real de mangá/manhwa com personagens recorrentes e Gate G validado.

Transformar o RecapScript validado em motion graphics via MotionVelix skill.

---

## Fase 4 — Produção Audiovisual 📋 Planejada

**Depende de:** Fase 3

- TTS (ElevenLabs / SAPI).
- Legendas sincronizadas.
- SFX semânticos.
- VFX e color grading.
- Mixagem EBU R128.

---

## Fase 5 — Revisão Inteligente 📋 Planejada

**Depende de:** Fase 4

- QC multi-pass (técnico + narrativo + visual).
- Reparo direcionado com cache incremental.
- Supervisor autônomo com anti-loop.
- Sala de Revisão para aprovação humana.

---

## Arquivos Principais

| Componente | Localização |
|---|---|
| Tipos e schemas | `packages/cinema/src/recap/recap-types.ts` |
| Importação | `packages/cinema/src/recap/chapter-importer.ts` |
| Extração | `packages/cinema/src/recap/panel-extractor.ts` |
| OCR | `packages/cinema/src/recap/tesseract-ocr-adapter.ts` |
| Análise narrativa | `packages/cinema/src/recap/narrative-analyzer.ts` |
| Continuidade | `packages/cinema/src/recap/story-continuity-engine.ts` |
| Geração de roteiro | `packages/cinema/src/recap/script-generator.ts` |
| Gate G | `packages/cinema/src/recap/gate-g-narrative-fidelity.ts` |
| Orquestrador | `packages/cinema/src/recap/story-engine.ts` |
| Vision Adapter Bridge | `packages/cinema/src/recap/recap-vision-adapter.ts` |
| Checkpoints | `packages/cinema/src/recap/checkpoint-persistence.ts` |
| Exports públicos | `packages/cinema/src/recap/index.ts` |
| Script E2E live | `scripts/e2e-recap-vision-live.mts` |
| Testes Fase 1 | `packages/cinema/test/recap-phase1.test.ts` |
| Testes Fase 2 | `packages/cinema/test/recap-phase2.test.ts` |
| Testes Adapter E2E | `packages/cinema/test/recap-vision-adapter-e2e.test.ts` |

## Infraestrutura Reutilizada do Aethera Studio

| Componente | Origem | Uso no Recap |
|---|---|---|
| TaskEngine | `packages/orchestrator/src/engine.ts` | Execução de agentes read-only com schema |
| VisualAnalysisProvider | `packages/orchestrator/src/aethera/vision-router.ts` | Interface de análise visual multimodal |
| createTaskEngineVisionProvider | `packages/orchestrator/src/aethera/vision-providers.ts` | Provider Claude/Codex via TaskEngine |
| VisionRouter | `packages/orchestrator/src/aethera/vision-router.ts` | Fallback chain entre providers |
| fetchPublicPage | `packages/orchestrator/src/aethera/web-confirmation.ts` | Pesquisa web para YouTube Agent |
| runVideoResearch | `packages/orchestrator/src/video-research.ts` | Pesquisa de vídeo contextual |
| AgentAdapter (Claude/Codex) | `packages/agents/src/` | Autenticação e execução de CLIs |
| SegmentAnalysis schema | `packages/shared/src/aethera-visual-analysis.ts` | Schema de análise visual estruturada |