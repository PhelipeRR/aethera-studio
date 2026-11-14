# Colagem editorial com IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar a colagem editorial com duas aprovações, provedor Gemini opcional, Rights Manager e B-roll na mistura.

**Architecture:** O contrato compartilhado define o estado do fluxo. O processo principal controla `safeStorage`, rede e aprovações; o renderer apenas exibe estado e envia ações. Um adaptador de provedor permite fake determinístico e Gemini real. O compositor recebe clipes aprovados como segmentos intermediários.

**Tech Stack:** TypeScript strict, Electron IPC/preload, SQLite/Drizzle, Electron `safeStorage`, Gemini REST, FFmpeg/FFprobe, Vitest e Playwright.

**Spec:** `docs/superpowers/specs/2026-11-04-ai-editorial-collage-design.md`

## Global Constraints

- Sem geração sem aprovação humana.
- Chave fora do renderer, banco, logs e texto puro.
- Mídia só entra na produção após Rights Manager e FFprobe.
- Nenhum script/download do port externo roda no app.

## Review Focus

- Criptografia indisponível: falhar antes de qualquer chamada de rede.
- Respostas Gemini inválidas ou grandes: rejeitar sem persistir mídia.
- Rejeição na aprovação 1 ou 2: não gerar/cobrar.
- Arquivo gerado inválido ou sem direitos: não entrar na mistura.
- Reinício: job aprovado e registro de direitos continuam legíveis.

### Task 1: contratos e provider

**Files:** `packages/shared/src/velix-collage.ts`, tests shared.

- [x] Definir schemas de request, estimate, metaphor, still, generation e QA.
- [x] Implementar fake provider determinístico e validações de limites.
- [x] Testar rejeições, aprovações e respostas inválidas.

### Task 2: persistência e segredo

**Files:** migração aditiva, schema/repository database, main secret store.

- [x] Persistir jobs e artefatos sem a chave.
- [x] Cifrar/decifrar chave somente no main usando `safeStorage`.
- [x] Testar reinício, ausência de chave e armazenamento indisponível.

### Task 3: IPC e UI

**Files:** shared IPC, preload, main, `VelixStudio`/componente novo.

- [x] Expor configurar chave, estimar, gerar metáfora, aprovar etapas e gerar.
- [x] Mostrar custo e exigir configuração da chave antes do job.
- [x] Registrar Rights Manager após QA aprovado.

### Task 4: composição e jornada

**Files:** style mix, render worker, testes Vitest/Playwright, docs PLAN/STATUS.

- [x] Inserir B-roll aprovado entre segmentos sem substituir cenas originais.
- [ ] Renderizar fake provider em MP4 e validar FFprobe.
- [ ] E2E cobrir rejeição, aprovação completa, reinício e MP4 final.

### Gates

- [ ] Vitest direcionado em série.
- [ ] typecheck, lint direcionado, build Motion, build Electron.
- [x] E2E fake provider com MP4 válido (`tests/e2e/video.spec.ts`, 1/1).
- [ ] `git diff --check` e `verify:dist`.
