# ADR-SEP-02 — Contratos Versionados e Limites de Domínio

**Status:** Aceita e implementada (`@neuralbridge/integration-contracts`)  
**Dependência:** [SEP-2026-01-BASELINE.md](./SEP-2026-01-BASELINE.md)

## Decisão
1. Criar o pacote puro `@neuralbridge/integration-contracts` (`packages/integration-contracts`) sem dependências de runtime de banco de dados, Electron ou filesystem de nenhum dos três aplicativos.
2. Definir três identidades de aplicativo (`orchestrator`, `aethera`, `void`), cada uma com seu próprio banco SQLite (`singularity-orchestrator.db`, `aethera-studio.db`, `void-assistant.db`) e proibição explícita de acesso direto a credenciais, OAuth ou memórias de outro app (`DATA_OWNERSHIP_BOUNDARIES`).
3. Adotar transporte loopback opt-in com endpoints `/v1/health`, `/v1/capabilities`, `/v1/tasks`, `/v1/tasks/{id}`, `/v1/events`, envelope versionado (`requestId`, `correlationId`, `idempotencyKey`, `schemaVersion`, `originApp`, `scopes`, `timeoutMs`) e compatibilidade `N/N-1` (`isCompatibleSchemaVersion`).
4. Garantir pareamento com tokens de curta duração, escopos explícitos e revogação imediata (`IntegrationAuthRegistry`), além de degradação segura para modo isolado (`IntegrationClient`) quando o app par não estiver instalado ou estiver desconectado.
5. Preservar `IAgentProviderContract` alinhado ao RF-07: Claude, Codex e Antigravity são provedores substituíveis; um único agente disponível e capaz executa o fluxo completo sem dependência nominal.

## Evidências
- Código: `packages/integration-contracts/src/index.ts`
- Testes de contrato: `packages/integration-contracts/test/contracts.test.ts`
