# SEP-2026-01 — Auditoria e Baseline (SEP-01)

**Repositório auditado:** `c:\dev\neuralbridge-studio` (branch `feat/aethera-studio`)  
**Status:** SEP-01 concluída (inventário e pontos de corte mapeados; nenhuma exclusão ou movimentação destrutiva executada).

---

## 1. Inventário real do repositório

### 1.1 Aplicativos (`apps/`)
- `apps/desktop` — aplicativo Electron único atual (`appId: com.neuralbridge.desktop`, `productName: Singularity`, `executableName: NeuralBridge`).
- `apps/mobile` — cliente móvel / companion.

### 1.2 Pacotes (`packages/`) e propriedade de domínio

| Pacote | Domínio proprietário | Observação de corte |
|---|---|---|
| `packages/agents` | **Singularity Orchestrator** (compartilhado por contrato) | Adaptadores `ClaudeCliAdapter` e `CodexCliAdapter`. |
| `packages/brain` | **Singularity Orchestrator** | Memória de trabalho, busca híbrida e RAG. |
| `packages/mcp-server` | **Singularity Orchestrator** | Servidor MCP e exposição de ferramentas. |
| `packages/core` | **Singularity Orchestrator** | Núcleo de execução e serviço standalone. |
| `packages/local-worker` | **Singularity Orchestrator / Aethera** | Worker local de tarefas; na separação cada app mantém seu próprio ciclo de vida de worker. |
| `packages/orchestrator` | **Misto (ponto principal de corte)** | Contém `aethera/`, `velix-*`, `personal-*` (Void/Neura) e orquestração geral. |
| `packages/extensions-velix` | **Aethera Studio** | Extensões de produção audiovisual. |
| `packages/extensions-neura` | **Void (Neura)** | Extensões do assistente pessoal, voz e automações. |
| `packages/database` | **Misto (ponto de corte de dados)** | Repositórios misturam os 3 domínios no mesmo SQLite (`schema.ts`). |
| `packages/shared` | **Contratos compartilhados (build-time)** | Contém `channels.ts`, `ipc.ts`, `aethera-*`, `velix-*`. Deve ser fatiado em contratos por app + `agent-provider-contracts`. |
| `packages/workspace` | **Misto** | Utilitários de filesystem, git, mídia/FFmpeg/Remotion (`renderAetheraTimelineSegments`, etc.). |

### 1.3 Features de UI em `apps/desktop/src/renderer/src/features/`

- **Singularity Orchestrator:** `core`, `tasks`, `workflows`, `mission-control`, `monitoring`, `brain`, `brain3d`, `galaxy`, `projects`, `skills`, `integrations`, `design-system`, `onboarding`.
- **Aethera Studio:** `video`, `aethera` (nota: `aethera` e `video` possuem histórico de consolidação; a rota `/aethera` já foi unificada sob `/video` na sidebar).
- **Void (Neura):** `neura`, `companion`.

### 1.4 Repositórios em `packages/database/src/`

- **Aethera Studio:** `aethera-audio-library-repository.ts`, `aethera-director-repository.ts`, `aethera-editorial-plan-repository.ts`, `aethera-media-proxy-repository.ts`, `aethera-review-repository.ts`, `aethera-studio-repository.ts`, `aethera-timeline-repository.ts`, `content-operating-system-repository.ts`, `velix-channel-repository.ts`, `velix-claim-repository.ts`, `velix-collage-repository.ts`, `velix-derivative-repository.ts`, `velix-discovery-repository.ts`, `velix-production-repository.ts`, `velix-storyboard-repository.ts`, `velix-style-repository.ts`.
- **Void (Neura):** `personal-automation-repository.ts`, `personal-notification-repository.ts`, `personal-sync-repository.ts`.
- **Singularity Orchestrator:** `azure-devops-repository.ts`, `idempotency.ts`, `schema.ts` (tabelas `tasks`, `autonomousMissions`, `autonomousMissionTasks`, etc.).

---

## 2. Classificação inicial para limpeza segura (sem excluir ainda)

- **Manter / Preservar:** `docs/` (incluindo `PLAN.md`, `STATUS.md`, `SPEC.MD`, `neura-privacy.md`, `neura-voice.md`), `renders/`, `scripts/`, `tests/`.
- **Artefatos gerados / descartáveis (não versionar):** `dist/`, `artifacts/`, `prints/`.
- **Candidatos à consolidação em SEP-04 / SEP-07.5 (mediante verificação de imports dinâmicos e rotas):**
  - Diretórios `features/aethera` vs `features/video` (unificar apenas após auditar todas as sub-rotas `/aethera/*`).
  - Nomenclatura legada `velix-*` vs `aethera-*` (manter aliases/exports de compatibilidade até SEP-07.5).

---

## 3. Pontos de corte e riscos identificados

1. **Acoplamento no `apps/desktop/src/main/index.ts`:** concentra os 3 domínios (Orchestrator, Aethera/Velix e Neura/Void) no mesmo processo principal e mesmo SQLite.
2. **Identidade de instalador:** `apps/desktop/electron-builder.yml` usa `com.neuralbridge.desktop` / `Singularity`. Em SEP-07, Aethera e Void precisarão de `appId`, `executableName`, diretórios de `userData` e portas/protocolos próprios.
3. **Migração de dados e OAuth:** tokens OAuth do YouTube (Aethera) e memórias/automações pessoais (Void) não devem ser copiados em texto claro; usar migrador com dry-run + hash manifesto (SEP-08) ou reautenticação assistida.
4. **Provedores de IA (RF-07 / §7):** `AetheraAgentOrchestrator` já opera desacoplado de agente nominal (Claude/Codex/Antigravity stub) e com checkpointing; na extração SEP-04, o Aethera manterá esse motor localmente sem depender do app Singularity Orchestrator.

---

## 4. Baseline reproduzível congelada

- **Typecheck global:** `npm run typecheck` — passando (código 0).
- **Build de produção desktop:** `npm run build` (`electron-vite build`) — passando (código 0).
- **Testes automatizados Aethera (AUTO + CHANNEL):** `aethera-auto-orchestrator.test.ts` (6/6) e `aethera-channel-planner.test.ts` (3/3) — 9/9 passando.

**Próxima fase recomendada:** **SEP-02 — Contratos e limites** (definir `@singularity/integration-contracts` e `@singularity/agent-provider-contracts` com testes de contrato e stubs sem acoplar implementações internas).
