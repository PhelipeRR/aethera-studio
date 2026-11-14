# Auditoria e Biblioteca Compartilhada de Skills (`C:\dev\neuralbridge-studio`)

**Data:** 2026-11-13  
**Escopo auditado:** projeto `C:\dev\neuralbridge-studio` e diretórios globais acessíveis neste ambiente.

---

## 1. Inventário de Fontes e Limitações de Acesso

| Origem | Caminho | Resultado da Auditoria |
|---|---|---|
| **Projeto — raiz compartilhada** | `C:\dev\neuralbridge-studio\.agents\skills` | **38 skills** encontradas; todas com `SKILL.md` e `agents/openai.yaml`. |
| **Projeto — raízes específicas** | `.claude/skills`, `.codex/skills`, `.gemini/skills` | Não existem no projeto (evita duplicação; `.agents/skills` atua como fonte única). |
| **Projeto — pacotes (`node_modules`)** | `node_modules/playwright-core/lib/tools/skills/*` | **3 skills** (`playwright-cli`, `playwright-component-testing`, `playwright-trace`). |
| **Global — Antigravity Builtin** | `C:\Users\Pheli\.gemini\antigravity\builtin\skills` | Acessível (skills nativas do Antigravity, ex.: `agy-customizations`, `antigravity_guide`, `automation`, `generative_ui`, `migrate-agent-settings`, `migrate-workflows`, `native_swarm`, `plugin`, `run-workflow`, `swarm_monitor`, `ui-plugin-navigation`). |
| **Global — Antigravity Plugins** | `C:\Users\Pheli\.gemini\config\plugins\*\skills` | Acessível (plugins `android-cli-plugin`, `chrome-devtools-plugin`, `data-agent-kit-plugin`, `firebase`, `flutter`, `google-antigravity-sdk`, `google_maps_platform`, `modern-web-guidance-plugin`, `science`). |
| **Global — Claude Code / Codex / Agents** | `C:\Users\Pheli\.claude`, `C:\Users\Pheli\.codex`, `C:\Users\Pheli\.agents` | **Acesso bloqueado pelo sandbox (`PermissionDenied`)** — não auditados diretamente neste processo por restrição de isolamento. |

---

## 2. Arquitetura da Biblioteca Compartilhada (Sem Duplicação)

- **Fonte Única de Verdade (SSOT):** `C:\dev\neuralbridge-studio\.agents\skills\`
  - Mantém todas as **38 skills** sem copiar ou duplicar pastas para `.claude/skills` ou `.codex/skills`.
  - O scanner do **Hydrogen / Singularity** (`defaultProjectSkillRoots` em `packages/workspace/src/skills/discovery.ts`) já lê `.agents/skills` nativamente.
  - O **Codex** lê `.agents/skills/*/SKILL.md` e `agents/openai.yaml` nativamente.
  - O **Claude Code** e o **Antigravity** podem ler diretamente `.agents/skills/*/SKILL.md`.
- **Catálogo unificado:** [.agents/skills-registry.json](file:///c:/dev/neuralbridge-studio/.agents/skills-registry.json) lista todas as 38 skills, arquivos auxiliares preservados, compatibilidade por agente (`claude`, `codex`, `antigravity`, `hydrogen`) e status (`shared_reused`, `shared_adapted`, `exclusive_claude`).
- **Configurações e dependências:** nenhuma configuração global foi sobrescrita e nenhuma dependência externa foi instalada.

---

## 3. Classificação das 38 Skills do Projeto

### 3.1 Reutilizadas diretamente sem alterações (`34` skills)
Todas as skills abaixo são agnósticas de agente e preservam `SKILL.md`, `agents/openai.yaml` e seus arquivos auxiliares:
- `ask-matt` (inclui `PHASE-BOUNDARIES.md`), `code-review`, `codebase-design` (`DEEPENING.md`, `DESIGN-IT-TWICE.md`), `diagnosing-bugs` (`scripts/hitl-loop.template.sh`), `domain-modeling` (`ADR-FORMAT.md`, `GLOSSARY-FORMAT.md`), `grill-me`, `grill-with-docs`, `grilling`, `handoff`, `implement`, `improve-codebase-architecture` (`HTML-REPORT.md`), `loop-me`, `migrate-to-shoehorn`, `pr` (`CREDITS.md`), `prototype` (`LOGIC.md`, `UI.md`), `research`, `retro`, `scaffold-exercises`, `setup-matt-pocock-skills` (`domain.md`, `issue-tracker-*.md`, `triage-labels.md`), `setup-pre-commit`, `setup-ts-deep-modules` (`dependency-cruiser.config.cjs`), `tdd` (`mocking.md`, `tests.md`), `teach` (`*-FORMAT.md`), `to-questionnaire`, `to-spec`, `to-tickets`, `triage` (`AGENT-BRIEF.md`, `OUT-OF-SCOPE.md`), `wait-what`, `wayfinder`, `wizard` (`template.sh`), `writing-beats`, `writing-for-agents` (`SKILL-MECHANICS.md`), `writing-fragments`, `writing-shape`.

**Notas de dependências:**
- `setup-ts-deep-modules`: requer `dependency-cruiser` (não instalado automaticamente; instalar apenas sob solicitação explícita).
- `diagnosing-bugs` e `wizard`: possuem templates `.sh` (`scripts/hitl-loop.template.sh`, `template.sh`), utilizáveis em Git Bash / WSL no Windows.
- `playwright-cli`, `playwright-component-testing`, `playwright-trace` (em `node_modules/playwright-core/lib/tools/skills/*`): reutilizáveis diretamente via dependência `playwright-core` já presente no workspace.

### 3.2 Compartilhadas e Adaptadas (`2` skills)
Preservadas as instruções originais do Claude Code e adicionada seção `## Multi-Agent Harness Equivalence` para execução equivalente no **Codex** e **Antigravity / Hydrogen**:
- [chief-of-staff](file:///c:/dev/neuralbridge-studio/.agents/skills/chief-of-staff/SKILL.md): mapeamento de subagentes/schedules (`invoke_subagent` / `swarm` / `schedule` no Antigravity; sessões paralelas no Codex).
- [implement-spec](file:///c:/dev/neuralbridge-studio/.agents/skills/implement-spec/SKILL.md): mapeamento de `Skill` tool + worktrees para leitura direta de `.agents/skills/<name>/SKILL.md` e `invoke_subagent` com `Workspace: "branch"`/`"share"`.

### 3.3 Exclusivas do Claude Code / Incompatíveis com Codex e Antigravity (`2` skills)
- [git-guardrails-claude-code](file:///c:/dev/neuralbridge-studio/.agents/skills/git-guardrails-claude-code/SKILL.md): configura hook `PreToolUse` exclusivo do Claude Code (`.claude/settings.json` + `scripts/block-dangerous-git.sh`).
- [claude-handoff](file:///c:/dev/neuralbridge-studio/.agents/skills/claude-handoff/SKILL.md): invoca `claude --bg --name ...` e `claude agents`. **Alternativa compartilhada existente:** [handoff](file:///c:/dev/neuralbridge-studio/.agents/skills/handoff/SKILL.md).

---

## 4. Validação Automatizada

- Teste em `tests/integration/skills-library-discovery.test.ts`: valida via `createSkillDiscoveryEngine` + `defaultProjectSkillRoots` (`@neuralbridge/workspace`) a descoberta das 38 skills sem duplicatas, validade de `SKILL.md` (`name` e `description`), presença de `agents/openai.yaml`, preservação de arquivos auxiliares e integridade de `.agents/skills-registry.json`.
