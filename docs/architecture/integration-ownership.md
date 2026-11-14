# Integration ownership

This is the ownership map for the consolidation boundary. An integration must
keep its provider client behind one adapter and must not call Electron APIs or
the database directly from feature code.

| System | Adapter owner | Credential owner | Retry/failure policy | Redaction boundary | Test seam |
|---|---|---|---|---|---|
| Claude/Codex CLI | `packages/agents` + `TaskEngine` | OS/user CLI session | `recovery-policy.ts` | agent event persistence | fake adapters in orchestrator tests |
| Neural Brain/MCP | `packages/brain` + MCP server | local SQLite/config | local retry and degraded DB status | memory/event redaction | database and MCP contract tests |
| Azure DevOps/TFS | `orchestrator/integrations/azure-devops-client.ts` | desktop credential store | cancelable read-only REST, pagination, translated 401/403/404 | client response normalization | fake REST server/client tests |
| YouTube | `orchestrator/velix-youtube-channel.ts` | encrypted OAuth store | resumable upload checkpoint | provider payload stays in main | fake YouTube server tests |
| Spotify | `orchestrator/integrations/spotify-adapter.ts` | encrypted token store | adapter-specific status mapping | command/result schemas | fake Spotify adapter |
| FFmpeg/VoiceStudio | workspace adapters | local executable/config | capability detection and explicit failure | paths stay in main/workspace | fake tools and focused render tests |

## Rules

- Renderer code consumes validated IPC results only; it never owns provider credentials.
- Provider payloads are untrusted input and are normalized before persistence.
- Read-only integrations do not gain write capability through a retry or resume path.
- A new integration must add one owner row, one adapter seam, one redaction test,
  and one failure/retry test before being considered part of the core surface.
- Neura and Velix remain extensions in the product hierarchy even where their
  current adapters live in the monorepo for compatibility.

## Enforcement (2026-11-08, Task 2.3)

- `apps/desktop/test/architecture-boundaries.test.ts` fails when a package imports Electron or the
  desktop app, when a provider client (Azure DevOps, Spotify, YouTube, weather, OAuth and credential
  stores) imports Electron or `@neuralbridge/database`, or when an application service under
  `packages/orchestrator/src/application/` imports Electron, the schema or a provider client.
  Electron's `safeStorage` and the database reach these modules only through injection.
- Correlation: integration calls inherit the IPC request's correlation ID; Azure DevOps sends it as
  `X-TFS-Session`. Spotify and YouTube do not send a header yet.
- Write results are normalized in the adapter: the Azure DevOps client returns only the fields the
  app shows, never the provider response.

## Fake and real tests

| Kind | Where | How it runs |
|---|---|---|
| Fake server / fake adapter | `packages/*/test`, `tests/e2e/*.spec.ts` (fake agents via `FAKE_AGENTS`, local fixture servers) | Always, in CI and locally |
| Real provider | `tests/e2e/*-real.spec.ts` | Only with an explicit opt-in such as `NB_REAL_CLI=1`, `NB_REAL_YOUTUBE=1`, `NB_E2E_REAL_VOICE=1`, `NB_E2E_REAL_MOUSE=1` |
| Legacy mixed (Velix, frozen extension) | `velix-discovery.spec.ts`, `velix-journey.spec.ts` | Real parts only with `NB_REAL_*` opt-ins |

The real Claude/Codex checks from `agents.spec.ts` and `mcp.spec.ts` moved to `agents-real.spec.ts` and
`mcp-real.spec.ts`; `neura-voice-real.spec.ts` now also requires `NB_E2E_REAL_VOICE=1` instead of
running whenever VoiceStudio happens to be up. A fake-server pass never marks an integration as
homologated (see `docs/release/homologation-matrix.md`).
