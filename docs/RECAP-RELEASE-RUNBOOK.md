# Aethera Recap — Runbook de Release, Diagnóstico e Recuperação (Fase 7.4)

Guia operacional para validar o ambiente, homologar a Fase 2.2.4 com agentes reais, empacotar o Aethera Desktop para Windows e recuperar projetos interrompidos via checkpoints duráveis.

## 1. Diagnóstico de ambiente (Windows PowerShell)

```powershell
node -v
ffmpeg -version | Select-Object -First 1
ffprobe -version | Select-Object -First 1
Get-Command claude, codex, agy -ErrorAction SilentlyContinue
```

Requisitos mínimos:
- **Node.js 22+**, **FFmpeg** e **FFprobe** no `PATH`.
- Pelo menos **1 provedor multimodal com quota ativa** (`Claude CLI`, `Claude Gateway`, `Codex CLI`, `Antigravity CLI` ou `Ollama local-vlm`) para etapas narrativas (Fases 2.2.4 / 6.1).
- **Fase 3 (Produção Audiovisual):** executa deterministicamente sem depender de Claude/Codex/Antigravity.

## 2. Suíte completa de testes automatizados (sem consumir quota)

```powershell
npx vitest run `
  packages/cinema/test/recap/phase224-enhancements.test.ts `
  packages/cinema/test/recap/phase3-audiovisual.test.ts `
  packages/cinema/test/recap/phase4-to-7-complete.test.ts `
  packages/cinema/test/recap-vision-adapter-e2e.test.ts `
  packages/orchestrator/test/aethera-vision-router.test.ts
```

## 3. Homologação E2E real da Fase 2.2.4 / 6.1 (quando houver quota)

Teste curto inicial (2 painéis):
```powershell
$env:NB_RECAP_E2E_MAX_PANELS="2"
$env:NB_RECAP_CONCURRENCY="1"
npx tsx scripts/e2e-recap-phase224.mts
```

Amostra completa de 24 painéis (reaproveitando checkpoint dos 2 primeiros):
```powershell
$env:NB_RECAP_E2E_MAX_PANELS="24"
$env:NB_RECAP_CONCURRENCY="2"
npx tsx scripts/e2e-recap-phase224.mts
```

*(Para usar Claude Gateway em memória na sessão CLI, defina `$env:NB_CLAUDE_GATEWAY_BASE_URL` e `$env:NB_CLAUDE_GATEWAY_TOKEN` antes de rodar.)*

## 4. Validação técnica da Fase 3 (MP4 + SFX MotionVelix + Gate H)

```powershell
npx tsx scripts/e2e-recap-phase3-technical-preview.mts
```

Artefatos produzidos em `.aethera-recap-data\phase3-technical-preview\render\`:
- `recap-preview.mp4`
- `recap-captions.ass`
- `recap-audiovisual-plan.json`
- `gate-h-report.json`

## 5. Typecheck, Build e Instalador Windows (Fase 7.4)

```powershell
npm run typecheck
npm run typecheck:desktop
npm run build:aethera
npm run dist:win:aethera
```

## 6. Recuperação de projetos via checkpoints duráveis

- **CLI / Workspace:** `.aethera-recap-data\phase224\checkpoints\<chapterId>\recap-checkpoint.json`
- **Aethera Desktop:** `%APPDATA%\aethera-desktop\recap-workspace\checkpoints\<chapterId>\`
- **Estado da máquina de estados (Fase 5):** `state\recap-orchestrator-state.json`
- Todos os checkpoints usam escrita atômica (`.tmp` → `rename`) e filtram análises com `confidence <= 0`, garantindo retomada segura após queda do app ou exaustão de quota.
