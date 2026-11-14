# SEP-08 — Guia de Migração de Dados, Integridade e Rollback

**Data:** 2026-11-13  
**Módulos:** `packages/integration-contracts/src/migration.ts`, `tooling/migrations/migrate-ecosystem.mjs`

## 1. Propriedade de Dados e Classificação

O planejador (`planEcosystemMigration`) classifica os recursos do diretório legado `NeuralBridge` sem compartilhar bancos SQLite entre aplicativos:

- **Singularity Orchestrator (`SingularityOrchestrator`):** `neuralbridge.db*`, `brain/**`, `workflows/**`, `skills/**`, `mcp/**`, `orchestrator/**`, `settings.json`.
- **Aethera Studio (`AetheraStudio`):** `aethera/**`, `renders/**`, `projects/**`, `channels/**`, `thumbnails/**`, `aethera-studio.db*`.
- **Void (`Void`):** `void/**`, `personal/**`, `voice/**`, `neura/**`, `void-assistant.db*`, dados Gmail/Calendar/Spotify não sensíveis.
- **Credenciais e tokens (`*oauth*`, `*token*`, `*secret*`, `*credential*`, `*.key`, `Cookies*`, `Local State`):** **nunca copiados em texto claro** (`requiresReauth: true`, registrados em `skippedCredentials` para reautenticação segura via `safeStorage` próprio de cada app).

## 2. Execução Segura (Dry-Run, Migração e Rollback)

```bash
# 1. Simulação sem alterações em disco
node tooling/migrations/migrate-ecosystem.mjs --dry-run

# 2. Migração real com backup prévio, manifesto SHA-256 e idempotência
node tooling/migrations/migrate-ecosystem.mjs --apply

# 3. Rollback completo com validação de integridade SHA-256
node tooling/migrations/migrate-ecosystem.mjs --rollback
```

## 3. Garantias Implementadas

1. **Idempotência:** arquivos já existentes no destino com mesmo hash SHA-256 são ignorados (`action: 'unchanged'`) e o `backup-manifest.json` original é preservado entre execuções repetidas.
2. **Backup e Manifesto:** antes de sobrescrever qualquer arquivo de destino, o conteúdo prévio é copiado para `backupDir/previous-targets/<app>/...` com registro SHA-256 em `backup-manifest.json`.
3. **Preservação da Origem:** `NeuralBridge` permanece intacto durante e após a migração.
4. **Evidência Automatizada:** validado em `packages/integration-contracts/test/sep08-migration-e2e.test.ts` (dry-run, cópia classificada, bloqueio de credenciais, idempotência, rollback SHA-256 e matriz RF-07).
